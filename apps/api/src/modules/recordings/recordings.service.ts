import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Recording, RecordingDocument } from '../../schemas/recording.schema';
import { Call, CallDocument } from '../../schemas/call.schema';
import { AuditLog, AuditLogDocument } from '../../schemas/audit-log.schema';
import { RecordingUploadStatus } from '@recordhub/shared';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class RecordingsService {
  private s3Client: S3Client | null = null;
  private s3Bucket: string;

  constructor(
    @InjectModel(Recording.name) private recordingModel: Model<RecordingDocument>,
    @InjectModel(Call.name) private callModel: Model<CallDocument>,
    @InjectModel(AuditLog.name) private auditLogModel: Model<AuditLogDocument>,
  ) {
    const region = process.env.AWS_REGION || 'ap-south-1';
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    this.s3Bucket = process.env.S3_BUCKET_NAME || 'recorderhub';

    if (accessKeyId && secretAccessKey) {
      this.s3Client = new S3Client({
        region,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
    }
  }

  async initiateUpload(organizationId: string, callId: string, payload: { fileSizeBytes: number; mimeType: string; checksumSha256: string; durationSeconds: number }) {
    const isObjectId = Types.ObjectId.isValid(callId);
    let call = await this.callModel.findOne({
      $or: [
        { idempotencyKey: callId },
        { _id: isObjectId ? new Types.ObjectId(callId) : null }
      ],
      organizationId: new Types.ObjectId(organizationId),
    });

    if (!call) {
      // Fallback matching by clean 10-digit phone number if call was deduplicated on batch sync
      const digitsOnly = callId.replace(/\D/g, '');
      const cleanDigits = digitsOnly.slice(-10);
      if (cleanDigits.length === 10) {
        const regexPattern = new RegExp(`${cleanDigits}$`);
        call = await this.callModel.findOne({
          phoneNumber: { $regex: regexPattern },
          organizationId: new Types.ObjectId(organizationId),
        }).sort({ startTime: -1 });
      }
    }

    if (!call) throw new NotFoundException('Call record not found');

    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const ext = payload.mimeType?.includes('mpeg') || payload.mimeType?.includes('mp3') ? 'mp3'
              : payload.mimeType?.includes('wav') ? 'wav'
              : payload.mimeType?.includes('3gp') ? '3gp' : 'm4a';

    const s3Key = `organizations/${organizationId}/recordings/${year}/${month}/${callId}/recording.${ext}`;

    let recording = await this.recordingModel.findOne({ callId: call._id });
    if (!recording) {
      recording = new this.recordingModel({
        organizationId: new Types.ObjectId(organizationId),
        callId: call._id,
        s3Bucket: this.s3Bucket,
        s3Key,
        fileSizeBytes: payload.fileSizeBytes,
        mimeType: payload.mimeType || 'audio/m4a',
        checksumSha256: payload.checksumSha256,
        durationSeconds: payload.durationSeconds,
        uploadStatus: RecordingUploadStatus.PENDING_UPLOAD,
      });
      await recording.save();
    }

    call.recordingStatus = RecordingUploadStatus.PENDING_UPLOAD;
    call.recordingId = recording._id as any;
    (call as any).s3Key = s3Key;
    (call as any).audioUrl = `/api/v1/recordings/${recording._id}/audio`;
    await call.save();

    let presignedPutUrl = '';
    if (this.s3Client) {
      try {
        const command = new PutObjectCommand({
          Bucket: this.s3Bucket,
          Key: s3Key,
          ContentType: payload.mimeType || 'audio/mp4',
        });
        presignedPutUrl = await getSignedUrl(this.s3Client, command, { expiresIn: 900 });
      } catch (s3Err) {
        console.error('Error generating S3 presigned URL in NestJS API:', s3Err);
      }
    }

    if (!presignedPutUrl) {
      presignedPutUrl = `${process.env.S3_ENDPOINT || 'http://localhost:9000'}/${this.s3Bucket}/${s3Key}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=900`;
    }

    return {
      recordingId: recording._id.toString(),
      s3Key,
      presignedPutUrl,
      fallbackUploadUrl: `/api/v1/recordings/${recording._id}/upload-data`,
    };
  }

  async completeUpload(organizationId: string, recordingId: string) {
    const isObjectId = Types.ObjectId.isValid(recordingId);
    let recording = isObjectId ? await this.recordingModel.findOne({
      _id: new Types.ObjectId(recordingId),
      organizationId: new Types.ObjectId(organizationId),
    }) : null;

    if (!recording) {
      recording = await this.recordingModel.findOne({
        organizationId: new Types.ObjectId(organizationId),
        s3Key: { $regex: recordingId },
      });
    }

    if (!recording) throw new NotFoundException('Recording not found');

    recording.uploadStatus = RecordingUploadStatus.UPLOADED;
    await recording.save();

    await this.callModel.updateOne(
      { _id: recording.callId },
      { $set: { recordingStatus: RecordingUploadStatus.UPLOADED, s3Key: recording.s3Key, audioUrl: `/api/v1/recordings/${recording._id}/audio` } },
    );

    return { success: true, uploadStatus: RecordingUploadStatus.UPLOADED };
  }

  async getStreamUrl(organizationId: string, recordingId: string, actorUserId: string, actorName: string) {
    const isObjectId = Types.ObjectId.isValid(recordingId);
    let recording = isObjectId ? await this.recordingModel.findOne({
      _id: new Types.ObjectId(recordingId),
      organizationId: new Types.ObjectId(organizationId),
    }) : null;

    if (!recording) {
      recording = await this.recordingModel.findOne({
        organizationId: new Types.ObjectId(organizationId),
        s3Key: { $regex: recordingId },
      });
    }

    if (!recording) throw new NotFoundException('Recording not found');

    // Create audit log entry for playback
    await this.auditLogModel.create({
      organizationId: new Types.ObjectId(organizationId),
      actorUserId: new Types.ObjectId(actorUserId),
      actorName,
      action: 'RECORDING_PLAYED',
      targetResource: `Recording:${recordingId}`,
    });

    let streamUrl = '';
    if (this.s3Client) {
      try {
        const command = new GetObjectCommand({
          Bucket: recording.s3Bucket || this.s3Bucket,
          Key: recording.s3Key,
        });
        streamUrl = await getSignedUrl(this.s3Client, command, { expiresIn: 300 });
      } catch (err) {
        console.error('Error generating GET presigned URL:', err);
      }
    }

    if (!streamUrl) {
      streamUrl = `${process.env.S3_ENDPOINT || 'http://localhost:9000'}/${recording.s3Bucket || this.s3Bucket}/${recording.s3Key}?X-Amz-Expires=300`;
    }

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    return {
      streamUrl,
      expiresAt,
      durationSeconds: recording.durationSeconds,
    };
  }
}
