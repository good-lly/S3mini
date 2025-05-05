'use strict';

import type { Crypto } from './types.js';
declare const crypto: Crypto;

// Initialize crypto functions
let _createHmac: Crypto['createHmac'] = crypto.createHmac || (await import('node:crypto')).createHmac;
let _createHash: Crypto['createHash'] = crypto.createHash || (await import('node:crypto')).createHash;

/**
 * Hash content using SHA-256
 * @param content Content to hash
 * @returns Hex encoded hash
 */
export const hash = async (content: string | Buffer): Promise<string> => {
  const hashSum = _createHash('sha256');
  hashSum.update(content);
  return hashSum.digest('hex');
};

/**
 * Create HMAC for content using key
 * @param key Key for HMAC
 * @param content Content to generate HMAC for
 * @param encoding Output encoding
 * @returns HMAC digest
 */
export const hmac = async (key: string | Buffer, content: string, encoding?: 'hex'): Promise<string> => {
  const hmacSum = _createHmac('sha256', key);
  hmacSum.update(content);
  return hmacSum.digest(encoding);
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

// Define which XML keys should be treated as arrays even if they contain only one element
const expectArray: { [key: string]: boolean } = {
  contents: true,
};

/**
 * Parse XML string into a JavaScript object
 * @param str XML string to parse
 * @returns Parsed JavaScript object
 */
export const parseXml = (str: string): string | object | any => {
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
    // Add null check for prefix
    const fullKey = (prefix ? prefix.toLowerCase() : '') + key;
    const parsedValue = value != null ? parseXml(value) : true;

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

export class S3Error extends Error {
  readonly code?: string;
  constructor(msg: string, code?: string, cause?: any) {
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
