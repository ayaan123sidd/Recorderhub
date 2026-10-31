/**
 * RecordHub WhatsApp Web Call Tracker - Offscreen Audio Recorder
 * 
 * Runs in an offscreen document (MV3) to capture and record tab audio
 * using Web Audio API and MediaRecorder without interrupting user listening.
 */

let recorder = null;
let recordedChunks = [];
let mediaStream = null;
let audioContext = null;

// Connect port to background so background knows when offscreen closes
const port = chrome.runtime.connect({ name: 'offscreen' });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_RECORDING') {
    startRecording(message.streamId)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'STOP_RECORDING') {
    stopRecording()
      .then((data) => sendResponse({ success: true, audioDataUrl: data.audioDataUrl, size: data.size }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function startRecording(streamId) {
  if (recorder && recorder.state === 'recording') {
    console.warn('[RecordHub Offscreen] Recorder already active');
    return;
  }

  try {
    // 1. Capture media stream from tab
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
      video: false,
    });

    // 2. Play audio back to speakers so user can still hear WhatsApp call!
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(mediaStream);
    source.connect(audioContext.destination);

    // 3. Setup MediaRecorder
    recordedChunks = [];
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    recorder = new MediaRecorder(mediaStream, { mimeType });

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    recorder.start(1000); // 1-second chunks
    console.log('[RecordHub Offscreen] Recording started with mime:', mimeType);
  } catch (err) {
    console.error('[RecordHub Offscreen] Failed to start recording:', err);
    throw err;
  }
}

async function stopRecording() {
  return new Promise((resolve, reject) => {
    if (!recorder || recorder.state === 'inactive') {
      resolve({ audioDataUrl: null, size: 0 });
      return;
    }

    recorder.onstop = async () => {
      try {
        const audioBlob = new Blob(recordedChunks, { type: recorder.mimeType || 'audio/webm' });
        
        // Convert Blob to Base64 Data URL so it can be messaged to background service worker
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64Data = reader.result;
          cleanup();
          resolve({ audioDataUrl: base64Data, size: audioBlob.size });
        };
        reader.onerror = (err) => {
          cleanup();
          reject(err);
        };
        reader.readAsDataURL(audioBlob);
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    try {
      recorder.stop();
    } catch (e) {
      cleanup();
      resolve({ audioDataUrl: null, size: 0 });
    }
  });
}

function cleanup() {
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close().catch(() => {});
    audioContext = null;
  }
  recorder = null;
  recordedChunks = [];
}
