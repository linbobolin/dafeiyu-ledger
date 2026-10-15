/* ============================================================
   生成「经典」启动图标 (PNG) —— 绿色柱状图样式

   这是备选图标之一。默认图标（Q 版鲸鱼娘）以及其它表情包变体
   由 tools/whale_assets.py 生成，两者互不覆盖。

   无第三方依赖：用 Node 内置 zlib 手写 PNG 编码器，
   3 倍超采样抗锯齿，输出各密度 mipmap。

   用法： node tools/make-icons.js <项目android目录>
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ------------------------------------------------ PNG 编码 */

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
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // no interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ------------------------------------------------ 绘制 */

const hex = (h) => [
  parseInt(h.slice(1, 3), 16) / 255,
  parseInt(h.slice(3, 5), 16) / 255,
  parseInt(h.slice(5, 7), 16) / 255
];

const COL_A = hex('#17BE8B');
const COL_B = hex('#0A5C42');

function insideRoundRect(u, v, x, y, w, h, r) {
  if (u < x || u > x + w || v < y || v > y + h) return false;
  const cx = Math.min(Math.max(u, x + r), x + w - r);
  const cy = Math.min(Math.max(v, y + r), y + h - r);
  if (u === cx && v === cy) return true;
  const dx = u - cx, dy = v - cy;
  // 只在角落区域需要考虑圆角
  if ((u < x + r || u > x + w - r) && (v < y + r || v > y + h - r)) {
    return dx * dx + dy * dy <= r * r;
  }
  return true;
}

const BARS = [
  { x: 0.260, y: 0.600, w: 0.130, h: 0.150 },
  { x: 0.435, y: 0.470, w: 0.130, h: 0.280 },
  { x: 0.610, y: 0.320, w: 0.130, h: 0.430 }
];
const BASE = { x: 0.220, y: 0.760, w: 0.560, h: 0.045 };

/**
 * @param {number} size   输出像素尺寸
 * @param {boolean} round 是否圆形（round icon）
 */
function draw(size, round) {
  const SS = 3;                 // 超采样倍数
  const W = size * SS;
  // 预乘 alpha 累加缓冲
  const acc = new Float32Array(W * W * 4);

  for (let py = 0; py < W; py++) {
    for (let px = 0; px < W; px++) {
      const u = (px + 0.5) / W;
      const v = (py + 0.5) / W;

      let r = 0, g = 0, b = 0, a = 0;

      // --- 背景 ---
      let bgHit;
      if (round) {
        const dx = u - 0.5, dy = v - 0.5;
        bgHit = (dx * dx + dy * dy) <= 0.25;
      } else {
        bgHit = insideRoundRect(u, v, 0, 0, 1, 1, 0.22);
      }
      if (bgHit) {
        const t = Math.min(1, Math.max(0, (u + v) / 2));
        r = COL_A[0] + (COL_B[0] - COL_A[0]) * t;
        g = COL_A[1] + (COL_B[1] - COL_A[1]) * t;
        b = COL_A[2] + (COL_B[2] - COL_A[2]) * t;
        a = 1;
      }

      // --- 柱子（白色） ---
      let bar = false;
      for (const s of BARS) {
        if (insideRoundRect(u, v, s.x, s.y, s.w, s.h, 0.022)) { bar = true; break; }
      }
      if (!bar && insideRoundRect(u, v, BASE.x, BASE.y, BASE.w, BASE.h, 0.02)) bar = true;

      if (bar) {
        const ca = 1;
        // 覆盖合成到背景之上（白色）
        r = 1; g = 1; b = 1; a = 1;
      }

      const idx = (py * W + px) * 4;
      acc[idx] = r * a;
      acc[idx + 1] = g * a;
      acc[idx + 2] = b * a;
      acc[idx + 3] = a;
    }
  }

  // 下采样
  const out = Buffer.alloc(size * size * 4);
  const n = SS * SS;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const idx = (((y * SS + sy) * W) + (x * SS + sx)) * 4;
          r += acc[idx];
          g += acc[idx + 1];
          b += acc[idx + 2];
          a += acc[idx + 3];
        }
      }
      r /= n; g /= n; b /= n; a /= n;
      const o = (y * size + x) * 4;
      if (a > 0.0001) {
        out[o] = Math.round(Math.min(1, r / a) * 255);
        out[o + 1] = Math.round(Math.min(1, g / a) * 255);
        out[o + 2] = Math.round(Math.min(1, b / a) * 255);
      } else {
        out[o] = out[o + 1] = out[o + 2] = 0;
      }
      out[o + 3] = Math.round(Math.min(1, a) * 255);
    }
  }

  return encodePng(size, size, out);
}

/* ------------------------------------------------ 主流程 */

const DENSITIES = [
  ['mipmap-mdpi', 48],
  ['mipmap-hdpi', 72],
  ['mipmap-xhdpi', 96],
  ['mipmap-xxhdpi', 144],
  ['mipmap-xxxhdpi', 192]
];

function main() {
  const androidDir = process.argv[2];
  if (!androidDir) {
    console.error('用法: node tools/make-icons.js <android目录>');
    process.exit(1);
  }
  const resDir = path.join(androidDir, 'res');

  DENSITIES.forEach(([dir, size]) => {
    const target = path.join(resDir, dir);
    fs.mkdirSync(target, { recursive: true });

    fs.writeFileSync(path.join(target, 'ic_launcher_classic.png'), draw(size, false));
    fs.writeFileSync(path.join(target, 'ic_launcher_classic_round.png'), draw(size, true));
    console.log(`  ${dir}/ic_launcher_classic.png  (${size}x${size})`);
  });

  console.log('经典图标生成完成。');
}

main();
