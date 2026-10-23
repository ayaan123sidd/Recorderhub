import { connectToDatabase } from '@/lib/db';
import { UserModel, CallModel, DeviceModel } from '@/lib/models';
import { getS3Client } from '@/lib/aws';
import { cacheDel } from '@/lib/cache';
import mongoose from 'mongoose';
import { ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';

export async function deleteCounselorCascade(identifier: string) {
  await connectToDatabase();

  const filter = mongoose.Types.ObjectId.isValid(identifier)
    ? { _id: identifier }
    : { email: { $regex: new RegExp(`^${identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } };

  const user = await (UserModel as any).findOne(filter).lean().exec();

  const email = user?.email ? user.email.toLowerCase() : (identifier.includes('@') ? identifier.toLowerCase() : '');
  const firstName = user?.firstName || '';
  const lastName = user?.lastName || '';
  const fullName = `${firstName} ${lastName}`.trim();
  const counselorFolder = fullName ? fullName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '') : '';
  const emailPrefix = email ? email.split('@')[0].replace(/[._]/g, '_') : '';

  console.log(`Starting cascade deletion for counselor: ${fullName || email || identifier}...`);

  // 1. Find all associated devices
  const deviceQueries: any[] = [];
  if (email) deviceQueries.push({ email: email });
  if (fullName && fullName !== 'Counselor Agent') deviceQueries.push({ agentName: fullName });
  if (user?._id) deviceQueries.push({ userId: user._id.toString() });

  const devices = deviceQueries.length > 0
    ? await (DeviceModel as any).find({ $or: deviceQueries }).lean().exec()
    : [];

  const deviceIds = devices.map((d: any) => d.deviceId).filter(Boolean);

  // 2. Find all matching call logs
  const callOrConditions: any[] = [];
  if (user?._id) callOrConditions.push({ userId: user._id.toString() });
  if (email) {
    callOrConditions.push({ counselorEmail: { $regex: new RegExp(`^${email}$`, 'i') } });
    callOrConditions.push({ email: { $regex: new RegExp(`^${email}$`, 'i') } });
  }
  if (fullName && fullName !== 'Counselor Agent') {
    callOrConditions.push({ agentName: { $regex: new RegExp(`^${fullName}$`, 'i') } });
  }
  if (deviceIds.length > 0) {
    callOrConditions.push({ deviceId: { $in: deviceIds } });
  }

  const callQuery = callOrConditions.length > 0 ? { $or: callOrConditions } : null;

  const matchingCalls = callQuery
    ? await (CallModel as any).find(callQuery, { s3Key: 1, _id: 1, idempotencyKey: 1 }).lean().exec()
    : [];

  const s3KeysToDelete = new Set<string>();

  for (const c of matchingCalls) {
    if (c.s3Key) {
      s3KeysToDelete.add(c.s3Key);
    }
  }

  // 3. Delete files from AWS S3
  const s3Info = getS3Client();
  if (s3Info) {
    try {
      const prefixesToList: string[] = [];
      if (counselorFolder) prefixesToList.push(`recordings/${counselorFolder}/`);
      if (fullName) prefixesToList.push(`recordings/${fullName}/`);
      if (emailPrefix) prefixesToList.push(`recordings/${emailPrefix}/`);
      for (const devId of deviceIds) {
        prefixesToList.push(`recordings/${devId}/`);
      }

      for (const prefix of prefixesToList) {
        let continuationToken = undefined;
        do {
          const listCmd = new ListObjectsV2Command({
            Bucket: s3Info.bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          });
          const listRes = await s3Info.client.send(listCmd);
          if (listRes.Contents && listRes.Contents.length > 0) {
            for (const item of listRes.Contents) {
              if (item.Key) s3KeysToDelete.add(item.Key);
            }
          }
          continuationToken = listRes.NextContinuationToken;
        } while (continuationToken);
      }

      if (s3KeysToDelete.size > 0) {
        const keysArray = Array.from(s3KeysToDelete);
        console.log(`Deleting ${keysArray.length} audio recordings from S3 for counselor ${fullName || email}...`);

        for (let i = 0; i < keysArray.length; i += 1000) {
          const batch = keysArray.slice(i, i + 1000);
          const delCmd = new DeleteObjectsCommand({
            Bucket: s3Info.bucket,
            Delete: {
              Objects: batch.map((k) => ({ Key: k })),
              Quiet: true,
            },
          });
          await s3Info.client.send(delCmd);
        }
        console.log(`Successfully deleted ${keysArray.length} S3 recordings.`);
      }
    } catch (s3Err) {
      console.error(`Error deleting S3 files for counselor ${email || identifier}:`, s3Err);
    }
  }

  // 4. Delete call logs from MongoDB
  let deletedCallsCount = 0;
  if (callQuery) {
    const deleteCallsRes = await (CallModel as any).deleteMany(callQuery).exec();
    deletedCallsCount = deleteCallsRes.deletedCount || 0;
    console.log(`Deleted ${deletedCallsCount} call logs from MongoDB.`);
  }

  // 5. Delete associated devices from MongoDB
  if (deviceQueries.length > 0) {
    await (DeviceModel as any).deleteMany({ $or: deviceQueries }).exec();
  }

  // 6. Delete user account from MongoDB
  if (user?._id) {
    await (UserModel as any).deleteOne({ _id: user._id }).exec();
  } else {
    await (UserModel as any).deleteOne(filter).exec();
  }

  // 7. Clear & refresh in-memory caches
  await cacheDel('cache:auth:counselors').catch(() => {});
  const { revalidateCallsCacheInBackground } = await import('@/lib/cache-service');
  revalidateCallsCacheInBackground();

  return {
    success: true,
    counselor: fullName || email || identifier,
    deletedCallsCount,
    deletedS3RecordingsCount: s3KeysToDelete.size,
  };
}
