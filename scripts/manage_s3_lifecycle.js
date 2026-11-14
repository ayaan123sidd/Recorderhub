const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config({ path: 'apps/web/.env.local' });
require('dotenv').config();

const { S3Client, GetBucketLifecycleConfigurationCommand, PutBucketLifecycleConfigurationCommand } = require('@aws-sdk/client-s3');

async function checkAndApplyLifecycle() {
  const region = process.env.AWS_REGION || 'ap-south-1';
  const bucket = process.env.S3_BUCKET_NAME || 'academically-recorderhub';
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    console.error('Missing AWS credentials in environment variables.');
    return;
  }

  const s3 = new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });

  console.log(`Checking S3 bucket lifecycle for: ${bucket} in ${region}...`);

  try {
    const currentConfig = await s3.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }));
    console.log('Current Lifecycle Rules:', JSON.stringify(currentConfig.Rules, null, 2));
  } catch (err) {
    if (err.name === 'NoSuchLifecycleConfiguration') {
      console.log('No lifecycle configuration currently exists on bucket.');
    } else {
      console.warn('GetBucketLifecycle error:', err.message);
    }
  }

  // 1 year = 365 days (configurable via DATA_RETENTION_DAYS)
  const retentionDays = Number(process.env.DATA_RETENTION_DAYS) || Number(process.env.RECORDING_RETENTION_DAYS) || 365;
  console.log(`Setting 1-year (${retentionDays} days) auto-delete lifecycle expiration rule on bucket: ${bucket}...`);

  const putParams = {
    Bucket: bucket,
    LifecycleConfiguration: {
      Rules: [
        {
          ID: 'AutoDeleteAudioRecordingsAfter1Year',
          Status: 'Enabled',
          Filter: {
            Prefix: '', // Apply to all recording audio files in the bucket
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
  };

  try {
    await s3.send(new PutBucketLifecycleConfigurationCommand(putParams));
    console.log(` Successfully configured S3 Bucket Lifecycle: Auto-delete recordings after ${retentionDays} days (1 year)!`);

    // Verify
    const updatedConfig = await s3.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }));
    console.log('Updated Verified Rules:', JSON.stringify(updatedConfig.Rules, null, 2));
  } catch (err) {
    console.error('Failed to update bucket lifecycle:', err);
  }
}

checkAndApplyLifecycle();
