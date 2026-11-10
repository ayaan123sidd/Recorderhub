/**
 * Production Daily Report Scheduler for EC2 / Node.js
 * Automatically triggers the daily report email twice daily:
 * 1) 1:00 PM IST (Midday Report)
 * 2) 9:00 PM IST (End of Day Report)
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

// 1. Auto-load environment variables
function loadEnv() {
  const candidatePaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'apps/web/.env'),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf8');
      content.split('\n').forEach((line) => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
          const idx = trimmed.indexOf('=');
          const k = trimmed.substring(0, idx).trim();
          const v = trimmed.substring(idx + 1).trim().replace(/^['"]|['"]$/g, '');
          if (!process.env[k]) process.env[k] = v;
        }
      });
    }
  }
}

loadEnv();

const WEB_PORT = process.env.WEB_PORT || process.env.PORT || 3000;
const CRON_SECRET = process.env.CRON_SECRET || '$@Chin9936';

// Configured schedule slots in IST (Asia/Kolkata)
const SCHEDULED_TIMES = [
  { hour: 13, minute: 0, label: '1:00 PM IST (Midday Report)' },
  { hour: 21, minute: 0, label: '9:00 PM IST (End of Day Report)' },
];

function triggerDailyReport(slotLabel = '') {
  const url = `http://127.0.0.1:${WEB_PORT}/api/v1/cron/daily-report?token=${encodeURIComponent(CRON_SECRET)}`;
  console.log(`[${new Date().toISOString()}] ⏰ Triggering Daily HR Report [${slotLabel}] via: ${url}`);

  http.get(url, (res) => {
    let body = '';
    res.on('data', (chunk) => (body += chunk));
    res.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        if (parsed.success) {
          console.log(`✅ [${new Date().toISOString()}] Daily HR Report [${slotLabel}] sent successfully!`, parsed.summary);
        } else {
          console.error(`❌ [${new Date().toISOString()}] Daily Report Error:`, parsed.error);
        }
      } catch (e) {
        console.log(`[${new Date().toISOString()}] Response Status: ${res.statusCode}, Body:`, body);
      }
    });
  }).on('error', (err) => {
    console.error(`❌ [${new Date().toISOString()}] Failed to reach web server:`, err.message);
  });
}

// Track last triggered slot so it only fires once per scheduled time
let lastTriggeredSlot = '';

function startScheduler() {
  console.log('================================================================');
  console.log('🚀 RecordHub EC2 Daily Report Scheduler Started');
  console.log('⏰ Scheduled Times (IST):');
  SCHEDULED_TIMES.forEach((slot, index) => {
    console.log(`   ${index + 1}) ${slot.label} (at ${slot.hour.toString().padStart(2, '0')}:${slot.minute.toString().padStart(2, '0')} IST)`);
  });
  console.log(`🔌 Target API: http://127.0.0.1:${WEB_PORT}/api/v1/cron/daily-report`);
  console.log('================================================================');

  setInterval(() => {
    const now = new Date();
    // Get current IST time
    const istTimeStr = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
    const istDateStr = now.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' });

    const [hour, minute] = istTimeStr.split(':').map(Number);

    for (const slot of SCHEDULED_TIMES) {
      if (hour === slot.hour && minute === slot.minute) {
        const slotKey = `${istDateStr}_${slot.hour}:${slot.minute}`;
        if (lastTriggeredSlot !== slotKey) {
          lastTriggeredSlot = slotKey;
          triggerDailyReport(slot.label);
        }
      }
    }
  }, 30000); // check every 30s
}

startScheduler();
  