/* ============================================================
   轻量 Canvas 图表库（环形图 / 柱状图 / 折线图）
   纯手写，无任何第三方依赖，适配高 DPI 与移动端。
   ============================================================ */
(function (global) {
  'use strict';

  function dpr() { return Math.min(global.devicePixelRatio || 1, 3); }

  function setup(canvas, cssHeight) {
    var w = canvas.clientWidth || (canvas.parentNode && canvas.parentNode.clientWidth) || 320;
    var h = cssHeight;
    var ratio = dpr();
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
    canvas.style.height = h + 'px';
    canvas.style.width = '100%';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  function easeOutCubic(p) { return 1 - Math.pow(1 - p, 3); }

  var animId = 0;
  function animate(duration, frame) {
    // 截图 / 自动化测试时可设置 window.__NO_ANIM = true，直接跳到终态
    if (global.__NO_ANIM) { frame(1); return; }
    var myId = ++animId;
    var t0 = null;
    function step(t) {
      if (myId !== animId) return; // 被新的动画取代
      if (t0 === null) t0 = t;
      var p = Math.min(1, (t - t0) / duration);
      frame(easeOutCubic(p));
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function cssVar(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }

  function fmtMoney(v) {
    if (Math.abs(v) >= 10000) return (v / 10000).toFixed(1) + '万';
    return (Math.round(v * 100) / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  }

  /** 坐标轴专用：更短，避免被左侧留白裁掉 */
  function axisLabel(v) {
    var n = Math.abs(v);
    if (n === 0) return '0';
    if (n >= 10000) return (v / 10000).toFixed(1) + '万';
    if (n >= 100) return String(Math.round(v));
    return fmtMoney(v);
  }

  /** 把最大值向上取整到「好读」的刻度，同时尽量贴合数据高度 */
  function niceMax(v) {
    if (v <= 0) return 10;
    var exp = Math.floor(Math.log10(v));
    var base = Math.pow(10, exp);
    var n = v / base;
    var step;
    if (n <= 1) step = 1;
    else if (n <= 1.2) step = 1.2;
    else if (n <= 1.5) step = 1.5;
    else if (n <= 2) step = 2;
    else if (n <= 2.5) step = 2.5;
    else if (n <= 3) step = 3;
    else if (n <= 4) step = 4;
    else if (n <= 5) step = 5;
    else if (n <= 6) step = 6;
    else if (n <= 8) step = 8;
    else step = 10;
    return step * base;
  }

  /* ------------------------------------------------------ 环形图 */

  function donut(canvas, items, opts) {
    opts = opts || {};
    var H = opts.height || 216;
    var s = setup(canvas, H);
    var ctx = s.ctx, w = s.w, h = s.h;

    var data = (items || []).filter(function (i) { return i.value > 0; });
    var total = data.reduce(function (a, b) { return a + b.value; }, 0);

    var cx = w / 2, cy = h / 2;
    var R = Math.min(w, h) / 2 - 10;
    var r = R * 0.615;

    var text = cssVar('--text', '#E9EDF4');
    var muted = cssVar('--muted', '#7F8A9C');

    if (!total) {
      ctx.fillStyle = muted;
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(opts.emptyText || '该时间段没有支出', cx, cy);
      return;
    }

    var gap = data.length > 1 ? 0.016 : 0;

    animate(620, function (p) {
      ctx.clearRect(0, 0, w, h);
      var start = -Math.PI / 2;
      data.forEach(function (it) {
        var span = (it.value / total) * Math.PI * 2 * p;
        var a0 = start + gap / 2;
        var a1 = Math.max(a0 + 0.0005, start + span - gap / 2);
        ctx.beginPath();
        ctx.arc(cx, cy, R, a0, a1);
        ctx.arc(cx, cy, r, a1, a0, true);
        ctx.closePath();
        ctx.fillStyle = it.color;
        ctx.fill();
        start += span;
      });

      // 中心文字
      var shown = total * p;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = muted;
      ctx.font = '11.5px sans-serif';
      ctx.fillText(opts.centerLabel || '合计支出', cx, cy - 10);
      ctx.fillStyle = text;
      ctx.font = '700 21px sans-serif';
      ctx.fillText('¥' + fmtMoney(shown), cx, cy + 14);
    });
  }

  /* ------------------------------------------------------ 柱状图 */

  function bars(canvas, items, opts) {
    opts = opts || {};
    var H = opts.height || 232;
    var s = setup(canvas, H);
    var ctx = s.ctx, w = s.w, h = s.h;

    var data = items || [];
    var text = cssVar('--text', '#E9EDF4');
    var muted = cssVar('--muted', '#7F8A9C');
    var line = cssVar('--line', '#2B3341');

    if (!data.length) {
      ctx.fillStyle = muted;
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(opts.emptyText || '暂无数据', w / 2, h / 2);
      return;
    }

    var padL = 42, padR = 10, padT = 22, padB = 40;
    var plotW = Math.max(10, w - padL - padR);
    var plotH = Math.max(10, h - padT - padB);

    var maxRaw = data.reduce(function (a, b) { return Math.max(a, b.value); }, 0);
    var top = niceMax(maxRaw);

    // Y 轴网格
    var ticks = 4;
    ctx.font = '10.5px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (var i = 0; i <= ticks; i++) {
      var y = padT + plotH - (plotH * i / ticks);
      ctx.strokeStyle = line;
      ctx.globalAlpha = i === 0 ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(padL, Math.round(y) + 0.5);
      ctx.lineTo(padL + plotW, Math.round(y) + 0.5);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = muted;
      ctx.fillText(axisLabel(top * i / ticks), padL - 7, y);
    }

    var n = data.length;
    var slot = plotW / n;
    var bw = Math.max(4, Math.min(slot * 0.62, 34));

    var rotate = n > 6 || (opts.rotateLabels === true);
    var labelStep = n > 16 ? Math.ceil(n / 12) : 1;

    animate(640, function (p) {
      // 清空绘图区（保留网格）
      ctx.clearRect(0, 0, w, h);
      ctx.font = '10.5px sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (var k = 0; k <= ticks; k++) {
        var gy = padT + plotH - (plotH * k / ticks);
        ctx.strokeStyle = line;
        ctx.globalAlpha = k === 0 ? 1 : 0.5;
        ctx.beginPath();
        ctx.moveTo(padL, Math.round(gy) + 0.5);
        ctx.lineTo(padL + plotW, Math.round(gy) + 0.5);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = muted;
        ctx.fillText(axisLabel(top * k / ticks), padL - 7, gy);
      }

      data.forEach(function (it, idx) {
        var bh = top <= 0 ? 0 : (it.value / top) * plotH * p;
        var x = padL + slot * idx + (slot - bw) / 2;
        var y = padT + plotH - bh;
        var color = it.color || opts.color || cssVar('--accent', '#17BE8B');

        var grad = ctx.createLinearGradient(0, y, 0, padT + plotH);
        grad.addColorStop(0, color);
        grad.addColorStop(1, hexA(color, 0.45));
        ctx.fillStyle = grad;

        var rad = Math.min(5, bw / 2, Math.max(1, bh / 2));
        roundRectTop(ctx, x, y, bw, Math.max(bh, 0.6), rad);
        ctx.fill();

        // X 标签
        if (idx % labelStep === 0) {
          ctx.fillStyle = muted;
          if (rotate) {
            ctx.save();
            ctx.translate(padL + slot * idx + slot / 2, padT + plotH + 9);
            ctx.rotate(-Math.PI / 4.2);
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(shortLabel(it.label), 0, 0);
            ctx.restore();
          } else {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(shortLabel(it.label), padL + slot * idx + slot / 2, padT + plotH + 8);
          }
        }

        // 顶部数值（柱子够宽才显示）
        if (opts.showValues !== false && bw >= 16 && it.value > 0 && p > 0.98) {
          ctx.fillStyle = text;
          ctx.font = '600 10.5px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(fmtMoney(it.value), x + bw / 2, y - 4);
          ctx.font = '10.5px sans-serif';
        }
      });
    });
  }

  /* ------------------------------------------------------ 折线图 */

  function line(canvas, points, opts) {
    opts = opts || {};
    var H = opts.height || 200;
    var s = setup(canvas, H);
    var ctx = s.ctx, w = s.w, h = s.h;

    var data = points || [];
    var text = cssVar('--text', '#E9EDF4');
    var muted = cssVar('--muted', '#7F8A9C');
    var lineCol = cssVar('--line', '#2B3341');
    var accent = opts.color || cssVar('--accent', '#17BE8B');

    if (data.length < 2) {
      ctx.fillStyle = muted;
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('数据点不足，无法绘制趋势', w / 2, h / 2);
      return;
    }

    var padL = 42, padR = 12, padT = 20, padB = 32;
    var plotW = w - padL - padR, plotH = h - padT - padB;
    var maxRaw = data.reduce(function (a, b) { return Math.max(a, b.value); }, 0);
    var top = niceMax(maxRaw);

    animate(600, function (p) {
      ctx.clearRect(0, 0, w, h);
      ctx.font = '10.5px sans-serif';
      ctx.strokeStyle = lineCol;
      ctx.fillStyle = muted;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (var i = 0; i <= 3; i++) {
        var y = padT + plotH - (plotH * i / 3);
        ctx.globalAlpha = i === 0 ? 1 : 0.5;
        ctx.beginPath();
        ctx.moveTo(padL, Math.round(y) + 0.5);
        ctx.lineTo(padL + plotW, Math.round(y) + 0.5);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillText(axisLabel(top * i / 3), padL - 7, y);
      }

      var n = data.length;
      var stepX = plotW / (n - 1);
      var pts = data.map(function (d, i) {
        return {
          x: padL + stepX * i,
          y: padT + plotH - (top <= 0 ? 0 : (d.value / top) * plotH * p)
        };
      });

      // 面积
      var g = ctx.createLinearGradient(0, padT, 0, padT + plotH);
      g.addColorStop(0, hexA(accent, 0.34));
      g.addColorStop(1, hexA(accent, 0.02));
      ctx.beginPath();
      ctx.moveTo(pts[0].x, padT + plotH);
      pts.forEach(function (pt) { ctx.lineTo(pt.x, pt.y); });
      ctx.lineTo(pts[n - 1].x, padT + plotH);
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();

      // 折线
      ctx.beginPath();
      pts.forEach(function (pt, i) {
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2.2;
      ctx.lineJoin = 'round';
      ctx.stroke();

      // 点
      if (n <= 32) {
        pts.forEach(function (pt) {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 2.6, 0, Math.PI * 2);
          ctx.fillStyle = accent;
          ctx.fill();
        });
      }

      // X 标签
      var labelStep = n > 10 ? Math.ceil(n / 6) : 1;
      ctx.fillStyle = muted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      data.forEach(function (d, i) {
        if (i % labelStep === 0 || i === n - 1) {
          ctx.fillText(shortLabel(d.label), pts[i].x, padT + plotH + 8);
        }
      });
    });
  }

  /* ------------------------------------------------------ 辅助 */

  function roundRectTop(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h);
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
  }

  function shortLabel(s) {
    s = String(s == null ? '' : s);
    return s.length > 7 ? s.slice(0, 6) + '…' : s;
  }

  function hexA(hex, alpha) {
    hex = String(hex || '#17BE8B').trim();
    if (hex.charAt(0) !== '#') return hex;
    var v = hex.slice(1);
    if (v.length === 3) v = v[0] + v[0] + v[1] + v[1] + v[2] + v[2];
    var num = parseInt(v, 16);
    var r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  global.Charts = {
    donut: donut,
    bars: bars,
    line: line,
    fmtMoney: fmtMoney,
    hexA: hexA
  };
})(window);
