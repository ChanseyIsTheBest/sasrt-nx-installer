// sasrt-nx-installer (2026-11-21): rr6-nx-installer's test/pack_node.mjs worker threads as a module (credit rr6-nx):
// pack_worker.js's calls on Node worker threads, and lib/lz4b.js pack() over them.
//   const { compress, close, count } = await packPool();  pack(file, compress, { codec })
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { CODECS } from '../lib/lz4b.js';
import { workerPool } from '../lib/pool.js';

export async function packPool(threads = Math.max(1, availableParallelism() - 1)) {
  // pack_worker.js on a worker thread (the same calls; parentPort for self)
  const WORKER = `
  import { parentPort } from 'node:worker_threads';
  import createLz4Module from ${JSON.stringify(new URL('../wasm/lz4.mjs', import.meta.url).href)};
  import createZxcModule from ${JSON.stringify(new URL('../wasm/zxc.mjs', import.meta.url).href)};
  const [lz4, zxc] = await Promise.all([createLz4Module(), createZxcModule()]);
  const room = { lz4: { size: 0, src: 0, dst: 0 }, zxc: { size: 0, src: 0, dst: 0 } };
  function buffers(name, m, size, dstSize) {
    const r = room[name];
    if (size > r.size) {
      if (r.src) { m['_' + name + '_free'](r.src); m['_' + name + '_free'](r.dst); }
      r.size = size; r.src = m['_' + name + '_malloc'](size); r.dst = m['_' + name + '_malloc'](dstSize);
    }
    return r;
  }
  parentPort.on('message', ({ id, bytes, codec, level, block }) => {
    let n, m, r;
    if (codec === 'zxc') {
      m = zxc; r = buffers('zxc', zxc, bytes.length, zxc._zxc_bound(Math.max(bytes.length, block)));
      zxc.HEAPU8.set(bytes, r.src);
      n = zxc._zxc_pack(r.src, bytes.length, r.dst, zxc._zxc_bound(bytes.length), level, block);
    } else {
      m = lz4; r = buffers('lz4', lz4, bytes.length, bytes.length);
      lz4.HEAPU8.set(bytes, r.src);
      n = lz4._lz4_compress(r.src, bytes.length, r.dst, bytes.length - 1, level);
    }
    const out = n > 0 ? m.HEAPU8.slice(r.dst, r.dst + n) : bytes;
    parentPort.postMessage({ id, bytes: out }, [out.buffer]);
  });
  parentPort.postMessage({ ready: true, version: lz4._lz4_version(), zxcVersion: zxc._zxc_version() });
  `;

  const count = threads;
  const workers = await Promise.all(Array.from({ length: count }, () => new Promise((resolve) => {
    const w = new Worker(new URL(`data:text/javascript,${encodeURIComponent(WORKER)}`), { type: 'module' });
    w.once('message', (m) => resolve({ w, version: m.version, zxcVersion: m.zxcVersion, post: (msg, t) => w.postMessage(msg, t),
                                       onMessage: (cb) => w.on('message', cb) }));
  })));
  console.log(`LZ4 ${workers[0].version}, ZXC ${workers[0].zxcVersion} on ${count} worker threads`);
  const pool = workerPool(workers);
  const compress = (bytes, codec) =>
    pool.run({ bytes, codec, level: CODECS[codec].level, block: CODECS[codec].block }, [bytes.buffer]).then((r) => r.bytes);


  return { compress, count, version: workers[0].version, zxcVersion: workers[0].zxcVersion,
           close: async () => { for (const { w } of workers) await w.terminate(); } };
}
