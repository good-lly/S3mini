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
  createHmac: Function;
  createHash: Function;
}

export interface Logger {
  info: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
}

export interface UploadPart {
  partNumber: number;
  ETag: string;
}

export interface CompleteMultipartUploadResult {
  Location: string;
  Bucket: string;
  Key: string;
  ETag: string;
}

export type HttpMethod = 'POST' | 'GET' | 'HEAD' | 'PUT' | 'DELETE';

// false - Not found (404)
// true - Found (200)
// null - ETag mismatch (412)
export type ExistResponseCode = false | true | null;
