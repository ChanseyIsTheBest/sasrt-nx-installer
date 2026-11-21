// sasrt-nx-installer (2026-11-21, the user: "please compress all the videos and audio"): one of SASRT's CRI USM movies
// (Data/Movies/*.usm: @SFV chunks of MPEG-1 video, @SFA ADX audio) as NAME.hevc, the movie with its pictures as H.265:
// rr6-nx's RXSFDH01 format (sdk/include/rex/filesystem/sfd_hevc.h; any container: segments of stored bytes, zeros and
// tag bytes), made as rr6-nx-installer's lib/sfdh.js makes it for an SFD (credit rr6-nx and culdcept-nx) with a USM
// demux in place of the program stream's. sasrt-nx's tools/hevc_usm_pack.py makes the same layout with ffmpeg; the port
// (app/src/cpu/sasrt_usm_ffmpeg.cpp) finds each picture's tag in the slice loop and shows the H.265 picture of its
// display index.
import { pictures, reencodeVideo, sequenceSize } from './sfdh.js';

// The video ES and where its bytes lie in the file: { es: Uint8Array, runs: [[esOffset, fileOffset, length], ...] }. A
// USM is CRI chunks back to back (big-endian): signature, u32 size of the rest, u8 ?, u8 payload offset (from +8), u16
// padding at the end, u8 channel, 2 bytes, u8 data type (0 stream data, 1 header, 2 section end, 3 metadata), ...; the
// video ES is the payloads of the @SFV data chunks (type 0) of channel 0, in order.
export function demuxUsm(d) {
  const n = d.length;
  const runs = [];
  let total = 0, i = 0;
  while (i + 16 <= n) {
    const sig = String.fromCharCode(d[i], d[i + 1], d[i + 2], d[i + 3]);
    const size = ((d[i + 4] << 24) | (d[i + 5] << 16) | (d[i + 6] << 8) | d[i + 7]) >>> 0;
    if (i + 8 + size > n) throw new Error(`a USM chunk at ${i} runs past the end`);
    const poff = d[i + 9], pad = (d[i + 10] << 8) | d[i + 11], ch = d[i + 12], type = d[i + 15];
    if (sig === '@SFV' && type === 0 && ch === 0) {
      const p = i + 8 + poff, end = i + 8 + size - pad;
      if (end > p) { runs.push([total, p, end - p]); total += end - p; }
    }
    i += 8 + size;
  }
  if (i !== n) throw new Error(`the USM's chunks end at ${i}, the file at ${n}`);
  const es = new Uint8Array(total);
  for (const [e, f, l] of runs) es.set(d.subarray(f, f + l), e);
  if (!(es[0] === 0 && es[1] === 0 && es[2] === 1 && es[3] === 0xb3)) throw new Error('the video does not start with a sequence header');
  return { es, runs };
}

// bytes: the .usm; mpeg1: an instance of wasm/mpeg1.mjs. -> { bytes: Blob, frames, kbps } or { bytes: null, why }.
// The pictures' rate is the sequence header's (SASRT's movies: 30).
export async function reencodeUsm(bytes, mpeg1, opts = {}) {
  let es, runs, pics, seq;
  try {
    ({ es, runs } = demuxUsm(bytes));
    pics = pictures(es);
    seq = sequenceSize(es);
  } catch (e) {
    return { bytes: null, why: e.message || String(e) };
  }
  return reencodeVideo(bytes, es, runs, pics, seq, seq.rate, mpeg1, opts);
}
