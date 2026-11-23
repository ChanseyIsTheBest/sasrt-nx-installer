// sasrt-nx-installer (2026-11-22): lib/sources.js gameContainers over a records file (sasrt-nx's tools/shader_records.py
// output: 'split' records in the resource packages and in default.xex's image, some with the edits a bound vertex
// shader has) on a game folder, as the page reads it: every container read, edited and checked by its SHA-256.
//   node test/records_node.mjs <game folder> <shader_records.json> [<dump folder>]
// With the dump folder: each container also compared with the dump's file byte for byte. The output names no game data.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gameContainers } from '../lib/sources.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const [gameDir, recordsPath, dumpDir] = process.argv.slice(2);
if (!gameDir || !recordsPath) {
  console.error('usage: node test/records_node.mjs <game folder> <shader_records.json> [<dump folder>]');
  process.exit(2);
}
function folderFiles(dir) {
  return fs.readdirSync(dir, { recursive: true }).map(String).filter((p) => fs.statSync(path.join(dir, p)).isFile())
    .map((p) => {
      const full = path.join(dir, p);
      return {
        path: p.split(path.sep).join('/'),
        size: fs.statSync(full).size,
        read: async (offset, length) => {
          const fd = fs.openSync(full, 'r');
          try {
            const buf = Buffer.alloc(length);
            const n = fs.readSync(fd, buf, 0, length, offset);
            return new Uint8Array(buf.buffer, buf.byteOffset, n);
          } finally { fs.closeSync(fd); }
        },
      };
    });
}
const lzx = await (await import(pathToFileURL(path.join(root, 'wasm', 'lzx.mjs')).href)).default({ print: () => {}, printErr: () => {} });
const records = JSON.parse(fs.readFileSync(recordsPath, 'utf8'));
const xex = new Uint8Array(fs.readFileSync(path.join(gameDir, 'default.xex')));
const t0 = performance.now();
const containers = await gameContainers(folderFiles(gameDir), xex, { image_sha256: [], records }, lzx, (m) => console.log(m));
const edited = records.reduce((n, r) => n + r.containers.filter((c) => c.edits).length, 0);
console.log(`${containers.length} containers (${edited} with edits) read and checked in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
if (dumpDir) {
  const dump = new Map();
  for (const n of fs.readdirSync(dumpDir)) dump.set(fs.readFileSync(path.join(dumpDir, n)).toString('base64'), n);
  const same = containers.filter((c) => dump.has(Buffer.from(c).toString('base64'))).length;
  console.log(`${same} of them the dump's byte for byte`);
  if (same !== containers.length) process.exit(1);
}
