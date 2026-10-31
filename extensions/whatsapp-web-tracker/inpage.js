/**
 * RecordHub WhatsApp Web Call Tracker - In-Page WebRTC & WebAudio Audio Recorder
 * 
 * Runs in the webpage context (world: "MAIN") to:
 * 1. Accurately detect call start, connect, and hangup via RTCPeerConnection lifecycle
 * 2. Capture counselor's local microphone via getUserMedia / pc.addTrack
 * 3. Capture receiver/client's audio via MULTI-LAYER INTERCEPTION:
 *    a) AudioNode.prototype.connect Fan-Out: taps directly into WhatsApp Web's
 *       internal WebAssembly / AudioWorklet audio pipeline routing to headphones
 *    b) RTCPeerConnection ontrack & getReceivers: taps incoming WebRTC audio tracks
 *    c) HTMLMediaElement srcObject / play: taps any HTML5 audio playback elements
 * 4. Solves Chromium Bug 933677: keeps remote audio decoding active with in-DOM sink
 * 5. Mixes both channels with 1.5x remote gain so receiver is loud and clear with headphones
 * 6. Packages and streams the mixed WebM audio recording upon call completion
 */

(function () {
  'use strict';

  if (window.__recordhub_inpage_injected) return;
  window.__recordhub_inpage_injected = true;

  window.__recordhub_logs = window.__recordhub_logs || [];
  function logDebug(...args) {
    const str = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    window.__recordhub_logs.push({ t: new Date().toISOString().slice(11, 19), msg: str });
    if (window.__recordhub_logs.length > 100) window.__recordhub_logs.shift();
    console.log('[RecordHub Inpage]', ...args);
  }

  logDebug('🚀 Initializing WhatsApp Web two-way audio recorder with WebAudio fan-out & headphone support...');

  let localAudioStream = null;
  let remoteAudioStream = null;
  let remoteAudioSink = null;
  let audioContext = null;
  let mediaRecorder = null;
  let recordedChunks = [];
  let isRecordingCall = false;
  let activePeerConnections = new Set();
  let terminationTimer = null;
  let recordingMonitorInterval = null;

  function cancelTerminationTimer() {
    if (terminationTimer) {
      clearTimeout(terminationTimer);
      terminationTimer = null;
    }
  }

  function isLocalMicrophoneActive() {
    if (!localAudioStream) return false;
    const tracks = localAudioStream.getAudioTracks();
    return tracks.some((t) => t.readyState === 'live');
  }

  function isRemoteAudioActive() {
    if (!remoteAudioStream) return false;
    const tracks = remoteAudioStream.getAudioTracks();
    return tracks.some((t) => t.readyState === 'live');
  }

  function hasConnectedPeerConnection() {
    for (const pc of activePeerConnections) {
      if (pc.connectionState === 'connected' || pc.iceConnectionState === 'connected') {
        return true;
      }
    }
    return false;
  }

  function hasActiveCallUi() {
    const endCallSelectors = [
      '[data-testid*="end-call"]',
      '[data-testid*="call-cancel"]',
      'button[aria-label*="End call" i]',
      'button[aria-label*="Hang up" i]',
      'button[aria-label*="Leave call" i]',
      'span[data-icon="hangup"]',
      'span[data-icon="call-end"]',
      'span[data-icon="call-cancel"]',
    ];

    for (const sel of endCallSelectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        if (!el.closest('#main') && !el.closest('#side')) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Chromium WebRTC Bug 933677 Workaround:
   * Keeps Chromium's WebRTC audio decoding pipeline active.
   */
  function activateRemoteAudioPipeline(stream) {
    if (!stream) return;
    try {
      if (!remoteAudioSink) {
        remoteAudioSink = document.createElement('audio');
        remoteAudioSink.id = 'recordhub-remote-audio-sink';
        remoteAudioSink.style.position = 'fixed';
        remoteAudioSink.style.top = '-9999px';
        remoteAudioSink.style.left = '-9999px';
        remoteAudioSink.style.width = '1px';
        remoteAudioSink.style.height = '1px';
        remoteAudioSink.style.opacity = '0';
        remoteAudioSink.style.pointerEvents = 'none';
        remoteAudioSink.muted = true;
        remoteAudioSink.autoplay = true;
        remoteAudioSink.playsInline = true;
        (document.body || document.documentElement).appendChild(remoteAudioSink);
      }

      if (remoteAudioSink.srcObject !== stream) {
        remoteAudioSink.srcObject = stream;
      }

      const p = remoteAudioSink.play();
      if (p !== undefined) {
        p.catch((err) => {
          console.debug('[RecordHub Inpage] Note: Remote audio sink play promise:', err);
        });
      }
    } catch (err) {
      console.warn('[RecordHub Inpage] Failed to activate remote audio sink:', err);
    }
  }

  function updateLocalTrack(track) {
    if (!track || track.kind !== 'audio') return;
    try {
      logDebug('🎙️ Bound local audio track:', track.id, track.readyState);
      localAudioStream = new MediaStream([track]);
      if (isRecordingCall && audioContext) {
        attachStreamToMixer(localAudioStream, 'local');
      }
    } catch (err) {
      console.warn('[RecordHub Inpage] Error binding local audio track:', err);
    }
  }

  function updateRemoteTrack(track, stream, sourceLabel = 'remote') {
    if (!track || track.kind !== 'audio') return;
    try {
      track.enabled = true;
      const s = stream || new MediaStream([track]);
      remoteAudioStream = s;

      logDebug(`🔊 Bound ${sourceLabel} audio track:`, track.id, 'readyState:', track.readyState, 'muted:', track.muted);

      // Keep Chromium decoding active
      activateRemoteAudioPipeline(s);

      // Attach IMMEDIATELY to mixer (do NOT block on unmute event to avoid deadlock)
      if (isRecordingCall && audioContext) {
        attachStreamToMixer(s, sourceLabel);
      }

      // If muted, also re-attach once unmute fires as extra assurance
      if (track.muted) {
        track.addEventListener('unmute', () => {
          logDebug(`🔊 Track ${track.id} unmuted event received.`);
          activateRemoteAudioPipeline(s);
          if (isRecordingCall && audioContext) {
            attachStreamToMixer(s, sourceLabel);
          }
        }, { once: true });
      }
    } catch (err) {
      console.warn('[RecordHub Inpage] Error binding remote audio track:', err);
    }
  }

  /**
   * Scan SDP for caller phone number or WhatsApp JID
   */
  function inspectSdpForCallerInfo(sdp, source, sdpType) {
    if (!sdp || typeof sdp !== 'string') return;
    try {
      const jidMatch = sdp.match(/(\d{7,15})@(?:s\.whatsapp\.net|c\.us)/);
      if (jidMatch && jidMatch[1]) {
        const phone = `+${jidMatch[1]}`;
        logDebug(`📡 Detected phone number from WebRTC ${source} (${sdpType || ''}) SDP JID:`, phone);
        window.postMessage({ type: 'RECORDHUB_PHONE_DETECTED', phoneNumber: phone, source: source, sdpType: sdpType }, '*');
        return;
      }

      const numMatch = sdp.match(/(?:phone|call|jid|user|peer|caller)[=: ]+["']?(\+?\d{7,15})["']?/i);
      if (numMatch && numMatch[1]) {
        const phone = numMatch[1].startsWith('+') ? numMatch[1] : `+${numMatch[1]}`;
        logDebug(`📡 Detected phone number from WebRTC ${source} (${sdpType || ''}) SDP attribute:`, phone);
        window.postMessage({ type: 'RECORDHUB_PHONE_DETECTED', phoneNumber: phone, source: source, sdpType: sdpType }, '*');
      }
    } catch (err) {
      console.warn('[RecordHub Inpage] Error parsing SDP:', err);
    }
  }

  // ─── 1. Intercept AudioNode.prototype.connect (WebAudio / AudioWorklet Fan-Out) ──
  // WhatsApp Web routes decoded incoming voice from WebAssembly/AudioWorklet
  // directly into AudioContext.destination (the user's headphones).
  // We fan-out any node connecting to destination into a MediaStreamDestination
  // so the recording captures EXACTLY what the user hears in their headphones!

  const origAudioNodeConnect = AudioNode.prototype.connect;
  const hookedAudioNodes = new WeakSet();

  AudioNode.prototype.connect = function (destination, outputIndex, inputIndex) {
    try {
      const ctx = this.context;
      const isDestination = destination && (
        destination === ctx.destination ||
        (window.AudioDestinationNode && destination instanceof AudioDestinationNode)
      );

      // If an audio node connects to the speaker/headphone destination, it's receiver voice or call audio!
      if (isDestination && !hookedAudioNodes.has(this) && this !== ctx.__recordhub_dest_node) {
        hookedAudioNodes.add(this);
        logDebug('🎧 Intercepted AudioNode connecting to headphones/destination:', this.constructor.name);

        if (!ctx.__recordhub_stream_dest) {
          ctx.__recordhub_stream_dest = ctx.createMediaStreamDestination();
        }

        // Fan-out: connect this audio node to our recording stream destination as well
        origAudioNodeConnect.call(this, ctx.__recordhub_stream_dest);

        const destStream = ctx.__recordhub_stream_dest.stream;
        if (destStream && destStream.getAudioTracks().length > 0) {
          const track = destStream.getAudioTracks()[0];
          logDebug('🎚️ Feeding WebAudio headphone output into recording mixer:', track.id);
          updateRemoteTrack(track, destStream, 'webaudio_remote');
        }
      }
    } catch (err) {
      console.warn('[RecordHub Inpage] Error in AudioNode.connect interceptor:', err);
    }

    return origAudioNodeConnect.apply(this, arguments);
  };

  // ─── 2. Intercept navigator.mediaDevices.getUserMedia (Local Microphone) ───

  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    const origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

    navigator.mediaDevices.getUserMedia = async function (constraints) {
      const stream = await origGetUserMedia(constraints);
      try {
        if (constraints && (constraints.audio || constraints.audio === true)) {
          const audioTracks = stream.getAudioTracks();
          if (audioTracks.length > 0) {
            logDebug('🎙️ Captured local mic from getUserMedia.');
            updateLocalTrack(audioTracks[0]);
          }
        }
      } catch (err) {
        console.warn('[RecordHub Inpage] Error capturing local mic stream:', err);
      }
      return stream;
    };
  }

  // ─── 3. Intercept HTMLMediaElement.prototype.srcObject (WhatsApp Audio Playback) ───

  const origSrcObjectDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'srcObject');
  if (origSrcObjectDescriptor && origSrcObjectDescriptor.set) {
    const origSetSrcObject = origSrcObjectDescriptor.set;
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      set: function (stream) {
        try {
          if (this.id !== 'recordhub-remote-audio-sink' && stream && typeof stream.getAudioTracks === 'function') {
            const tracks = stream.getAudioTracks();
            if (tracks.length > 0) {
              const trackId = tracks[0].id;
              const isLocal = localAudioStream && localAudioStream.getAudioTracks().some((t) => t.id === trackId);
              if (!isLocal) {
                logDebug('🎧 Intercepted WhatsApp audio element srcObject:', trackId);
                updateRemoteTrack(tracks[0], stream, 'element_remote');
              }
            }
          }
        } catch (e) {
          console.warn('[RecordHub Inpage] Error in srcObject interceptor:', e);
        }
        return origSetSrcObject.call(this, stream);
      },
      get: function () {
        return origSrcObjectDescriptor.get ? origSrcObjectDescriptor.get.call(this) : undefined;
      },
      configurable: true,
      enumerable: true,
    });
  }

  // ─── 4. Intercept RTCRtpSender.prototype.replaceTrack ─────────────────────

  if (window.RTCRtpSender && window.RTCRtpSender.prototype.replaceTrack) {
    const origReplaceTrack = window.RTCRtpSender.prototype.replaceTrack;
    window.RTCRtpSender.prototype.replaceTrack = function (track) {
      if (track && track.kind === 'audio') {
        updateLocalTrack(track);
      }
      return origReplaceTrack.apply(this, arguments);
    };
  }

  // ─── 5. Intercept RTCPeerConnection (Remote Audio & Call Lifecycle) ────────

  const OriginalRTCPeerConnection = window.RTCPeerConnection;
  if (OriginalRTCPeerConnection) {
    window.RTCPeerConnection = function (...args) {
      cancelTerminationTimer();
      const pc = new OriginalRTCPeerConnection(...args);
      const isFirst = activePeerConnections.size === 0;
      activePeerConnections.add(pc);

      if (isFirst) {
        logDebug('📡 WebRTC RTCPeerConnection created (call init).');
        window.postMessage({ type: 'RECORDHUB_WA_CALL_INIT' }, '*');
      }

      // Intercept createOffer to detect outgoing call at WebRTC level
      const origCreateOffer = pc.createOffer.bind(pc);
      pc.createOffer = function (...args) {
        logDebug('📡 WebRTC pc.createOffer called -> OUTGOING call detected at WebRTC level');
        window.postMessage({ type: 'RECORDHUB_CALL_DIRECTION_DETECTED', direction: 'OUTGOING' }, '*');
        return origCreateOffer(...args);
      };

      // Intercept createAnswer to detect incoming call at WebRTC level
      const origCreateAnswer = pc.createAnswer.bind(pc);
      pc.createAnswer = function (...args) {
        logDebug('📡 WebRTC pc.createAnswer called -> INCOMING call detected at WebRTC level');
        window.postMessage({ type: 'RECORDHUB_CALL_DIRECTION_DETECTED', direction: 'INCOMING' }, '*');
        return origCreateAnswer(...args);
      };

      // Intercept SDP descriptions to extract phone number/JID and confirm direction
      const origSetRemoteDescription = pc.setRemoteDescription.bind(pc);
      pc.setRemoteDescription = function (description) {
        if (description) {
          if (description.type === 'offer') {
            logDebug('📡 WebRTC pc.setRemoteDescription(offer) -> INCOMING call confirmed at WebRTC level');
            window.postMessage({ type: 'RECORDHUB_CALL_DIRECTION_DETECTED', direction: 'INCOMING' }, '*');
          } else if (description.type === 'answer') {
            logDebug('📡 WebRTC pc.setRemoteDescription(answer) -> OUTGOING call confirmed at WebRTC level');
            window.postMessage({ type: 'RECORDHUB_CALL_DIRECTION_DETECTED', direction: 'OUTGOING' }, '*');
          }
          if (description.sdp) {
            inspectSdpForCallerInfo(description.sdp, 'remote', description.type);
          }
        }
        return origSetRemoteDescription(description);
      };

      const origSetLocalDescription = pc.setLocalDescription.bind(pc);
      pc.setLocalDescription = function (description) {
        if (description) {
          if (description.type === 'answer') {
            logDebug('📡 WebRTC pc.setLocalDescription(answer) -> INCOMING call confirmed at WebRTC level');
            window.postMessage({ type: 'RECORDHUB_CALL_DIRECTION_DETECTED', direction: 'INCOMING' }, '*');
          }
          if (description.sdp) {
            inspectSdpForCallerInfo(description.sdp, 'local', description.type);
          }
        }
        return origSetLocalDescription(description);
      };

      // Intercept pc.addTrack to capture counselor's local audio track
      const origAddTrack = pc.addTrack.bind(pc);
      pc.addTrack = function (track, ...streams) {
        if (track && track.kind === 'audio') {
          logDebug('🎙️ Captured counselor local audio track via pc.addTrack');
          updateLocalTrack(track);
        }
        return origAddTrack(track, ...streams);
      };

      // Listen for remote audio track from client
      pc.addEventListener('track', (event) => {
        try {
          if (event.track && event.track.kind === 'audio') {
            logDebug('🔊 Captured remote audio track from client via pc.ontrack:', event.track.id);
            const stream = event.streams && event.streams[0]
              ? event.streams[0]
              : new MediaStream([event.track]);

            cancelTerminationTimer();
            updateRemoteTrack(event.track, stream, 'webrtc_remote');

            if (typeof pc.getSenders === 'function') {
              pc.getSenders().forEach((s) => {
                if (s.track && s.track.kind === 'audio') updateLocalTrack(s.track);
              });
            }

            startCallRecording();
          }
        } catch (trackErr) {
          console.warn('[RecordHub Inpage] Error handling remote audio track:', trackErr);
        }
      });

      // Monitor connection state
      pc.addEventListener('connectionstatechange', () => {
        logDebug('📡 WebRTC connectionState:', pc.connectionState);
        if (pc.connectionState === 'connected') {
          activePeerConnections.add(pc);
          cancelTerminationTimer();
          window.postMessage({ type: 'RECORDHUB_WA_CALL_CONNECTED' }, '*');

          scanReceivers();

          if (typeof pc.getSenders === 'function') {
            pc.getSenders().forEach((s) => {
              if (s.track && s.track.kind === 'audio') updateLocalTrack(s.track);
            });
          }

          startCallRecording();
        } else if (pc.connectionState === 'closed') {
          handlePcClosed(pc);
        } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          logDebug(`📡 WebRTC connectionState: ${pc.connectionState}. Verifying in 1.5s...`);
          setTimeout(() => {
            if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
              handlePcClosed(pc);
            }
          }, 1500);
        }
      });

      pc.addEventListener('iceconnectionstatechange', () => {
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          activePeerConnections.add(pc);
          cancelTerminationTimer();
          window.postMessage({ type: 'RECORDHUB_WA_CALL_CONNECTED' }, '*');
          scanReceivers();
          startCallRecording();
        } else if (pc.iceConnectionState === 'closed') {
          handlePcClosed(pc);
        } else if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
          logDebug(`📡 WebRTC iceConnectionState: ${pc.iceConnectionState}. Verifying in 1.5s...`);
          setTimeout(() => {
            if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
              handlePcClosed(pc);
            }
          }, 1500);
        }
      });

      const origClose = pc.close.bind(pc);
      pc.close = function () {
        logDebug('📡 pc.close() invoked.');
        handlePcClosed(pc);
        return origClose();
      };

      return pc;
    };

    Object.assign(window.RTCPeerConnection, OriginalRTCPeerConnection);
    window.RTCPeerConnection.prototype = OriginalRTCPeerConnection.prototype;
  }

  function scanReceivers() {
    for (const pc of activePeerConnections) {
      if (typeof pc.getReceivers === 'function') {
        pc.getReceivers().forEach((r) => {
          if (r.track && r.track.kind === 'audio' && r.track.readyState === 'live') {
            const isLocal = localAudioStream && localAudioStream.getAudioTracks().some((t) => t.id === r.track.id);
            if (!isLocal) {
              const currentTracks = remoteAudioStream ? remoteAudioStream.getAudioTracks() : [];
              if (!currentTracks.some((t) => t.id === r.track.id)) {
                logDebug('🔊 Discovered remote track via scanReceivers():', r.track.id);
                updateRemoteTrack(r.track, new MediaStream([r.track]), 'receiver_scan');
              }
            }
          }
        });
      }
    }
  }

  function handleCallEnded() {
    cancelTerminationTimer();
    if (!isRecordingCall && activePeerConnections.size === 0) return;
    activePeerConnections.clear();
    logDebug('📵 Call definitively ended. Posting RECORDHUB_WA_CALL_TERMINATED...');
    window.postMessage({ type: 'RECORDHUB_WA_CALL_TERMINATED' }, '*');
    stopCallRecording();
  }

  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'RECORDHUB_STOP_RECORDING') {
      logDebug('🛑 Received immediate stop signal from content script.');
      handleCallEnded();
    }
  });

  function handlePcClosed(pc) {
    activePeerConnections.delete(pc);
    logDebug('📡 RTCPeerConnection closed/disconnected. Remaining active connections:', activePeerConnections.size);

    if (hasConnectedPeerConnection()) {
      logDebug('🔄 Secondary connection closed; primary connection still active.');
      return;
    }

    if (activePeerConnections.size === 0) {
      cancelTerminationTimer();
      logDebug('⏳ All WebRTC peer connections closed. Verifying call state in 1.5s...');
      terminationTimer = setTimeout(() => {
        if (activePeerConnections.size === 0 && !hasConnectedPeerConnection()) {
          // If active call UI (specifically the End Call button outside #main) is STILL present in DOM, wait briefly
          if (hasActiveCallUi()) {
            logDebug('⚠️ Active call UI still present in DOM. Waiting...');
            return;
          }
          logDebug('📵 Verified all connections closed and no active call UI. Finalizing call immediately.');
          handleCallEnded();
        }
      }, 1500);
    }
  }

  // ─── 6. Audio Mixing & MediaRecorder ───────────────────────────────────────

  let mixerDestination = null;
  const attachedSources = new Map();

  function unlockAudioContext() {
    try {
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {});
      }
    } catch (_) {}
  }

  // Pre-unlock AudioContext on any user interaction so autoplay policy never suspends it during calls
  window.addEventListener('click', unlockAudioContext, { capture: true, passive: true });
  window.addEventListener('keydown', unlockAudioContext, { capture: true, passive: true });

  function ensureAudioContextRunning() {
    if (!audioContext) {
      unlockAudioContext();
    }
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume().catch((err) => {
        console.warn('[RecordHub Inpage] Error resuming AudioContext:', err);
      });
    }
  }

  function startCallRecording() {
    if (isRecordingCall) {
      ensureAudioContextRunning();
      if (localAudioStream) attachStreamToMixer(localAudioStream, 'local');
      if (remoteAudioStream) attachStreamToMixer(remoteAudioStream, 'remote');
      return;
    }

    isRecordingCall = true;
    recordedChunks = [];

    try {
      if (!audioContext || audioContext.state === 'closed') {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      ensureAudioContextRunning();

      if (!mixerDestination) {
        mixerDestination = audioContext.createMediaStreamDestination();
      }

      if (localAudioStream) attachStreamToMixer(localAudioStream, 'local');
      if (remoteAudioStream) attachStreamToMixer(remoteAudioStream, 'remote');

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');

      mediaRecorder = new MediaRecorder(mixerDestination.stream, mimeType ? { mimeType } : undefined);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        logDebug('🎙️ MediaRecorder stopped. Total chunks collected:', recordedChunks.length);
        if (recordedChunks.length > 0) {
          const mime = mediaRecorder.mimeType || 'audio/webm';
          const audioBlob = new Blob(recordedChunks, { type: mime });
          const recordedSources = Array.from(attachedSources.keys());
          logDebug('📦 Audio recording packaged. Size:', audioBlob.size, 'bytes. Sources recorded:', recordedSources);

          const reader = new FileReader();
          reader.onloadend = () => {
            window.postMessage({
              type: 'RECORDHUB_AUDIO_RECORDED',
              audioDataUrl: reader.result,
              fileSizeBytes: audioBlob.size,
              mimeType: mime,
              attachedSources: recordedSources,
              debugLogs: (window.__recordhub_logs || []).slice(-30),
            }, '*');
            cleanupAudio();
          };
          reader.readAsDataURL(audioBlob);
        } else {
          console.warn('[RecordHub Inpage] No audio chunks collected during call.');
          cleanupAudio();
        }
      };

      mediaRecorder.start(1000); // 1-second timeslices
      logDebug('✅ MediaRecorder started successfully on mixed WebRTC + WebAudio streams.');

      // Active 1-second background monitor to ensure newly appearing remote tracks attach without delay
      if (recordingMonitorInterval) clearInterval(recordingMonitorInterval);
      recordingMonitorInterval = setInterval(() => {
        if (!isRecordingCall) {
          clearInterval(recordingMonitorInterval);
          recordingMonitorInterval = null;
          return;
        }
        ensureAudioContextRunning();
        scanReceivers();
        if (localAudioStream) attachStreamToMixer(localAudioStream, 'local');
        if (remoteAudioStream) attachStreamToMixer(remoteAudioStream, 'remote');
      }, 1000);
    } catch (err) {
      console.error('[RecordHub Inpage] Failed to start MediaRecorder:', err);
      isRecordingCall = false;
    }
  }

  function attachStreamToMixer(stream, label) {
    if (!audioContext || !mixerDestination || !stream) return;
    try {
      ensureAudioContextRunning();
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) return;

      const track = audioTracks[0];
      if (track.readyState === 'ended') return;
      track.enabled = true;

      const trackId = track.id;
      const key = `${label}_${trackId}`;
      if (attachedSources.has(key)) {
        return; // Already attached this exact track
      }

      // If attaching remote audio, guarantee the dummy sink is active to satisfy Chromium's pipeline
      if (label.includes('remote')) {
        activateRemoteAudioPipeline(stream);
      }

      const source = audioContext.createMediaStreamSource(stream);
      const gainNode = audioContext.createGain();
      // Boost remote receiver audio to 1.5x to ensure loud & clear playback against headphones
      gainNode.gain.value = label.includes('remote') ? 1.5 : 1.0;

      source.connect(gainNode);
      gainNode.connect(mixerDestination);

      attachedSources.set(key, { source, gainNode, trackId });
      logDebug(`🎚️ Connected ${key} to recording mixer (gain: ${gainNode.gain.value}). Total active sources: ${attachedSources.size}`);
    } catch (e) {
      console.warn(`[RecordHub Inpage] Could not attach ${label} audio to mixer:`, e);
    }
  }

  function stopCallRecording() {
    if (recordingMonitorInterval) {
      clearInterval(recordingMonitorInterval);
      recordingMonitorInterval = null;
    }

    if (!isRecordingCall) return;
    isRecordingCall = false;

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try {
        if (typeof mediaRecorder.requestData === 'function') {
          try { mediaRecorder.requestData(); } catch (_) {}
        }
        mediaRecorder.stop();
      } catch (e) {
        console.warn('[RecordHub Inpage] Error stopping mediaRecorder:', e);
        cleanupAudio();
      }
    } else {
      cleanupAudio();
    }
  }

  function cleanupAudio() {
    if (recordingMonitorInterval) {
      clearInterval(recordingMonitorInterval);
      recordingMonitorInterval = null;
    }
    attachedSources.clear();
    mixerDestination = null;
    if (audioContext && audioContext.state !== 'closed') {
      audioContext.close().catch(() => {});
      audioContext = null;
    }
    if (remoteAudioSink) {
      try {
        remoteAudioSink.pause();
        remoteAudioSink.srcObject = null;
      } catch (_) {}
    }
    mediaRecorder = null;
    localAudioStream = null;
    remoteAudioStream = null;
  }

  logDebug('✅ Full WebRTC & WebAudio dual-stream recorder initialized.');
})();
