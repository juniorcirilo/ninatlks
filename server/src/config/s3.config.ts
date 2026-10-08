import { registerAs } from '@nestjs/config';

export const s3Config = registerAs('s3', () => ({
  endpoint: process.env.S3_ENDPOINT,
  accessKey: process.env.S3_ACCESS_KEY,
  secretKey: process.env.S3_SECRET_KEY,
  publicEndpoint: process.env.S3_PUBLIC_ENDPOINT || undefined,
  attachmentsBucket: process.env.S3_ATTACHMENTS_BUCKET ?? 'attachments',
}));
