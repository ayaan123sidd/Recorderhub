/**
 * Production Daily Report Scheduler for EC2 / Node.js
 * Automatically triggers the daily report email at a configured time (Default: 7:00 PM IST)
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
//the comment

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
const TARGET_HOUR_IST = 17; // 19 = 5:00 PM IST (24h format)
const TARGET_MINUTE_IST = 0; // 00 minutes

function triggerDailyReport() {
  const url = `http://127.0.0.1:${WEB_PORT}/api/v1/cron/daily-report?token=${encodeURIComponent(CRON_SECRET)}`;
  console.log(`[${new Date().toISOString()}] ⏰ Triggering Daily HR Report via: ${url}`);

  http.get(url, (res) => {
    let body = '';
    res.on('data', (chunk) => (body += chunk));
    res.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        if (parsed.success) {
          console.log(`✅ [${new Date().toISOString()}] Daily HR Report sent successfully!`, parsed.summary);
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

// Check every 30 seconds if current IST time matches target time
let lastTriggeredDate = '';

function startScheduler() {
  console.log('================================================================');
  console.log('🚀 RecordHub EC2 Daily Report Scheduler Started');
  console.log(`⏰ Scheduled Time: ${TARGET_HOUR_IST}:${TARGET_MINUTE_IST.toString().padStart(2, '0')} PM IST every day`);
  console.log(`🔌 Target API: http://127.0.0.1:${WEB_PORT}/api/v1/cron/daily-report`);
  console.log('================================================================');

  setInterval(() => {
    const now = new Date();
    // Get current IST time
    const istTimeStr = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
    const istDateStr = now.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' });

    const [hour, minute] = istTimeStr.split(':').map(Number);

    // If it's target time (e.g. 19:00 IST) and hasn't run today yet
    if (hour === TARGET_HOUR_IST && minute === TARGET_MINUTE_IST && lastTriggeredDate !== istDateStr) {
      lastTriggeredDate = istDateStr;
      triggerDailyReport();
    }
  }, 30000); // check every 30s
}

startScheduler();
