'use strict';

// Constants
const AWS_ALGORITHM = 'AWS4-HMAC-SHA256';
const AWS_REQUEST_TYPE = 'aws4_request';
const S3_SERVICE = 's3';
const LIST_TYPE = '2';
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';
const DEFAULT_STREAM_CONTENT_TYPE = 'application/octet-stream';
const XML_CONTENT_TYPE = 'application/xml';
const JSON_CONTENT_TYPE = 'application/json';
// List of keys that might contain sensitive information
const SENSITIVE_KEYS_REDACTED = ['accessKeyId', 'secretAccessKey', 'sessionToken', 'password'];
const MIN_MAX_REQUEST_SIZE_IN_BYTES = 5 * 1024 * 1024;

// Headers
const HEADER_AMZ_CONTENT_SHA256 = 'x-amz-content-sha256';
const HEADER_AMZ_DATE = 'x-amz-date';
const HEADER_HOST = 'host';
const HEADER_AUTHORIZATION = 'Authorization';
const HEADER_CONTENT_TYPE = 'Content-Type';
const HEADER_CONTENT_LENGTH = 'Content-Length';
const HEADER_ETAG = 'etag';
const HEADER_LAST_MODIFIED = 'last-modified';

// Error messages
const ERROR_PREFIX = 'core-s3 lib: ';
const ERROR_ACCESS_KEY_REQUIRED = `${ERROR_PREFIX}accessKeyId must be a non-empty string`;
const ERROR_SECRET_KEY_REQUIRED = `${ERROR_PREFIX}secretAccessKey must be a non-empty string`;
const ERROR_ENDPOINT_REQUIRED = `${ERROR_PREFIX}endpoint must be a non-empty string`;
const ERROR_BUCKET_NAME_REQUIRED = `${ERROR_PREFIX}bucketName must be a non-empty string`;
const ERROR_KEY_REQUIRED = `${ERROR_PREFIX}key must be a non-empty string`;
const ERROR_UPLOAD_ID_REQUIRED = `${ERROR_PREFIX}uploadId must be a non-empty string`;
const ERROR_PARTS_REQUIRED = `${ERROR_PREFIX}parts must be a non-empty array`;
const ERROR_INVALID_PART = `${ERROR_PREFIX}Each part must have a partNumber (number) and ETag (string)`;
const ERROR_DATA_BUFFER_REQUIRED = `${ERROR_PREFIX}data must be a Buffer or string`;
// const ERROR_PATH_REQUIRED = `${ERROR_PREFIX}path must be a string`;
const ERROR_PREFIX_TYPE = `${ERROR_PREFIX}prefix must be a string`;
const ERROR_MAX_KEYS_TYPE = `${ERROR_PREFIX}maxKeys must be a positive integer`;
const ERROR_DELIMITER_REQUIRED = `${ERROR_PREFIX}delimiter must be a string`;

// const STATUS_CODES: Record<number, string> = {
//   200: 'OK',
//   204: 'No Content',
//   205: 'Reset Content',
//   206: 'Partial Content',
//   301: 'Moved Permanently',
//   302: 'Found',
//   400: 'Bad Request',
//   401: 'Unauthorized',
//   403: 'Forbidden',
//   404: 'Not Found',
//   418: "I'm a Teapot",
//   428: 'Precondition Required',
//   429: 'Too Many Requests',
//   500: 'Internal Server Error',
//   501: 'Not Implemented',
// };

interface S3Config {
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

interface Logger {
  info: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
}

interface UploadPart {
  partNumber: number;
  ETag: string;
}

interface CompleteMultipartUploadResult {
  Location: string;
  Bucket: string;
  Key: string;
  ETag: string;
}

type HttpMethod = 'POST' | 'GET' | 'HEAD' | 'PUT' | 'DELETE';

// false - Not found (404)
// true - Found (200)
// null - ETag mismatch (412)
type ExistResponseCode = false | true | null;

// the old way to work with crypto (no browser support)
let _createHmac = crypto.createHmac || (await import('node:crypto')).createHmac;
let _createHash = crypto.createHash || (await import('node:crypto')).createHash;

if (typeof _createHmac === 'undefined' && typeof _createHash === 'undefined') {
  console.error(
    'mini-S3 Module: Crypto functions are not available, please report the issue with necessary description: https://github.com/mini-s3/issues',
  );
}

const expectArray: { [key: string]: boolean } = {
  contents: true,
};

const encodeAsHex = (c: string): string => `%${c.charCodeAt(0).toString(16).toUpperCase()}`;

const uriEscape = (uriStr: string): string => {
  return encodeURIComponent(uriStr).replace(/[!'()*]/g, encodeAsHex);
};

const uriResourceEscape = (string: string): string => {
  return uriEscape(string).replace(/%2F/g, '/');
};

/**
 * S3 class for interacting with S3-compatible object storage services.
 * This class provides methods for common S3 operations such as uploading, downloading,
 * and deleting objects, as well as multipart uploads.
 *
 * @class
 * @example
 * const s3 = new S3({
 *   accessKeyId: 'your-access-key',
 *   secretAccessKey: 'your-secret-key',
 *   endpoint: 'https://your-s3-endpoint.com',
 *   bucketName: 'your-bucket-name',
 *   region: 'us-east-1' // by default is auto
 * });
 *
 * // Upload a file
 * await s3.put('example.txt', 'Hello, World!');
 *
 * // Download a file
 * const content = await s3.get('example.txt');
 *
 * // Delete a file
 * await s3.delete('example.txt');
 */
class S3 {
  /**
   * Creates an instance of the S3 class.
   *
   * @constructor
   * @param {Object} config - Configuration options for the S3 instance.
   * @param {string} config.accessKeyId - The access key ID for authentication.
   * @param {string} config.secretAccessKey - The secret access key for authentication.
   * @param {string} config.endpoint - The endpoint URL of the S3-compatible service.
   * @param {string} [config.bucketName=''] - The name of the bucket to operate on.
   * @param {string} [config.region='auto'] - The region of the S3 service.
   * @param {number} [config.maxRequestSizeInBytes=5242880] - The maximum size of a single request in bytes (minimum for AWS S3 is 5MB).
   * @param {number} [config.requestAbortTimeout=undefined] - The timeout in milliseconds after which a request should be aborted (careful on streamed requests).
   * @param {Object} [config.logger=null] - A logger object with methods like info, warn, error.
   * @throws {TypeError} Will throw an error if required parameters are missing or of incorrect type.
   */
  private accessKeyId: string;
  private secretAccessKey: string;
  private endpoint: string;
  private bucketName: string;
  private region: string;
  private maxRequestSizeInBytes: number;
  private requestAbortTimeout?: number;
  private logger?: Logger;

  constructor({
    accessKeyId,
    secretAccessKey,
    endpoint,
    bucketName,
    region = 'auto',
    maxRequestSizeInBytes = MIN_MAX_REQUEST_SIZE_IN_BYTES,
    requestAbortTimeout = undefined,
    logger = undefined,
  }: S3Config) {
    this._validateConstructorParams(accessKeyId, secretAccessKey, endpoint, bucketName);
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.endpoint = endpoint;
    this.bucketName = bucketName;
    this.region = region;
    this.maxRequestSizeInBytes = maxRequestSizeInBytes;
    this.requestAbortTimeout = requestAbortTimeout;
    this.logger = logger;
  }

  private _validateConstructorParams(
    accessKeyId: string,
    secretAccessKey: string,
    endpoint: string,
    bucketName: string,
  ): void {
    if (typeof accessKeyId !== 'string' || accessKeyId.trim().length === 0)
      throw new TypeError(ERROR_ACCESS_KEY_REQUIRED);
    if (typeof secretAccessKey !== 'string' || secretAccessKey.trim().length === 0)
      throw new TypeError(ERROR_SECRET_KEY_REQUIRED);
    if (typeof endpoint !== 'string' || endpoint.trim().length === 0) throw new TypeError(ERROR_ENDPOINT_REQUIRED);
    if (typeof bucketName !== 'string' || bucketName.trim().length === 0)
      throw new TypeError(ERROR_BUCKET_NAME_REQUIRED);
  }

  private _checkMethodHeadnGet(method: string): void {
    if (method !== 'GET' && method !== 'HEAD') {
      this._log('error', `${ERROR_PREFIX}method must be either GET or HEAD`);
      throw new Error('method must be either GET or HEAD');
    }
  }

  private _checkKey(key: string): void {
    if (typeof key !== 'string' || key.trim().length === 0) {
      this._log('error', ERROR_KEY_REQUIRED);
      throw new TypeError(ERROR_KEY_REQUIRED);
    }
  }

  private _checkDelimiter(delimiter: string): void {
    if (typeof delimiter !== 'string' || delimiter.trim().length === 0) {
      this._log('error', ERROR_DELIMITER_REQUIRED);
      throw new TypeError(ERROR_DELIMITER_REQUIRED);
    }
  }

  private _checkPrefix(prefix: string): void {
    if (typeof prefix !== 'string') {
      this._log('error', ERROR_PREFIX_TYPE);
      throw new TypeError(ERROR_PREFIX_TYPE);
    }
  }

  private _checkMaxKeys(maxKeys: number): void {
    if (typeof maxKeys !== 'number' || maxKeys <= 0) {
      this._log('error', ERROR_MAX_KEYS_TYPE);
      throw new TypeError(ERROR_MAX_KEYS_TYPE);
    }
  }

  private _checkOpts(opts: Record<string, any>): void {
    if (typeof opts !== 'object') {
      this._log('error', `${ERROR_PREFIX}opts must be an object`);
      throw new TypeError(`${ERROR_PREFIX}opts must be an object`);
    }
  }

  /**
   * Internal method to log messages with sanitized sensitive information.
   * @param {string} level - The log level (e.g., 'info', 'warn', 'error').
   * @param {string} message - The message to log.
   * @param {Object} [additionalData={}] - Additional data to include in the log.
   * @private
   */
  private _log(
    level: 'info' | 'warn' | 'error',
    message: string,
    additionalData: Record<string, any> | string = {},
  ): void {
    if (this.logger && typeof this.logger[level] === 'function') {
      // Function to recursively sanitize an object
      const sanitize = (obj: any): any => {
        if (typeof obj !== 'object' || obj === null) {
          return obj;
        }
        return Object.keys(obj).reduce(
          (acc: any, key) => {
            if (SENSITIVE_KEYS_REDACTED.includes(key.toLowerCase())) {
              acc[key] = '[REDACTED]';
            } else if (typeof obj[key] === 'object' && obj[key] !== null) {
              acc[key] = sanitize(obj[key]);
            } else {
              acc[key] = obj[key];
            }
            return acc;
          },
          Array.isArray(obj) ? [] : {},
        );
      };

      // Sanitize the additional data
      const sanitizedData = sanitize(additionalData);
      // Prepare the log entry
      const logEntry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        ...sanitizedData,
        // Include some general context, but sanitize sensitive parts
        context: sanitize({
          bucketName: this.bucketName,
          region: this.region,
          endpoint: this.endpoint,
          // Only include the first few characters of the access key, if it exists
          accessKeyId: this.accessKeyId ? `${this.accessKeyId.substring(0, 4)}...` : undefined,
        }),
      };

      // Log the sanitized entry
      this.logger[level](logEntry);
    }
  }

  getBucketName = () => this.bucketName;
  setBucketName = (bucketName: string) => {
    this.bucketName = bucketName;
  };
  getRegion = () => this.region;
  setRegion = (region: string) => {
    this.region = region;
  };
  getEndpoint = () => this.endpoint;
  setEndpoint = (endpoint: string) => {
    this.endpoint = endpoint;
  };
  getMaxRequestSizeInBytes = () => this.maxRequestSizeInBytes;
  setMaxRequestSizeInBytes = (maxRequestSizeInBytes: number) => {
    this.maxRequestSizeInBytes = maxRequestSizeInBytes;
  };
  sanitizeETag = (etag: string): string => sanitizeETag(etag);

  getProps = () => ({
    accessKeyId: this.accessKeyId,
    secretAccessKey: this.secretAccessKey,
    region: this.region,
    bucket: this.bucketName,
    endpoint: this.endpoint,
    maxRequestSizeInBytes: this.maxRequestSizeInBytes,
    requestAbortTimeout: this.requestAbortTimeout,
    logger: this.logger,
  });
  setProps = (props: S3Config) => {
    this._validateConstructorParams(props.accessKeyId, props.secretAccessKey, props.bucketName, props.endpoint);
    this.accessKeyId = props.accessKeyId;
    this.secretAccessKey = props.secretAccessKey;
    this.region = props.region || 'auto';
    this.bucketName = props.bucketName;
    this.endpoint = props.endpoint;
    this.maxRequestSizeInBytes = props.maxRequestSizeInBytes || MIN_MAX_REQUEST_SIZE_IN_BYTES;
    this.requestAbortTimeout = props.requestAbortTimeout;
    this.logger = props.logger;
  };

  /**
   * Get the content length of an object.
   * @param {string} key - The key of the object.
   * @returns {Promise<number>} The content length of the object in bytes.
   * @throws {TypeError} If the key is not a non-empty string.
   */
  async getContentLength(key: string): Promise<number> {
    this._checkKey(key);
    const headers = {
      [HEADER_AMZ_CONTENT_SHA256]: UNSIGNED_PAYLOAD,
    };
    const encodedKey = uriResourceEscape(key);
    const { url, headers: signedHeaders } = await this._sign('HEAD', encodedKey, {}, headers, '');
    const res = await this._sendRequest(url, 'HEAD', signedHeaders);
    const contentLength = res.headers.get(HEADER_CONTENT_LENGTH);
    return contentLength ? parseInt(contentLength, 10) : 0;
  }

  /**
   * Check if a bucket exists.
   * @returns {Promise<boolean>} True if the bucket exists, false otherwise.
   */
  async bucketExists(): Promise<boolean> {
    const headers = {
      [HEADER_AMZ_CONTENT_SHA256]: UNSIGNED_PAYLOAD,
    };
    const { url, headers: signedHeaders } = await this._sign('HEAD', '', {}, headers, '');
    const res = await this._sendRequest(url, 'HEAD', signedHeaders, '', [200, 404, 403]);
    this._log('error', `Response status: ${(res.status, res.statusText)}`);
    if (res.ok && res.status === 200) {
      return true;
    }
    return false;
  }

  // TBD
  async createBucket(): Promise<boolean> {
    const xmlBody = `
    <CreateBucketConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
      <LocationConstraint>${this.region}</LocationConstraint>
    </CreateBucketConfiguration>
    `;
    const headers = {
      [HEADER_CONTENT_TYPE]: XML_CONTENT_TYPE,
      [HEADER_CONTENT_LENGTH]: Buffer.byteLength(xmlBody).toString(),
      [HEADER_AMZ_CONTENT_SHA256]: await _hash(xmlBody),
    };
    const encodedKey = encodeURI('');
    const { url, headers: signedHeaders } = await this._sign('PUT', encodedKey, {}, headers, '');
    const res = await this._sendRequest(url, 'PUT', signedHeaders, xmlBody, [200, 404, 403]);
    if (res.ok && res.status === 200) {
      return true;
    }
    return false;
  }

  /**
   * Check if a file exists in the bucket.
   * @param {string} key - The key of the object.
   * @param {Object} [opts={}] - Additional options for the fileExists operation.
   * @returns {Promise<ExistResponseCode>} True if the file exists, false otherwise. 0 - Not found (404), 1 - Found (200), 2 - ETag mismatch (412).
   * @throws {TypeError} If the key is not a non-empty string.
   */
  async fileExists(key: string, opts: Record<string, any> = {}): Promise<ExistResponseCode> {
    this._checkKey(key);
    const { filteredOpts, conditionalHeaders } = this._filterIfHeaders(opts);
    const headers = { [HEADER_AMZ_CONTENT_SHA256]: UNSIGNED_PAYLOAD, ...conditionalHeaders };
    const encodedKey = uriResourceEscape(key);
    const { url, headers: signedHeaders } = await this._sign('HEAD', encodedKey, filteredOpts, headers, '');
    try {
      const res = await this._sendRequest(url, 'HEAD', signedHeaders, '', [200, 404, 412, 304]);
      if (res.status === 404) {
        return false;
      }
      if (res.status === 412 || res.status === 304) {
        return null;
      }
      if (res.ok && res.status === 200) return true;
      else this._handleErrorResponse(res);
      return false; // should never happen
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this._log('error', `${ERROR_PREFIX}Failed to check if file exists: ${errorMessage}`);
      throw new Error(`${ERROR_PREFIX}Failed to check if file exists: ${errorMessage}`);
    }
  }
  private async _sign(
    method: HttpMethod,
    keyPath: string,
    query: Object = {},
    headers: Record<string, string | number>,
    body: string | Buffer,
  ): Promise<{ url: string; headers: Record<string, any> }> {
    const datetime = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const url =
      typeof keyPath === 'string' && keyPath.length > 0 ? new URL(keyPath, this.endpoint) : new URL(this.endpoint);
    url.pathname = `/${encodeURI(this.bucketName)}${url.pathname}`;
    headers[HEADER_AMZ_CONTENT_SHA256] = body ? await _hash(body) : UNSIGNED_PAYLOAD;
    headers[HEADER_AMZ_DATE] = datetime;
    headers[HEADER_HOST] = url.host;
    const canonicalHeaders = this._buildCanonicalHeaders(headers);
    const signedHeaders = Object.keys(headers)
      .map(key => key.toLowerCase())
      .sort()
      .join(';');

    const canonicalRequest = await this._buildCanonicalRequest(
      method,
      url,
      query,
      canonicalHeaders,
      signedHeaders,
      body,
    );
    const stringToSign = await this._buildStringToSign(datetime, canonicalRequest);
    const signature = await this._calculateSignature(datetime, stringToSign);
    const authorizationHeader = this._buildAuthorizationHeader(datetime, signedHeaders, signature);
    headers[HEADER_AUTHORIZATION] = authorizationHeader;
    return { url: url.toString(), headers };
  }

  private _buildCanonicalHeaders(headers: Record<string, string | number>): string {
    return Object.entries(headers)
      .map(([key, value]) => `${key.toLowerCase()}:${String(value).trim()}`)
      .sort()
      .join('\n');
  }

  async _buildCanonicalRequest(
    method: HttpMethod,
    url: URL,
    query: Object,
    canonicalHeaders: string,
    signedHeaders: string,
    body: string | Buffer,
  ): Promise<string> {
    return [
      method,
      url.pathname,
      this._buildCanonicalQueryString(query),
      `${canonicalHeaders}\n`,
      signedHeaders,
      body ? await _hash(body) : UNSIGNED_PAYLOAD,
    ].join('\n');
  }

  async _buildStringToSign(datetime: string, canonicalRequest: string): Promise<string> {
    const credentialScope = [datetime.slice(0, 8), this.region, S3_SERVICE, AWS_REQUEST_TYPE].join('/');
    return [AWS_ALGORITHM, datetime, credentialScope, await _hash(canonicalRequest)].join('\n');
  }

  async _calculateSignature(datetime: string, stringToSign: string): Promise<string> {
    const signingKey = await this._getSignatureKey(datetime.slice(0, 8));
    return _hmac(signingKey, stringToSign, 'hex');
  }

  private _buildAuthorizationHeader(datetime: string, signedHeaders: string, signature: string): string {
    const credentialScope = [datetime.slice(0, 8), this.region, S3_SERVICE, AWS_REQUEST_TYPE].join('/');
    return [
      `${AWS_ALGORITHM} Credential=${this.accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(', ');
  }

  private _filterIfHeaders(opts: Record<string, any>): {
    filteredOpts: Record<string, any>;
    conditionalHeaders: Record<string, string>;
  } {
    const filteredOpts: Record<string, any> = {};
    const conditionalHeaders: Record<string, string> = {};
    const ifHeaders = ['if-match', 'if-none-match', 'if-modified-since', 'if-unmodified-since'];

    for (const [key, value] of Object.entries(opts)) {
      if (ifHeaders.includes(key)) {
        conditionalHeaders[key] = value;
      } else {
        filteredOpts[key] = value;
      }
    }

    return { filteredOpts, conditionalHeaders };
  }
  /**
   * List objects in the bucket.
   * @param {string} [delimiter='/'] - The delimiter to use for grouping objects in specific path.
   * @param {string} [prefix=''] - The prefix to filter objects in specific path.
   * @param {number} [maxKeys=1000] - The maximum number of keys to return.
   * @param {string} [method='GET'] - The HTTP method to use (GET or HEAD).
   * @param {Object} [opts={}] - Additional options for the list operation.
   * @returns {Promise<Object|Array>} The list of objects or object metadata.
   * @throws {TypeError} If any of the parameters are of incorrect type.
   */
  async list(
    delimiter: string = '/',
    prefix: string = '',
    maxKeys: number = 1000,
    method: HttpMethod = 'GET',
    opts: Object = {},
  ): Promise<Object | Array<Object>> {
    this._checkDelimiter(delimiter);
    this._checkPrefix(prefix);
    this._checkMaxKeys(maxKeys);
    this._checkMethodHeadnGet(method);
    this._checkOpts(opts);
    this._log('info', `Listing objects in ${prefix}`);

    const query = {
      'list-type': LIST_TYPE,
      'max-keys': String(maxKeys),
      ...opts,
    } as { [key: string]: any };
    if (prefix.length > 0) {
      query['prefix'] = prefix;
    }
    const headers = {
      [HEADER_CONTENT_TYPE]: JSON_CONTENT_TYPE,
      [HEADER_AMZ_CONTENT_SHA256]: UNSIGNED_PAYLOAD,
    };
    const encodedKey = delimiter === '/' ? delimiter : uriEscape(delimiter);
    const { url, headers: signedHeaders } = await this._sign('GET', encodedKey, query, headers, '');
    const urlWithQuery = `${url}?${new URLSearchParams(query)}`;
    const res = await this._sendRequest(urlWithQuery, 'GET', signedHeaders);
    const responseBody = await res.text();

    if (method === 'HEAD') {
      const contentLength = res.headers.get(HEADER_CONTENT_LENGTH);
      const lastModified = res.headers.get(HEADER_LAST_MODIFIED);
      const etag = res.headers.get(HEADER_ETAG);

      return {
        size: contentLength ? +contentLength : undefined,
        mtime: lastModified ? new Date(lastModified) : undefined,
        ETag: etag || undefined,
      };
    }

    const data = _parseXml(responseBody);
    const output = data.listBucketResult || data.error || data;
    return output.contents || output;
  }

  /**
   * List multipart uploads in the bucket.
   * @param {string} [delimiter='/'] - The delimiter to use for grouping objects in specific path.
   * @param {string} [prefix=''] - The prefix to filter objects in specific path.
   * @param {string} [method='GET'] - The HTTP method to use (GET or HEAD).
   * @param {Object} [opts={}] - Additional options for the list operation.
   * @returns {Promise<Object|Array>} The list of objects or object metadata.
   * @throws {TypeError} If any of the parameters are of incorrect type.
   */
  async listMultiPartUploads(
    delimiter: string = '/',
    prefix: string = '',
    method: HttpMethod = 'GET',
    opts: Object = {},
  ): Promise<any> {
    this._checkDelimiter(delimiter);
    this._checkPrefix(prefix);
    this._checkMethodHeadnGet(method);
    this._checkOpts(opts);
    this._log('info', `Listing multipart uploads in ${prefix}`);

    const query = {
      uploads: '',
      ...opts,
    } as Record<string, any>;
    const headers = {
      [HEADER_CONTENT_TYPE]: JSON_CONTENT_TYPE,
      [HEADER_AMZ_CONTENT_SHA256]: UNSIGNED_PAYLOAD,
    };
    const encodedKey = delimiter === '/' ? delimiter : uriEscape(delimiter);
    const { url, headers: signedHeaders } = await this._sign('GET', encodedKey, query, headers, '');
    const urlWithQuery = `${url}?${new URLSearchParams(query)}`;
    const res = await this._sendRequest(urlWithQuery, 'GET', signedHeaders);
    const responseBody = await res.text();

    if (method === 'HEAD') {
      return {
        size: +(res.headers.get(HEADER_CONTENT_LENGTH) ?? '0'),
        mtime: new Date(res.headers.get(HEADER_LAST_MODIFIED) ?? ''),
        ETag: res.headers.get(HEADER_ETAG) ?? '',
      };
    }

    const data = _parseXml(responseBody);
    const output = data.listMultipartUploadsResult || data.error || data;
    return output.uploads || output;
  }

  /**
   * Get an object from the bucket.
   * @param {string} key - The key of the object to get.
   * @param {Object} [opts={}] - Additional options for the get operation.
   * @returns {Promise<Response | null>} The response of the object. If the object does not exist, null will be returned.
   */
  async get(key: string, opts: Record<string, any> = {}): Promise<Response | null> {
    this._checkKey(key);
    this._log('info', `Getting object ${key}`);
    const { filteredOpts, conditionalHeaders } = this._filterIfHeaders(opts);
    const headers = {
      [HEADER_CONTENT_TYPE]: JSON_CONTENT_TYPE,
      [HEADER_AMZ_CONTENT_SHA256]: UNSIGNED_PAYLOAD,
      ...conditionalHeaders,
    };
    const encodedKey = uriResourceEscape(key);
    const { url, headers: signedHeaders } = await this._sign('GET', encodedKey, filteredOpts, headers, '');
    const res = await this._sendRequest(url, 'GET', signedHeaders, '', [200, 404, 412, 304]);
    if (res.status === 404 || res.status === 412 || res.status === 304) {
      this._log('error', `Failed to get object. Status: ${res.status}`);
      return null;
    }
    if (!res.ok) {
      this._log('error', `Failed to get object. Status: ${res.status}`);
      throw new Error(`Failed to get object. Status: ${res.status}`);
    }
    return res;
  }

  /**
   *
   * @param {string} key - The key of the object to get.
   * @param {Object} [opts={}] - Additional options for the get operation.
   * @returns {Promise<{ etag: string|null; data: string|null }>} The content of the object. If the object does not exist, etag and data will be null.
   */
  async getObjectWithETag(
    key: string,
    opts: Record<string, any> = {},
  ): Promise<{ etag: string | null; data: string | null }> {
    this._checkKey(key);
    this._log('info', `Getting object ${key}`);
    const { filteredOpts, conditionalHeaders } = this._filterIfHeaders(opts);
    const headers = {
      [HEADER_CONTENT_TYPE]: JSON_CONTENT_TYPE,
      [HEADER_AMZ_CONTENT_SHA256]: UNSIGNED_PAYLOAD,
      ...conditionalHeaders,
    };
    const encodedKey = uriResourceEscape(key);
    const { url, headers: signedHeaders } = await this._sign('GET', encodedKey, filteredOpts, headers, '');
    try {
      const res = await this._sendRequest(url, 'GET', signedHeaders, '', [200, 404, 412, 304]);
      if (res.status === 404 || res.status === 412 || res.status === 304) {
        this._log('error', `Failed to get object. Status: ${res.status}`);
        return { etag: null, data: null };
      }
      if (!res.ok) {
        this._log('error', `Failed to get object. Status: ${res.status}`);
        throw new Error(`Failed to get object. Status: ${res.status}`);
      }

      const etag = res.headers.get('etag');
      if (!etag) {
        throw new Error('ETag not found in response headers');
      }
      const data = await res.text();
      return { etag: sanitizeETag(etag), data };
    } catch (error) {
      this._log('error', `Error getting object ${key} with ETag: ${error}`);
      throw error;
    }
  }

  /**
   * Get the ETag of an object.
   * @param {string} key - The key of the object to get.
   * @param {Object} [opts={}] - Additional options for the get operation.
   * @returns {Promise<string|null>} The ETag of the object or null if the object etag does not match.
   */
  async getEtag(key: string, opts: Record<string, any> = {}): Promise<string | null> {
    this._checkKey(key);
    this._log('info', `Getting etag object ${key}`);
    const { filteredOpts, conditionalHeaders } = this._filterIfHeaders(opts);
    const headers = {
      [HEADER_CONTENT_TYPE]: JSON_CONTENT_TYPE,
      [HEADER_AMZ_CONTENT_SHA256]: UNSIGNED_PAYLOAD,
      ...conditionalHeaders,
    };
    const encodedKey = uriResourceEscape(key);
    const { url, headers: signedHeaders } = await this._sign('HEAD', encodedKey, filteredOpts, headers, '');

    const res = await this._sendRequest(url, 'HEAD', signedHeaders, '', [200, 412, 304]);
    this._log('info', `Response status: ${(res.status, res.statusText)}`);
    // etag does not match
    if (res.status === 412 || res.status === 304) {
      return null;
    }

    const etag = res.headers.get('etag');
    if (!etag) {
      this._log('error', `ETag not found in response headers`);
      throw new Error(`ETag not found in response headers`);
    }
    return sanitizeETag(etag);
  }

  /**
   * Get a response of an object from the bucket.
   * @param {string} key - The key of the object to get.
   * @param {boolean} [wholeFile=true] - Whether to get the whole file or a part.
   * @param {number} [rangeFrom=0] - The range from to get if not getting the whole file.
   * @param {number} [rangeTo=this.maxRequestSizeInBytes] - The range to to get if not getting the whole file. Note: rangeTo is inclusive.
   * @param {Object} [opts={}] - Additional options for the get operation.
   * @returns {Promise<Response>} Response of the object content. Use readableStream() to get the stream from .body.
   */
  async getResponse(
    key: string,
    wholeFile: boolean = true,
    rangeFrom: number = 0,
    rangeTo: number = this.maxRequestSizeInBytes,
    opts: Record<string, any> = {},
  ): Promise<Response> {
    this._checkKey(key);
    const { filteredOpts, conditionalHeaders } = this._filterIfHeaders({ ...opts });
    const headers = {
      [HEADER_CONTENT_TYPE]: JSON_CONTENT_TYPE,
      [HEADER_AMZ_CONTENT_SHA256]: UNSIGNED_PAYLOAD,
      ...(wholeFile ? {} : { range: `bytes=${rangeFrom}-${rangeTo - 1}` }),
      ...conditionalHeaders,
    };
    const encodedKey = uriResourceEscape(key);
    const { url, headers: signedHeaders } = await this._sign('GET', encodedKey, filteredOpts, headers, '');
    const urlWithQuery = `${url}?${new URLSearchParams(filteredOpts)}`;

    return this._sendRequest(urlWithQuery, 'GET', signedHeaders);
  }

  /**
   * Put an object into the bucket.
   * @param {string} key - The key of the object to put. To create a folder, include a trailing slash.
   * @param {Buffer|string} data - The content of the object to put.
   * @returns {Promise<Response>} The response from the put operation.
   * @throws {TypeError} If the key is not a non-empty string or data is not a Buffer or string.
   */
  async put(key: string, data: string | Buffer): Promise<Response> {
    this._checkKey(key);
    if (!(data instanceof Buffer || typeof data === 'string')) {
      this._log('error', ERROR_DATA_BUFFER_REQUIRED);
      throw new TypeError(ERROR_DATA_BUFFER_REQUIRED);
    }
    // const encodedKey = encodeURIComponent(key);
    this._log('info', `Uploading object ${key}`);
    const contentLength = typeof data === 'string' ? Buffer.byteLength(data) : data.length;
    const headers = {
      [HEADER_CONTENT_LENGTH]: contentLength,
    };
    const encodedKey = uriResourceEscape(key);
    const { url, headers: signedHeaders } = await this._sign('PUT', encodedKey, {}, headers, data);
    return this._sendRequest(url, 'PUT', signedHeaders, data, [200]);
  }

  /**
   * Initiate a multipart upload.
   * @param {string} key - The key of the object to upload.
   * @param {string} [fileType='application/octet-stream'] - The MIME type of the file.
   * @returns {Promise<string>} The upload ID for the multipart upload.
   * @throws {TypeError} If the key is not a non-empty string or fileType is not a string.
   * @throws {Error} If the multipart upload initiation fails.
   */
  async getMultipartUploadId(key: string, fileType: string = DEFAULT_STREAM_CONTENT_TYPE): Promise<string> {
    this._checkKey(key);
    if (typeof fileType !== 'string') {
      this._log('error', `${ERROR_PREFIX}fileType must be a string`);
      throw new TypeError(`${ERROR_PREFIX}fileType must be a string`);
    }
    this._log('info', `Initiating multipart upload for object ${key}`);
    const query = { uploads: '' };
    const headers = {
      [HEADER_CONTENT_TYPE]: fileType,
      [HEADER_AMZ_CONTENT_SHA256]: UNSIGNED_PAYLOAD,
    };

    const encodedKey = uriResourceEscape(key);
    const { url, headers: signedHeaders } = await this._sign('POST', encodedKey, query, headers, '');
    const urlWithQuery = `${url}?${new URLSearchParams(query)}`;

    const res = await this._sendRequest(urlWithQuery, 'POST', signedHeaders);
    const responseBody = await res.text();
    const parsedResponse = _parseXml(responseBody);

    if (
      typeof parsedResponse === 'object' &&
      parsedResponse !== null &&
      'error' in parsedResponse &&
      typeof parsedResponse.error === 'object' &&
      parsedResponse.error !== null &&
      'message' in parsedResponse.error
    ) {
      const errorMessage = String(parsedResponse.error.message);
      this._log('error', `${ERROR_PREFIX}Failed to abort multipart upload: ${errorMessage}`);
      throw new Error(`${ERROR_PREFIX}Failed to abort multipart upload: ${errorMessage}`);
    }

    if (typeof parsedResponse === 'object' && parsedResponse !== null) {
      if (!parsedResponse.initiateMultipartUploadResult || !parsedResponse.initiateMultipartUploadResult.uploadId) {
        this._log('error', `${ERROR_PREFIX}Failed to create multipart upload: no uploadId in response`);
        throw new Error(`${ERROR_PREFIX}Failed to create multipart upload: Missing upload ID in response`);
      }

      return parsedResponse.initiateMultipartUploadResult.uploadId;
    } else {
      this._log('error', `${ERROR_PREFIX}Failed to create multipart upload: unexpected response format`);
      throw new Error(`${ERROR_PREFIX}Failed to create multipart upload: Unexpected response format`);
    }
  }

  /**
   * Upload a part in a multipart upload.
   * @param {string} key - The key of the object being uploaded.
   * @param {Buffer|string} data - The content of the part.
   * @param {string} uploadId - The upload ID of the multipart upload.
   * @param {number} partNumber - The part number.
   * @param {Object} [opts={}] - Additional options for the upload.
   * @returns {Promise<Object>} The ETag and part number of the uploaded part.
   * @throws {TypeError} If any of the parameters are of incorrect type.
   */
  async uploadPart(
    key: string,
    data: Buffer | string,
    uploadId: string,
    partNumber: number,
    opts: Object = {},
  ): Promise<UploadPart> {
    this._validateUploadPartParams(key, data, uploadId, partNumber, opts);
    const query = { uploadId, partNumber, ...opts } as { [key: string]: any };
    const headers = {
      [HEADER_CONTENT_LENGTH]: data.length,
    } as { [key: string]: any };

    const encodedKey = uriResourceEscape(key);
    const { url, headers: signedHeaders } = await this._sign('PUT', encodedKey, query, headers, data);
    const urlWithQuery = `${url}?${new URLSearchParams(query)}`;

    const res = await this._sendRequest(urlWithQuery, 'PUT', signedHeaders, data);
    const ETag = sanitizeETag(res.headers.get('etag') || '');
    return { partNumber, ETag };
  }

  private _validateUploadPartParams(
    key: string,
    data: Buffer | string,
    uploadId: string,
    partNumber: number,
    opts: Object,
  ) {
    this._checkKey(key);
    if (!(data instanceof Buffer || typeof data === 'string')) {
      this._log('error', ERROR_DATA_BUFFER_REQUIRED);
      throw new TypeError(ERROR_DATA_BUFFER_REQUIRED);
    }
    if (typeof uploadId !== 'string' || uploadId.trim().length === 0) {
      this._log('error', ERROR_UPLOAD_ID_REQUIRED);
      throw new TypeError(ERROR_UPLOAD_ID_REQUIRED);
    }
    if (!Number.isInteger(partNumber) || partNumber <= 0) {
      this._log('error', `${ERROR_PREFIX}partNumber must be a positive integer`);
      throw new TypeError(`${ERROR_PREFIX}partNumber must be a positive integer`);
    }
    this._checkOpts(opts);
  }

  /**
   * Complete a multipart upload.
   * @param {string} key - The key of the object being uploaded.
   * @param {string} uploadId - The upload ID of the multipart upload.
   * @param {Array<Object>} parts - An array of objects containing PartNumber and ETag for each part.
   * @returns {Promise<Object>} The result of the complete multipart upload operation.
   * @throws {TypeError} If any of the parameters are of incorrect type.
   * @throws {Error} If the complete multipart upload operation fails.
   */
  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: Array<UploadPart>,
  ): Promise<CompleteMultipartUploadResult> {
    this._checkKey(key);
    if (typeof uploadId !== 'string' || uploadId.trim().length === 0) {
      this._log('error', ERROR_UPLOAD_ID_REQUIRED);
      throw new TypeError(ERROR_UPLOAD_ID_REQUIRED);
    }
    if (!Array.isArray(parts) || parts.length === 0) {
      this._log('error', ERROR_PARTS_REQUIRED);
      throw new TypeError(ERROR_PARTS_REQUIRED);
    }
    if (!parts.every(part => typeof part.partNumber === 'number' && typeof part.ETag === 'string')) {
      this._log('error', ERROR_INVALID_PART);
      throw new TypeError(ERROR_INVALID_PART);
    }
    this._log('info', `Complete multipart upload ${uploadId} for object ${key}`);
    const query = { uploadId };
    const xmlBody = this._buildCompleteMultipartUploadXml(parts);
    const headers = {
      [HEADER_CONTENT_TYPE]: XML_CONTENT_TYPE,
      [HEADER_CONTENT_LENGTH]: Buffer.byteLength(xmlBody).toString(),
      [HEADER_AMZ_CONTENT_SHA256]: await _hash(xmlBody),
    };
    const encodedKey = uriResourceEscape(key);
    const { url, headers: signedHeaders } = await this._sign('POST', encodedKey, query, headers, xmlBody);
    const urlWithQuery = `${url}?${new URLSearchParams(query)}`;

    const res = await this._sendRequest(urlWithQuery, 'POST', signedHeaders, xmlBody);
    const responseBody = await res.text();
    const parsedResponse = _parseXml(responseBody);

    if (
      typeof parsedResponse === 'object' &&
      parsedResponse !== null &&
      'error' in parsedResponse &&
      typeof parsedResponse.error === 'object' &&
      parsedResponse.error !== null &&
      'message' in parsedResponse.error
    ) {
      const errorMessage = String(parsedResponse.error.message);
      this._log('error', `${ERROR_PREFIX}Failed to abort multipart upload: ${errorMessage}`);
      throw new Error(`${ERROR_PREFIX}Failed to abort multipart upload: ${errorMessage}`);
    }

    return parsedResponse.completeMultipartUploadResult;
  }

  /**
   * Aborts a multipart upload.
   * @param {string} key - The key of the object being uploaded.
   * @param {string} uploadId - The ID of the multipart upload to abort.
   * @returns {Promise<Object>} - A promise that resolves to the abort response.
   * @throws {Error} If the abort operation fails.
   */
  async abortMultipartUpload(key: string, uploadId: string): Promise<object> {
    // Input validation
    this._checkKey(key);
    if (typeof uploadId !== 'string' || uploadId.trim().length === 0) {
      this._log('error', ERROR_UPLOAD_ID_REQUIRED);
      throw new TypeError(ERROR_UPLOAD_ID_REQUIRED);
    }

    this._log('info', `Aborting multipart upload ${uploadId} for object ${key}`);

    // Prepare the request
    const query = { uploadId };
    const headers = {
      [HEADER_CONTENT_TYPE]: XML_CONTENT_TYPE,
      [HEADER_AMZ_CONTENT_SHA256]: UNSIGNED_PAYLOAD,
    };

    try {
      // Sign and send the request
      const encodedKey = uriResourceEscape(key);
      const { url, headers: signedHeaders } = await this._sign('DELETE', encodedKey, query, headers, '');
      const urlWithQuery = `${url}?${new URLSearchParams(query)}`;

      const res = await this._sendRequest(urlWithQuery, 'DELETE', signedHeaders);

      // Check for successful response
      if (res.ok) {
        const responseBody = await res.text();
        const parsedResponse = _parseXml(responseBody);

        if (
          typeof parsedResponse === 'object' &&
          parsedResponse !== null &&
          'error' in parsedResponse &&
          typeof parsedResponse.error === 'object' &&
          parsedResponse.error !== null &&
          'message' in parsedResponse.error
        ) {
          const errorMessage = String(parsedResponse.error.message);
          this._log('error', `${ERROR_PREFIX}Failed to abort multipart upload: ${errorMessage}`);
          throw new Error(`${ERROR_PREFIX}Failed to abort multipart upload: ${errorMessage}`);
        }

        return {
          status: 'Aborted',
          key,
          uploadId,
          response: parsedResponse,
        };
      } else {
        this._log('error', `${ERROR_PREFIX}Abort request failed with status ${res.status}`);
        throw new Error(`${ERROR_PREFIX}Abort request failed with status ${res.status}`);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this._log('error', `${ERROR_PREFIX}Failed to abort multipart upload for key ${key}: ${errorMessage}`);
      throw new Error(`${ERROR_PREFIX}Failed to abort multipart upload for key ${key}: ${errorMessage}`);
    }
  }

  private _buildCompleteMultipartUploadXml(parts: Array<UploadPart>): string {
    return `
      <CompleteMultipartUpload>
        ${parts
          .map(
            part => `
          <Part>
            <PartNumber>${part.partNumber}</PartNumber>
            <ETag>${part.ETag}</ETag>
          </Part>
        `,
          )
          .join('')}
      </CompleteMultipartUpload>
    `;
  }

  /**
   * Delete an object from the bucket.
   * @param {string} key - The key of the object to delete.
   * @returns {Promise<boolean>} The response from the delete operation. True if the delete operation was successful, false otherwise. Note: The delete operation may return a 204 status code even if the object was not found.
   */
  async delete(key: string): Promise<boolean> {
    this._checkKey(key);
    this._log('info', `Deleting object ${key}`);
    const headers = {
      [HEADER_CONTENT_TYPE]: JSON_CONTENT_TYPE,
      [HEADER_AMZ_CONTENT_SHA256]: UNSIGNED_PAYLOAD,
    };
    const encodedKey = uriResourceEscape(key);
    const { url, headers: signedHeaders } = await this._sign('DELETE', encodedKey, {}, headers, '');
    const res = await this._sendRequest(url, 'DELETE', signedHeaders);
    if (res.status === 204 || res.status === 200) {
      return true;
    }
    return false;
  }

  async _sendRequest(
    url: string,
    method: HttpMethod,
    headers: Record<string, string | any>,
    body?: string | Buffer,
    toleratedStatusCodes: number[] = [],
  ): Promise<Response> {
    this._log('info', `Sending ${method} request to ${url}, headers: ${JSON.stringify(headers)}`);
    // Remove forbidden headers
    // const safeHeaders = { ...headers };
    // delete safeHeaders[HEADER_HOST]; // Browser sets this automatically
    // delete safeHeaders[HEADER_CONTENT_LENGTH]; // Browser sets this based on the body

    const res = await fetch(url, {
      method,
      headers,
      body: ['GET', 'HEAD'].includes(method) ? undefined : body,
      signal: this.requestAbortTimeout !== undefined ? AbortSignal.timeout(this.requestAbortTimeout) : undefined,
    });
    this._log('info', `Response status: ${(res.status, toleratedStatusCodes)}`);
    if (!res.ok && !toleratedStatusCodes.includes(res.status)) {
      await this._handleErrorResponse(res);
    }
    return res;
  }

  async _handleErrorResponse(res: Response) {
    const errorBody = await res.text();
    const errorCode = res.headers.get('x-amz-error-code') || 'Unknown';
    const errorMessage = res.headers.get('x-amz-error-message') || res.statusText;
    this._log(
      'error',
      `${ERROR_PREFIX}Request failed with status ${res.status}: ${errorCode} - ${errorMessage},err body: ${errorBody}`,
    );
    throw new Error(
      `${ERROR_PREFIX}Request failed with status ${res.status}: ${errorCode} - ${errorMessage}, err body: ${errorBody}`,
    );
  }

  _buildCanonicalQueryString(queryParams: Object): string {
    if (Object.keys(queryParams).length < 1) {
      return '';
    }

    return Object.keys(queryParams)
      .sort()
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent((queryParams as any)[key])}`)
      .join('&');
  }
  async _getSignatureKey(dateStamp: string): Promise<string> {
    const kDate = await _hmac(`AWS4${this.secretAccessKey}`, dateStamp);
    const kRegion = await _hmac(kDate, this.region);
    const kService = await _hmac(kRegion, S3_SERVICE);
    return _hmac(kService, AWS_REQUEST_TYPE);
  }
}

const _hash = async (content: string | Buffer): Promise<string> => {
  const hashSum = _createHash('sha256');
  hashSum.update(content);
  return hashSum.digest('hex');
};

const _hmac = async (key: string | Buffer, content: string, encoding?: 'hex'): Promise<string> => {
  const hmacSum = _createHmac('sha256', key);
  hmacSum.update(content);
  return hmacSum.digest(encoding);
};
export const sanitizeETag = (etag: string): string => {
  const replaceChars: Record<string, string> = {
    '"': '',
    '&quot;': '',
    '&#34;': '',
    '&QUOT;': '',
    '&#x00022': '',
  };
  return etag.replace(/^("|&quot;|&#34;)|("|&quot;|&#34;)$/g, m => replaceChars[m] as string);
};

const _parseXml = (str: string): string | object | any => {
  const unescapeXml = (value: string): string => {
    return value
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  };

  const json = {};
  const re = /<(\w)([-\w]+)(?:\/|[^>]*>((?:(?!<\1)[\s\S])*)<\/\1\2)>/gm;
  let match;

  while ((match = re.exec(str))) {
    const [, prefix, key, value] = match;
    const fullKey = prefix.toLowerCase() + key;
    const parsedValue = value != null ? _parseXml(value) : true;

    if (typeof parsedValue === 'string') {
      (json as { [key: string]: any })[fullKey] = sanitizeETag(unescapeXml(parsedValue));
    } else if (Array.isArray((json as { [key: string]: any })[fullKey])) {
      (json as { [key: string]: any })[fullKey].push(parsedValue);
    } else {
      (json as { [key: string]: any })[fullKey] =
        (json as { [key: string]: any })[fullKey] != null
          ? [(json as { [key: string]: any })[fullKey], parsedValue]
          : expectArray[fullKey]
            ? [parsedValue]
            : parsedValue;
    }
  }

  return Object.keys(json).length ? json : unescapeXml(str);
};

export { S3 };
export default S3;
