/**
 * Packs dist/ into is-it-real-<version>.zip, the file the Chrome Web Store takes. A small zip
 * writer on Node's own zlib, so packaging needs no extra tool. Run after `node build.mjs`.
 */
import { Buffer } from 'node:buffer';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const { version } = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'));

async function filesIn(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesIn(path)));
    else out.push(path);
  }
  return out;
}

const parts = [];
const directory = [];
let offset = 0;
// A fixed date, so the same source gives the same zip.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
for (const path of (await filesIn(dist)).sort()) {
  const name = Buffer.from(relative(dist, path).split('\\').join('/'));
  const data = await readFile(path);
  const packed = deflateRawSync(data, { level: 9 });
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6); // names are UTF-8
  header.writeUInt16LE(8, 8); // deflate
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(crc32(data), 14);
  header.writeUInt32LE(packed.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  header.copy(central, 8, 6, 30); // flags to name length are the same fields
  central.writeUInt32LE(offset, 42);
  parts.push(header, name, packed);
  directory.push(central, name);
  offset += header.length + name.length + packed.length;
}
const directorySize = directory.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(directory.length / 2, 8);
end.writeUInt16LE(directory.length / 2, 10);
end.writeUInt32LE(directorySize, 12);
end.writeUInt32LE(offset, 16);
const target = join(here, `is-it-real-${version}.zip`);
await writeFile(target, Buffer.concat([...parts, ...directory, end]));
console.log(
  `${target} (${directory.length / 2} files, ${Math.round((offset + directorySize) / 1024)} KB)`,
);
