import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import dts from 'rollup-plugin-dts';
import terser from '@rollup/plugin-terser';

const production = !process.env.ROLLUP_WATCH;

export default [
  {
    input: 'src/index.ts',
    output: [
      {
        file: 'dist/S3mini.js',
        format: 'esm',
        sourcemap: true,
      },
      {
        file: 'dist/S3mini.min.js',
        format: 'esm',
        sourcemap: true,
        plugins: [terser()],
      },
    ],
    plugins: [
      nodeResolve(),
      typescript({
        tsconfig: './tsconfig.json',
        sourceMap: true,
      }),
      production &&
        terser({
          format: {
            comments: false,
          },
        }),
    ],
    treeshake: {
      moduleSideEffects: false,
      propertyReadSideEffects: false,
      tryCatchDeoptimization: false,
    },
  },
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/S3mini.d.ts',
      format: 'esm',
    },
    plugins: [dts()],
  },
];
