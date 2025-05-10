'use strict';

import * as dotenv from 'dotenv';
dotenv.config();

import { join } from 'path';
import { composeDown } from '../docker.js';

await composeDown(join(process.cwd(), 'tests', 'compose.minio.yaml'));
