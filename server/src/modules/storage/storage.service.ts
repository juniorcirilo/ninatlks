import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { PutObjectCommandInput } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const UPLOAD_URL_TTL_SECONDS = 5 * 60;
const DOWNLOAD_URL_TTL_SECONDS = 10 * 60;

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  /** Assina links entregues ao navegador (host público, não o interno do Docker). */
  private readonly signer: S3Client;
  readonly attachmentsBucket: string;

  constructor(private readonly config: ConfigService) {
    this.attachmentsBucket = this.config.get<string>('s3.attachmentsBucket')!;
    const credentials = {
      accessKeyId: this.config.get<string>('s3.accessKey')!,
      secretAccessKey: this.config.get<string>('s3.secretKey')!,
    };
    const endpoint = this.config.get<string>('s3.endpoint');
    this.client = new S3Client({
      endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials,
    });
    const publicEndpoint = this.config.get<string>('s3.publicEndpoint');
    this.signer = publicEndpoint
      ? new S3Client({
          endpoint: publicEndpoint,
          region: 'us-east-1',
          forcePathStyle: true,
          credentials,
        })
      : this.client;
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.send(
        new CreateBucketCommand({ Bucket: this.attachmentsBucket }),
      );
      this.logger.log(`Created bucket "${this.attachmentsBucket}"`);
    } catch (err) {
      const code = (err as { name?: string })?.name;
      if (
        code !== 'BucketAlreadyOwnedByYou' &&
        code !== 'BucketAlreadyExists'
      ) {
        this.logger.warn(
          `Could not ensure bucket "${this.attachmentsBucket}" exists: ${(err as Error).message}`,
        );
      }
    }
  }

  async presignUpload(
    key: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; bucket: string }> {
    const command = new PutObjectCommand({
      Bucket: this.attachmentsBucket,
      Key: key,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(this.signer, command, {
      expiresIn: UPLOAD_URL_TTL_SECONDS,
    });
    return { uploadUrl, bucket: this.attachmentsBucket };
  }

  async presignDownload(
    key: string,
    bucket: string = this.attachmentsBucket,
    ttlSeconds: number = DOWNLOAD_URL_TTL_SECONDS,
  ): Promise<string> {
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    return getSignedUrl(this.signer, command, { expiresIn: ttlSeconds });
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: key }),
    );
  }

  async uploadObject(
    bucket: string,
    key: string,
    body: PutObjectCommandInput['Body'],
    contentType?: string,
  ): Promise<void> {
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch (err) {
      const code = (err as { name?: string })?.name;
      if (
        code !== 'BucketAlreadyOwnedByYou' &&
        code !== 'BucketAlreadyExists'
      ) {
        this.logger.warn(
          `Could not ensure bucket "${bucket}" exists: ${(err as Error).message}`,
        );
      }
    }
    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async getObjectBuffer(bucket: string, key: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    const bytes = await res.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }
}
