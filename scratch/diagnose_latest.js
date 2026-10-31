const mongoose = require('mongoose');
const { S3Client, ListObjectsV2Command, HeadObjectCommand } = require('@aws-sdk/client-s3');
require('dotenv').config({ path: 'c:/Acad/call recroder apk new/apps/web/.env.local' });

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  }
});

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const calls = await db.collection('calls')
    .find({})
    .sort({ startTime: -1 })
    .limit(10)
    .toArray();

  console.log('=== LATEST 10 CALLS IN DB ===');
  for (const c of calls) {
    console.log({
      idempotencyKey: c.idempotencyKey,
      agentName: c.agentName,
      phoneNumber: c.phoneNumber,
      duration: c.durationSeconds,
      status: c.status,
      recordingStatus: c.recordingStatus,
      s3Key: c.s3Key,
      audioUrl: c.audioUrl,
      channel: c.channel,
      startTime: c.startTime,
      createdAt: c.createdAt,
    });
  }

  console.log('\n=== LATEST S3 FILES IN recordings/ ===');
  const s3res = await s3.send(new ListObjectsV2Command({
    Bucket: process.env.S3_BUCKET_NAME || 'academically-recorderhub',
    Prefix: 'recordings/',
    MaxKeys: 100
  }));

  const objects = (s3res.Contents || [])
    .sort((a,b) => b.LastModified - a.LastModified)
    .slice(0, 15);

  for (const o of objects) {
    console.log(o.LastModified.toISOString(), (o.Size / 1024).toFixed(1) + ' KB', o.Key);
  }

  await mongoose.disconnect();
}

main().catch(console.error);
