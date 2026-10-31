const mongoose = require('mongoose');
require('dotenv').config({ path: 'c:/Acad/call recroder apk new/apps/web/.env.local' });

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const res = await db.collection('calls').updateOne(
    { idempotencyKey: 'WA_WEB_7617666344_20261028053021_8kpc' },
    {
      $set: {
        s3Key: 'recordings/Sachin_Negi/Sachin_Negi_0280530218_20261028053040_ck1n.m4a',
        audioUrl: '/api/v1/recordings/Sachin_Negi_0280530218_20261028053040_ck1n/audio',
        recordingStatus: 'COMPLETED',
        channel: 'WHATSAPP_WEB',
        disposition: 'WhatsApp Web Call'
      }
    }
  );
  console.log('Updated call in DB:', res.modifiedCount);
  await mongoose.disconnect();
}
main().catch(console.error);
