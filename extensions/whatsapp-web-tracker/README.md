# RecordHub WhatsApp Web Call Tracker (Chrome / Edge Extension)

A lightweight browser extension that automatically captures WhatsApp Web (`web.whatsapp.com`) calls, logs call metadata (contact, duration, direction, timestamps), records tab call audio, and securely syncs everything to your existing RecordHub portal and AWS S3 compliance bucket.

---

## 🚀 Key Features

1. **Automatic Detection**: Detects WhatsApp Web calls (incoming and outgoing) in real-time as soon as they start and end.
2. **Audio Recording**: Captures the call audio from the WhatsApp Web tab using Chrome's Offscreen MediaRecorder API without muting or disturbing the counselor's listening experience.
3. **Zero Impact on Existing System**:
   - Uses the exact same `/api/v1/calls/batch-sync` endpoint as your Android APK.
   - Uploads audio recordings to the exact same S3 bucket with signed URLs.
   - Saves calls to MongoDB under the existing `CallModel` schema.
   - Calls show up immediately on the Web Dashboard and Calls page alongside mobile calls.
4. **Counselor Authentication**: Counselors log in once using their existing RecordHub email and password.
5. **Offline Queueing & Auto-Sync**: If the internet or backend is momentarily unreachable, calls are queued locally and automatically synced once connected.

---

## 📦 How to Install (Takes 30 seconds)

1. Open **Google Chrome** or **Microsoft Edge**.
2. In the URL bar, go to:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
3. In the top right corner, enable **"Developer mode"** toggle.
4. Click the button **"Load unpacked"** in the top left.
5. Select this folder:
   ```
   c:\Acad\call recroder apk new\extensions\whatsapp-web-tracker
   ```
6. The extension **"RecordHub - WhatsApp Web Call Tracker"** will now appear in your browser toolbar! Pin it for quick access.

---

## 🔑 How Counselors Use It

1. Click the **RecordHub extension icon** in Chrome/Edge toolbar.
2. Enter your RecordHub portal URL:
   - For local development: `http://localhost:3000`
   - For production: Your deployed RecordHub URL (e.g. `https://your-recordhub.com`)
3. Enter counselor work email (e.g. `shrishtik@academically.com`) and password.
4. Click **"Connect Extension"**.
5. Status changes to 🟢 **Active**.
6. Open `https://web.whatsapp.com` in Chrome and make or receive calls as usual:
   - When a call starts, a subtle pill `[ 🔴 RecordHub Tracking ]` appears in the top-right corner.
   - When the call ends, duration and audio recording are automatically uploaded to RecordHub!

---

## 📁 File Structure

```
extensions/whatsapp-web-tracker/
├── manifest.json         # Manifest V3 configuration & permissions
├── background.js         # Service worker: syncs calls to RecordHub API & handles S3 uploads
├── content.js            # Injected script: detects WhatsApp Web call UI changes & duration
├── content.css           # Subtle floating HUD on WhatsApp Web during active call
├── offscreen.html        # Offscreen document host for tab audio recording
├── offscreen.js          # Tab audio capture & MediaRecorder pipeline
├── popup.html            # Extension popup UI (login, live call status, sync history)
├── popup.css             # Dark theme styling matching RecordHub dashboard
├── popup.js              # Popup controller logic
└── icons/                # Extension icons (16, 32, 48, 128 px)
```
