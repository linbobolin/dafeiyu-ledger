/* ============================================================
   生成一张演示用的目标配图（PNG），用于截图验证目标卡片配图渲染。
   用法： node test/make-demo-image.js <输出路径>
   ============================================================ */
'use strict';

const fs = require('fs');
const zlib = require('zlib');

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
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const W = 1000, H = 640;

function mix(a, b, t) { return a + (b - a) * t; }

const raw = Buffer.alloc((W * 4 + 1) * H);

// 三处柔和光斑，营造「目标 / 远景」的氛围
const BLOBS = [
  { x: 0.24, y: 0.30, r: 0.34, c: [255, 214, 130], s: 0.85 },
  { x: 0.78, y: 0.22, r: 0.30, c: [120, 230, 200], s: 0.62 },
  { x: 0.60, y: 0.82, r: 0.42, c: [40, 120, 120], s: 0.55 }
];

for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0;
  for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H;

    // 基础渐变：深夜蓝 -> 青绿
    let r = mix(14, 22, v);
    let g = mix(24, 92, v);
    let b = mix(42, 78, v);

    for (const bl of BLOBS) {
      const dx = (u - bl.x) * (W / H), dy = v - bl.y;
      const d = Math.sqrt(dx * dx + dy * dy) / bl.r;
      if (d < 1) {
        const k = Math.pow(1 - d, 2.4) * bl.s;
        r = mix(r, bl.c[0], k);
        g = mix(g, bl.c[1], k);
        b = mix(b, bl.c[2], k);
      }
    }

    // 底部加一点暗角，让卡片上的文字更清楚
    const vig = Math.pow(v, 3) * 0.45;
    r = mix(r, 6, vig); g = mix(g, 18, vig); b = mix(b, 20, vig);

    // 细颗粒，避免大面积渐变出现色带
    const n = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
    const grain = (n - Math.floor(n) - 0.5) * 4;

    const o = y * (W * 4 + 1) + 1 + x * 4;
    raw[o] = Math.max(0, Math.min(255, Math.round(r + grain)));
    raw[o + 1] = Math.max(0, Math.min(255, Math.round(g + grain)));
    raw[o + 2] = Math.max(0, Math.min(255, Math.round(b + grain)));
    raw[o + 3] = 255;
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

const out = process.argv[2] || 'demo.png';
fs.writeFileSync(out, png);
console.log('已生成 ' + out + '  (' + W + 'x' + H + ', ' + png.length + ' 字节)');
