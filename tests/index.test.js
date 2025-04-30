'use strict';

import { S3mini } from '../dist/S3mini.min.js';
import * as dotenv from 'dotenv';
dotenv.config();

// --- 1 ■ Build one static table with all credentials -----------------------
const buckets = Object.keys(process.env)
  .filter(k => k.startsWith('BUCKET_ENV_'))
  .map(k => {
    const [provider, accessKeyId, secretAccessKey, endpoint, region] = process.env[k].split(',');
    return { provider, accessKeyId, secretAccessKey, endpoint, region };
  });

console.log(
  'Configured providers:',
  buckets.map(b => b.provider),
);

const byteSize = str => new Blob([str]).size;
const byteSizeBuffer = buffer => new Blob([buffer]).size;

const key = 'first-test-object.txt';
const contentString = 'Hello, world!';

const specialCharContentString = 'Hello, world! \uD83D\uDE00';
const specialCharContentBufferExtra = Buffer.from(specialCharContentString + ' extra', 'utf-8');
const specialCharKey = 'special-char key with spaces.txt';

// --- 2 ■ A separate describe makes test output nicer -----------------------
describe.each(buckets)('::: $provider :::', bucket => {
  const s3mini = new S3mini({
    accessKeyId: bucket.accessKeyId,
    secretAccessKey: bucket.secretAccessKey,
    endpoint: bucket.endpoint,
    region: bucket.region,
  });

  beforeAll(async () => {
    let exists;
    try {
      exists = await s3mini.bucketExists();
    } catch (err) {
      // Backblaze accounts are locked to a region and may throw on HEAD
      console.warn(`Skipping bucketExists() pre-check: ${err.message}`);
      return;
    }
    if (exists) {
      const list = await s3mini.listObjects();
      await Promise.all(list.map(o => s3mini.deleteObject(o.key)));
    }
  });

  it('instantiates S3mini', () => {
    expect(s3mini).toBeInstanceOf(S3mini); // ← updated expectation
  });

  it('bucket exists', async () => {
    const exists = await s3mini.bucketExists();
    expect(exists).toBe(true);

    const nonExistentBucket = new S3mini({
      accessKeyId: bucket.accessKeyId,
      secretAccessKey: bucket.secretAccessKey,
      endpoint: bucket.endpoint + '/non-existent-bucket',
      region: bucket.region,
    });
    const nonExistent = await nonExistentBucket.bucketExists();
    expect(nonExistent).toBe(false);
  });

  it('basic list objects', async () => {
    const objects = await s3mini.listObjects();
    expect(objects).toBeInstanceOf(Array);
    expect(objects.length).toBe(0);

    // listing non existent prefix thros 404 no such key
    const objectsWithPrefix = await s3mini.listObjects('non-existent-prefix');
    expect(objectsWithPrefix).toBe(null);
  });

  it('basic put and get object', async () => {
    await s3mini.putObject(key, contentString);
    const data = await s3mini.getObject(key);
    expect(data).toBe(contentString);

    // Clean up
    const delResp = await s3mini.deleteObject(key);
    expect(delResp).toBe(true);

    // Check if the object is deleted
    const deletedData = await s3mini.getObject(key);
    expect(deletedData).toBe(null);
  });

  it('put and get object with special characters', async () => {
    await s3mini.putObject(specialCharKey, specialCharContentString);
    const data = await s3mini.getObject(specialCharKey);
    expect(data).toEqual(specialCharContentString);

    // list objects
    const objects = await s3mini.listObjects();
    expect(objects).toBeInstanceOf(Array);
    expect(objects.length).toBe(1);
    expect(objects[0].key).toBe(specialCharKey);
    expect(parseInt(objects[0].size)).toBe(byteSize(specialCharContentString));

    // update the object with a buffer with extra content
    // This is to test if the object can be updated with a buffer that has extra content
    await s3mini.putObject(specialCharKey, specialCharContentBufferExtra);
    const updatedData = await s3mini.getObjectArrayBuffer(specialCharKey);
    const bufferData = Buffer.from(updatedData);
    expect(bufferData.toString('utf-8')).toBe(specialCharContentBufferExtra.toString('utf-8'));
    expect(bufferData.length).toBe(specialCharContentBufferExtra.length);

    // Clean up
    const delResp = await s3mini.deleteObject(specialCharKey);
    expect(delResp).toBe(true);

    // Check if the object is deleted
    const deletedData = await s3mini.getObject(specialCharKey);
    expect(deletedData).toBe(null);
  });
});
