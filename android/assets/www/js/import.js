/* ============================================================
   账单导入
   两条路径：
     1) 截图识别 —— 把微信 / 支付宝账单截图（含长图）交给视觉大模型，
        让它按固定 JSON 结构吐出交易列表
     2) 文本解析 —— 粘贴支付宝 / 微信导出的 CSV 或明细文本，本地正则解析，
        不需要任何 API

   无论哪条路径，导入前都会展示预览让用户勾选确认。
   ============================================================ */
(function (global) {
  'use strict';

  /* ------------------------------------------------------ 图片处理 */

  /**
   * 把选中的图片压缩成 JPEG dataURL（长图也保留足够清晰度）
   */
  function compressImageFile(file, maxDim, quality, cb) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.width, h = img.height;
          var scale = Math.min(1, maxDim / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale));
          var ch = Math.max(1, Math.round(h * scale));
          var c = document.createElement('canvas');
          c.width = cw;
          c.height = ch;
          var ctx = c.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, cw, ch);
          ctx.drawImage(img, 0, 0, cw, ch);
          cb(c.toDataURL('image/jpeg', quality), { width: cw, height: ch });
        } catch (err) {
          cb('', null);
        }
      };
      img.onerror = function () { cb('', null); };
      img.src = e.target.result;
    };
    reader.onerror = function () { cb('', null); };
    reader.readAsDataURL(file);
  }

  /* ------------------------------------------------------ CSV 工具 */

  function splitCsv(line) {
    var out = [];
    var cur = '';
    var inQuote = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if ((ch === ',' || ch === '\t') && !inQuote) {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  function cleanCell(s) {
    return String(s == null ? '' : s)
      .replace(/^\uFEFF/, '')
      .replace(/^["'\s]+|["'\s]+$/g, '')
      .trim();
  }

  function isHeaderRow(cells) {
    var joined = cells.join('|');
    var hasTime = /交易时间|交易创建时间|付款时间|记账时间/.test(joined);
    var hasMoney = /金额/.test(joined);
    var hasIO = /收\/?支|收支|收付/.test(joined);
    return hasTime && (hasMoney || hasIO);
  }

  function findCol(header, names) {
    for (var i = 0; i < header.length; i++) {
      for (var k = 0; k < names.length; k++) {
        if (header[i].indexOf(names[k]) >= 0) return i;
      }
    }
    return -1;
  }

  var DATE_RE = /(\d{4})[-\/年.](\d{1,2})[-\/月.](\d{1,2})/;
  var TIME_RE = /(\d{1,2}):(\d{2})/;

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function parseDateCell(s) {
    var m = DATE_RE.exec(String(s || ''));
    if (!m) return null;
    var t = TIME_RE.exec(String(s || ''));
    return {
      date: m[1] + '-' + pad2(parseInt(m[2], 10)) + '-' + pad2(parseInt(m[3], 10)),
      time: t ? (pad2(parseInt(t[1], 10)) + ':' + t[2]) : '00:00'
    };
  }

  /** 从金额单元格里取出数值与正负号 */
  function parseAmountCell(s) {
    var raw = String(s == null ? '' : s);
    var neg = /-|−/.test(raw);
    var plus = /\+/.test(raw);
    // 先把货币符号、千分位逗号、空白全部去掉，再取数字，
    // 避免 \d{1,3} 这种写法把 8000.00 截成 800
    var cleaned = raw.replace(/[¥￥,\s]/g, '');
    var m = /(\d+(?:\.\d{1,2})?)/.exec(cleaned);
    if (!m) return null;
    var v = parseFloat(m[1]);
    if (isNaN(v)) return null;
    return { value: Math.abs(v), sign: neg ? -1 : (plus ? 1 : 0) };
  }

  function ioToType(io, amountSign) {
    var s = String(io || '');
    if (/不计收支|中性交易/.test(s)) return null;
    if (/收入|收款|退款|转入/.test(s)) return 'income';
    if (/支出|付款|转出/.test(s)) return 'expense';
    if (amountSign === 1) return 'income';
    return 'expense';
  }

  /* ------------------------------------------------------ 文本解析 */

  /**
   * 解析支付宝 / 微信导出的账单文本或 CSV。
   * @returns {Array} [{date,time,amount,type,content,note,category}]
   */
  function parseText(text) {
    var raw = String(text || '');
    if (!raw.trim()) return [];
    var lines = raw.split(/\r?\n/);

    /* --- 优先按 CSV 表头解析 --- */
    var headerIdx = -1;
    var header = null;
    for (var i = 0; i < lines.length; i++) {
      var cells = splitCsv(lines[i]);
      if (cells.length >= 4 && isHeaderRow(cells.map(cleanCell))) {
        header = cells.map(cleanCell);
        headerIdx = i;
        break;
      }
    }

    var out = [];
    if (header) {
      var idx = {
        time: findCol(header, ['交易时间', '交易创建时间', '付款时间', '记账时间', '时间']),
        peer: findCol(header, ['交易对方', '交易方', '对方', '商户名称', '商户']),
        item: findCol(header, ['商品名称', '商品说明', '商品', '摘要', '备注']),
        amount: findCol(header, ['金额']),
        io: findCol(header, ['收/支', '收支', '收付']),
        status: findCol(header, ['当前状态', '交易状态', '资金状态'])
      };
      if (idx.amount < 0) idx.amount = findCol(header, ['金额(元)', '金额（元）']);

      for (var j = headerIdx + 1; j < lines.length; j++) {
        var cells2 = splitCsv(lines[j]).map(cleanCell);
        if (cells2.length < 3) continue;
        if (/^-+$/.test(cells2[0] || '')) continue;
        if (/^\-{5,}/.test(lines[j])) continue;

        var when = idx.time >= 0 ? parseDateCell(cells2[idx.time]) : parseDateCell(lines[j]);
        if (!when) continue;

        var amt = idx.amount >= 0 ? parseAmountCell(cells2[idx.amount]) : null;
        if (!amt) {
          // 金额列找不到时，在整行里找一个带小数的数字
          var loose = /[¥￥]\s*(\d+(?:\.\d{1,2})?)/.exec(lines[j]);
          if (loose) amt = { value: parseFloat(loose[1]), sign: 0 };
        }
        if (!amt || !(amt.value > 0)) continue;

        var io = idx.io >= 0 ? cells2[idx.io] : '';
        var type = ioToType(io, amt.sign);
        if (!type) continue;

        // 状态为「已退款 / 交易关闭」的条目跳过
        var status = idx.status >= 0 ? cells2[idx.status] : '';
        if (/已退款|交易关闭|已关闭/.test(status)) continue;

        var peer = idx.peer >= 0 ? cells2[idx.peer] : '';
        var item = idx.item >= 0 ? cells2[idx.item] : '';
        var content = [item, peer].filter(Boolean).join(' ').trim() ||
                      (type === 'income' ? '账单进账' : '账单支出');

        out.push({
          date: when.date,
          time: when.time,
          amount: Math.round(amt.value * 100) / 100,
          type: type,
          content: content,
          note: peer && item ? peer : ''
        });
      }
    }

    /* --- 兜底：逐行宽松解析 --- */
    if (!out.length) {
      lines.forEach(function (line) {
        var text2 = cleanCell(line);
        if (!text2 || text2.length < 6) return;
        var when = parseDateCell(text2);
        if (!when) return;

        // 找金额：优先带 ¥ 的，其次带两位小数的
        var amt = null;
        var m1 = /[¥￥]\s*(\d[\d,]*(?:\.\d{1,2})?)/.exec(text2);
        if (m1) {
          amt = { value: parseFloat(m1[1].replace(/,/g, '')), sign: 0 };
        } else {
          var m2 = /(\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2})/.exec(text2);
          if (m2) amt = { value: parseFloat(m2[1].replace(/,/g, '')), sign: 0 };
        }
        if (!amt || !(amt.value > 0)) return;

        var type = ioToType(text2, /\+/.test(text2) ? 1 : 0);
        if (!type) return;

        // 内容：去掉日期时间与金额后的剩余文字
        var content = text2
          .replace(DATE_RE, '')
          .replace(TIME_RE, '')
          .replace(/[¥￥]?\s*\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?/g, '')
          .replace(/[,\t|]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (!content) content = type === 'income' ? '账单进账' : '账单支出';

        out.push({
          date: when.date,
          time: when.time,
          amount: Math.round(amt.value * 100) / 100,
          type: type,
          content: content.slice(0, 60),
          note: ''
        });
      });
    }

    // 去重（同日期+时间+金额+内容）
    var seen = {};
    return out.filter(function (r) {
      var k = [r.date, r.time, r.amount, r.type, r.content].join('|');
      if (seen[k]) return false;
      seen[k] = 1;
      return true;
    });
  }

  /* ------------------------------------------------------ 截图识别 */

  function categoryNames() {
    var expense = global.Classify.list('expense').map(function (c) { return c.name; });
    var income = global.Classify.list('income').map(function (c) { return c.name; });
    var custom = global.Store.customCategories().map(function (c) { return c.name; });
    var all = expense.concat(custom, income);
    var seen = {};
    return all.filter(function (n) { if (seen[n]) return false; seen[n] = 1; return true; });
  }

  function todayStr() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function buildVisionMessages(images) {
    var today = todayStr();
    var thisYear = new Date().getFullYear();
    var prompt = [
      '请识别这些图片里的微信支付 / 支付宝账单记录。',
      '今天的日期是 ' + today + '（' + thisYear + ' 年）。',
      '',
      '只输出一个 JSON 对象，前后不要加任何解释或代码块标记，格式如下：',
      '{"records":[{"date":"' + today + '","time":"12:30","amount":25.00,"type":"expense",' +
        '"content":"某某餐厅 午餐","category":"餐饮食物","note":"","yearKnown":true}]}',
      '',
      '要求：',
      '1. type 只能是 "expense"（支出）或 "income"（收入）。',
      '2. amount 一律为正数，不要带货币符号。',
      '3. date 使用 YYYY-MM-DD。**如果账单上只写了月和日、没有写年份，' +
        '必须使用今年的年份 ' + thisYear + '，并把 yearKnown 设为 false**；' +
        '连月日都没有时才填今天 ' + today + '。绝对不要填其它年份。',
      '4. yearKnown 表示「账单上是否明确写了年份」：写了填 true，没写填 false。' +
        '这个字段非常重要，请如实填写。',
      '5. time 使用 HH:mm，识别不到就填 "00:00"。',
      '6. content 写清楚商家或商品，尽量简短但可辨认。',
      '7. category 只能从下面这些里选一个最接近的：' + categoryNames().join('、'),
      '8. 长图里可能有很多条记录，必须全部提取，不要遗漏、不要臆造。',
      '9. 跳过「交易关闭」「已退款」「不计收支」这类记录。',
      '10. 如果一张图里没有任何有效记录，返回 {"records":[]}。'
    ].join('\n');

    var content = [{ type: 'text', text: prompt }];
    images.forEach(function (dataUrl) {
      content.push({ type: 'image_url', image_url: { url: dataUrl } });
    });

    return [
      { role: 'system', content: '你是严谨的账单识别助手，只输出合法 JSON，不输出任何多余文字。' },
      { role: 'user', content: content }
    ];
  }

  /**
   * 把明显不合理的年份拉回「离今天最近的那一年」。
   *
   * 起因：模型很容易把示例里的年份照抄下来（比如示例写了 2025，
   * 账单上只有「10-15」，它就输出 2025-10-15）。
   *
   * 两种触发方式：
   *   force=true  —— 模型明确说了「账单上没写年份」（yearKnown=false），直接纠正；
   *   force=false —— 模型没说，那就只在偏差落在 120~400 天时才动手，
   *                  这个区间是「缺年份」时最可能出现的偏差，不会误伤真实的历史账单。
   */
  function nearestYearDate(dateStr2, force) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr2 || ''));
    if (!m) return '';

    var y = parseInt(m[1], 10);
    var mo = parseInt(m[2], 10);
    var d = parseInt(m[3], 10);

    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var orig = new Date(y, mo - 1, d);
    if (orig.getMonth() !== mo - 1 || orig.getDate() !== d) return dateStr2;  // 非法日期

    if (!force) {
      var offBy = Math.abs(orig - today) / 86400000;
      if (offBy < 120 || offBy > 400) return dateStr2;
    }

    // 候选 = 今天所在年份的前后一年，配上原来的月和日，
    // 取其中离今天最近的那个。不能只围绕原年份 ±1，
    // 否则 2020 年的错误年份只会被拉到 2021，仍然不对。
    var yearNow = today.getFullYear();
    var best = null;
    var bestDiff = Infinity;
    for (var i = -1; i <= 1; i++) {
      var cand = new Date(yearNow + i, mo - 1, d);
      if (cand.getMonth() !== mo - 1 || cand.getDate() !== d) continue;
      var diff = Math.abs(cand - today);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = cand;
      }
    }
    if (!best) return dateStr2;
    return global.Store.util.dateStr(best);
  }

  /** 把模型返回的记录规范化成内部结构 */
  function normalizeRecords(list, opts) {
    var o = opts || {};
    var validCats = {};
    global.Classify.list('expense').forEach(function (c) { validCats[c.name] = c.id; });
    global.Classify.list('income').forEach(function (c) { validCats[c.name] = c.id; });
    global.Store.customCategories().forEach(function (c) { validCats[c.name] = c.id; });

    var today = todayStr();
    var fixedYears = 0;

    var out = [];
    (list || []).forEach(function (r) {
      if (!r) return;
      var amount = Math.abs(parseFloat(String(r.amount).replace(/[^\d.]/g, '')));
      if (!(amount > 0)) return;
      var type = r.type === 'income' ? 'income' : 'expense';

      var date = String(r.date || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        // 完全没识别到日期 → 用系统当前日期，不要瞎猜
        date = today;
      } else {
        // 模型说「账单上没写年份」时直接纠正，否则只在偏差可疑时才动
        var yearKnown = r.yearKnown;
        var force = (yearKnown === false || yearKnown === 'false' || yearKnown === 0);
        var snapped = nearestYearDate(date, force);
        if (snapped && snapped !== date) {
          fixedYears++;
          date = snapped;
        }
      }

      var time = String(r.time || '').trim();
      if (!/^\d{1,2}:\d{2}$/.test(time)) time = '00:00';
      if (time.length === 4) time = '0' + time;

      var catName = String(r.category || '').trim();
      var catId = validCats[catName] || '';
      out.push({
        date: date,
        time: time,
        amount: Math.round(amount * 100) / 100,
        type: type,
        content: String(r.content || '').trim() || (type === 'income' ? '账单进账' : '账单支出'),
        note: String(r.note || '').trim(),
        category: catId
      });
    });

    if (o.warn !== false) {
      out.fixedYears = fixedYears;
    }
    return out;
  }

  /** 从模型回复里抠出 JSON（容忍 ``` 包裹或前后废话） */
  function extractJson(text) {
    var t = String(text || '').trim();
    t = t.replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim();
    var start = t.indexOf('{');
    var end = t.lastIndexOf('}');
    if (start >= 0 && end > start) t = t.slice(start, end + 1);
    return JSON.parse(t);
  }

  function visionConfigured() {
    var s = global.Store.settings().llm;
    return !!(String(s.base || '').trim() &&
              (String(s.visionModel || '').trim() || String(s.model || '').trim()));
  }

  /**
   * 用视觉大模型识别截图。
   * @param {string[]} images dataURL 数组
   * @param {Object} handlers { onDelta, onDone(records), onError }
   */
  function recognizeImages(images, handlers) {
    var s = global.Store.settings().llm;
    var model = String(s.visionModel || '').trim() || String(s.model || '').trim();

    // 临时把模型切到视觉模型（部分服务商图文用不同模型）
    var savedModel = s.model;
    if (model && model !== savedModel) {
      global.Store.saveSettings({ llm: { model: model } });
    }

    var messages = buildVisionMessages(images);
    var acc = '';

    var job = global.AI.chat(messages, {
      onDelta: function (t) {
        acc += t;
        if (handlers.onDelta) handlers.onDelta(t);
      },
      onDone: function (full) {
        var text = full || acc;
        if (model && model !== savedModel) {
          global.Store.saveSettings({ llm: { model: savedModel } });
        }
        var records;
        try {
          var parsed = extractJson(text);
          records = normalizeRecords(parsed.records || parsed.data || []);
        } catch (e) {
          handlers.onError('没能解析模型返回的 JSON：\n' + String(text).slice(0, 400));
          return;
        }
        if (!records.length) {
          handlers.onError('没有从图片里识别到有效账单记录。\n' +
            '可以试试：换一张更清晰的截图，或在「设置」里把「视觉模型」填成支持看图的模型' +
            '（例如 qwen-vl-max、glm-4v、gpt-4o）。');
          return;
        }
        handlers.onDone(records);
      },
      onError: function (msg) {
        if (model && model !== savedModel) {
          global.Store.saveSettings({ llm: { model: savedModel } });
        }
        handlers.onError(msg);
      }
    }, true);

    return job;
  }

  global.BillImport = {
    compressImageFile: compressImageFile,
    parseText: parseText,
    recognizeImages: recognizeImages,
    extractJson: extractJson,
    normalizeRecords: normalizeRecords,
    nearestYearDate: nearestYearDate,
    buildVisionMessages: buildVisionMessages,
    visionConfigured: visionConfigured,
    splitCsv: splitCsv,
    parseDateCell: parseDateCell,
    parseAmountCell: parseAmountCell
  };
})(window);
