# sasrt-nx-installer

Version 0.1.0 (test), for sasrt-nx: Sonic & All-Stars Racing Transformed on the Nintendo Switch (homebrew).

This page makes the Switch package from **your own copy** of the game (the folder it was extracted to). It runs entirely
in your browser (Chrome or Edge recommended): your game files are not uploaded, and none of the game's files come with
sasrt-nx. Extract the `sasrt-nx.zip` it gives you to the root of the SD card.

## For developers

A copy of [rr6-nx-installer](https://github.com/ChanseyIsTheBest/rr6-nx-installer) (the lean variant of the template:
no shader step) with culdcept-nx-installer's XMA-to-Opus pieces, adapted to SASRT (the user, 2026-11-21: "please
compress all the videos and audio", "copy culdcept saga web installer for encoding audio and video please and
compressing files with ZXC and L4Z"). `game.json` holds SASRT's lists. What the page does with the game folder:

- **Packing**: `Data/GameAssets.M00`, `Frontend.M00` and `GameData.M00` (the archives the game's loads read) as LZ4
  HC 9 in 256 KB blocks (`NAME.lz4b` version 1, `lib/lz4b.js` on `pack_worker.js`, one per core). Nothing else as ZXC:
  every other file saves under 5 % (`test/game_node.mjs --measure`). `default.xex` and the `.toc` files as they are.
- **The movies as H.265** (option, ticked by default): each `Data/Movies/*.usm` (CRI USM: MPEG-1 1280x720 with B frames
  and ADX audio) as rr6-nx's RXSFDH01 (`sdk/include/rex/filesystem/sfd_hevc.h` in rr6-nx and sasrt-nx): `lib/usmh.js`
  reads the USM's @SFV chunks (type 0, channel 0) for the video stream and hands it to rr6-nx-installer's `lib/sfdh.js`
  (FFmpeg's MPEG-1 decoder in WebAssembly, the browser's H.265 encoder at 35 % of the MPEG-1 bitrate, a keyframe every
  120 frames, no B frames; each picture's slice data a slice header, a 10-byte tag and zeros). Written ZXC-packed as
  `NAME.usm.hevc.lz4b` (the user, via rr6-nx). sasrt-nx's `tools/hevc_usm_pack.py` makes the same layout with ffmpeg:
  `test/game_node.mjs` checks the page's writer against it byte for byte.
- **The sounds as Opus** (option, ticked by default): each Wwise package `Data/sound/*.pck` (AKPK, big-endian; XMA2 WEMs
  streamed or in sound banks, single-stream, 2048-byte packets) as `NAME.pck.xmop` (sasrt-nx's
  `sdk/include/rex/filesystem/xmo.h`: culdcept-nx's `.xmo` for many sounds in one file). Each XMA2 sound's packets are
  walked as the port's XMA emulation walks them and its frames decoded in order by FFmpeg 4.4's xmaframes decoder
  (`wasm/xma`, built from sasrt-nx's own FFmpeg; `xma_open_raw` for a WEM's data chunk), encoded as Opus (20 ms packets)
  at the sound's rate (48 or 24 kHz; 44.1 kHz sounds resampled to 48 kHz by `lib/resample.js`, the port resamples back),
  and written with the package's other bytes as segments. A sound stays XMA when its Opus is not smaller or a packet has
  no room for its tag. Bitrates (`game.json`): music 128 kbit/s, the language packs' voices 64 kbit/s, 24 kHz sounds
  32/48 kbit/s, the sound banks' effects 64/96 kbit/s. A package is written ZXC-packed (`NAME.pck.xmop.lz4b`) when that
  saves `zxc_min_saving` (5 %).
- **The rest** as it is (`$SystemUpdate/` left out); the DLC packages to `switch/sasrt-nx/dlc/`.

### Tests on a PC (Node 24, ffmpeg with libopus at `C:/ffmpeg/ffmpeg.exe`)

- `node test/xmop_node.mjs <game folder> <out> [regex]`: the packages' `.xmop` with ffmpeg's libopus standing in for
  WebCodecs. `node test/xmop_check.mjs NAME NAME.xmop`: synthesizes NAME as the port does and checks every byte outside
  the sounds, every packet header, frame length and last bit, the tags and the frame walk.
- `node test/game_node.mjs <game folder> <out game_root> --hevc DIR --xmop DIR [--measure]`: the whole `game_root` as the
  page lays it out (movies from `tools/hevc_usm_pack.py`'s `.hevc`, sound packages from `test/xmop_node.mjs`).
- `node test/pack_node.mjs <out> <file>...`: single files as `.lz4b`.

### Rebuilding the WebAssembly

`wasm/src/xma/build.sh` (Emscripten 6.0.11; `EMSDK`, `FFMPEG_SRC` = sasrt-nx's `sdk/thirdparty/FFmpeg`, `BUILD` a folder
with no spaces), and rr6-nx-installer's `wasm/src/{lz4,zxc,mpeg1}/build.sh`.

### release/

Empty: `tools/make_release.py --nro <NRO> ...` fills it. `release/README.md` lists what a distribution still needs (the
shader packages).
