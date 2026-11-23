// sasrt-nx-installer (2026-11-22): lib/god.js on a Games on Demand package, against the folder it was extracted to
// (sasrt-nx's tools/god_extract.py): every file's size, default.xex whole, and 64 random ranges of the others.
//   node test/god_node.mjs <header file> <extracted folder>
import fs from 'node:fs';
import path from 'node:path';
import { openGod } from '../lib/god.js';
import { listXiso } from '../lib/xiso.js';

const [headerPath, folder] = process.argv.slice(2);
const fileRead = (p) => {
  const fd = fs.openSync(p, 'r');
  return async (offset, length) => {
    const b = Buffer.alloc(length);
    fs.readSync(fd, b, 0, length, offset);
    return new Uint8Array(b.buffer, b.byteOffset, length);
  };
};
const header = new Uint8Array(fs.readFileSync(headerPath).subarray(0, 0xb000));
const dataDir = headerPath + '.data';
const names = fs.readdirSync(dataDir).filter((n) => /^Data\d{4}$/.test(n)).sort();
const data = names.map((n) => ({ size: fs.statSync(path.join(dataDir, n)).size, read: fileRead(path.join(dataDir, n)) }));
const god = await openGod(header, data);
console.log(`${god.name}: ${god.kind}, title ${god.titleId.toString(16).toUpperCase()}, ${(god.size / 1048576).toFixed(0)} MB, ${names.length} data files`);
const files = await listXiso((o, n) => god.read(o, n), god.size);
let bad = 0;
for (const f of files) {
  const p = path.join(folder, f.path);
  if (!fs.existsSync(p)) { console.log('  not in the folder:', f.path); bad++; continue; }
  if (fs.statSync(p).size !== f.size) { console.log('  size differs:', f.path); bad++; }
}
const same = async (f, offset, length) => {
  const a = await god.read(f.offset + offset, length);
  const b = await fileRead(path.join(folder, f.path))(offset, length);
  return Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
};
const xex = files.find((f) => f.path.toLowerCase() === 'default.xex');
if (!(await same(xex, 0, xex.size))) { console.log('  default.xex differs'); bad++; }
const big = files.filter((f) => f.size > 1 << 20);
for (let i = 0; i < 64; i++) {
  const f = big[i % big.length];
  const length = 1 + Math.floor(Math.random() * 300000);
  const offset = Math.floor(Math.random() * Math.max(1, f.size - length));
  if (!(await same(f, offset, length))) { console.log(`  ${f.path} differs at ${offset} (+${length})`); bad++; }
}
console.log(`${files.length} files; ${bad ? bad + ' problems' : 'every size, default.xex and 64 ranges the same'}`);
process.exit(bad ? 1 : 0);
