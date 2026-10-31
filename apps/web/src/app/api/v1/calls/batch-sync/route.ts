import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db';
import { CallModel, DeviceModel, UserModel } from '@/lib/models';
import { updateCallsCacheWithNewBatch, formatPhoneNumber, patchCallInCache } from '@/lib/cache-service';
import { getS3Client } from '@/lib/aws';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export async function POST(req: Request) {
  try {
    await connectToDatabase();
    const body = await req.json().catch(() => ({}));
    const callEvents = Array.isArray(body) ? body : (body.callEvents || body.events || []);
    const completedRecordingIds = Array.isArray(body.completedRecordingIds) ? body.completedRecordingIds : [];

    // Mark any finished uploads confirmed by batch payload
    if (completedRecordingIds.length > 0) {
      try {
        await (CallModel as any).updateMany(
          {
            $or: [
              { idempotencyKey: { $in: completedRecordingIds } },
              { s3Key: { $in: completedRecordingIds } }
            ]
          },
          { $set: { recordingStatus: 'COMPLETED' } }
        );
      } catch (markErr) {
        console.warn('Error marking completed recordings in batch-sync:', markErr);
      }
    }

    if (!callEvents || callEvents.length === 0) {
      return NextResponse.json({
        syncedCount: 0,
        duplicateCount: 0,
        syncedIds: [],
        duplicates: [],
        uploadUrls: [],
      });
    }

    const syncedIds: string[] = [];
    const duplicates: string[] = [];
    const newlyCreatedDocs: any[] = [];
    const uploadUrls: Array<{
      idempotencyKey: string;
      recordingId: string;
      s3Key: string;
      presignedPutUrl: string;
      fallbackUploadUrl?: string;
    }> = [];
    const deviceUpdates = new Map<string, { agentName: string; email: string }>();

    // 1. Pre-fetch existing keys and counselor account creation dates in bulk queries
    const incomingKeys = callEvents.map((e: any) => e.idempotencyKey).filter(Boolean);
    const existingCalls = await (CallModel as any).find(
      { idempotencyKey: { $in: incomingKeys } },
      { idempotencyKey: 1, _id: 1, agentName: 1, s3Key: 1, audioUrl: 1, recordingStatus: 1, status: 1, durationSeconds: 1, endTime: 1 }
    ).lean().exec();
    const existingKeyMap = new Map<string, any>(existingCalls.map((c: any) => [c.idempotencyKey, c]));

    const counselorEmails = Array.from(new Set(callEvents.map((e: any) => (e.counselorEmail || e.email || '').trim().toLowerCase()).filter(Boolean)));
    const emailRegexList = counselorEmails.map((em: string) => new RegExp(`^${em.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
    const userAccounts = counselorEmails.length > 0
      ? await (UserModel as any).find(
          { email: { $in: emailRegexList } },
          { email: 1, createdAt: 1, isActive: 1 }
        ).lean().exec()
      : [];

    if (counselorEmails.length > 0 && (!userAccounts || userAccounts.length === 0)) {
      return NextResponse.json(
        { message: 'Counselor account has been deleted by administrator. Session revoked.', revoked: true },
        { status: 401 }
      );
    }

    const userCreatedAtMap = new Map<string, number>();
    for (const u of (userAccounts || [])) {
      if (u.email && u.createdAt) {
        userCreatedAtMap.set(u.email.toLowerCase(), new Date(u.createdAt).getTime());
      }
    }

    const s3Info = getS3Client();
    const host = req.headers.get('host') || 'localhost:3000';
    const isLocal = host.includes('localhost') || host.includes('127.0.0.1') || host.includes('10.0.2.2');
    const protocol = isLocal ? 'http' : 'https';

    for (const evt of callEvents) {
      if (!evt || !evt.idempotencyKey) continue;

      // Reject text/chat message notifications
      const fullTextStr = `${evt.phoneNumber || ''} ${evt.leadName || ''} ${evt.disposition || ''}`.toLowerCase();
      if (fullTextStr.includes('message') || fullTextStr.includes('messages') || fullTextStr.includes('chat') || fullTextStr.includes('unread')) {
        syncedIds.push(evt.idempotencyKey);
        continue;
      }

      const email = evt.counselorEmail || evt.email;
      const derivedName = email ? email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()) : null;
      const resolvedAgentName = evt.agentName || derivedName || 'Counselor Agent';
      const evtStartTime = evt.startTime ? new Date(evt.startTime) : new Date();

      // Enforce strict cutoff: Reject calls that occurred prior to counselor account creation date
      if (email && userCreatedAtMap.has(email.toLowerCase())) {
        const accountCreatedAtMs = userCreatedAtMap.get(email.toLowerCase())!;
        if (evtStartTime.getTime() < (accountCreatedAtMs - 60000)) {
          syncedIds.push(evt.idempotencyKey);
          continue;
        }
      }

      if (evt.deviceId && resolvedAgentName && resolvedAgentName !== 'Counselor Agent') {
        deviceUpdates.set(evt.deviceId, { agentName: resolvedAgentName, email: email || '' });
      }

      // Helper function to generate S3 Presigned URL for direct APK upload
      const generatePresignedUploadInfo = async (key: string, deviceIdVal: string, mimeTypeVal?: string) => {
        const rawDigits = (key || '').replace(/\D/g, '');
        const cleanP = rawDigits.length >= 10 ? rawDigits.slice(-10) : 'CALL';
        const dateString = evtStartTime.toISOString().replace(/\D/g, '').slice(0, 14);
        const uniqueSuffix = Math.random().toString(36).substring(2, 6);
        
        // Format folder name with the Counselor Name as seen on Web Dashboard
        const counselorFolder = (resolvedAgentName && resolvedAgentName !== 'Counselor Agent')
          ? resolvedAgentName.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '')
          : (email ? email.split('@')[0].replace(/[._]/g, '_').replace(/[^a-zA-Z0-9_-]/g, '') : (deviceIdVal ? deviceIdVal.replace(/[^a-zA-Z0-9_-]/g, '_') : 'AGENT'));

        const recId = `${counselorFolder}_${cleanP}_${dateString}_${uniqueSuffix}`;

        const mime = mimeTypeVal || 'audio/mp4';
        const ext = mime.includes('mpeg') || mime.includes('mp3') ? 'mp3'
                  : mime.includes('wav') ? 'wav'
                  : mime.includes('3gpp') || mime.includes('3gp') ? '3gp'
                  : mime.includes('amr') ? 'amr' : 'm4a';

        const s3KeyTarget = `recordings/${counselorFolder}/${recId}.${ext}`;
        const audioUrlTarget = `/api/v1/recordings/${recId}/audio`;
        const fallbackUrl = `${protocol}://${host}/api/v1/recordings/${recId}/upload-data`;

        let presignedUrl = fallbackUrl;
        if (s3Info) {
          try {
            const cmd = new PutObjectCommand({
              Bucket: s3Info.bucket,
              Key: s3KeyTarget,
              ContentType: mime,
            });
            presignedUrl = await getSignedUrl(s3Info.client, cmd, { expiresIn: 900 });
          } catch (e) {
            console.warn('S3 presign generation error in batch sync:', e);
            presignedUrl = fallbackUrl;
          }
        }

        return {
          recordingId: recId,
          s3Key: s3KeyTarget,
          audioUrl: audioUrlTarget,
          presignedPutUrl: presignedUrl,
          fallbackUploadUrl: fallbackUrl,
        };
      };

      // Check 1: Exact idempotencyKey already in DB
      const isWaWebEvt = (evt.channel || '').toUpperCase() === 'WHATSAPP_WEB' ||
                         (evt.disposition || '').toLowerCase().includes('web') ||
                         (evt.idempotencyKey || '').includes('WA_WEB') ||
                         (evt.idempotencyKey || '').includes('WEB');

      const isWaExisting = isWaWebEvt ||
                           (evt.channel || '').toUpperCase() === 'WHATSAPP' ||
                           (evt.disposition || '').toLowerCase().includes('whatsapp') || 
                           (evt.idempotencyKey || '').startsWith('WA_');

      if (existingKeyMap.has(evt.idempotencyKey)) {
        duplicates.push(evt.idempotencyKey);
        const existingDoc = existingKeyMap.get(evt.idempotencyKey);
        const updateFields: any = {};

        const isExistingAnswered = (existingDoc?.status || '').toUpperCase() === 'ANSWERED';
        const isExistingFinished = isExistingAnswered || Boolean(existingDoc?.endTime) || (Number(existingDoc?.durationSeconds || 0) > 0) || (existingDoc?.recordingStatus === 'COMPLETED');

        // Never downgrade an already completed/answered call back to IN_PROGRESS
        if (evt.status) {
          if (!isExistingFinished || evt.status.toUpperCase() !== 'IN_PROGRESS') {
            updateFields.status = evt.status;
          }
        }

        if (typeof evt.durationSeconds === 'number' && evt.durationSeconds > 0) {
          updateFields.durationSeconds = evt.durationSeconds;
        }

        if (evt.endTime) {
          updateFields.endTime = new Date(evt.endTime);
          // If endTime is provided, ensure status is marked ANSWERED or UNANSWERED, never IN_PROGRESS
          const hasDur = (evt.durationSeconds && evt.durationSeconds > 0) || (existingDoc?.durationSeconds && existingDoc.durationSeconds > 0);
          updateFields.status = hasDur ? 'ANSWERED' : 'UNANSWERED';
        }

        if (evt.phoneNumber && evt.phoneNumber !== 'WhatsApp Contact') {
          updateFields.phoneNumber = evt.phoneNumber;
          updateFields.phoneNumberMasked = evt.phoneNumber;
        }

        if (evt.leadName && evt.leadName !== 'WhatsApp Contact') {
          updateFields.leadName = evt.leadName;
        }

        if (evt.direction) {
          updateFields.direction = evt.direction;
        }

        if (evt.channel) {
          updateFields.channel = evt.channel;
        } else if (isWaWebEvt) {
          updateFields.channel = 'WHATSAPP_WEB';
        }

        if (evt.disposition) {
          updateFields.disposition = evt.disposition;
        } else if (isWaWebEvt) {
          updateFields.disposition = 'WhatsApp Web Call';
        }

        // If the call already has completed recording metadata attached, preserve it
        if (evt.recordingStatus === 'COMPLETED' && evt.audioUrl) {
          updateFields.recordingStatus = 'COMPLETED';
          if (evt.s3Key) updateFields.s3Key = evt.s3Key;
          if (evt.audioUrl) updateFields.audioUrl = evt.audioUrl;
        } else if (evt.recordingStatus === 'NONE' || (!evt.hasRecording && !evt.audioUrl)) {
          if (isWaWebEvt) {
            updateFields.recordingStatus = 'NONE';
            updateFields.audioUrl = null;
            updateFields.s3Key = null;
          }
        } else if (evt.hasRecording && !isWaWebEvt && (!isWaExisting || ((evt.idempotencyKey || '').startsWith('WA_') && !(evt.idempotencyKey || '').includes('WEB')))) {
          // If the mobile app requested an upload URL for this existing call, generate it only if not a WhatsApp Web call
          const uploadInfo = await generatePresignedUploadInfo(evt.idempotencyKey, evt.deviceId || 'ANDROID-DEVICE-PROD', evt.mimeType);
          updateFields.recordingStatus = 'PENDING_UPLOAD';
          updateFields.s3Key = uploadInfo.s3Key;
          updateFields.audioUrl = uploadInfo.audioUrl;
          uploadUrls.push({
            idempotencyKey: evt.idempotencyKey,
            recordingId: uploadInfo.recordingId,
            s3Key: uploadInfo.s3Key,
            presignedPutUrl: uploadInfo.presignedPutUrl,
            fallbackUploadUrl: uploadInfo.fallbackUploadUrl,
          });
        }

        if (Object.keys(updateFields).length > 0) {
          await (CallModel as any).updateOne(
            { idempotencyKey: evt.idempotencyKey },
            { $set: updateFields }
          ).catch(() => {});
          await patchCallInCache(evt.idempotencyKey, updateFields).catch(() => {});
        }
        continue;
      }

      try {
        const rawPhone = (evt.phoneNumber || '').trim();
        const cleanDigits = rawPhone.replace(/\D/g, '');

        const isWaWeb = 
          (evt.channel || '').toUpperCase() === 'WHATSAPP_WEB' ||
          (evt.disposition || '').toLowerCase().includes('web') || 
          (evt.idempotencyKey || '').includes('WA_WEB') ||
          (evt.idempotencyKey || '').includes('WEB');

        const isWhatsApp = 
          isWaWeb ||
          (evt.channel || '').toUpperCase() === 'WHATSAPP' ||
          (evt.disposition || '').toLowerCase().includes('whatsapp') || 
          (evt.idempotencyKey || '').startsWith('WA_');

        const formattedPhone = isWhatsApp ? rawPhone : (formatPhoneNumber(rawPhone) || rawPhone);
        const channelType = evt.channel ? evt.channel : (isWaWeb ? 'WHATSAPP_WEB' : (isWhatsApp ? 'WHATSAPP' : 'CELLULAR'));
        const cleanKey = evt.idempotencyKey || `SYNC_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

        const isOngoing = (evt.status || '').toUpperCase() === 'IN_PROGRESS' || (evt.status || '').toUpperCase() === 'CALLING';
        const isAnswered = (evt.status || 'ANSWERED').toUpperCase() === 'ANSWERED';
        const effectiveDuration = (isAnswered || isOngoing) ? (evt.durationSeconds || 0) : 0;

        let uploadInfo = null;
        const isPreUploaded = evt.recordingStatus === 'COMPLETED' && evt.audioUrl;
        if (!isPreUploaded && evt.hasRecording && !isWaWeb && (!isWhatsApp || (cleanKey.startsWith('WA_') && !cleanKey.includes('WEB')))) {
          uploadInfo = await generatePresignedUploadInfo(cleanKey, evt.deviceId || 'ANDROID-DEVICE-PROD', evt.mimeType);
          uploadUrls.push({
            idempotencyKey: cleanKey,
            recordingId: uploadInfo.recordingId,
            s3Key: uploadInfo.s3Key,
            presignedPutUrl: uploadInfo.presignedPutUrl,
            fallbackUploadUrl: uploadInfo.fallbackUploadUrl,
          });
        }

        const createdDoc = {
          organizationId: evt.organizationId || '65c1f0000000000000000001',
          deviceId: evt.deviceId || 'ANDROID-DEVICE-PROD',
          idempotencyKey: cleanKey,
          phoneNumber: formattedPhone,
          phoneNumberMasked: formattedPhone,
          direction: evt.direction || 'INCOMING',
          status: evt.status || 'ANSWERED',
          startTime: evtStartTime,
          endTime: evt.endTime ? new Date(evt.endTime) : (isOngoing ? null : new Date(evtStartTime.getTime() + (effectiveDuration * 1000))),
          durationSeconds: effectiveDuration,
          simSlot: evt.simSlot || 0,
          isPrivate: evt.isPrivate || false,
          disposition: evt.disposition || (isWaWeb ? 'WhatsApp Web Call' : (isWhatsApp ? 'WhatsApp Call' : 'Imported Phone Call')),
          channel: channelType,
          agentName: resolvedAgentName,
          counselorEmail: email,
          leadName: evt.leadName || formattedPhone || 'Contact',
          recordingStatus: evt.recordingStatus || (uploadInfo ? 'PENDING_UPLOAD' : 'NONE'),
          s3Key: evt.s3Key || uploadInfo?.s3Key || null,
          audioUrl: evt.audioUrl || uploadInfo?.audioUrl || null,
        };

        const savedCall = await (CallModel as any).create(createdDoc);
        if (savedCall) {
          newlyCreatedDocs.push(savedCall.toObject ? savedCall.toObject() : savedCall);
        }

        existingKeyMap.set(cleanKey, { idempotencyKey: cleanKey });
        syncedIds.push(cleanKey);
      } catch (evtErr: any) {
        console.error(`Error saving individual call event ${evt.idempotencyKey}:`, evtErr);
        duplicates.push(evt.idempotencyKey);
      }
    }

    // 2. Perform bulk device/agent update ONCE outside the loop
    if (deviceUpdates.size > 0) {
      for (const [deviceId, info] of Array.from(deviceUpdates.entries())) {
        try {
          const updateSet: any = {
            agentName: info.agentName,
            counselorEmail: info.email,
            lastSyncTimestamp: new Date(),
          };
          if (body.appVersion) updateSet.appVersion = body.appVersion;
          if (body.deviceModel) updateSet.deviceModel = body.deviceModel;
          if (body.androidVersion) updateSet.androidVersion = body.androidVersion;

          await (DeviceModel as any).updateOne(
            { deviceId },
            { $set: updateSet },
            { upsert: true }
          );
        } catch (e) {
          console.warn('Error updating device agent mapping in batch sync:', e);
        }
      }
    }

    // 3. Update in-memory calls cache incrementally (0ms MongoDB overhead)
    if (newlyCreatedDocs.length > 0) {
      await updateCallsCacheWithNewBatch(newlyCreatedDocs);
    }

    console.log(`Batch sync completed: ${syncedIds.length} synced, ${duplicates.length} dups, ${uploadUrls.length} S3 presigned URLs generated.`);

    return NextResponse.json({
      syncedCount: syncedIds.length,
      duplicateCount: duplicates.length,
      syncedIds,
      duplicates,
      uploadUrls,
    });
  } catch (err: any) {
    console.error('Critical error in batch-sync API route:', err);
    return NextResponse.json({ message: err.message || 'Error syncing calls', stack: err.stack }, { status: 500 });
  }
}
