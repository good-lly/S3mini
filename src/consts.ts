// Constants
export const AWS_ALGORITHM = 'AWS4-HMAC-SHA256';
export const AWS_REQUEST_TYPE = 'aws4_request';
export const S3_SERVICE = 's3';
export const LIST_TYPE = '2';
export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';
export const DEFAULT_STREAM_CONTENT_TYPE = 'application/octet-stream';
export const XML_CONTENT_TYPE = 'application/xml';
export const JSON_CONTENT_TYPE = 'application/json';
// List of keys that might contain sensitive information
export const SENSITIVE_KEYS_REDACTED = ['accessKeyId', 'secretAccessKey', 'sessionToken', 'password', 'token'];
export const MIN_MAX_REQUEST_SIZE_IN_BYTES = 5 * 1024 * 1024;

// Headers
export const HEADER_AMZ_CONTENT_SHA256 = 'x-amz-content-sha256';
export const HEADER_AMZ_DATE = 'x-amz-date';
export const HEADER_HOST = 'host';
export const HEADER_AUTHORIZATION = 'Authorization';
export const HEADER_CONTENT_TYPE = 'Content-Type';
export const HEADER_CONTENT_LENGTH = 'Content-Length';
export const HEADER_ETAG = 'etag';
export const HEADER_LAST_MODIFIED = 'last-modified';

// Error messages
export const ERROR_PREFIX = 'core-s3: ';
export const ERROR_ACCESS_KEY_REQUIRED = `${ERROR_PREFIX}accessKeyId must be a non-empty string`;
export const ERROR_SECRET_KEY_REQUIRED = `${ERROR_PREFIX}secretAccessKey must be a non-empty string`;
export const ERROR_ENDPOINT_REQUIRED = `${ERROR_PREFIX}endpoint must be a non-empty string`;
export const ERROR_BUCKET_NAME_REQUIRED = `${ERROR_PREFIX}bucketName must be a non-empty string`;
export const ERROR_KEY_REQUIRED = `${ERROR_PREFIX}key must be a non-empty string`;
export const ERROR_UPLOAD_ID_REQUIRED = `${ERROR_PREFIX}uploadId must be a non-empty string`;
export const ERROR_PARTS_REQUIRED = `${ERROR_PREFIX}parts must be a non-empty array`;
export const ERROR_INVALID_PART = `${ERROR_PREFIX}Each part must have a partNumber (number) and ETag (string)`;
export const ERROR_DATA_BUFFER_REQUIRED = `${ERROR_PREFIX}data must be a Buffer or string`;
// const ERROR_PATH_REQUIRED = `${ERROR_PREFIX}path must be a string`;
export const ERROR_PREFIX_TYPE = `${ERROR_PREFIX}prefix must be a string`;
export const ERROR_MAX_KEYS_TYPE = `${ERROR_PREFIX}maxKeys must be a positive integer`;
export const ERROR_DELIMITER_REQUIRED = `${ERROR_PREFIX}delimiter must be a string`;
