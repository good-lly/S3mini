'use strict';

import type { Crypto, XmlValue, XmlMap, ListBucketResponse, ErrorWithCode } from './types.js';
declare const crypto: Crypto;

// Initialize crypto functions
const _createHmac: Crypto['createHmac'] = crypto.createHmac || (await import('node:crypto')).createHmac;
const _createHash: Crypto['createHash'] = crypto.createHash || (await import('node:crypto')).createHash;

/**
 * Hash content using SHA-256
 * @param {string|Buffer} content  – data to hash
 * @returns {string} Hex encoded hash
 */
export const hash = (content: string | Buffer): string => {
  return _createHash('sha256').update(content).digest('hex');
};

/**
 * Compute HMAC-SHA-256 of arbitrary data and return a hex string.
 * @param {string|Buffer} key      – secret key
 * @param {string|Buffer} content  – data to authenticate
 * @param {BufferEncoding} [encoding='hex'] – hex | base64 | …
 * @returns {string | Buffer} hex encoded HMAC
 */
export const hmac = (key: string | Buffer, content: string | Buffer, encoding?: 'hex' | 'base64'): string | Buffer => {
  const mac = _createHmac('sha256', key).update(content);
  return encoding ? mac.digest(encoding) : mac.digest();
};

/**
 * Sanitize ETag value by removing quotes and XML entities
 * @param etag ETag value to sanitize
 * @returns Sanitized ETag
 */
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

const entityMap = {
  '&quot;': '"',
  '&apos;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
} as const;

const unescapeXml = (value: string): string =>
  value.replace(/&(quot|apos|lt|gt|amp);/g, m => entityMap[m as keyof typeof entityMap] ?? m);

/**
 * Parse a very small subset of XML into a JS structure.
 *
 * @param input raw XML string
 * @returns string for leaf nodes, otherwise a map of children
 */
export const parseXml = (input: string): XmlValue => {
  const RE_TAG = /<(\w)([-\w]+)(?:\/|[^>]*>((?:(?!<\1)[\s\S])*)<\/\1\2)>/gm;
  const result: XmlMap = {}; // strong type, no `any`
  let match: RegExpExecArray | null;

  while ((match = RE_TAG.exec(input)) !== null) {
    const [, prefix = '', key, inner] = match;
    const fullKey = `${prefix.toLowerCase()}${key}`;
    const node: XmlValue = inner ? parseXml(inner) : '';

    const current = result[fullKey];
    if (current === undefined) {
      // first occurrence
      result[fullKey] = node;
    } else if (Array.isArray(current)) {
      // already an array
      current.push(node);
    } else {
      // promote to array on the second occurrence
      result[fullKey] = [current, node];
    }
  }

  // No child tags? — return the text, after entity decode
  return Object.keys(result).length > 0 ? result : unescapeXml(input);
};

/**
 * Encode a character as a URI percent-encoded hex value
 * @param c Character to encode
 * @returns Percent-encoded character
 */
const encodeAsHex = (c: string): string => `%${c.charCodeAt(0).toString(16).toUpperCase()}`;

/**
 * Escape a URI string using percent encoding
 * @param uriStr URI string to escape
 * @returns Escaped URI string
 */
export const uriEscape = (uriStr: string): string => {
  return encodeURIComponent(uriStr).replace(/[!'()*]/g, encodeAsHex);
};

/**
 * Escape a URI resource path while preserving forward slashes
 * @param string URI path to escape
 * @returns Escaped URI path
 */
export const uriResourceEscape = (string: string): string => {
  return uriEscape(string).replace(/%2F/g, '/');
};

export const isListBucketResponse = (value: unknown): value is ListBucketResponse => {
  return typeof value === 'object' && value !== null && ('listBucketResult' in value || 'error' in value);
};

export const extractErrCode = (e: unknown): string | undefined => {
  if (typeof e !== 'object' || e === null) {
    return undefined;
  }
  const err = e as ErrorWithCode;
  if (typeof err.code === 'string') {
    return err.code;
  }
  return typeof err.cause?.code === 'string' ? err.cause.code : undefined;
};

export class S3Error extends Error {
  readonly code?: string;
  constructor(msg: string, code?: string, cause?: unknown) {
    super(msg);
    this.name = new.target.name; // keeps instanceof usable
    this.code = code;
    this.cause = cause;
  }
}

export class S3NetworkError extends S3Error {}
export class S3ServiceError extends S3Error {
  readonly status: number;
  readonly serviceCode?: string;
  body: string | undefined;
  constructor(msg: string, status: number, serviceCode?: string, body?: string) {
    super(msg, serviceCode);
    this.status = status;
    this.serviceCode = serviceCode;
    this.body = body;
  }
}

/**
 * Run async-returning tasks in batches with an *optional* minimum
 * spacing (minIntervalMs) between the *start* times of successive batches.
 *
 * @param {Iterable<() => Promise<unknonw>>} tasks       – functions returning Promises
 * @param {number} [batchSize=30]                    – max concurrent requests
 * @param {number} [minIntervalMs=0]                 – ≥0; 0 means “no pacing”
 * @returns {Promise<Array<PromiseSettledResult<unknonw>>>}
 */
export const runInBatches = async (
  tasks: Iterable<() => Promise<unknown>>,
  batchSize = 30,
  minIntervalMs = 0,
): Promise<Array<PromiseSettledResult<unknown>>> => {
  const allResults: PromiseSettledResult<unknown>[] = [];
  let batch: Array<() => Promise<unknown>> = [];

  for (const task of tasks) {
    batch.push(task);
    if (batch.length === batchSize) {
      await executeBatch(batch);
      batch = [];
    }
  }
  if (batch.length) {
    await executeBatch(batch);
  }
  return allResults;

  // ───────── helpers ──────────
  async function executeBatch(batchFns: Array<() => Promise<unknown>>): Promise<void> {
    const start = Date.now();

    const settled = await Promise.allSettled(batchFns.map(fn => fn()));
    allResults.push(...settled);

    if (minIntervalMs > 0) {
      const wait = minIntervalMs - (Date.now() - start);
      if (wait > 0) {
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
};
