'use strict';

import type { Crypto } from './types.js';
declare const crypto: Crypto;
//   return obj && typeof obj.createHmac === 'function' && typeof obj.createHash === 'function';
// };

// Initialize crypto functions
let _createHmac: Crypto['createHmac'] = crypto.createHmac || (await import('node:crypto')).createHmac;
let _createHash: Crypto['createHash'] = crypto.createHash || (await import('node:crypto')).createHash;

// // Initialize crypto functions based on environment
// const initCrypto = async () => {
//   try {
//     // Check if we have Node.js crypto available in current scope
//     if (typeof crypto !== 'undefined' && isNodeCrypto(crypto)) {
//       _createHmac = crypto.createHmac;
//       _createHash = crypto.createHash;
//     } else {
//       // Fall back to importing Node.js crypto
//       const nodeCrypto = await import('node:crypto');
//       _createHmac = nodeCrypto.createHmac;
//       _createHash = nodeCrypto.createHash;
//     }
//   } catch (error) {
//     console.error(
//       'core-s3 Module: Crypto functions are not available, please report the issue with necessary description: https://github.com/core-s3/issues',
//     );
//     throw error;
//   }
// };

// // Initialize crypto on module load
// initCrypto().catch(console.error);

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
