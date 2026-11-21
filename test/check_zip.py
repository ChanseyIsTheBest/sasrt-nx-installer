#!/usr/bin/env python3
"""sasrt-nx-installer (2026-11-21): rr6-nx-installer's check (credit rr6-nx) for sasrt-nx.zip: the game folder walked
recursively, game.json's lists for each file (skip, as is, LZ4, ZXC); a movie or sound package the page re-encoded is
there as NAME.hevc.lz4b / NAME.hevc or NAME.xmop(.lz4b) instead (a plain NAME.xmop is checked by test/xmop_check.mjs,
the others only found: their re-encodes are checked by the PC tests).

rr6-nx-installer (2026-11-10): checks an rr6-nx.zip the page made against the game folder it was made from and
release/: the zip's CRCs (zipfile), every game_root file byte for byte, every .lz4b entry's blocks decompressed and
compared with the original file, and the release files by SHA-256 (manifest.json).

2026-11-11, lib/lz4b.js's rule: the RRM archives are version-1 (LZ4) entries, decoded here; every other file but
default.xex is a version-2 (ZXC) entry, written to a temporary file and read through rr6-nx's own reader by its host test
(tools/test_lz4_blocks.cpp's exe: RR6_LZ4B_TEST, default D:/ridge racer 6/rr6-nx/out/test_lz4_blocks.exe; Python has no
ZXC); default.xex is copied as it is.

  python test/check_zip.py <sasrt-nx.zip> <game folder>

Needs the lz4 module. Game data: never commit or share the zip.
"""
import hashlib
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import zipfile

import lz4.block

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = 'switch/sasrt-nx/'
CONFIG = json.load(open(os.path.join(HERE, 'game.json'), encoding='utf-8'))
READER_TEST = os.environ.get('RR6_LZ4B_TEST', r'D:/ridge racer 6/rr6-nx/out/test_lz4_blocks.exe')


def fits(lst, path):
    return any(re.fullmatch(m, path, re.I) for m in lst or [])


def codec_for(path):
    """lib/lz4b.js's codecFor."""
    if fits(CONFIG.get('asis'), path):
        return None
    if fits(CONFIG.get('lz4'), path):
        return 'lz4'
    return 'zxc' if fits(CONFIG.get('zxc'), path) else None


def check_zxc(z, info, original):
    """A version-2 entry through rr6-nx's reader: the whole file and 2,000 random reads compared with the original."""
    with z.open(info) as f:
        magic, version, block, size, count, _ = struct.unpack('<8sIIQII', f.read(32))
    assert magic == b'RXLZ4BLK' and version == 2, 'header'
    assert size == os.path.getsize(original), f'holds {size} bytes, the original has {os.path.getsize(original)}'
    fd, temp = tempfile.mkstemp(suffix='.lz4b')
    try:
        with os.fdopen(fd, 'wb') as out, z.open(info) as f:
            shutil.copyfileobj(f, out, 1 << 20)
        env = dict(os.environ)
        clang64 = r'C:/devkitPro/msys2/clang64/bin'
        if os.path.isdir(clang64):
            env['PATH'] = clang64 + os.pathsep + env.get('PATH', '')
        r = subprocess.run([READER_TEST, temp, original, '2000'], capture_output=True, text=True, env=env)
        if r.returncode != 0 or not r.stdout.startswith('OK'):
            raise AssertionError('rr6-nx reader: ' + (r.stdout + r.stderr).strip()[-300:])
    finally:
        os.remove(temp)
    return size, info.file_size, count


def check_lz4b(z, info, original):
    with z.open(info) as f:
        magic, version, block, size, count, _ = struct.unpack('<8sIIQII', f.read(32))
        assert magic == b'RXLZ4BLK' and version == 1, 'header'
        assert size == os.path.getsize(original), f'holds {size} bytes, the original has {os.path.getsize(original)}'
        f.seek(info.file_size - 16)
        index_offset, end = struct.unpack('<Q8s', f.read(16))
        assert end == b'RXLZ4END', 'footer'
        f.seek(index_offset)
        sizes = struct.unpack(f'<{count}I', f.read(4 * count))
        assert 32 + sum(sizes) == index_offset, 'index'
        f.seek(32)
        with open(original, 'rb') as o:
            for i, stored in enumerate(sizes):
                length = block if i + 1 < count else size - i * block
                data = f.read(stored)
                raw = data if stored == length else lz4.block.decompress(data, uncompressed_size=length)
                if raw != o.read(length):
                    raise AssertionError(f'block {i} differs')
    return size, info.file_size, count


def main():
    zip_path, game = sys.argv[1], sys.argv[2]
    manifest = json.load(open(os.path.join(HERE, 'release', 'manifest.json'), encoding='utf-8'))
    build = manifest['builds'][0]
    with zipfile.ZipFile(zip_path) as z:
        bad = z.testzip()
        if bad:
            raise SystemExit(f'FAIL: {bad} has a wrong CRC')
        names = [i.filename for i in z.infolist()]
        print(f'{len(names)} entries, all CRCs right')
        release = {ROOT + CONFIG['nro']: build['nro_sha256'], **{ROOT + f['path']: f['sha256'] for f in build['files']}}
        for name, want in release.items():
            got = hashlib.sha256(z.read(name)).hexdigest()
            if got != want:
                raise SystemExit(f'FAIL: {name} is not the release file')
        print(f'release files: {len(release)} as the manifest names them')
        game_files = []
        for d, _, fs in os.walk(game):
            for n in fs:
                rel = os.path.relpath(os.path.join(d, n), game).replace(os.sep, '/')
                if not fits(CONFIG.get('skip'), rel):
                    game_files.append(rel)
        game_files.sort()
        packed_in = packed_out = 0
        for name in game_files:
            original = os.path.join(game, name)
            base = ROOT + 'game_root/' + name
            if fits([CONFIG['movies']['match'], CONFIG['audio']['match']], name):
                found = [e for e in (base + '.hevc.lz4b', base + '.hevc', base + '.xmop.lz4b', base + '.xmop') if e in names]
                if found:
                    if base in names:
                        raise SystemExit(f'FAIL: {name} is in the zip both re-encoded and as it is')
                    if found[0].endswith('.xmop'):
                        fd, temp = tempfile.mkstemp(suffix='.xmop')
                        with os.fdopen(fd, 'wb') as out, z.open(found[0]) as f:
                            shutil.copyfileobj(f, out, 1 << 20)
                        r = subprocess.run(['node', os.path.join(HERE, 'test', 'xmop_check.mjs'), original, temp],
                                           capture_output=True, text=True)
                        os.remove(temp)
                        if r.returncode:
                            raise SystemExit(f'FAIL: {found[0]}: {r.stdout.strip()[-300:]}')
                    print(f'{found[0]}: re-encoded ({z.getinfo(found[0]).file_size / os.path.getsize(original) * 100:.1f} %)')
                    continue
            codec = codec_for(name)
            if codec:
                entry = base + '.lz4b'
                if base in names:
                    raise SystemExit(f'FAIL: {name} is in the zip unpacked too')
                check = check_lz4b if codec == 'lz4' else check_zxc
                size, packed, count = check(z, z.getinfo(entry), original)
                packed_in += size
                packed_out += packed
                print(f'{entry} ({codec}): {count} blocks equal {name} ({packed / size * 100:.1f} %)')
            else:
                entry = base
                h = hashlib.sha256()
                with z.open(entry) as f:
                    for piece in iter(lambda: f.read(1 << 20), b''):
                        h.update(piece)
                o = hashlib.sha256()
                with open(original, 'rb') as f:
                    for piece in iter(lambda: f.read(1 << 20), b''):
                        o.update(piece)
                if h.digest() != o.digest():
                    raise SystemExit(f'FAIL: {entry} differs from {name}')
        print(f'game_root: {len(game_files)} files right; the packed ones {packed_in / 1048576:.0f} MB -> '
              f'{packed_out / 1048576:.0f} MB')
    print('OK')


if __name__ == '__main__':
    main()
