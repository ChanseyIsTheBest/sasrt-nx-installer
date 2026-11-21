# release/

Empty on purpose: `tools/make_release.py --nro <sasrt.nro> [--config <sasrt.toml>] [--file PATH=SOURCE ...]` fills it
and writes `manifest.json` (each file's SHA-256 and the supported `default.xex`'s). The page refuses to run without it.

What a distribution needs here (switch/sasrt-nx/ on the card, docs/switch-testing.md in sasrt-nx):

- `sasrt.nro`: a sasrt-nx build that reads what this installer writes: `NAME.lz4b` version 1 (LZ4) and 2 (ZXC),
  `NAME.usm.hevc.lz4b` (rr6-nx's RXSFDH01 inside a ZXC `.lz4b`; nxvideo on NVDEC), `NAME.pck.xmop` and
  `NAME.pck.xmop.lz4b` (sasrt-nx's `sdk/include/rex/filesystem/xmo.h`).
- `sasrt.toml`: the player's settings.
- The shader packages, which sasrt-nx makes from the game on a PC today and which may not ship as they are (they are made
  from the game's shaders): `deko3d_shaders.bin` (the native renderer's compiled shaders), `pipeline_list.bin` (the
  pipelines to prebuild), `sasrt_shaders.mesp` + `.mesp.idx` (the NVK renderer's, unused by the deko3d NRO). Either the
  page makes them from `default.xex` and the game's shader files (as culdcept-nx-installer's translator step does), or
  the NRO compiles them at first start.
