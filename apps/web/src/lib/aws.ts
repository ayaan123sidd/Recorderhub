import { S3Client } from '@aws-sdk/client-s3';

export function getAwsConfig() {
  const region = process.env.AWS_REGION || 'ap-south-1';
  const bucket = process.env.S3_BUCKET_NAME || 'recorderhub';
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID || '';
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || '';

  return { region, bucket, accessKeyId, secretAccessKey };
}

export function getS3Client() {
  const config = getAwsConfig();
  if (!config.accessKeyId || !config.secretAccessKey) return null;

  const client = new S3Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return {
    client,
    bucket: config.bucket,
    region: config.region,
  };
}
