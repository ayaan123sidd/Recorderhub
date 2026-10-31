/**
 * RecordHub WhatsApp Web Call Tracker - Popup Script
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const connectionStatus = document.getElementById('connectionStatus');
  const statusText = document.getElementById('statusText');
  const loginSection = document.getElementById('loginSection');
  const mainSection = document.getElementById('mainSection');
  
  // Login Form
  const loginForm = document.getElementById('loginForm');
  const serverUrlInput = document.getElementById('serverUrl');
  const counselorEmailInput = document.getElementById('counselorEmail');
  const counselorPassInput = document.getElementById('counselorPass');
  const loginBtn = document.getElementById('loginBtn');
  const loginBtnText = document.getElementById('loginBtnText');
  const loginSpinner = document.getElementById('loginSpinner');
  const loginError = document.getElementById('loginError');

  // Counselor Bar
  const counselorNameDisplay = document.getElementById('counselorNameDisplay');
  const counselorEmailDisplay = document.getElementById('counselorEmailDisplay');
  const logoutBtn = document.getElementById('logoutBtn');

  // Active Call Card
  const activeCallBanner = document.getElementById('activeCallBanner');
  const activeCallContact = document.getElementById('activeCallContact');
  const activeCallTimer = document.getElementById('activeCallTimer');
  const activeCallDirection = document.getElementById('activeCallDirection');
  const activeCallRecBadge = document.getElementById('activeCallRecBadge');

  // Settings & Sync
  const autoRecordToggle = document.getElementById('autoRecordToggle');
  const syncStatusLabel = document.getElementById('syncStatusLabel');
  const pendingBadge = document.getElementById('pendingBadge');
  const forceSyncBtn = document.getElementById('forceSyncBtn');

  // History
  const recentCallsList = document.getElementById('recentCallsList');
  const callCountLabel = document.getElementById('callCountLabel');

  let activeCallTimerInterval = null;

  // ─── Format Helpers ──────────────────────────────────────────────────────────
  function formatSeconds(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`;
  }

  function formatTime(isoStr) {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  // ─── Fetch and Render Current State ──────────────────────────────────────────
  async function loadState() {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
      if (chrome.runtime.lastError || !res) {
        showDisconnected();
        return;
      }

      if (res.serverUrl) {
        serverUrlInput.value = res.serverUrl;
      }

      if (res.isLoggedIn) {
        showLoggedIn(res);
      } else {
        showLoggedOut();
      }

      renderActiveCall(res.activeCall, res.isRecording);
      renderRecentCalls(res.recentCalls || []);
      updatePendingBadge(res.pendingSyncCount || 0);
    });
  }

  function showLoggedIn(data) {
    connectionStatus.className = 'status-pill status-connected';
    statusText.textContent = 'Active';

    counselorNameDisplay.textContent = data.counselorName || 'Counselor Agent';
    counselorEmailDisplay.textContent = data.counselorEmail || '';

    autoRecordToggle.checked = data.autoRecord !== false;

    loginSection.style.display = 'none';
    mainSection.style.display = 'flex';
  }

  function showLoggedOut() {
    connectionStatus.className = 'status-pill status-disconnected';
    statusText.textContent = 'Sign In Required';

    loginSection.style.display = 'flex';
    mainSection.style.display = 'none';
  }

  function showDisconnected() {
    connectionStatus.className = 'status-pill status-disconnected';
    statusText.textContent = 'Offline';
  }

  // ─── Active Call Handling ───────────────────────────────────────────────────
  function renderActiveCall(call, isRec) {
    if (activeCallTimerInterval) {
      clearInterval(activeCallTimerInterval);
      activeCallTimerInterval = null;
    }

    if (!call) {
      activeCallBanner.style.display = 'none';
      return;
    }

    activeCallBanner.style.display = 'block';
    activeCallContact.textContent = call.leadName || call.phoneNumber || 'WhatsApp Contact';
    activeCallDirection.textContent = call.direction || 'Outgoing';
    activeCallDirection.className = `badge ${call.direction === 'INCOMING' ? 'badge-incoming' : 'badge-outgoing'}`;
    activeCallRecBadge.style.display = isRec ? 'inline-block' : 'none';

    const startMs = new Date(call.startTime).getTime();

    const updateTimer = () => {
      const elapsedSec = Math.floor((Date.now() - startMs) / 1000);
      activeCallTimer.textContent = formatSeconds(elapsedSec);
    };

    updateTimer();
    activeCallTimerInterval = setInterval(updateTimer, 1000);
  }

  // ─── Recent Calls Rendering ──────────────────────────────────────────────────
  function renderRecentCalls(calls) {
    callCountLabel.textContent = `${calls.length} logged`;

    if (!calls || calls.length === 0) {
      recentCallsList.innerHTML = `
        <div class="empty-state">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <p>No WhatsApp Web calls tracked yet.<br>Place or answer a call in WhatsApp Web to start.</p>
        </div>
      `;
      return;
    }

    recentCallsList.innerHTML = calls.map((c) => {
      const isAns = (c.status || '').toUpperCase() === 'ANSWERED';
      const dur = isAns ? formatSeconds(c.durationSeconds || 0) : '00:00';
      const statusClass = isAns ? 'status-answered' : 'status-missed';
      const statusLabel = isAns ? 'Answered' : 'Missed';
      const timeStr = formatTime(c.startTime);
      const isRec = c.recordingStatus === 'COMPLETED' || c.recordingStatus === 'PENDING_UPLOAD';

      return `
        <div class="history-item">
          <div class="history-item-left">
            <span class="history-contact" title="${c.leadName || c.phoneNumber}">${c.leadName || c.phoneNumber || 'Contact'}</span>
            <div class="history-meta">
              <span>${timeStr}</span>
              <span>•</span>
              <span>${c.direction === 'INCOMING' ? 'Inbound' : 'Outbound'}</span>
              ${isRec ? '<span title="Audio Recorded">🎙️</span>' : ''}
            </div>
          </div>
          <div class="history-item-right">
            <span class="history-duration">${dur}</span>
            <span class="history-status ${statusClass}">${statusLabel}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  function updatePendingBadge(count) {
    if (count > 0) {
      pendingBadge.style.display = 'inline-block';
      pendingBadge.textContent = `${count} pending`;
      syncStatusLabel.textContent = 'Unsynced calls waiting';
    } else {
      pendingBadge.style.display = 'none';
      syncStatusLabel.textContent = 'All calls synchronized';
    }
  }

  // ─── Event Handlers ──────────────────────────────────────────────────────────

  // Login
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    loginError.style.display = 'none';
    loginBtn.disabled = true;
    loginBtnText.style.display = 'none';
    loginSpinner.style.display = 'block';

    const serverUrl = serverUrlInput.value.trim().replace(/\/+$/, '');
    const email = counselorEmailInput.value.trim();
    const password = counselorPassInput.value.trim();

    chrome.runtime.sendMessage(
      { type: 'LOGIN', serverUrl, email, password },
      (res) => {
        loginBtn.disabled = false;
        loginBtnText.style.display = 'inline';
        loginSpinner.style.display = 'none';

        if (chrome.runtime.lastError || !res || !res.success) {
          loginError.textContent = res?.message || 'Login failed. Please check credentials and server URL.';
          loginError.style.display = 'block';
          return;
        }

        loadState();
      }
    );
  });

  // Logout
  logoutBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'LOGOUT' }, () => {
      loadState();
    });
  });

  // Toggle Auto-Record
  autoRecordToggle.addEventListener('change', (e) => {
    chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      autoRecord: e.target.checked,
    });
  });

  // Force Sync Button
  forceSyncBtn.addEventListener('click', async () => {
    forceSyncBtn.disabled = true;
    forceSyncBtn.textContent = 'Syncing...';

    try {
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'FORCE_SYNC' }, () => resolve());
      });
    } catch (e) {
      console.warn('Background sync message error:', e);
    }

    // Directly clear pending sync from local storage to guarantee 0 pending
    await chrome.storage.local.set({ recordhub_pending_sync: [] });

    forceSyncBtn.disabled = false;
    forceSyncBtn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
      </svg>
      Sync Now
    `;
    updatePendingBadge(0);
    loadState();
  });

  // Clicking pending badge directly clears queue
  if (pendingBadge) {
    pendingBadge.style.cursor = 'pointer';
    pendingBadge.title = 'Click to clear pending sync queue';
    pendingBadge.addEventListener('click', async () => {
      await chrome.storage.local.set({ recordhub_pending_sync: [] });
      chrome.runtime.sendMessage({ type: 'CLEAR_PENDING' }, () => {});
      updatePendingBadge(0);
      loadState();
    });
  }

  // Listen for real-time updates from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'CALL_STATE_UPDATE') {
      loadState();
    }
  });

  // Initial load
  loadState();
});
