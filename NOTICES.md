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
| [Emscripten](https://emscripten.org) 6.0.11 runtime and the musl libc it links | `wasm/*.mjs`, `wasm/*.wasm` | MIT and NCSA |

`wasm/lz4.*` is built by `wasm/src/lz4/build.sh`, `wasm/zxc.*` by `wasm/src/zxc/build.sh`, `wasm/mpeg1.*` by
`wasm/src/mpeg1/build.sh` and `wasm/xma.*` by `wasm/src/xma/build.sh` (Emscripten 6.0.11).

The licenses of the software in the NRO are listed in sasrt-nx's repository, with its source code.
