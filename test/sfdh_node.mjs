// rr6-nx-installer (2026-11-21): lib/sfdh.js against rr6-nx's tools/hevc_sfd_pack.py, without a browser (Node has no
// WebCodecs: the H.265 frames come from the .hevc the tool made). For a movie and the tool's NAME.hevc of it:
//   1. lib/sfdh.js reads the same pictures and display order, and the same picture rate;
//   2. its writer, given the tool's H.265 frames, writes the tool's file byte for byte.
//   node test/sfdh_node.mjs MOVIE.sfd TOOL.hevc
import { readFileSync } from 'node:fs';
import { demux, pictures, __test } from '../lib/sfdh.js';

const [src, tool] = process.argv.slice(2);
const d = new Uint8Array(readFileSync(src));
const t = new Uint8Array(readFileSync(tool));
const v = new DataView(t.buffer, t.byteOffset, t.byteLength);
const u64 = (o) => v.getUint32(o, true) + v.getUint32(o + 4, true) * 0x100000000;
const nPics = v.getUint32(48, true), picOff = u64(56);
const width = v.getUint32(64, true), height = v.getUint32(68, true), nFrames = v.getUint32(72, true);
const fpsMilli = v.getUint32(76, true), frameTab = u64(80);

const { es, runs, pts } = demux(d);
const pics = pictures(es);
const seq = __test.sequenceSize(es);
const fps = __test.pictureRate(pics, pts, seq.rate);
let order = 0;
for (let i = 0; i < Math.min(nPics, pics.length); i++) if (v.getUint32(picOff + 4 * i, true) !== pics[i].disp) order++;
console.log(`pictures: ${pics.length} here, ${nPics} by the tool, display indices that differ ${order}; ${seq.width}x${seq.height} ` +
            `(the tool's ${width}x${height}); rate ${fps} (the sequence header says ${seq.rate}; the tool's ${fpsMilli / 1000})`);

const frames = [];
for (let i = 0; i < nFrames; i++) {
  const o = frameTab + 16 * i;
  const off = u64(o), size = v.getUint32(o + 8, true), key = (v.getUint32(o + 12, true) & 1) === 1;
  frames.push({ data: t.subarray(off, off + size), key });
}
const blob = __test.build(d, runs, pics, frames, width, height, fpsMilli / 1000);
const mine = new Uint8Array(await blob.arrayBuffer());
let same = mine.length === t.length;
if (same) for (let i = 0; i < t.length; i++) if (mine[i] !== t[i]) { same = false; console.log(`first difference at ${i}`); break; }
console.log(`the writer: ${mine.length} bytes against the tool's ${t.length}: ${same ? 'byte for byte the same' : 'DIFFERENT'}`);
