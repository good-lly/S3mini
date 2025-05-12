'use strict';
import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import * as Minio from 'minio';
import { S3mini } from '../../dist/S3mini.min.js';
import { randomBytes } from 'node:crypto';
import { Bench } from 'tinybench';
import * as dotenv from 'dotenv';
dotenv.config();

const now = new Date();

const credentials = process.env.BUCKET_ENV_MINIO.split(',');
const [provider, ACCESS_KEY, SECRET_KEY, ENDPOINT, REGION] = credentials;
if (!provider || !ACCESS_KEY || !SECRET_KEY || !ENDPOINT || !REGION) {
  throw new Error('BUCKET_ENV_MINIO is not set correctly');
}

const BUCKET_NAME = ENDPOINT.split('/')[3];
const BUCKET = BUCKET_NAME || 'core-s3-dev-local';

const SIZES = {
  small: { key: 'bench-1MiB', buf: randomBytes(1 * 1024 * 1024) },
  medium: { key: 'bench-8MiB', buf: randomBytes(8 * 1024 * 1024) },
  large: { key: 'bench-100MiB', buf: randomBytes(100 * 1024 * 1024) },
};

const bench = new Bench({ iterations: 20, time: 2_000 });

function makeAws() {
  const client = new S3Client({
    region: REGION,
    endpoint: ENDPOINT,
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
    forcePathStyle: true, // needed for MinIO :contentReference[oaicite:0]{index=0}
  });
  return {
    name: 'aws-sdk-v3',
    get: k => client.send(new GetObjectCommand({ Bucket: BUCKET, Key: k })),
    put: (k, b) => client.send(new PutObjectCommand({ Bucket: BUCKET, Key: k, Body: b })),
    list: () => client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: 'bench' })),
    del: k => client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: k })),
  };
}

function makeMinio() {
  const client = new Minio.Client({
    endPoint: new URL(ENDPOINT).hostname,
    port: Number(new URL(ENDPOINT).port),
    useSSL: ENDPOINT.startsWith('https'),
    accessKey: ACCESS_KEY,
    secretKey: SECRET_KEY,
  });
  return {
    name: 'minio-js',
    get: k => client.getObject(BUCKET, k),
    put: (k, b) => client.putObject(BUCKET, k, b, b.length), // :contentReference[oaicite:1]{index=1}
    list: () => client.listObjectsV2(BUCKET, 'bench', true).toArray(),
    del: k => client.removeObject(BUCKET, k),
  };
}

function makeS3mini() {
  const client = new S3mini({
    endpoint: ENDPOINT,
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
    region: 'us-east-1',
  });
  return {
    name: 's3mini',
    get: k => client.getObject(k),
    put: (k, b) => client.putObject(k, b),
    list: () => client.listObjects('/', 'bench'),
    del: k => client.deleteObject(k),
  };
}
