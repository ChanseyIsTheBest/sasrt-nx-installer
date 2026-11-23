// sasrt-nx-installer (2026-11-22, the user: the installer "extract"s the game too): an Xbox 360 Games on Demand package
// (sasrt-nx's tools/god_extract.py, in the browser). A GOD package is an STFS header file (LIVE, PIRS or CON; content
// type 0x7000 Games on Demand, 0x4000 an installed disc) whose volume is SVOD: the disc's game partition (XDVDFS) cut
// into the files <header>.data/DataNNNN. Each data file: a master hash table (0x1000 bytes), then groups of one
// level-0 hash table and 204 data blocks of 0x1000 bytes (203 groups a file). The image's data block b is in file
// b / (204 * 203), group (b % (204 * 203)) / 204, at 0x1000 + group * 205 * 0x1000 + 0x1000 + (b % 204) * 0x1000.
// The XDVDFS volume descriptor ("MICROSOFT*XBOX*MEDIA") is partition sector 32: classic layout, data block 0 is
// partition sector 0; enhanced GDF layout (XGD3), the first 32 sectors are left out and data block 0 is the descriptor.
// openGod gives read(offset, length) over the partition, which lib/xiso.js's listXiso walks as it walks a disc image.
// The hash tables are not checked here (god_extract.py --verify-all checks a dump); the release's game check (the
// files' sizes and default.xex's SHA-256) still runs.
const BLOCK = 0x1000;
const SECTOR = 0x800;
const BLOCKS_PER_GROUP = 204;
const GROUPS_PER_FILE = 203;
const BLOCKS_PER_FILE = BLOCKS_PER_GROUP * GROUPS_PER_FILE;
const GROUP_SPAN = (1 + BLOCKS_PER_GROUP) * BLOCK;
const MAGIC = 'MICROSOFT*XBOX*MEDIA';

const be32 = (d, o) => ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;

// header: the STFS header file's first 0xB000 bytes (or all of it); data: the DataNNNN files in order, each
// { size, read(offset, length) -> Promise<Uint8Array> }. Returns { size, read(offset, length), titleId, name, kind }, or
// throws when it is not a GOD package or the data files do not match the header.
export async function openGod(header, data) {
  const magic = String.fromCharCode(...header.subarray(0, 4));
  if (!['LIVE', 'PIRS', 'CON '].includes(magic)) throw new Error('not an Xbox 360 package (no LIVE, PIRS or CON)');
  const contentType = be32(header, 0x344);
  if (be32(header, 0x3a9) !== 1) throw new Error('the package is not a Games on Demand one (its volume is not SVOD)');
  const fileCount = be32(header, 0x39d);
  const dataBlocks = (header[0x379 + 0x19] << 16) | (header[0x379 + 0x1a] << 8) | header[0x379 + 0x1b];
  const titleId = be32(header, 0x360);
  const name = new TextDecoder('utf-16be').decode(header.subarray(0x411, 0x491)).split('\0')[0];
  if (data.length !== fileCount) throw new Error(`the package names ${fileCount} data files, the folder holds ${data.length}`);
  const fileBlocks = data.map((f) => {
    const groups = Math.floor((f.size - BLOCK) / GROUP_SPAN), rest = (f.size - BLOCK) % GROUP_SPAN;
    return groups * BLOCKS_PER_GROUP + Math.max(Math.floor(rest / BLOCK) - 1, 0);
  });
  if (fileBlocks.reduce((a, b) => a + b, 0) !== dataBlocks) {
    throw new Error(`the data files hold ${fileBlocks.reduce((a, b) => a + b, 0)} blocks, the package says ${dataBlocks}: ` +
                    'is a data file missing or cut short?');
  }
  // a run of the image's data bytes [d, d + n), within one group
  async function readData(d, n) {
    const out = new Uint8Array(n);
    let done = 0;
    while (done < n) {
      const block = Math.floor((d + done) / BLOCK), within = (d + done) % BLOCK;
      const file = Math.floor(block / BLOCKS_PER_FILE), inFile = block % BLOCKS_PER_FILE;
      if (file >= data.length || inFile >= fileBlocks[file]) throw new Error('a read past the end of the package');
      const group = Math.floor(inFile / BLOCKS_PER_GROUP), first = inFile % BLOCKS_PER_GROUP;
      const blocksLeft = Math.min(BLOCKS_PER_GROUP - first, fileBlocks[file] - inFile);
      const take = Math.min(n - done, blocksLeft * BLOCK - within);
      const at = BLOCK + group * GROUP_SPAN + BLOCK + first * BLOCK + within;
      out.set(await data[file].read(at, take), done);
      done += take;
    }
    return out;
  }
  // the partition's sector 0 is data block 0 (classic) or 32 sectors before it (enhanced: the descriptor first)
  let skipped = null;
  for (const s of [0, 32]) {
    const d = 32 * SECTOR - s * SECTOR;
    if (d + MAGIC.length > dataBlocks * BLOCK) continue;
    if (String.fromCharCode(...await readData(d, MAGIC.length)) === MAGIC) {
      skipped = s;
      break;
    }
  }
  if (skipped === null) throw new Error('no Xbox disc volume in the package');
  const lead = skipped * SECTOR;  // partition bytes before data block 0
  const size = lead + dataBlocks * BLOCK;
  return {
    size,
    titleId,
    name,
    kind: contentType === 0x7000 ? 'Games on Demand' : contentType === 0x4000 ? 'installed disc' : `content type ${contentType.toString(16)}`,
    async read(offset, length) {
      if (offset < lead) throw new Error('a read before the package\'s first block');
      return readData(offset - lead, length);
    },
  };
}

// The folder a player chose: [{ path, file }] (the folder's own name dropped). A GOD package there: a file of 0xB000
// bytes or more whose first word is LIVE/PIRS/CON beside a "<its name>.data" folder of DataNNNN files. Returns
// { header: File, data: [File] } or null.
export async function findGod(list) {
  const byDir = new Map();
  for (const e of list) {
    const m = /^(.*?)([^/]+)\.data\/Data(\d{4})$/i.exec(e.path);
    if (m) {
      const key = (m[1] + m[2]).toLowerCase();
      if (!byDir.has(key)) byDir.set(key, []);
      byDir.get(key)[Number(m[3])] = e.file;
    }
  }
  for (const e of list) {
    const data = byDir.get(e.path.toLowerCase());
    if (!data || e.file.size < 0x1000) continue;
    const magic = String.fromCharCode(...new Uint8Array(await e.file.slice(0, 4).arrayBuffer()));
    if (!['LIVE', 'PIRS', 'CON '].includes(magic)) continue;
    if (data.some((f) => !f) || !data.length) continue;  // a gap in DataNNNN
    return { header: e.file, data };
  }
  return null;
}

// { header: File, data: [File] } -> openGod's reader (both the page and its worker make one from the Files).
export async function godFromFiles(god) {
  const header = new Uint8Array(await god.header.slice(0, 0xb000).arrayBuffer());
  const data = god.data.map((f) => ({
    size: f.size,
    read: async (offset, length) => new Uint8Array(await f.slice(offset, offset + length).arrayBuffer()),
  }));
  return openGod(header, data);
}
