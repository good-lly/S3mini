'use strict';

import { spawn } from 'child_process';
import { resolve } from 'path';

const CWD = resolve('.');

function run(cmd, args) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { cwd: CWD, stdio: 'inherit' });
    p.on('close', code => (code === 0 ? res() : rej(new Error(`${cmd} ${args.join(' ')} exited ${code}`))));
  });
}

export const composeUp = file => run('docker', ['compose', '-f', file, 'up', '-d']);
export const composeDown = file => run('docker', ['compose', '-f', file, 'down']);
