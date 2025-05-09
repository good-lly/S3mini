'use strict';
import { jest, describe, it, expect } from '@jest/globals';
import { testRunner } from './_shared.test.js';

import * as dotenv from 'dotenv';
dotenv.config();

const name = 'cloudflare';
const bucketName = `BUCKET_ENV_${name.toUpperCase()}`;

const raw = process.env[bucketName] ? process.env[bucketName].split(',') : null;

if (!raw || raw === null) {
  console.error('No credentials found. Please set the BUCKET_ENV_ environment variables.');
  describe.skip(name, () => {
    it('skipped', () => {
      expect(true).toBe(true);
    });
  });
} else {
  console.log('Running tests for bucket:', name);
  const credentials = {
    provider: raw[0],
    accessKeyId: raw[1],
    secretAccessKey: raw[2],
    endpoint: raw[3],
    region: raw[4],
  };
  describe(`:::: ${credentials.provider} ::::`, () => {
    expect(credentials.provider).toBe(name);
    expect(credentials.accessKeyId).toBeDefined();
    expect(credentials.secretAccessKey).toBeDefined();
    expect(credentials.endpoint).toBeDefined();
    expect(credentials.region).toBeDefined();
    testRunner(credentials);
  });
}
