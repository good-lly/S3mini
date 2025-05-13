'use strict';
import { jest, describe, it, expect } from '@jest/globals';
import { S3mini, sanitizeETag, runInBatches } from '../dist/S3mini.js';
import { randomBytes } from 'node:crypto';

// import * as dotenv from 'dotenv';
// dotenv.config();

// const SECONDS = 1000;
// jest.setTimeout(70 * SECONDS);

// OLDER APPROACH
// --- 1 ■ Build one static table with all credentials -----------------------
// const buckets = Object.keys(process.env)
//   .filter(k => k.startsWith('BUCKET_ENV_'))
//   .map(k => {
//     const [provider, accessKeyId, secretAccessKey, endpoint, region] = process.env[k].split(',');
//     return { provider, accessKeyId, secretAccessKey, endpoint, region };
//   });

// console.log(
//   'Configured providers:',
//   buckets.map(b => b.provider),
// );

const EIGHT_MB = 8 * 1024 * 1024;

const large_buffer = randomBytes(EIGHT_MB * 3.2);

const byteSize = str => new Blob([str]).size;

const OP_CAP = 40;

const key = 'first-test-object.txt';
const contentString = 'Hello, world!';

const specialCharContentString = 'Hello, world! \uD83D\uDE00';
const specialCharContentBufferExtra = Buffer.from(specialCharContentString + ' extra', 'utf-8');
const specialCharKey = 'special-char key with spaces.txt';

// --- 2 ■ A separate describe makes test output nicer -----------------------
export const testRunner = bucket => {
  jest.setTimeout(120_000);

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
      expect(list).toBeInstanceOf(Array);
      if (list.length > 0) {
        expect(list.length).toBeGreaterThan(0);
        const generator = function* (n) {
          for (let i = 0; i < n; i++) yield () => s3mini.deleteObject(list[i].key);
        };
        await runInBatches(generator(list.length), OP_CAP, 1_000);
        // doublecheck that the bucket is empty
        const list2 = await s3mini.listObjects();
        expect(list2).toBeInstanceOf(Array);
        expect(list2.length).toBe(0);
        // console.log('Bucket is empty');
      }
    }
  });

  it('instantiates S3mini', () => {
    expect(s3mini).toBeInstanceOf(S3mini); // ← updated expectation
  });

  it('bucket exists', async () => {
    let exists = await s3mini.bucketExists();
    if (!exists) {
      const createBucketResponse = await s3mini.createBucket();
      expect(createBucketResponse).toBeDefined();
      exists = await s3mini.bucketExists();
    }
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
    if (objects.length > 0) {
      for (const obj of objects) {
        await s3mini.deleteObject(obj.key);
      }
    }
    // Check if the bucket is empty
    const objects2 = await s3mini.listObjects();
    expect(objects2).toBeInstanceOf(Array);
    expect(objects2.length).toBe(0);

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

  it('put and get object with special characters and different types', async () => {
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

    const getObjectLength = await s3mini.getContentLength(specialCharKey);
    expect(getObjectLength).toBe(specialCharContentBufferExtra.length);

    // Clean up
    const delResp = await s3mini.deleteObject(specialCharKey);
    expect(delResp).toBe(true);

    // Check if the object is deleted
    const deletedData = await s3mini.getObject(specialCharKey);
    expect(deletedData).toBe(null);
  });

  // test If-Match header
  it('etag and if-match header check', async () => {
    const response = await s3mini.putObject(key, contentString);
    const etag = sanitizeETag(response.headers.get('etag'));
    expect(etag).toBeDefined();
    expect(etag.length).toBe(32);

    const secondEtag = await s3mini.getEtag(key);
    expect(secondEtag).toBe(etag);
    expect(secondEtag.length).toBe(32);

    const values = await s3mini.getObjectWithETag(key);
    expect(values).toBeInstanceOf(Object);
    // convert arrayBuffer to string
    const decoder = new TextDecoder('utf-8');
    const content = decoder.decode(values.data);
    expect(content).toBe(contentString);
    expect(values.etag).toBe(etag);
    expect(values.etag.length).toBe(32);

    const data = await s3mini.getObject(key, { 'if-match': etag });
    expect(data).toBe(contentString);

    const randomWrongEtag = 'random-wrong-etag';
    const anotherResponse = await s3mini.getObject(key, { 'if-match': randomWrongEtag });
    expect(anotherResponse).toBe(null);

    const reponse2 = await s3mini.getObject(key, { 'if-none-match': etag });
    expect(reponse2).toBe(null);

    const reponse3 = await s3mini.getObject(key, { 'if-none-match': randomWrongEtag });
    expect(reponse3).toBe(contentString);

    // Clean up
    const delResp = await s3mini.deleteObject(key);
    expect(delResp).toBe(true);

    // Check if the object is deleted
    const deletedData = await s3mini.getObject(key);
    expect(deletedData).toBe(null);
  });

  // list multipart uploads and abort them
  it('list multipart uploads and abort them all', async () => {
    let multipartUpload;
    do {
      multipartUpload = await s3mini.listMultipartUploads();
      expect(multipartUpload).toBeDefined();
      expect(typeof multipartUpload).toBe('object');
      if (!multipartUpload.uploadId || !multipartUpload.key) {
        break;
      }
      const abortUploadResponse = await s3mini.abortMultipartUpload(multipartUpload.key, multipartUpload.uploadId);
      expect(abortUploadResponse).toBeDefined();
      expect(abortUploadResponse.status).toBe('Aborted');
      expect(abortUploadResponse.key).toEqual(multipartUpload.key);
      expect(abortUploadResponse.uploadId).toEqual(multipartUpload.uploadId);
    } while (multipartUpload.uploadId && multipartUpload.key);

    const multipartUpload2 = await s3mini.listMultipartUploads();
    expect(multipartUpload2).toBeDefined();
    expect(typeof multipartUpload2).toBe('object');
    expect(multipartUpload2).not.toHaveProperty('key');
    expect(multipartUpload2).not.toHaveProperty('uploadId');
  });

  // multipart upload and download
  it('multipart upload and download', async () => {
    const multipartKey = 'multipart-object.txt';
    const partSize = EIGHT_MB; // 8 MB
    const totalParts = Math.ceil(large_buffer.length / partSize);
    const uploadId = await s3mini.getMultipartUploadId(multipartKey);

    const uploadPromises = [];
    for (let i = 0; i < totalParts; i++) {
      const partBuffer = large_buffer.subarray(i * partSize, (i + 1) * partSize);
      uploadPromises.push(s3mini.uploadPart(multipartKey, uploadId, partBuffer, i + 1));
    }
    const uploadResponses = await Promise.all(uploadPromises);

    const parts = uploadResponses.map((response, index) => ({
      partNumber: index + 1,
      etag: response.etag,
    }));

    const completeResponse = await s3mini.completeMultipartUpload(multipartKey, uploadId, parts);
    expect(completeResponse).toBeDefined();
    expect(typeof completeResponse).toBe('object');

    const etag = completeResponse.etag;
    expect(etag).toBeDefined();
    expect(typeof etag).toBe('string');
    expect(etag.length).toBe(32 + 2); // 32 chars + 2 number of parts flag

    const dataArrayBuffer = await s3mini.getObjectArrayBuffer(multipartKey);
    const dataBuffer = Buffer.from(dataArrayBuffer);
    expect(dataBuffer).toBeInstanceOf(Buffer);
    expect(dataBuffer.toString('utf-8')).toBe(large_buffer.toString('utf-8'));

    const multipartUpload = await s3mini.listMultipartUploads();
    expect(multipartUpload).toBeDefined();
    expect(typeof multipartUpload).toBe('object');
    expect(multipartUpload).not.toHaveProperty('key');
    expect(multipartUpload).not.toHaveProperty('uploadId');

    // lets test getObjectRaw with range
    const rangeStart = 2048 * 1024; // 2 MB
    const rangeEnd = 8 * 1024 * 1024 * 2; // 16 MB
    const rangeResponse = await s3mini.getObjectRaw(multipartKey, false, rangeStart, rangeEnd);
    const rangeData = await rangeResponse.arrayBuffer();
    expect(rangeResponse).toBeDefined();

    expect(rangeData).toBeInstanceOf(ArrayBuffer);
    const rangeBuffer = Buffer.from(rangeData);
    expect(rangeBuffer.toString('utf-8')).toBe(large_buffer.subarray(rangeStart, rangeEnd).toString('utf-8'));

    const objectExists = await s3mini.objectExists(multipartKey);
    expect(objectExists).toBe(true);
    const objectSize = await s3mini.getContentLength(multipartKey);
    expect(objectSize).toBe(large_buffer.length);
    const objectEtag = await s3mini.getEtag(multipartKey);
    expect(objectEtag).toBe(etag);
    expect(objectEtag.length).toBe(32 + 2); // 32 chars + 2 number of parts flag

    const delResp = await s3mini.deleteObject(multipartKey);
    expect(delResp).toBe(true);

    const objectExists2 = await s3mini.objectExists(multipartKey);
    expect(objectExists2).toBe(false);

    const deletedData = await s3mini.getObject(multipartKey);
    expect(deletedData).toBe(null);
  });

  it('extensive list objects', async () => {
    const prefix = `test-prefix-${Date.now()}/`;
    const objAll = await s3mini.listObjects('/', prefix);
    expect(objAll).toEqual([]);
    expect(objAll).toBeInstanceOf(Array);
    expect(objAll).toHaveLength(0);

    await Promise.all([
      s3mini.putObject(`${prefix}object1.txt`, contentString),
      s3mini.putObject(`${prefix}object2.txt`, contentString),
      s3mini.putObject(`${prefix}object3.txt`, contentString),
    ]);

    const objsUnlimited = await s3mini.listObjects('/', prefix);
    expect(objsUnlimited).toBeInstanceOf(Array);
    expect(objsUnlimited).toHaveLength(3);

    const objsLimited = await s3mini.listObjects('/', prefix, 2);
    expect(objsLimited).toBeInstanceOf(Array);
    expect(objsLimited).toHaveLength(2);
    expect(objsLimited[0].key).toBe(`${prefix}object1.txt`);
    expect(objsLimited[1].key).toBe(`${prefix}object2.txt`);

    await Promise.all(objsUnlimited.map(o => s3mini.deleteObject(o.key)));
    expect(await s3mini.listObjects('/', prefix)).toEqual([]);
  });

  it('lists objects with pagination', async () => {
    /* ----- test data setup ----- */
    const prefix = `test-prefix-${Date.now()}/`; // isolate this run
    const totalKeys = 1_114;
    const pageSmall = 2;
    const pageLarge = 900;

    // Bucket must start empty for this prefix
    expect(await s3mini.listObjects('/', prefix)).toEqual([]);
    let counter = 0;
    // Upload 1 114 objects in parallel
    const generator = function* (n) {
      for (let i = 0; i < n; i++)
        yield async () => {
          const success = await s3mini.putObject(`${prefix}object${i}.txt`, contentString);
          if (!success) {
            throw new Error(`Failed to upload ${prefix}object${i}.txt`);
          } else {
            counter++;
          }
        };
    };
    await runInBatches(generator(totalKeys), OP_CAP, 1_000);

    /* ----- assertions ----- */
    // 1️⃣  Small page (2)
    const firstTwo = await s3mini.listObjects('/', prefix, pageSmall);
    expect(firstTwo).toBeInstanceOf(Array);
    expect(firstTwo).toHaveLength(pageSmall); // ✔ array length = 2:contentReference[oaicite:1]{index=1}

    // 2️⃣  “Maximum” single page (1 000)
    const first900Hundred = await s3mini.listObjects('/', prefix, pageLarge);
    expect(first900Hundred).toBeInstanceOf(Array);
    expect(first900Hundred).toHaveLength(pageLarge); // ✔ array length = 900:contentReference[oaicite:2]{index=2}
    expect(first900Hundred[0].key).toBe(`${prefix}object0.txt`); // ✔ first object key

    // 3️⃣  Unlimited (implicit pagination inside helper)
    const everything = await s3mini.listObjects('/', prefix); // maxKeys = undefined ⇒ list all
    expect(everything).toBeInstanceOf(Array);
    expect(everything).toHaveLength(counter);

    // cleanup
    const generator2 = function* (n) {
      for (let i = 0; i < n; i++)
        yield async () => {
          await s3mini.deleteObject(everything[i].key);
        };
    };
    await runInBatches(generator2(everything.length), OP_CAP, 1_000);

    // Verify bucket now empty for this prefix
    expect(await s3mini.listObjects('/', prefix)).toEqual([]);
  });
};
