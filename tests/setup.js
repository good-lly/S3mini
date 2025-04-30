'use strict';

import 'dotenv/config'; // loads .env automatically :contentReference[oaicite:5]{index=5}
import { join } from 'path';
import { composeUp } from './docker.js';

const composeFiles = {
  minio: join(process.cwd(), 'tests', 'compose.minio.yaml'),
  // ceph: join(process.cwd(), 'tests', 'compose.ceph.yaml'),
};

const wanted = new Set(
  Object.values(process.env)
    .filter(v => typeof v === 'string' && v.startsWith('BUCKET_ENV_'))
    .map(v => v.split(',')[0]),
);

export default async () => {
  for (const p of wanted) {
    if (composeFiles[p]) {
      console.log(`⏫  starting ${p} …`);
      await composeUp(composeFiles[p]);
    }
  }
};
