export interface S3Config {
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  bucketName: string;
  region?: string;
  maxRequestSizeInBytes?: number;
  requestAbortTimeout?: number;
  logger?: Logger;
}

declare global {
  interface Crypto {
    createHmac: (
      algorithm: string,
      key: string | Buffer,
    ) => {
      update: (data: string | Buffer) => void;
      digest: (encoding?: 'hex' | 'base64' | 'latin1') => string;
    };
    createHash: (algorithm: string) => {
      update: (data: string | Buffer) => void;
      digest: (encoding?: 'hex' | 'base64' | 'latin1') => string;
    };
  }
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
