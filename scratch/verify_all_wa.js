const mongoose = require('mongoose');
const { S3Client, HeadObjectCommand } = require('@aws-sdk/client-s3');
require('dotenv').config({ path: 'c:/Acad/call recroder apk new/apps/web/.env.local' });

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  }
});

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const calls = await db.collection('calls').find({
    channel: 'WHATSAPP_WEB',
    durationSeconds: { $gt: 0 }
  }).sort({ createdAt: -1 }).limit(10).toArray();

  console.log('=== VERIFYING WHATSAPP WEB RECORDINGS IN AWS S3 ===');
  for (const c of calls) {
    let s3Status = 'NO S3 KEY';
    let size = 0;
    if (c.s3Key) {
      try {
        const head = await s3.send(new HeadObjectCommand({
          Bucket: process.env.S3_BUCKET_NAME || 'academically-recorderhub',
          Key: c.s3Key
        }));
        s3Status = 'EXISTS (200 OK)';
        size = head.ContentLength;
      } catch (err) {
        s3Status = 'S3 NOT FOUND (404)';
      }
    }
    console.log(`${c.idempotencyKey} | Agent: ${c.agentName} | ${c.phoneNumber} | ${c.durationSeconds}s | recStatus: ${c.recordingStatus} | S3: ${s3Status} (${(size/1024).toFixed(1)} KB) | audioUrl: ${c.audioUrl}`);
  }

  process.exit(0);
}
run();
