/* ============================================================
   用 jsdom 真实加载应用并执行断言。
   用法： node test/run.js
   ============================================================ */
'use strict';

const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HARNESS = path.join(__dirname, 'harness.html');

/* jsdom 没有 canvas 实现，这里提供一个记录调用的 2D 上下文替身，
   让我们能验证图表的绘制代码路径确实跑通且不抛异常。 */
function makeCtx() {
  const noop = () => {};
  const grad = { addColorStop: noop };
  return {
    canvas: null,
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineJoin: 'miter',
    font: '10px sans-serif', textAlign: 'left', textBaseline: 'alphabetic',
    globalAlpha: 1,
    setTransform: noop, resetTransform: noop, save: noop, restore: noop,
    clearRect: noop, fillRect: noop, strokeRect: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    arc: noop, arcTo: noop, ellipse: noop, rect: noop,
    quadraticCurveTo: noop, bezierCurveTo: noop,
    fill: noop, stroke: noop, clip: noop,
    fillText: noop, strokeText: noop, measureText: () => ({ width: 10 }),
    translate: noop, rotate: noop, scale: noop,
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    createPattern: () => null,
    drawImage: noop,
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: noop
  };
}

const loadErrors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => loadErrors.push('jsdomError: ' + (e && e.message ? e.message : e)));
vc.on('error', (...a) => loadErrors.push('console.error: ' + a.join(' ')));
vc.on('warn', () => {});
vc.on('info', () => {});
vc.on('log', () => {});
vc.on('debug', () => {});

JSDOM.fromFile(HARNESS, {
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    window.HTMLCanvasElement.prototype.getContext = function () { return makeCtx(); };
    window.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:image/png;base64,'; };
  }
}).then((dom) => {
  setTimeout(() => {
    const doc = dom.window.document;
    const report = doc.getElementById('report');

    if (!report) {
      console.log('!! 没有生成测试报告（脚本可能加载失败）');
      console.log('title =', doc.title);
      console.log('body  =', doc.body.innerHTML.slice(0, 800));
      loadErrors.slice(0, 20).forEach((e) => console.log('  ' + e));
      process.exit(1);
    }

    console.log(report.textContent.replace(/\n{3,}/g, '\n\n'));

    if (loadErrors.length) {
      console.log('\n--- 加载/控制台错误 ---');
      loadErrors.slice(0, 20).forEach((e) => console.log('  ' + e));
    }

    const m = /pass=(\d+) fail=(\d+)/.exec(doc.title);
    if (!m) { console.log('!! 无法解析结果'); process.exit(1); }
    const fail = Number(m[2]);
    console.log('\n结果: 通过 ' + m[1] + ' / 失败 ' + fail);
    process.exit(fail === 0 && loadErrors.length === 0 ? 0 : 1);
  }, 4000);
}).catch((e) => {
  console.error('启动 jsdom 失败:', e);
  process.exit(1);
});
