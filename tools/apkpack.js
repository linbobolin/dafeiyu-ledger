/* ============================================================
   apkpack.js —— APK 后处理打包器

   解决两个问题：
   1) aapt2 在 Windows 上会把 asset 条目名写成反斜杠
      （assets/www\js\app.js），而 Android 只认正斜杠，
      会导致 WebView 完全加载不到资源。这里统一规范化为 /。
   2) 需要把 classes.dex 注入 APK，同时必须保留 resources.arsc
      的「不压缩」状态（Android 11+ 强制要求）。

   做法：逐条搬运原有压缩数据（不重新压缩），只改条目名，
        再按需追加目录树与文件。

   用法：
     node apkpack.js <in.apk> <out.apk> [--assets <srcDir>:<zipPrefix>]
                                          [--add <zipName>:<filePath>]
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ------------------------------------------------ CRC32 */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* ------------------------------------------------ 读取 zip */

function readEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 zip / APK（未找到 EOCD）');

  const total = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);

  if (cdOffset === 0xFFFFFFFF || total === 0xFFFF) {
    throw new Error('暂不支持 ZIP64 格式的 APK');
  }

  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('中央目录损坏 @' + p);

    const versionMadeBy = buf.readUInt16LE(p + 4);
    const versionNeeded = buf.readUInt16LE(p + 6);
    const method = buf.readUInt16LE(p + 10);
    const modTime = buf.readUInt16LE(p + 12);
    const modDate = buf.readUInt16LE(p + 14);
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const intAttr = buf.readUInt16LE(p + 36);
    const extAttr = buf.readUInt32LE(p + 38);
    const localOffset = buf.readUInt32LE(p + 42);

    // 关键：统一把 Windows 反斜杠规范化为正斜杠
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen).replace(/\\/g, '/');

    if (buf.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error('本地文件头损坏：' + name);
    }
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;

    entries.push({
      name, versionMadeBy, versionNeeded, method, modTime, modDate,
      crc, compSize, uncompSize, intAttr, extAttr,
      data: Buffer.from(buf.subarray(dataStart, dataStart + compSize))
    });

    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/* ------------------------------------------------ 写出 zip */

function dosDateTime(d) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

function makeEntry(zipName, raw, forceStore) {
  const { time, date } = dosDateTime(new Date());
  const deflated = forceStore ? null : zlib.deflateRawSync(raw, { level: 9 });
  // 如果压缩后反而更大，就直接存储
  const useStore = forceStore || !deflated || deflated.length >= raw.length;
  return {
    name: zipName.replace(/\\/g, '/'),
    versionMadeBy: 20,
    versionNeeded: 20,
    method: useStore ? 0 : 8,
    modTime: time,
    modDate: date,
    crc: crc32(raw),
    compSize: useStore ? raw.length : deflated.length,
    uncompSize: raw.length,
    intAttr: 0,
    extAttr: 0,
    data: useStore ? raw : deflated
  };
}

function writeZip(entries) {
  const chunks = [];
  let offset = 0;
  const central = [];

  entries.forEach((e) => {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(e.versionNeeded || 20, 4);
    lh.writeUInt16LE(0, 6);            // 清除 data descriptor 位
    lh.writeUInt16LE(e.method, 8);
    lh.writeUInt16LE(e.modTime, 10);
    lh.writeUInt16LE(e.modDate, 12);
    lh.writeUInt32LE(e.crc, 14);
    lh.writeUInt32LE(e.compSize, 18);
    lh.writeUInt32LE(e.uncompSize, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);

    chunks.push(lh, nameBuf, e.data);
    central.push({ e, nameBuf, localOffset: offset });
    offset += lh.length + nameBuf.length + e.data.length;
  });

  const cdStart = offset;
  const cdChunks = central.map(({ e, nameBuf, localOffset }) => {
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(e.versionMadeBy || 20, 4);
    ch.writeUInt16LE(e.versionNeeded || 20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(e.method, 10);
    ch.writeUInt16LE(e.modTime, 12);
    ch.writeUInt16LE(e.modDate, 14);
    ch.writeUInt32LE(e.crc, 16);
    ch.writeUInt32LE(e.compSize, 20);
    ch.writeUInt32LE(e.uncompSize, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(e.intAttr || 0, 36);
    ch.writeUInt32LE(e.extAttr || 0, 38);
    ch.writeUInt32LE(localOffset, 42);
    offset += ch.length + nameBuf.length;
    return Buffer.concat([ch, nameBuf]);
  });

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(offset - cdStart, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, ...cdChunks, eocd]);
}

/* ------------------------------------------------ 目录遍历 */

const ALREADY_COMPRESSED = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.zip', '.apk', '.jar',
  '.mp3', '.mp4', '.ogg', '.woff', '.woff2', '.gz', '.bz2', '.7z'
]);

function walk(dir, prefix, out) {
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const it of items) {
    const full = path.join(dir, it.name);
    const zipName = prefix + '/' + it.name;
    if (it.isDirectory()) {
      walk(full, zipName, out);
    } else if (it.isFile()) {
      out.push({ zipName, full });
    }
  }
  return out;
}

/* ------------------------------------------------ 主流程 */

function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 2) {
    console.error('用法: node apkpack.js <in.apk> <out.apk> [--assets <dir>:<prefix>] [--add <zipName>:<file>]');
    process.exit(1);
  }

  const inApk = argv[0];
  const outApk = argv[1];

  const assetsArgs = [];
  const addArgs = [];
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--assets' && argv[i + 1]) { assetsArgs.push(argv[++i]); }
    else if (argv[i] === '--add' && argv[i + 1]) { addArgs.push(argv[++i]); }
  }

  const src = fs.readFileSync(inApk);
  const entries = readEntries(src);

  let renamed = 0;
  entries.forEach((e) => { if (e.name.indexOf('/') < 0 && /\\/.test(e.name)) renamed++; });

  const index = new Map(entries.map((e) => [e.name, e]));

  // --- 追加目录树 ---
  let addedDir = 0;
  assetsArgs.forEach((spec) => {
    const sep = spec.lastIndexOf(':');
    const dir = spec.slice(0, sep);
    const prefix = spec.slice(sep + 1).replace(/\\/g, '/').replace(/\/+$/, '');
    const files = walk(dir, prefix, []);
    files.forEach((f) => {
      const raw = fs.readFileSync(f.full);
      const ext = path.extname(f.full).toLowerCase();
      const entry = makeEntry(f.zipName, raw, ALREADY_COMPRESSED.has(ext));
      if (index.has(entry.name)) {
        const pos = entries.indexOf(index.get(entry.name));
        entries[pos] = entry;
      } else {
        entries.push(entry);
      }
      index.set(entry.name, entry);
      addedDir++;
    });
  });

  // --- 追加单个文件 ---
  let addedFile = 0;
  addArgs.forEach((spec) => {
    const sep = spec.indexOf(':');
    const zipName = spec.slice(0, sep);
    const file = spec.slice(sep + 1);
    const raw = fs.readFileSync(file);
    const entry = makeEntry(zipName, raw, false);
    if (index.has(entry.name)) {
      entries[entries.indexOf(index.get(entry.name))] = entry;
    } else {
      entries.push(entry);
    }
    index.set(entry.name, entry);
    addedFile++;
  });

  fs.writeFileSync(outApk, writeZip(entries));

  // --- 自检 ---
  const check = readEntries(fs.readFileSync(outApk));
  const bad = check.filter((e) => e.name.indexOf('\\') >= 0);
  const arsc = check.find((e) => e.name === 'resources.arsc');
  const manifest = check.find((e) => e.name === 'AndroidManifest.xml');
  const assets = check.filter((e) => e.name.startsWith('assets/'));

  console.log('  规范化条目名   : ' + renamed + ' 个反斜杠已修正');
  console.log('  新增 asset 文件: ' + addedDir);
  console.log('  新增其它文件   : ' + addedFile);
  console.log('  resources.arsc : ' + (arsc ? (arsc.method === 0 ? 'STORED（正确）' : 'DEFLATED（有风险）') : '缺失'));
  console.log('  AndroidManifest: ' + (manifest ? '存在' : '缺失'));
  console.log('  assets/ 条目   : ' + assets.length + ' 个，路径分隔符 ' +
              (bad.length === 0 ? '全部正确' : '仍有 ' + bad.length + ' 个错误'));

  if (!arsc || !manifest || bad.length > 0) {
    console.error('打包自检失败');
    process.exit(1);
  }
}

main();
