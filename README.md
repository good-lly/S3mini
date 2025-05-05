# 👶 S3mini: Essential only S3 client. Edge computing ready. Zero-dependency.

The `S3mini` library is only lightweight (~13KB) TypeScript zero‑dependency library for S3-compatible storage services. Running on NodeJS, Bun, Cloudflare Workers, and edge computing platforms. It supports only minimum S3 APIs. Tested on Cloudflare R2, Backblaze B2, DigitalOcean Storage, MinIO. (No Browser support)

## Features

- 🚀 Lightweight: Only ~13KB unminified
- 🔧 Zero dependencies
- 💻 Works on NodeJS, Bun, Cloudflare workers, ideal for edge computing (no browser support)
- 🔑 Supports only essential S3 APIs (list, put, get, delete and a few more)
- 🔁 Streaming support & multipart uploads for large files
- 📦 Bring your own S3 bucket (tested on: Cloudflare R2, Backblaze B2, DigitalOcean Storage, MinIO)

## Supported Operations

The library supports the following operations:

#### Bucket ops

- ✅ HeadBucket
- ✅ CreateBucket

#### Objects ops

- ✅ ListObjectsV2 (listObjects)
- ✅ GetObject
- ✅ PutObject
- ✅ DeleteObject
- ✅ HeadObject
- ✅ ListMultipartUploads
- ✅ CreateMultipartUpload
- ✅ GetMultipartUploadId
- ✅ CompleteMultipartUpload
- ✅ AbortMultipartUpload
- ✅ UploadPart

Not implemented (tbd)

- ❌ CopyObject

## Table of Contents

- [Installation](#installation)
- [Constructor](#constructor)
- [Basic Operations](#basic-operations)
  - [Bucket Operations](#bucket-operations)
  - [Object Operations](#object-operations)
  - [Multipart Upload](#multipart-upload)
  - [List Operations](#list-operations)
- [Configuration Methods](#configuration-methods)
- [Utility Methods](#utility-methods)

## Installation

```javascript
// Using npm
npm install core-s3

// Using yarn
yarn add core-s3

// Using pnpm
pnpm add core-s3
```

## Constructor

Create a new instance of the S3 client:

```javascript
import { S3 } from 'core-s3';

const s3Client = new S3({
  accessKeyId: 'YOUR_ACCESS_KEY_ID',
  secretAccessKey: 'YOUR_SECRET_ACCESS_KEY',
  endpoint: 'https://s3.amazonaws.com/...',
  region: 'us-east-1', // Optional, defaults to 'auto'
  maxRequestSizeInBytes: 5242880, // Optional, defaults to 5MB
  requestAbortTimeout: 30000, // Optional, timeout in milliseconds
  logger: console, // Optional, custom logger
});
```

## Basic Operations

### Bucket Operations

#### Check if Bucket Exists

```javascript
const bucketExists = await s3Client.bucketExists();
console.log(`Bucket exists: ${bucketExists}`);
```

#### Create Bucket

```javascript
const created = await s3Client.createBucket();
console.log(`Bucket created: ${created}`);
```

### Object Operations

#### Upload a File

```javascript
const fileContent = 'Hello, World!';
const key = 'example.txt';
const response = await s3Client.putObject(key, fileContent);
console.log(`File uploaded successfully: ${response.status === 200}`);
```

#### Get a File

```javascript
const key = 'example.txt';
const response = await s3Client.getObject(key);
if (response) {
  const content = await response.text();
  console.log(`File content: ${content}`);
} else {
  console.log('File not found');
}
```

#### Get a File with ETag

```javascript
const key = 'example.txt';
const { etag, data } = await s3Client.getObjectWithETag(key);
if (data) {
  console.log(`File content: ${data}`);
  console.log(`ETag: ${etag}`);
}
```

#### Check if File Exists

```javascript
const key = 'example.txt';
const exists = await s3Client.objectExists(key);
console.log(`File exists: ${exists}`);
```

#### Get ETag of a File

```javascript
const key = 'example.txt';
const etag = await s3Client.getEtag(key);
console.log(`File ETag: ${etag}`);
```

#### Get Content Length

```javascript
const key = 'example.txt';
const contentLength = await s3Client.getContentLength(key);
console.log(`File size: ${contentLength} bytes`);
```

#### Get Raw Response

```javascript
const key = 'example.txt';
const response = await s3Client.getObjectRaw(key);
// Process the raw response
```

#### Delete a File

```javascript
const key = 'example.txt';
const deleted = await s3Client.deleteObject(key);
console.log(`File deleted: ${deleted}`);
```

### Multipart Upload

#### Initiate Multipart Upload

```javascript
const key = 'large-file.txt';
const fileType = 'text/plain';
const uploadId = await s3Client.getMultipartUploadId(key, fileType);
console.log(`Multipart upload initiated with ID: ${uploadId}`);
```

#### Upload Part

```javascript
const key = 'large-file.txt';
const partContent = Buffer.from('Part content...');
const uploadId = 'your-upload-id';
const partNumber = 1;

const partResult = await s3Client.uploadPart(key, partContent, uploadId, partNumber);
console.log(`Part uploaded: ${JSON.stringify(partResult)}`);
```

#### Complete Multipart Upload

```javascript
const key = 'large-file.txt';
const uploadId = 'your-upload-id';
const parts = [
  { partNumber: 1, ETag: 'etag1' },
  { partNumber: 2, ETag: 'etag2' },
];

const result = await s3Client.completeMultipartUpload(key, uploadId, parts);
console.log(`Multipart upload completed: ${JSON.stringify(result)}`);
```

#### Abort Multipart Upload

```javascript
const key = 'large-file.txt';
const uploadId = 'your-upload-id';

const result = await s3Client.abortMultipartUpload(key, uploadId);
console.log(`Multipart upload aborted: ${JSON.stringify(result)}`);
```

### List Operations

#### List Objects

```javascript
const delimiter = '/';
const prefix = 'folder/';
const maxKeys = 1000;

const objects = await s3Client.listObjects(delimiter, prefix, maxKeys);
console.log(`Objects: ${JSON.stringify(objects)}`);
```

#### List Multipart Uploads

```javascript
const delimiter = '/';
const prefix = 'folder/';

const uploads = await s3Client.listMultiPartUploads(delimiter, prefix);
console.log(`Multipart uploads: ${JSON.stringify(uploads)}`);
```

## Configuration Methods

#### Get/Set Region

```javascript
// Get the current region
const region = s3Client.getRegion();

// Set a new region
s3Client.setRegion('us-west-1');
```

#### Get/Set Endpoint

```javascript
// Get the current endpoint
const endpoint = s3Client.getEndpoint();

// Set a new endpoint
s3Client.setEndpoint('https://new-s3-endpoint.com');
```

#### Get/Set Maximum Request Size

```javascript
// Get the current maximum request size in bytes
const maxSize = s3Client.getMaxRequestSizeInBytes();

// Set a new maximum request size (10MB)
s3Client.setMaxRequestSizeInBytes(10 * 1024 * 1024);
```

#### Get/Set All Properties

```javascript
// Get all properties
const props = s3Client.getProps();

// Set all properties
s3Client.setProps({
  accessKeyId: 'NEW_ACCESS_KEY_ID',
  secretAccessKey: 'NEW_SECRET_ACCESS_KEY',
  endpoint: 'https://new-endpoint.com',
  region: 'eu-west-1',
  maxRequestSizeInBytes: 10485760,
  requestAbortTimeout: 60000,
  logger: customLogger,
});
```

## Utility Methods

#### Sanitize ETag

```javascript
const rawETag = '"abcdef1234567890"';
const sanitizedETag = s3Client.sanitizeETag(rawETag);
console.log(`Sanitized ETag: ${sanitizedETag}`); // Outputs: abcdef1234567890
```

## Error Handling

The library throws descriptive error messages for invalid parameters and failed operations. Always use try-catch blocks when working with asynchronous operations:

```javascript
try {
  const result = await s3Client.getObject('non-existent-file.txt');
  // Process result
} catch (error) {
  console.error(`Error: ${error.message}`);
}
```

## Security Notes

- The library masks sensitive information (access keys, session tokens, etc.) when logging.
- Always protect your AWS credentials and avoid hardcoding them in your application.
- Consider using environment variables or a secure vault for storing credentials.

## Advanced Usage

### Custom Headers and Options

Many methods accept optional parameters for customization:

```javascript
// Get with conditional headers
const result = await s3Client.getObject('example.txt', {
  'if-match': 'etag-value',
  'if-modified-since': new Date().toUTCString(),
});

// List with additional options
const objects = await s3Client.listObjects('/', 'folder/', 100, 'GET', {
  'fetch-owner': 'true',
});
```

### Custom Logger Integration

The library supports custom loggers for better integration with your application's logging system:

```javascript
const customLogger = {
  info: message => {
    /* Custom info logging */
  },
  error: message => {
    /* Custom error logging */
  },
  warn: message => {
    /* Custom warning logging */
  },
};

const s3Client = new S3({
  // Other parameters
  logger: customLogger,
});
```

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details.
