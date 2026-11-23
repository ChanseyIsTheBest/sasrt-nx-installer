#!/usr/bin/env python3
"""sasrt-nx-installer (2026-11-21): rr6-nx-installer's tools/make_release.py (credit rr6-nx) for SASRT. Fills release/
from a sasrt-nx tree, and release/manifest.json with every file's SHA-256 and the supported default.xex's.

  python tools/make_release.py --nro <NRO> [--sasrt <sasrt-nx>] [--xex <default.xex>] [--config <sasrt.toml>]
                               [--file <path in switch/sasrt-nx>=<source>]...

No default NRO: name the build that reads the installer's files (sasrt-nx built with the readers of NAME.lz4b version 2
(ZXC), NAME.hevc / NAME.hevc.lz4b (rex/filesystem/sfd_hevc.h) and NAME.xmop / NAME.xmop.lz4b (rex/filesystem/xmo.h)).
release/README.md says what else a distribution needs (the shader packages are made from the game on a PC today).
"""
import argparse
import hashlib
import json
import os
import shutil

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RELEASE = os.path.join(HERE, 'release')
VERSION = '0.1.0'


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sasrt', default=os.path.join(os.path.dirname(HERE), 'sasrt-nx'))
    ap.add_argument('--nro', required=True)
    ap.add_argument('--xex', default=None)
    ap.add_argument('--config', default=None)
    ap.add_argument('--file', action='append', default=[], help='PATH=SOURCE: another file of switch/sasrt-nx/')
    a = ap.parse_args()
    sources = {'sasrt.nro': a.nro}
    if a.config:
        sources['sasrt.toml'] = a.config
    for spec in a.file:
        path, src = spec.split('=', 1)
        sources[path.replace('\\', '/')] = src
    xex = a.xex or os.path.join(a.sasrt, 'assets', 'game_root', 'default.xex')
    os.makedirs(RELEASE, exist_ok=True)
    hashes = {}
    for name, src in sources.items():
        if not os.path.isfile(src):
            raise SystemExit(f'missing: {src}')
        dst = os.path.join(RELEASE, name.replace('/', '_'))
        shutil.copyfile(src, dst)
        hashes[name] = sha256(dst)
        print(f'{name:28s} {os.path.getsize(src):>12,} bytes  {hashes[name][:16]}  <- {src}')
    manifest = {
        'version': VERSION,
        'builds': [{
            'edition': 'Xbox 360 (Games on Demand)',
            'xex_sha256': sha256(xex),
            'nro': 'sasrt.nro',
            'nro_sha256': hashes['sasrt.nro'],
            'files': [{'path': n, 'source': n.replace('/', '_'), 'sha256': hashes[n]} for n in sources if n != 'sasrt.nro'],
        }],
    }
    with open(os.path.join(RELEASE, 'manifest.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')
    print(f'manifest.json: default.xex {manifest["builds"][0]["xex_sha256"][:16]}, version {VERSION}')


if __name__ == '__main__':
    main()
