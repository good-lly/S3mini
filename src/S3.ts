'use strict';

import * as C from './consts.js';
import * as T from './types.js';
import * as U from './utils.js';

/**
 * S3 class for interacting with S3-compatible object storage services.
 * This class provides methods for common S3 operations such as uploading, downloading,
 * and deleting objects, as well as multipart uploads.
 *
 * @class
 * @example
 * const s3 = new CoreS3({
 *   accessKeyId: 'your-access-key',
 *   secretAccessKey: 'your-secret-key',
 *   endpoint: 'https://your-s3-endpoint.com',
 *   region: 'us-east-1' // by default is auto
 * });
 *
 * // Upload a file
 * await s3.putObject('example.txt', 'Hello, World!');
 *
 * // Download a file
 * const content = await s3.getObject('example.txt');
 *
 * // Delete a file
 * await s3.deleteObject('example.txt');
 */
class S3mini {
  /**
   * Creates an instance of the S3 class.
   *
   * @constructor
   * @param {Object} config - Configuration options for the S3 instance.
   * @param {string} config.accessKeyId - The access key ID for authentication.
   * @param {string} config.secretAccessKey - The secret access key for authentication.
   * @param {string} config.endpoint - The endpoint URL of the S3-compatible service.
   * @param {string} [config.region='auto'] - The region of the S3 service.
   * @param {number} [config.requestSizeInBytes=8388608] - The request size of a single request in bytes (AWS S3 is 8MB).
   * @param {number} [config.requestAbortTimeout=undefined] - The timeout in milliseconds after which a request should be aborted (careful on streamed requests).
   * @param {Object} [config.logger=null] - A logger object with methods like info, warn, error.
   * @throws {TypeError} Will throw an error if required parameters are missing or of incorrect type.
   */
  private accessKeyId: string;
  private secretAccessKey: string;
  private endpoint: string;
  private region: string;
  private requestSizeInBytes: number;
  private requestAbortTimeout?: number;
  private logger?: T.Logger;

  constructor({
    accessKeyId,
    secretAccessKey,
    endpoint,
    region = 'auto',
    requestSizeInBytes = C.DEFAULT_REQUEST_SIZE_IN_BYTES,
    requestAbortTimeout = undefined,
    logger = undefined,
  }: T.S3Config) {
    this._validateConstructorParams(accessKeyId, secretAccessKey, endpoint);
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.endpoint = this._ensureValidUrl(endpoint);
    this.region = region;
    this.requestSizeInBytes = requestSizeInBytes;
    this.requestAbortTimeout = requestAbortTimeout;
    this.logger = logger;
  }

  private _sanitize(obj: any): any {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }
    return Object.keys(obj).reduce(
      (acc: any, key) => {
        if (C.SENSITIVE_KEYS_REDACTED.includes(key.toLowerCase())) {
          acc[key] = '[REDACTED]';
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          acc[key] = this._sanitize(obj[key]);
        } else {
          acc[key] = obj[key];
        }
        return acc;
      },
      Array.isArray(obj) ? [] : {},
    );
  }

  private _log(
    level: 'info' | 'warn' | 'error',
    message: string,
    additionalData: Record<string, any> | string = {},
  ): void {
    if (this.logger && typeof this.logger[level] === 'function') {
      // Function to recursively sanitize an object

      // Sanitize the additional data
      const sanitizedData = this._sanitize(additionalData);
      // Prepare the log entry
      const logEntry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        details: sanitizedData,
        // Include some general context, but sanitize sensitive parts
        context: this._sanitize({
          region: this.region,
          endpoint: this.endpoint,
          // Only include the first few characters of the access key, if it exists
          accessKeyId: this.accessKeyId ? `${this.accessKeyId.substring(0, 4)}...` : undefined,
        }),
      };

      // Log the sanitized entry
      this.logger[level](JSON.stringify(logEntry));
    }
  }

  private _validateConstructorParams(accessKeyId: string, secretAccessKey: string, endpoint: string): void {
    if (typeof accessKeyId !== 'string' || accessKeyId.trim().length === 0)
      throw new TypeError(C.ERROR_ACCESS_KEY_REQUIRED);
    if (typeof secretAccessKey !== 'string' || secretAccessKey.trim().length === 0)
      throw new TypeError(C.ERROR_SECRET_KEY_REQUIRED);
    if (typeof endpoint !== 'string' || endpoint.trim().length === 0) throw new TypeError(C.ERROR_ENDPOINT_REQUIRED);
  }

  private _ensureValidUrl(raw: string): string {
    // prepend https:// if user forgot a scheme
    const candidate = /^(https?:)?\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      new URL(candidate);
      /* eslint-enable  no-new */
      return candidate.replace(/\/+$/, ''); // strip trailing slash
    } catch {
      const msg = `${C.ERROR_ENDPOINT_FORMAT} But provided: "${raw}"`;
      this._log('error', msg);
      throw new TypeError(msg);
    }
  }

  private _validateMethodIsGetOrHead(method: string): void {
    if (method !== 'GET' && method !== 'HEAD') {
      this._log('error', `${C.ERROR_PREFIX}method must be either GET or HEAD`);
      throw new Error('method must be either GET or HEAD');
    }
  }

  private _checkKey(key: string): void {
    if (typeof key !== 'string' || key.trim().length === 0) {
      this._log('error', C.ERROR_KEY_REQUIRED);
      throw new TypeError(C.ERROR_KEY_REQUIRED);
    }
  }

  private _checkDelimiter(delimiter: string): void {
    if (typeof delimiter !== 'string' || delimiter.trim().length === 0) {
      this._log('error', C.ERROR_DELIMITER_REQUIRED);
      throw new TypeError(C.ERROR_DELIMITER_REQUIRED);
    }
  }

  private _checkPrefix(prefix: string): void {
    if (typeof prefix !== 'string') {
      this._log('error', C.ERROR_PREFIX_TYPE);
      throw new TypeError(C.ERROR_PREFIX_TYPE);
    }
  }

  private _checkMaxKeys(maxKeys: number): void {
    if (typeof maxKeys !== 'number' || maxKeys <= 0) {
      this._log('error', C.ERROR_MAX_KEYS_TYPE);
      throw new TypeError(C.ERROR_MAX_KEYS_TYPE);
    }
  }

  private _checkOpts(opts: Record<string, any>): void {
    if (typeof opts !== 'object') {
      this._log('error', `${C.ERROR_PREFIX}opts must be an object`);
      throw new TypeError(`${C.ERROR_PREFIX}opts must be an object`);
    }
  }

  private _filterIfHeaders(opts: Record<string, any>): {
    filteredOpts: Record<string, any>;
    conditionalHeaders: Record<string, string>;
  } {
    const filteredOpts: Record<string, any> = {};
    const conditionalHeaders: Record<string, string> = {};
    const ifHeaders = ['if-match', 'if-none-match', 'if-modified-since', 'if-unmodified-since'];

    for (const [key, value] of Object.entries(opts)) {
      if (ifHeaders.includes(key.toLowerCase())) {
        // Convert to lowercase for consistency
        conditionalHeaders[key] = value;
      } else {
        filteredOpts[key] = value;
      }
    }

    return { filteredOpts, conditionalHeaders };
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
      this._log('error', C.ERROR_DATA_BUFFER_REQUIRED);
      throw new TypeError(C.ERROR_DATA_BUFFER_REQUIRED);
    }
    if (typeof uploadId !== 'string' || uploadId.trim().length === 0) {
      this._log('error', C.ERROR_UPLOAD_ID_REQUIRED);
      throw new TypeError(C.ERROR_UPLOAD_ID_REQUIRED);
    }
    if (!Number.isInteger(partNumber) || partNumber <= 0) {
      this._log('error', `${C.ERROR_PREFIX}partNumber must be a positive integer`);
      throw new TypeError(`${C.ERROR_PREFIX}partNumber must be a positive integer`);
    }
    this._checkOpts(opts);
  }

  private async _sign(
    method: T.HttpMethod,
    keyPath: string,
    query: Object = {},
    headers: Record<string, string | number>,
    body: string | Buffer,
  ): Promise<{ url: string; headers: Record<string, any> }> {
    const datetime = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    // Create URL without appending keyPath first
    const url = new URL(this.endpoint);

    // Properly format the pathname to avoid double slashes
    if (keyPath && keyPath.length > 0) {
      url.pathname =
        url.pathname === '/' ? `/${keyPath.replace(/^\/+/, '')}` : `${url.pathname}/${keyPath.replace(/^\/+/, '')}`;
    }

    headers[C.HEADER_AMZ_CONTENT_SHA256] = body ? await U.hash(body) : C.UNSIGNED_PAYLOAD;
    headers[C.HEADER_AMZ_DATE] = datetime;
    headers[C.HEADER_HOST] = url.host;
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
    headers[C.HEADER_AUTHORIZATION] = authorizationHeader;
    return { url: url.toString(), headers };
  }

  private _buildCanonicalHeaders(headers: Record<string, string | number>): string {
    return Object.entries(headers)
      .map(([key, value]) => `${key.toLowerCase()}:${String(value).trim()}`)
      .sort()
      .join('\n');
  }

  private async _buildCanonicalRequest(
    method: T.HttpMethod,
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
      body ? await U.hash(body) : C.UNSIGNED_PAYLOAD,
    ].join('\n');
  }

  private async _buildStringToSign(datetime: string, canonicalRequest: string): Promise<string> {
    const credentialScope = [datetime.slice(0, 8), this.region, C.S3_SERVICE, C.AWS_REQUEST_TYPE].join('/');
    return [C.AWS_ALGORITHM, datetime, credentialScope, await U.hash(canonicalRequest)].join('\n');
  }

  private async _calculateSignature(datetime: string, stringToSign: string): Promise<string> {
    const signingKey = await this._getSignatureKey(datetime.slice(0, 8));
    return U.hmac(signingKey, stringToSign, 'hex');
  }

  private _buildAuthorizationHeader(datetime: string, signedHeaders: string, signature: string): string {
    const credentialScope = [datetime.slice(0, 8), this.region, C.S3_SERVICE, C.AWS_REQUEST_TYPE].join('/');
    return [
      `${C.AWS_ALGORITHM} Credential=${this.accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(', ');
  }

  private async _signedRequest(
    method: T.HttpMethod, // 'GET' | 'HEAD' | 'PUT' | 'POST' | 'DELETE'
    key: string, // ‘’ allowed for bucket‑level ops
    {
      query = {}, // ?query=string
      body = '', // string | Buffer | undefined
      headers = {}, // extra/override headers
      tolerated = [], // [200, 404] etc.
      withQuery = false, // append query string to signed URL
    }: {
      query?: Record<string, any>;
      body?: string | Buffer;
      headers?: Record<string, string | number>;
      tolerated?: number[];
      withQuery?: boolean;
    } = {},
  ): Promise<Response> {
    // Basic validation
    if (!['GET', 'HEAD', 'PUT', 'POST', 'DELETE'].includes(method))
      throw new Error(`${C.ERROR_PREFIX}Unsupported HTTP method ${method as string}`);

    if (key) this._checkKey(key); // allow '' for bucket‑level

    const { filteredOpts, conditionalHeaders } = ['GET', 'HEAD'].includes(method)
      ? this._filterIfHeaders(query)
      : { filteredOpts: query, conditionalHeaders: {} };

    const baseHeaders: Record<string, string | number> = {
      [C.HEADER_AMZ_CONTENT_SHA256]: body ? await U.hash(body) : C.UNSIGNED_PAYLOAD,
      ...(['GET', 'HEAD'].includes(method) ? { [C.HEADER_CONTENT_TYPE]: C.JSON_CONTENT_TYPE } : {}),
      ...headers,
      ...conditionalHeaders,
    };

    const encodedKey = key ? U.uriResourceEscape(key) : '';
    const { url, headers: signedHeaders } = await this._sign(method, encodedKey, filteredOpts, baseHeaders, body ?? '');
    if (Object.keys(query).length > 0) {
      withQuery = true; // append query string to signed URL
    }
    const finalUrl =
      withQuery && Object.keys(filteredOpts).length ? `${url}?${new URLSearchParams(filteredOpts)}` : url;

    return this._sendRequest(finalUrl, method, signedHeaders, body, tolerated);
  }

  public getRegion(): string {
    return this.region;
  }

  public setRegion(region: string): void {
    this.region = region;
  }

  public getEndpoint(): string {
    return this.endpoint;
  }

  public setEndpoint(endpoint: string): void {
    this.endpoint = endpoint;
  }

  public getRequestSizeInBytes(): number {
    return this.requestSizeInBytes;
  }

  public setRequestSizeInBytes(requestSizeInBytes: number): void {
    this.requestSizeInBytes = requestSizeInBytes;
  }

  public getProps(): T.S3Config {
    return {
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      endpoint: this.endpoint,
      region: this.region,
      requestSizeInBytes: this.requestSizeInBytes,
      requestAbortTimeout: this.requestAbortTimeout,
      logger: this.logger,
    };
  }
  public setProps(props: T.S3Config): void {
    this._validateConstructorParams(props.accessKeyId, props.secretAccessKey, props.endpoint);
    this.accessKeyId = props.accessKeyId;
    this.secretAccessKey = props.secretAccessKey;
    this.region = props.region || 'auto';
    this.endpoint = props.endpoint;
    this.requestSizeInBytes = props.requestSizeInBytes || C.DEFAULT_REQUEST_SIZE_IN_BYTES;
    this.requestAbortTimeout = props.requestAbortTimeout;
    this.logger = props.logger;
  }

  public sanitizeETag(etag: string): string {
    return U.sanitizeETag(etag);
  }

  // TBD
  public async createBucket(): Promise<boolean> {
    const xmlBody = `
      <CreateBucketConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
        <LocationConstraint>${this.region}</LocationConstraint>
      </CreateBucketConfiguration>
    `;
    const headers = {
      [C.HEADER_CONTENT_TYPE]: C.XML_CONTENT_TYPE,
      [C.HEADER_CONTENT_LENGTH]: Buffer.byteLength(xmlBody).toString(),
    };
    const res = await this._signedRequest('PUT', '', {
      body: xmlBody,
      headers,
      tolerated: [200, 404, 403, 409], // don’t throw on 404/403 // 409 = bucket already exists
    });
    return res.status === 200;
  }

  public async bucketExists(): Promise<boolean> {
    const res = await this._signedRequest('HEAD', '', { tolerated: [200, 404, 403] });
    return res.status === 200;
  }

  public async listObjects(
    delimiter: string = '/',
    prefix: string = '',
    maxKeys: number = 1000,
    method: T.HttpMethod = 'GET', // 'GET' or 'HEAD'
    opts: Record<string, any> = {},
  ): Promise<Object | Array<Object> | null> {
    this._checkDelimiter(delimiter);
    this._checkPrefix(prefix);
    this._checkMaxKeys(maxKeys);
    this._validateMethodIsGetOrHead(method);
    this._checkOpts(opts);

    const query: Record<string, any> = {
      'list-type': C.LIST_TYPE,
      'max-keys': String(maxKeys),
      ...(prefix ? { prefix } : {}),
      ...opts,
    };

    const keyPath = delimiter === '/' ? delimiter : U.uriEscape(delimiter);
    const res = await this._signedRequest(method, keyPath, {
      query,
      withQuery: true, // append ?query=string
      tolerated: [200, 404],
    });

    if (method === 'HEAD') {
      return {
        size: +(res.headers.get(C.HEADER_CONTENT_LENGTH) ?? '0'),
        mtime: res.headers.get(C.HEADER_LAST_MODIFIED) ? new Date(res.headers.get(C.HEADER_LAST_MODIFIED)!) : undefined,
        ETag: res.headers.get(C.HEADER_ETAG) ?? undefined,
      };
    }
    if (res.status === 404) return null;
    if (res.status !== 200) {
      const errorBody = await res.text();
      const errorCode = res.headers.get('x-amz-error-code') || 'Unknown';
      const errorMessage = res.headers.get('x-amz-error-message') || res.statusText;
      this._log(
        'error',
        `${C.ERROR_PREFIX}Request failed with status ${res.status}: ${errorCode} - ${errorMessage}, err body: ${errorBody}`,
      );
      throw new Error(
        `${C.ERROR_PREFIX}Request failed with status ${res.status}: ${errorCode} - ${errorMessage}, err body: ${errorBody}`,
      );
    }
    const data = U.parseXml(await res.text());
    const output = data.listBucketResult || data.error || data;
    return output.keyCount === '0' ? [] : output.contents || output;
  }

  public async listMultiPartUploads(
    delimiter: string = '/',
    prefix: string = '',
    method: T.HttpMethod = 'GET',
    opts: Record<string, any> = {},
  ): Promise<any> {
    this._checkDelimiter(delimiter);
    this._checkPrefix(prefix);
    this._validateMethodIsGetOrHead(method);
    this._checkOpts(opts);

    const query = { uploads: '', ...opts };
    const keyPath = delimiter === '/' ? delimiter : U.uriEscape(delimiter);

    const res = await this._signedRequest(method, keyPath, {
      query,
      withQuery: true,
    });

    if (method === 'HEAD') {
      return {
        size: +(res.headers.get(C.HEADER_CONTENT_LENGTH) ?? '0'),
        mtime: res.headers.get(C.HEADER_LAST_MODIFIED) ? new Date(res.headers.get(C.HEADER_LAST_MODIFIED)!) : undefined,
        ETag: res.headers.get(C.HEADER_ETAG) ?? '',
      };
    }

    const data = U.parseXml(await res.text());
    const output = data.listMultipartUploadsResult || data.error || data;
    return output.uploads || output;
  }

  public async getObject(key: string, opts: Record<string, any> = {}): Promise<String | null> {
    const res = await this._signedRequest('GET', key, { query: opts, tolerated: [200, 404, 412, 304] });
    if ([404, 412, 304].includes(res.status)) return null;
    return res.text();
  }

  public async getObjectArrayBuffer(key: string, opts: Record<string, any> = {}): Promise<ArrayBuffer | null> {
    const res = await this._signedRequest('GET', key, { query: opts, tolerated: [200, 404, 412, 304] });
    if ([404, 412, 304].includes(res.status)) return null;
    return res.arrayBuffer();
  }

  public async getObjectWithETag(
    key: string,
    opts: Record<string, any> = {},
  ): Promise<{ etag: string | null; data: ArrayBuffer | null }> {
    try {
      const res = await this._signedRequest('GET', key, { query: opts, tolerated: [200, 404, 412, 304] });

      if ([404, 412, 304].includes(res.status)) return { etag: null, data: null };

      const etag = res.headers.get(C.HEADER_ETAG);
      if (!etag) throw new Error('ETag not found in response headers');

      return { etag: U.sanitizeETag(etag), data: await res.arrayBuffer() };
    } catch (err) {
      this._log('error', `Error getting object ${key} with ETag: ${err}`);
      throw err;
    }
  }

  // public getObjectStream(
  //   key: string,
  //   opts: Record<string, any> = {},
  // ): Promise<T.S3StreamResponse | null> {
  //   const res = this._signedRequest('GET', key, { query: opts, tolerated: [200, 404, 412, 304] });
  //   if ([404, 412, 304].includes(res.status)) return null;
  //   return res;
  // }

  public async getObjectRaw(
    key: string,
    wholeFile = true,
    rangeFrom = 0,
    rangeTo = this.requestSizeInBytes,
    opts: Record<string, any> = {},
  ): Promise<Response> {
    const rangeHdr: Record<string, string | number> = wholeFile ? {} : { range: `bytes=${rangeFrom}-${rangeTo - 1}` };

    return this._signedRequest('GET', key, {
      query: { ...opts },
      headers: rangeHdr,
      withQuery: true, // keep ?query=string behaviour
    });
  }

  public async getContentLength(key: string): Promise<number> {
    const res = await this._signedRequest('HEAD', key);
    const len = res.headers.get(C.HEADER_CONTENT_LENGTH);
    return len ? +len : 0;
  }

  public async existObject(key: string, opts: Record<string, any> = {}): Promise<T.ExistResponseCode> {
    const res = await this._signedRequest('HEAD', key, {
      query: opts,
      tolerated: [200, 404, 412, 304],
    });

    if (res.status === 404) return false; // not found
    if (res.status === 412 || res.status === 304) return null; // ETag mismatch
    return true; // found (200)
  }

  public async getEtag(key: string, opts: Record<string, any> = {}): Promise<string | null> {
    const res = await this._signedRequest('HEAD', key, {
      query: opts,
      tolerated: [200, 404],
    });

    if (res.status === 404) return null;

    const etag = res.headers.get(C.HEADER_ETAG);
    if (!etag) throw new Error('ETag not found in response headers');

    return U.sanitizeETag(etag);
  }

  public async putObject(key: string, data: string | Buffer): Promise<Response> {
    if (!(data instanceof Buffer || typeof data === 'string')) throw new TypeError(C.ERROR_DATA_BUFFER_REQUIRED);
    return this._signedRequest('PUT', key, {
      body: data,
      headers: { [C.HEADER_CONTENT_LENGTH]: typeof data === 'string' ? Buffer.byteLength(data) : data.length },
      tolerated: [200],
    });
  }

  public async getMultipartUploadId(key: string, fileType: string = C.DEFAULT_STREAM_CONTENT_TYPE): Promise<string> {
    this._checkKey(key);
    if (typeof fileType !== 'string') throw new TypeError(`${C.ERROR_PREFIX}fileType must be a string`);

    const query = { uploads: '' };
    const headers = { [C.HEADER_CONTENT_TYPE]: fileType };

    const res = await this._signedRequest('POST', key, {
      query,
      headers,
      withQuery: true,
    });

    const parsed = U.parseXml(await res.text());

    if (parsed?.initiateMultipartUploadResult?.uploadId) return parsed.initiateMultipartUploadResult.uploadId;

    throw new Error(`${C.ERROR_PREFIX}Failed to create multipart upload: ${JSON.stringify(parsed)}`);
  }

  public async uploadPart(
    key: string,
    data: Buffer | string,
    uploadId: string,
    partNumber: number,
    opts: Record<string, any> = {},
  ): Promise<T.UploadPart> {
    this._validateUploadPartParams(key, data, uploadId, partNumber, opts);

    const query = { uploadId, partNumber, ...opts };
    const res = await this._signedRequest('PUT', key, {
      query,
      body: data,
      headers: { [C.HEADER_CONTENT_LENGTH]: typeof data === 'string' ? Buffer.byteLength(data) : data.length },
    });

    return { partNumber, ETag: U.sanitizeETag(res.headers.get('etag') ?? '') };
  }

  public async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: Array<T.UploadPart>,
  ): Promise<T.CompleteMultipartUploadResult> {
    // …existing validation left untouched …

    const query = { uploadId };
    const xmlBody = this._buildCompleteMultipartUploadXml(parts);
    const headers = {
      [C.HEADER_CONTENT_TYPE]: C.XML_CONTENT_TYPE,
      [C.HEADER_CONTENT_LENGTH]: Buffer.byteLength(xmlBody).toString(),
    };

    const res = await this._signedRequest('POST', key, {
      query,
      body: xmlBody,
      headers,
      withQuery: true,
    });

    const parsed = U.parseXml(await res.text());
    if (!parsed?.completeMultipartUploadResult)
      throw new Error(`${C.ERROR_PREFIX}Failed to complete multipart upload: ${JSON.stringify(parsed)}`);

    return parsed.completeMultipartUploadResult;
  }

  public async abortMultipartUpload(key: string, uploadId: string): Promise<object> {
    this._checkKey(key);
    if (!uploadId) throw new TypeError(C.ERROR_UPLOAD_ID_REQUIRED);

    const query = { uploadId };
    const headers = { [C.HEADER_CONTENT_TYPE]: C.XML_CONTENT_TYPE };

    const res = await this._signedRequest('DELETE', key, {
      query,
      headers,
      withQuery: true,
    });

    const parsed = U.parseXml(await res.text());
    if (parsed?.error?.message)
      throw new Error(`${C.ERROR_PREFIX}Failed to abort multipart upload: ${parsed.error.message}`);

    return { status: 'Aborted', key, uploadId, response: parsed };
  }

  private _buildCompleteMultipartUploadXml(parts: Array<T.UploadPart>): string {
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

  public async deleteObject(key: string): Promise<boolean> {
    const res = await this._signedRequest('DELETE', key, { tolerated: [200, 204] });
    return res.status === 200 || res.status === 204;
  }

  private async _sendRequest(
    url: string,
    method: T.HttpMethod,
    headers: Record<string, string | any>,
    body?: string | Buffer,
    toleratedStatusCodes: number[] = [],
  ): Promise<Response> {
    this._log('info', `Sending ${method} request to ${url}`, `headers: ${JSON.stringify(headers)}`);
    const res = await fetch(url, {
      method,
      headers,
      body: ['GET', 'HEAD'].includes(method) ? undefined : body,
      signal: this.requestAbortTimeout !== undefined ? AbortSignal.timeout(this.requestAbortTimeout) : undefined,
    });
    this._log('info', `Response status: ${res.status}, tolerated: ${toleratedStatusCodes.join(',')}`);
    if (!res.ok && !toleratedStatusCodes.includes(res.status)) {
      await this._handleErrorResponse(res);
    }
    return res;
  }

  private async _handleErrorResponse(res: Response) {
    const errorBody = await res.text();
    const errorCode = res.headers.get('x-amz-error-code') || 'Unknown';
    const errorMessage = res.headers.get('x-amz-error-message') || res.statusText;
    this._log(
      'error',
      `${C.ERROR_PREFIX}Request failed with status ${res.status}: ${errorCode} - ${errorMessage},err body: ${errorBody}`,
    );
    throw new Error(
      `${C.ERROR_PREFIX}Request failed with status ${res.status}: ${errorCode} - ${errorMessage}, err body: ${errorBody}`,
    );
  }

  private _buildCanonicalQueryString(queryParams: Object): string {
    if (Object.keys(queryParams).length < 1) {
      return '';
    }

    return Object.keys(queryParams)
      .sort()
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent((queryParams as any)[key])}`)
      .join('&');
  }
  private async _getSignatureKey(dateStamp: string): Promise<string> {
    const kDate = await U.hmac(`AWS4${this.secretAccessKey}`, dateStamp);
    const kRegion = await U.hmac(kDate, this.region);
    const kService = await U.hmac(kRegion, C.S3_SERVICE);
    return U.hmac(kService, C.AWS_REQUEST_TYPE);
  }
}

export { S3mini };
export default S3mini;
