// renut_nx_ultimate_installer: the whole package, from the player's game to the zip, for any port of the ultimate base.
// The page's worker (worker.js) and the Node test (test/full_node.mjs) both run this, so what the test checks is what
// the page does. What is the game's own comes from game.json (the port's settings for this page) and the build's entry
// in release/manifest.json (tools/make_release.py):
//   1. the build: default.xex's SHA-256 names it; the NRO and the release files are checked by theirs;
//   2. the shaders (game.json "shaders"): the containers (lib/sources.js), Renut's translator (wasm/renut_hlsl), the
//      GLSL chain on worker threads (lib/chain.js: early alpha, DXC, SPIRV-Cross and the base's own passes in Pyodide)
//      -> deko3d_glsl.bin (version 2, lib/package.js: the GLSL and the shader table, so the NRO carries no game shader);
//      with compile, every variant of release/variants.txt compiled by uam (wasm/uam) -> deko3d_shaders.bin, the
//      console's DKSH cache, and pipeline_list.bin from the release (without the cache the list would make the console
//      compile everything at start);
//   3. the zip: the NRO, the release files, the shader files, the game's files under game_root/ (those game.json "lz4"
//      names packed as NAME.lz4b, LZ4 HC in 256 KB blocks, and since blur-nx 1.0.1 the "zxc" ones as ZXC in 512 KB
//      blocks, which the SDK reads as NAME: lib/lz4b.js) and the DLC packages under dlc/, streamed to `sink` as it is
//      written (its size is known only at the end);
//   4. (blur-nx, 2026-11-18) the title update, when the build names one (its "update", lib/update.js): its default.xexp
//      to game_root/, its other files to update/;
//   5. (blur-nx 1.0.1; sasrt-nx-installer 2026-11-22: SASRT's CRI USM movies, lib/usmh.js, as sasrt-nx-installer 0.1
//      did) with tools.movies, the game.json "movies" files re-encoded to
//      H.265 and packed as ZXC blocks: NAME.hevc.lz4b, which the SDK reads as NAME (rex/filesystem
//      sfd_hevc.h) and the port plays on the Switch's NVDEC; a movie that does not re-encode is copied as it is.
//   6. (blur-nx 1.0.1; sasrt-nx-installer: SASRT's Wwise packages, Data/sound/*.pck) with tools.audio, the game.json
//      "audio" files as NAME.xmop, ZXC-packed (NAME.xmop.lz4b) when that saves game.json's audio.zxc_min_saving, (lib/audio.js: its XMA sounds' frames as Opus at game.json's
//      bitrates), which the SDK reads as NAME (rex/filesystem/xmo.h, sasrt-nx's and culdcept-nx's) and whose frames
//      the port's XMA emulation plays from the Opus; a file with nothing worth converting is copied as it is.
import { makeXmop } from './audio.js';
import { reencodeUsm } from './usmh.js';
import { compileVariants, makeGlsl, packageShaders, variantJobs } from './build.js';
import { checkGameFiles, describeProblems, optionalPaths } from './game_check.js';
import { pack, SUFFIX } from './lz4b.js';
import { nroShaders } from './nro.js';
import { gameContainers, sha256 } from './sources.js';
import { checkUpdate, updatePlacement } from './update.js';
import { parseVariants } from './variants.js';
import { ZipWriter } from './zip.js';

// The game.json patterns: case-insensitive regular expressions on a file's path in the game folder.
const patterns = (list) => (list || []).map((p) => new RegExp(`^(?:${p})$`, 'i'));
const matches = (res, path) => res.some((re) => re.test(path));

async function* chunks(file, size = 8 << 20) {
  for (let at = 0; at < file.size; at += size) yield await file.read(at, Math.min(size, file.size - at));
}

// blur-nx 1.0.1 (2026-11-22): many small parts (a .xmop's tables and Opus packets, lib/xmop.js) as chunks of about
// `size` bytes, so the zip is written in a few large writes instead of one for each 20 ms packet.
function* joined(parts, size = 8 << 20) {
  let buf = new Uint8Array(size), at = 0;
  for (const p of parts) {
    if (p.length >= size) {
      if (at) { yield buf.slice(0, at); at = 0; }
      yield p;
      continue;
    }
    if (at + p.length > size) { yield buf.slice(0, at); at = 0; }
    buf.set(p, at);
    at += p.length;
  }
  if (at) yield buf.slice(0, at);
}

// The build of release/manifest.json this default.xex is, or throws. 2026-11-18: also throws when the copy is not
// whole (the build's "game_files", lib/game_check.js), as the page refuses it when it is chosen (app.js); game:
// game.json, for the files that may be absent (without it, only the disc's own extras may).
export async function findBuild(manifest, files, game = {}) {
  const xex = files.find((f) => f.path.toLowerCase() === 'default.xex');
  if (!xex) throw new Error('no default.xex in the folder: choose the folder the game was extracted to, or the disc image');
  const bytes = await xex.read(0, xex.size);
  const hash = await sha256(bytes);
  const build = manifest.builds.find((b) => b.xex_sha256 === hash);
  if (!build) throw new Error(`this default.xex is not one this release supports (SHA-256 ${hash})`);
  const problems = describeProblems(checkGameFiles(files, build.game_files, optionalPaths(game)));
  if (problems) throw new Error(problems);
  return { build, xex: bytes };
}

// game: game.json; manifest: release/manifest.json; files, dlc, update: [{ path, size, read(offset, length) }];
// fetchRelease(name, sha256) -> bytes (checked); sink: { write(bytes), close() }; compile: make the DKSH cache;
// tools: { translator, lzx, xexp (Emscripten modules; xexp when the build has a title update), cores, glslThreads,
// movies (null, or { bink: wasm/bink.mjs's module, fraction, gop } when the movies are re-encoded), audio (null, or
// { xma: wasm/xma.mjs's module, rules: game.json's audio bitrates } when the streamed audio is), startGlsl(n), startUam(n), startPack(n) }, each
// start returning { run, version?, stop() } over n workers (lib/pool.js): glsl run(name, hlsl) -> UTF-8 GLSL,
// uam run(stage, text) -> { dksh } | { error }, pack run(bytes, codec) -> bytes (pack_worker.js: LZ4 and ZXC; the
// pool's version and zxcVersion are the libraries').
// events: { log(text), progress(fraction), start(estimate of the zip's size) }. Returns what it did.
export async function buildPackage({ game, manifest, files, dlc = [], update = [], fetchRelease, tools, sink, compile = true,
                                     events }) {
  const { log = () => {}, progress = () => {}, start = () => {} } = events || {};
  const began = performance.now();
  const seconds = () => Math.round((performance.now() - began) / 1000);
  const root = `switch/${game.package}`;
  const report = {};
  const running = [];
  const stopAll = () => { for (const r of running.splice(0)) r.stop(); };
  try {
    const { build, xex } = await findBuild(manifest, files, game);
    const updateProblem = await checkUpdate(build, update, game.update?.title);
    if (updateProblem) throw new Error(updateProblem);
    const updateFiles = updatePlacement(build, update);
    const shaders = game.shaders && build.shaders;
    if (!shaders) compile = false;
    // the shares of the bar: the shaders take the time, the zip the bytes
    const steps = shaders ? (compile ? { glsl: [0, 0.45], uam: [0.45, 0.65], zip: [0.65, 1] } : { glsl: [0, 0.5], zip: [0.5, 1] })
      : { zip: [0, 1] };
    const step = (s) => (f) => progress(steps[s][0] + (steps[s][1] - steps[s][0]) * f);

    log('Downloading the program and its files...');
    const nro = await fetchRelease(build.nro, build.nro_sha256);
    const extras = [];
    for (const f of build.files || []) {
      if (f.with_cache && !compile) continue;  // pipeline_list.bin: only with deko3d_shaders.bin (see above)
      extras.push({ ...f, bytes: await fetchRelease(f.source, f.sha256) });
    }
    const made = [];  // [path, bytes] of the shader files
    if (shaders) {
      const shaderCommon = await fetchRelease('shader_common.h', manifest.shader_common_sha256);
      // a port of a title update's code: its shaders in the patched image (lib/xexp.js)
      const xexpFile = updateFiles.find((u) => u.to === 'game_root/default.xexp')?.file;
      const patch = xexpFile ? { xexp: await xexpFile.read(0, xexpFile.size), mod: tools.xexp } : null;
      if (patch && !patch.mod) throw new Error('this release needs wasm/xexp (for the title update patch)');
      const containers = await gameContainers(files, xex, shaders, tools.lzx, log, patch);
      log(`Making the GLSL of ${containers.length} shaders on ${tools.glslThreads} threads...`);
      const glsl = await tools.startGlsl(tools.glslThreads);
      running.push(glsl);
      const errors = [];
      const { shaders: list, failed } = await makeGlsl(containers, tools.translator, glsl.run, shaderCommon, log,
                                                       step('glsl'), (e) => errors.push(e));
      glsl.stop();
      if (failed) throw new Error(`${failed} shaders could not be made: ${errors.slice(0, 3).join('; ')}`);
      const glslPackage = packageShaders(list);
      made.push(['deko3d_glsl.bin', glslPackage]);
      report.shaders = list.length;
      report.glslSha256 = await sha256(glslPackage);
      report.glsl = list;  // [{ name, glsl (UTF-8), numbers }]: for the tests' comparisons
      if (compile) {
        // every variant the game uses, and the NRO's own shaders' (the ones the game makes at runtime)
        // (a release without a pipeline list has no variants.txt: each shader is compiled as it is)
        const variants = build.variants_sha256
          ? parseVariants(new TextDecoder().decode(await fetchRelease('variants.txt', build.variants_sha256))) : [];
        const glslOf = new Map(list.map((s) => [s.name, s.glsl]));
        for (const [stem, text] of nroShaders(nro)) if (!glslOf.has(stem)) glslOf.set(stem, text);
        const { jobs } = variantJobs(variants, glslOf);
        log(`Compiling ${jobs.length} shader variants for the Switch on ${tools.cores} threads...`);
        const uam = await tools.startUam(tools.cores);
        running.push(uam);
        const compiled = await compileVariants(jobs, uam.run, tools.cores * 2, step('uam'));
        uam.stop();
        if (compiled.failures.length) {
          throw new Error(`${compiled.failures.length} shader variants did not compile: ${compiled.failures[0].error.slice(0, 200)}`);
        }
        made.push(['deko3d_shaders.bin', compiled.cache]);
        report.variants = jobs.length;
        report.cacheSha256 = await sha256(compiled.cache);
      }
      const reference = build.deko3d_glsl_sha256 === report.glslSha256 &&
                        (!compile || build.deko3d_shaders_sha256 === report.cacheSha256);
      log(`Shaders done in ${seconds()} s: ${report.shaders} shaders` + (compile ? `, ${report.variants} variants` : ', left for the Switch to compile') +
          (build.deko3d_glsl_sha256 ? (reference ? ', the same as the release\'s reference build' : ' (not the reference build\'s)') : ''));
    }

    // the zip
    // blur-nx 1.0.1: game.json "lz4" files as LZ4 blocks, "zxc" files as ZXC blocks (an "lz4" pattern wins over a "zxc" one)
    const lz4 = patterns(game.lz4), zxc = patterns(game.zxc), skip = patterns(game.skip);
    const codecOf = (path) => (matches(lz4, path) ? 'lz4' : matches(zxc, path) ? 'zxc' : null);
    const game_ = files.filter((f) => !matches(skip, f.path));
    const toPack = game_.filter((f) => codecOf(f.path));
    // sasrt-nx-installer: game.json's movies is { match, fraction, gop, zxc } (one pattern)
    const movies = tools.movies && game.movies ? patterns([game.movies.match]) : [];
    const toReencode = game_.filter((f) => matches(movies, f.path));
    // blur-nx 1.0.1 (2026-11-22): the "audio" files, their index among them (sorted by path) the sound ids' file index
    const audioRe = tools.audio && game.audio ? patterns([game.audio.match]) : [];
    const toOpus = game_.filter((f) => matches(audioRe, f.path));
    const opusPacks = toOpus.map((f) => f.path).sort();
    let packPool = null;
    if (toPack.length || toReencode.length || toOpus.length) {
      packPool = await tools.startPack(tools.cores);
      running.push(packPool);
      const version = (v) => `${Math.floor(v / 10000)}.${Math.floor(v / 100) % 100}.${v % 100}`;
      const byCodec = (c) => toPack.filter((f) => codecOf(f.path) === c).length;
      log(`LZ4 ${version(packPool.version)} and ZXC ${version(packPool.zxcVersion)} on ${tools.cores} threads for ` +
          `${toPack.length} file${toPack.length === 1 ? '' : 's'} (${byCodec('lz4')} LZ4, ${byCodec('zxc')} ZXC).`);
    }
    const totalIn = nro.length + extras.reduce((n, f) => n + f.bytes.length, 0) + made.reduce((n, [, b]) => n + b.length, 0) +
                    game_.reduce((n, f) => n + f.size, 0) + dlc.reduce((n, f) => n + f.size, 0) +
                    updateFiles.reduce((n, u) => n + u.file.size, 0);
    let doneIn = 0;
    const zipStep = step('zip');
    const counted = (n) => { doneIn += n; zipStep(doneIn / totalIn); };
    // a guess: packing saves 20-65 %, the movies' H.265 about three quarters, the music's Opus a quarter
    start(totalIn - toPack.reduce((n, f) => n + f.size, 0) * 0.4 - toReencode.reduce((n, f) => n + f.size, 0) * 0.75 -
          toOpus.reduce((n, f) => n + f.size, 0) * 0.25);
    if (toReencode.length) {
      log(`Re-encoding ${toReencode.length} movie${toReencode.length === 1 ? '' : 's'} ` +
          `(${(toReencode.reduce((n, f) => n + f.size, 0) / 1048576).toFixed(0)} MB) to H.265 with this computer's video hardware.`);
    }
    const zip = new ZipWriter(sink);
    await zip.addBytes(`${root}/${game.nro}`, nro); counted(nro.length);
    for (const f of extras) { await zip.addBytes(`${root}/${f.path}`, f.bytes); counted(f.bytes.length); }
    for (const [name, bytes] of made) { await zip.addBytes(`${root}/${name}`, bytes); counted(bytes.length); }
    let packedIn = 0, packedOut = 0, hevcIn = 0, hevcOut = 0, opusIn = 0, opusOut = 0;
    for (const f of game_) {
      if (matches(audioRe, f.path)) {
        const t0 = performance.now();
        log(`Re-encoding ${f.path} (${(f.size / 1048576).toFixed(0)} MB) to Opus...`);
        let r;
        try {
          r = await makeXmop(await f.read(0, f.size), tools.audio.xma,
                             { path: f.path, pack: opusPacks.indexOf(f.path), rules: tools.audio.rules,
                               jobs: Math.min(4, tools.cores) });  // a music sound's samples are held until encoded: ~90 MB
        } catch (e) {
          r = { parts: null, why: e.message || String(e) };
        }
        if (r.parts) {
          // sasrt-nx-installer: ZXC-packed (NAME.xmop.lz4b) when that saves game.json's audio.zxc_min_saving (SoundBanks
          // .pck's PCM effects compress; the Opus does not): measured by packing it once
          const blob = new Blob(r.parts);
          const asFile = { size: blob.size, read: async (o, n) => new Uint8Array(await blob.slice(o, o + n).arrayBuffer()) };
          let name = `${f.path}.xmop`, size = blob.size, packed = 0;
          if (packPool) {
            for await (const c of pack(asFile, packPool.run, { codec: 'zxc', inFlight: tools.cores * 4 })) packed += c.length;
          }
          if (packPool && 1 - packed / blob.size > (game.audio.zxc_min_saving ?? 0.05)) {
            name += SUFFIX;
            size = await zip.addStream(`${root}/game_root/${name}`,
                                       pack(asFile, packPool.run, { codec: 'zxc', inFlight: tools.cores * 4 }));
          } else {
            await zip.addFile(`${root}/game_root/${name}`, blob.size, joined(r.parts));
          }
          counted(f.size);
          opusIn += f.size;
          opusOut += size;
          log(`  ${name}: ${(size / 1048576).toFixed(1)} MB (${(size / f.size * 100).toFixed(1)} %), ${r.made} of ` +
              `${r.candidates} XMA sounds as Opus` +
              (r.kept.length ? ` (kept as XMA: ${r.kept.map(([w, n]) => `${n} ${w}`).join(', ')})` : '') +
              `, ${((performance.now() - t0) / 1000).toFixed(0)} s`);
          continue;
        }
        log(`  ${f.path} is copied as it is: ${r.why}`);
      }
      if (matches(movies, f.path)) {
        const t0 = performance.now();
        log(`Re-encoding ${f.path} (${(f.size / 1048576).toFixed(0)} MB) to H.265...`);
        let r;
        try {
          r = await reencodeUsm(await f.read(0, f.size), tools.movies.mpeg1,
                                 { fraction: tools.movies.fraction, gop: tools.movies.gop });
        } catch (e) {
          r = { bytes: null, why: e.message || String(e) };
        }
        if (r.bytes) {
          const blob = r.bytes;
          const asFile = { size: blob.size, read: async (o, n) => new Uint8Array(await blob.slice(o, o + n).arrayBuffer()) };
          const name = `${f.path}.hevc${SUFFIX}`;
          const size = await zip.addStream(`${root}/game_root/${name}`,
                                           pack(asFile, packPool.run, { codec: 'zxc', inFlight: tools.cores * 4 }));
          counted(f.size);
          hevcIn += f.size;
          hevcOut += size;
          log(`  ${name}: ${(size / 1048576).toFixed(1)} MB (${(size / f.size * 100).toFixed(1)} %${r.kbps ? `, ${Math.round(r.kbps)} kbit/s` : ''}), ` +
              `${((performance.now() - t0) / 1000).toFixed(0)} s`);
          continue;
        }
        log(`  ${f.path} is copied as it is: ${r.why}`);
      }
      const codec = packPool ? codecOf(f.path) : null;
      if (codec) {
        const t0 = performance.now();
        log(`Packing ${f.path} (${(f.size / 1048576).toFixed(0)} MB, ${codec.toUpperCase()})...`);
        const size = await zip.addStream(`${root}/game_root/${f.path}${SUFFIX}`,
                                         pack(f, packPool.run, { codec, inFlight: tools.cores * 4, onRaw: counted }));
        packedIn += f.size;
        packedOut += size;
        const s = (performance.now() - t0) / 1000;
        log(`  ${f.path}${SUFFIX}: ${(size / 1048576).toFixed(0)} MB (${(size / f.size * 100).toFixed(1)} %), ${s.toFixed(0)} s`);
      } else {
        await zip.addFile(`${root}/game_root/${f.path}`, f.size, chunks(f), (c) => counted(c.length));
      }
    }
    for (const u of updateFiles) await zip.addFile(`${root}/${u.to}`, u.file.size, chunks(u.file), (c) => counted(c.length));
    if (updateFiles.length) log(`${game.update?.title || 'The title update'}: ${updateFiles.length} files.`);
    for (const f of dlc) await zip.addFile(`${root}/dlc/${f.path}`, f.size, chunks(f), (c) => counted(c.length));
    report.size = await zip.finish();
    stopAll();
    if (packedIn) {
      log(`Packed ${(packedIn / 1048576).toFixed(0)} MB to ${(packedOut / 1048576).toFixed(0)} MB: ` +
          `${((packedIn - packedOut) / 1048576).toFixed(0)} MB smaller on the SD card.`);
    }
    if (hevcIn) {
      log(`The movies as H.265: ${(hevcIn / 1048576).toFixed(0)} MB to ${(hevcOut / 1048576).toFixed(0)} MB.`);
    }
    if (opusIn) {
      log(`The sound packages with Opus: ${(opusIn / 1048576).toFixed(0)} MB to ${(opusOut / 1048576).toFixed(0)} MB.`);
    }
    Object.assign(report, { build: build.edition, packedIn, packedOut, hevcIn, hevcOut, opusIn, opusOut, seconds: seconds() });
    return report;
  } catch (error) {
    stopAll();
    throw error;
  }
}
