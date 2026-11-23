# Third-party notices

sasrt-nx-installer is a fork of [rr6-nx-installer](https://github.com/ChanseyIsTheBest/rr6-nx-installer) with pieces of
[culdcept-nx-installer](https://github.com/ChanseyIsTheBest/culdcept-nx-installer), both built on kameo-nx-installer and
[renut-nx-webinstaller](https://github.com/ChanseyIsTheBest/renut-nx-webinstaller) (GPL-3.0).

| Component | Where | License |
|---|---|---|
| rr6-nx-installer by ChanseyIsTheBest: this page's starting point (the page, the worker, the packing worker, the zip writer, the worker pool, the test server, the LZ4/ZXC packing and its WebAssembly, the MPEG-1 decoder's WebAssembly, the SFD H.265 writer `lib/sfdh.js` that `lib/usmh.js` uses, the release script) | `app.js`, `worker.js`, `pack_worker.js`, `lib/lz4b.js`, `lib/sfdh.js`, `lib/zip.js`, `lib/pool.js`, `serve.py`, `sw.js`, `tools/make_release.py`, `test/pack_node.mjs`, `test/node_pool.mjs`, `wasm/src/lz4/`, `wasm/src/zxc/`, `wasm/src/mpeg1/` | GPL-3.0 |
| culdcept-nx-installer by ChanseyIsTheBest: the XMA-to-Opus method (`lib/xmo.js`, `lib/audio.js`, `test/audio_node.mjs`, adapted for many sounds as `lib/xmop.js`, `lib/audio.js`, `test/xmop_node.mjs`), the XMA decoder's WebAssembly (`wasm/src/xma/`, with `xma_open_raw` added), the tag and tag-bit rule (`test/xmop_check.mjs` follows culdcept-nx's `xmo.cpp`) | `lib/xmop.js`, `lib/audio.js`, `wasm/src/xma/`, `test/xmop_node.mjs`, `test/xmop_check.mjs` | GPL-3.0 |
| kameo-nx-installer, [bejeweled3-nx-installer](https://github.com/ChanseyIsTheBest/bejeweled3-nx-installer) and [sa2-nx-installer](https://github.com/ChanseyIsTheBest/sa2-nx-installer) by ChanseyIsTheBest (through rr6-nx-installer) | `app.js`, `worker.js`, `lib/zip.js`, `lib/pool.js`, `serve.py` | GPL-3.0 |
| [nfsmw-nx-installer](https://github.com/StevensND/nfsmw-nx-installer) by StevensND: the download service worker and the worker's download stream (through bejeweled3-nx-installer), the zip writer | `sw.js`, `worker.js`, `lib/zip.js` | GPL-3.0 |
| [LZ4](https://github.com/lz4/lz4) 1.10.0 by Yann Collet: `lz4.c`, `lz4.h`, `lz4hc.c`, `lz4hc.h`, unmodified | `wasm/src/lz4/`, `wasm/lz4.*` | BSD 2-Clause (`wasm/src/lz4/LICENSE`) |
| [ZXC](https://github.com/hellobertrand/zxc) 0.15.0 by Bertrand Lebonnois: its library, unmodified but for `zxc_driver.c` left out | `wasm/src/zxc/`, `wasm/zxc.*` | BSD 3-Clause (`wasm/src/zxc/LICENSE`) |
| [rapidhash](https://github.com/Nicoshev/rapidhash) by Nicolas De Carli, bundled with ZXC | `wasm/src/zxc/src/lib/vendors/rapidhash.h`, `wasm/zxc.*` | MIT (`wasm/src/zxc/THIRD_PARTY_NOTICES`) |
| [FFmpeg](https://ffmpeg.org) 4.4 (rr6-nx's `sdk/thirdparty/FFmpeg`): libavcodec's MPEG-1 video decoder and libavutil, built with that decoder only | `wasm/mpeg1.*` | LGPL-2.1-or-later |
| [FFmpeg](https://ffmpeg.org) 4.4 (sasrt-nx's `sdk/thirdparty/FFmpeg`, the port's own copy): libavcodec's xmaframes decoder (WMA Pro's, with the ReXGlue ports' frame-by-frame XMA entry) and libavutil, built with that decoder only | `wasm/xma.*` | LGPL-2.1-or-later |
| [renut_nx_ultimate_installer](https://github.com/ChanseyIsTheBest) by ChanseyIsTheBest: the page's shader step, the game check, the disc image and XEX readers (with blur-nx-installer 1.0.1's media steps); sasrt-nx-installer adds the split records, the Games on Demand reader (`lib/god.js`, after sasrt-nx's `tools/god_extract.py`) | `lib/install.js`, `lib/sources.js`, `lib/build.js`, `lib/chain.js`, `lib/god.js`, `glsl_worker.js`, `uam_worker.js`, `tools/make_release.py` | GPL-3.0 |
| sasrt-nx's shader tools (the ultimate base's, from banjo-nx and katamari-nx, with sasrt-nx's passes and lists), run unchanged in Pyodide: `tools/deko3d_glsl.py`, `tools/deko3d_glsl_opt.py` (and its shader lists), `tools/early_alpha.py`, `tools/renut_early_alpha.py` | `py/` | GPL-3.0 |
| [reNut](https://github.com/masterspike52/reNut) by masterspike52: the renderer whose shader chain this page runs, reused with its author's permission | throughout the chain | as its repository states |
| XenosRecomp ([hedge-dev](https://github.com/hedge-dev/XenosRecomp) and contributors), in reNut's version as sasrt-nx carries it | `wasm/renut_hlsl.*`, `release/shader_common.h` | MIT |
| [uam](https://github.com/devkitPro/uam) by fincs (with Mesa's GLSL compiler and the nouveau codegen), with SwitchWakerHD's patches and banjo-nx's passes, as sasrt-nx's `app/thirdparty/uam` | `wasm/uam.*`, `wasm/src/uam/` | uam: zlib License; Mesa: MIT and others (see its sources) |
| [DirectXShaderCompiler](https://github.com/microsoft/DirectXShaderCompiler) v2025.1 with SPIRV-Tools and SPIRV-Headers, and the `dxc_web.cpp` wrapper, as built by nfsmw-nx-installer (from bejeweled3-nx-installer) | `wasm/dxc_web.*` | NCSA (LLVM); SPIRV-Tools: Apache-2.0; SPIRV-Headers: MIT; the wrapper: GPL-3.0 |
| [SPIRV-Cross](https://github.com/KhronosGroup/SPIRV-Cross) (commit `22b22f56`), unmodified | `wasm/spirv_cross.*` | Apache-2.0 |
| [Pyodide](https://pyodide.org) 0.27.7 (CPython 3.12 for WebAssembly) and its numpy 2.0.2 wheel, unmodified | `vendor/pyodide/` | Pyodide: MPL-2.0; CPython: PSF License; numpy: BSD-3-Clause |
| [libmspack](https://www.cabextract.org.uk/libmspack/) by Stuart Caie: the LZX decoder (through katamari-nx-installer; `lzxd.c` from the base's SDK in `wasm/xexp`) | `wasm/lzx.*`, `wasm/xexp.*` | LGPL-2.1 |
| The title update's reader and patch (`lib/stfs.js`, `lib/update.js`, `lib/xexp.js`, `wasm/src/xexp/xexp_wasm.c`), from blur-nx-installer (ChanseyIsTheBest, 2026-11-18); `lib/xexp.js` and `xexp_wasm.c` follow [Xenia](https://github.com/xenia-project/xenia)'s XexModule::ApplyPatch and LZX delta records as the base's SDK has them | `lib/`, `wasm/src/xexp/` | GPL-3.0 (Xenia's parts: BSD-3-Clause) |
| [xxHash](https://github.com/Cyan4973/xxHash) and [{fmt}](https://github.com/fmtlib/fmt), in the translator | `wasm/renut_hlsl.*` | BSD-2-Clause; MIT |
| [Emscripten](https://emscripten.org) 6.0.11 runtime and the musl libc it links | `wasm/*.mjs`, `wasm/*.wasm` | MIT and NCSA |

`wasm/lz4.*` is built by `wasm/src/lz4/build.sh`, `wasm/zxc.*` by `wasm/src/zxc/build.sh`, `wasm/mpeg1.*` by
`wasm/src/mpeg1/build.sh` and `wasm/xma.*` by `wasm/src/xma/build.sh` (Emscripten 6.0.11).

The licenses of the software in the NRO are listed in sasrt-nx's repository, with its source code.
