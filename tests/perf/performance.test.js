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

import * as dotenv from 'dotenv';
dotenv.config();
