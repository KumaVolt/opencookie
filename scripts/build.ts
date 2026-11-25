// Bundles the banner (for visitors' browsers) and the admin UI into ./dist.
import { build } from 'esbuild';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
await mkdir(resolve(dist, 'admin'), { recursive: true });

await build({
  entryPoints: [resolve(root, 'src/banner/banner.ts')],
  outfile: resolve(dist, 'banner.js'),
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  legalComments: 'none',
  banner: { js: '/*! OpenCookie — AGPL-3.0 */' },
});

await build({
  entryPoints: [resolve(root, 'src/admin/main.tsx')],
  outfile: resolve(dist, 'admin/app.js'),
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  jsxImportSource: 'preact',
});
await copyFile(resolve(root, 'src/admin/index.html'), resolve(dist, 'admin/index.html'));
await copyFile(resolve(root, 'src/admin/admin.css'), resolve(dist, 'admin/admin.css'));

const kb = async (f: string) => ((await stat(resolve(dist, f))).size / 1024).toFixed(1) + ' KB';
console.log(`banner.js ${await kb('banner.js')}, admin/app.js ${await kb('admin/app.js')}`);
