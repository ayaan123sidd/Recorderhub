import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db';
import { CallModel, DeviceModel, UserModel } from '@/lib/models';
import { getS3Client } from '@/lib/aws';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { patchCallInCache, revalidateCallsCacheInBackground } from '@/lib/cache-service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseTimestamp(str: string): Date | null {
  if (!str) return null;
  const match14 = str.match(/\b(20\d{12})\b/);
  if (match14) {
    const s = match14[1];
    const year = parseInt(s.slice(0, 4), 10);
    const month = parseInt(s.slice(4, 6), 10) - 1;
    const day = parseInt(s.slice(6, 8), 10);
    const hour = parseInt(s.slice(8, 10), 10);
    const min = parseInt(s.slice(10, 12), 10);
    const sec = parseInt(s.slice(12, 14), 10);
    return new Date(Date.UTC(year, month, day, hour, min, sec));
  }

  const matchEpoch = str.match(/\b(1[67]\d{11})\b/);
  if (matchEpoch) {
    const ms = Number(matchEpoch[1]);
    if (!isNaN(ms) && ms > 1000000000000) {
      return new Date(ms);
    }
  }

  return null;
}

function buildPhoneRegex(digits: string): RegExp {
  const clean = digits.replace(/\D/g, '').slice(-10);
  const pattern = clean.split('').join('\\s*') + '$';
  return new RegExp(pattern);
}

export async function POST(req: Request) {
  try {
    await connectToDatabase();
    const body = await req.json().catch(() => ({}));
    const { callId, fileSizeBytes, mimeType, checksumSha256, durationSeconds, deviceId, counselorEmail } = body;
    const digitsOnly = (callId || '').replace(/\D/g, '');
    const cleanPhone = digitsOnly.length >= 10 ? digitsOnly.slice(-10) : 'CALL';

    const parsedDate = parseTimestamp(callId);
    const callDate = parsedDate || new Date();

    // Format timestamp as YYYYMMDDHHmmss to mirror native phone recording naming
    const dateStr = callDate.toISOString().replace(/\D/g, '').slice(0, 14);
    const uniqueSuffix = Math.random().toString(36).substring(2, 6);

    let counselorName = body.agentName;
    if (!counselorName && counselorEmail) {
      const user = await (UserModel as any).findOne({ email: counselorEmail.toLowerCase() }).lean().exec();
      if (user && (user.firstName || user.lastName)) {
        counselorName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
      }
    }
    if (!counselorName && deviceId) {
      const dev = await (DeviceModel as any).findOne({ deviceId }).lean().exec();
      if (dev && dev.agentName && dev.agentName !== 'Counselor Agent') {
        counselorName = dev.agentName;
      }
    }
    if (!counselorName && counselorEmail) {
      counselorName = counselorEmail.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
    }

    const counselorFolder = (counselorName && counselorName !== 'Counselor Agent')
      ? counselorName.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '')
      : (counselorEmail ? counselorEmail.split('@')[0].replace(/[._]/g, '_').replace(/[^a-zA-Z0-9_-]/g, '') : (deviceId ? deviceId.replace(/[^a-zA-Z0-9_-]/g, '_') : 'AGENT'));

    const recordingId = `${counselorFolder}_${cleanPhone}_${dateStr}_${uniqueSuffix}`;
    const ext = mimeType?.includes('mpeg') || mimeType?.includes('mp3') ? 'mp3'
              : mimeType?.includes('wav') ? 'wav'
              : mimeType?.includes('webm') ? 'webm'
              : mimeType?.includes('3gpp') || mimeType?.includes('3gp') ? '3gp'
              : mimeType?.includes('amr') ? 'amr' : 'm4a';

    const s3Key = `recordings/${counselorFolder}/${recordingId}.${ext}`;
    const audioUrl = `/api/v1/recordings/${recordingId}/audio`;

    const host = req.headers.get('host') || 'localhost:3000';
    const isLocal = host.includes('localhost') || host.includes('127.0.0.1') || host.includes('10.0.2.2');
    const protocol = isLocal ? 'http' : 'https';
    const fallbackUploadUrl = `${protocol}://${host}/api/v1/recordings/${recordingId}/upload-data`;

    let presignedPutUrl: string = fallbackUploadUrl;

    const s3Info = getS3Client();
    if (s3Info) {
      try {
        const command = new PutObjectCommand({
          Bucket: s3Info.bucket,
          Key: s3Key,
          ContentType: mimeType || (ext === 'wav' ? 'audio/wav' : ext === 'mp3' ? 'audio/mpeg' : ext === 'webm' ? 'audio/webm' : 'audio/m4a'),
        });

        // Generate 15-minute AWS S3 presigned URL for direct APK upload
        presignedPutUrl = await getSignedUrl(s3Info.client, command, { expiresIn: 900 });
        console.log(`Generated real AWS S3 Presigned URL for key: ${s3Key} in bucket: ${s3Info.bucket}`);
      } catch (s3Err) {
        console.error('Error generating S3 presigned URL, using fallback upload route:', s3Err);
        presignedPutUrl = fallbackUploadUrl;
      }
    }

    // Immediately link audioUrl and s3Key strictly to the specific Call document in MongoDB Atlas
    if (callId) {
      try {
        const isWaRecording = (callId && callId.startsWith('WA_')) || (recordingId && recordingId.startsWith('WA_'));
        const directQuery: any = {
          $or: [
            { idempotencyKey: callId },
            { _id: callId.length === 24 ? callId : null }
          ].filter((c) => c._id !== null || c.idempotencyKey)
        };

        if (!isWaRecording) {
          directQuery.channel = { $ne: 'WHATSAPP' };
          directQuery.disposition = { $not: /whatsapp/i };
          directQuery.idempotencyKey = { $not: /^WA_/i };
        }

        let updatedCall = await (CallModel as any).findOneAndUpdate(
          directQuery,
          {
            $set: {
              recordingStatus: 'PENDING_UPLOAD',
              audioUrl: audioUrl,
              s3Key: s3Key,
            },
          },
          { new: true }
        ).exec();

        if (!updatedCall && cleanPhone.length === 10) {
          const phoneRegex = buildPhoneRegex(cleanPhone);
          const query: any = {
            phoneNumber: { $regex: phoneRegex },
            status: 'ANSWERED',
            durationSeconds: { $gt: 0 },
            $or: [
              { recordingStatus: { $in: ['PENDING', 'PENDING_UPLOAD', 'NONE'] } },
              { audioUrl: { $exists: false } }
            ]
          };

          if (isWaRecording) {
            query.channel = 'WHATSAPP';
          } else {
            query.channel = { $ne: 'WHATSAPP' };
            query.disposition = { $not: /whatsapp/i };
            query.idempotencyKey = { $not: /^WA_/i };
          }

          if (deviceId) {
            query.deviceId = deviceId;
          } else if (counselorEmail) {
            query.counselorEmail = counselorEmail;
          }

          if (parsedDate) {
            query.startTime = {
              $gte: new Date(parsedDate.getTime() - 180000),
              $lte: new Date(parsedDate.getTime() + 180000)
            };
          }

          updatedCall = await (CallModel as any).findOneAndUpdate(
            query,
            {
              $set: {
                recordingStatus: 'PENDING_UPLOAD',
                audioUrl: audioUrl,
                s3Key: s3Key,
              },
            },
            { sort: { startTime: -1, createdAt: -1 }, new: true }
          ).exec();
        }

        if (updatedCall) {
          console.log(`Linked audioUrl ${audioUrl} strictly to call ${updatedCall.idempotencyKey || updatedCall._id}`);
          await patchCallInCache(updatedCall._id?.toString() || updatedCall.idempotencyKey, {
            recordingStatus: 'PENDING_UPLOAD',
            audioUrl: audioUrl,
            s3Key: s3Key,
          }).catch(() => {});
        } else {
          console.warn(`Could not find matching call for audio upload: ${callId}`);
        }
      } catch (linkErr) {
        console.error(`Error linking audioUrl to call ${callId}:`, linkErr);
      }
    }

    return NextResponse.json({
      recordingId,
      s3Key,
      bucket: s3Info?.bucket || 'academically-recorderhub',
      presignedPutUrl,
      fallbackUploadUrl,
    });
  } catch (err: any) {
    console.error('Error initiating upload:', err);
    return NextResponse.json({ message: err.message || 'Error initiating upload' }, { status: 500 });
  }
}
