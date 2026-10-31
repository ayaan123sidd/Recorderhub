const mongoose = require('mongoose');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
require('dotenv').config({ path: 'c:/Acad/call recroder apk new/apps/web/.env.local' });

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  }
});

let db = null;
const cachedS3ByPrefix = new Map();
let lastS3Fetch = 0;

async function checkAndHeal() {
  try {
    if (!db) {
      await mongoose.connect(process.env.MONGODB_URI);
      db = mongoose.connection.db;
    }

    // Find any WhatsApp call from the last 2 hours that needs recording linkage
    const twoHoursAgo = new Date(Date.now() - 120 * 60 * 1000);
    const pendingCalls = await db.collection('calls').find({
      $or: [
        { channel: 'WHATSAPP_WEB' },
        { channel: 'WHATSAPP' },
        { disposition: /whatsapp/i },
        { idempotencyKey: { $regex: '^WA_' } },
        { idempotencyKey: { $regex: '^WAWEB_' } }
      ],
      createdAt: { $gte: twoHoursAgo },
      durationSeconds: { $gt: 0 },
      $or: [
        { recordingStatus: { $in: ['PENDING_UPLOAD', 'PENDING', 'NONE'] } },
        { s3Key: { $exists: false } },
        { s3Key: null }
      ]
    }).sort({ createdAt: -1 }).toArray();

    if (pendingCalls.length === 0) return;

    for (const call of pendingCalls) {
      const agentName = call.agentName || 'Agent';
      const counselorFolder = agentName.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');

      // Check folders: specific counselor folder, Jobslly, and root recordings/
      const prefixesToCheck = [
        `recordings/${counselorFolder}/`,
        'recordings/Jobslly/',
        'recordings/'
      ];

      let match = null;
      const callTime = new Date(call.endTime || call.startTime || call.createdAt).getTime();
      const phoneDigits = (call.phoneNumber || '').replace(/\D/g, '').slice(-10);

      for (const prefix of prefixesToCheck) {
        try {
          const s3Res = await s3.send(new ListObjectsV2Command({
            Bucket: process.env.S3_BUCKET_NAME || 'academically-recorderhub',
            Prefix: prefix,
            MaxKeys: 100
          }));

          const s3Objects = (s3Res.Contents || []).map(o => ({
            key: o.Key,
            size: o.Size,
            modified: o.LastModified,
            timeMs: new Date(o.LastModified).getTime()
          }));

          // 1. Phone digits match within 5 minutes
          if (phoneDigits.length >= 7) {
            match = s3Objects.find(o => o.key.includes(phoneDigits) && Math.abs(o.timeMs - callTime) < 300000);
          }

          // 2. Strict time match within 3 minutes in the counselor's folder
          if (!match && prefix !== 'recordings/') {
            match = s3Objects.find(o => Math.abs(o.timeMs - callTime) < 180000 && o.size > 1000);
          }

          if (match) break;
        } catch (e) {
          // ignore prefix check error
        }
      }

      if (match) {
        const recId = match.key.split('/').pop().replace(/\.[^.]+$/, '');
        console.log(`[DAEMON-HEAL] ✅ Linking ${call.agentName} | ${call.idempotencyKey} (${call.durationSeconds}s) -> ${match.key}`);
        await db.collection('calls').updateOne(
          { _id: call._id },
          {
            $set: {
              s3Key: match.key,
              audioUrl: `/api/v1/recordings/${recId}/audio`,
              recordingStatus: 'COMPLETED',
              channel: 'WHATSAPP_WEB',
              disposition: 'WhatsApp Web Call'
            }
          }
        );
      }
    }
  } catch (err) {
    console.error('[DAEMON-ERROR]', err?.message || err);
  }
}

console.log('Starting RecordHub S3 Multi-Counselor Auto-Healer Daemon (5s interval)...');
setInterval(checkAndHeal, 5000);
checkAndHeal();
