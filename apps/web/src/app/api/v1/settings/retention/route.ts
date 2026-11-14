import { NextResponse } from 'next/server';
import { getS3Client } from '@/lib/aws';
import { connectToDatabase } from '@/lib/db';
import { SystemSettingModel } from '@/lib/models';
import { 
  GetBucketLifecycleConfigurationCommand, 
  PutBucketLifecycleConfigurationCommand 
} from '@aws-sdk/client-s3';

export const dynamic = 'force-dynamic';

const DEFAULT_RETENTION_DAYS = Number(process.env.DATA_RETENTION_DAYS) || Number(process.env.RECORDING_RETENTION_DAYS) || 365;

export async function GET() {
  try {
    await connectToDatabase();

    // 1. Check MongoDB system settings first
    const dbSetting = await (SystemSettingModel as any).findOne({ key: 'data_retention_days' }).lean().exec();
    let currentDays = dbSetting ? Number(dbSetting.value) : DEFAULT_RETENTION_DAYS;

    // 2. Query S3 lifecycle rule if available
    const s3Info = getS3Client();
    let s3Rules = null;
    let s3Source = 'db_or_env';

    if (s3Info) {
      try {
        const command = new GetBucketLifecycleConfigurationCommand({ Bucket: s3Info.bucket });
        const res = await s3Info.client.send(command);
        s3Rules = res.Rules;
        const rule = res.Rules?.find((r: any) => 
          r.ID === 'AutoDeleteAudioRecordingsAfter1Year' || 
          r.ID === 'AutoDeleteAudioRecordingsAfter6Months' || 
          r.Expiration?.Days
        );
        if (rule?.Expiration?.Days) {
          currentDays = rule.Expiration.Days;
          s3Source = 's3';
        }
      } catch (err: any) {
        // AccessDenied or NoSuchLifecycleConfiguration - fall back to MongoDB / env setting
      }
    }

    return NextResponse.json({ 
      retentionDays: currentDays, 
      rules: s3Rules, 
      source: s3Source 
    });
  } catch (err: any) {
    return NextResponse.json({ retentionDays: DEFAULT_RETENTION_DAYS, error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await connectToDatabase();
    const body = await req.json().catch(() => ({}));
    const retentionDays = Number(body.retentionDays) || DEFAULT_RETENTION_DAYS;

    // 1. Persist retention setting in MongoDB
    await (SystemSettingModel as any).findOneAndUpdate(
      { key: 'data_retention_days' },
      { 
        $set: { 
          value: retentionDays, 
          description: `Data and S3 audio recording retention period in days (1 year = 365 days)`,
          updatedBy: 'Admin'
        } 
      },
      { upsert: true, new: true }
    ).exec();

    // 2. Attempt to update AWS S3 bucket lifecycle policy
    let s3Updated = false;
    let s3Warning = null;
    const s3Info = getS3Client();

    if (s3Info) {
      try {
        const ruleId = retentionDays >= 365 ? 'AutoDeleteAudioRecordingsAfter1Year' : 'AutoDeleteAudioRecordingsLifecycle';
        const command = new PutBucketLifecycleConfigurationCommand({
          Bucket: s3Info.bucket,
          LifecycleConfiguration: {
            Rules: [
              {
                ID: ruleId,
                Status: 'Enabled',
                Filter: {
                  Prefix: '',
                },
                Expiration: {
                  Days: retentionDays,
                },
                NoncurrentVersionExpiration: {
                  NoncurrentDays: retentionDays,
                },
                AbortIncompleteMultipartUpload: {
                  DaysAfterInitiation: 7,
                },
              },
            ],
          },
        });

        await s3Info.client.send(command);
        s3Updated = true;
      } catch (err: any) {
        s3Warning = err.message || 'S3 lifecycle rule could not be updated directly due to AWS IAM permissions';
      }
    }

    return NextResponse.json({ 
      success: true, 
      retentionDays,
      s3Updated,
      s3Warning,
      message: `Successfully set data retention policy to ${retentionDays} days (${retentionDays >= 365 ? `${Math.round(retentionDays / 365)} Year` : `${Math.round(retentionDays / 30)} Months`}). Call logs and recordings are preserved for up to 1 year.` 
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to update retention policy' }, { status: 500 });
  }
}
