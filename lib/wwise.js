// sasrt-nx-installer (2026-11-21): SASRT's Wwise packages (Data/sound/*.pck), read as sasrt-nx's
// tools/wwise_pck_survey.py reads them. An AKPK is big-endian on the 360: "AKPK", u32 header size, u32 version, u32
// language map size, u32 sound bank table size, u32 streamed file table size, u32 external file table size; the
// language map; then the tables, each a u32 count and entries of u32 id, u32 block size, u32 size, u32 start block,
// u32 language (the file at start block x block size). A streamed file is a WEM (RIFX: 'fmt ', maybe others, 'data');
// a sound bank (BKHD ...) holds its in-memory WEMs in DIDX (u32 id, u32 offset, u32 size each, offsets in DATA) and DATA.

const be32 = (d, o) => ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;
const be16 = (d, o) => (d[o] << 8) | d[o + 1];
const tag = (d, o) => String.fromCharCode(d[o], d[o + 1], d[o + 2], d[o + 3]);

// The sound files of a package: [{ where: 'stream' | 'bank', id, offset, size }] (offsets in the package), in table
// order. Throws when it is not an AKPK.
export function pckFiles(d) {
  if (d.length < 28 || tag(d, 0) !== 'AKPK') throw new Error('not a Wwise package (AKPK)');
  const lang = be32(d, 12), banks = be32(d, 16), streams = be32(d, 20);
  let p = 8 + 20 + lang;
  const out = [];
  for (const [kind, size] of [['bank', banks], ['stream', streams]]) {
    const n = be32(d, p);
    for (let k = 0; k < n; ++k) {
      const e = p + 4 + 20 * k;
      const id = be32(d, e), block = be32(d, e + 4), fsize = be32(d, e + 8), start = be32(d, e + 12);
      const offset = start * block;
      if (offset + fsize > d.length) throw new Error(`a ${kind} entry runs past the package's end`);
      if (kind === 'stream') out.push({ where: 'stream', id, offset, size: fsize });
      else out.push(...bankWems(d, offset, fsize));
    }
    p += size;
  }
  return out;
}

// The WEMs inside a sound bank at [base, base + size).
function bankWems(d, base, size) {
  let p = base, didx = null, data = -1;
  const end = base + size;
  while (p + 8 <= end) {
    const name = tag(d, p), ln = be32(d, p + 4);
    if (name === 'DIDX') didx = [p + 8, ln];
    else if (name === 'DATA') data = p + 8;
    p += 8 + ln;
  }
  const out = [];
  if (didx && data >= 0) {
    for (let k = 0; k < Math.floor(didx[1] / 12); ++k) {
      const e = didx[0] + 12 * k;
      out.push({ where: 'bank', id: be32(d, e), offset: data + be32(d, e + 4), size: be32(d, e + 8) });
    }
  }
  return out;
}

// A WEM's format: { format, tag, channels, rate, dataOffset (in the package), dataSize, streams } or null (not RIFX).
export function wemInfo(d, base, size) {
  if (size < 12 || tag(d, base) !== 'RIFX' || tag(d, base + 8) !== 'WAVE') return null;
  const end = base + Math.min(size, 8 + be32(d, base + 4));
  let p = base + 12, fmt = null, data = null;
  while (p + 8 <= end) {
    const name = tag(d, p), ln = be32(d, p + 4);
    if (name === 'fmt ' && !fmt) fmt = [p + 8, ln];
    else if (name === 'data' && !data) data = [p + 8, ln];
    p += 8 + ln + (ln & 1);
  }
  if (!fmt || !data) return null;
  const t = be16(d, fmt[0]);
  const info = {
    tag: t, format: { 0x0001: 'PCM', 0xfffe: 'PCM', 0x0165: 'XMA1', 0x0166: 'XMA2' }[t] || `0x${t.toString(16)}`,
    channels: be16(d, fmt[0] + 2), rate: be32(d, fmt[0] + 4), dataOffset: data[0], dataSize: data[1], streams: 1,
  };
  // XMA2WAVEFORMATEX after its WAVEFORMATEX (18 bytes): u16 NumStreams first
  if (t === 0x0166 && fmt[1] >= 34) info.streams = be16(d, fmt[0] + 18);
  if (data[0] + data[1] > d.length) return null;
  return info;
}
