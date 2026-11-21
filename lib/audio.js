// sasrt-nx-installer (2026-11-21, the user: "copy culdcept saga web installer for encoding audio and video"): one of
// SASRT's Wwise packages as NAME.xmop (lib/xmop.js), with the browser's Opus encoder (WebCodecs' AudioEncoder: libopus in
// Chrome, Edge and Firefox). culdcept-nx-installer's lib/audio.js (credit culdcept-nx) for many sounds in one file; the
// same file as test/xmop_node.mjs makes with ffmpeg's libopus (but the encoder's own bits).
// Returns { parts, size, made, kept } (made: sounds as Opus; kept: [why, count]) or { parts: null, why }.
import { resample } from './resample.js';
import { decodeAll, opusCost, opusRateFor, openSound, preSkipAt, refusal, soundId, writeXmop, xmaSounds,
         xmopBitrate } from './xmop.js';

const OPUS_LOOKAHEAD = 312;  // libopus's at 48 kHz (2.5 ms + 4 ms): the pre-skip when the encoder gives no OpusHead

export function opusConfig(channels, bitrate, sampleRate = 48000) {
  return {
    codec: 'opus', sampleRate, numberOfChannels: channels, bitrate, bitrateMode: 'variable',
    opus: { frameDuration: 20000, complexity: 10, application: 'audio', format: 'opus' },
  };
}

export async function canEncodeOpus() {
  if (typeof AudioEncoder === 'undefined') return false;
  try {
    const ok = async (c) => !!(await AudioEncoder.isConfigSupported(c)).supported;
    return (await ok(opusConfig(2, 128000))) && (await ok(opusConfig(1, 32000, 24000)));
  } catch {
    return false;
  }
}

// One sound's samples (interleaved floats at `rate`) as Opus: { packets, preSkip48 }.
async function encode(pcm, channels, rate, bitrate) {
  const packets = [];
  let preSkip48 = null, failure = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      const d = new Uint8Array(chunk.byteLength);
      chunk.copyTo(d);
      packets.push(d);
      const desc = meta?.decoderConfig?.description;
      if (preSkip48 === null && desc) {
        const h = desc instanceof ArrayBuffer ? new Uint8Array(desc) : new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength);
        if (h.length >= 12 && new TextDecoder().decode(h.subarray(0, 8)) === 'OpusHead') preSkip48 = h[10] | (h[11] << 8);
      }
    },
    error: (e) => { failure = e; },
  });
  encoder.configure(opusConfig(channels, bitrate, rate));
  try {
    const step = 1024 * 512 * channels;
    for (let at = 0, time = 0; at < pcm.length && !failure; at += step) {
      const part = pcm.subarray(at, Math.min(pcm.length, at + step));
      const frames = part.length / channels;
      const data = new AudioData({ format: 'f32', sampleRate: rate, numberOfFrames: frames, numberOfChannels: channels,
                                   timestamp: Math.round(time * 1e6 / rate), data: part });
      encoder.encode(data);
      data.close();
      time += frames;
      while (encoder.encodeQueueSize > 4 && !failure) await new Promise((r) => setTimeout(r, 1));
    }
    await encoder.flush();
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
  if (failure) throw failure;
  return { packets, preSkip48: preSkip48 ?? OPUS_LOOKAHEAD };
}

// bytes: the .pck; xma: an instance of wasm/xma.mjs; path: its path in the game folder; pack: its index among the game's
// packages (sorted by path); rules: game.json's audio bitrates; jobs: encoders at once.
export async function makeXmop(bytes, xma, { path, pack, rules, jobs = 6, onSound = null }) {
  let candidates;
  try {
    candidates = xmaSounds(bytes);
  } catch (e) {
    return { parts: null, why: e.message || String(e) };
  }
  const kept = new Map();
  const keep = (why) => kept.set(why, (kept.get(why) || 0) + 1);
  const made = [];
  const inFlight = new Set();
  let done = 0;
  for (const s of candidates) {
    const x = openSound(xma, bytes, s);
    if (!x.info) { keep(x.why); continue; }
    const why = refusal(x.info);
    if (why) { x.close(); keep(why); continue; }
    const { info } = x;
    let pcm;
    try {
      pcm = decodeAll(x);
    } catch (e) {
      keep(e.message || String(e));
      continue;
    } finally {
      x.close();
    }
    const rate = opusRateFor(info.rate);
    const input = rate === info.rate ? pcm : resample(pcm, info.channels, info.rate, rate);
    const bitrate = xmopBitrate(rules, path, info.rate, info.channels);
    const job = encode(input, info.channels, rate, bitrate).then((enc) => {
      const opus = { packets: enc.packets, preSkip: preSkipAt(rate, enc.preSkip48), rate };
      const cost = opusCost(info, opus);
      if (cost >= info.packets * 2048) { keep('not smaller as Opus'); return; }
      made.push({ info, dataOffset: s.info.dataOffset, opus });
    }).catch((e) => keep(`the Opus encoder failed: ${e.message || e}`))
      .finally(() => { ++done; if (onSound) onSound(done, candidates.length); });
    inFlight.add(job);
    job.finally(() => inFlight.delete(job));
    while (inFlight.size >= jobs) await Promise.race(inFlight);
  }
  await Promise.all(inFlight);
  if (!made.length) return { parts: null, why: [...kept].map(([w, n]) => `${n}: ${w}`).join('; ') || 'no XMA2 sounds' };
  made.sort((a, b) => a.dataOffset - b.dataOffset);
  made.forEach((m, i) => { m.id = soundId(pack, i); });
  const { parts, size } = writeXmop(bytes, made);
  return { parts, size, made: made.length, candidates: candidates.length, kept: [...kept] };
}
