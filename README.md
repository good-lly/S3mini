# S3mini | Tiny & Blazing-fast S3 client built for edge.

`S3mini` is ultra-lightweight (min ~14KB, +15% ops/s) TypeScript client for S3-compatible object storages. Running on Node, Bun, Cloudflare Workers, and edge platforms. It supports only a few S3 APIs. Tested on Cloudflare R2, Backblaze B2, DigitalOcean Storage, MinIO. (No Browser support)

## Features

- 🚀 Light and Fast: on average ~15% increase in ops/s and ~14KB in size (minified, not gzipped)
- 🔧 Zero dependencies, supports AWS Sig v4 (no presigned reqs)
- 🟠 Works on Cloudflare workers, ideal for edge computing, Node and Bun (no browser support)
- 🔑 Only essential S3 APIs (improved list, put, get, delete and a few more)
- 📦 BYOS3: _`Bring Your Own S3-compatible bucket`_ (tested on: Cloudflare R2, Backblaze B2, DigitalOcean Storage, MinIO with Ceph and Garage in the queue)

[![CodeQL Advanced](https://github.com/good-lly/S3mini/actions/workflows/codeql.yml/badge.svg?branch=dev)](https://github.com/good-lly/S3mini/actions/workflows/codeql.yml)
![GitHub License](https://img.shields.io/github/license/good-lly/S3mini)
![GitHub commit activity](https://img.shields.io/github/commit-activity/m/good-lly/S3mini)
![GitHub package.json version](https://img.shields.io/github/package-json/v/good-lly/S3mini?color=green)
![GitHub Repo stars](https://img.shields.io/github/stars/good-lly/S3mini?style=social)

## Table of Contents

- [Supported Ops](#supported-ops)
- [Installation](#installation)
- [Usage](#usage)
- [Security Notes](#security-notes)
- [💙 Contributions welcomed!](#contributions-welcomed)
- [License](#license)

## Supported Ops

The library supports a subset of S3 operations, focusing on essential features, making it suitable for environments with limited resources.

#### Bucket ops

- ✅ HeadBucket (bucketExists)
- ✅ createBucket (createBucket)

#### Objects ops

- ✅ ListObjectsV2 (listObjects)
- ✅ GetObject (getObject, getObjectWithETag, getObjectRaw, getObjectArrayBuffer)
- ✅ PutObject (putObject)
- ✅ DeleteObject (deleteObject)
- ✅ HeadObject (objectExists, getEtag, getContentLength)
- ✅ listMultipartUploads
- ✅ CreateMultipartUpload (getMultipartUploadId)
- ✅ completeMultipartUpload
- ✅ abortMultipartUpload
- ✅ uploadPart
- ❌ CopyObject: Not implemented (tbd)

## Installation

```bash
npm install S3mini
```

```bash
yarn add S3mini
```

```bash
pnpm add S3mini
```

## Usage

```typescript
import { S3mini, sanitizeETag } from 'S3mini';

const s3mini = new S3mini({
  accessKeyId: config.accessKeyId,
  secretAccessKey: config.secretAccessKey,
  endpoint: config.endpoint,
  region: config.region,
});

// Basic bucket ops
let exists: boolean = false;
try {
  // Check if the bucket exists
  exists = await s3mini.bucketExists();
} catch (err) {
  throw new Error(`Failed bucketExists() call, wrong credentials maybe: ${err.message}`);
}
if (!exists) {
  // Create the bucket based on the endpoint bucket name
  await s3mini.createBucket();
}

// Basic object ops
// key is the name of the object in the bucket
const smallObjectKey: string = 'small-object.txt';
// content is the data you want to store in the object
// it can be a string or Buffer (recommended for large objects)
const smallObjectContent: string = 'Hello, world!';

// check if the object exists
const objectExists: boolean = await s3mini.objectExists(smallObjectKey);
let etag: string | null = null;
if (!objectExists) {
  // put/upload the object, content can be a string or Buffer
  // to add object into "folder", use "folder/filename.txt" as key
  const resp: Response = await s3mini.putObject(smallObjectKey, smallObjectContent);
  // you can also get etag via getEtag method
  // const etag: string = await s3mini.getEtag(smallObjectKey);
  etag = sanitizeETag(resp.headers.get('etag'));
}

// get the object, null if not found
const objectData: string | null = await s3mini.getObject(smallObjectKey);
console.log('Object data:', objectData);

// get the object with ETag, null if not found
const response2: Response = await s3mini.getObject(smallObjectKey, { 'if-none-match': etag });
if (response2) {
  // ETag changed so we can get the object data and new ETag
  // Note: ETag is not guaranteed to be the same as the MD5 hash of the object
  // ETag is sanitized to remove quotes
  const etag2: string = sanitizeETag(response2.headers.get('etag'));
  console.log('Object data with ETag:', response2.body, 'ETag:', etag2);
} else {
  console.log('Object not found or ETag does match.');
}

// list objects in the bucket, null if bucket is empty
// Note: listObjects uses listObjectsV2 API and iterate over all pages
// so it will return all objects in the bucket which can take a while
// If you want to limit the number of objects returned, use the maxKeys option
// If you want to list objects in a specific "folder", use "folder/" as prefix
// Example s3mini.listObjects({"/" "myfolder/"})
const list: object[] | null = await s3mini.listObjects();
if (list) {
  console.log('List of objects:', list);
} else {
  console.log('No objects found in the bucket.');
}

// delete the object
const wasDeleted: boolean = await s3mini.deleteObject(smallObjectKey);

// Multipart upload
const multipartKey = 'multipart-object.txt';
const large_buffer = new Uint8Array(1024 * 1024 * 15); // 15 MB buffer
const partSize = 8 * 1024 * 1024; // 8 MB
const totalParts = Math.ceil(large_buffer.length / partSize);
// Beware! This will return always a new uploadId
// if you want to use the same uploadId, you need to store it somewhere
const uploadId = await s3mini.getMultipartUploadId(multipartKey);
const uploadPromises = [];
for (let i = 0; i < totalParts; i++) {
  const partBuffer = large_buffer.subarray(i * partSize, (i + 1) * partSize);
  // upload each part
  // Note: uploadPart returns a promise, so you can use Promise.all to upload all parts in parallel
  // but be careful with the number of parallel uploads, it can cause throttling
  // or errors if you upload too many parts at once
  // You can also use generator functions to upload parts in batches
  uploadPromises.push(s3mini.uploadPart(multipartKey, uploadId, partBuffer, i + 1));
}
const uploadResponses = await Promise.all(uploadPromises);
const parts = uploadResponses.map((response, index) => ({
  partNumber: index + 1,
  etag: response.etag,
}));
// Complete the multipart upload
const completeResponse = await s3mini.completeMultipartUpload(multipartKey, uploadId, parts);
const completeEtag = completeResponse.etag;

// List multipart uploads
// returns object with uploadId and key
const multipartUploads: object = await s3mini.listMultipartUploads();
// Abort the multipart upload
const abortResponse = await s3mini.abortMultipartUpload(multipartUploads.key, multipartUploads.uploadId);

// Multipart download
// lets test getObjectRaw with range
const rangeStart = 2048 * 1024; // 2 MB
const rangeEnd = 8 * 1024 * 1024 * 2; // 16 MB
const rangeResponse = await s3mini.getObjectRaw(multipartKey, false, rangeStart, rangeEnd);
const rangeData = await rangeResponse.arrayBuffer();
```

For more check [USAGE.md](USAGE.md) file, examples and tests.

## Security Notes

- The library masks sensitive information (access keys, session tokens, etc.) when logging.
- Always protect your AWS credentials and avoid hardcoding them in your application(!!!) Use environment variables or a secure vault for storing credentials.
- Ensure you have the necessary permissions to access the S3 bucket and perform operations.
- Be cautious when using multipart uploads, as they can incur additional costs if not managed properly.
- Authors are not responsible for any data loss or security breaches resulting from improper usage of the library.

## Contributions welcomed!

Contributions are greatly appreciated! If you have an idea for a new feature or have found a bug, we encourage you to get involved:

- _Report Issues_: If you encounter a problem or have a feature request, please open an issue on GitHub. Include as much detail as possible (environment, error messages, logs, steps to reproduce, etc.) so we can understand and address the issue.

- _Pull Requests_: We welcome PRs! If you want to implement a new feature or fix a bug, feel free to submit a pull request to the latest `dev branch`. For major changes, it's a good idea to discuss your plans in an issue first.

- _Lightweight Philosophy_: When contributing, keep in mind that S3mini aims to remain lightweight and dependency-free. Please avoid adding heavy dependencies. New features should provide significant value to justify any increase in size.

- _Community Conduct_: Be respectful and constructive in communications. We want a welcoming environment for all contributors. For more details, please refer to our [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). No one reads it, but it's there for a reason.

If you figure out a solution to your question or problem on your own, please consider posting the answer or closing the issue with an explanation. It could help the next person who runs into the same thing!

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details.
