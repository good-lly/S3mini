'use strict';

import { S3 } from './S3.js';
import { sanitizeETag } from './utils.js';

// Export the S3 class as default export and named export
export { S3, sanitizeETag };
export default S3;

// Re-export types
export type {
  S3Config,
  Logger,
  UploadPart,
  CompleteMultipartUploadResult,
  HttpMethod,
  ExistResponseCode,
} from './types.js';
