'use strict';

import * as dotenv from 'dotenv';
dotenv.config();

import { join } from 'path';
import { composeUp } from './docker.js';

const composeFiles = {
  minio: join(process.cwd(), 'tests', 'compose.minio.yaml'),
  // ceph: join(process.cwd(), 'tests', 'compose.ceph.yaml'),
};

const bucketConfigs = Object.keys(process.env)
  .filter(k => k.startsWith('BUCKET_ENV_'))
  .map(k => {
    const [provider, accessKeyId, secretAccessKey, endpoint, region] = process.env[k].split(',');
    return { provider, accessKeyId, secretAccessKey, endpoint, region };
  });

export default async () => {
  for (const cfg of bucketConfigs) {
    const composeFile = composeFiles[cfg.provider];
    if (!composeFile) continue;
    switch (cfg.provider) {
      case 'minio':
        process.env.MINIO_ROOT_USER = cfg.accessKeyId;
        process.env.MINIO_ROOT_PASSWORD = cfg.secretAccessKey;
        break;
      /* case 'ceph':
         process.env.CEPH_ACCESS_KEY = cfg.user;
         process.env.CEPH_SECRET_KEY = cfg.password;
         break; */
    }
    console.log(`⏫  starting ${cfg.provider} image …`);
    await composeUp(composeFile);
  }
};
