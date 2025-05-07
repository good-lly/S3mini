import type { createHash as NodeCreateHash, createHmac as NodeCreateHmac } from 'node:crypto';

export interface S3Config {
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  region?: string;
  requestSizeInBytes?: number;
  requestAbortTimeout?: number;
  logger?: Logger;
}

export interface Crypto {
  createHmac: typeof NodeCreateHmac;
  createHash: typeof NodeCreateHash;
}

export interface Logger {
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

export interface UploadPart {
  partNumber: number;
  etag: string;
}

export interface CompleteMultipartUploadResult {
  location: string;
  bucket: string;
  key: string;
  etag: string;
  eTag: string; // for backward compatibility
  ETag: string; // for backward compatibility
}

interface ListBucketResult {
  keyCount: string;
  contents?: Array<Record<string, unknown>>;
}
interface ListBucketError {
  error: { code: string; message: string };
}

export type ListBucketResponse = { listBucketResult: ListBucketResult } | { error: ListBucketError };

export interface ListMultipartUploadSuccess {
  listMultipartUploadsResult: {
    bucket: string;
    key: string;
    uploadId: string;
    size?: number;
    mtime?: Date | undefined;
    etag?: string;
    eTag?: string; // for backward compatibility
    parts: UploadPart[];
    isTruncated: boolean;
    uploads: UploadPart[];
  };
}

export interface MultipartUploadError {
  error: {
    code: string;
    message: string;
  };
}

export interface ErrorWithCode {
  code?: string;
  cause?: { code?: string };
}

export type ListMultipartUploadResponse = ListMultipartUploadSuccess | MultipartUploadError;

export type HttpMethod = 'POST' | 'GET' | 'HEAD' | 'PUT' | 'DELETE';

// false - Not found (404)
// true - Found (200)
// null - ETag mismatch (412)
export type ExistResponseCode = false | true | null;

export type XmlValue = string | XmlMap | boolean | number | null;
export interface XmlMap {
  [key: string]: XmlValue | XmlValue[]; // one or many children
  [key: number]: XmlValue | XmlValue[]; // allow numeric keys
}
