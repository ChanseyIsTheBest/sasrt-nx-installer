// sasrt-nx-installer (2026-11-21): the Wwise packages' Opus re-encode on a PC, as the installer does it (lib/xmop.js)
// but with ffmpeg's libopus for the encoder (Node has no WebCodecs); culdcept-nx-installer's test/audio_node.mjs for
// SASRT's packages (credit culdcept-nx). Writes NAME.xmop for each package into OUT (the game folder's paths).
//   node test/xmop_node.mjs <game folder> <out folder> [regex of paths, default Data/sound/.*\.pck] [--jobs N]
//       [--wav DIR]  (also the first few converted sounds' reference decode and Opus, to listen to)
// FFMPEG (env): ffmpeg with libopus (default C:/ffmpeg/ffmpeg.exe).
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import createXmaModule from '../wasm/xma.mjs';
import { resample } from '../lib/resample.js';
import { decodeAll, opusCost, opusRateFor, openSound, preSkipAt, refusal, soundId, writeXmop, xmaSounds,
         xmopBitrate } from '../lib/xmop.js';

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : def; };
const jobs = Number(flag('--jobs', '12'));
const wavDir = flag('--wav', null);
const [game, out, pattern = 'Data/sound/.*\\.pck'] = args;
if (!game || !out) {
  console.error('usage: node test/xmop_node.mjs <game folder> <out folder> [regex] [--jobs N] [--wav DIR]');
  process.exit(2);
}
const FFMPEG = process.env.FFMPEG || 'C:/ffmpeg/ffmpeg.exe';
const config = JSON.parse(readFileSync(new URL('../game.json', import.meta.url)));
const rules = config.audio.bitrates;
const re = new RegExp(`^(?:${pattern})$`, 'i');

function walk(dir, list = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, list);
    else list.push(relative(game, p).replace(/\\/g, '/'));
  }
  return list;
}

// Ogg pages -> packets (RFC 3533): the first is OpusHead (its pre-skip), the second OpusTags.
function oggPackets(bytes) {
  const packets = [];
  let cur = [];
  for (let at = 0; at + 27 <= bytes.length;) {
    if (bytes[at] !== 0x4f || bytes[at + 1] !== 0x67 || bytes[at + 2] !== 0x67 || bytes[at + 3] !== 0x53) throw new Error('bad Ogg page');
    const segs = bytes[at + 26];
    let data = at + 27 + segs;
    for (let i = 0; i < segs; ++i) {
      const len = bytes[at + 27 + i];
      cur.push(bytes.subarray(data, data + len));
      data += len;
      if (len < 255) {
        const n = cur.reduce((s, c) => s + c.length, 0), p = new Uint8Array(n);
        let o = 0;
        for (const c of cur) { p.set(c, o); o += c.length; }
        packets.push(p);
        cur = [];
      }
    }
    at = data;
  }
  return packets;
}

// ffmpeg's libopus: 20 ms packets, VBR, the given rate (48000 or 24000) -> { packets, preSkip48, ogg }
function encodeOpus(pcm, channels, rate, bitrate) {
  return new Promise((resolve, reject) => {
    const ff = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'f32le', '-ar', String(rate), '-ac', String(channels),
      '-i', 'pipe:0', '-c:a', 'libopus', '-b:a', String(bitrate), '-vbr', 'on', '-application', 'audio',
      '-frame_duration', '20', '-compression_level', '10', '-f', 'ogg', 'pipe:1']);
    const chunks = [];
    let err = '';
    ff.stdout.on('data', (d) => chunks.push(d));
    ff.stderr.on('data', (d) => { err += d; });
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code) return reject(new Error(`ffmpeg ${code}: ${err}`));
      const ogg = new Uint8Array(Buffer.concat(chunks));
      const packets = oggPackets(ogg);
      const head = packets[0];
      if (!head || new TextDecoder().decode(head.subarray(0, 8)) !== 'OpusHead') return reject(new Error('no OpusHead'));
      resolve({ preSkip48: head[10] | (head[11] << 8), packets: packets.slice(2), ogg });
    });
    ff.stdin.on('error', () => {});
    ff.stdin.end(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  });
}

function wavFile(pcm, channels, rate) {
  const s16 = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; ++i) s16[i] = Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32767)));
  const b = new Uint8Array(44 + s16.byteLength), v = new DataView(b.buffer);
  b.set(new TextEncoder().encode('RIFF'), 0); v.setUint32(4, 36 + s16.byteLength, true);
  b.set(new TextEncoder().encode('WAVEfmt '), 8); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, channels, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2 * channels, true);
  v.setUint16(32, 2 * channels, true); v.setUint16(34, 16, true);
  b.set(new TextEncoder().encode('data'), 36); v.setUint32(40, s16.byteLength, true);
  b.set(new Uint8Array(s16.buffer), 44);
  return b;
}

const xma = await createXmaModule({ print: () => {}, printErr: () => {} });
const all = walk(game);
const packs = all.filter((p) => /\.pck$/i.test(p)).sort();
const files = packs.filter((p) => re.test(p));
let wavs = 0;
for (const path of files) {
  const t0 = Date.now();
  const d = new Uint8Array(readFileSync(join(game, path)));
  const pack = packs.indexOf(path);
  const candidates = xmaSounds(d);
  const kept = new Map();  // why -> count
  const keep = (why) => kept.set(why, (kept.get(why) || 0) + 1);
  const made = [];
  const inFlight = new Set();
  let xmaBytes = 0, opusBytes = 0;
  for (const s of candidates) {
    const x = openSound(xma, d, s);
    if (!x.info) { keep(x.why); continue; }
    const why = refusal(x.info);
    if (why) { x.close(); keep(why); continue; }
    const { info } = x;
    let pcm;
    try {
      pcm = decodeAll(x);
    } catch (e) {
      x.close();
      keep(e.message);
      continue;
    }
    x.close();
    const rate = opusRateFor(info.rate);
    const input = rate === info.rate ? pcm : resample(pcm, info.channels, info.rate, rate);
    const bitrate = xmopBitrate(rules, path, info.rate, info.channels);
    const job = encodeOpus(input, info.channels, rate, bitrate).then((enc) => {
      const opus = { packets: enc.packets, preSkip: preSkipAt(rate, enc.preSkip48), rate };
      const cost = opusCost(info, opus);
      if (cost >= info.packets * 2048) { keep('not smaller as Opus'); return; }
      made.push({ info, dataOffset: s.info.dataOffset, opus, n: s.n });
      xmaBytes += info.packets * 2048;
      opusBytes += cost;
      if (wavDir && wavs < 6) {
        ++wavs;
        const base = join(wavDir, `${path.replace(/[\\/]/g, '_')}_${s.n}`);
        mkdirSync(wavDir, { recursive: true });
        writeFileSync(`${base}.ref.wav`, wavFile(pcm.subarray(0, info.frames * 512 * info.channels), info.channels, info.rate));
        writeFileSync(`${base}.opus`, enc.ogg);
      }
    }).catch((e) => keep(`the Opus encoder failed: ${e.message}`));
    inFlight.add(job);
    job.finally(() => inFlight.delete(job));
    while (inFlight.size >= jobs) await Promise.race(inFlight);
  }
  await Promise.all(inFlight);
  // the ids by package order of the sounds (deterministic, whatever order the encoders finished in)
  made.sort((a, b) => a.dataOffset - b.dataOffset);
  made.forEach((m, i) => { m.id = soundId(pack, i); });
  const { parts, size } = writeXmop(d, made);
  const dst = join(out, path + '.xmop');
  mkdirSync(dirname(dst), { recursive: true });
  const ws = createWriteStream(dst);
  for (const p of parts) if (!ws.write(p)) await new Promise((r) => ws.once('drain', r));
  await new Promise((r, j) => { ws.end(r); ws.on('error', j); });
  const mb = (n) => (n / 1048576).toFixed(1);
  console.log(`${path}: ${candidates.length} XMA2 sounds, ${made.length} as Opus (${mb(xmaBytes)} MB of XMA -> ${mb(opusBytes)} MB), ` +
              `${candidates.length - made.length} kept; ${mb(d.length)} MB -> ${mb(size)} MB (${(100 * size / d.length).toFixed(1)} %), ` +
              `${((Date.now() - t0) / 1000).toFixed(0)} s`);
  for (const [why, n] of kept) console.log(`    kept ${n}: ${why}`);
}
