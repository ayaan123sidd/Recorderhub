/**
 * RecordHub WhatsApp Web Call Tracker - Background Service Worker
 * 
 * Handles:
 * - Communication between content script <-> popup <-> backend API
 * - Tab audio capture for WhatsApp Web call recording
 * - Offscreen document management for MediaRecorder
 * - Call data sync to RecordHub backend via batch-sync API
 */

// ─── State ───────────────────────────────────────────────────────────────────
let activeCall = null;        // Currently active call metadata
let lastEndedCall = null;     // Most recent ended call metadata (for audio upload matching)
let pendingAudioBlob = null;  // Temporary storage if audio arrives before CALL_ENDED
let endCallTimer = null;      // Fallback timer to finalize call if audio is missing

// ─── Config Defaults ─────────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  serverUrl: '',
  counselorEmail: '',
  counselorName: '',
  deviceId: 'CHROME-WHATSAPP-WEB',
  autoRecord: true,
  isLoggedIn: false,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getConfig() {
  const result = await chrome.storage.local.get('recordhub_config');
  return { ...DEFAULT_CONFIG, ...(result.recordhub_config || {}) };
}

async function saveConfig(config) {
  await chrome.storage.local.set({ recordhub_config: config });
}

function generateIdempotencyKey(phoneNumber) {
  const now = new Date();
  const ts = now.toISOString().replace(/\D/g, '').slice(0, 14);
  const cleanPhone = (phoneNumber || 'UNKNOWN').replace(/\D/g, '').slice(-10) || 'UNKNOWN';
  return `WA_WEB_${cleanPhone}_${ts}_${Math.random().toString(36).slice(2, 6)}`;
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ─── Call Log Storage ────────────────────────────────────────────────────────

async function getCallLog() {
  const result = await chrome.storage.local.get('recordhub_call_log');
  return result.recordhub_call_log || [];
}

async function addCallToLog(callData) {
  const log = await getCallLog();
  log.unshift(callData);
  // Keep only last 200 calls in local storage
  if (log.length > 200) log.length = 200;
  await chrome.storage.local.set({ recordhub_call_log: log });
}

async function updateCallInLog(idempotencyKey, updates) {
  const log = await getCallLog();
  const idx = log.findIndex(c => c.idempotencyKey === idempotencyKey);
  if (idx !== -1) {
    log[idx] = { ...log[idx], ...updates };
    await chrome.storage.local.set({ recordhub_call_log: log });
  }
}

// ─── Pending Sync Queue ─────────────────────────────────────────────────────

async function getPendingSync() {
  const result = await chrome.storage.local.get('recordhub_pending_sync');
  return result.recordhub_pending_sync || [];
}

async function addToPendingSync(callEvent) {
  if (!callEvent || !callEvent.idempotencyKey) return;
  const pending = await getPendingSync();
  const idx = pending.findIndex((p) => p.idempotencyKey === callEvent.idempotencyKey);
  if (idx !== -1) {
    pending[idx] = { ...pending[idx], ...callEvent };
  } else {
    pending.push(callEvent);
  }
  await chrome.storage.local.set({ recordhub_pending_sync: pending });
}

async function removeFromPendingSync(idempotencyKey) {
  if (!idempotencyKey) return;
  const pending = await getPendingSync();
  const filtered = pending.filter((p) => p.idempotencyKey !== idempotencyKey);
  await chrome.storage.local.set({ recordhub_pending_sync: filtered });
}

async function clearPendingSync() {
  await chrome.storage.local.set({ recordhub_pending_sync: [] });
}

// ─── Backend API Sync ────────────────────────────────────────────────────────

async function syncCallToBackend(callEvent) {
  const config = await getConfig();
  if (!config.serverUrl || !config.counselorEmail) {
    console.warn('[RecordHub] Server URL or counselor email not configured. Queuing for later sync.');
    await addToPendingSync(callEvent);
    return { queued: true };
  }

  try {
    const batchPayload = {
      callEvents: [callEvent],
      completedRecordingIds: [],
      appVersion: 'Chrome-Extension-v1.0.0',
      deviceModel: 'WhatsApp Web (Chrome)',
      androidVersion: navigator.userAgent,
    };

    const response = await fetch(`${config.serverUrl}/api/v1/calls/batch-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batchPayload),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('[RecordHub] Sync failed:', response.status, errBody);
      await addToPendingSync(callEvent);
      return { error: true, status: response.status };
    }

    const result = await response.json();
    console.log('[RecordHub] Call synced successfully:', result);

    // Remove from pending queue since sync succeeded
    if (callEvent.idempotencyKey) {
      await removeFromPendingSync(callEvent.idempotencyKey);
    }

    // If there's a recording to upload and we got presigned URLs, handle it
    if (result.uploadUrls && result.uploadUrls.length > 0) {
      return { synced: true, uploadUrls: result.uploadUrls };
    }

    return { synced: true, result };
  } catch (err) {
    console.error('[RecordHub] Network error during sync:', err);
    await addToPendingSync(callEvent);
    return { error: true, message: err.message };
  }
}

async function syncPendingCalls() {
  const config = await getConfig();
  if (!config.serverUrl || !config.counselorEmail) return;

  const pending = await getPendingSync();
  if (pending.length === 0) return;

  try {
    const sanitizedPending = pending.map((p) => {
      const isAns = (p.durationSeconds && p.durationSeconds > 0) || Boolean(p.endTime);
      return {
        ...p,
        counselorEmail: p.counselorEmail || config.counselorEmail,
        agentName: p.agentName || config.counselorName,
        deviceId: p.deviceId || config.deviceId,
        status: isAns ? 'ANSWERED' : (p.status || 'ANSWERED'),
      };
    });

    const batchPayload = {
      callEvents: sanitizedPending,
      completedRecordingIds: [],
      appVersion: 'Chrome-Extension-v1.0.0',
      deviceModel: 'WhatsApp Web (Chrome)',
      androidVersion: navigator.userAgent,
    };

    const response = await fetch(`${config.serverUrl}/api/v1/calls/batch-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batchPayload),
    });

    if (response.ok) {
      await clearPendingSync();
      console.log(`[RecordHub] Synced ${pending.length} pending calls.`);
    } else {
      // If server returned 400 or other error because older items were invalid, clear to avoid permanent badge lock
      const status = response.status;
      if (status >= 400 && status < 500) {
        console.warn(`[RecordHub] Pending sync rejected with status ${status}. Clearing invalid pending items.`);
        await clearPendingSync();
      }
    }
  } catch (err) {
    console.error('[RecordHub] Failed to sync pending calls:', err);
  }
}

// ─── Audio Recording via Tab Capture ─────────────────────────────────────────

async function startAudioCapture(tabId) {
  const config = await getConfig();
  if (!config.autoRecord) {
    console.log('[RecordHub] Auto-record disabled, skipping audio capture.');
    return;
  }

  try {
    // Use offscreen document for MediaRecorder (MV3 requirement)
    if (!offscreenDocExists) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['USER_MEDIA'],
        justification: 'Recording WhatsApp Web call audio for compliance tracking',
      });
      offscreenDocExists = true;
    }

    // Capture tab audio
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });

    // Send stream ID to offscreen document to start recording
    chrome.runtime.sendMessage({
      type: 'START_RECORDING',
      streamId: streamId,
      tabId: tabId,
    });

    isRecording = true;
    console.log('[RecordHub] Audio capture started for tab:', tabId);
  } catch (err) {
    console.error('[RecordHub] Failed to start audio capture:', err);
    isRecording = false;
  }
}

async function stopAudioCapture() {
  if (!isRecording) return null;

  try {
    // Tell offscreen document to stop recording and return audio data
    const response = await chrome.runtime.sendMessage({
      type: 'STOP_RECORDING',
    });

    isRecording = false;
    console.log('[RecordHub] Audio capture stopped.');

    if (response?.audioDataUrl) {
      const res = await fetch(response.audioDataUrl);
      const blob = await res.blob();
      return blob;
    }
    return response?.audioBlob || null;
  } catch (err) {
    console.error('[RecordHub] Failed to stop audio capture:', err);
    isRecording = false;
    return null;
  }
}

async function uploadRecording(audioBlob, callEvent) {
  const config = await getConfig();
  if (!config.serverUrl || !audioBlob || audioBlob.size === 0) return null;

  try {
    const detectedMime = audioBlob.type || 'audio/webm';
    console.log(`[RecordHub] Initiating upload for ${callEvent.idempotencyKey} (${audioBlob.size} bytes, ${detectedMime})...`);

    // Step 1: Initiate upload to get presigned URL
    const initiateRes = await fetch(`${config.serverUrl}/api/v1/recordings/upload-initiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callId: callEvent.idempotencyKey,
        fileSizeBytes: audioBlob.size,
        mimeType: detectedMime,
        deviceId: config.deviceId,
        counselorEmail: config.counselorEmail,
        agentName: config.counselorName,
      }),
    });

    if (!initiateRes.ok) {
      console.error('[RecordHub] Upload initiate failed:', initiateRes.status);
      return null;
    }

    const { presignedPutUrl, recordingId, s3Key, fallbackUploadUrl } = await initiateRes.json();
    const audioUrl = `/api/v1/recordings/${recordingId}/audio`;

    // Step 2: Upload audio to S3 via presigned URL
    let uploadOk = false;
    try {
      const uploadRes = await fetch(presignedPutUrl, {
        method: 'PUT',
        headers: { 'Content-Type': detectedMime },
        body: audioBlob,
      });

      if (uploadRes.ok) {
        uploadOk = true;
      } else {
        console.warn('[RecordHub] Direct S3 upload returned status:', uploadRes.status);
      }
    } catch (s3Err) {
      console.warn('[RecordHub] Direct S3 upload error, trying fallback:', s3Err);
    }

    // Step 2b: Server fallback if direct S3 PUT failed
    if (!uploadOk && fallbackUploadUrl) {
      try {
        console.log('[RecordHub] Uploading audio via server fallback endpoint...');
        const fbRes = await fetch(fallbackUploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': detectedMime },
          body: audioBlob,
        });
        if (fbRes.ok) {
          uploadOk = true;
          console.log('[RecordHub] Server fallback upload succeeded!');
        }
      } catch (fbErr) {
        console.error('[RecordHub] Server fallback upload error:', fbErr);
      }
    }

    if (!uploadOk) {
      console.error('[RecordHub] Both direct S3 and fallback uploads failed.');
      return null;
    }

    // Step 3: Confirm upload completion
    await fetch(`${config.serverUrl}/api/v1/recordings/upload-complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recordingId: recordingId,
        callId: callEvent.idempotencyKey,
      }),
    });

    console.log('[RecordHub] Recording uploaded successfully to S3:', s3Key);
    return { recordingId, s3Key, audioUrl };
  } catch (err) {
    console.error('[RecordHub] Recording upload error:', err);
    return null;
  }
}

// ─── Post-Call Unified Finalization ──────────────────────────────────────────
// Synchronizes call log & recording using the exact same architecture as Android SIM calls:
// 1. Sends call to batch-sync with hasRecording: true
// 2. Server generates presigned S3 PUT URL and returns it in uploadUrls
// 3. Extension directly PUTs audio recording to S3
// 4. Extension confirms via upload-complete (locking 100% key match between DB and S3)

async function finalizeAndSyncCall(completedCall, audioBlob) {
  if (!completedCall) return;

  const config = await getConfig();

  // If already finalized, do not re-run
  if (completedCall._finalized) {
    return;
  }
  completedCall._finalized = true;

  const durationSec = Math.max(0, completedCall.durationSeconds || 0);
  const finalStatus = durationSec > 0 ? 'ANSWERED' : 'UNANSWERED';
  const hasAudio = Boolean(audioBlob && audioBlob.size > 0 && config.autoRecord);
  const detectedMime = audioBlob?.type || 'audio/webm';

  // 1. Prepare call log payload (Identical to Android SIM call sync)
  const payloadCall = {
    organizationId: config.organizationId || '65c1f0000000000000000001',
    idempotencyKey: completedCall.idempotencyKey,
    phoneNumber: completedCall.phoneNumber,
    leadName: completedCall.leadName || completedCall.phoneNumber || 'Contact',
    direction: completedCall.direction || 'INCOMING',
    status: finalStatus,
    channel: 'WHATSAPP_WEB',
    disposition: 'WhatsApp Web Call',
    startTime: completedCall.startTime,
    endTime: completedCall.endTime || new Date().toISOString(),
    durationSeconds: durationSec,
    deviceId: config.deviceId,
    counselorEmail: config.counselorEmail || completedCall.counselorEmail,
    agentName: config.counselorName || completedCall.agentName,
    isPrivate: false,
    simSlot: 0,
    hasRecording: hasAudio,
    mimeType: detectedMime,
    recordingStatus: hasAudio ? 'PENDING_UPLOAD' : 'NONE',
  };

  console.log(`[RecordHub] 📡 Syncing call ${completedCall.idempotencyKey} (${durationSec}s, hasAudio: ${hasAudio})...`);

  // 2. Post call log to /api/v1/calls/batch-sync (Server generates official S3 presigned PUT URL)
  const syncResult = await syncCallToBackend(payloadCall);

  let finalRecordingStatus = hasAudio ? 'PENDING_UPLOAD' : 'NONE';
  let finalS3Key = null;
  let finalAudioUrl = null;

  // 3. Upload audio directly to S3 via presigned PUT URL (exact same flow as SIM calls)
  if (hasAudio && config.serverUrl) {
    try {
      let uploadInfo = null;

      // Check if batch-sync returned direct uploadUrls
      if (syncResult && syncResult.uploadUrls && syncResult.uploadUrls.length > 0) {
        uploadInfo = syncResult.uploadUrls.find((u) => u.idempotencyKey === completedCall.idempotencyKey) || syncResult.uploadUrls[0];
      }

      // Fallback: If server did not return presigned URL in batch-sync, use upload-initiate
      if (!uploadInfo || !uploadInfo.presignedPutUrl) {
        console.warn('[RecordHub] No direct uploadUrl in batch-sync response. Invoking upload-initiate fallback...');
        uploadInfo = await uploadRecording(audioBlob, completedCall);
        if (uploadInfo) {
          finalRecordingStatus = 'COMPLETED';
          finalS3Key = uploadInfo.s3Key;
          finalAudioUrl = uploadInfo.audioUrl;
        }
      } else {
        console.log(`[RecordHub] 🎙️ Direct 1-Step AWS S3 PUT upload starting for ${completedCall.idempotencyKey} (${audioBlob.size} bytes) -> ${uploadInfo.s3Key}`);

        let uploadOk = false;
        try {
          const putRes = await fetch(uploadInfo.presignedPutUrl, {
            method: 'PUT',
            headers: { 'Content-Type': detectedMime },
            body: audioBlob,
          });

          if (putRes.ok) {
            uploadOk = true;
            console.log(`[RecordHub] ✅ Direct AWS S3 PUT succeeded for ${uploadInfo.s3Key}!`);
          } else {
            console.warn(`[RecordHub] Direct S3 PUT returned ${putRes.status}. Trying fallback URL...`);
          }
        } catch (putErr) {
          console.warn('[RecordHub] Direct S3 PUT network error:', putErr);
        }

        // Server fallback if direct S3 PUT failed
        if (!uploadOk && uploadInfo.fallbackUploadUrl) {
          try {
            const fbRes = await fetch(uploadInfo.fallbackUploadUrl, {
              method: 'PUT',
              headers: { 'Content-Type': detectedMime },
              body: audioBlob,
            });
            if (fbRes.ok) {
              uploadOk = true;
              console.log('[RecordHub] Server fallback upload succeeded!');
            }
          } catch (fbErr) {
            console.error('[RecordHub] Fallback upload error:', fbErr);
          }
        }

        if (uploadOk) {
          // Confirm upload completion to lock COMPLETED status in MongoDB
          console.log(`[RecordHub] 🔒 Locking recording ${uploadInfo.recordingId} into DB via upload-complete...`);
          await fetch(`${config.serverUrl}/api/v1/recordings/${uploadInfo.recordingId}/upload-complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callId: completedCall.idempotencyKey }),
          }).catch(() => {});

          await fetch(`${config.serverUrl}/api/v1/recordings/upload-complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              recordingId: uploadInfo.recordingId,
              callId: completedCall.idempotencyKey,
            }),
          }).catch(() => {});

          finalRecordingStatus = 'COMPLETED';
          finalS3Key = uploadInfo.s3Key;
          finalAudioUrl = uploadInfo.audioUrl || `/api/v1/recordings/${uploadInfo.recordingId}/audio`;
          console.log(`[RecordHub] 🎉 Call recording 100% connected with S3: ${finalS3Key}`);
        } else {
          console.error('[RecordHub] Could not upload audio recording to S3.');
        }
      }
    } catch (err) {
      console.error('[RecordHub] Audio upload exception:', err);
    }
  }

  // 4. Update local call history
  await updateCallInLog(completedCall.idempotencyKey, {
    status: payloadCall.status,
    direction: payloadCall.direction,
    durationSeconds: payloadCall.durationSeconds,
    endTime: payloadCall.endTime,
    recordingStatus: finalRecordingStatus,
    audioUrl: finalAudioUrl,
    s3Key: finalS3Key,
    synced: !syncResult?.error && !syncResult?.queued,
  });

  // 5. Notify extension popup
  chrome.runtime.sendMessage({
    type: 'CALL_STATE_UPDATE',
    call: {
      ...payloadCall,
      recordingStatus: finalRecordingStatus,
      audioUrl: finalAudioUrl,
      s3Key: finalS3Key,
    },
    state: 'ended',
  }).catch(() => {});

  console.log(`[RecordHub] ✅ Call logging & recording finalization complete for ${completedCall.idempotencyKey} (Status: ${finalRecordingStatus}, Audio: ${finalAudioUrl})`);
}

// ─── Message Handling ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        // ── Content Script → Background: Call detected ──
        case 'CALL_STARTED': {
          const config = await getConfig();
          const callData = {
            idempotencyKey: generateIdempotencyKey(message.phoneNumber),
            phoneNumber: message.phoneNumber || 'WhatsApp Contact',
            leadName: message.contactName || message.phoneNumber || 'WhatsApp Contact',
            direction: message.direction || 'INCOMING',
            status: 'IN_PROGRESS',
            channel: 'WHATSAPP_WEB',
            disposition: 'WhatsApp Web Call',
            startTime: message.startTime || new Date().toISOString(),
            durationSeconds: 0,
            deviceId: config.deviceId,
            counselorEmail: config.counselorEmail,
            agentName: config.counselorName,
            isPrivate: false,
            simSlot: 0,
            hasRecording: config.autoRecord,
          };

          activeCall = callData;
          pendingAudioBlob = null;
          if (endCallTimer) {
            clearTimeout(endCallTimer);
            endCallTimer = null;
          }

          await addCallToLog(callData);

          // Notify popup for active call timer (local only, ZERO server traffic)
          chrome.runtime.sendMessage({ type: 'CALL_STATE_UPDATE', call: callData, state: 'active' }).catch(() => {});
          sendResponse({ success: true, callId: callData.idempotencyKey });
          break;
        }

        case 'CALL_STATE_UPDATE': {
          if (activeCall) {
            if (message.contactName && message.contactName !== 'WhatsApp Contact') {
              activeCall.leadName = message.contactName;
            }
            if (message.phoneNumber && message.phoneNumber !== 'WhatsApp Contact') {
              activeCall.phoneNumber = message.phoneNumber;
            }
            if (activeCall.phoneNumber && (!activeCall.leadName || activeCall.leadName === 'WhatsApp Contact')) {
              activeCall.leadName = activeCall.phoneNumber;
            }
            if (activeCall.leadName && (!activeCall.phoneNumber || activeCall.phoneNumber === 'WhatsApp Contact')) {
              activeCall.phoneNumber = activeCall.leadName;
            }
            await updateCallInLog(activeCall.idempotencyKey, {
              leadName: activeCall.leadName,
              phoneNumber: activeCall.phoneNumber,
            });
            chrome.runtime.sendMessage({ type: 'POPUP_CALL_UPDATE', call: activeCall, state: 'active' }).catch(() => {});
          }
          sendResponse({ success: true });
          break;
        }

        case 'CALL_CONNECTED': {
          if (activeCall) {
            activeCall.status = 'IN_PROGRESS';
            if (message.direction) activeCall.direction = message.direction;
            if (message.contactName && message.contactName !== 'WhatsApp Contact') {
              activeCall.leadName = message.contactName;
            }
            if (message.phoneNumber && message.phoneNumber !== 'WhatsApp Contact') {
              activeCall.phoneNumber = message.phoneNumber;
            }
            if (activeCall.phoneNumber && (!activeCall.leadName || activeCall.leadName === 'WhatsApp Contact')) {
              activeCall.leadName = activeCall.phoneNumber;
            }
            if (activeCall.leadName && (!activeCall.phoneNumber || activeCall.phoneNumber === 'WhatsApp Contact')) {
              activeCall.phoneNumber = activeCall.leadName;
            }
            await updateCallInLog(activeCall.idempotencyKey, {
              status: 'IN_PROGRESS',
              leadName: activeCall.leadName,
              phoneNumber: activeCall.phoneNumber,
              direction: activeCall.direction,
            });
            chrome.runtime.sendMessage({ type: 'CALL_STATE_UPDATE', call: activeCall, state: 'active' }).catch(() => {});
          }
          sendResponse({ success: true });
          break;
        }

        case 'CALL_HEARTBEAT': {
          if (activeCall) {
            activeCall.durationSeconds = message.duration || 0;
          }
          sendResponse({ success: true });
          break;
        }

        case 'CALL_DURATION_UPDATE': {
          if (activeCall) {
            activeCall.durationSeconds = message.duration || 0;
          }
          sendResponse({ success: true });
          break;
        }

        case 'CALL_ENDED': {
          if (!activeCall && !lastEndedCall) {
            sendResponse({ success: false, reason: 'No active call' });
            break;
          }

          const target = activeCall || lastEndedCall;
          const endTime = message.endTime ? new Date(message.endTime) : new Date();
          const startTime = new Date(target.startTime);
          const calculatedSec = Math.round((endTime.getTime() - startTime.getTime()) / 1000);
          const finalDuration = Math.max(0, message.duration !== undefined ? message.duration : calculatedSec);
          const finalStatus = message.status || (finalDuration > 0 ? 'ANSWERED' : 'UNANSWERED');

          let resolvedLeadName = (message.contactName && message.contactName !== 'WhatsApp Contact')
            ? message.contactName
            : ((target.leadName && target.leadName !== 'WhatsApp Contact') ? target.leadName : (message.phoneNumber || target.phoneNumber || 'WhatsApp Contact'));

          let resolvedPhoneNumber = (message.phoneNumber && message.phoneNumber !== 'WhatsApp Contact')
            ? message.phoneNumber
            : ((target.phoneNumber && target.phoneNumber !== 'WhatsApp Contact') ? target.phoneNumber : (resolvedLeadName !== 'WhatsApp Contact' ? resolvedLeadName : 'WhatsApp Contact'));

          if (resolvedPhoneNumber !== 'WhatsApp Contact' && resolvedLeadName === 'WhatsApp Contact') {
            resolvedLeadName = resolvedPhoneNumber;
          }
          if (resolvedLeadName !== 'WhatsApp Contact' && resolvedPhoneNumber === 'WhatsApp Contact') {
            resolvedPhoneNumber = resolvedLeadName;
          }

          const completedCall = {
            ...target,
            direction: message.direction || target.direction || 'INCOMING',
            leadName: resolvedLeadName,
            phoneNumber: resolvedPhoneNumber,
            endTime: endTime.toISOString(),
            durationSeconds: finalDuration,
            status: finalStatus,
          };

          lastEndedCall = completedCall;
          activeCall = null;

          await updateCallInLog(completedCall.idempotencyKey, completedCall);
          chrome.runtime.sendMessage({ type: 'CALL_STATE_UPDATE', call: null, state: 'idle' }).catch(() => {});

          if (pendingAudioBlob) {
            console.log(`[RecordHub Background] 🎙️ Audio package was already received for ${completedCall.idempotencyKey}. Finalizing call with audio now...`);
            const blobToUse = pendingAudioBlob;
            pendingAudioBlob = null;
            finalizeAndSyncCall(completedCall, blobToUse);
          } else {
            console.log(`[RecordHub Background] ⏳ Call ended (${completedCall.idempotencyKey}). Waiting up to 10s for audio package before finalizing...`);
            if (endCallTimer) clearTimeout(endCallTimer);
            endCallTimer = setTimeout(() => {
              if (lastEndedCall && lastEndedCall.idempotencyKey === completedCall.idempotencyKey && !completedCall._finalized) {
                console.log('[RecordHub Background] Fallback timeout: audio recording package did not arrive in 10s. Finalizing call without audio...');
                finalizeAndSyncCall(completedCall, null);
              }
            }, 10000);
          }

          sendResponse({ success: true });
          break;
        }

        case 'UPLOAD_RECORDING': {
          const sources = message.attachedSources || [];
          console.log(`[RecordHub Background] 📥 Received in-page audio package for upload. Active sources: [${sources.join(', ')}]`);
          if (message.debugLogs) {
            chrome.storage.local.set({ recordhub_last_call_logs: message.debugLogs }).catch(() => {});
          }
          if (!message.audioDataUrl) {
            sendResponse({ success: false, reason: 'No audio data' });
            break;
          }

          try {
            const res = await fetch(message.audioDataUrl);
            const audioBlob = await res.blob();
            console.log(`[RecordHub Background] 📦 Packaged audio Blob (${audioBlob.size} bytes).`);

            const targetCall = lastEndedCall || activeCall;
            if (targetCall) {
              if (endCallTimer) {
                clearTimeout(endCallTimer);
                endCallTimer = null;
              }
              await finalizeAndSyncCall(targetCall, audioBlob);
            } else {
              console.log('[RecordHub Background] Storing audio Blob in pending queue until CALL_ENDED arrives.');
              pendingAudioBlob = audioBlob;
            }
            sendResponse({ success: true });
          } catch (err) {
            console.error('[RecordHub Background] Error processing audioDataUrl in UPLOAD_RECORDING:', err);
            sendResponse({ success: false, error: err.message });
          }
          break;
        }

        // ── Popup → Background ──
        case 'GET_STATUS': {
          const config = await getConfig();
          const callLog = await getCallLog();
          const pendingCount = (await getPendingSync()).length;
          sendResponse({
            isLoggedIn: config.isLoggedIn,
            counselorEmail: config.counselorEmail,
            counselorName: config.counselorName,
            serverUrl: config.serverUrl,
            autoRecord: config.autoRecord,
            activeCall: activeCall,
            isRecording: Boolean(activeCall),
            recentCalls: callLog.slice(0, 20),
            pendingSyncCount: pendingCount,
          });
          break;
        }

        case 'LOGIN': {
          const { serverUrl, email, password } = message;
          try {
            const res = await fetch(`${serverUrl}/api/v1/auth/login`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, password }),
            });

            if (!res.ok) {
              const errData = await res.json().catch(() => ({ message: 'Login failed' }));
              sendResponse({ success: false, message: errData.message || 'Login failed' });
              break;
            }

            const data = await res.json();
            const config = await getConfig();
            config.serverUrl = serverUrl;
            config.counselorEmail = data.user.email;
            config.counselorName = `${data.user.firstName || ''} ${data.user.lastName || ''}`.trim();
            config.isLoggedIn = true;
            config.deviceId = `CHROME-WAWEB-${data.user.email.split('@')[0].toUpperCase()}`;
            await saveConfig(config);

            // Sync any pending calls
            await syncPendingCalls();

            sendResponse({ success: true, user: data.user });
          } catch (err) {
            sendResponse({ success: false, message: err.message || 'Network error' });
          }
          break;
        }

        case 'LOGOUT': {
          const config = await getConfig();
          config.isLoggedIn = false;
          config.counselorEmail = '';
          config.counselorName = '';
          await saveConfig(config);
          sendResponse({ success: true });
          break;
        }

        case 'UPDATE_SETTINGS': {
          const config = await getConfig();
          if (message.autoRecord !== undefined) config.autoRecord = message.autoRecord;
          if (message.serverUrl) config.serverUrl = message.serverUrl;
          await saveConfig(config);
          sendResponse({ success: true });
          break;
        }

        case 'FORCE_SYNC': {
          await syncPendingCalls();
          await clearPendingSync();
          sendResponse({ success: true, remainingPending: 0 });
          break;
        }

        case 'CLEAR_PENDING': {
          await clearPendingSync();
          sendResponse({ success: true });
          break;
        }

        case 'GET_CALL_LOG': {
          const log = await getCallLog();
          sendResponse({ calls: log });
          break;
        }

        // ── Offscreen Document → Background: Recording data ──
        case 'RECORDING_DATA': {
          // Audio blob received from offscreen document
          if (message.audioBlob && activeCall) {
            await uploadRecording(message.audioBlob, activeCall);
          }
          sendResponse({ success: true });
          break;
        }

        default:
          sendResponse({ error: 'Unknown message type' });
      }
    } catch (err) {
      console.error('[RecordHub] Background message handler error:', err);
      sendResponse({ error: err.message });
    }
  })();

  return true; // Keep the message channel open for async responses
});

// ─── Periodic Sync Alarm ─────────────────────────────────────────────────────

chrome.alarms.create('periodic-sync', { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'periodic-sync') {
    await syncPendingCalls();
  }
});

// ─── Extension Install/Update ────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    console.log('[RecordHub] WhatsApp Web Call Tracker installed.');
    await saveConfig(DEFAULT_CONFIG);
  }
});

// Clean up offscreen doc reference when it closes
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'offscreen') {
    port.onDisconnect.addListener(() => {
      offscreenDocExists = false;
    });
  }
});
