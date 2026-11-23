# sasrt-nx-installer

Version 1.0.0, for **sasrt-nx 1.0.0**: Sonic & All-Stars Racing Transformed on the Nintendo Switch (homebrew), by
ChanseyIsTheBest.

This page makes the Switch package from **your own copy** of the game. It runs entirely in your browser: your game files
are not uploaded, and none of the game's files come with sasrt-nx: not its data, not its shaders.

## What you need

- Your copy of the game: the **Xbox 360 disc** as an `.iso` image, the **Games on Demand** package (the folder that holds
  its package file and the `.data` folder beside it, e.g. `5345085D/00007000/`), or the folder it was extracted to (with
  `default.xex` and `Data/`).
- Optional: the **DLC** (the Bonus Pack: Metal Sonic and Outrun Bay), as the Xbox 360 package you have.
- A desktop **Chromium browser** (Chrome, Edge, Brave...), about 3 GB of free disk space for the download, and for the
  re-encoded movies a graphics card with an H.265 encoder.
- A Switch that runs homebrew (Atmosphère) with **Sphaira**, and an SD card with about 3 GB free.

## How to use it

1. Open the page. To run it on your own computer: `python serve.py 8193 .` in this folder, then open
   http://127.0.0.1:8193/.
2. **Choose your game**: the disc image, the Games on Demand folder, or the extracted folder. The page checks that it is
   the supported version and that every file is there.
3. Optional: **add the DLC** package.
4. Press **Create sasrt-nx.zip**. The page makes the game's shaders for the Switch from your files (with **Compile the
   shaders** ticked, also compiled for the console, so the game plays without compile stutters), re-encodes the movies
   and the sounds, packs the archives, and the zip downloads while it is made; keep the page open until it finishes.
5. If you have an older sasrt-nx, delete its `switch/sasrt-nx/game_root` folder first: a file left there unpacked is used
   instead of the packed one.
6. Extract `sasrt-nx.zip` to the **root of the SD card**. It makes `switch/sasrt-nx/`.
7. On the Switch, open **Sphaira**, find the game, press **X** to open Options and choose **Install Forwarder**, make
   sure **Address Space** is **39-bit**, choose **Create Forwarder**, then start the game from the **Home Screen**. Start
   it from the forwarder: that is what gives it four CPU cores (after its first start).

## What goes on the SD card

| Path | What it is |
|---|---|
| `switch/sasrt-nx/sasrt.nro` | the program (no game shader in it but the few the game makes while it runs) |
| `switch/sasrt-nx/sasrt.toml` | the settings, with every log off but the crash reports |
| `switch/sasrt-nx/deko3d_glsl.bin` | the game's shaders, translated from your files |
| `switch/sasrt-nx/deko3d_shaders.bin`, `pipeline_list.bin` | the same compiled for the Switch, and the pipelines the game builds at start (with **Compile the shaders**) |
| `switch/sasrt-nx/game_root/` | the game's files: the archives packed (`.lz4b`), the movies as H.265 (`.usm.hevc.lz4b`), the sound packages with Opus (`.pck.xmop`) |
| `switch/sasrt-nx/dlc/` | the DLC package, installed by the game at its first start |

**Smaller game files.** The archives the game's loading screens read (`Data/*.M00`) are packed with **LZ4 HC level 9 in
256 KB blocks**; the movies are re-encoded to **H.265** (the Switch's video hardware plays them) and packed with **ZXC**;
the music, voices and effects become **Opus** (music 128 kbit/s, voices 64 kbit/s), packed with ZXC when that saves 5 %.
The game goes from 4.7 GB to about 2.2 GB, and sasrt-nx reads every file as the file it was.

## If something goes wrong

- The page says the game is not supported: sasrt-nx supports one `default.xex`, the one the release's `manifest.json`
  names. It also names any file missing from your copy.
- A crash writes `switch/sasrt-nx/logs/rex/rex_crash.log`. For a bug report, set `log_level = "info"` at the top of
  `switch/sasrt-nx/sasrt.toml`, play until the problem happens, and include the `switch/sasrt-nx/logs/` folder.

## How it works

The rest of this file is for developers. The page is renut_nx_ultimate_installer (the ultimate base's web installer,
[renut_nx_ultimate_installer](https://github.com/ChanseyIsTheBest/renut_nx_ultimate_installer)) with blur-nx-installer 1.0.1's media steps and SASRT's own:

- **The shaders** (`lib/install.js`, `lib/sources.js`, `lib/build.js`, `lib/chain.js`, `glsl_worker.js`,
  `uam_worker.js`): SASRT keeps its shaders in its resource packages (`Data/GameAssets.M00`, `Frontend.M00`) as Direct3D
  shader objects, each container's header in a package's CPU section and its microcode in the GPU section, tens of MB
  later; the engine's own shaders are split the same way in `default.xex`. sasrt-nx's `tools/shader_records.py` finds
  both parts of every container the NRO's shader table names, by their bytes, and the release's manifest lists where
  they are (`"codec": "split"` records: the file, or `"source": "image"` for default.xex's decrypted image, the header's
  offset and length, the microcode's, the SHA-256 of the two joined). A vertex shader the game's D3D has bound to a
  vertex declaration is patched in memory (its header's flag 0x40, its vertex fetches' formats and strides): its record
  carries those dwords as `edits` (323 shaders, 14 dwords each on average). `lib/sources.js` reads the two ranges,
  writes the edits and checks the SHA-256 (`test/records_node.mjs`: all 1,978 the dump's byte for byte). The NRO keeps
  29 built in: 24 the game makes at runtime and 5 found nowhere in the files. Then
  Renut's translator (`wasm/renut_hlsl`, built from sasrt-nx), DXC and SPIRV-Cross, and sasrt-nx's own Python passes in
  Pyodide (`py/`, `tools/sync_from_base.py --base <sasrt-nx>`) make `deko3d_glsl.bin`; with **Compile the shaders**, uam
  (`wasm/uam`, built from sasrt-nx) compiles every variant of `release/variants.txt` (sasrt-nx's
  `tools/deko3d_variant_cache.py --export-variants` over its console pipeline lists, with `--generic --sasrt-guess
  --round-guess --earlykill-ab` and its run-time logs) into `deko3d_shaders.bin`. game.json's `"early_alpha": false`:
  sasrt-nx builds without the early alpha pass, so the page skips it too.
- **The NRO** is built with `-DBANJO_RENUT_RELEASE_SHADERS=ON` (sasrt-nx's `app/cmake/sasrt_renut_gpu.cmake`): the
  shader table without SPIR-V and only the shaders the game makes at runtime built in (`tools/renut_release_shaders.py
  --only`), which no game file holds.
- **Games on Demand** (`lib/god.js`): the package's SVOD volume read in place (the XDVDFS image cut into `DataNNNN`
  files with their hash tables between the blocks), and its files listed by `lib/xiso.js` as a disc image's are.
- **The movies** (`lib/usmh.js`, `lib/sfdh.js`, `wasm/mpeg1`): each CRI USM's MPEG-1 video decoded and re-encoded to
  H.265 by the browser (WebCodecs), as rr6-nx's RXSFDH01 (`NAME.usm.hevc`), ZXC-packed.
- **The sounds** (`lib/wwise.js`, `lib/xmop.js`, `lib/audio.js`, `wasm/xma`): the Wwise packages' XMA2 sounds decoded
  and re-encoded to Opus (WebCodecs), written as sasrt-nx's `.xmop` (`sdk/include/rex/filesystem/xmo.h`).
- **Packing** (`lib/lz4b.js`, `pack_worker.js`): `.lz4b` version 1 (LZ4) and 2 (ZXC), rr6-nx 1.0.1's format.

## Making a release

From sasrt-nx's folder (the paths below are its own):

```bash
python -P tools/shader_records.py --game assets/game_root --dump out/renut_shader_dump_release \
  --out out/shader_records.json --image out/default_image.bin
python -P tools/renut_release_shaders.py --only out/renut_nro_kept.txt
powershell -NoProfile -ExecutionPolicy Bypass -File tools/win/build_switch.ps1 -Pgo use -Final -Build out\nx-inplace -InPlace -ReleaseShaders
python tools/release_toml.py --out out/release_1_0_0/sasrt.toml
python ../sasrt-nx-installer/tools/make_release.py --port . --nro out/nx-inplace/sasrt.nro --game assets/game_root \
  --image out/default_image.bin --dump out/renut_shader_dump_release --glsl out/deko3d_shaders_sync/glsl_opt \
  --records out/shader_records.json --nro-shaders out/renut_nro_kept.txt \
  --pipeline-list out/deko3d_shaders/lists/console_pipeline_list_1113sync.bin --extra-list <each other console list> \
  --variant-args "--generic --sasrt-guess --round-guess --earlykill-ab --runtime-log <each console log>" \
  --file out/release_1_0_0/sasrt.toml:sasrt.toml --version 1.0.0
```

The NRO keeps built in (`--only`, raw: `lib/nro.js` reads them out of the NRO and compiles their variants with the
rest) the shaders the records do not find; `--glsl` is sasrt-nx's shipping GLSL (`out/deko3d_shaders_sync`), against
which the variants are exported.

Then `node test/full_node.mjs <game folder> <out.zip> --reference --native-glsl=<sasrt-nx>/out/deko3d_shaders_sync/glsl_opt`
and `python test/check_zip.py <out.zip> <game folder>`.

## Tests (Node 24, from this folder)

| Test | What it checks |
|---|---|
| `test/full_node.mjs <game> <out.zip> [--native-glsl=<dir>] [--reference]` | the whole page in Node: the shaders, the packing, the zip; no movies or sounds re-encoded (WebCodecs: the browser only), those are packed as they are. sasrt-nx 1.0.0: 1,978 shaders, 527 the native chain's byte for byte, the rest only by the page's newer DXC and constant 927 (every pass's output the same) |
| `test/records_node.mjs <game> <shader_records.json> [<dump>]` | `lib/sources.js` over sasrt-nx's records: every container read, edited, checked (and against the dump) |
| `test/god_node.mjs <package file> <extracted folder>` | `lib/god.js` on a Games on Demand package against the folder it was extracted to |
| `test/xmop_node.mjs`, `test/xmop_check.mjs` | the sound packages' `.xmop` (see the old notes in git history) |
| `test/browser.html` (with `python serve.py 8193 . --test-files <game> --test-out <zip>`) | `worker.js` in a browser |

Outputs of the tests are game data: never commit or share them.

## License

GPL-3.0 (see [LICENSE](LICENSE)). Third-party components are listed in [NOTICES.md](NOTICES.md).
