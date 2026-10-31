/**
 * RecordHub WhatsApp Web Call Tracker - Content Script
 * 
 * Monitors WhatsApp Web calls with multi-layered detection:
 * 1. WebRTC RTCPeerConnection events & SDP inspection from inpage.js (primary)
 * 2. Active Call Banner & Incoming Call Modal text extraction (sub-second phone capture)
 * 3. DOM MutationObserver & button click intercepts
 * 4. Page unload handler to guarantee call end events are never lost
 * 
 * Per requirement: Completely silent during active calls (zero server load).
 * Comprehensive call log + mixed two-way audio recording uploaded only AFTER call has ended!
 */

(function () {
  'use strict';

  // Inject inpage.js into the DOM to guarantee WebRTC audio capture runs in the page context
  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inpage.js');
    (document.head || document.documentElement).appendChild(script);
    console.log('[RecordHub Content] Injected inpage.js WebRTC audio recorder into DOM.');
  } catch (injectErr) {
    console.warn('[RecordHub Content] Inpage injection note:', injectErr);
  }

  // ─── State ─────────────────────────────────────────────────────────────────
  let currentCallState = 'idle'; // 'idle' | 'calling' | 'connected' | 'ended'
  let callStartTime = null;
  let callConnectedTime = null;
  let callContactName = '';
  let callPhoneNumber = '';
  let callDirection = null; // null | 'INCOMING' | 'OUTGOING'
  let userInitiatedOutgoingAt = 0; // Timestamp of when user clicked Make Call button
  let durationInterval = null;
  let currentDuration = 0;
  let lastCallEndTime = 0;

  // ─── Selectors ─────────────────────────────────────────────────────────────
  const SELECTORS = {
    callButtons: [
      '[data-testid="audio-call"]',
      '[data-testid="video-call"]',
      'button[aria-label*="Audio call" i]',
      'button[aria-label*="Voice call" i]',
      'button[aria-label*="Video call" i]',
      'span[data-icon="audio-call"]',
      'span[data-icon="video-call"]',
    ],
    endCallButtons: [
      '[data-testid="end-call-btn"]',
      '[data-testid*="call-cancel"]',
      '[data-testid*="end-call"]',
      '[data-testid="hangup"]',
      'button[aria-label*="End call" i]',
      'button[aria-label*="Hang up" i]',
      'button[aria-label*="Decline" i]',
      'button[aria-label*="Leave call" i]',
      'div[role="button"][aria-label*="End call" i]',
      'div[role="button"][aria-label*="Hang up" i]',
      'div[role="button"][aria-label*="Decline" i]',
      'span[data-icon="hangup"]',
      'span[data-icon="call-cancel"]',
      'span[data-icon="call-end"]',
      'span[data-icon*="decline"]',
    ],
    acceptCallButtons: [
      '[data-testid="accept-call-btn"]',
      '[data-testid*="call-accept"]',
      '[data-testid*="accept-call"]',
      'button[aria-label*="Accept" i]',
      'button[aria-label*="Answer" i]',
      'div[role="button"][aria-label*="Accept" i]',
      'div[role="button"][aria-label*="Answer" i]',
      'span[data-icon*="accept"]',
      'span[data-icon*="answer"]',
      'span[data-icon="phone-call"]',
    ],
    chatHeaderTitle: [
      '#main header [data-testid="conversation-info-header-chat-title"]',
      '#main header span[dir="auto"]',
      '#main header span[title]',
      '#main header ._21nHd span[dir="auto"]',
      '#main header h2',
    ],
  };

  // ─── Contact Extraction ───────────────────────────────────────────────────

  function isCallStatusText(str) {
    if (!str) return true;
    const s = str.trim().toLowerCase();
    if (s.length < 2) return true;

    // Timers: e.g. 00:00, 01:23, 1:23:45
    if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(s)) return true;

    const STATUS_WORDS = [
      'incoming', 'incoming call', 'incoming voice call', 'incoming video call',
      'outgoing', 'outgoing call',
      'voice call', 'video call', 'audio call', 'whatsapp call', 'call',
      'calling', 'calling...', 'ringing', 'ringing...', 'connecting', 'connecting...',
      'connected', 'call ended', 'ended', 'on hold',
      'accept', 'decline', 'answer', 'reject', 'end call', 'hang up', 'leave call',
      'mute', 'unmute', 'turn off mic', 'turn on mic',
      'recordhub', 'recordhub live', 'whatsapp', 'whatsapp web',
      'no recording', 'syncing', 'tap to return to call',
      // WhatsApp Web tab & navigation filters to ignore:
      'all', 'unread', 'favourites', 'favorites', 'groups', 'communities',
      'status', 'channels', 'chats', 'menu', 'new chat', 'search', 'search or start new chat',
      'archived', 'starred messages', 'settings', 'profile', 'log out',
    ];

    if (STATUS_WORDS.includes(s)) return true;
    if (s.startsWith('incoming ') || s.startsWith('calling') || s.startsWith('ringing')) return true;

    return false;
  }

  function cleanContactName(name) {
    if (!name) return '';
    const trimmed = name.trim();
    if (isCallStatusText(trimmed)) return '';
    return trimmed;
  }

  /**
   * Traverse upwards from call action buttons (Accept, End, Hangup, Phone icon)
   * to find the enclosing floating call card, banner, or dialog.
   * STRICT: NEVER inspects #main (the open chat) or #side (contacts list).
   */
  function getCallBannerContainer() {
    const allActionSelectors = [
      ...SELECTORS.acceptCallButtons,
      ...SELECTORS.endCallButtons,
    ];

    for (const selector of allActionSelectors) {
      const els = document.querySelectorAll(selector);
      for (const el of els) {
        if (!el) continue;
        // Strictly reject any buttons inside the open chat (#main) or contacts list (#side)
        if (el.closest('#main') || el.closest('#side')) continue;

        let parent = el.parentElement;
        let bestContainer = null;
        let depth = 0;
        while (parent && depth < 10 && parent !== document.body && parent !== document.documentElement) {
          if (parent.id === 'main' || parent.id === 'side') break;
          const text = (parent.innerText || parent.textContent || '').trim();
          if (text.length > 3) {
            bestContainer = parent;
            const style = window.getComputedStyle ? window.getComputedStyle(parent) : null;
            if (style && (style.position === 'fixed' || style.position === 'absolute' || parseInt(style.zIndex, 10) > 0)) {
              return parent;
            }
          }
          parent = parent.parentElement;
          depth++;
        }
        if (bestContainer) return bestContainer;
      }
    }
    return null;
  }

  /**
   * Extract phone number and contact name from a specific container DOM subtree.
   * STRICT: Aborts immediately if container is within #main or #side.
   */
  function extractContactFromCallContainer(container) {
    if (!container) return null;
    if (container.closest && (container.closest('#main') || container.closest('#side'))) return null;
    if (container.id === 'main' || container.id === 'side') return null;

    let detectedPhone = '';
    let detectedName = '';

    // 1. Check title attributes
    const titleEls = container.querySelectorAll('[title]');
    for (const tEl of titleEls) {
      const titleVal = (tEl.getAttribute('title') || '').trim();
      if (!titleVal || isCallStatusText(titleVal)) continue;

      const digits = titleVal.replace(/\D/g, '');
      if (digits.length >= 10 && digits.length <= 15) {
        if (!detectedPhone) detectedPhone = titleVal;
      } else if (!detectedName && titleVal.length >= 2 && titleVal.length <= 60) {
        detectedName = titleVal;
      }
    }

    // 2. Scan text lines in container
    const rawText = container.innerText || container.textContent || '';
    const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);

    for (const line of lines) {
      if (isCallStatusText(line)) continue;

      // Check for phone number pattern e.g. +91 761 766 6344, 9876543210, +1 555-1234
      const phoneMatch = line.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,5}\)?[-.\s]?\d{3,5}[-.\s]?\d{3,5}/);
      if (phoneMatch) {
        const digits = phoneMatch[0].replace(/\D/g, '');
        if (digits.length >= 10 && digits.length <= 15) {
          if (!detectedPhone) detectedPhone = line;
        }
      }

      if (!detectedName && line.length >= 2 && line.length <= 60 && !isCallStatusText(line)) {
        detectedName = line;
      }
    }

    // 3. Scan dir="auto" elements (WhatsApp Web standard for contact names)
    const autoEls = container.querySelectorAll('[dir="auto"], span, h1, h2, h3, div');
    for (const aEl of autoEls) {
      const txt = (aEl.textContent || '').trim();
      if (!txt || isCallStatusText(txt)) continue;

      const digits = txt.replace(/\D/g, '');
      if (digits.length >= 10 && digits.length <= 15) {
        if (!detectedPhone) detectedPhone = txt;
      } else if (!detectedName && txt.length >= 2 && txt.length <= 50) {
        detectedName = txt;
      }
    }

    if (detectedPhone || detectedName) {
      return {
        contactName: detectedName || detectedPhone || 'WhatsApp Contact',
        phoneNumber: detectedPhone || detectedName || 'WhatsApp Contact',
      };
    }

    return null;
  }

  /**
   * Specifically extracts caller info for an INCOMING call.
   * NEVER reads #main (open chat) or #side (contacts sidebar).
   */
  function getIncomingCallContactInfo() {
    let detectedName = '';
    let detectedPhone = '';

    // 1. PRIORITY 1: Inspect incoming/active call banner/card container directly
    const bannerContainer = getCallBannerContainer();
    if (bannerContainer) {
      const bannerContact = extractContactFromCallContainer(bannerContainer);
      if (bannerContact) {
        if (bannerContact.phoneNumber && bannerContact.phoneNumber !== 'WhatsApp Contact' && !isCallStatusText(bannerContact.phoneNumber)) {
          detectedPhone = bannerContact.phoneNumber;
        }
        if (bannerContact.contactName && bannerContact.contactName !== 'WhatsApp Contact' && !isCallStatusText(bannerContact.contactName)) {
          detectedName = bannerContact.contactName;
        }
      }
    }

    // 2. PRIORITY 2: Floating dialogs / modals / portal overlays (EXCLUDING #main and #side)
    if (!detectedName || !detectedPhone) {
      const modals = document.querySelectorAll('[role="alertdialog"], [role="dialog"], div[tabindex="-1"], div[style*="z-index"]');
      for (const modal of modals) {
        if (modal.closest('#main') || modal.closest('#side')) continue; // Strictly ignore open background chat & sidebar
        const contact = extractContactFromCallContainer(modal);
        if (contact) {
          if (!detectedPhone && contact.phoneNumber && contact.phoneNumber !== 'WhatsApp Contact' && !isCallStatusText(contact.phoneNumber)) {
            detectedPhone = contact.phoneNumber;
          }
          if (!detectedName && contact.contactName && contact.contactName !== 'WhatsApp Contact' && !isCallStatusText(contact.contactName)) {
            detectedName = contact.contactName;
          }
        }
        if (detectedName && detectedPhone) break;
      }
    }

    // 3. PRIORITY 3: Document Title (ONLY if title explicitly mentions an incoming call / ringing!)
    if (document.title && /(?:call|ringing)/i.test(document.title)) {
      const title = document.title;
      const phoneMatch = title.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,5}\)?[-.\s]?\d{3,5}[-.\s]?\d{3,5}/);
      if (phoneMatch) {
        const digits = phoneMatch[0].replace(/\D/g, '');
        if (digits.length >= 10 && digits.length <= 15) {
          if (!detectedPhone) detectedPhone = phoneMatch[0].trim();
        }
      }
      const nameMatch = title.match(/(?:call from|incoming call from)\s+([^•\-|()]+)/i);
      if (nameMatch && nameMatch[1]) {
        const candidate = cleanContactName(nameMatch[1]);
        if (candidate && !isCallStatusText(candidate)) {
          if (!detectedName) detectedName = candidate;
        }
      }
    }

    if (detectedPhone || detectedName) {
      return {
        contactName: detectedName || detectedPhone || 'Incoming Call',
        phoneNumber: detectedPhone || detectedName || 'WhatsApp Contact',
      };
    }

    return null;
  }

  function getActiveContactInfo(direction = callDirection) {
    // For INCOMING calls, NEVER inspect #main header!
    if (direction === 'INCOMING') {
      const incoming = getIncomingCallContactInfo();
      if (incoming) return incoming;
      return {
        contactName: 'Incoming Call',
        phoneNumber: 'WhatsApp Contact',
      };
    }

    // For OUTGOING calls:
    // 1. Inspect call banner/container if active
    const bannerContainer = getCallBannerContainer();
    if (bannerContainer) {
      const bannerContact = extractContactFromCallContainer(bannerContainer);
      if (bannerContact && bannerContact.phoneNumber !== 'WhatsApp Contact') {
        return bannerContact;
      }
    }

    // 2. Look in active chat header (#main header)
    let headerName = '';
    let headerPhone = '';

    for (const sel of SELECTORS.chatHeaderTitle) {
      const el = document.querySelector(sel);
      if (el) {
        const candidate = cleanContactName(el.getAttribute('title') || el.textContent || '');
        if (candidate) {
          headerName = candidate;
          break;
        }
      }
    }

    if (headerName) {
      const cleanDigits = headerName.replace(/\D/g, '');
      if (cleanDigits.length >= 10 && cleanDigits.length <= 15) {
        headerPhone = headerName;
      }
    }

    const headerEl = document.querySelector('#main header') || document.querySelector('header');
    if (headerEl) {
      const text = headerEl.innerText || headerEl.textContent || '';
      const phoneMatch = text.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,5}\)?[-.\s]?\d{3,5}[-.\s]?\d{3,5}/);
      if (phoneMatch) {
        const digits = phoneMatch[0].replace(/\D/g, '');
        if (digits.length >= 10 && digits.length <= 15) {
          headerPhone = phoneMatch[0].trim();
        }
      }
    }

    if (headerPhone || headerName) {
      return {
        contactName: headerName || headerPhone || 'WhatsApp Contact',
        phoneNumber: headerPhone || headerName || 'WhatsApp Contact',
      };
    }

    return {
      contactName: 'WhatsApp Contact',
      phoneNumber: 'WhatsApp Contact',
    };
  }

  function detectCallDirection() {
    // 1. If user recently clicked the Make Call button in the chat header, it is 100% OUTGOING
    if (Date.now() - userInitiatedOutgoingAt < 6000) {
      return 'OUTGOING';
    }

    // 2. If any Accept call button is present anywhere in the DOM (outside #main and #side), it is 100% INCOMING
    for (const sel of SELECTORS.acceptCallButtons) {
      const btns = document.querySelectorAll(sel);
      for (const btn of btns) {
        if (!btn.closest('#main') && !btn.closest('#side')) {
          return 'INCOMING';
        }
      }
    }

    // 3. Check modal, dialog, or floating banner text outside #main
    const modal = getCallBannerContainer();
    if (modal) {
      const txt = (modal.textContent || '').toLowerCase();
      if (txt.includes('incoming') || txt.includes('call from') || txt.includes('ringing')) {
        return 'INCOMING';
      }
    }

    // 4. If callDirection was already set
    if (callDirection) {
      return callDirection;
    }

    // 5. Default: If an RTCPeerConnection initializes and user didn't click Make Call, it is INCOMING!
    return 'INCOMING';
  }

  // ─── Call Lifecycle ────────────────────────────────────────────────────────

  function onCallStart(direction) {
    if (Date.now() - lastCallEndTime < 3500) return;
    if (currentCallState === 'calling' || currentCallState === 'connected') return;

    callDirection = direction || detectCallDirection();
    const contact = getActiveContactInfo(callDirection);
    callContactName = contact.contactName;
    callPhoneNumber = contact.phoneNumber;
    currentCallState = 'calling';
    callStartTime = new Date();
    callConnectedTime = null;
    currentDuration = 0;

    console.log(`[RecordHub] 📞 WhatsApp call initiated: ${callContactName} (${callPhoneNumber}) [${callDirection}]`);

    // Notify background locally
    chrome.runtime.sendMessage({
      type: 'CALL_STARTED',
      contactName: callContactName,
      phoneNumber: callPhoneNumber,
      direction: callDirection,
      status: 'IN_PROGRESS',
      startTime: callStartTime.toISOString(),
    }).catch(() => {});

    showCallIndicator('Calling...');
  }

  function onCallConnected() {
    if (currentCallState === 'connected') return;

    currentCallState = 'connected';
    callConnectedTime = new Date();

    // Preserve INCOMING if previously detected
    if (!callDirection || (callDirection === 'OUTGOING' && Date.now() - userInitiatedOutgoingAt > 6000)) {
      callDirection = detectCallDirection();
    }

    // Re-resolve contact name
    if (callDirection === 'INCOMING') {
      const incoming = getIncomingCallContactInfo();
      if (incoming) {
        if (incoming.contactName && incoming.contactName !== 'Incoming Call' && incoming.contactName !== 'WhatsApp Contact') {
          callContactName = incoming.contactName;
        }
        if (incoming.phoneNumber && incoming.phoneNumber !== 'WhatsApp Contact') {
          callPhoneNumber = incoming.phoneNumber;
        }
      }
    } else {
      if (!callPhoneNumber || callPhoneNumber === 'WhatsApp Contact' || !callContactName || callContactName === 'WhatsApp Contact') {
        const refreshed = getActiveContactInfo('OUTGOING');
        if (refreshed.phoneNumber && refreshed.phoneNumber !== 'WhatsApp Contact') {
          callPhoneNumber = refreshed.phoneNumber;
          callContactName = refreshed.contactName || refreshed.phoneNumber;
        }
      }
    }

    console.log(`[RecordHub] 🟢 WhatsApp call connected: ${callContactName} (${callPhoneNumber}) [${callDirection}]`);

    chrome.runtime.sendMessage({
      type: 'CALL_CONNECTED',
      contactName: callContactName,
      phoneNumber: callPhoneNumber,
      direction: callDirection,
      status: 'IN_PROGRESS',
    }).catch(() => {});

    startDurationTracking();
  }

  function onCallEnd(force = false) {
    if (currentCallState === 'idle') return;
    if (currentCallState === 'ended') return;

    const endTime = new Date();
    console.log('[RecordHub Content] 📵 onCallEnd invoked. Finalizing call state...');

    // Signal inpage WebRTC recorder to stop immediately and package audio
    window.postMessage({ type: 'RECORDHUB_STOP_RECORDING' }, '*');

    // Final check for contact info before finalizing log
    if (callDirection === 'INCOMING') {
      const incoming = getIncomingCallContactInfo();
      if (incoming) {
        if (incoming.contactName && incoming.contactName !== 'Incoming Call' && (!callContactName || callContactName === 'Incoming Call' || callContactName === 'WhatsApp Contact')) {
          callContactName = incoming.contactName;
        }
        if (incoming.phoneNumber && incoming.phoneNumber !== 'WhatsApp Contact' && (!callPhoneNumber || callPhoneNumber === 'WhatsApp Contact')) {
          callPhoneNumber = incoming.phoneNumber;
        }
      }
    } else {
      if (!callPhoneNumber || callPhoneNumber === 'WhatsApp Contact' || !callContactName || callContactName === 'WhatsApp Contact') {
        const refreshed = getActiveContactInfo('OUTGOING');
        if (refreshed.phoneNumber && refreshed.phoneNumber !== 'WhatsApp Contact') {
          callPhoneNumber = refreshed.phoneNumber;
          callContactName = refreshed.contactName || refreshed.phoneNumber;
        }
      }
    }

    // Ensure phone number and contact name synchronize
    if ((!callPhoneNumber || callPhoneNumber === 'WhatsApp Contact') && callContactName && callContactName !== 'WhatsApp Contact' && callContactName !== 'Incoming Call') {
      callPhoneNumber = callContactName;
    }
    if ((!callContactName || callContactName === 'WhatsApp Contact' || callContactName === 'Incoming Call') && callPhoneNumber && callPhoneNumber !== 'WhatsApp Contact') {
      callContactName = callPhoneNumber;
    }

    const talkDuration = callConnectedTime
      ? Math.max(0, Math.round((endTime.getTime() - callConnectedTime.getTime()) / 1000))
      : 0;

    const totalDuration = callStartTime
      ? Math.max(0, Math.round((endTime.getTime() - callStartTime.getTime()) / 1000))
      : 0;

    // For answered calls, talkDuration represents actual conversation length.
    const finalDuration = callConnectedTime
      ? Math.max(currentDuration, talkDuration)
      : (callDirection === 'OUTGOING' ? Math.max(currentDuration, totalDuration) : 0);

    console.log(`[RecordHub] 📵 WhatsApp call ended: ${callContactName} (${callPhoneNumber}) [${callDirection}] • Talk time: ${finalDuration}s`);

    currentCallState = 'ended';
    lastCallEndTime = Date.now();

    stopDurationTracking();
    hideCallIndicator();

    // Immediately send final call record to background for post-call cloud logging
    chrome.runtime.sendMessage({
      type: 'CALL_ENDED',
      contactName: callContactName,
      phoneNumber: callPhoneNumber,
      direction: callDirection,
      duration: finalDuration,
      status: finalDuration > 0 ? 'ANSWERED' : 'UNANSWERED',
      endTime: endTime.toISOString(),
    }).catch(() => {});

    setTimeout(() => {
      currentCallState = 'idle';
      callStartTime = null;
      callConnectedTime = null;
      callContactName = '';
      callPhoneNumber = '';
      currentDuration = 0;
      callDirection = null;
    }, 2000);
  }

  // ─── Real-Time Duration Display & Contact Polling ──────────────────────────

  let callUiMissingTicks = 0;

  function startDurationTracking() {
    stopDurationTracking();
    callUiMissingTicks = 0;
    durationInterval = setInterval(() => {
      if (callConnectedTime) {
        currentDuration = Math.round((Date.now() - callConnectedTime.getTime()) / 1000);
      } else if (callStartTime) {
        currentDuration = Math.round((Date.now() - callStartTime.getTime()) / 1000);
      }
      updateCallIndicator(currentDuration);

      // Watchdog: If call is in ringing state ('calling') and has been ringing for > 4s,
      // check if the incoming/outgoing call UI has disappeared.
      // If it disappeared while still in 'calling' state, the call was cancelled/declined/missed.
      // NOTE: Once the call is 'connected', WebRTC peer connection lifecycle (or clicking End Call)
      // is the authoritative source of truth. Never prematurely terminate a connected call via DOM ticks!
      if (currentCallState === 'calling') {
        const elapsed = callStartTime ? (Date.now() - callStartTime.getTime()) : 0;
        if (elapsed > 4000) {
          const hasCallBanner = Boolean(getCallBannerContainer());
          let hasEndBtn = false;
          for (const sel of SELECTORS.endCallButtons) {
            const els = document.querySelectorAll(sel);
            for (const el of els) {
              if (!el.closest('#main') && !el.closest('#side')) {
                hasEndBtn = true;
                break;
              }
            }
            if (hasEndBtn) break;
          }

          if (!hasCallBanner && !hasEndBtn) {
            callUiMissingTicks++;
            if (callUiMissingTicks >= 4) {
              console.log('[RecordHub] 📵 Ringing call UI disappeared without connection. Call declined/cancelled.');
              onCallEnd(true);
              return;
            }
          } else {
            callUiMissingTicks = 0;
          }
        }
      } else {
        callUiMissingTicks = 0;
      }

      // Continuously poll for contact info during call
      if (callDirection === 'INCOMING') {
        const incoming = getIncomingCallContactInfo();
        if (incoming) {
          let updated = false;
          if (incoming.contactName && incoming.contactName !== 'Incoming Call' && incoming.contactName !== 'WhatsApp Contact' && callContactName !== incoming.contactName) {
            callContactName = incoming.contactName;
            updated = true;
          }
          if (incoming.phoneNumber && incoming.phoneNumber !== 'WhatsApp Contact' && (!callPhoneNumber || callPhoneNumber === 'WhatsApp Contact')) {
            callPhoneNumber = incoming.phoneNumber;
            updated = true;
          }
          if (updated) {
            console.log(`[RecordHub] 🎯 Resolved incoming caller (${currentDuration}s): ${callContactName} (${callPhoneNumber})`);
            chrome.runtime.sendMessage({
              type: 'CALL_STATE_UPDATE',
              contactName: callContactName,
              phoneNumber: callPhoneNumber,
            }).catch(() => {});

            const contactEl = document.querySelector('#recordhub-call-indicator .recordhub-indicator-contact');
            if (contactEl) contactEl.textContent = callContactName;
          }
        }
      } else {
        if (!callPhoneNumber || callPhoneNumber === 'WhatsApp Contact' || !callContactName || callContactName === 'WhatsApp Contact') {
          const refreshed = getActiveContactInfo('OUTGOING');
          if (refreshed.phoneNumber && refreshed.phoneNumber !== 'WhatsApp Contact') {
            callPhoneNumber = refreshed.phoneNumber;
            callContactName = refreshed.contactName || refreshed.phoneNumber;
            console.log(`[RecordHub] 🎯 Resolved outgoing contact info during call (${currentDuration}s): ${callContactName} (${callPhoneNumber})`);
            chrome.runtime.sendMessage({
              type: 'CALL_STATE_UPDATE',
              contactName: callContactName,
              phoneNumber: callPhoneNumber,
            }).catch(() => {});

            const contactEl = document.querySelector('#recordhub-call-indicator .recordhub-indicator-contact');
            if (contactEl) contactEl.textContent = callContactName;
          }
        }
      }
    }, 1000);
  }

  function stopDurationTracking() {
    callUiMissingTicks = 0;
    if (durationInterval) {
      clearInterval(durationInterval);
      durationInterval = null;
    }
  }

  // ─── Listen for WebRTC Messages from inpage.js ──────────────────────────────

  window.addEventListener('message', (event) => {
    if (!event.data || typeof event.data.type !== 'string') return;

    switch (event.data.type) {
      case 'RECORDHUB_CALL_DIRECTION_DETECTED': {
        const detectedDir = event.data.direction;
        if (detectedDir === 'INCOMING' && callDirection !== 'INCOMING') {
          console.log('[RecordHub Content] 📡 Verified INCOMING call direction from WebRTC layer.');
          callDirection = 'INCOMING';
          // Purge any misattributed contact info from background chat (#main)
          callContactName = 'Incoming Call';
          callPhoneNumber = 'WhatsApp Contact';
          const incoming = getIncomingCallContactInfo();
          if (incoming) {
            if (incoming.contactName && incoming.contactName !== 'Incoming Call') callContactName = incoming.contactName;
            if (incoming.phoneNumber && incoming.phoneNumber !== 'WhatsApp Contact') callPhoneNumber = incoming.phoneNumber;
          }
          chrome.runtime.sendMessage({
            type: 'CALL_STATE_UPDATE',
            contactName: callContactName,
            phoneNumber: callPhoneNumber,
            direction: 'INCOMING',
          }).catch(() => {});
          const contactEl = document.querySelector('#recordhub-call-indicator .recordhub-indicator-contact');
          if (contactEl) contactEl.textContent = callContactName;
        } else if (detectedDir === 'OUTGOING') {
          callDirection = 'OUTGOING';
        }
        break;
      }

      case 'RECORDHUB_WA_CALL_INIT': {
        const isOutgoing = (Date.now() - userInitiatedOutgoingAt < 6000);
        const direction = isOutgoing ? 'OUTGOING' : detectCallDirection();
        onCallStart(direction);
        break;
      }

      case 'RECORDHUB_WA_CALL_CONNECTED':
        onCallConnected();
        break;

      case 'RECORDHUB_WA_CALL_TERMINATED':
        console.log('[RecordHub Content] 📵 Received RECORDHUB_WA_CALL_TERMINATED from inpage WebRTC.');
        onCallEnd(true);
        break;

      case 'RECORDHUB_PHONE_DETECTED':
        if (event.data.phoneNumber) {
          console.log('[RecordHub Content] 📡 Received phone number from inpage SDP:', event.data.phoneNumber, event.data.source);
          const detectedPhone = event.data.phoneNumber;

          if (callDirection === 'INCOMING') {
            // Never use local description during incoming calls (that's the counselor's own number)
            if (event.data.source === 'local') {
              console.log('[RecordHub Content] Ignoring local SDP phone number during incoming call:', detectedPhone);
              break;
            }

            callPhoneNumber = detectedPhone;
            if (!callContactName || callContactName === 'WhatsApp Contact' || callContactName === 'Incoming Call' || isCallStatusText(callContactName)) {
              callContactName = detectedPhone;
            }
          } else {
            // OUTGOING call
            if (!callPhoneNumber || callPhoneNumber === 'WhatsApp Contact') {
              callPhoneNumber = detectedPhone;
            }
            if (!callContactName || callContactName === 'WhatsApp Contact') {
              callContactName = detectedPhone;
            }
          }

          chrome.runtime.sendMessage({
            type: 'CALL_STATE_UPDATE',
            contactName: callContactName,
            phoneNumber: callPhoneNumber,
            direction: callDirection || 'INCOMING',
          }).catch(() => {});

          const contactEl = document.querySelector('#recordhub-call-indicator .recordhub-indicator-contact');
          if (contactEl) contactEl.textContent = callContactName;
        }
        break;

      case 'RECORDHUB_AUDIO_RECORDED':
        console.log('[RecordHub Content] 📦 Received recorded audio package. Active sources:', event.data.attachedSources);
        chrome.runtime.sendMessage({
          type: 'UPLOAD_RECORDING',
          audioDataUrl: event.data.audioDataUrl,
          fileSizeBytes: event.data.fileSizeBytes,
          mimeType: event.data.mimeType,
          attachedSources: event.data.attachedSources,
          debugLogs: event.data.debugLogs,
        }).catch((err) => {
          console.warn('[RecordHub Content] Error sending audio to background:', err);
        });
        break;
    }
  });

  // ─── Button Click & DOM Observers (Secondary Layer) ────────────────────────

  function attachClickListeners() {
    document.addEventListener('click', (e) => {
      // 1. Audio / Video call buttons clicked (Make Outgoing Call)
      const callBtn = e.target.closest(SELECTORS.callButtons.join(', '));
      if (callBtn) {
        userInitiatedOutgoingAt = Date.now();
        callDirection = 'OUTGOING';
        const contact = getActiveContactInfo('OUTGOING');
        callContactName = contact.contactName;
        callPhoneNumber = contact.phoneNumber;
        console.log('[RecordHub] Make call button clicked for:', callContactName, callPhoneNumber);
        onCallStart('OUTGOING');
        return;
      }

      // 2. Incoming call accept clicked
      let isAccept = Boolean(e.target.closest(SELECTORS.acceptCallButtons.join(', ')));
      if (!isAccept) {
        const btn = e.target.closest('button, div[role="button"], span[data-icon]');
        if (btn && !btn.closest('#main') && !btn.closest('#side')) {
          const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
          const txt = (btn.innerText || btn.textContent || '').toLowerCase();
          const icon = (btn.getAttribute('data-icon') || '').toLowerCase();
          if (
            aria.includes('accept') || aria.includes('answer') || aria.includes('pick up') ||
            txt.includes('accept') || txt.includes('answer') ||
            icon.includes('accept') || icon.includes('answer') || icon.includes('phone')
          ) {
            if (!aria.includes('decline') && !aria.includes('reject') && !aria.includes('end') && !aria.includes('hang') && !aria.includes('mute') &&
                !txt.includes('decline') && !txt.includes('reject') && !txt.includes('end') && !txt.includes('hang') && !txt.includes('mute') &&
                !icon.includes('decline') && !icon.includes('reject') && !icon.includes('hangup') && !icon.includes('cancel')) {
              isAccept = true;
            }
          }
        }
      }

      if (isAccept) {
        callDirection = 'INCOMING';

        // Direct inspection of button's card container (STRICT: outside #main and #side)
        const card = e.target.closest('div[style*="position"], [role="alertdialog"], [role="dialog"], [data-testid*="call"]') || e.target.parentElement?.parentElement;
        const directContact = (card && !card.closest('#main') && !card.closest('#side'))
          ? extractContactFromCallContainer(card)
          : null;

        if (directContact && directContact.phoneNumber !== 'WhatsApp Contact' && !isCallStatusText(directContact.phoneNumber)) {
          callContactName = directContact.contactName;
          callPhoneNumber = directContact.phoneNumber;
        } else if (directContact && directContact.contactName && directContact.contactName !== 'WhatsApp Contact' && !isCallStatusText(directContact.contactName)) {
          callContactName = directContact.contactName;
        } else {
          const contact = getActiveContactInfo('INCOMING');
          if (contact && contact.contactName && contact.contactName !== 'Incoming Call' && contact.contactName !== 'WhatsApp Contact') {
            callContactName = contact.contactName;
          }
          if (contact && contact.phoneNumber && contact.phoneNumber !== 'WhatsApp Contact') {
            callPhoneNumber = contact.phoneNumber;
          }
        }

        console.log('[RecordHub] Incoming call accept clicked for:', callContactName, callPhoneNumber);
        if (currentCallState === 'idle') {
          onCallStart('INCOMING');
        }
        onCallConnected();
        return;
      }

      // 3. End call button clicked
      if (currentCallState === 'calling' || currentCallState === 'connected') {
        const endBtn = e.target.closest(SELECTORS.endCallButtons.join(', '));
        if (endBtn) {
          console.log('[RecordHub] End call button clicked.');
          onCallEnd(true);
        }
      }
    }, true);
  }

  // Window unload / refresh handler to ensure active call is never left hanging
  window.addEventListener('beforeunload', () => {
    if (currentCallState === 'calling' || currentCallState === 'connected') {
      onCallEnd();
    }
  });

  // ─── Floating HUD Indicator ────────────────────────────────────────────────

  function showCallIndicator(statusText = 'Tracking') {
    let indicator = document.getElementById('recordhub-call-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'recordhub-call-indicator';
      indicator.innerHTML = `
        <div class="recordhub-indicator-content">
          <div class="recordhub-indicator-dot"></div>
          <span class="recordhub-indicator-label">RecordHub Live</span>
          <span class="recordhub-indicator-contact"></span>
          <span class="recordhub-indicator-duration">00:00</span>
        </div>
      `;
      document.body.appendChild(indicator);
    }

    const contactEl = indicator.querySelector('.recordhub-indicator-contact');
    const validContact = (callContactName && !isCallStatusText(callContactName))
      ? callContactName
      : ((callPhoneNumber && !isCallStatusText(callPhoneNumber)) ? callPhoneNumber : 'WhatsApp Call');
    if (contactEl) contactEl.textContent = validContact;
    indicator.classList.add('active');
  }

  function updateCallIndicator(seconds) {
    const indicator = document.getElementById('recordhub-call-indicator');
    if (!indicator) return;

    const durationEl = indicator.querySelector('.recordhub-indicator-duration');
    if (durationEl) {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      durationEl.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
  }

  function hideCallIndicator() {
    const indicator = document.getElementById('recordhub-call-indicator');
    if (indicator) {
      indicator.classList.remove('active');
      setTimeout(() => indicator.remove(), 400);
    }
  }

  // ─── Init ──────────────────────────────────────────────────────────────────

  attachClickListeners();
  console.log('[RecordHub] 🚀 Real-time WhatsApp Web tracker initialized with WebRTC & DOM monitoring.');
})();
