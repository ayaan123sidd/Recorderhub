const mongoose = require('mongoose');
require('dotenv').config({ path: 'c:/Acad/call recroder apk new/apps/web/.env.local' });

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const since = new Date('2026-10-28T00:00:00Z');
  const calls = await db.collection('calls').find({
    $or: [
      { channel: { $regex: 'whatsapp', $options: 'i' } },
      { disposition: { $regex: 'whatsapp', $options: 'i' } },
      { idempotencyKey: { $regex: '^WA', $options: 'i' } }
    ],
    createdAt: { $gte: since }
  }).sort({ createdAt: -1 }).toArray();

  console.log('Total WA calls today:', calls.length);
  for (const c of calls) {
    console.log({
      key: c.idempotencyKey,
      agent: c.agentName,
      phone: c.phoneNumber,
      dur: c.durationSeconds,
      status: c.status,
      recStatus: c.recordingStatus,
      s3Key: c.s3Key,
      audioUrl: c.audioUrl,
      time: c.startTime
    });
  }
  await mongoose.disconnect();
}
main().catch(console.error);
