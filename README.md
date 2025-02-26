# core-s3

🪶 Lightning‑fast, zero‑dependency S3 client for NodeJS, Bun, Cloudflare Workers, and edge computing platforms. Tiny footprint (~16KB) with essential S3 operations for AWS S3, Cloudflare R2, Backblaze B2, MinIO, and other S3-compatible storage services. (No Browser support)

## Features

- 🚀 Lightweight: Only ~16KB minified
- 🔧 Zero dependencies
- 💻 Works on NodeJS, Cloudflare workers, ideal for edge computing (browser support - not implemented yet)
- 🔑 Supports essential S3 APIs (list, put, get, delete and a few more)
- 🔁 Streaming support & multipart uploads for large files
- 📦 Bring your own S3 bucket (tested on: Cloudflare R2, Minio)

## S3 API compatibility

Bucket ops

- ✅ HeadBucket
- ✅ CreateBucket

Objects ops

- ✅ ListObjectsV2
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

## Installation

```bash
npm install core-s3
```
