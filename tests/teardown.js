import 'dotenv/config';
import { join } from 'path';
import { composeDown } from './docker.js';

const composeFiles = {
  minio: join(process.cwd(), 'tests', 'compose.minio.yaml'),
  ceph: join(process.cwd(), 'tests', 'compose.ceph.yaml'),
};

const wanted = new Set(
  Object.values(process.env)
    .filter(v => typeof v === 'string' && v.startsWith('BUCKET_ENV_'))
    .map(v => v.split(',')[0]),
);

export default async () => {
  for (const p of wanted) {
    if (composeFiles[p]) {
      console.log(`⏬  stopping ${p} …`);
      await composeDown(composeFiles[p]);
    }
  }
};
