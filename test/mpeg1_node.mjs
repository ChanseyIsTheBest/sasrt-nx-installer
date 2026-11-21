// sasrt-nx-installer (2026-11-21): a .usm too (lib/usmh.js's demux; ffmpeg's reference from the video stream alone).
// rr6-nx-installer (2026-11-21): wasm/mpeg1 (FFmpeg 4.4's MPEG-1 decoder) fed as lib/sfdh.js feeds it, against
// ffmpeg's own decode of the movie: every picture out, in display order, and how close (PSNR every 30th).
//   node test/mpeg1_node.mjs MOVIE.sfd|MOVIE.usm [ffmpeg]
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import createMpeg1Module from '../wasm/mpeg1.mjs';
import { demux, pictures, __test } from '../lib/sfdh.js';
import { demuxUsm } from '../lib/usmh.js';

const [src, ffmpeg = 'C:/ffmpeg/ffmpeg.exe'] = process.argv.slice(2);
const d = new Uint8Array(readFileSync(src));
const usm = /\.usm$/i.test(src);
const { es } = usm ? demuxUsm(d) : demux(d);
const pics = pictures(es);
const { width, height } = __test.sequenceSize(es);
const m = await createMpeg1Module();
if (m._mpeg1_open(width, height) < 0) throw new Error('open failed');
const fb = width * height * 3 / 2;
const input = m._mpeg1_malloc(4 << 20);
const out = [];
const take = () => { const p = m._mpeg1_picture(); out.push(m.HEAPU8.slice(p, p + fb)); };
const t0 = performance.now();
for (let k = 0; k < pics.length; k++) {
  const a = k ? pics[k - 1].end : 0, b = pics[k].end;
  m.HEAPU8.set(es.subarray(a, b), input);
  const r = m._mpeg1_decode(input, b - a);
  if (r < 0) throw new Error(`picture ${k}: ${r}`);
  if (r === 1) take();
}
while (m._mpeg1_decode(input, 0) === 1) take();
const s = (performance.now() - t0) / 1000;
console.log(`${pics.length} pictures in, ${out.length} out, ${width}x${height}, ${(out.length / s).toFixed(0)} pictures/s`);

let refSrc = src, fmt = [];
if (usm) {  // ffmpeg reads no USM: the video stream alone
  refSrc = join(mkdtempSync(join(tmpdir(), 'usm-')), 'v.m1v');
  writeFileSync(refSrc, es);
  fmt = ['-f', 'mpegvideo'];
}
const ref = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...fmt, '-i', refSrc, '-map', '0:v:0', '-fps_mode', 'passthrough',
                               '-pix_fmt', 'yuv420p', '-f', 'rawvideo', '-'], { maxBuffer: 2 ** 31 }).stdout;
const n = Math.min(out.length, Math.floor(ref.length / fb));
let worst = 99, sum = 0, cnt = 0;
for (let i = 0; i < n; i += 30) {
  let e = 0;
  const r = ref.subarray(i * fb, (i + 1) * fb), g = out[i];
  for (let j = 0; j < fb; j++) { const x = r[j] - g[j]; e += x * x; }
  const p = e === 0 ? 99 : 10 * Math.log10(255 * 255 / (e / fb));
  worst = Math.min(worst, p); sum += p; cnt++;
}
console.log(`ffmpeg's decode: ${ref.length / fb} pictures; PSNR every 30th: mean ${(sum / cnt).toFixed(1)} dB, min ${worst.toFixed(1)} dB`);
