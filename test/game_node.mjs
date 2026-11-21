// sasrt-nx-installer (2026-11-21): SASRT's game folder as the page lays it out under switch/sasrt-nx/game_root, made on a
// PC (Node has no WebCodecs: the re-encodes come from the PC tools), for test runs of the port:
//   - game.json's `lz4` files as NAME.lz4b (LZ4 HC 9, 256 KB blocks), `zxc` files as NAME.lz4b (ZXC 7, 512 KB);
//   - the movies: NAME.usm.hevc from HEVC_DIR (sasrt-nx's tools/hevc_usm_pack.py; lib/usmh.js's writer checked against
//     it byte for byte) packed as NAME.usm.hevc.lz4b (ZXC), as the page packs its own;
//   - the sound packages: NAME.pck.xmop from XMOP_DIR (test/xmop_node.mjs), as NAME.pck.xmop.lz4b (ZXC) when that is
//     game.json's zxc_min_saving smaller, else as it is;
//   - every other file copied, but game.json's `skip`; with --measure, what ZXC would save on each copied file.
//   node test/game_node.mjs <game folder> <out game_root> --hevc HEVC_DIR --xmop XMOP_DIR [--measure] [--only REGEX]
import { copyFile, open } from 'node:fs/promises';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { once } from 'node:events';
import { dirname, join, relative } from 'node:path';
import { CODECS, codecFor, pack, SUFFIX } from '../lib/lz4b.js';
import { demuxUsm } from '../lib/usmh.js';
import { build, pictures, sequenceSize } from '../lib/sfdh.js';
import { packPool } from './node_pool.mjs';

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : def; };
const hevcDir = flag('--hevc', null), xmopDir = flag('--xmop', null), only = flag('--only', null);
const measure = args.includes('--measure');
const [game, out] = args.filter((a) => !a.startsWith('--'));
if (!game || !out) {
  console.error('usage: node test/game_node.mjs <game folder> <out game_root> --hevc DIR --xmop DIR [--measure] [--only REGEX]');
  process.exit(2);
}
const config = JSON.parse(readFileSync(new URL('../game.json', import.meta.url)));
const fits = (list, p) => (list || []).some((m) => new RegExp(`^(?:${m})$`, 'i').test(p));
const movieRe = new RegExp(`^(?:${config.movies.match})$`, 'i'), audioRe = new RegExp(`^(?:${config.audio.match})$`, 'i');

function walk(dir, list = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, list);
    else list.push(relative(game, p).replace(/\\/g, '/'));
  }
  return list;
}

async function fileOf(path) {
  const handle = await open(path, 'r');
  const { size } = await handle.stat();
  return {
    size, handle,
    async read(offset, length) {
      const buffer = new Uint8Array(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      if (bytesRead !== length) throw new Error(`${path}: short read`);
      return buffer;
    },
  };
}

const pool = await packPool();
// file -> NAME.lz4b with codec; the bytes written
async function packTo(file, codec, target, write = true) {
  const ws = write ? createWriteStream(target) : null;
  let written = 0;
  for await (const chunk of pack(file, pool.compress, { codec, inFlight: pool.count * 4 })) {
    written += chunk.length;
    if (ws && !ws.write(chunk)) await once(ws, 'drain');
  }
  if (ws) { ws.end(); await once(ws, 'finish'); }
  return written;
}

const mb = (n) => (n / 1048576).toFixed(1);
const rows = [];
let totalIn = 0, totalOut = 0;
for (const path of walk(game).sort()) {
  if (fits(config.skip, path) || (only && !new RegExp(only, 'i').test(path))) continue;
  const src = join(game, path);
  const size = statSync(src).size;
  const t0 = performance.now();
  mkdirSync(dirname(join(out, path)), { recursive: true });
  let name = path, outSize = size, how = 'copied';
  if (movieRe.test(path) && hevcDir && existsSync(join(hevcDir, path.split('/').pop() + '.hevc'))) {
    // the tool's .hevc, checked against lib/usmh.js's writer, then ZXC-packed
    const hevcPath = join(hevcDir, path.split('/').pop() + '.hevc');
    const d = new Uint8Array(readFileSync(src)), t = new Uint8Array(readFileSync(hevcPath));
    const v = new DataView(t.buffer, t.byteOffset, t.byteLength);
    const u64 = (o) => v.getUint32(o, true) + v.getUint32(o + 4, true) * 0x100000000;
    const { es, runs } = demuxUsm(d);
    const pics = pictures(es), seq = sequenceSize(es);
    const frames = [];
    for (let i = 0; i < v.getUint32(72, true); i++) {
      const o = u64(80) + 16 * i;
      frames.push({ data: t.subarray(u64(o), u64(o) + v.getUint32(o + 8, true)), key: (v.getUint32(o + 12, true) & 1) === 1 });
    }
    const mine = new Uint8Array(await build(d, runs, pics, frames, seq.width, seq.height, seq.rate).arrayBuffer());
    const same = mine.length === t.length && mine.every((b, i) => b === t[i]);
    if (!same) throw new Error(`${path}: lib/usmh.js's writer does not give the tool's .hevc`);
    name = `${path}.hevc${SUFFIX}`;
    const asFile = { size: t.length, read: async (o, n) => t.slice(o, o + n) };
    outSize = await packTo(asFile, 'zxc', join(out, name));
    how = `H.265 (${mb(t.length)} MB, the page's writer the same byte for byte), ZXC`;
  } else if (audioRe.test(path) && xmopDir && existsSync(join(xmopDir, path + '.xmop'))) {
    const xmopPath = join(xmopDir, path + '.xmop');
    const f = await fileOf(xmopPath);
    const packed = await packTo(f, 'zxc', null, false);
    const saving = 1 - packed / f.size;
    if (saving > (config.audio.zxc_min_saving ?? 0.05)) {
      name = `${path}.xmop${SUFFIX}`;
      outSize = await packTo(f, 'zxc', join(out, name));
      how = `Opus (${mb(f.size)} MB), ZXC ${(100 * saving).toFixed(1)} % smaller`;
    } else {
      name = `${path}.xmop`;
      await copyFile(xmopPath, join(out, name));
      outSize = f.size;
      how = `Opus, as it is (ZXC would save ${(100 * saving).toFixed(1)} %)`;
    }
    await f.handle.close();
  } else {
    const codec = codecFor(path, config);
    if (codec) {
      const f = await fileOf(src);
      name = path + SUFFIX;
      outSize = await packTo(f, codec, join(out, name));
      await f.handle.close();
      how = codec.toUpperCase();
    } else {
      await copyFile(src, join(out, path));
      if (measure && size > 65536) {
        const f = await fileOf(src);
        const z = await packTo(f, 'zxc', null, false);
        await f.handle.close();
        how = `copied (ZXC would save ${(100 * (1 - z / size)).toFixed(1)} %)`;
      }
    }
  }
  // a re-encode or pack written beside an older plain copy: one name only
  for (const other of [path, path + SUFFIX, `${path}.xmop`, `${path}.xmop${SUFFIX}`, `${path}.hevc${SUFFIX}`])
    if (other !== name && existsSync(join(out, other))) unlinkSync(join(out, other));
  totalIn += size;
  totalOut += outSize;
  const s = (performance.now() - t0) / 1000;
  rows.push(`${path}: ${mb(size)} MB -> ${name.split('/').pop()} ${mb(outSize)} MB (${(100 * outSize / size).toFixed(1)} %), ${how}, ${s.toFixed(0)} s`);
  console.log(rows[rows.length - 1]);
}
console.log(`all: ${mb(totalIn)} MB -> ${mb(totalOut)} MB (${(100 * totalOut / totalIn).toFixed(1)} %)`);
await pool.close();
