/* ============================================================
   数据层：模型 / 持久化 / 预算计算 / 文本记录生成
   - 优先使用 Android 原生桥写入 app 私有目录（容量大、可靠）
   - 在桌面浏览器打开时自动降级为 localStorage，方便调试
   ============================================================ */
(function (global) {
  'use strict';

  var HAS_NATIVE = (typeof Android !== 'undefined') && Android &&
                   (typeof Android.fsWrite === 'function');

  var DB_FILE = 'db.json';
  var BAK_FILE = 'db.bak.json';
  var LS_KEY = 'ledger.db';

  var DEFAULT_SETTINGS = {
    monthlyBudget: 0,
    dailyBudget: 0,
    monthStartDay: 1,
    theme: 'dark',
    themeId: 'default',
    themeColor: '#17BE8B',
    launcherIcon: 'whale_q_blue',
    // 首页欢迎条 + 左上角图标的自定义文案与图片
    brandTitle: '',
    brandDesc: '',
    brandIcon: '',
    brandIconBg: 'accent',
    brandIconBgColor: '#17BE8B',
    brandLabel: '记账本',
    // 应用整体背景图
    bgImage: '',
    bgUseThemeDefault: true,
    bgCustomStyle: false,
    bgScale: 1,
    bgOpacity: 0.55,
    bgBlur: 0,
    calendarMode: 'budget',
    lightPreset: 'white',
    lightBg: '#FFFFFF',
    payAutoImport: false,
    autoClassify: true,
    learnCategory: true,
    currency: '¥',
    llm: {
      preset: '',
      base: '',
      key: '',
      model: '',
      visionModel: '',
      temperature: 0.6,
      stream: true,
      maxTokens: 1600
    }
  };

  var db = null;
  var saveTimer = null;
  var saveCount = 0;

  /* ------------------------------------------------------ 基础工具 */

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function dateStr(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function timeStr(d) {
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function parseDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return new Date();
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  function daysBetween(a, b) {
    return Math.round((dayStart(b) - dayStart(a)) / 86400000);
  }

  function addDays(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }

  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  function num(v) {
    var n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function deepMerge(base, patch) {
    var out = clone(base);
    Object.keys(patch || {}).forEach(function (k) {
      var v = patch[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') {
        out[k] = deepMerge(out[k], v);
      } else if (v !== undefined) {
        out[k] = v;
      }
    });
    return out;
  }

  /* ------------------------------------------------------ 读写 */

  function rawRead(file) {
    if (HAS_NATIVE) {
      try { return Android.fsRead(file); } catch (e) { return null; }
    }
    try { return localStorage.getItem('ledger.' + file); } catch (e) { return null; }
  }

  function rawWrite(file, text) {
    if (HAS_NATIVE) {
      try { return !!Android.fsWrite(file, text); } catch (e) { return false; }
    }
    try { localStorage.setItem('ledger.' + file, text); return true; } catch (e) { return false; }
  }

  function emptyDb() {
    return {
      version: 2,
      createdAt: Date.now(),
      records: [],
      goals: [],
      customCategories: [],
      categoryRules: [],
      settings: clone(DEFAULT_SETTINGS),
      chats: []
    };
  }

  function normalize(parsed) {
    var base = emptyDb();
    if (!parsed || typeof parsed !== 'object') return base;
    base.version = 2;
    base.createdAt = parsed.createdAt || Date.now();
    base.records = Array.isArray(parsed.records) ? parsed.records.filter(Boolean).map(function (r) {
      return {
        id: r.id || uid(),
        date: r.date || dateStr(new Date()),
        time: r.time || '00:00',
        // 金额统一存正数，方向由 type 决定
        amount: round2(Math.abs(num(r.amount))),
        type: r.type === 'income' ? 'income' : 'expense',
        content: String(r.content == null ? '' : r.content),
        category: r.category || 'other',
        note: String(r.note == null ? '' : r.note),
        auto: !!r.auto,
        createdAt: r.createdAt || Date.now()
      };
    }) : [];
    base.goals = Array.isArray(parsed.goals) ? parsed.goals.filter(Boolean).map(function (g) {
      return {
        id: g.id || uid(),
        title: String(g.title == null ? '' : g.title),
        target: round2(num(g.target)),
        saved: round2(num(g.saved)),
        deadline: g.deadline || '',
        text: String(g.text == null ? '' : g.text),
        imageId: g.imageId || '',
        createdAt: g.createdAt || Date.now()
      };
    }) : [];
    base.customCategories = Array.isArray(parsed.customCategories)
      ? parsed.customCategories.filter(Boolean).map(function (c) {
          return {
            id: c.id || ('c_' + uid()),
            name: String(c.name || '').trim() || '未命名分类',
            icon: c.icon || '🏷️',
            color: c.color || '#7DD3FC',
            kind: c.kind === 'income' ? 'income' : 'expense',
            keywords: Array.isArray(c.keywords) ? c.keywords.filter(Boolean).map(String) : [],
            createdAt: c.createdAt || Date.now()
          };
        }) : [];
    base.categoryRules = Array.isArray(parsed.categoryRules)
      ? parsed.categoryRules.filter(Boolean).map(function (r) {
          return {
            key: String(r.key || ''),
            category: String(r.category || 'other'),
            kind: r.kind === 'income' ? 'income' : 'expense',
            hits: parseInt(r.hits, 10) || 1,
            updatedAt: r.updatedAt || Date.now()
          };
        }).filter(function (r) { return r.key; }) : [];
    base.settings = deepMerge(DEFAULT_SETTINGS, parsed.settings || {});
    base.chats = Array.isArray(parsed.chats) ? parsed.chats.slice(-60) : [];
    return base;
  }

  function load() {
    var text = rawRead(DB_FILE);
    if (text) {
      try { return normalize(JSON.parse(text)); } catch (e) { /* 尝试备份 */ }
    }
    var bak = rawRead(BAK_FILE);
    if (bak) {
      try { return normalize(JSON.parse(bak)); } catch (e) { /* ignore */ }
    }
    return emptyDb();
  }

  function persistNow() {
    saveTimer = null;
    if (!db) return;
    var text;
    try { text = JSON.stringify(db); } catch (e) { return; }
    saveCount++;
    if (saveCount % 15 === 0) rawWrite(BAK_FILE, text);
    rawWrite(DB_FILE, text);
  }

  function persist() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persistNow, 220);
  }

  function flush() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      persistNow();
    }
  }

  /* ------------------------------------------------------ 图片存储 */

  var ImageStore = {
    save: function (id, dataUrl) {
      var name = id + '.jpg';
      if (HAS_NATIVE && Android.saveImage) {
        try { return Android.saveImage(name, dataUrl) ? name : ''; } catch (e) { return ''; }
      }
      try { localStorage.setItem('ledger.img.' + name, dataUrl); return name; } catch (e) { return ''; }
    },
    load: function (name) {
      if (!name) return '';
      if (HAS_NATIVE && Android.loadImage) {
        try { return Android.loadImage(name) || ''; } catch (e) { return ''; }
      }
      try { return localStorage.getItem('ledger.img.' + name) || ''; } catch (e) { return ''; }
    },
    remove: function (name) {
      if (!name) return;
      if (HAS_NATIVE && Android.deleteImage) {
        try { Android.deleteImage(name); } catch (e) { /* ignore */ }
        return;
      }
      try { localStorage.removeItem('ledger.img.' + name); } catch (e) { /* ignore */ }
    }
  };

  /* ------------------------------------------------------ 账期 / 预算 */

  /**
   * 计算 date 所在的记账周期（支持自定义每月起始日，例如发薪日 15 号）。
   */
  function periodOf(date, startDay) {
    startDay = Math.min(Math.max(parseInt(startDay, 10) || 1, 1), 28);
    var d = dayStart(date);
    var start;
    if (d.getDate() >= startDay) {
      start = new Date(d.getFullYear(), d.getMonth(), startDay);
    } else {
      start = new Date(d.getFullYear(), d.getMonth() - 1, startDay);
    }
    var end = new Date(start.getFullYear(), start.getMonth() + 1, startDay); // 开区间
    var totalDays = Math.max(1, Math.round((end - start) / 86400000));
    var elapsed = Math.max(1, daysBetween(start, d) + 1);
    var remainingDays = Math.max(1, totalDays - elapsed + 1);
    return {
      start: start,
      end: end,
      startStr: dateStr(start),
      endStr: dateStr(end),
      totalDays: totalDays,
      elapsedDays: elapsed,
      remainingDays: remainingDays,
      label: start.getFullYear() + '年' + (start.getMonth() + 1) + '月' +
             (startDay === 1 ? '' : '(' + startDay + '日起)')
    };
  }

  function sumAmount(list) {
    return round2(list.reduce(function (a, r) { return a + num(r.amount); }, 0));
  }

  /** 支出合计 */
  function sumExpense(list) {
    return round2(list.reduce(function (a, r) {
      return a + (r.type === 'income' ? 0 : num(r.amount));
    }, 0));
  }

  /** 收入合计 */
  function sumIncome(list) {
    return round2(list.reduce(function (a, r) {
      return a + (r.type === 'income' ? num(r.amount) : 0);
    }, 0));
  }

  /** 结余 = 收入 − 支出 */
  function netOf(list) {
    return round2(sumIncome(list) - sumExpense(list));
  }

  /**
   * 预算与「当日剩余额度」。
   *
   * 预算只用来衡量「支出」：收入不会冲抵已花金额，而是单独展示，
   * 这样记账的预算语义才不会被一笔工资打乱。
   */
  function budget(date) {
    var d = date || new Date();
    var s = db.settings;
    var monthly = round2(num(s.monthlyBudget));
    var daily = round2(num(s.dailyBudget));
    var p = periodOf(d, s.monthStartDay);
    var todayS = dateStr(d);

    var inPeriod = db.records.filter(function (r) {
      return r.date >= p.startStr && r.date < p.endStr;
    });
    var todayList = inPeriod.filter(function (r) { return r.date === todayS; });

    var spentPeriod = sumExpense(inPeriod);
    var spentToday = sumExpense(todayList);
    var spentBeforeToday = round2(spentPeriod - spentToday);

    var incomePeriod = sumIncome(inPeriod);
    var incomeToday = sumIncome(todayList);

    var remaining = round2(monthly - spentPeriod);
    var budgetBeforeToday = round2(monthly - spentBeforeToday);
    var dailyAllowance = monthly > 0 ? round2(budgetBeforeToday / p.remainingDays) : 0;
    var todayRemaining = monthly > 0 ? round2(dailyAllowance - spentToday) : 0;
    var todayRemainingByDay = daily > 0 ? round2(daily - spentToday) : null;

    return {
      period: p,
      monthly: monthly,
      daily: daily,
      hasMonthly: monthly > 0,
      hasDaily: daily > 0,
      spentPeriod: spentPeriod,
      spentToday: spentToday,
      spentBeforeToday: spentBeforeToday,
      incomePeriod: incomePeriod,
      incomeToday: incomeToday,
      netPeriod: round2(incomePeriod - spentPeriod),
      netToday: round2(incomeToday - spentToday),
      remaining: remaining,
      usedRatio: monthly > 0 ? Math.min(1.5, spentPeriod / monthly) : 0,
      dailyAllowance: dailyAllowance,
      todayRemaining: todayRemaining,
      todayRemainingByDay: todayRemainingByDay,
      projected: p.elapsedDays > 0 ? round2(spentPeriod / p.elapsedDays * p.totalDays) : 0
    };
  }

  /* ------------------------------------------------------ 查询 / 统计 */

  function sortDesc(a, b) {
    var ka = a.date + ' ' + (a.time || '');
    var kb = b.date + ' ' + (b.time || '');
    if (ka === kb) return (b.createdAt || 0) - (a.createdAt || 0);
    return ka < kb ? 1 : -1;
  }

  function query(opts) {
    opts = opts || {};
    var from = opts.from || '';
    var to = opts.to || '';
    var kw = String(opts.keyword || '').trim().toLowerCase();
    var cat = opts.category || '';
    var type = opts.type || '';

    return db.records.filter(function (r) {
      if (from && r.date < from) return false;
      if (to && r.date > to) return false;
      if (cat && r.category !== cat) return false;
      if (type && (r.type || 'expense') !== type) return false;
      if (kw) {
        var hay = (r.content + ' ' + r.note + ' ' + catName(r.category)).toLowerCase();
        if (hay.indexOf(kw) < 0) return false;
      }
      return true;
    }).sort(sortDesc);
  }

  /** 自定义分类查表 */
  function customCategory(id) {
    var list = db.customCategories || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  /** 分类展示信息（名称/图标/颜色），内置与自定义统一处理 */
  function catMeta(id) {
    var c = customCategory(id);
    if (c) return { id: id, name: c.name, color: c.color, icon: c.icon, custom: true };
    if (global.Classify) {
      var b = global.Classify.byId(id);
      return { id: id, name: b.name, color: b.color, icon: b.icon, custom: false };
    }
    return { id: id, name: id, color: '#94A3B8', icon: '📦', custom: false };
  }

  function catName(id) {
    return catMeta(id).name;
  }

  /**
   * 按分类汇总。
   * @param {string} type 'expense' | 'income'，默认 expense
   */
  function categoryTotals(records, type) {
    var want = type || 'expense';
    var map = {};
    records.forEach(function (r) {
      if ((r.type || 'expense') !== want) return;
      map[r.category] = round2((map[r.category] || 0) + num(r.amount));
    });
    return Object.keys(map).map(function (id) {
      var m = catMeta(id);
      return { id: id, name: m.name, color: m.color, icon: m.icon, value: map[id] };
    }).sort(function (a, b) { return b.value - a.value; });
  }

  function dailyTotals(records, from, to) {
    var mapE = {}, mapI = {};
    records.forEach(function (r) {
      if (r.type === 'income') {
        mapI[r.date] = round2((mapI[r.date] || 0) + num(r.amount));
      } else {
        mapE[r.date] = round2((mapE[r.date] || 0) + num(r.amount));
      }
    });
    function row(key) {
      var e = mapE[key] || 0, i = mapI[key] || 0;
      return {
        key: key, label: key.slice(5),
        value: e, expense: e, income: i, net: round2(i - e)
      };
    }
    var out = [];
    if (from && to) {
      var cur = parseDate(from);
      var end = parseDate(to);
      var guard = 0;
      while (cur <= end && guard++ < 400) {
        out.push(row(dateStr(cur)));
        cur = addDays(cur, 1);
      }
      return out;
    }
    var keys = {};
    Object.keys(mapE).forEach(function (k) { keys[k] = 1; });
    Object.keys(mapI).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).sort().forEach(function (k) { out.push(row(k)); });
    return out;
  }

  function monthlyTotals(records) {
    var mapE = {}, mapI = {};
    (records || db.records).forEach(function (r) {
      var k = r.date.slice(0, 7);
      if (r.type === 'income') {
        mapI[k] = round2((mapI[k] || 0) + num(r.amount));
      } else {
        mapE[k] = round2((mapE[k] || 0) + num(r.amount));
      }
    });
    var keys = {};
    Object.keys(mapE).forEach(function (k) { keys[k] = 1; });
    Object.keys(mapI).forEach(function (k) { keys[k] = 1; });
    return Object.keys(keys).sort().map(function (k) {
      var e = mapE[k] || 0, i = mapI[k] || 0;
      return { key: k, label: k.slice(2), value: e, expense: e, income: i, net: round2(i - e) };
    });
  }

  /**
   * 日历用：某年某月每一天的收支明细。
   * 返回按日期升序的数组，附带 range（首尾日期）方便查询。
   */
  function monthGrid(year, month) {
    var first = new Date(year, month, 1);
    var last = new Date(year, month + 1, 0);
    var fromStr = dateStr(first);
    var toStr = dateStr(last);

    var mapE = {}, mapI = {}, counts = {};
    db.records.forEach(function (r) {
      if (r.date < fromStr || r.date > toStr) return;
      if (r.type === 'income') {
        mapI[r.date] = round2((mapI[r.date] || 0) + num(r.amount));
      } else {
        mapE[r.date] = round2((mapE[r.date] || 0) + num(r.amount));
      }
      counts[r.date] = (counts[r.date] || 0) + 1;
    });

    var days = [];
    for (var d = 1; d <= last.getDate(); d++) {
      var key = dateStr(new Date(year, month, d));
      var e = mapE[key] || 0;
      var i = mapI[key] || 0;
      days.push({
        date: key,
        day: d,
        weekday: new Date(year, month, d).getDay(),
        expense: e,
        income: i,
        net: round2(i - e),
        count: counts[key] || 0
      });
    }

    return {
      year: year,
      month: month,
      first: first,
      last: last,
      days: days,
      from: fromStr,
      to: toStr
    };
  }

  function groupByDay(records) {
    var groups = [];
    var index = {};
    records.forEach(function (r) {
      if (!index[r.date]) {
        index[r.date] = { date: r.date, total: 0, expense: 0, income: 0, items: [] };
        groups.push(index[r.date]);
      }
      var g = index[r.date];
      if (r.type === 'income') {
        g.income = round2(g.income + num(r.amount));
      } else {
        g.expense = round2(g.expense + num(r.amount));
      }
      g.net = round2(g.income - g.expense);
      g.total = g.expense;
      g.items.push(r);
    });
    groups.forEach(function (g) { g.items.sort(sortDesc); });
    return groups;
  }

  /* ------------------------------------------------------ 文本记录 */

  var WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function weekday(dateString) {
    try { return WEEK[parseDate(dateString).getDay()]; } catch (e) { return ''; }
  }

  function money(v) {
    return (Math.round(num(v) * 100) / 100).toFixed(2);
  }

  /**
   * 生成文本记录，格式：
   * 【时间】|【分类】|【内容】|【金额】
   * 金额带符号：支出为 -，收入为 +
   */
  function toText(records, opts) {
    opts = opts || {};
    var lines = [];
    var asc = records.slice().sort(function (a, b) {
      var ka = a.date + ' ' + (a.time || '');
      var kb = b.date + ' ' + (b.time || '');
      return ka < kb ? -1 : (ka > kb ? 1 : 0);
    });
    asc.forEach(function (r) {
      var sign = r.type === 'income' ? '+' : '-';
      // 按用户要求去掉【】符号，保留 | 分隔
      var line = r.date + ' ' + (r.time || '00:00') +
                 ' | ' + catName(r.category) +
                 ' | ' + (r.content || '未填写') +
                 ' | ' + sign + money(r.amount);
      if (opts.includeNote && r.note) {
        line += ' | 备注：' + r.note.replace(/\s+/g, ' ').trim();
      }
      lines.push(line);
    });
    return lines.join('\n');
  }

  /**
   * 带统计信息的完整报表文本（喂给大模型用）。
   */
  function toReport(records, opts) {
    opts = opts || {};
    var expense = sumExpense(records);
    var income = sumIncome(records);
    var net = round2(income - expense);
    var cats = categoryTotals(records, 'expense');
    var incCats = categoryTotals(records, 'income');
    var days = {};
    records.forEach(function (r) { days[r.date] = 1; });
    var dayCount = Object.keys(days).length || 1;

    var head = [];
    head.push('===== 记账明细文本记录 =====');
    head.push('记录条数：' + records.length + ' 条');
    head.push('合计支出：' + money(expense) + ' 元');
    if (income > 0) {
      head.push('合计收入：' + money(income) + ' 元');
      head.push('结余（收入−支出）：' + money(net) + ' 元');
    }
    head.push('时间跨度：' + (opts.from || '最早') + ' 至 ' + (opts.to || '最新') +
              '（覆盖 ' + dayCount + ' 天，日均支出 ' + money(expense / dayCount) + ' 元）');
    head.push('格式：【时间】|【分类】|【内容】|【金额】（支出为负、收入为正）');
    head.push('');

    var catPart = [];
    catPart.push('----- 支出分类汇总 -----');
    if (!cats.length) catPart.push('（无支出记录）');
    cats.forEach(function (c) {
      var pct = expense > 0 ? (c.value / expense * 100).toFixed(1) : '0.0';
      catPart.push(c.name + '：' + money(c.value) + ' 元（' + pct + '%，' +
                   records.filter(function (r) {
                     return r.category === c.id && r.type !== 'income';
                   }).length + ' 笔）');
    });
    catPart.push('');

    if (incCats.length) {
      catPart.push('----- 收入分类汇总 -----');
      incCats.forEach(function (c) {
        var pct = income > 0 ? (c.value / income * 100).toFixed(1) : '0.0';
        catPart.push(c.name + '：' + money(c.value) + ' 元（' + pct + '%）');
      });
      catPart.push('');
    }

    var b = budget(new Date());
    var budgetPart = [];
    if (b.hasMonthly) {
      budgetPart.push('----- 预算情况 -----');
      budgetPart.push('月度预算：' + money(b.monthly) + ' 元（账期 ' + b.period.label + '）');
      budgetPart.push('本账期已花：' + money(b.spentPeriod) + ' 元，剩余 ' + money(b.remaining) + ' 元');
      budgetPart.push('日均可用：' + money(b.dailyAllowance) + ' 元，剩余 ' + b.period.remainingDays + ' 天');
      budgetPart.push('');
    }

    var body = [];
    body.push('----- 逐条记录 -----');
    body.push(toText(records, opts));

    return head.concat(catPart, budgetPart, body).join('\n');
  }

  /* ------------------------------------------------------ 对外 API */

  var Store = {
    HAS_NATIVE: HAS_NATIVE,
    get db() { return db; },

    init: function () {
      db = load();
      return db;
    },

    settings: function () { return db.settings; },

    saveSettings: function (patch) {
      db.settings = deepMerge(db.settings, patch || {});
      persist();
      return db.settings;
    },

    persist: persist,
    flush: flush,

    /* --- 记录 --- */
    addRecord: function (r) {
      var rec = {
        id: uid(),
        date: r.date || dateStr(new Date()),
        time: r.time || timeStr(new Date()),
        amount: round2(Math.abs(num(r.amount))),
        type: r.type === 'income' ? 'income' : 'expense',
        content: String(r.content || '').trim(),
        category: r.category || (r.type === 'income' ? 'other_income' : 'other'),
        note: String(r.note || '').trim(),
        auto: !!r.auto,
        createdAt: Date.now()
      };
      db.records.push(rec);
      persist();
      return rec;
    },

    addRecords: function (list) {
      var self = this;
      var out = [];
      (list || []).forEach(function (r) { out.push(self.addRecord(r)); });
      return out;
    },

    updateRecord: function (id, patch) {
      for (var i = 0; i < db.records.length; i++) {
        if (db.records[i].id === id) {
          var r = db.records[i];
          if (patch.date !== undefined) r.date = patch.date;
          if (patch.time !== undefined) r.time = patch.time;
          if (patch.amount !== undefined) r.amount = round2(Math.abs(num(patch.amount)));
          if (patch.type !== undefined) r.type = patch.type === 'income' ? 'income' : 'expense';
          if (patch.content !== undefined) r.content = String(patch.content).trim();
          if (patch.category !== undefined) r.category = patch.category;
          if (patch.note !== undefined) r.note = String(patch.note).trim();
          persist();
          return r;
        }
      }
      return null;
    },

    deleteRecord: function (id) {
      var n = db.records.length;
      db.records = db.records.filter(function (r) { return r.id !== id; });
      persist();
      return db.records.length !== n;
    },

    getRecord: function (id) {
      return db.records.filter(function (r) { return r.id === id; })[0] || null;
    },

    /* --- 目标 --- */
    addGoal: function (g) {
      var goal = {
        id: uid(),
        title: String(g.title || '').trim() || '未命名目标',
        target: round2(num(g.target)),
        saved: round2(num(g.saved)),
        deadline: g.deadline || '',
        text: String(g.text || ''),
        imageId: g.imageId || '',
        createdAt: Date.now()
      };
      db.goals.push(goal);
      persist();
      return goal;
    },

    updateGoal: function (id, patch) {
      for (var i = 0; i < db.goals.length; i++) {
        if (db.goals[i].id === id) {
          var g = db.goals[i];
          ['title', 'deadline', 'text', 'imageId'].forEach(function (k) {
            if (patch[k] !== undefined) g[k] = patch[k];
          });
          if (patch.target !== undefined) g.target = round2(num(patch.target));
          if (patch.saved !== undefined) g.saved = round2(num(patch.saved));
          persist();
          return g;
        }
      }
      return null;
    },

    depositGoal: function (id, delta) {
      var g = this.getGoal(id);
      if (!g) return null;
      g.saved = round2(g.saved + num(delta));
      persist();
      return g;
    },

    getGoal: function (id) {
      return db.goals.filter(function (g) { return g.id === id; })[0] || null;
    },

    deleteGoal: function (id) {
      var g = this.getGoal(id);
      if (g && g.imageId) ImageStore.remove(g.imageId);
      db.goals = db.goals.filter(function (x) { return x.id !== id; });
      persist();
      return true;
    },

    goals: function () {
      return db.goals.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    },

    /* --- 自定义分类 --- */
    customCategories: function (kind) {
      var list = db.customCategories || [];
      return kind ? list.filter(function (c) { return c.kind === kind; }) : list.slice();
    },

    addCustomCategory: function (c) {
      var cat = {
        id: 'c_' + uid(),
        name: String(c.name || '').trim() || '新分类',
        icon: c.icon || '🏷️',
        color: c.color || '#7DD3FC',
        kind: c.kind === 'income' ? 'income' : 'expense',
        keywords: Array.isArray(c.keywords) ? c.keywords.filter(Boolean).map(String) : [],
        createdAt: Date.now()
      };
      if (!db.customCategories) db.customCategories = [];
      db.customCategories.push(cat);
      persist();
      return cat;
    },

    updateCustomCategory: function (id, patch) {
      var list = db.customCategories || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) {
          var c = list[i];
          if (patch.name !== undefined) c.name = String(patch.name).trim() || c.name;
          if (patch.icon !== undefined) c.icon = patch.icon;
          if (patch.color !== undefined) c.color = patch.color;
          if (patch.keywords !== undefined) {
            c.keywords = patch.keywords.filter(Boolean).map(String);
          }
          persist();
          return c;
        }
      }
      return null;
    },

    deleteCustomCategory: function (id) {
      var before = (db.customCategories || []).length;
      db.customCategories = (db.customCategories || []).filter(function (c) { return c.id !== id; });
      // 落到该分类的记录退回「其他」
      db.records.forEach(function (r) {
        if (r.category === id) r.category = r.type === 'income' ? 'other_income' : 'other';
      });
      persist();
      return db.customCategories.length !== before;
    },

    /* --- 分类学习 --- */
    /**
     * 记住「这个内容属于这个分类」，下次输入相同或相似内容时自动命中。
     */
    learnCategory: function (content, category, kind) {
      if (!db.settings.learnCategory) return null;
      var key = global.Classify ? global.Classify.normalize(content) : String(content || '').trim();
      if (!key || key.length < 2) return null;
      if (!db.categoryRules) db.categoryRules = [];
      var k = kind === 'income' ? 'income' : 'expense';
      for (var i = 0; i < db.categoryRules.length; i++) {
        var rule = db.categoryRules[i];
        if (rule.key === key && rule.kind === k) {
          rule.category = category;
          rule.hits = (rule.hits || 1) + 1;
          rule.updatedAt = Date.now();
          persist();
          return rule;
        }
      }
      var created = { key: key, category: category, kind: k, hits: 1, updatedAt: Date.now() };
      db.categoryRules.push(created);
      // 规则过多时丢弃最久未使用的，避免无限增长
      if (db.categoryRules.length > 500) {
        db.categoryRules.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
        db.categoryRules = db.categoryRules.slice(0, 400);
      }
      persist();
      return created;
    },

    categoryRules: function () { return (db.categoryRules || []).slice(); },

    clearCategoryRules: function () { db.categoryRules = []; persist(); },

    /** 综合「已学习的规则 + 自定义分类关键词 + 内置关键词」给出分类建议 */
    suggestCategory: function (content, note, kind) {
      if (!global.Classify) return null;
      return global.Classify.classify(content, note, {
        kind: kind === 'income' ? 'income' : 'expense',
        custom: db.customCategories || [],
        rules: db.categoryRules || []
      });
    },

    /* --- AI 对话 --- */
    chats: function () { return db.chats || []; },
    pushChat: function (role, content) {
      if (!db.chats) db.chats = [];
      db.chats.push({ role: role, content: content, at: Date.now() });
      if (db.chats.length > 60) db.chats = db.chats.slice(-60);
      persist();
    },
    clearChats: function () { db.chats = []; persist(); },

    /* --- 查询 / 统计 --- */
    query: query,
    categoryTotals: categoryTotals,
    dailyTotals: dailyTotals,
    monthlyTotals: monthlyTotals,
    groupByDay: groupByDay,
    monthGrid: monthGrid,
    catMeta: catMeta,
    customCategory: customCategory,
    sumAmount: sumAmount,
    sumExpense: sumExpense,
    sumIncome: sumIncome,
    netOf: netOf,
    budget: budget,
    periodOf: periodOf,

    /* --- 文本 --- */
    toText: toText,
    toReport: toReport,

    /* --- 图片 --- */
    images: ImageStore,

    /* --- 备份 --- */
    exportJSON: function () { return JSON.stringify(db, null, 2); },

    importJSON: function (text) {
      var parsed = JSON.parse(text);
      db = normalize(parsed);
      persistNow();
      return db;
    },

    clearAll: function (keepSettings) {
      var s = keepSettings ? db.settings : clone(DEFAULT_SETTINGS);
      db = emptyDb();
      db.settings = s;
      persistNow();
      return db;
    },

    stats: function () {
      return {
        count: db.records.length,
        total: sumAmount(db.records),
        expense: sumExpense(db.records),
        income: sumIncome(db.records),
        net: netOf(db.records),
        goals: db.goals.length,
        customCategories: (db.customCategories || []).length,
        rules: (db.categoryRules || []).length,
        firstDate: db.records.length ? db.records.map(function (r) { return r.date; }).sort()[0] : ''
      };
    }
  };

  /* --- 通用工具导出 --- */
  Store.util = {
    uid: uid,
    pad2: pad2,
    dateStr: dateStr,
    timeStr: timeStr,
    parseDate: parseDate,
    dayStart: dayStart,
    addDays: addDays,
    daysBetween: daysBetween,
    round2: round2,
    num: num,
    money: money,
    weekday: weekday,
    clone: clone
  };

  global.Store = Store;
})(window);
