// sasrt-nx-installer (2026-11-21): rr6-nx-installer's worker.js (credit rr6-nx) for SASRT. Makes the package off the
// page's thread and streams the zip to the download service worker (sw.js). rr6-nx-installer's is kameo-nx-installer's
// (bejeweled3-nx-installer's, nfsmw-nx-installer's download stream, GPL-3.0).
//
// What it does with SASRT's game folder (game.json has the lists):
//   - the archives the game's loads read (Data/GameAssets.M00, Frontend.M00, GameData.M00) as LZ4 blocks (lib/lz4b.js on
//     pack_worker.js, one per core);
//   - the movies (Data/Movies/*.usm) as H.265 (lib/usmh.js: NAME.usm.hevc, rr6-nx's RXSFDH01), ZXC-packed:
//     NAME.usm.hevc.lz4b (the user via rr6-nx: "ZXC-pack the re-encoded movies too");
//   - the Wwise packages (Data/sound/*.pck) with their XMA2 sounds as Opus (lib/audio.js: NAME.pck.xmop, sasrt-nx's
//     sdk/include/rex/filesystem/xmo.h), ZXC-packed when that saves game.json's zxc_min_saving (NAME.pck.xmop.lz4b);
//   - every other file as it is ($SystemUpdate left out); the DLC packages to dlc/ as they are.
import { CODECS, codecFor, pack, SUFFIX } from './lib/lz4b.js';
import { workerPool } from './lib/pool.js';
import { ZipWriter } from './lib/zip.js';
import { canEncodeOpus, makeXmop } from './lib/audio.js';
import { canEncodeHevc } from './lib/sfdh.js';
import { reencodeUsm } from './lib/usmh.js';

const ROOT = 'switch/sasrt-nx';
// The share of a file left after packing, for the size of the download before it is known (test/game_node.mjs's
// measures on SASRT's files; xmop: the seven packages together).
const KEPT = { lz4: 0.47, zxc: 0.90, xmop: 0.55, hevc: 0.35 };  // 2026-11-21: GameAssets 44 %, Frontend 68 %
const log = (text) => postMessage({ type: 'log', text });

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function sha256(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

// A release file, checked against the SHA-256 the manifest gives for it.
async function fetchChecked(name, hash) {
  const bytes = await fetchBytes(`./release/${name}`);
  const got = await sha256(bytes);
  if (hash && got !== hash) throw new Error(`release/${name} is not the one the manifest names (${got})`);
  return bytes;
}

// Sends every write as one chunk, and only when the download has asked for more ("pull").
function portSink(port) {
  let credits = 0, cancelled = false, waiting = null;
  port.onmessage = ({ data }) => {
    if (data.type === 'pull') credits++;
    else if (data.type === 'cancel') cancelled = true;
    if (waiting) { const wake = waiting; waiting = null; wake(); }
  };
  return {
    async write(bytes) {
      while (!credits) {
        if (cancelled) throw new Error('the download was cancelled');
        await new Promise((resolve) => (waiting = resolve));
      }
      if (cancelled) throw new Error('the download was cancelled');
      credits--;
      const copy = bytes.slice();
      port.postMessage({ type: 'chunk', buffer: copy.buffer }, [copy.buffer]);
    },
    async close() { port.postMessage({ type: 'end' }); },
    fail(message) { port.postMessage({ type: 'error', message }); },
  };
}

// The game's files: { path (in the game folder), size, read(offset, length) } from the page's Files, or for
// test/browser.html from the test server (HTTP range requests).
function gameFiles(entries) {
  return entries.map((e) => ({
    path: e.path,
    size: e.size,
    read: e.file
      ? async (offset, length) => {
          const at = (e.offset || 0) + offset;
          return new Uint8Array(await e.file.slice(at, at + length).arrayBuffer());
        }
      : async (offset, length) => {
          const r = await fetch(e.url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
          if (!r.ok) throw new Error(`${e.url}: HTTP ${r.status}`);
          return new Uint8Array(await r.arrayBuffer());
        },
  }));
}

async function* blobChunks(blob, size = 8 << 20) {
  for (let at = 0; at < blob.size; at += size)
    yield new Uint8Array(await blob.slice(at, Math.min(blob.size, at + size)).arrayBuffer());
}

async function* chunks(file, size = 8 << 20) {
  for (let at = 0; at < file.size; at += size) yield await file.read(at, Math.min(size, file.size - at));
}

// count pack_worker.js workers, each started and ready, as lib/pool.js takes them
function startWorkers(count) {
  return Promise.all(Array.from({ length: count }, () => new Promise((resolve, reject) => {
    const w = new Worker('./pack_worker.js', { type: 'module' });
    w.onerror = (e) => reject(new Error(`pack_worker.js: ${e.message}`));
    w.addEventListener('message', ({ data }) => {
      if (data.ready) resolve({ w, version: data.version, zxcVersion: data.zxcVersion, post: (m, t) => w.postMessage(m, t),
                                onMessage: (cb) => w.addEventListener('message', ({ data: d }) => cb(d)) });
    }, { once: true });
  })));
}

self.onmessage = async ({ data }) => {
  const sink = portSink(data.port);
  const started = performance.now();
  const seconds = () => Math.round((performance.now() - started) / 1000);
  let workers = [];
  try {
    const manifest = JSON.parse(new TextDecoder().decode(await fetchBytes('./release/manifest.json')));
    const config = JSON.parse(new TextDecoder().decode(await fetchBytes('./game.json')));
    const files = gameFiles(data.entries);
    const xex = files.find((f) => f.path.toLowerCase() === 'default.xex');
    if (!xex) throw new Error('no default.xex in the folder: choose the folder the game was extracted to');
    const xexHash = await sha256(await xex.read(0, xex.size));
    const build = manifest.builds.find((b) => b.xex_sha256 === xexHash);
    if (!build) throw new Error(`this default.xex is not one this release supports (SHA-256 ${xexHash})`);

    log('Downloading the program and its files...');
    const nro = await fetchChecked(build.nro, build.nro_sha256);
    const extras = await Promise.all(build.files.map(async (f) => ({ ...f, bytes: await fetchChecked(f.source, f.sha256) })));

    // the packing workers: one per core but one (the zip, the reads and the re-encodes run here)
    const cores = Math.max(1, Math.min(16, (navigator.hardwareConcurrency || 4) - 1));
    workers = await startWorkers(cores);
    const pool = workerPool(workers);
    const compress = (bytes, codec) =>
      pool.run({ bytes, codec, level: CODECS[codec].level, block: CODECS[codec].block }, [bytes.buffer]).then((r) => r.bytes);
    const version = (v) => `${Math.floor(v / 10000)}.${Math.floor(v / 100) % 100}.${v % 100}`;
    log(`LZ4 ${version(workers[0].version)} and ZXC ${version(workers[0].zxcVersion)} ready on ${cores} threads ` +
        `(${seconds()} s).`);

    // the re-encodes the page asked for, when this browser has the encoders (WebCodecs)
    const options = data.options || {};
    const opus = !!options.audio && await canEncodeOpus();
    const hevc = !!options.movies && await canEncodeHevc();
    if (options.audio && !opus) log('This browser has no Opus encoder: the sounds are copied as they are.');
    if (options.movies && !hevc) log('This browser has no H.265 encoder: the movies are copied as they are.');
    let mpeg1 = null, xma = null;
    if (hevc) {
      const { default: createMpeg1Module } = await import('./wasm/mpeg1.mjs');
      mpeg1 = await createMpeg1Module();
    }
    if (opus) {
      const { default: createXmaModule } = await import('./wasm/xma.mjs');
      xma = await createXmaModule();
    }
    const fits = (m, p) => new RegExp(`^(?:${m})$`, 'i').test(p);
    const skip = (p) => (config.skip || []).some((m) => fits(m, p));
    const reencoded = (path) => (opus && fits(config.audio.match, path) ? 'xmop' :
                                 hevc && fits(config.movies.match, path) ? 'hevc' : null);
    const dlc = gameFiles(data.dlc || []);
    const game = files.filter((f) => !skip(f.path));
    const packs = game.map((f) => f.path).filter((p) => fits(config.audio.match, p)).sort();
    const totalIn = nro.length + extras.reduce((n, f) => n + f.bytes.length, 0) + game.reduce((n, f) => n + f.size, 0) +
                    dlc.reduce((n, f) => n + f.size, 0);
    let doneIn = 0;
    const counted = (n) => { doneIn += n; postMessage({ type: 'progress', fraction: doneIn / totalIn }); };
    // the zip's size is known only once the files are packed: the download starts without one (KEPT of each)
    const kind = (f) => reencoded(f.path) || codecFor(f.path, config);
    const estimate = totalIn - game.reduce((n, f) => n + (kind(f) ? f.size * (1 - KEPT[kind(f)]) : 0), 0);
    postMessage({ type: 'start', estimate });

    const zip = new ZipWriter(sink);
    await zip.addBytes(`${ROOT}/${config.nro}`, nro); counted(nro.length);
    for (const f of extras) { await zip.addBytes(`${ROOT}/${f.path}`, f.bytes); counted(f.bytes.length); }
    let packedIn = 0, packedOut = 0, opusIn = 0, opusOut = 0, hevcIn = 0, hevcOut = 0;
    // NAME's bytes (a Blob or parts) ZXC-packed into the zip as NAME.lz4b: its size
    const zxcInto = async (name, blob) => {
      const asFile = { size: blob.size, read: async (o, n) => new Uint8Array(await blob.slice(o, o + n).arrayBuffer()) };
      return zip.addStream(`${ROOT}/game_root/${name}${SUFFIX}`, pack(asFile, compress, { codec: 'zxc', inFlight: cores * 4 }));
    };
    for (const f of game) {
      const re = reencoded(f.path);
      if (re) {
        const t0 = performance.now();
        log(`Re-encoding ${f.path} (${(f.size / 1048576).toFixed(0)} MB) to ${re === 'xmop' ? 'Opus' : 'H.265'}...`);
        const bytes = await f.read(0, f.size);
        let size = 0, why = null, name = null;
        try {
          if (re === 'hevc') {
            const r = await reencodeUsm(bytes, mpeg1, { fraction: config.movies.fraction, gop: config.movies.gop });
            why = r.why;
            if (r.bytes) {
              name = `${f.path}.hevc`;
              if (config.movies.zxc) { size = await zxcInto(name, r.bytes); name += SUFFIX; }
              else size = await zip.addFile(`${ROOT}/game_root/${name}`, r.bytes.size, blobChunks(r.bytes)) ?? r.bytes.size;
            }
          } else {
            const r = await makeXmop(bytes, xma, { path: f.path, pack: packs.indexOf(f.path), rules: config.audio.bitrates,
                                                   jobs: Math.min(4, cores) });  // a music sound's samples are ~90 MB
            why = r.why;
            if (r.parts) {
              const blob = new Blob(r.parts);
              // ZXC when it saves enough (SoundBanks.pck's PCM effects compress; the Opus does not): measured by packing
              const asFile = { size: blob.size, read: async (o, n) => new Uint8Array(await blob.slice(o, o + n).arrayBuffer()) };
              let packed = 0;
              for await (const c of pack(asFile, compress, { codec: 'zxc', inFlight: cores * 4 })) packed += c.length;
              name = `${f.path}.xmop`;
              if (1 - packed / blob.size > (config.audio.zxc_min_saving ?? 0.05)) { size = await zxcInto(name, blob); name += SUFFIX; }
              else { await zip.addFile(`${ROOT}/game_root/${name}`, blob.size, blobChunks(blob)); size = blob.size; }
              log(`  ${r.made} of ${r.candidates} XMA2 sounds as Opus` +
                  (r.kept.length ? ` (kept as XMA: ${r.kept.map(([w, n]) => `${n} ${w}`).join(', ')})` : ''));
            }
          }
        } catch (e) {
          why = e.message || String(e);
          name = null;
        }
        if (name) {
          counted(f.size);
          if (re === 'xmop') { opusIn += f.size; opusOut += size; } else { hevcIn += f.size; hevcOut += size; }
          log(`  ${name}: ${(size / 1048576).toFixed(1)} MB (${(size / f.size * 100).toFixed(1)} %), ` +
              `${((performance.now() - t0) / 1000).toFixed(0)} s`);
          continue;
        }
        log(`  ${f.path} is copied as it is: ${why}`);
      }
      const codec = codecFor(f.path, config);
      if (codec) {
        const t0 = performance.now();
        const named = f.size > 50 * 1048576;
        if (named) log(`Packing ${f.path} (${(f.size / 1048576).toFixed(0)} MB, ${codec.toUpperCase()})...`);
        const size = await zip.addStream(`${ROOT}/game_root/${f.path}${SUFFIX}`,
                                         pack(f, compress, { codec, inFlight: cores * 4, onRaw: counted }));
        packedIn += f.size;
        packedOut += size;
        const s = (performance.now() - t0) / 1000;
        if (named) {
          log(`  ${f.path}${SUFFIX}: ${(size / 1048576).toFixed(0)} MB (${(size / f.size * 100).toFixed(1)} %), ` +
              `${s.toFixed(0)} s (${(f.size / 1048576 / Math.max(s, 0.001)).toFixed(0)} MB/s)`);
        }
      } else {
        await zip.addFile(`${ROOT}/game_root/${f.path}`, f.size, chunks(f), (c) => counted(c.length));
      }
    }
    for (const f of dlc) await zip.addFile(`${ROOT}/dlc/${f.path}`, f.size, chunks(f), (c) => counted(c.length));
    const total = await zip.finish();
    if (packedIn) log(`The archives: ${(packedIn / 1048576).toFixed(0)} MB packed to ${(packedOut / 1048576).toFixed(0)} MB.`);
    if (opusIn) log(`The sound packages with Opus: ${(opusIn / 1048576).toFixed(0)} MB to ${(opusOut / 1048576).toFixed(0)} MB.`);
    if (hevcIn) log(`The movies as H.265: ${(hevcIn / 1048576).toFixed(0)} MB to ${(hevcOut / 1048576).toFixed(0)} MB.`);
    for (const x of workers) x.w.terminate();
    postMessage({ type: 'done', seconds: seconds(), size: total });
  } catch (error) {
    for (const x of workers) x.w.terminate();
    const message = error.message || String(error);
    sink.fail(message);
    postMessage({ type: 'error', message });
  }
};
