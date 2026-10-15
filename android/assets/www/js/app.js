/* ============================================================
   记账本 · 界面与交互
   ============================================================ */
(function () {
  'use strict';

  var U = Store.util;
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * 把模型回复里的 Markdown 记号剥掉，只留干净文字。
   *
   * 提示词里已经要求不要用 ** 加粗，但模型不总是听话，
   * 所以渲染时再兜一层：** 直接删掉，### 标题降级成普通行。
   * 提示词无法保证的事，渲染层兜住。
   */
  function plainText(s) {
    var t = String(s == null ? '' : s);
    t = t.replace(/\*\*\*(.+?)\*\*\*/g, '$1');
    t = t.replace(/\*\*(.+?)\*\*/g, '$1');
    t = t.replace(/__(.+?)__/g, '$1');
    // 行首和行中的 # 标题记号都去掉（模型经常写成「结论 ### 小标题」）
    t = t.replace(/(^|\s)#{1,6}\s+/g, '$1');
    t = t.replace(/^#{1,6}\s*/gm, '');
    t = t.replace(/`([^`]+)`/g, '$1');
    return t;
  }

  function fmt(v) {
    var n = Number(v) || 0;
    return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmt0(v) {
    var n = Number(v) || 0;
    return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
  }

  function todayStr() { return U.dateStr(new Date()); }
  function nowTime() { return U.timeStr(new Date()); }

  var CATS = Classify.CATEGORIES;

  /** 可切换的桌面图标（与 AndroidManifest 里的 activity-alias 一一对应）
   *  预览直接用生成好的真实图标，保证和桌面看到的一致 */
  var ICON_VARIANTS = [
    { id: 'whale_q_blue', name: '鲸鱼娘·深海蓝', img: 'img/icon-whale_q_blue.png' },
    { id: 'whale_q_pink', name: '鲸鱼娘·樱花粉', img: 'img/icon-whale_q_pink.png' },
    { id: 'whale_q_light', name: '鲸鱼娘·清透白', img: 'img/icon-whale_q_light.png' },
    { id: 'whale_q_face', name: 'Q版表情包', img: 'img/icon-whale_q_face.png' },
    { id: 'whale_m_blue', name: '鲸鱼娘·成熟版', img: 'img/icon-whale_m_blue.png' },
    { id: 'fish_meme', name: '大肥鱼', img: 'img/icon-fish_meme.png' },
    { id: 'classic', name: '经典柱状图', img: 'img/icon-classic.png' }
  ];

  /** 常用 emoji，供自定义分类挑选图标 */
  var EMOJI_PALETTE = [
    '🍜', '🍔', '☕', '🛍️', '👕', '👟', '🚗', '🚌', '✈️', '🏠', '💡', '🎮',
    '🎬', '🎵', '🧻', '🧴', '💊', '🏥', '📱', '📚', '🎁', '🐾', '💻', '💄',
    '🏋️', '🎓', '🧾', '💰', '💼', '🏆', '📈', '↩️', '🧧', '🏷️', '⭐', '❤️'
  ];

  function normalizeHex(v) {
    var s = String(v || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
    if (/^[0-9a-fA-F]{6}$/.test(s)) return '#' + s;
    return Theme.DEFAULT_COLOR;
  }

  /* ------------------------------------------------------ 状态 */

  var S = {
    tab: 'add',
    form: {
      amount: '', content: '', category: '', note: '',
      date: todayStr(), time: nowTime(), catLocked: false
    },
    income: {
      open: false,
      amount: '', content: '', category: '', note: '',
      date: todayStr(), time: nowTime(), catLocked: false
    },
    list: { range: 'month', from: '', to: '', keyword: '', view: 'list',
            editMode: false, selected: {} },
    pay: { inbox: [], access: false, checked: {}, timer: null },
    cal: null,                       // 日历状态，懒加载
    stat: { range: 'month', from: '', to: '', anchor: '', mode: 'category', kind: 'expense' },
    ai: { range: 'month', from: '', to: '', question: '', busy: false },
    imp: { images: [], records: [], checked: {}, busy: false },
    // 自定义桌面图标的工作状态
    ci: { src: '', composed: '', bg: 'accent', bgColor: '#17BE8B', label: '大肥鱼记账本' },
    heroDraft: null,
    cropTarget: 'hero',
    goalDraft: null
  };

  /* ------------------------------------------------------ 时间范围 */

  /**
   * 计算时间范围。
   * 传了 anchor（某个日期）就按「包含这一天」的整段来算，
   * 这样统计页可以前后翻到任意某天 / 某周 / 某月 / 某年；
   * 不传 anchor 时就是默认的「截至今天」。
   */
  function rangeOf(kind, customFrom, customTo, anchor) {
    var now = new Date();
    var t = todayStr();
    var a = anchor ? U.parseDate(anchor) : null;

    if (kind === 'today') {
      var day = a ? anchor : t;
      return { from: day, to: day, label: a ? day : '今日' };
    }
    if (kind === 'week') {
      var wbase = a || now;
      var dow = (wbase.getDay() + 6) % 7; // 周一为一周之始
      var wstart = U.addDays(wbase, -dow);
      if (!a) return { from: U.dateStr(wstart), to: t, label: '本周' };
      return { from: U.dateStr(wstart), to: U.dateStr(U.addDays(wstart, 6)),
               label: U.dateStr(wstart) + ' 那一周' };
    }
    if (kind === 'month') {
      var p = Store.periodOf(a || now, Store.settings().monthStartDay);
      var lastDay = U.dateStr(U.addDays(U.parseDate(p.endStr), -1));
      if (!a) {
        return { from: p.startStr, to: lastDay < t ? lastDay : t, label: '本账期' };
      }
      return { from: p.startStr, to: lastDay, label: p.startStr.slice(0, 7) };
    }
    if (kind === 'year') {
      var y = (a || now).getFullYear();
      if (!a) return { from: y + '-01-01', to: t, label: '今年' };
      return { from: y + '-01-01', to: y + '-12-31', label: y + ' 年' };
    }
    if (kind === 'all') return { from: '', to: '', label: '全部' };
    if (kind === 'custom') {
      return { from: customFrom || '', to: customTo || '', label: '自定义' };
    }
    return { from: '', to: '', label: '全部' };
  }

  /** 往前 / 往后翻一个统计周期 */
  function shiftStatPeriod(step) {
    var r = S.stat.range;
    if (r !== 'today' && r !== 'week' && r !== 'month' && r !== 'year') return;

    var cur = rangeOf(r, S.stat.from, S.stat.to, S.stat.anchor);
    // 以当前这段的结束日做锚点，翻页时不会因为「今天」而漂移
    var d = U.parseDate(S.stat.anchor || cur.to);
    if (r === 'today') d = U.addDays(d, step);
    else if (r === 'week') d = U.addDays(d, step * 7);
    else if (r === 'month') d = new Date(d.getFullYear(), d.getMonth() + step, 15);
    else if (r === 'year') d = new Date(d.getFullYear() + step, d.getMonth(), 15);

    S.stat.anchor = U.dateStr(d);
    render();
  }

  function recordsFor(rangeState) {
    var r = rangeOf(rangeState.range, rangeState.from, rangeState.to, rangeState.anchor);
    return { range: r, list: Store.query({ from: r.from, to: r.to, keyword: rangeState.keyword }) };
  }

  /* ------------------------------------------------------ 主题 */

  /**
   * 应用整体背景图。
   *
   * 用一层固定的图层放在所有内容下面，再按用户设置做缩放 / 透明度 / 虚化；
   * 同时把卡片和顶栏调成半透明，否则背景图会被完全挡住。
   */
  function applyAppBg() {
    var el = $('#appbg');
    if (!el) return;

    var s = Store.settings();
    var data = '';
    var usingThemeBg = false;
    if (s.bgImage) {
      data = Store.images.load(s.bgImage) || '';
    }
    // 没有自定义背景时，用主题自带的默认背景（鲸鱼娘主题有）
    if (!data && s.bgUseThemeDefault !== false) {
      data = Theme.defaultBgOf(s.themeId) || '';
      usingThemeBg = !!data;
    }

    if (!data) {
      el.style.display = 'none';
      el.style.backgroundImage = '';
      document.documentElement.removeAttribute('data-appbg');
      return;
    }

    // 主题自带背景有它自己的显示参数（110% / 80% / 虚化 5）；
    // 用户一旦动过滑块，就听用户的
    var style = (usingThemeBg && !s.bgCustomStyle)
      ? Theme.defaultBgStyleOf(s.themeId) : null;

    var scale = Math.max(1, Math.min(3,
      style ? style.scale : (Number(s.bgScale) || 1)));
    var opacity = Math.max(0.04, Math.min(1,
      style ? style.opacity : (s.bgOpacity == null ? 0.55 : Number(s.bgOpacity))));
    var blur = Math.max(0, Math.min(24,
      style ? style.blur : (Number(s.bgBlur) || 0)));

    el.style.display = 'block';
    el.style.backgroundImage = 'url("' + data + '")';
    el.style.opacity = String(Math.max(0.04, Math.min(1, opacity)));
    el.style.filter = blur > 0 ? 'blur(' + blur + 'px)' : 'none';
    el.style.transform = 'scale(' + scale + ')';
    document.documentElement.setAttribute('data-appbg', '1');

    // 卡片半透明化：深色和浅色各一套
    var dark = s.theme !== 'light';
    var root = document.documentElement;
    root.style.setProperty('--bg', dark ? 'rgba(14,17,22,0.52)' : 'rgba(250,251,252,0.52)');
    root.style.setProperty('--bg-2', dark ? 'rgba(20,24,31,0.5)' : 'rgba(255,255,255,0.58)');
    root.style.setProperty('--card', dark ? 'rgba(26,31,39,0.76)' : 'rgba(255,255,255,0.8)');
    root.style.setProperty('--card-2', dark ? 'rgba(34,40,50,0.68)' : 'rgba(244,246,248,0.76)');
  }

  function bgSettingsHtml() {
    var s = Store.settings();
    var data = s.bgImage ? Store.images.load(s.bgImage) : '';
    // 跟随主题默认背景时，滑块显示主题预设的那组值
    var themeStyle = (!s.bgImage && s.bgUseThemeDefault !== false && !s.bgCustomStyle)
      ? Theme.defaultBgStyleOf(s.themeId) : null;
    var effScale = themeStyle ? themeStyle.scale : (Number(s.bgScale) || 1);
    var effOpacity = themeStyle ? themeStyle.opacity
      : (s.bgOpacity == null ? 0.55 : Number(s.bgOpacity));
    var effBlur = themeStyle ? themeStyle.blur : (Number(s.bgBlur) || 0);
    return '<div class="sec-title">背景图片</div>' +
      '<div class="card tight">' +
        '<div class="hint" style="line-height:1.9;margin-bottom:11px">' +
          '给整个应用换一张背景图。可以调缩放、透明度和虚化，改动会立刻生效。<br>' +
          (Theme.defaultBgOf(s.themeId)
            ? '当前主题自带一张默认背景，选了自己的图就会覆盖它；点「移除背景」可以关掉。'
            : '') +
        '</div>' +
        '<div class="bg-preview" id="bg-preview">' +
          (data ? '<img src="' + data + '" alt="" />' : '<span>🖼️</span>') +
        '</div>' +
        '<div class="btn-row" style="margin-top:10px">' +
          '<button class="btn file-btn">📷 选择图片' +
            '<input type="file" accept="image/*" id="bg-file" /></button>' +
          '<button class="btn danger" data-act="clearBgImage">移除背景</button>' +
        '</div>' +
        (Theme.defaultBgOf(s.themeId) && s.bgUseThemeDefault === false
          ? '<button class="btn block" style="margin-top:9px" data-act="useThemeBg">' +
            '↩️ 恢复「' + esc(Theme.presetOf(s.themeId).name) + '」的默认背景</button>'
          : '') +
        cropBoxHtml() +
        '<div class="bg-row"><label>缩放</label>' +
          '<input type="range" id="bg-scale" min="100" max="300" step="5" value="' +
            Math.round(effScale * 100) + '" />' +
          '<b id="bg-scale-v">' + Math.round(effScale * 100) + '%</b></div>' +
        '<div class="bg-row"><label>透明度</label>' +
          '<input type="range" id="bg-opacity" min="5" max="100" step="1" value="' +
            Math.round(effOpacity * 100) + '" />' +
          '<b id="bg-opacity-v">' + Math.round(effOpacity * 100) + '%</b></div>' +
        '<div class="bg-row"><label>虚化</label>' +
          '<input type="range" id="bg-blur" min="0" max="24" step="1" value="' +
            Math.round(effBlur) + '" />' +
          '<b id="bg-blur-v">' + Math.round(effBlur) + 'px</b></div>' +
        (themeStyle
          ? '<div class="hint" style="margin-top:9px">当前用的是主题自带的背景参数' +
            '（110% / 80% / 虚化 5px），拖动上面的滑块就会改成你自己的值。</div>'
          : '') +
      '</div>';
  }

  function applyTheme() {
    var s = Store.settings();
    Theme.apply(s);
    applyAppBg();

    // 顶栏左上角的图标：自定义图片优先，其次主题吉祥物，最后回到默认表情
    var logo = $('.brand .logo');
    if (logo) {
      var custom = !!s.brandIcon && !!Store.images.load(s.brandIcon);
      var icon = brandIconSrc();
      if (icon) {
        logo.innerHTML = '<img src="' + icon + '" alt="" />';
        logo.classList.add('has-img');
        logo.style.background = custom ? (brandIconBackground() || 'transparent') : '';
      } else {
        if (logo.classList.contains('has-img')) {
          logo.innerHTML = '💰';
          logo.classList.remove('has-img');
        }
        logo.style.background = '';
      }
    }
  }

  /** 当前主题的吉祥物（没有则返回空串） */
  function mascotSrc() {
    return Theme.mascotOf(Store.settings().themeId);
  }

  /**
   * 首页欢迎条 / 左上角共用的图标。
   * 优先级：用户自定义图片 > 当前主题的吉祥物 > 空（用默认表情）
   */
  function brandIconSrc() {
    var s = Store.settings();
    if (s.brandIcon) {
      var data = Store.images.load(s.brandIcon);
      if (data) return data;
    }
    return mascotSrc();
  }

  /** 自定义图标当前用的背景（transparent / 颜色值 / 空表示跟随主题） */
  function brandIconBackground() {
    var s = Store.settings();
    if (!s.brandIcon) return '';
    var bg = s.brandIconBg || 'accent';
    if (bg === 'transparent') return 'transparent';
    if (bg === 'white') return '#FFFFFF';
    if (bg === 'dark') return '#1A1F27';
    if (bg === 'custom') return normalizeHex(s.brandIconBgColor);
    return 'var(--accent)';
  }

  /* ------------------------------------------------------ Toast */

  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('on');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('on'); }, 2000);
  }

  function copyText(text, okMsg) {
    var done = function () { toast(okMsg || '已复制到剪贴板'); };
    if (Store.HAS_NATIVE && Android.copy) {
      try { Android.copy(text); done(); return; } catch (e) { /* fallthrough */ }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { toast('复制失败'); });
      return;
    }
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败'); }
    document.body.removeChild(ta);
  }

  function shareText(text) {
    if (Store.HAS_NATIVE && Android.share) {
      try { Android.share(text); return; } catch (e) { /* ignore */ }
    }
    if (navigator.share) {
      navigator.share({ text: text }).catch(function () {});
      return;
    }
    copyText(text, '已复制（当前环境不支持直接分享）');
  }

  /* ------------------------------------------------------ 弹层 */

  var sheetStack = 0;

  function openSheet(title, html, onMount, footer) {
    var sheet = $('#sheet');
    var mask = $('#sheet-mask');
    var alreadyOpen = sheet.classList.contains('on');
    sheet.innerHTML =
      '<div class="grab"></div>' +
      '<div class="head">' +
        '<h3>' + esc(title) + '</h3>' +
        '<button class="icon-btn" data-act="closeSheet">✕</button>' +
      '</div>' +
      '<div class="content">' + html + '</div>' +
      (footer ? '<div class="sheet-foot">' + footer + '</div>' : '');
    mask.classList.add('on');
    sheet.classList.add('on');
    if (onMount) onMount(sheet);
    // 面板本来就是打开状态时（例如保存分类后回到设置），不要再压一条历史记录，
    // 否则返回键要按很多次才关得掉
    if (!alreadyOpen) {
      try {
        history.pushState({ sheet: true }, '');
        sheetStack++;
      } catch (e) { /* 某些环境不支持，忽略即可 */ }
    }
  }

  function closeSheet(fromPop) {
    var sheet = $('#sheet');
    var mask = $('#sheet-mask');
    if (!sheet.classList.contains('on')) return;
    sheet.classList.remove('on');
    mask.classList.remove('on');
    if (!fromPop && sheetStack > 0) {
      sheetStack--;
      try { history.back(); } catch (e) { /* ignore */ }
    }
    setTimeout(function () {
      if (!sheet.classList.contains('on')) sheet.innerHTML = '';
    }, 300);
  }

  window.addEventListener('popstate', function () {
    if ($('#sheet').classList.contains('on')) {
      if (sheetStack > 0) sheetStack--;
      closeSheet(true);
    }
  });

  /* ------------------------------------------------------ 概览卡 */

  function budgetCard() {
    var b = Store.budget();
    if (!b.hasMonthly && !b.hasDaily) {
      return '' +
        '<div class="card">' +
          '<div class="row-between">' +
            '<div><div style="font-weight:650">还没有设置预算</div>' +
            '<div class="hint" style="margin-top:3px">设定月度额度后即可查看当日剩余可用金额</div></div>' +
            '<button class="btn sm primary" data-act="openSettings">去设置</button>' +
          '</div>' +
        '</div>';
    }

    var over = b.remaining < 0;
    var ratio = Math.max(0, Math.min(100, b.usedRatio * 100));
    var out = '<div class="card">';

    if (b.hasMonthly) {
      out += '<div class="row-between" style="align-items:flex-start">' +
        '<div>' +
          '<div class="hint">本账期剩余</div>' +
          '<div class="budget-value" style="color:' + (over ? 'var(--danger)' : 'var(--text)') + '">' +
            '<span class="cur">¥</span>' + fmt(Math.abs(b.remaining)) +
            (over ? '<span style="font-size:14px;font-weight:600"> 超支</span>' : '') +
          '</div>' +
        '</div>' +
        '<div style="text-align:right">' +
          '<div class="hint">' + esc(b.period.label) + '</div>' +
          '<div class="text-2" style="font-weight:650;margin-top:3px">已花 ¥' + fmt(b.spentPeriod) + '</div>' +
        '</div>' +
      '</div>';

      out += '<div class="progress' + (over ? ' over' : '') + '"><i style="width:' + ratio + '%"></i></div>';
      out += '<div class="row-between hint"><span>预算 ¥' + fmt(b.monthly) + '</span>' +
             '<span>' + (b.usedRatio * 100).toFixed(1) + '%</span></div>';

      out += '<div class="split">' +
        cell('今日剩余额度', '¥' + fmt(b.todayRemaining), b.todayRemaining < 0 ? 'bad' : 'good') +
        cell('今日已花', '¥' + fmt(b.spentToday), '') +
      '</div>';

      if (b.incomePeriod > 0 || b.incomeToday > 0) {
        out += '<div class="split" style="margin-top:10px">' +
          cell('本账期进账', '¥' + fmt(b.incomePeriod), 'good') +
          cell('结余', (b.netPeriod >= 0 ? '+' : '−') + '¥' + fmt(Math.abs(b.netPeriod)),
               b.netPeriod >= 0 ? 'good' : 'bad') +
        '</div>';
      }

      out += '<div class="hint" style="margin-top:10px;line-height:1.7">' +
        '按月度平均：日均可用 <b style="color:var(--text-2)">¥' + fmt(b.dailyAllowance) + '</b>' +
        '，本账期还剩 <b style="color:var(--text-2)">' + b.period.remainingDays + '</b> 天' +
        '（共 ' + b.period.totalDays + ' 天，已过 ' + b.period.elapsedDays + ' 天）<br>' +
        '按当前速度预计本账期共花 <b style="color:' +
          (b.projected > b.monthly ? 'var(--danger)' : 'var(--text-2)') + '">¥' + fmt(b.projected) + '</b>' +
      '</div>';

      if (b.hasDaily) {
        out += '<div class="split" style="margin-top:10px">' +
          cell('今日剩余（按日额度）', '¥' + fmt(b.todayRemainingByDay),
               b.todayRemainingByDay < 0 ? 'bad' : 'good') +
          cell('日额度', '¥' + fmt(b.daily), '') +
        '</div>';
      }
    } else {
      out += '<div class="row-between"><div class="hint">仅设置了日额度</div>' +
             '<button class="btn sm" data-act="openSettings">修改</button></div>' +
             '<div class="split" style="margin-top:10px">' +
             cell('今日剩余', '¥' + fmt(b.todayRemainingByDay), b.todayRemainingByDay < 0 ? 'bad' : 'good') +
             cell('今日已花', '¥' + fmt(b.spentToday), '') + '</div>';
    }

    out += '</div>';
    return out;

    function cell(k, v, cls) {
      return '<div class="cell"><div class="k">' + esc(k) + '</div>' +
             '<div class="v ' + cls + '">' + esc(v) + '</div></div>';
    }
  }

  /* ------------------------------------------------------ 视图：记账 */

  /** 当前分类列表（内置 + 自定义） */
  function catsFor(kind) {
    var list = Classify.list(kind).slice();
    Store.customCategories(kind).forEach(function (c) {
      list.push({ id: c.id, name: c.name, icon: c.icon, color: c.color, kind: kind, custom: true });
    });
    return list;
  }

  /** 通用「记一笔」表单，支出与进账共用 */
  function entryForm(kind) {
    var isIncome = kind === 'income';
    var st = isIncome ? S.income : S.form;
    var bind = isIncome ? 'income' : 'form';
    var otherId = isIncome ? 'other_income' : 'other';

    var auto = st.content ? Store.suggestCategory(st.content, st.note, kind) : null;
    var activeCat = st.catLocked && st.category ? st.category
                  : (auto && auto.category.id) || st.category || otherId;

    var chips = catsFor(kind).map(function (c) {
      return '<button class="chip' + (c.id === activeCat ? ' active' : '') +
             '" data-act="pickCat" data-id="' + c.id + '" data-kind="' + kind + '">' +
             '<span>' + c.icon + '</span>' + esc(c.name) + '</button>';
    }).join('');

    var suggestInner = '';
    if (auto && auto.category.id !== otherId && auto.confidence > 0) {
      var tag = auto.source === 'learned' ? '🧠 按你的习惯归到'
              : (auto.source === 'custom' ? '🏷️ 匹配自定义分类' : '🤖 自动识别为');
      suggestInner = '<span class="auto-tag">' + tag + ' ' + auto.category.icon + ' ' +
        esc(auto.category.name) + ' · 置信度 ' + Math.round(auto.confidence * 100) + '%</span>';
    }
    var suggest = '<div id="suggest-' + kind + '" style="margin-top:9px;display:' +
        (suggestInner ? '' : 'none') + '">' + suggestInner + '</div>' +
      (st.catLocked
        ? '<div style="margin-top:9px"><button class="btn sm ghost" data-act="unlockCat" ' +
          'data-kind="' + kind + '">🤖 恢复自动识别</button></div>'
        : '');

    return '' +
      '<div class="amount-wrap">' +
        '<span class="cur">' + (isIncome ? '+¥' : '¥') + '</span>' +
        '<input class="amount-input num" type="text" inputmode="decimal" placeholder="0.00" ' +
          'data-bind="' + bind + '.amount" value="' + esc(st.amount) + '" />' +
      '</div>' +

      '<div class="field" style="margin-top:14px">' +
        '<label>' + (isIncome ? '进账项目 / 来源' : '花费项目 / 内容') + '</label>' +
        '<input class="input" type="text" placeholder="' +
          (isIncome ? '例如：10 月工资、报销差旅费、收红包' : '例如：公司楼下快餐、京东买纸巾') +
          '" data-bind="' + bind + '.content" value="' + esc(st.content) + '" />' +
        suggest +
      '</div>' +

      '<div class="field">' +
        '<label>' + (isIncome ? '进账分类' : '花费分类') +
          (st.catLocked ? '（已手动指定）' : '（自动归档，可点击修改）') + '</label>' +
        '<div class="chips scroll">' + chips + '</div>' +
      '</div>' +

      '<div class="input-row field">' +
        '<div><label>日期</label><input class="input" type="date" data-bind="' + bind +
          '.date" value="' + esc(st.date) + '" /></div>' +
        '<div><label>时间</label><input class="input" type="time" data-bind="' + bind +
          '.time" value="' + esc(st.time) + '" /></div>' +
      '</div>' +

      '<div class="field">' +
        '<label>备注备忘录（可选）</label>' +
        '<textarea class="textarea" placeholder="' +
          (isIncome ? '记点什么，比如：哪家公司发的、什么名目…'
                    : '记点什么，比如：和谁一起、为什么买、下次是否还要买…') +
          '" data-bind="' + bind + '.note">' + esc(st.note) + '</textarea>' +
      '</div>' +

      '<button class="btn primary block lg" data-act="save" data-kind="' + kind + '">' +
        (isIncome ? '保存这笔进账' : '保存这笔支出') +
      '</button>';
  }

  /**
   * 首页顶部的欢迎条。
   * 文字与图标都可以由用户自己改（见「编辑」按钮）。
   */
  function heroCard() {
    var s = Store.settings();
    var p = Theme.presetOf(s.themeId);
    var title = String(s.brandTitle || '').trim() || p.name;
    var desc = String(s.brandDesc || '').trim() ||
               (p.desc || '');
    var icon = brandIconSrc();
    var bg = brandIconBackground();

    return '<div class="hero">' +
      (icon
        ? '<span class="hero-ico" style="background:' + (bg || 'transparent') + '">' +
          '<img src="' + icon + '" alt="" /></span>'
        : '<span class="hero-ico">💰</span>') +
      '<div class="ht">' +
        '<div class="h1">' + esc(title) + '</div>' +
        '<div class="h2">' + esc(desc) + '</div>' +
      '</div>' +
      '<button class="icon-btn" data-act="editHero" title="编辑文字和图标">✏️</button>' +
    '</div>';
  }

  function renderAdd() {
    var recent = Store.query({}).slice(0, 5);

    return heroCard() +
      payBannerHtml() +
      budgetCard() +

      '<div class="card">' +
        '<div class="card-head"><h3>✏️ 记一笔支出</h3><span class="spacer"></span>' +
          '<span class="hint">' + esc(S.form.date) + '</span></div>' +
        entryForm('expense') +
      '</div>' +

      // 进账和支出一样直接展开，不需要再点一下
      '<div class="card">' +
        '<div class="card-head"><h3>💰 记一笔进账</h3><span class="spacer"></span>' +
          '<span class="hint">' + esc(S.income.date) + '</span></div>' +
        entryForm('income') +
      '</div>' +

      '<button class="btn block" style="margin-bottom:12px" data-act="openBillImport">' +
        '📷 从账单截图 / 文本导入</button>' +

      (recent.length ?
        '<div class="card tight">' +
          '<div class="card-head"><h3>最近记录</h3><span class="spacer"></span>' +
            '<button class="btn sm ghost" data-act="tab" data-tab="list">全部 ›</button></div>' +
          '<div class="items">' + recent.map(itemRow).join('') + '</div>' +
        '</div>' : '');
  }

  function itemRow(r) {
    var c = Store.catMeta(r.category);
    var isIncome = r.type === 'income';
    var picking = S.list.editMode && S.tab === 'list' && S.list.view === 'list';
    var on = picking && !!S.list.selected[r.id];

    return '<div class="item' + (on ? ' on' : '') + '" data-act="' +
      (picking ? 'pickRecord' : 'openRecord') + '" data-id="' + r.id + '">' +
      (picking ? '<div class="pick">✓</div>' : '') +
      '<div class="ico' + (isIncome ? ' income' : '') + '" style="background:' +
        Charts.hexA(c.color, 0.16) + '">' + c.icon + '</div>' +
      '<div class="mid">' +
        '<div class="t1">' + esc(r.content || '未填写') + '</div>' +
        '<div class="t2">' + esc(c.name) + ' · ' + esc(r.time || '') +
          (isIncome ? ' · <span style="color:var(--accent)">进账</span>' : '') +
          (r.note ? ' · ' + esc(r.note) : '') + '</div>' +
      '</div>' +
      '<div class="amt ' + (isIncome ? 'income' : 'expense') + '">' +
        (isIncome ? '+' : '-') + '¥' + fmt(r.amount) + '</div>' +
    '</div>';
  }

  /** 明细页底部的批量操作条（放在 #view 外面，始终贴在底部） */
  function renderBulkBar() {
    var bar = $('#bulkbar');
    if (!bar) return;
    var on = S.tab === 'list' && S.list.view === 'list' && S.list.editMode;
    if (!on) {
      bar.hidden = true;
      bar.innerHTML = '';
      return;
    }
    var n = 0;
    Object.keys(S.list.selected).forEach(function (k) { if (S.list.selected[k]) n++; });
    bar.hidden = false;
    bar.innerHTML =
      '<button class="btn sm" data-act="pickAll">全选</button>' +
      '<span class="cnt">已选 <b>' + n + '</b> 笔</span>' +
      '<button class="btn sm danger" data-act="delPicked"' +
        (n ? '' : ' disabled') + '>删除</button>' +
      '<button class="btn sm" data-act="exitEdit">完成</button>';
  }

  /* ------------------------------------------------------ 视图：明细 */

  function rangeChips(state, actName) {
    var opts = [
      ['today', '今日'], ['week', '本周'], ['month', '本账期'],
      ['year', '今年'], ['all', '全部'], ['custom', '自定义']
    ];
    return '<div class="chips scroll" style="margin-bottom:10px">' +
      opts.map(function (o) {
        return '<button class="chip' + (state.range === o[0] ? ' active' : '') +
               '" data-act="' + actName + '" data-range="' + o[0] + '">' + o[1] + '</button>';
      }).join('') + '</div>';
  }

  function customRangeInputs(state, actName) {
    if (state.range !== 'custom') return '';
    return '<div class="input-row" style="margin-bottom:10px">' +
      '<input class="input" type="date" data-rangefrom="' + actName + '" value="' + esc(state.from) + '" />' +
      '<input class="input" type="date" data-rangeto="' + actName + '" value="' + esc(state.to) + '" />' +
    '</div>';
  }

  function renderList() {
    var viewToggle = '<div class="seg" style="margin-bottom:12px">' +
      '<button class="' + (S.list.view === 'list' ? 'active' : '') +
        '" data-act="listView" data-view="list">📋 列表</button>' +
      '<button class="' + (S.list.view === 'calendar' ? 'active' : '') +
        '" data-act="listView" data-view="calendar">📅 日历</button>' +
      '</div>';

    /* ---------- 日历视图 ---------- */
    if (S.list.view === 'calendar') {
      if (!S.cal) S.cal = Calendar.initial();
      S.cal.mode = Store.settings().calendarMode || 'budget';
      var modeSeg = '<div class="seg" style="margin-bottom:12px">' +
        '<button class="' + (S.cal.mode === 'budget' ? 'active' : '') +
          '" data-act="calMode" data-mode="budget">按预算余额</button>' +
        '<button class="' + (S.cal.mode === 'expense' ? 'active' : '') +
          '" data-act="calMode" data-mode="expense">按支出金额</button>' +
        '</div>';
      return payBannerHtml() + viewToggle + modeSeg +
        '<div class="card">' + Calendar.render(S.cal, itemRow) + '</div>' +
        '<button class="btn block" data-act="openBillImport">📷 从账单截图 / 文本导入</button>';
    }

    /* ---------- 列表视图 ---------- */
    var res = recordsFor(S.list);
    var list = res.list;
    var expense = Store.sumExpense(list);
    var income = Store.sumIncome(list);
    var groups = Store.groupByDay(list);

    var body = groups.length ? groups.map(function (g) {
      var head = '';
      if (g.income > 0) {
        head += '<span style="color:var(--accent)">+¥' + fmt(g.income) + '</span> ';
      }
      if (g.expense > 0) {
        head += '−¥' + fmt(g.expense);
      }
      if (!head) head = '¥0.00';
      return '<div class="day-group">' +
        '<div class="day-head">' +
          '<span class="d">' + esc(g.date) + ' ' + esc(U.weekday(g.date)) + '</span>' +
          '<span class="t">' + head + '</span>' +
        '</div>' +
        '<div class="items">' + g.items.map(itemRow).join('') + '</div>' +
      '</div>';
    }).join('')
    : '<div class="empty"><div class="e">🗒️</div><div class="t">这个范围内还没有记录</div>' +
      '<div class="s">去「记账」页面记录第一笔，或从账单截图导入</div></div>';

    var summary = '';
    if (list.length) {
      summary = '<div class="summary-bar">' +
        '<span class="muted">' + esc(res.range.label) + ' · 共 ' + list.length + ' 笔</span>' +
        '<b>−¥' + fmt(expense) +
          (income > 0
            ? ' <span style="color:var(--accent);font-size:13px">+¥' + fmt(income) + '</span>'
            : '') +
        '</b>' +
      '</div>';
    }

    return payBannerHtml() + viewToggle +
      rangeChips(S.list, 'listRange') +
      customRangeInputs(S.list, 'list') +
      '<div class="field" style="margin-bottom:12px">' +
        '<input class="input" type="search" placeholder="🔍 搜索内容、备注或分类" ' +
          'data-bind="list.keyword" value="' + esc(S.list.keyword) + '" />' +
      '</div>' +

      summary +

      (list.length ?
        '<div class="btn-row" style="margin-bottom:13px">' +
          '<button class="btn sm" data-act="exportList">📄 生成文本记录</button>' +
          '<button class="btn sm" data-act="tab" data-tab="stats">📊 看统计</button>' +
          '<button class="btn sm" data-act="enterEdit">' +
            (S.list.editMode ? '✅ 退出多选' : '☑️ 批量删除') + '</button>' +
        '</div>' : '') +

      body;
  }

  /* ------------------------------------------------------ 视图：统计 */

  function renderStats() {
    var res = recordsFor(S.stat);
    var list = res.list;
    var isIncome = S.stat.kind === 'income';
    var total = isIncome ? Store.sumIncome(list) : Store.sumExpense(list);
    var expense = Store.sumExpense(list);
    var income = Store.sumIncome(list);
    var net = Math.round((income - expense) * 100) / 100;
    var cats = Store.categoryTotals(list, S.stat.kind);

    var days = {};
    list.forEach(function (r) {
      if ((r.type === 'income') === isIncome) days[r.date] = 1;
    });
    var dayCount = Object.keys(days).length || 0;
    var avg = dayCount ? total / dayCount : 0;

    var kindSeg = '<div class="seg" style="margin-bottom:12px">' +
      '<button class="' + (!isIncome ? 'active' : '') +
        '" data-act="statKind" data-kind="expense">支出分析</button>' +
      '<button class="' + (isIncome ? 'active' : '') +
        '" data-act="statKind" data-kind="income">进账分析</button>' +
      '</div>';

    /* 主图 */
    var chartHtml;
    var legendHtml = '';
    if (S.stat.mode === 'category') {
      chartHtml = '<canvas id="mainChart"></canvas>';
      if (cats.length) {
        legendHtml = '<div class="legend">' + cats.map(function (c) {
          var pct = total > 0 ? (c.value / total * 100) : 0;
          return '<div class="row tap" data-act="catDetail" data-id="' + c.id + '">' +
            '<span class="sw" style="background:' + c.color + '"></span>' +
            '<span class="nm">' + c.icon + ' ' + esc(c.name) + '</span>' +
            '<span class="pc">' + pct.toFixed(1) + '%</span>' +
            '<span class="vl num">¥' + fmt(c.value) + '</span>' +
            '<span class="go">›</span>' +
          '</div>';
        }).join('') + '</div>';
      }
    } else {
      chartHtml = '<canvas id="mainChart"></canvas>';
    }

    var modes = [['category', '分类占比'], ['date', '按日'], ['month', '按月'], ['trend', '趋势']];
    var modeChips = '<div class="chips scroll" style="margin-bottom:12px">' +
      modes.map(function (m) {
        return '<button class="chip' + (S.stat.mode === m[0] ? ' active' : '') +
               '" data-act="statMode" data-mode="' + m[0] + '">' + m[1] + '</button>';
      }).join('') + '</div>';

    var rank = '';
    if (cats.length) {
      var max = cats[0].value || 1;
      rank = '<div class="card">' +
        '<div class="card-head"><h3>分类排行</h3><span class="spacer"></span>' +
          '<span class="hint">点分类看明细</span></div>' +
        '<div class="rank">' + cats.map(function (c) {
          return '<div class="r tap" data-act="catDetail" data-id="' + c.id + '">' +
            '<div class="top">' +
              '<span>' + c.icon + '</span><span class="nm">' + esc(c.name) + '</span>' +
              '<span class="vl num">¥' + fmt(c.value) + '</span>' +
              '<span class="go">›</span>' +
            '</div>' +
            '<div class="bar"><i style="width:' + (c.value / max * 100) + '%;background:' + c.color + '"></i></div>' +
          '</div>';
        }).join('') + '</div>' +
      '</div>';
    }

    // 日 / 周 / 月 / 年 可以前后翻到任意一段
    var canNavigate = (S.stat.range === 'today' || S.stat.range === 'week' ||
                       S.stat.range === 'month' || S.stat.range === 'year');
    var periodNav = canNavigate
      ? '<div class="period-nav">' +
          '<button class="pn-btn" data-act="statPrev" title="上一段">‹</button>' +
          '<div class="pn-label">' +
            '<div class="pn-main">' + esc(res.range.label) + '</div>' +
            '<div class="pn-sub">' + esc(res.range.from) + ' ~ ' + esc(res.range.to) +
              ' · 共 ' + list.length + ' 笔</div>' +
          '</div>' +
          '<button class="pn-btn" data-act="statNext" title="下一段">›</button>' +
        '</div>' +
        (S.stat.anchor ? '<div style="text-align:center;margin:-6px 0 12px">' +
          '<button class="btn sm ghost" data-act="statNow">回到当前</button></div>' : '')
      : '';

    return kindSeg +
      rangeChips(S.stat, 'statRange') +
      periodNav +
      customRangeInputs(S.stat, 'stat') +

      '<div class="stat-grid">' +
        '<div class="s"><div class="k">' + (isIncome ? '合计进账' : '合计支出') + '</div>' +
          '<div class="v num">¥' + fmt(total) + '</div></div>' +
        '<div class="s"><div class="k">笔数</div><div class="v num">' +
          list.filter(function (r) { return (r.type === 'income') === isIncome; }).length +
        '</div></div>' +
        '<div class="s"><div class="k">日均</div><div class="v num">¥' + fmt(avg) + '</div></div>' +
      '</div>' +

      (income > 0 ?
        '<div class="stat-grid" style="grid-template-columns:1fr 1fr">' +
          '<div class="s"><div class="k">收入合计</div><div class="v num" style="color:var(--accent)">¥' +
            fmt(income) + '</div></div>' +
          '<div class="s"><div class="k">结余</div><div class="v num" style="color:' +
            (net >= 0 ? 'var(--accent)' : 'var(--danger)') + '">' +
            (net >= 0 ? '+' : '−') + '¥' + fmt(Math.abs(net)) + '</div></div>' +
        '</div>' : '') +

      (total > 0 ? modeChips : '') +

      '<div class="card">' +
        '<div class="card-head"><h3>' +
          (S.stat.mode === 'category' ? (isIncome ? '进账结构' : '支出结构') :
           S.stat.mode === 'date' ? (isIncome ? '每日进账' : '每日支出') :
           S.stat.mode === 'month' ? (isIncome ? '每月进账' : '每月支出') :
           (isIncome ? '进账趋势' : '支出趋势')) +
        '</h3><span class="spacer"></span>' +
        '<span class="hint">' + esc(res.range.label) + '</span></div>' +
        chartHtml + legendHtml +
      '</div>' +

      rank +

      (list.length ?
        '<div class="btn-row" style="margin-top:2px">' +
          '<button class="btn block" data-act="exportList">📄 导出文本记录</button>' +
        '</div>'
        : '<div class="empty"><div class="e">📊</div><div class="t">该时间段没有数据</div>' +
          '<div class="s">换一个时间范围试试</div></div>');

  }

  function drawStatsChart() {
    var canvas = $('#mainChart');
    if (!canvas) return;
    var res = recordsFor(S.stat);
    var list = res.list;
    var isIncome = S.stat.kind === 'income';
    var cats = Store.categoryTotals(list, S.stat.kind);

    if (S.stat.mode === 'category') {
      Charts.donut(canvas, cats, {
        height: 216,
        centerLabel: isIncome ? '合计进账' : '合计支出'
      });
    } else if (S.stat.mode === 'month') {
      var months = Store.monthlyTotals(list).map(function (m) {
        return { key: m.key, label: m.label, value: isIncome ? m.income : m.expense };
      });
      Charts.bars(canvas, months, { height: 236, showValues: false });
    } else if (S.stat.mode === 'trend') {
      var days = Store.dailyTotals(list, res.range.from, res.range.to);
      if (!res.range.from) days = Store.dailyTotals(list, '', '');
      Charts.line(canvas, days.map(function (d) {
        return { key: d.key, label: d.label, value: isIncome ? d.income : d.expense };
      }), { height: 216 });
    } else {
      var d2 = Store.dailyTotals(list, res.range.from, res.range.to);
      if (!res.range.from && d2.length > 40) d2 = d2.slice(-40);
      Charts.bars(canvas, d2.map(function (d) {
        return { key: d.key, label: d.label, value: isIncome ? d.income : d.expense };
      }), { height: 236, showValues: false });
    }
  }

  /* ------------------------------------------------------ 视图：目标 */

  function goalCard(g) {
    var pct = g.target > 0 ? Math.min(100, g.saved / g.target * 100) : 0;
    var done = g.target > 0 && g.saved >= g.target;
    var img = g.imageId ? Store.images.load(g.imageId) : '';
    var cover = img
      ? '<div class="cover"><img src="' + img + '" alt="" />' +
        (done ? '<span class="badge">🎉 已达成</span>' : '') + '</div>'
      : '<div class="cover"><span class="ph">' + (done ? '🎉' : '🐷') + '</span>' +
        (done ? '<span class="badge">已达成</span>' : '') + '</div>';

    return '<div class="goal">' + cover +
      '<div class="body">' +
        '<div class="row-between">' +
          '<h4>' + esc(g.title) + '</h4>' +
          '<span class="pill' + (done ? ' ok' : '') + '">' + pct.toFixed(0) + '%</span>' +
        '</div>' +
        (g.deadline ? '<div class="hint">目标日期 ' + esc(g.deadline) + '</div>' : '') +
        '<div class="nums"><span class="now num">¥' + fmt(g.saved) + '</span>' +
          '<span class="of">/ ¥' + fmt(g.target) + '</span></div>' +
        '<div class="progress"><i style="width:' + pct + '%;' +
          (done ? 'background:linear-gradient(90deg,#FFC42E,#17BE8B)' : '') + '"></i></div>' +
        (g.text ? '<div class="desc">' + esc(g.text) + '</div>' : '') +
        '<div class="btn-row" style="margin-top:12px">' +
          '<button class="btn sm primary" data-act="deposit" data-id="' + g.id + '">💰 存入</button>' +
          '<button class="btn sm" data-act="editGoal" data-id="' + g.id + '">编辑</button>' +
          '<button class="btn sm danger" data-act="delGoal" data-id="' + g.id + '">删除</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function renderGoals() {
    var goals = Store.goals();
    var totalTarget = goals.reduce(function (a, g) { return a + g.target; }, 0);
    var totalSaved = goals.reduce(function (a, g) { return a + g.saved; }, 0);

    return (goals.length ?
      '<div class="stat-grid" style="grid-template-columns:1fr 1fr">' +
        '<div class="s"><div class="k">目标总额</div><div class="v num">¥' + fmt(totalTarget) + '</div></div>' +
        '<div class="s"><div class="k">已存</div><div class="v num" style="color:var(--accent)">¥' + fmt(totalSaved) + '</div></div>' +
      '</div>' : '') +

      '<button class="btn primary block lg" style="margin-bottom:13px" data-act="newGoal">＋ 新建省钱目标</button>' +

      (goals.length ? goals.map(goalCard).join('')
        : '<div class="empty"><div class="e">🎯</div><div class="t">还没有省钱目标</div>' +
          '<div class="s">设定一个目标，配上图片和文字，存钱更有动力</div></div>');
  }

  /* ------------------------------------------------------ 视图：AI */

  function renderAI() {
    var configured = AI.isConfigured();
    var s = Store.settings().llm;
    var res = recordsFor(S.ai);
    var recs = res.list;

    var mSrc = mascotSrc();
    var head = '<div class="card">' +
      '<div class="row-between">' +
        '<div>' +
          '<div style="font-weight:650">' +
            (mSrc ? '<img class="ai-avatar" src="' + mSrc + '" alt="" />' : '') +
            '大模型分析' +
            '<span class="pill ' + (configured ? 'ok' : 'no') + '" style="margin-left:7px">' +
            (configured ? '已配置' : '未配置') + '</span></div>' +
          '<div class="hint" style="margin-top:4px">' +
            (configured ? esc(s.model) + ' · ' + esc(AI.resolveEndpoint(s.base))
                        : '填写 API 地址与模型后即可分析消费记录') +
          '</div>' +
        '</div>' +
        '<button class="btn sm ' + (configured ? '' : 'primary') + '" data-act="openSettings">配置</button>' +
      '</div>' +
    '</div>';

    if (!configured) {
      return head +
        '<div class="card">' +
          '<div class="card-head"><h3>支持的接口</h3></div>' +
          '<div class="hint" style="line-height:1.9">' +
            '内置预设：DeepSeek、OpenAI、Kimi、通义千问、智谱 GLM、硅基流动、OpenRouter、' +
            '以及本地 Ollama / LM Studio / One-API。<br>' +
            '只要兼容 OpenAI 的 <code>/v1/chat/completions</code> 接口即可直接使用。' +
          '</div>' +
        '</div>';
    }

    var quick = '<div class="card">' +
      '<div class="card-head"><h3>快捷提问</h3></div>' +
      '<div class="chips">' + AI.QUICK_PROMPTS.map(function (p, i) {
        return '<button class="chip" data-act="quickAsk" data-i="' + i + '">' +
               p.icon + ' ' + esc(p.title) + '</button>';
      }).join('') + '</div>' +
    '</div>';

    var scope = '<div class="card tight">' +
      '<div class="card-head"><h3>分析的数据范围</h3><span class="spacer"></span>' +
        '<span class="hint">' + recs.length + ' 笔 · ¥' + fmt(Store.sumAmount(recs)) + '</span></div>' +
      rangeChips(S.ai, 'aiRange') +
      customRangeInputs(S.ai, 'ai') +
      (recs.length === 0 ? '<div class="hint" style="color:var(--warn)">该范围内没有记录，请调整范围</div>' : '') +
    '</div>';

    var history = Store.chats();
    var chat = '<div class="chat" id="chat">' +
      (history.length ? history.map(function (m) {
        return '<div class="msg ' + (m.role === 'user' ? 'user' : 'assistant') + '">' +
               esc(plainText(m.content)) + '</div>';
      }).join('')
        : '<div class="msg assistant plain">' +
          (S.ai.cleared
            ? '对话记忆已清空。选择上面的快捷提问，或在下方输入新的问题。'
            : '选择上面的快捷提问，或在下方输入你的问题。' +
              'AI 会读取你选定范围内的记账文本记录进行分析。') +
          '</div>') +
    '</div>' +
    (history.length ? '<div style="text-align:center;margin-bottom:12px">' +
      '<button class="btn sm ghost" data-act="clearChat">🧹 清空全部对话记忆</button>' +
    '</div>' : '');

    var input = '<div class="card tight">' +
      '<div class="field" style="margin-bottom:9px">' +
        '<textarea class="textarea" id="aiQ" placeholder="例如：帮我找出这个月不必要的花费，能省多少钱？" ' +
          'style="min-height:64px">' + esc(S.ai.question) + '</textarea>' +
      '</div>' +
      '<div class="btn-row">' +
        '<button class="btn primary" data-act="ask" id="askBtn">🚀 开始分析</button>' +
        '<button class="btn" data-act="stopAsk" id="stopBtn" style="display:none">停止</button>' +
      '</div>' +
    '</div>';

    return head + scope + quick + chat + input;
  }

  /* ------------------------------------------------------ 渲染入口 */

  var TABS = [
    { id: 'add', icon: '✏️', label: '记账' },
    { id: 'list', icon: '📋', label: '明细' },
    { id: 'stats', icon: '📊', label: '统计' },
    { id: 'goals', icon: '🎯', label: '目标' },
    { id: 'ai', icon: '🤖', label: 'AI 分析' }
  ];

  function renderTabBar() {
    var bar = $('#tabbar');
    bar.innerHTML = TABS.map(function (t) {
      return '<button data-act="tab" data-tab="' + t.id + '"' +
             (S.tab === t.id ? ' class="active"' : '') + '>' +
             '<span class="ti">' + t.icon + '</span><span>' + t.label + '</span></button>';
    }).join('');
  }

  var scrollPos = {};

  function render(keepScroll) {
    var view = $('#view');
    scrollPos[S.tab] = keepScroll ? view.scrollTop : 0;

    applyTheme();
    renderTabBar();

    var html;
    if (S.tab === 'add') html = renderAdd();
    else if (S.tab === 'list') html = renderList();
    else if (S.tab === 'stats') html = renderStats();
    else if (S.tab === 'goals') html = renderGoals();
    else html = renderAI();

    view.innerHTML = html;

    if (S.tab === 'stats') drawStatsChart();
    renderBulkBar();

    view.scrollTop = 0;
  }

  function switchTab(id) {
    if (S.tab === id) { render(false); return; }
    S.tab = id;
    render(false);
  }

  /* ------------------------------------------------------ 记录详情节 */

  function openRecord(id) {
    var r = Store.getRecord(id);
    if (!r) return;
    var c = Store.catMeta(r.category);
    var isIncome = r.type === 'income';

    var catOptions = catsFor(r.type).map(function (x) {
      return '<option value="' + x.id + '"' + (x.id === r.category ? ' selected' : '') + '>' +
             x.icon + ' ' + esc(x.name) + '</option>';
    }).join('');

    var html = '' +
      '<div class="card tight" style="margin-bottom:12px">' +
        '<div style="display:flex;gap:12px;align-items:center">' +
          '<div style="width:46px;height:46px;border-radius:13px;display:grid;place-items:center;' +
            'font-size:21px;background:' + Charts.hexA(c.color, 0.16) + '">' + c.icon + '</div>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:17px;font-weight:700">' + esc(r.content || '未填写') + '</div>' +
            '<div class="hint">' + esc(c.name) + ' · ' + esc(r.date) + ' ' +
              esc(U.weekday(r.date)) + ' ' + esc(r.time) +
              (isIncome ? ' · <span style="color:var(--accent)">进账</span>' : '') + '</div>' +
          '</div>' +
          '<div class="num" style="font-size:23px;font-weight:750;color:' +
            (isIncome ? 'var(--accent)' : 'inherit') + '">' +
            (isIncome ? '+' : '-') + '¥' + fmt(r.amount) + '</div>' +
        '</div>' +
        (r.note ? '<div class="divider"></div><div class="hint" style="margin-bottom:5px">备注备忘录</div>' +
          '<div class="text-2" style="white-space:pre-wrap">' + esc(r.note) + '</div>' : '') +
      '</div>' +

      '<div class="sec-title">修改</div>' +
      '<div class="field"><label>类型</label>' +
        '<div class="seg">' +
          '<button class="' + (!isIncome ? 'active' : '') +
            '" data-act="edType" data-type="expense">支出</button>' +
          '<button class="' + (isIncome ? 'active' : '') +
            '" data-act="edType" data-type="income">进账</button>' +
        '</div>' +
        '<input type="hidden" id="ed-type" value="' + (isIncome ? 'income' : 'expense') + '" />' +
      '</div>' +
      '<div class="field"><label>金额</label>' +
        '<input class="input num" type="text" inputmode="decimal" id="ed-amount" value="' +
          esc(r.amount) + '" /></div>' +
      '<div class="field"><label>内容</label>' +
        '<input class="input" type="text" id="ed-content" value="' + esc(r.content) + '" /></div>' +
      '<div class="field"><label>分类</label>' +
        '<select class="select" id="ed-cat">' + catOptions + '</select>' +
        '<button class="btn sm ghost" style="margin-top:8px" data-act="reclassify" data-id="' +
          r.id + '">🤖 按内容重新自动识别</button>' +
        '<div class="hint" style="margin-top:7px">手动改分类后，下次输入相同或相似内容会自动归到这里。</div>' +
      '</div>' +
      '<div class="input-row field">' +
        '<div><label>日期</label><input class="input" type="date" id="ed-date" value="' +
          esc(r.date) + '" /></div>' +
        '<div><label>时间</label><input class="input" type="time" id="ed-time" value="' +
          esc(r.time) + '" /></div>' +
      '</div>' +
      '<div class="field"><label>备注备忘录</label>' +
        '<textarea class="textarea" id="ed-note">' + esc(r.note) + '</textarea></div>' +

      '<div class="btn-row">' +
        '<button class="btn primary" data-act="saveRecord" data-id="' + r.id + '">保存修改</button>' +
        '<button class="btn" data-act="copyRecord" data-id="' + r.id + '">复制记录</button>' +
        '<button class="btn danger" data-act="delRecord" data-id="' + r.id + '">删除</button>' +
      '</div>';

    openSheet(isIncome ? '进账详情' : '记录详情', html);
  }

  /* ------------------------------------------------------ 目标编辑 */

  function openGoalEditor(goal) {
    var g = goal || { id: '', title: '', target: '', saved: '', deadline: '', text: '', imageId: '' };
    var S_ = S;
    S_.goalDraft = { imageData: '', imageId: g.imageId || '' };

    var img = g.imageId ? Store.images.load(g.imageId) : '';
    if (img) S_.goalDraft.imageData = img;

    var html = '' +
      '<div class="field"><label>目标名称</label>' +
        '<input class="input" type="text" id="g-title" placeholder="例如：存钱买相机 / 半年攒 2 万" value="' + esc(g.title) + '" /></div>' +

      '<div class="input-row field">' +
        '<div><label>目标金额</label>' +
          '<input class="input num" type="text" inputmode="decimal" id="g-target" placeholder="10000" value="' + esc(g.target || '') + '" /></div>' +
        '<div><label>已存金额</label>' +
          '<input class="input num" type="text" inputmode="decimal" id="g-saved" placeholder="0" value="' + esc(g.saved || '') + '" /></div>' +
      '</div>' +

      '<div class="field"><label>目标日期（可选）</label>' +
        '<input class="input" type="date" id="g-deadline" value="' + esc(g.deadline) + '" /></div>' +

      '<div class="field"><label>目标图片（可选）</label>' +
        '<div id="g-imgwrap">' +
          (img ? '<img class="preview-img" id="g-preview" src="' + img + '" />'
               : '<div class="hint" id="g-preview-ph" style="margin-bottom:8px">还没有图片</div>') +
        '</div>' +
        '<div class="btn-row" style="margin-top:9px">' +
          '<button class="btn file-btn">📷 选择图片' +
            '<input type="file" accept="image/*" id="g-file" /></button>' +
          '<button class="btn danger" data-act="clearGoalImage">移除图片</button>' +
        '</div>' +
      '</div>' +

      cropBoxHtml() +

      '<div class="field"><label>文字说明（自由输入）</label>' +
        '<textarea class="textarea" id="g-text" style="min-height:120px" ' +
          'placeholder="写下这个目标的意义、计划、每月要存多少…">' + esc(g.text) + '</textarea></div>' +

      '<div class="btn-row">' +
        '<button class="btn primary" data-act="saveGoal" data-id="' + esc(g.id) + '">保存目标</button>' +
      '</div>';

    openSheet(goal ? '编辑目标' : '新建省钱目标', html, function (root) {
      cropBind(root);
      var file = $('#g-file', root);
      if (!file) return;
      file.addEventListener('change', function (e) {
        var f = e.target.files && e.target.files[0];
        if (!f) return;
        // 目标封面按 16:9 裁剪，用户可以拖动缩放选区域
        loadImageFile(f, 1600, function (dataUrl) {
          if (!dataUrl) { toast('图片读取失败'); return; }
          startCrop('goal', dataUrl, root);
        });
      });
    });
  }

  function shrinkImage(file, maxDim, quality, cb) {
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
          cb(c.toDataURL('image/jpeg', quality));
        } catch (err) {
          cb('');
        }
      };
      img.onerror = function () { cb(''); };
      img.src = e.target.result;
    };
    reader.onerror = function () { cb(''); };
    reader.readAsDataURL(file);
  }

  /* ------------------------------------------------------ 导出文本 */

  function openExport(records, label) {
    var withNote = false;

    function body() {
      var text = Store.toText(records, { includeNote: withNote });
      var total = Store.sumAmount(records);
      return '' +
        '<div class="hint" style="margin-bottom:10px;line-height:1.8">' +
          '范围：<b style="color:var(--text-2)">' + esc(label) + '</b><br>' +
          '共 ' + records.length + ' 笔，合计 <b style="color:var(--text-2)">¥' + fmt(total) + '</b><br>' +
          '格式：<code>【时间】|【花费分类】|【花费内容】|【金额】</code>' +
        '</div>' +
        '<label class="row-between" style="margin-bottom:10px;font-size:13.5px">' +
          '<span>在每条记录后附加备注</span>' +
          '<input type="checkbox" id="exp-note" ' + (withNote ? 'checked' : '') + ' style="width:18px;height:18px" />' +
        '</label>' +
        '<pre class="export" id="exp-text">' + esc(text || '（该范围内没有记录）') + '</pre>' +
        '<div class="btn-row" style="margin-top:12px">' +
          '<button class="btn primary" data-act="doCopyExport">📋 复制全部</button>' +
          '<button class="btn" data-act="doShareExport">📤 分享</button>' +
          '<button class="btn" data-act="doAiExport">🤖 交给 AI 分析</button>' +
        '</div>' +
        '<div class="hint" style="margin-top:10px">提示：这段文本可以直接粘贴给任何 AI 对话框。</div>';
    }

    function reopen() {
      openSheet('文本记录', body(), function (root) {
        var cb = $('#exp-note', root);
        if (cb) cb.addEventListener('change', function () {
          withNote = cb.checked;
          var t = Store.toText(records, { includeNote: withNote });
          $('#exp-text', root).textContent = t || '（该范围内没有记录）';
        });
      });
    }

    reopen();

    S._export = {
      get text() { return Store.toText(records, { includeNote: withNote }); },
      records: records
    };
  }

  /* ------------------------------------------------------ 设置 */

  function openSettings() {
    var s = Store.settings();
    var llm = s.llm;

    var presetOpts = AI.PRESETS.map(function (p) {
      var label = p.name + (p.free ? '  💰' : '');
      return '<option value="' + p.id + '"' + (llm.preset === p.id ? ' selected' : '') + '>' +
        esc(label) + '</option>';
    }).join('');

    var html = '' +
      '<div class="sec-title">预算额度</div>' +
      '<div class="card tight">' +
        '<div class="input-row field">' +
          '<div><label>每月计划额度</label>' +
            '<input class="input num" type="text" inputmode="decimal" id="s-monthly" placeholder="例如 3000" value="' + (s.monthlyBudget || '') + '" /></div>' +
          '<div><label>每日计划额度</label>' +
            '<input class="input num" type="text" inputmode="decimal" id="s-daily" placeholder="可留空" value="' + (s.dailyBudget || '') + '" /></div>' +
        '</div>' +
        '<div class="field"><label>每月起始日（发薪日，1–28）</label>' +
          '<input class="input num" type="text" inputmode="numeric" id="s-start" value="' + (s.monthStartDay || 1) + '" /></div>' +
        '<div class="hint">「当日剩余额度」按月度平均计算：<br>' +
          '（月度额度 − 今日之前的支出）÷ 本账期剩余天数，再减去今日已花。</div>' +
      '</div>' +

      '<div class="sec-title">大模型接口</div>' +
      '<div class="card tight">' +
        '<div class="field"><label>服务商预设</label>' +
          '<select class="select" id="s-preset">' + presetOpts + '</select>' +
          '<div class="hint" id="s-preset-note" style="margin-top:6px">' +
            '带 💰 的是有免费额度的服务商，其中 glm-4v-flash 目前免费。' +
          '</div></div>' +
        '<div class="field"><label>API 地址</label>' +
          '<input class="input" type="text" id="s-base" placeholder="https://api.deepseek.com" value="' + esc(llm.base) + '" />' +
          '<div class="hint" style="margin-top:5px">可填根地址或完整地址，会自动补全 /v1/chat/completions</div></div>' +
        '<div class="field"><label>API Key</label>' +
          '<input class="input" type="text" id="s-key" placeholder="sk-..." value="' + esc(llm.key) + '" />' +
          '<div class="hint" style="margin-top:5px">密钥保存在本机 app 私有目录，不会上传到任何服务器</div></div>' +
        '<div class="field"><label>模型名称</label>' +
          '<input class="input" type="text" id="s-model" placeholder="deepseek-chat" value="' + esc(llm.model) + '" /></div>' +
        '<div class="field"><label>视觉模型（识别账单截图用，可留空）</label>' +
          '<input class="input" type="text" id="s-vmodel" placeholder="例如 glm-4v-flash / qwen-vl-max / doubao-1-5-vision-pro" value="' + esc(llm.visionModel || '') + '" />' +
          '<div class="hint" style="margin-top:5px">' +
            '留空则沿用上面的模型。截图识别需要模型支持读图，纯文本模型不行。<br>' +
            '想不花钱：选「智谱 GLM」用 <code>glm-4v-flash</code>（免费），' +
            '或用 Ollama 在本机跑 <code>qwen2.5vl</code>。' +
          '</div></div>' +
        '<div class="input-row field">' +
          '<div><label>温度 (0–2)</label>' +
            '<input class="input num" type="text" inputmode="decimal" id="s-temp" value="' + (llm.temperature != null ? llm.temperature : 0.6) + '" /></div>' +
          '<div><label>最大输出 tokens</label>' +
            '<input class="input num" type="text" inputmode="numeric" id="s-maxtok" value="' + (llm.maxTokens || 1600) + '" /></div>' +
        '</div>' +
        '<label class="row-between" style="font-size:13.5px;margin-bottom:10px">' +
          '<span>流式输出（逐字显示）</span>' +
          '<input type="checkbox" id="s-stream" ' + (llm.stream ? 'checked' : '') + ' style="width:18px;height:18px" /></label>' +
        '<div class="btn-row">' +
          '<button class="btn" data-act="testApi">🔌 测试连接</button>' +
        '</div>' +
      '</div>' +

      '<div class="sec-title">主题配色</div>' +
      '<div class="theme-grid" id="themeGrid">' +
        Theme.PRESETS.map(function (p) {
          var active = (s.themeId || 'default') === p.id;
          var color = p.id === 'custom' ? normalizeHex(s.themeColor) : p.color;
          return '<div class="theme-card' + (active ? ' active' : '') +
            '" data-act="pickTheme" data-id="' + p.id + '">' +
            '<div class="sw-row">' +
              '<span class="sw" style="background:' + color + '"></span>' +
              '<span class="sw" style="background:' + Theme.shade(color, -0.22) + '"></span>' +
              '<span class="sw" style="background:' + Theme.shade(color, 0.42) + '"></span>' +
            '</div>' +
            '<div class="nm">' + esc(p.name) + '</div>' +
            '<div class="ds">' + esc(p.desc || '') + '</div>' +
            (p.mascot ? '<img class="mk" src="' + p.mascot + '" alt="" />' : '') +
          '</div>';
        }).join('') +
      '</div>' +
      '<input type="hidden" id="s-themeid" value="' + esc(s.themeId || 'default') + '" />' +

      '<div class="card tight" style="margin-top:12px">' +
        '<div class="field"><label>自定义主题色（点色块或直接填色号）</label>' +
          '<div class="color-row">' +
            '<input type="color" id="s-color" value="' + esc(normalizeHex(s.themeColor)) + '" />' +
            '<input class="input" type="text" id="s-colorhex" spellcheck="false" ' +
              'value="' + esc(normalizeHex(s.themeColor)) + '" />' +
          '</div>' +
          '<div class="hint" style="margin-top:7px">改动这里会自动切换到「自定义颜色」主题</div>' +
        '</div>' +
        '<label class="row-between" style="font-size:13.5px;margin-bottom:13px">' +
          '<span>浅色主题（白天模式）</span>' +
          '<input type="checkbox" id="s-light" ' + (s.theme === 'light' ? 'checked' : '') +
          ' style="width:18px;height:18px" /></label>' +

        '<div class="field" style="margin-bottom:0"><label>浅色模式背景（含护眼配色）</label>' +
          '<div class="bg-grid" id="bgGrid">' +
            Theme.LIGHT_PRESETS.map(function (p) {
              var pal = Theme.lightPalette(p.id, s.lightBg);
              var active = (s.lightPreset || 'white') === p.id;
              return '<div class="bg-card' + (active ? ' active' : '') +
                '" data-act="pickLightBg" data-id="' + p.id + '">' +
                '<div class="sw" style="background:' + pal.bg + '">' +
                  '<i style="background:' + pal.card + '"></i></div>' +
                '<div class="nm">' + esc(p.name) + '</div>' +
              '</div>';
            }).join('') +
          '</div>' +
          '<div class="hint" id="bgHint" style="margin-top:9px">' +
            esc(Theme.lightPresetOf(s.lightPreset || 'white').desc || '') +
          '</div>' +
        '</div>' +

        '<div class="field" id="lightBgWrap" style="margin-top:13px;display:' +
          ((s.lightPreset || 'white') === 'custom' ? '' : 'none') + '">' +
          '<label>自定义背景色</label>' +
          '<div class="color-row">' +
            '<input type="color" id="s-lightbg" value="' +
              esc(normalizeHex(s.lightBg || '#FFFFFF')) + '" />' +
            '<input class="input" type="text" id="s-lightbghex" spellcheck="false" ' +
              'value="' + esc(normalizeHex(s.lightBg || '#FFFFFF')) + '" />' +
          '</div>' +
          '<div class="hint" style="margin-top:7px">' +
            '卡片和描边会按这个底色自动推导，保证层次分明；建议选浅色。' +
          '</div>' +
        '</div>' +
      '</div>' +

      bgSettingsHtml() +

      '<div class="sec-title">桌面图标</div>' +
      '<div class="hint" style="margin-bottom:9px">' +
        '点一下即切换。部分手机的桌面需要几秒才刷新，若没变化可回到桌面等一会儿或重启桌面。' +
      '</div>' +
      '<div class="icon-grid" id="iconGrid">' +
        ICON_VARIANTS.map(function (v) {
          var active = (s.launcherIcon || 'whale_q_blue') === v.id;
          // 预览直接用生成好的真实图标（已含背景），所以不再叠一层渐变
          return '<div class="icon-card' + (active ? ' active' : '') +
            '" data-act="pickIcon" data-id="' + v.id + '">' +
            '<div class="prev">' +
              (v.img ? '<img src="' + v.img + '" alt="" />'
                     : '<span style="font-size:24px">' + (v.emoji || '📊') + '</span>') +
            '</div>' +
            '<div class="lbl">' + esc(v.name) + '</div>' +
          '</div>';
        }).join('') +
      '</div>' +
      '<input type="hidden" id="s-icon" value="' + esc(s.launcherIcon || 'whale_q_blue') + '" />' +

      '<div class="sec-title">日历显示规则</div>' +
      '<div class="card tight">' +
        '<div class="seg">' +
          '<button class="' + (s.calendarMode !== 'expense' ? 'active' : '') +
            '" data-act="setCalMode" data-mode="budget">按预算余额</button>' +
          '<button class="' + (s.calendarMode === 'expense' ? 'active' : '') +
            '" data-act="setCalMode" data-mode="expense">按支出金额</button>' +
        '</div>' +
        '<input type="hidden" id="s-calmode" value="' + esc(s.calendarMode || 'budget') + '" />' +
        '<div class="hint" style="margin-top:10px;line-height:1.9">' +
          '<b>按预算余额</b>：以日额度为基准，当天没花完 → 绿色 <b>+剩余</b>；花超了 → 红色 <b>−超出</b>。<br>' +
          '<b>按支出金额</b>：只要当天有支出 → 红色 <b>−金额</b>；进账另行用绿色 <b>+金额</b> 显示。' +
        '</div>' +
      '</div>' +

      '<div class="sec-title">自动记账（微信 / 支付宝）</div>' +
      '<div class="card tight">' + paySettingsInner() + '</div>' +

      '<div class="sec-title">分类管理</div>' +
      '<div class="card tight">' +
        '<div class="hint" style="margin-bottom:9px;line-height:1.8">' +
          '自定义分类可以填关键词；之后输入相同或相似的内容会自动归到这一类。' +
          '另外你每次手动改分类，应用都会记住，下次自动套用。' +
        '</div>' +
        '<div id="catList">' + categoryManagerHtml() + '</div>' +
        '<div class="btn-row" style="margin-top:10px">' +
          '<button class="btn sm primary" data-act="newCat" data-kind="expense">＋ 支出分类</button>' +
          '<button class="btn sm" data-act="newCat" data-kind="income">＋ 进账分类</button>' +
        '</div>' +
      '</div>' +

      '<div class="sec-title">数据</div>' +
      '<div class="card tight">' +
        '<div class="hint" id="s-stat" style="margin-bottom:10px"></div>' +
        '<div class="btn-row">' +
          '<button class="btn" data-act="exportJson">📦 备份数据</button>' +
          '<button class="btn" data-act="importJson">📥 恢复备份</button>' +
          '<button class="btn danger" data-act="clearData">🗑 清空数据</button>' +
        '</div>' +
      '</div>' +

      '<div class="hint" style="text-align:center;margin-top:6px">大肥鱼记账本 v1.6.0 · 数据保存在本机</div>';

    openSheet('设置', html, function (root) {
      var st = Store.stats();
      var statEl = $('#s-stat', root);
      if (statEl) {
        statEl.innerHTML =
          '共 ' + st.count + ' 笔记录<br>' +
          '支出 ¥' + fmt(st.expense) + ' · 进账 ¥' + fmt(st.income) + '<br>' +
          '结余 ' + (st.net >= 0 ? '+' : '−') + '¥' + fmt(Math.abs(st.net)) + '<br>' +
          '自定义分类 ' + st.customCategories + ' 个 · 已学习规则 ' + st.rules + ' 条' +
          (st.firstDate ? '<br>最早记录 ' + st.firstDate : '');
      }

      var preset = $('#s-preset', root);
      if (preset) {
        preset.addEventListener('change', function () {
          var p = AI.PRESETS.filter(function (x) { return x.id === preset.value; })[0];
          if (!p) return;
          if (p.base) $('#s-base', root).value = p.base;
          if (p.model) $('#s-model', root).value = p.model;
          if (p.vision) {
            var vm = $('#s-vmodel', root);
            if (vm) vm.value = p.vision;
          }
          var tip = $('#s-preset-note', root);
          if (tip) {
            tip.textContent = p.note || (p.free
              ? '这家有免费额度，适合用来做账单截图识别。'
              : '');
          }
        });
      }

      // 自定义浅色背景：取色器与色号双向同步，并即时预览
      var lb = $('#s-lightbg', root);
      var lbh = $('#s-lightbghex', root);
      if (lb && lbh) {
        var syncLight = function (val) {
          if (!Theme.isHex(val)) return;
          Store.saveSettings({ lightBg: val, lightPreset: 'custom', theme: 'light' });
          applyTheme();
        };
        lb.addEventListener('input', function () { lbh.value = lb.value; syncLight(lb.value); });
        lbh.addEventListener('input', function () {
          if (/^#[0-9a-fA-F]{6}$/.test(lbh.value)) { lb.value = lbh.value; syncLight(lbh.value); }
        });
      }

      // 浅色主题开关即时预览
      var lightSw = $('#s-light', root);
      if (lightSw) {
        lightSw.addEventListener('change', function () {
          Store.saveSettings({ theme: lightSw.checked ? 'light' : 'dark' });
          applyTheme();
        });
      }

      // 背景图：选图（可拖动缩放裁剪） + 三个滑块，全部即时生效
      cropBind(root);

      var bgFile = $('#bg-file', root);
      if (bgFile) {
        bgFile.addEventListener('change', function (e) {
          var f = e.target.files && e.target.files[0];
          if (!f) return;
          loadImageFile(f, 2000, function (dataUrl) {
            if (!dataUrl) { toast('图片读取失败'); return; }
            startCrop('bg', dataUrl, root);
          });
        });
      }

      function bindBgRange(id, key, labelId, fmt2) {
        var el2 = $('#' + id, root);
        var lb2 = $('#' + labelId, root);
        if (!el2) return;
        el2.addEventListener('input', function () {
          var v = Number(el2.value);
          var patch = { bgCustomStyle: true };   // 用户动过就不再跟随主题预设
          patch[key] = (key === 'bgOpacity' || key === 'bgScale') ? v / 100 : v;
          Store.saveSettings(patch);
          applyAppBg();
          if (lb2) lb2.textContent = fmt2(v);
        });
      }
      bindBgRange('bg-scale', 'bgScale', 'bg-scale-v', function (v) { return v + '%'; });
      bindBgRange('bg-opacity', 'bgOpacity', 'bg-opacity-v', function (v) { return v + '%'; });
      bindBgRange('bg-blur', 'bgBlur', 'bg-blur-v', function (v) { return v + 'px'; });
    }, '<button class="btn primary lg" data-act="saveSettings">保存设置</button>');
  }

  /** 设置里的「自动记账」区块 */
  function paySettingsInner() {    var s = Store.settings();
    if (!payAvailable()) {
      return '<div class="hint" style="line-height:1.85">' +
        '当前环境拿不到通知监听能力（需要在安卓 App 里运行）。<br>' +
        '装到手机后，这里会出现授权入口。' +
      '</div>';
    }

    var access = S.pay.access;
    var n = S.pay.inbox.length;

    return '' +
      '<div class="row-between" style="margin-bottom:11px">' +
        '<div>' +
          '<div style="font-weight:650;font-size:13.5px">通知使用权</div>' +
          '<div class="hint" style="margin-top:3px">' +
            (access ? '已授权，正在监听微信 / 支付宝收付款通知'
                    : '未授权，需要在系统里手动打开') +
          '</div>' +
        '</div>' +
        '<span class="pill ' + (access ? 'ok' : 'no') + '">' +
          (access ? '已开启' : '未开启') + '</span>' +
      '</div>' +

      '<button class="btn block ' + (access ? '' : 'primary') + '" data-act="openPayAccess">' +
        (access ? '⚙️ 重新打开权限设置' : '🔓 去开启通知使用权') + '</button>' +

      '<label class="row-between" style="font-size:13.5px;margin-top:15px">' +
        '<span>检测到就自动入账（不再逐笔确认）</span>' +
        '<input type="checkbox" id="s-payauto" ' + (s.payAutoImport ? 'checked' : '') +
        ' style="width:18px;height:18px" /></label>' +

      ((access && n) ?
        '<button class="btn block" style="margin-top:12px" data-act="openPayInbox">' +
          '🔔 查看待确认的 ' + n + ' 笔记录</button>' : '') +

      '<div class="hint" style="margin-top:14px;line-height:1.9">' +
        '⚠️ 微信和支付宝<b>没有</b>公开的账单读取接口，任何「绑定账号」的说法都实现不了。<br>' +
        '这里用的是 Android 官方的<b>通知使用权</b>：只有收付款通知出现在通知栏时才能读到它。' +
        '如果通知被折叠、被静音或被划掉，可能抓不到——那种情况请用「账单截图导入」补齐。' +
      '</div>' +

      '<div class="btn-row" style="margin-top:12px">' +
        '<button class="btn sm" data-act="payTestInject">🧪 插入一条测试记录</button>' +
        '<button class="btn sm" data-act="payDiag">🩺 自动记账自检</button>' +
      '</div>';
  }

  /**
   * 自动记账自检。
   *
   * 收到「没有自动记账」的反馈时，最难的是分清到底是哪一步断了：
   * 没授权 / 授权了但系统没把服务连上 / 服务连上了但收不到通知 /
   * 收到通知了但解析不出来。这个面板把四种情况分开显示。
   */
  function openPayDiag() {
    var d = {};
    if (payAvailable() && typeof Android.payDiagnostics === 'function') {
      try { d = JSON.parse(Android.payDiagnostics() || '{}') || {}; } catch (e) { d = {}; }
    }

    function t(ms) {
      var n = Number(ms || 0);
      if (!n) return '—';
      var dt = new Date(n);
      var p = function (x) { return (x < 10 ? '0' : '') + x; };
      return dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate()) +
        ' ' + p(dt.getHours()) + ':' + p(dt.getMinutes());
    }

    var access = !!d.hasAccess;
    var connected = !!d.connected;
    var lastAt = Number(d.lastAt || 0);
    var seen = Number(d.seen || 0);

    var verdict;
    var tone;
    if (!access) {
      tone = 'no';
      verdict = '❌ <b>还没拿到「通知使用权」</b>，服务收不到任何通知。' +
        '点上面的按钮去系统设置里打开。';
    } else if (!connected) {
      tone = 'no';
      verdict = '⚠️ <b>权限有了，但监听服务没连上</b>。多半是被系统或厂商 ROM 回收了。' +
        '先点下面的「重新连接服务」，还不行就去系统设置里把这个应用的' +
        '「自启动 / 后台运行 / 电池优化」都放开。';
    } else if (!lastAt) {
      tone = 'warn';
      verdict = '⚠️ <b>权限和连接都正常，但一次通知都没收到过</b>。' +
        '现在去付一笔（哪怕 0.01 元），回到这里看时间会不会刷新。' +
        '如果一直不刷新，就是厂商 ROM 拦住了通知转发。';
    } else if (!d.lastParsed) {
      tone = 'warn';
      verdict = '⚠️ <b>收到通知了，但没认出是账单</b>——这一步是解析规则的问题。' +
        '下面的原文可以复制出来反馈。';
    } else {
      tone = 'ok';
      verdict = '✅ <b>整条链路是通的</b>：权限 ✓ 服务 ✓ 解析 ✓。' +
        '如果还是没看到记录，检查是不是躺在「待确认」里没导入。';
    }

    var status =
      '<div class="diag-line"><span>通知使用权</span><b class="' + (access ? 'ok' : 'no') + '">' +
        (access ? '已开启' : '未开启') + '</b></div>' +
      '<div class="diag-line"><span>监听服务连接</span><b class="' + (connected ? 'ok' : 'no') + '">' +
        (connected ? '已连接' : '未连接') + '</b></div>' +
      '<div class="diag-line"><span>最近收到通知</span><b>' + t(lastAt) + '</b></div>' +
      '<div class="diag-line"><span>累计收到</span><b>' + seen + ' 条</b></div>' +
      '<div class="diag-line"><span>收件箱待确认</span><b>' + (d.inbox || 0) + ' 笔</b></div>' +
      (d.sdk ? '<div class="diag-line"><span>Android 版本号</span><b>' + d.sdk + '</b></div>' : '') +
      (d.lastPkg
        ? '<div class="diag-line"><span>来源包名</span><b style="font-size:11px">' +
          esc(d.lastPkg) + '</b></div>'
        : '');

    var sample =
      '<div class="sec-title">手动测一遍解析</div>' +
      '<div class="card tight">' +
        '<div class="hint" style="line-height:1.85;margin-bottom:9px">' +
          '把通知栏那条支付通知的文字抄进来，第一行当标题、后面当内容，' +
          '看看能不能认出来。' +
        '</div>' +
        '<textarea class="textarea" id="diag-text" style="min-height:76px" ' +
          'placeholder="微信支付&#10;已支付¥19.32"></textarea>' +
        '<div class="btn-row" style="margin-top:9px">' +
          '<button class="btn sm" data-act="diagSample">填入示例</button>' +
          '<button class="btn sm primary" data-act="diagRun">试着识别</button>' +
        '</div>' +
        '<div id="diag-out" style="margin-top:11px"></div>' +
      '</div>';

    var raw =
      '<div class="sec-title">最近一条通知原文</div>' +
      '<div class="card tight">' +
        (d.lastTitle || d.lastBody
          ? '<div class="diag-box"><div class="k">标题</div><div class="v">' +
              esc(d.lastTitle || '（空）') + '</div></div>' +
            '<div class="diag-box" style="margin-top:9px"><div class="k">内容</div><div class="v">' +
              esc(d.lastBody || '（空）') + '</div></div>' +
            '<div class="diag-box" style="margin-top:9px"><div class="k">解析结果</div><div class="v">' +
              (d.lastParsed ? '✅ 已识别为账单' : '❌ 没能识别') + '</div></div>'
          : '<div class="hint">还没有收到过微信 / 支付宝的通知。</div>') +
      '</div>';

    openSheet('自动记账自检',
      '<div class="card tight" style="margin-bottom:13px;border-color:' +
        (tone === 'ok' ? 'var(--accent-line)' : 'var(--line)') + '">' +
        '<div style="font-size:13.5px;line-height:1.95">' + verdict + '</div>' +
      '</div>' +
      '<div class="sec-title">运行状态</div>' +
      '<div class="card tight">' + status + '</div>' +
      raw + sample,
      null,
      '<div class="btn-row">' +
        '<button class="btn" data-act="reconnectPay">🔄 重新连接服务</button>' +
        '<button class="btn primary" data-act="openPayAccess">⚙️ 权限设置</button>' +
      '</div>');
  }

  /** 连接测试结果面板：成功给结论，失败给可照着排查的清单 */
  function openTestResult(err, text) {
    var s = Store.settings().llm;
    var key = String(s.key || '').trim();
    var tail = key.length >= 4 ? key.slice(-4) : (key || '（空）');

    function row(k, v) {
      return '<div class="row-between" style="padding:5px 0;font-size:13px">' +
        '<span class="muted" style="flex:0 0 auto;white-space:nowrap;margin-right:12px">' +
        esc(k) + '</span>' +
        '<span class="text-2" style="text-align:right;word-break:break-all">' +
        esc(v) + '</span></div>';
    }

    var ctx = '<div class="card tight" style="margin-bottom:12px">' +
      row('接口地址', AI.resolveEndpoint(s.base) || '（未填写）') +
      row('模型名称', s.model || '（未填写）') +
      row('API Key', '长度 ' + key.length + '，末四位「' + tail + '」') +
    '</div>';

    if (!err) {
      openSheet('连接测试', '' +
        '<div class="card tight" style="margin-bottom:12px">' +
          '<div style="font-size:15px;font-weight:700;color:var(--accent)">✅ 连接成功</div>' +
          '<div class="hint" style="margin-top:7px">模型回复：' + esc(text || '（空）') + '</div>' +
        '</div>' + ctx +
        '<button class="btn primary block" data-act="closeSheet">好的</button>');
      return;
    }

    openSheet('连接失败', '' +
      '<div class="card tight" style="margin-bottom:12px;border-color:color-mix(in srgb, var(--danger) 45%, transparent)">' +
        '<div style="font-size:14.5px;font-weight:700;color:var(--danger);margin-bottom:9px">❌ 连接失败</div>' +
        '<div class="text-2" style="white-space:pre-wrap;line-height:1.85;font-size:13.5px">' +
          esc(err) + '</div>' +
      '</div>' +
      ctx +
      '<div class="sec-title">排查清单</div>' +
      '<div class="hint" style="line-height:2.05">' +
        '1. 登录服务商控制台，确认这个 Key 还在（没被删除或重置）。<br>' +
        '2. 重新完整复制一次 Key，注意别多带上空格、换行或 <b>Bearer</b> 前缀。<br>' +
        '3. 确认「API Key」和「API 地址」属于同一家服务商。<br>' +
        '4. 确认账户里有余额（余额不足通常返回 402，而不是 401）。<br>' +
        '5. 确认「模型名称」在该账号下可用。' +
      '</div>' +
      '<div class="btn-row" style="margin-top:16px">' +
        '<button class="btn" data-act="openSettings">返回修改</button>' +
        '<button class="btn primary" data-act="testApi">重试</button>' +
      '</div>');
  }

  function collectSettings(root) {
    if (!$('#s-base', root)) return Store.settings();
    var preset = $('#s-preset', root);
    var lightBgEl = $('#s-lightbghex', root);
    var lightBgVal = lightBgEl ? lightBgEl.value : '';
    var payAutoEl = $('#s-payauto', root);
    var cur = Store.settings();

    return Store.saveSettings({
      monthlyBudget: U.num($('#s-monthly', root).value),
      dailyBudget: U.num($('#s-daily', root).value),
      monthStartDay: Math.min(28, Math.max(1, parseInt($('#s-start', root).value, 10) || 1)),
      theme: $('#s-light', root).checked ? 'light' : 'dark',
      themeId: ($('#s-themeid', root).value || 'default'),
      themeColor: normalizeHex($('#s-colorhex', root).value),
      launcherIcon: $('#s-icon', root).value || 'whale_q_blue',
      calendarMode: $('#s-calmode', root).value === 'expense' ? 'expense' : 'budget',
      // 浅色背景在点选时就已即时生效，这里保持原值，避免被空输入覆盖
      lightPreset: cur.lightPreset,
      lightBg: Theme.isHex(lightBgVal) ? lightBgVal : cur.lightBg,
      payAutoImport: payAutoEl ? payAutoEl.checked : cur.payAutoImport,
      llm: {
        preset: preset ? preset.value : '',
        base: $('#s-base', root).value.trim(),
        key: $('#s-key', root).value.trim(),
        model: $('#s-model', root).value.trim(),
        visionModel: $('#s-vmodel', root).value.trim(),
        temperature: Math.max(0, Math.min(2, U.num($('#s-temp', root).value))),
        maxTokens: parseInt($('#s-maxtok', root).value, 10) || 1600,
        stream: $('#s-stream', root).checked
      }
    });
  }

  /* ------------------------------------------------------ 分类管理 */

  function categoryManagerHtml() {
    var custom = Store.customCategories();
    if (!custom.length) {
      return '<div class="hint">还没有自定义分类。内置分类已覆盖大多数场景，' +
        '需要更细的划分时可以自己加。</div>';
    }
    return custom.map(function (c) {
      return '<div class="cat-item">' +
        '<div class="ci" style="background:' + Charts.hexA(c.color, 0.18) + '">' +
          esc(c.icon) + '</div>' +
        '<div class="cm">' +
          '<div class="n">' + esc(c.name) +
            '<span class="pill" style="margin-left:6px">' +
            (c.kind === 'income' ? '进账' : '支出') + '</span></div>' +
          '<div class="w">' +
            (c.keywords && c.keywords.length
              ? '关键词：' + esc(c.keywords.join('、'))
              : '未设置关键词（可以只靠手动归类学习）') +
          '</div>' +
        '</div>' +
        '<button class="btn sm" data-act="editCat" data-id="' + c.id + '">编辑</button>' +
        '<button class="btn sm danger" data-act="delCat" data-id="' + c.id + '">删</button>' +
      '</div>';
    }).join('');
  }

  /** 新建 / 编辑自定义分类 */
  function openCategoryEditor(id, kind) {
    var cat = id ? Store.customCategory(id) : null;
    var isIncome = (cat ? cat.kind : kind) === 'income';
    var draft = {
      icon: cat ? cat.icon : (isIncome ? '💰' : '🏷️'),
      color: cat ? cat.color : (isIncome ? '#22C55E' : '#7DD3FC'),
      keywords: cat ? (cat.keywords || []).join('、') : ''
    };

    function body() {
      return '' +
        '<div class="field"><label>分类名称</label>' +
          '<input class="input" type="text" id="c-name" placeholder="例如：宠物用品、健身支出" ' +
            'value="' + esc(cat ? cat.name : '') + '" /></div>' +

        '<div class="field"><label>类型</label>' +
          '<div class="seg">' +
            '<button class="' + (!isIncome ? 'active' : '') + '" data-act="catKind" data-kind="expense">支出分类</button>' +
            '<button class="' + (isIncome ? 'active' : '') + '" data-act="catKind" data-kind="income">进账分类</button>' +
          '</div></div>' +

        '<div class="field"><label>图标</label>' +
          '<div class="emoji-pick" id="c-emoji">' +
            EMOJI_PALETTE.map(function (e) {
              return '<button class="' + (e === draft.icon ? 'active' : '') +
                '" data-act="catIcon" data-icon="' + e + '">' + e + '</button>';
            }).join('') +
          '</div></div>' +

        '<div class="field"><label>颜色</label>' +
          '<div class="color-row">' +
            '<input type="color" id="c-color" value="' + esc(draft.color) + '" />' +
            '<input class="input" type="text" id="c-colorhex" spellcheck="false" ' +
              'value="' + esc(draft.color) + '" />' +
          '</div>' +
          '<div class="hint" style="margin-top:9px">颜色图标预览</div>' +
        '</div>' +

        '<div class="cat-preview">' +
          '<div class="ico" id="c-pv-ico" style="background:' +
            Charts.hexA(draft.color, 0.16) + '">' + draft.icon + '</div>' +
          '<div class="bars">' +
            '<i id="c-pv-bar1" style="width:82%;background:' + draft.color + '"></i>' +
            '<i id="c-pv-bar2" style="width:52%;background:' +
              Charts.hexA(draft.color, 0.45) + '"></i>' +
          '</div>' +
        '</div>' +
        '<div class="hint" style="margin-top:9px;line-height:1.9">' +
          '它会出现在四处：<br>' +
          '① 明细 / 详情里条目的<b>图标底色</b><br>' +
          '② 统计页环形图的<b>扇区颜色</b><br>' +
          '③ 图例色块与<b>分类排行条</b><br>' +
          '④ 分类管理列表里的图标底色' +
        '</div>' +

        '<div class="field" style="margin-top:14px"><label>关键词（用「、」或逗号分隔）</label>' +
          '<input class="input" type="text" id="c-kw" ' +
            'placeholder="例如：猫粮、猫砂、宠物医院" value="' + esc(draft.keywords) + '" />' +
          '<div class="hint" style="margin-top:6px">' +
            '输入内容里出现这些词就会自动归到本分类。' +
          '</div></div>' +

        '</div>';
    }

    openSheet(id ? '编辑分类' : '新建分类', body(), function (root) {
      var ci = $('#c-color', root);
      var ch = $('#c-colorhex', root);

      // 颜色实时预览：图标底色 + 统计页用的色条
      function paint(color) {
        draft.color = color;
        var ico = $('#c-pv-ico', root);
        var b1 = $('#c-pv-bar1', root);
        var b2 = $('#c-pv-bar2', root);
        if (ico) ico.style.background = Charts.hexA(color, 0.16);
        if (b1) b1.style.background = color;
        if (b2) b2.style.background = Charts.hexA(color, 0.45);
      }

      if (ci) {
        ci.addEventListener('input', function () { ch.value = ci.value; paint(ci.value); });
      }
      if (ch) {
        ch.addEventListener('input', function () {
          if (/^#[0-9a-fA-F]{6}$/.test(ch.value)) { ci.value = ch.value; paint(ch.value); }
        });
      }

      // 换图标时预览也跟着变
      var em = $('#c-emoji', root);
      if (em) {
        em.addEventListener('click', function (e) {
          var b = e.target.closest ? e.target.closest('button[data-icon]') : null;
          if (!b) return;
          var ico2 = $('#c-pv-ico', root);
          if (ico2) ico2.textContent = b.dataset.icon;
        });
      }
    }, '<button class="btn primary lg" data-act="saveCat" data-id="' + (id || '') + '">' +
       (id ? '保存修改' : '创建分类') + '</button>');
  }

  /** 读取分类编辑表单 */
  function readCategoryForm(id, fallbackKind) {
    var root = $('#sheet');
    var kwRaw = $('#c-kw', root).value || '';
    return {
      name: ($('#c-name', root).value || '').trim(),
      icon: ($('#c-emoji .active') ? $('#c-emoji .active').dataset.icon : '🏷️'),
      color: normalizeHex($('#c-colorhex', root).value),
      kind: S._catKind || fallbackKind,
      keywords: kwRaw.split(/[、,，\s]+/).map(function (s) { return s.trim(); })
                     .filter(function (s) { return s.length > 0; })
    };
  }

  /* ------------------------------------------------------ 自定义图标 */

  var ICON_BG_OPTIONS = [
    ['accent', '主题色'],
    ['transparent', '透明'],
    ['white', '白色'],
    ['dark', '深色'],
    ['custom', '自定义']
  ];

  /** 把背景选项翻译成实际颜色值 */
  function iconBgValue(bg, customColor) {
    if (bg === 'transparent') return 'transparent';
    if (bg === 'white') return '#FFFFFF';
    if (bg === 'dark') return '#1A1F27';
    if (bg === 'custom') return normalizeHex(customColor);
    if (bg === 'accent') {
      var preset = Theme.presetOf(Store.settings().themeId);
      return Store.settings().themeId === 'custom'
        ? normalizeHex(Store.settings().themeColor)
        : preset.color;
    }
    return 'transparent';
  }

  /**
   * 读取图片文件并保留透明通道（输出 PNG dataURL）。
   * 与 shrinkImage 的区别：那个会铺白底并存成 JPEG，图标必须保留 alpha。
   */
  function loadImageFile(file, maxDim, cb) {
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
          ctx.drawImage(img, 0, 0, cw, ch);   // 不铺白底
          cb(c.toDataURL('image/png'));
        } catch (err) {
          cb('');
        }
      };
      img.onerror = function () { cb(''); };
      img.src = e.target.result;
    };
    reader.onerror = function () { cb(''); };
    reader.readAsDataURL(file);
  }

  /** 把「背景 + 图片」合成一张正方形 PNG（保留透明） */
  function composeIconPng(src, bg, size, cb) {
    var img = new Image();
    img.onload = function () {
      try {
        var c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        var ctx = c.getContext('2d');
        ctx.clearRect(0, 0, size, size);

        if (bg && bg !== 'transparent') {
          var r = size * 0.22;
          ctx.fillStyle = bg;
          ctx.beginPath();
          ctx.moveTo(r, 0);
          ctx.lineTo(size - r, 0);
          ctx.quadraticCurveTo(size, 0, size, r);
          ctx.lineTo(size, size - r);
          ctx.quadraticCurveTo(size, size, size - r, size);
          ctx.lineTo(r, size);
          ctx.quadraticCurveTo(0, size, 0, size - r);
          ctx.lineTo(0, r);
          ctx.quadraticCurveTo(0, 0, r, 0);
          ctx.closePath();
          ctx.fill();
        }

        var iw = img.naturalWidth || img.width || size;
        var ih = img.naturalHeight || img.height || size;
        var inner = size * 0.78;
        var scale = Math.min(inner / iw, inner / ih);
        var w = Math.max(1, Math.round(iw * scale));
        var h = Math.max(1, Math.round(ih * scale));
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);

        cb(c.toDataURL('image/png'));
      } catch (e) {
        cb('');
      }
    };
    img.onerror = function () { cb(''); };
    img.src = src;
  }

  function customIconSupported() {
    if (!Store.HAS_NATIVE || !Android || typeof Android.canPinCustomIcon !== 'function') {
      return false;
    }
    try { return !!Android.canPinCustomIcon(); } catch (e) { return false; }
  }

  /* ------------------------------------------------------ 分类明细下钻 */

  /** 从统计页点某个分类进来，看这个分类下的账单 */
  function openCategoryDetail(catId) {
    var res = recordsFor(S.stat);
    S.catDetail = {
      id: catId,
      sort: 'time',
      order: 'desc',
      range: 'inherit',
      day: todayStr(),
      from: res.range.from,
      to: res.range.to,
      base: res.range
    };
    renderCatDetailSheet();
  }

  function catDetailRange() {
    var c = S.catDetail;
    if (!c) return { from: '', to: '', label: '全部时间' };
    if (c.range === 'inherit') {
      return { from: c.base.from, to: c.base.to, label: c.base.label || '统计范围' };
    }
    if (c.range === 'day') {
      return { from: c.day || '', to: c.day || '', label: c.day || '单日' };
    }
    if (c.range === 'custom') {
      return { from: c.from || '', to: c.to || '', label: '自定义时间段' };
    }
    return { from: '', to: '', label: '全部时间' };
  }

  function catDetailList() {
    var c = S.catDetail;
    if (!c) return [];
    var r = catDetailRange();
    var list = Store.query({ from: r.from, to: r.to, category: c.id });

    if (c.sort === 'amount') {
      list.sort(function (a, b) {
        return c.order === 'asc' ? a.amount - b.amount : b.amount - a.amount;
      });
    } else {
      list.sort(function (a, b) {
        var ka = a.date + ' ' + (a.time || '');
        var kb = b.date + ' ' + (b.time || '');
        if (ka === kb) {
          return c.order === 'asc'
            ? (a.createdAt || 0) - (b.createdAt || 0)
            : (b.createdAt || 0) - (a.createdAt || 0);
        }
        return c.order === 'asc' ? (ka < kb ? -1 : 1) : (ka < kb ? 1 : -1);
      });
    }
    return list;
  }

  function renderCatDetailSheet() {
    var c = S.catDetail;
    if (!c) return;
    var meta = Store.catMeta(c.id);
    var range = catDetailRange();
    var list = catDetailList();

    // 汇总按「该分类在该范围内的全部记录」算，和排序方式无关
    var all = Store.query({ from: range.from, to: range.to, category: c.id });
    var expense = Store.sumExpense(all);
    var income = Store.sumIncome(all);
    var onlyIncome = income > 0 && expense === 0;

    var sortSeg = '<div class="seg" style="margin-bottom:11px">' +
      '<button class="' + (c.sort === 'time' ? 'active' : '') +
        '" data-act="cdSort" data-sort="time">按时间' +
        (c.sort === 'time' ? (c.order === 'asc' ? ' ↑' : ' ↓') : '') + '</button>' +
      '<button class="' + (c.sort === 'amount' ? 'active' : '') +
        '" data-act="cdSort" data-sort="amount">按金额' +
        (c.sort === 'amount' ? (c.order === 'asc' ? ' ↑' : ' ↓') : '') + '</button>' +
    '</div>';

    var rangeChips = '<div class="chips scroll" style="margin-bottom:11px">' +
      [['inherit', '跟随统计'], ['all', '全部时间'], ['day', '单日'], ['custom', '时间段']]
        .map(function (o) {
          return '<button class="chip' + (c.range === o[0] ? ' active' : '') +
            '" data-act="cdRange" data-range="' + o[0] + '">' + o[1] + '</button>';
        }).join('') +
    '</div>';

    var pickers = '';
    if (c.range === 'day') {
      pickers = '<div class="field"><label>选择日期</label>' +
        '<input class="input" type="date" id="cd-day" value="' + esc(c.day || '') + '" /></div>';
    } else if (c.range === 'custom') {
      pickers = '<div class="field"><label>时间段</label>' +
        '<div class="input-row">' +
          '<input class="input" type="date" id="cd-from" value="' + esc(c.from || '') + '" />' +
          '<input class="input" type="date" id="cd-to" value="' + esc(c.to || '') + '" />' +
        '</div></div>';
    }

    var head = '<div class="card tight" style="margin-bottom:12px">' +
      '<div style="display:flex;gap:12px;align-items:center">' +
        '<div style="width:46px;height:46px;border-radius:13px;display:grid;place-items:center;' +
          'font-size:21px;background:' + Charts.hexA(meta.color, 0.16) + '">' + meta.icon + '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:16.5px;font-weight:700">' + esc(meta.name) + '</div>' +
          '<div class="hint">' + esc(range.label) + ' · 共 ' + list.length + ' 笔</div>' +
        '</div>' +
        '<div class="num" style="font-size:20px;font-weight:750;text-align:right">' +
          (income > 0 && expense > 0
            ? '<div style="color:var(--accent);font-size:15px">+¥' + fmt(income) + '</div>' +
              '<div>−¥' + fmt(expense) + '</div>'
            : '<div style="color:' + (onlyIncome ? 'var(--accent)' : 'inherit') + '">' +
              (onlyIncome ? '+' : '−') + '¥' + fmt(onlyIncome ? income : expense) + '</div>') +
        '</div>' +
      '</div>' +
    '</div>';

    var rows = list.length
      ? '<div class="sec-title">账单明细</div>' +
        '<div class="items">' + list.map(function (r, i) {
          return catDetailRow(r, i, c.sort === 'amount' && c.order === 'desc');
        }).join('') + '</div>'
      : '<div class="empty"><div class="e">🔍</div><div class="t">这个条件下没有记录</div>' +
        '<div class="s">换一个时间范围试试</div></div>';

    openSheet(meta.name + ' · 分类明细', head + sortSeg + rangeChips + pickers + rows,
      function (root) {
        var dayEl = $('#cd-day', root);
        if (dayEl) {
          dayEl.addEventListener('change', function () {
            S.catDetail.day = dayEl.value;
            renderCatDetailSheet();
          });
        }
        var fEl = $('#cd-from', root);
        if (fEl) {
          fEl.addEventListener('change', function () {
            S.catDetail.from = fEl.value;
            renderCatDetailSheet();
          });
        }
        var tEl = $('#cd-to', root);
        if (tEl) {
          tEl.addEventListener('change', function () {
            S.catDetail.to = tEl.value;
            renderCatDetailSheet();
          });
        }
      });
  }

  function catDetailRow(r, index, showRank) {
    var isIncome = r.type === 'income';
    return '<div class="item" data-act="openRecord" data-id="' + r.id + '">' +
      (showRank ? '<span class="rank-no">' + (index + 1) + '</span>' : '') +
      '<div class="mid">' +
        '<div class="t1">' + esc(r.content || '未填写') + '</div>' +
        '<div class="t2">' + esc(r.date) + ' ' + esc(r.time || '') +
          (r.note ? ' · ' + esc(r.note) : '') + '</div>' +
      '</div>' +
      '<div class="amt ' + (isIncome ? 'income' : 'expense') + '">' +
        (isIncome ? '+' : '-') + '¥' + fmt(r.amount) + '</div>' +
    '</div>';
  }

  /* ------------------------------------------------------ 图片裁剪 */

  /* 裁剪预设：图标正方形、目标封面 16:9、应用背景竖版 9:16 */
  var CROP_PRESETS = {
    hero: { ratio: 1, w: 240, out: 512, label: '拖动调整位置，滑块缩放' },
    goal: { ratio: 16 / 9, w: 258, out: 960, label: '拖动调整位置，滑块缩放（16:9）' },
    bg: { ratio: 9 / 16, w: 176, out: 1080, label: '拖动调整位置，滑块缩放（竖版 9:16）' }
  };

  var crop = {
    img: null,
    zw: 0, zh: 0,       // 原图尺寸
    base: 1,            // 让图片刚好盖住视口的基准缩放
    zoom: 1,            // 用户缩放（1~4）
    x: 0, y: 0,         // 图片左上角在视口中的位置
    w: 240, h: 240      // 视口尺寸
  };

  /** 生成裁剪区的 HTML（两种预设共用） */
  function cropBoxHtml() {
    return '<div class="field" id="crop-box" style="display:none">' +
      '<label id="crop-label">' + CROP_PRESETS.hero.label + '</label>' +
      '<div class="crop-wrap">' +
        '<canvas id="crop-canvas" class="crop-canvas"></canvas>' +
      '</div>' +
      '<div class="crop-zoom">' +
        '<span class="hint">缩放</span>' +
        '<input type="range" id="crop-zoom" min="100" max="400" value="100" />' +
      '</div>' +
      '<div class="btn-row" style="margin-top:10px">' +
        '<button class="btn sm" data-act="cropCancel">取消</button>' +
        '<button class="btn sm primary" data-act="cropApply">用这块区域</button>' +
      '</div>' +
    '</div>';
  }

  function cropClamp() {
    var w = crop.zw * crop.base * crop.zoom;
    var h = crop.zh * crop.base * crop.zoom;
    crop.x = Math.min(0, Math.max(crop.w - w, crop.x));
    crop.y = Math.min(0, Math.max(crop.h - h, crop.y));
  }

  /** 把当前选区画到视口画布上（所见即所得） */
  function cropDraw() {
    var cv = $('#crop-canvas');
    if (!cv || !crop.img) return;
    cropClamp();

    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    var px = Math.max(1, Math.round(crop.w * dpr));
    var py = Math.max(1, Math.round(crop.h * dpr));
    if (cv.width !== px || cv.height !== py) {
      cv.width = px;
      cv.height = py;
    }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, crop.w, crop.h);
    ctx.drawImage(crop.img, crop.x, crop.y,
      crop.zw * crop.base * crop.zoom,
      crop.zh * crop.base * crop.zoom);
  }

  /** 载入待裁剪的图片并复位选区（按 cover 方式铺满视口） */
  function cropInit(dataUrl, vw, ratio, done) {
    var img = new Image();
    img.onload = function () {
      crop.img = img;
      crop.zw = img.naturalWidth || img.width || 1;
      crop.zh = img.naturalHeight || img.height || 1;
      crop.w = vw;
      crop.h = Math.round(vw / ratio);
      crop.base = Math.max(crop.w / crop.zw, crop.h / crop.zh);
      crop.zoom = 1;
      crop.x = (crop.w - crop.zw * crop.base) / 2;
      crop.y = (crop.h - crop.zh * crop.base) / 2;
      var cv = $('#crop-canvas');
      if (cv) {
        cv.style.width = crop.w + 'px';
        cv.style.height = crop.h + 'px';
      }
      cropDraw();
      if (done) done(true);
    };
    img.onerror = function () { if (done) done(false); };
    img.src = dataUrl;
  }

  /** 输出裁剪结果，比例与视口完全一致 */
  function cropOutput(outW) {
    if (!crop.img) return '';
    var k = outW / crop.w;
    var outH = Math.max(1, Math.round(crop.h * k));
    var c = document.createElement('canvas');
    c.width = outW;
    c.height = outH;
    var ctx = c.getContext('2d');
    ctx.clearRect(0, 0, outW, outH);
    ctx.drawImage(crop.img, crop.x * k, crop.y * k,
      crop.zw * crop.base * crop.zoom * k,
      crop.zh * crop.base * crop.zoom * k);
    return c.toDataURL('image/png');
  }

  /** 拖动 + 缩放交互 */
  function cropBind(root) {
    var cv = $('#crop-canvas', root);
    if (!cv) return;

    var dragging = false;
    var lastX = 0, lastY = 0;

    cv.addEventListener('pointerdown', function (e) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    cv.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      crop.x += e.clientX - lastX;
      crop.y += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      cropDraw();
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) {
      cv.addEventListener(t, function () { dragging = false; });
    });

    var zoomEl = $('#crop-zoom', root);
    if (zoomEl) {
      zoomEl.addEventListener('input', function () {
        var nz = Math.max(1, parseInt(zoomEl.value, 10) / 100);
        // 以视口中心为锚点缩放，手感更自然
        var cx = (crop.w / 2 - crop.x) / (crop.base * crop.zoom);
        var cy = (crop.h / 2 - crop.y) / (crop.base * crop.zoom);
        crop.zoom = nz;
        crop.x = crop.w / 2 - cx * crop.base * crop.zoom;
        crop.y = crop.h / 2 - cy * crop.base * crop.zoom;
        cropDraw();
      });
    }
  }

  /** 打开某个预设的裁剪区 */
  function startCrop(target, dataUrl, root) {
    var p = CROP_PRESETS[target] || CROP_PRESETS.hero;
    S.cropTarget = target;
    var box = $('#crop-box', root);
    if (box) box.style.display = '';
    var lb = $('#crop-label', root);
    if (lb) lb.textContent = p.label;
    var z = $('#crop-zoom', root);
    if (z) z.value = 100;
    cropInit(dataUrl, p.w, p.ratio, function (ok) {
      if (!ok) toast('图片读取失败，请换一张试试');
    });
  }

  /** 关闭裁剪区 */
  function closeCrop() {
    var box = $('#crop-box');
    if (box) box.style.display = 'none';
  }

  /* ------------------------------------------------------ 首页欢迎条编辑 */

  function openHeroEditor() {
    var s = Store.settings();
    var p = Theme.presetOf(s.themeId);
    var draft = {
      title: s.brandTitle || '',
      desc: s.brandDesc || '',
      iconData: '',
      clearIcon: false,
      bg: s.brandIconBg || 'accent',
      bgColor: normalizeHex(s.brandIconBgColor),
      // 当前已有图标作为起点
      current: s.brandIcon ? Store.images.load(s.brandIcon) : ''
    };
    S.heroDraft = draft;

    function previewIcon() {
      var icon = draft.iconData || (draft.clearIcon ? (mascotSrc() || '') : (draft.current || mascotSrc() || ''));
      var bg = iconBgValue(draft.bg, draft.bgColor);
      var showBg = draft.iconData || (!draft.clearIcon && s.brandIcon) ? bg : 'transparent';
      return '<span class="hero-ico big" style="background:' + showBg + '">' +
        (icon ? '<img src="' + icon + '" alt="" />' : '💰') + '</span>';
    }

    function repaint() {
      var el = $('#h-preview');
      if (el) el.innerHTML = previewIcon();
      var wrap = $('#h-bgcustom');
      if (wrap) wrap.style.display = draft.bg === 'custom' ? '' : 'none';
    }
    S.heroRepaint = repaint;

    function body() {
      return '' +
        '<div class="field"><label>标题</label>' +
          '<input class="input" type="text" id="h-title" maxlength="20" ' +
            'placeholder="' + esc(p.name) + '" value="' + esc(draft.title) + '" />' +
          '<div class="hint" style="margin-top:6px">留空则显示当前主题名「' + esc(p.name) + '」</div>' +
        '</div>' +

        '<div class="field"><label>介绍文字</label>' +
          '<textarea class="textarea" id="h-desc" maxlength="80" style="min-height:72px" ' +
            'placeholder="' + esc(p.desc || '写点什么…') + '">' + esc(draft.desc) + '</textarea>' +
        '</div>' +

        '<div class="field"><label>图标</label>' +
          '<div class="hero-preview" id="h-preview">' + previewIcon() + '</div>' +
          '<div class="btn-row" style="margin-top:10px">' +
            '<button class="btn file-btn">📷 选图片' +
              '<input type="file" accept="image/*" id="h-file" /></button>' +
            '<button class="btn danger" data-act="heroIconClear">用回默认</button>' +
          '</div>' +
          '<div class="hint" style="margin-top:7px">这个图标同时会用在左上角。</div>' +
        '</div>' +

        // 裁剪区：选了新图片后才出现
        cropBoxHtml() +

        '<div class="field"><label>图标背景</label>' +
          '<div class="chips" id="h-bg">' +
            ICON_BG_OPTIONS.map(function (o) {
              return '<button class="chip' + (draft.bg === o[0] ? ' active' : '') +
                '" data-act="heroBg" data-bg="' + o[0] + '">' + o[1] + '</button>';
            }).join('') +
          '</div>' +
          '<div class="color-row" id="h-bgcustom" style="margin-top:10px;display:' +
            (draft.bg === 'custom' ? '' : 'none') + '">' +
            '<input type="color" id="h-bgcolor" value="' + esc(draft.bgColor) + '" />' +
            '<input class="input" type="text" id="h-bgcolorhex" spellcheck="false" ' +
              'value="' + esc(draft.bgColor) + '" />' +
          '</div>' +
        '</div>' +

        (customIconSupported()
          ? '<div class="field" style="margin-bottom:0">' +
              '<button class="btn block" data-act="pinHeroIcon">📌 把这个图标添加到桌面</button>' +
            '</div>'
          : '');
    }

    openSheet('编辑首页文字与图标', body(), function (root) {
      cropBind(root);

      var f = $('#h-file', root);
      if (f) {
        f.addEventListener('change', function (e) {
          var file = e.target.files && e.target.files[0];
          if (!file) return;
          // 先读大图，再让用户拖拽缩放选一块区域出来
          loadImageFile(file, 1600, function (dataUrl) {
            if (!dataUrl) { toast('图片读取失败'); return; }
            startCrop('hero', dataUrl, root);
          });
        });
      }

      var bc = $('#h-bgcolor', root);
      var bh = $('#h-bgcolorhex', root);
      if (bc && bh) {
        bc.addEventListener('input', function () {
          bh.value = bc.value;
          draft.bgColor = bc.value;
          draft.bg = 'custom';
          repaint();
        });
        bh.addEventListener('input', function () {
          if (/^#[0-9a-fA-F]{6}$/.test(bh.value)) {
            bc.value = bh.value;
            draft.bgColor = bh.value;
            repaint();
          }
        });
      }
    }, '<button class="btn primary lg" data-act="saveHero">保存</button>');
  }


  /* ------------------------------------------------------ AI 发送 */

  var currentAbort = null;
  var streamEl = null;

  function askAI(question) {
    if (S.ai.busy) { toast('正在分析中，请稍候'); return; }
    var q = String(question || '').trim();
    if (!q) { toast('请先输入问题'); return; }

    var res = recordsFor(S.ai);
    if (!res.list.length) { toast('该时间范围内没有记录'); return; }

    S.ai.question = q;
    S.ai.busy = true;

    // 提问发出后清空输入框，否则下次输入时上一句还留在里面
    S.ai.question = '';
    var inputEl = $('#aiQ');
    if (inputEl) inputEl.value = '';

    var chat = $('#chat');
    if (!chat) return;

    /* 清掉占位提示 */
    var ph = chat.querySelector('.msg.plain');
    if (ph) chat.removeChild(ph);

    var userEl = document.createElement('div');
    userEl.className = 'msg user';
    userEl.textContent = q;
    chat.appendChild(userEl);

    var aiEl = document.createElement('div');
    aiEl.className = 'msg assistant';
    aiEl.innerHTML = '<span class="spin"></span> <span style="color:var(--muted)">正在读取 ' +
      res.list.length + ' 条记录并思考…</span>';
    chat.appendChild(aiEl);
    streamEl = aiEl;

    var askBtn = $('#askBtn');
    var stopBtn = $('#stopBtn');
    if (askBtn) askBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = '';

    Store.pushChat('user', q);
    scrollChat();

    var acc = '';
    var started = false;

    currentAbort = AI.analyze(res.list, q, {
      onDelta: function (t) {
        if (!started) {
          started = true;
          aiEl.textContent = '';
        }
        acc += t;
        aiEl.textContent = acc;
        aiEl.innerHTML = esc(plainText(acc)) + '<span class="cursor"></span>';
        scrollChat();
      },
      onError: function (msg) {
        aiEl.innerHTML = '';
        aiEl.style.borderColor = 'var(--danger)';
        aiEl.innerHTML = '⚠️ ' + esc(msg) +
          '<div class="hint" style="margin-top:8px">请检查「设置 → 大模型接口」中的地址、Key 与模型名是否正确。</div>';
        finishAsk();
      },
      onDone: function () {
        aiEl.innerHTML = esc(acc || '（没有返回内容）');
        if (acc) Store.pushChat('assistant', acc);
        finishAsk();
      }
    }, true);
  }

  function finishAsk() {
    S.ai.busy = false;
    currentAbort = null;
    streamEl = null;
    var askBtn = $('#askBtn');
    var stopBtn = $('#stopBtn');
    if (askBtn) askBtn.style.display = '';
    if (stopBtn) stopBtn.style.display = 'none';
  }

  function scrollChat() {
    var view = $('#view');
    if (view) view.scrollTop = view.scrollHeight;
  }

  /* ------------------------------------------------------ 事件 */

  function setByPath(obj, path, val) {
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]]) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = val;
  }

  function bindInputs() {
    document.addEventListener('input', function (e) {
      var t = e.target;
      if (!t || !t.dataset) return;

      if (t.dataset.bind) {
        setByPath(S, t.dataset.bind, t.value);
        var bindPath = t.dataset.bind;
        if (bindPath === 'form.content' || bindPath === 'form.note') {
          refreshAddSuggest('expense');
        } else if (bindPath === 'income.content' || bindPath === 'income.note') {
          refreshAddSuggest('income');
        }
        if (bindPath === 'list.keyword') {
          clearTimeout(bindInputs._t);
          var v = t.value;
          bindInputs._t = setTimeout(function () {
            S.list.keyword = v;
            var pos = $('#view').scrollTop;
            render();
            $('#view').scrollTop = pos;
            var inp = $('[data-bind="list.keyword"]');
            if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
          }, 320);
        }
        if (t.dataset.bind === 'ai.question') S.ai.question = t.value;
        return;
      }

      if (t.id === 'aiQ') S.ai.question = t.value;
    });
    document.addEventListener('change', function (e) {
      var t = e.target;
      if (!t || !t.dataset) return;
      if (t.dataset.rangefrom) {
        var st = t.dataset.rangefrom === 'stat' ? S.stat : (t.dataset.rangefrom === 'ai' ? S.ai : S.list);
        st.from = t.value;
        if (t.dataset.rangefrom !== 'ai') render();
        else render();
        return;
      }
      if (t.dataset.rangeto) {
        var st2 = t.dataset.rangeto === 'stat' ? S.stat : (t.dataset.rangeto === 'ai' ? S.ai : S.list);
        st2.to = t.value;
        render();
        return;
      }
    });
  }

  function refreshAddSuggest(kind) {
    if (S.tab !== 'add') return;
    kind = kind === 'income' ? 'income' : 'expense';
    var isIncome = kind === 'income';
    var st = isIncome ? S.income : S.form;
    if (st.catLocked) return;

    var auto = Store.suggestCategory(st.content, st.note, kind);
    st.category = auto.category.id;

    // 只更新分类区，避免输入框失焦
    $$('[data-act="pickCat"][data-kind="' + kind + '"]').forEach(function (c) {
      c.classList.toggle('active', c.dataset.id === st.category);
    });

    var otherId = isIncome ? 'other_income' : 'other';
    var wrap = $('#suggest-' + kind);
    if (wrap) {
      if (auto.category.id !== otherId && auto.confidence > 0) {
        var tag = auto.source === 'learned' ? '🧠 按你的习惯归到'
                : (auto.source === 'custom' ? '🏷️ 匹配自定义分类' : '🤖 自动识别为');
        wrap.innerHTML = '<span class="auto-tag">' + tag + ' ' + auto.category.icon + ' ' +
          esc(auto.category.name) + ' · 置信度 ' + Math.round(auto.confidence * 100) + '%</span>';
        wrap.style.display = '';
      } else {
        wrap.innerHTML = '';
        wrap.style.display = 'none';
      }
    }
  }

  function handleAction(act, el) {
    switch (act) {
      case 'tab': switchTab(el.dataset.tab); break;

      case 'closeSheet': closeSheet(); break;
      case 'openSettings': openSettings(); break;

      case 'pickCat': {
        var pKind = el.dataset.kind === 'income' ? 'income' : 'expense';
        var pSt = pKind === 'income' ? S.income : S.form;
        pSt.category = el.dataset.id;
        pSt.catLocked = true;
        $$('[data-act="pickCat"][data-kind="' + pKind + '"]').forEach(function (c) {
          c.classList.toggle('active', c.dataset.id === pSt.category);
        });
        // 记住这次选择：下次输入相同或相似内容会自动归到这里
        var learnedRule = Store.learnCategory(pSt.content, pSt.category, pKind);
        var picked = Store.catMeta(pSt.category).name;
        toast(learnedRule
          ? '已选「' + picked + '」，下次会自动归类'
          : '已选择 ' + picked);
        break;
      }

      case 'unlockCat': {
        var uKind = el.dataset.kind === 'income' ? 'income' : 'expense';
        var uSt = uKind === 'income' ? S.income : S.form;
        uSt.catLocked = false;
        refreshAddSuggest(uKind);
        toast('已恢复自动识别');
        break;
      }

      case 'listView':
        S.list.view = el.dataset.view === 'calendar' ? 'calendar' : 'list';
        if (S.list.view === 'calendar' && !S.cal) S.cal = Calendar.initial();
        render();
        break;

      case 'statKind':
        S.stat.kind = el.dataset.kind === 'income' ? 'income' : 'expense';
        render();
        break;

      case 'calPrev':
        if (!S.cal) S.cal = Calendar.initial();
        Calendar.shift(S.cal, -1);
        render();
        break;
      case 'calNext':
        if (!S.cal) S.cal = Calendar.initial();
        Calendar.shift(S.cal, 1);
        render();
        break;
      case 'calDay':
        if (!S.cal) S.cal = Calendar.initial();
        S.cal.selected = el.dataset.date;
        render();
        break;
      case 'calMode':
        S.calMode = el.dataset.mode;
        Store.saveSettings({ calendarMode: el.dataset.mode });
        if (S.cal) S.cal.mode = el.dataset.mode;
        render();
        toast(el.dataset.mode === 'expense' ? '按支出金额显示' : '按预算余额显示');
        break;

      case 'pickTheme': {
        var tid = el.dataset.id;
        Store.saveSettings({ themeId: tid });
        applyTheme();
        $$('#themeGrid .theme-card').forEach(function (c) {
          c.classList.toggle('active', c.dataset.id === tid);
        });
        var h = $('#s-themeid');
        if (h) h.value = tid;
        toast('已切换到「' + Theme.presetOf(tid).name + '」');
        break;
      }

      case 'pickIcon': {
        var iid = el.dataset.id;
        var okIcon = true;
        if (Store.HAS_NATIVE && Android.setLauncherIcon) {
          try { okIcon = Android.setLauncherIcon(iid); } catch (e) { okIcon = false; }
        }
        Store.saveSettings({ launcherIcon: iid });
        var hIcon = $('#s-icon');
        if (hIcon) hIcon.value = iid;
        $$('#iconGrid .icon-card').forEach(function (c) {
          c.classList.toggle('active', c.dataset.id === iid);
        });
        toast(okIcon
          ? '桌面图标已切换，回到桌面看看（可能需要几秒）'
          : '已保存，但这个环境无法直接改桌面图标');
        break;
      }

      case 'setCalMode': {
        var cm = el.dataset.mode === 'expense' ? 'expense' : 'budget';
        Store.saveSettings({ calendarMode: cm });
        var hCal = $('#s-calmode');
        if (hCal) hCal.value = cm;
        $$('[data-act="setCalMode"]').forEach(function (b) {
          b.classList.toggle('active', b.dataset.mode === cm);
        });
        if (S.cal) S.cal.mode = cm;
        toast('日历规则已改为「' + (cm === 'expense' ? '按支出金额' : '按预算余额') + '」');
        break;
      }

      case 'pickLightBg': {
        var lp = el.dataset.id;
        Store.saveSettings({ lightPreset: lp, theme: 'light' });
        applyTheme();
        $$('#bgGrid .bg-card').forEach(function (c) {
          c.classList.toggle('active', c.dataset.id === lp);
        });
        var wrap = $('#lightBgWrap');
        if (wrap) wrap.style.display = lp === 'custom' ? '' : 'none';
        var hint = $('#bgHint');
        if (hint) hint.textContent = Theme.lightPresetOf(lp).desc || '';
        var sw = $('#s-light');
        if (sw) sw.checked = true;
        toast('浅色背景已切换为「' + Theme.lightPresetOf(lp).name + '」');
        break;
      }

      case 'enterEdit':
        S.list.editMode = !S.list.editMode;
        S.list.selected = {};
        render();
        if (S.list.editMode) toast('已进入多选，点条目前面的方框选择');
        break;
      case 'exitEdit':
        S.list.editMode = false;
        S.list.selected = {};
        render();
        break;
      case 'pickRecord': {
        var rid = el.dataset.id;
        S.list.selected[rid] = !S.list.selected[rid];
        // 只更新这一行的样式，避免整页重绘
        el.classList.toggle('on', !!S.list.selected[rid]);
        renderBulkBar();
        break;
      }
      case 'pickAll': {
        var recsAll = recordsFor(S.list).list;
        var curN = 0;
        Object.keys(S.list.selected).forEach(function (k) { if (S.list.selected[k]) curN++; });
        var wantAll = curN < recsAll.length;
        S.list.selected = {};
        if (wantAll) recsAll.forEach(function (r) { S.list.selected[r.id] = true; });
        render();
        break;
      }
      case 'delPicked': {
        var ids2 = Object.keys(S.list.selected).filter(function (k) { return S.list.selected[k]; });
        if (!ids2.length) { toast('还没有选中任何记录'); break; }
        if (!confirm('确定删除选中的 ' + ids2.length + ' 条记录吗？此操作不可恢复。')) break;
        ids2.forEach(function (id) { Store.deleteRecord(id); });
        S.list.selected = {};
        S.list.editMode = false;
        toast('已删除 ' + ids2.length + ' 条记录');
        render();
        break;
      }

      case 'openPayAccess': {
        if (!payAvailable()) { toast('当前环境不支持'); break; }
        try {
          Android.openPayAccessSettings();
          toast('请在系统列表里找到「大肥鱼记账本」并打开开关');
        } catch (e) {
          toast('打不开设置页，请手动到「设置 → 通知 → 通知使用权」里开启');
        }
        break;
      }
      case 'openPayInbox': openPayInbox(); break;

      case 'editHero': openHeroEditor(); break;
      case 'heroBg': {
        var hd = S.heroDraft;
        if (!hd) break;
        hd.bg = el.dataset.bg;
        $$('#h-bg .chip').forEach(function (c) {
          c.classList.toggle('active', c.dataset.bg === hd.bg);
        });
        if (S.heroRepaint) S.heroRepaint();
        break;
      }
      case 'heroIconClear': {
        var hd2 = S.heroDraft;
        if (!hd2) break;
        hd2.iconData = '';
        hd2.clearIcon = true;
        hd2.current = '';
        if (S.heroRepaint) S.heroRepaint();
        toast('将恢复为默认图标，点保存后生效');
        break;
      }
      case 'saveHero': {
        var hd3 = S.heroDraft || {};
        var rootH = $('#sheet');
        var heroPatch = {
          brandTitle: ($('#h-title', rootH) ? $('#h-title', rootH).value : '').trim(),
          brandDesc: ($('#h-desc', rootH) ? $('#h-desc', rootH).value : '').trim(),
          brandIconBg: hd3.bg || 'accent',
          brandIconBgColor: normalizeHex(hd3.bgColor || '#17BE8B')
        };
        var prevIcon = Store.settings().brandIcon;

        if (hd3.iconData && hd3.iconData.indexOf('data:') === 0) {
          var savedName2 = Store.images.save('brand_' + Date.now() + '.png', hd3.iconData);
          if (savedName2) {
            heroPatch.brandIcon = savedName2;
            if (prevIcon && prevIcon !== savedName2) Store.images.remove(prevIcon);
          }
        } else if (hd3.clearIcon) {
          heroPatch.brandIcon = '';
          if (prevIcon) Store.images.remove(prevIcon);
        }

        Store.saveSettings(heroPatch);
        S.ci.src = '';
        S.ci.composed = '';
        applyTheme();
        closeSheet();
        toast('已保存');
        render();
        break;
      }

      case 'cropApply': {
        var tgt = S.cropTarget || 'hero';
        var preset = CROP_PRESETS[tgt] || CROP_PRESETS.hero;
        var cropped = cropOutput(preset.out);
        if (!cropped) { toast('裁剪失败，请重新选图'); break; }
        closeCrop();

        if (tgt === 'goal') {
          S.goalDraft = S.goalDraft || {};
          S.goalDraft.imageData = cropped;
          var gwrap = $('#g-imgwrap');
          if (gwrap) {
            gwrap.innerHTML = '<img class="preview-img" id="g-preview" src="' + cropped + '" />';
          }
        } else if (tgt === 'bg') {
          var prevBg = Store.settings().bgImage;
          var bgName = Store.images.save('bg_' + Date.now() + '.png', cropped);
          if (bgName) {
            Store.saveSettings({ bgImage: bgName });
            if (prevBg && prevBg !== bgName) Store.images.remove(prevBg);
          }
          applyAppBg();
          var bpv = $('#bg-preview');
          if (bpv) bpv.innerHTML = '<img src="' + cropped + '" alt="" />';
        } else {
          if (S.heroDraft) {
            S.heroDraft.iconData = cropped;
            S.heroDraft.clearIcon = false;
          }
          if (S.heroRepaint) S.heroRepaint();
        }
        toast('已应用所选区域');
        break;
      }
      case 'cropCancel': closeCrop(); break;

      case 'pinHeroIcon': {
        if (!customIconSupported()) {
          toast('当前设备的桌面不支持固定快捷方式');
          break;
        }
        var hd4 = S.heroDraft || {};
        // 优先用当前草稿，其次用已保存的图标
        var iconData = hd4.iconData || (Store.settings().brandIcon
          ? Store.images.load(Store.settings().brandIcon) : '');
        if (!iconData) { toast('请先选一张图片'); break; }

        composeIconPng(iconData, iconBgValue(hd4.bg || 'accent', hd4.bgColor), 512,
          function (png) {
            if (!png) { toast('生成图标失败'); return; }
            var label = ($('#h-title') && $('#h-title').value.trim()) || '大肥鱼记账本';
            var ok2 = false;
            try { ok2 = Android.pinCustomIcon(png, label); } catch (e) { ok2 = false; }
            toast(ok2 ? '已发送请求，请在系统弹窗里点「添加」'
                      : '添加失败，可能是桌面不支持固定快捷方式');
          });
        break;
      }

      case 'catDetail': openCategoryDetail(el.dataset.id); break;
      case 'cdSort': {
        var cd = S.catDetail;
        if (!cd) break;
        var want = el.dataset.sort === 'amount' ? 'amount' : 'time';
        if (cd.sort === want) {
          cd.order = cd.order === 'asc' ? 'desc' : 'asc';
        } else {
          cd.sort = want;
          cd.order = want === 'amount' ? 'desc' : 'desc';
        }
        renderCatDetailSheet();
        break;
      }
      case 'cdRange': {
        var cd2 = S.catDetail;
        if (!cd2) break;
        cd2.range = el.dataset.range || 'inherit';
        renderCatDetailSheet();
        break;
      }

      case 'clearBgImage': {
        var oldBg2 = Store.settings().bgImage;
        if (oldBg2) Store.images.remove(oldBg2);
        // 同时关掉主题默认背景，否则「移除」看起来没反应
        Store.saveSettings({ bgImage: '', bgUseThemeDefault: false });
        applyAppBg();
        openSettings();
        toast('背景图已移除');
        break;
      }
      case 'useThemeBg': {
        Store.saveSettings({ bgImage: '', bgUseThemeDefault: true });
        applyAppBg();
        openSettings();
        toast('已恢复主题默认背景');
        break;
      }

      case 'payDiag': openPayDiag(); break;
      case 'reconnectPay': {
        var reOk = false;
        try { reOk = Android.reconnectPay(); } catch (e) { reOk = false; }
        toast(reOk ? '已请求重新连接，等几秒再点一次自检'
                   : '重新连接失败，可以试着重启手机');
        break;
      }
      case 'diagSample': {
        var ta = $('#diag-text');
        if (ta) ta.value = '微信支付\n已支付¥19.32';
        break;
      }
      case 'diagRun': {
        var rawTxt = ($('#diag-text') ? $('#diag-text').value : '').trim();
        if (!rawTxt) { toast('先把通知文字粘进来'); break; }
        var dlines = rawTxt.split(/\r?\n/);
        var dTitle = (dlines[0] || '').trim();
        var dBody = dlines.slice(1).join(' ').trim() || dTitle;

        var tries = [
          ['com.tencent.mm', '微信'],
          ['com.eg.android.AlipayGphone', '支付宝']
        ];
        var hit2 = null;
        tries.forEach(function (p) {
          if (hit2) return;
          var res = null;
          try { res = JSON.parse(Android.testPayParse(p[0], dTitle, dBody) || 'null'); } catch (e) { res = null; }
          if (res && res.ok) hit2 = { name: p[1], r: res };
        });

        var outEl = $('#diag-out');
        if (outEl) {
          outEl.innerHTML = hit2
            ? '<div class="pill ok" style="margin-bottom:9px">识别成功</div>' +
              '<div class="hint" style="line-height:1.9">来源：' + hit2.name +
              '<br>类型：' + (hit2.r.type === 'income' ? '进账' : '支出') +
              '<br>金额：¥' + hit2.r.amount +
              '<br>内容：' + esc(hit2.r.content) + '</div>'
            : '<div class="pill no" style="margin-bottom:9px">没能识别</div>' +
              '<div class="hint" style="line-height:1.9">' +
              '确认一下粘贴的格式（第一行标题、第二行内容），或者把这段原文反馈给我加规则。</div>';
        }
        break;
      }

      case 'payEdit': openPayEdit(el.dataset.id); break;
      case 'payEditCancel': renderPaySheet(); break;
      case 'payEditSave': savePayEdit(el.dataset.id); break;
      case 'peType': {
        S.payEditType = el.dataset.type === 'income' ? 'income' : 'expense';
        $$('#sheet [data-act="peType"]').forEach(function (x) {
          x.classList.toggle('active', x.dataset.type === S.payEditType);
        });
        break;
      }

      case 'payToggle': {
        S.pay.checked[el.dataset.id] = el.checked;
        updatePayConfirmBtn();
        break;
      }
      case 'payAll': {
        var allOn = el.dataset.all === '1';
        S.pay.inbox.forEach(function (p) { S.pay.checked[p.id] = allOn; });
        $$('#sheet input[data-act="payToggle"]').forEach(function (cb) {
          cb.checked = allOn;
        });
        updatePayConfirmBtn();
        break;
      }
      case 'payConfirm': confirmPayImport(); break;
      case 'payClear':
        if (confirm('清空所有待确认的收付款记录？')) {
          try { Android.clearPayInbox(); } catch (e) { /* ignore */ }
          S.pay.inbox = [];
          closeSheet();
          toast('已清空');
          render();
        }
        break;
      case 'payTestInject': {
        if (!payAvailable()) { toast('当前环境不支持'); break; }
        try {
          Android.injectTestPay('微信', 'expense', 12.34, '手动测试·便利店');
        } catch (e) { /* ignore */ }
        refreshPayInbox(true);
        toast('已插入一条测试记录，可到「待确认」里看看');
        break;
      }

      case 'newCat':
        S._catKind = el.dataset.kind === 'income' ? 'income' : 'expense';
        openCategoryEditor(null, S._catKind);
        break;
      case 'editCat': {
        var ec = Store.customCategory(el.dataset.id);
        S._catKind = ec ? ec.kind : 'expense';
        openCategoryEditor(el.dataset.id, S._catKind);
        break;
      }
      case 'catKind':
        S._catKind = el.dataset.kind === 'income' ? 'income' : 'expense';
        $$('[data-act="catKind"]').forEach(function (b) {
          b.classList.toggle('active', b.dataset.kind === S._catKind);
        });
        break;
      case 'catIcon':
        $$('#c-emoji button').forEach(function (b) {
          b.classList.toggle('active', b.dataset.icon === el.dataset.icon);
        });
        break;
      case 'saveCat': {
        var catId = el.dataset.id;
        var data = readCategoryForm(catId, S._catKind || 'expense');
        if (!data.name) { toast('请填写分类名称'); break; }
        if (catId) {
          Store.updateCustomCategory(catId, data);
          toast('分类已更新');
        } else {
          Store.addCustomCategory(data);
          toast('分类已创建');
        }
        openSettings();
        render();
        break;
      }
      case 'delCat':
        if (confirm('删除这个分类？该分类下的记录会退回「其他」。')) {
          Store.deleteCustomCategory(el.dataset.id);
          openSettings();
          toast('分类已删除');
        }
        break;

      case 'openBillImport': openBillImport(); break;
      case 'billRun': runBillRecognize(); break;
      case 'billToggle': {
        var bi = parseInt(el.dataset.i, 10);
        S.imp.checked[bi] = el.checked;
        updateBillImportCount();
        break;
      }
      case 'billCat': {
        var bci = parseInt(el.dataset.i, 10);
        if (S.imp.records[bci]) S.imp.records[bci].category = el.value;
        break;
      }
      case 'billSelectAll': {
        var all = el.dataset.all === '1';
        S.imp.records.forEach(function (r, i) {
          if (r.__bad) return;
          S.imp.checked[i] = all;
        });
        $$('#billList input[type=checkbox][data-i]').forEach(function (cb) {
          var idx = parseInt(cb.dataset.i, 10);
          cb.checked = !!S.imp.checked[idx];
        });
        updateBillImportCount();
        break;
      }
      case 'billConfirm': confirmBillImport(); break;

      case 'save': saveRecord(el.dataset.kind === 'income' ? 'income' : 'expense'); break;
      case 'openRecord': openRecord(el.dataset.id); break;

      case 'saveRecord': saveRecordEdit(el.dataset.id); break;
      case 'delRecord':
        if (confirm('确定删除这条记录吗？')) {
          Store.deleteRecord(el.dataset.id);
          closeSheet();
          toast('已删除');
          render();
        }
        break;
      case 'copyRecord': {
        var r = Store.getRecord(el.dataset.id);
        if (r) copyText(Store.toText([r], { includeNote: true }).replace(/\|【备注：/, ' |【备注：'));
        break;
      }
      case 'reclassify': {
        var r2 = Store.getRecord(el.dataset.id);
        if (!r2) break;
        var root2 = $('#sheet');

        // ⚠️ 关键：先把用户在表单里改动过的内容落盘。
        // 否则重新识别后面板会按数据库里的旧值重绘，
        // 用户刚改的内容就被悄悄回滚了（这就是之前那个 bug）。
        var newContent = $('#ed-content', root2) ? $('#ed-content', root2).value : r2.content;
        var newAmount = $('#ed-amount', root2) ? U.num($('#ed-amount', root2).value) : r2.amount;
        var newType = $('#ed-type', root2)
          ? ($('#ed-type', root2).value === 'income' ? 'income' : 'expense')
          : r2.type;

        Store.updateRecord(r2.id, {
          content: newContent,
          amount: newAmount > 0 ? newAmount : r2.amount,
          type: newType,
          date: $('#ed-date', root2) ? $('#ed-date', root2).value : r2.date,
          time: $('#ed-time', root2) ? $('#ed-time', root2).value : r2.time,
          note: $('#ed-note', root2) ? $('#ed-note', root2).value : r2.note
        });

        // 再基于「改过之后」的内容重新识别
        var fresh = Store.getRecord(r2.id);
        var a = Store.suggestCategory(fresh.content, fresh.note, fresh.type);
        Store.updateRecord(r2.id, { category: a.category.id });
        Store.learnCategory(fresh.content, a.category.id, fresh.type);
        toast('已识别为：' + a.category.name);
        openRecord(r2.id);
        render();
        break;
      }

      case 'edType': {
        var et = el.dataset.type === 'income' ? 'income' : 'expense';
        var hType = $('#ed-type');
        if (hType) hType.value = et;
        $$('[data-act="edType"]').forEach(function (b) {
          b.classList.toggle('active', b.dataset.type === et);
        });
        var sel = $('#ed-cat');
        if (sel) {
          var keep = sel.value;
          sel.innerHTML = catsFor(et).map(function (x) {
            return '<option value="' + x.id + '">' + x.icon + ' ' + esc(x.name) + '</option>';
          }).join('');
          if (keep) sel.value = keep;
          if (!sel.value) sel.selectedIndex = 0;
        }
        break;
      }

      case 'listRange': S.list.range = el.dataset.range; render(); break;
      case 'statRange':
        S.stat.range = el.dataset.range;
        S.stat.anchor = '';       // 换口径就回到「截至今天」
        render();
        break;
      case 'statPrev': shiftStatPeriod(-1); break;
      case 'statNext': shiftStatPeriod(1); break;
      case 'statNow':
        S.stat.anchor = '';
        render();
        break;
      case 'aiRange': S.ai.range = el.dataset.range; render(); break;
      case 'statMode': S.stat.mode = el.dataset.mode; render(); break;

      case 'exportList': {
        var rl = recordsFor(S.list);
        openExport(rl.list, (S.tab === 'stats' ? rangeOf(S.stat.range, S.stat.from, S.stat.to, S.stat.anchor).label
                                              : rl.range.label));
        break;
      }

      case 'doCopyExport': copyText(S._export ? S._export.text : ''); break;
      case 'doShareExport': shareText(S._export ? S._export.text : ''); break;
      case 'doAiExport':
        closeSheet();
        S.ai.range = 'all';
        switchTab('ai');
        S.ai.question = '请分析我的记账记录，找出不必要的花费并给出省钱建议。';
        toast('已切换到 AI 分析');
        render();
        break;

      case 'newGoal': openGoalEditor(null); break;
      case 'editGoal': openGoalEditor(Store.getGoal(el.dataset.id)); break;
      case 'saveGoal': saveGoal(el.dataset.id); break;
      case 'clearGoalImage':
        S.goalDraft = S.goalDraft || {};
        S.goalDraft.imageData = '';
        S.goalDraft.imageId = '';
        $('#g-imgwrap').innerHTML = '<div class="hint" style="margin-bottom:8px">还没有图片</div>';
        toast('已移除图片');
        break;
      case 'delGoal':
        if (confirm('确定删除这个目标吗？')) {
          Store.deleteGoal(el.dataset.id);
          toast('已删除');
          render();
        }
        break;
      case 'deposit': openDeposit(el.dataset.id); break;
      case 'doDeposit':
        doDeposit(el.dataset.id, parseInt(el.dataset.sign || '1', 10));
        break;

      case 'quickAsk': {
        var p = AI.QUICK_PROMPTS[parseInt(el.dataset.i, 10)];
        if (p) askAI(p.q);
        break;
      }
      case 'ask': {
        var q = $('#aiQ') ? $('#aiQ').value : S.ai.question;
        askAI(q);
        break;
      }
      case 'stopAsk':
        if (currentAbort && currentAbort.abort) currentAbort.abort();
        finishAsk();
        break;
      case 'clearChat':
        // 清空全部对话记忆：历史、当前输入、以及正在进行的请求都一起断掉
        if (currentAbort && currentAbort.abort) currentAbort.abort();
        finishAsk();
        Store.clearChats();
        S.ai.question = '';
        S.ai.cleared = true;
        render();
        toast('已清空全部对话记忆');
        break;

      case 'saveSettings': {
        collectSettings($('#sheet'));
        applyTheme();
        toast('设置已保存');
        closeSheet();
        render();
        break;
      }
      case 'testApi': {
        // 只有当设置表单还在时才收集；从结果面板点「重试」时直接沿用已保存的配置
        if ($('#s-base')) collectSettings($('#sheet'));
        var btn = el;
        if (btn) btn.textContent = '测试中…';
        toast('正在测试连接…');
        AI.testConnection(function (err, text) {
          if (btn) btn.textContent = '🔌 测试连接';
          openTestResult(err, text);
        });
        break;
      }
      case 'exportJson': {
        var json = Store.exportJSON();
        openSheet('备份数据', '' +
          '<div class="hint" style="margin-bottom:10px">复制下面的内容保存好，恢复时粘贴回来即可。</div>' +
          '<pre class="export" style="max-height:360px">' + esc(json) + '</pre>' +
          '<div class="btn-row" style="margin-top:12px">' +
            '<button class="btn primary" data-act="doCopyJson">📋 复制备份</button>' +
            '<button class="btn" data-act="doShareJson">📤 分享</button>' +
          '</div>');
        break;
      }
      case 'doCopyJson': copyText(Store.exportJSON()); break;
      case 'doShareJson': shareText(Store.exportJSON()); break;

      case 'importJson':
        openSheet('恢复备份', '' +
          '<div class="hint" style="margin-bottom:10px">把之前备份的 JSON 粘贴到下面，然后点击恢复。' +
          '这会覆盖当前全部数据。</div>' +
          '<textarea class="textarea" id="imp-text" style="min-height:200px" placeholder="{ ... }"></textarea>' +
          '<div class="btn-row" style="margin-top:12px">' +
            '<button class="btn primary" data-act="doImport">确认恢复</button>' +
          '</div>');
        break;
      case 'doImport': {
        var txt = $('#imp-text').value.trim();
        if (!txt) { toast('请先粘贴备份内容'); break; }
        try {
          Store.importJSON(txt);
          closeSheet();
          toast('恢复成功');
          render();
        } catch (e) {
          toast('恢复失败：内容不是有效的备份');
        }
        break;
      }

      case 'clearData':
        if (confirm('确定清空全部记账数据吗？此操作不可恢复。')) {
          if (confirm('再次确认：所有记录与目标都会被删除。')) {
            Store.clearAll(true);
            closeSheet();
            toast('数据已清空');
            render();
          }
        }
        break;
    }
  }

  /* ------------------------------------------------------ 保存逻辑 */

  function saveRecord(kind) {
    kind = kind === 'income' ? 'income' : 'expense';
    var isIncome = kind === 'income';
    var f = isIncome ? S.income : S.form;

    var amount = U.num(f.amount);
    if (!(amount > 0)) { toast('请输入大于 0 的金额'); return; }

    var otherId = isIncome ? 'other_income' : 'other';
    var auto = Store.suggestCategory(f.content, f.note, kind);
    var cat = f.catLocked && f.category ? f.category : (auto.category.id || otherId);
    var wasAuto = !f.catLocked && auto.category.id !== otherId;

    Store.addRecord({
      date: f.date || todayStr(),
      time: f.time || nowTime(),
      amount: amount,
      type: kind,
      content: f.content,
      category: cat,
      note: f.note,
      auto: wasAuto
    });

    // 内容 + 分类 一起记下来，下次自动归类
    if (f.content) Store.learnCategory(f.content, cat, kind);

    toast((isIncome ? '已记进账 +¥' : '已记录 −¥') + fmt(amount) +
          ' · ' + Store.catMeta(cat).name);

    f.amount = '';
    f.content = '';
    f.note = '';
    f.catLocked = false;
    f.category = '';
    f.time = nowTime();
    f.date = todayStr();
    render();
  }

  function saveRecordEdit(id) {
    var root = $('#sheet');
    var old = Store.getRecord(id);
    var content = $('#ed-content', root).value;
    var amount = U.num($('#ed-amount', root).value);
    if (!(amount > 0)) { toast('金额必须大于 0'); return; }

    var newCat = $('#ed-cat', root).value;
    var newType = $('#ed-type', root)
      ? ($('#ed-type', root).value === 'income' ? 'income' : 'expense')
      : (old ? old.type : 'expense');

    Store.updateRecord(id, {
      amount: amount,
      type: newType,
      content: content,
      category: newCat,
      date: $('#ed-date', root).value,
      time: $('#ed-time', root).value,
      note: $('#ed-note', root).value
    });

    // 用户在详情里改了分类，同样记进学习库
    if (content && newCat &&
        (!old || old.category !== newCat || old.type !== newType)) {
      Store.learnCategory(content, newCat, newType);
    }

    closeSheet();
    toast('已保存');
    render();
  }

  function saveGoal(id) {
    var root = $('#sheet');
    var title = $('#g-title', root).value.trim();
    var target = U.num($('#g-target', root).value);
    if (!title) { toast('请填写目标名称'); return; }
    if (!(target > 0)) { toast('请填写目标金额'); return; }

    var draft = S.goalDraft || {};
    var payload = {
      title: title,
      target: target,
      saved: U.num($('#g-saved', root).value),
      deadline: $('#g-deadline', root).value,
      text: $('#g-text', root).value,
      imageId: draft.imageId
    };

    var goal = id ? Store.updateGoal(id, payload) : Store.addGoal(payload);

    /* 图片落盘 */
    if (draft.imageData && draft.imageData.indexOf('data:') === 0) {
      var name = Store.images.save(goal.id, draft.imageData);
      if (name) Store.updateGoal(goal.id, { imageId: name });
    } else if (!draft.imageData && draft.imageId) {
      Store.images.remove(draft.imageId);
      Store.updateGoal(goal.id, { imageId: '' });
    }

    closeSheet();
    toast(id ? '目标已更新' : '目标已创建');
    render();
  }

  function openDeposit(id) {
    var g = Store.getGoal(id);
    if (!g) return;
    var left = Math.max(0, g.target - g.saved);
    var html = '' +
      '<div class="hint" style="margin-bottom:12px">目标「' + esc(g.title) + '」还差 <b style="color:var(--accent)">¥' +
        fmt(left) + '</b> 达成。</div>' +
      '<div class="chips" style="margin-bottom:12px">' +
        [100, 200, 500, 1000].map(function (v) {
          return '<button class="chip" data-act="quickDeposit" data-v="' + v + '">¥' + v + '</button>';
        }).join('') +
        (left > 0 ? '<button class="chip" data-act="quickDeposit" data-v="' + left.toFixed(2) + '">补足 ¥' + fmt(left) + '</button>' : '') +
      '</div>' +
      '<div class="field"><label>存入金额</label>' +
        '<input class="input num" type="text" inputmode="decimal" id="dep-amount" placeholder="0.00" /></div>' +
      '<div class="btn-row">' +
        '<button class="btn primary" data-act="doDeposit" data-id="' + id + '">确认存入</button>' +
        '<button class="btn" data-act="doDeposit" data-id="' + id + '" data-sign="-1">取出</button>' +
      '</div>';
    openSheet('向目标存钱', html, function (root) {
      root.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('[data-act="quickDeposit"]') : null;
        if (b) $('#dep-amount', root).value = b.dataset.v;
      });
    });
  }

  function doDeposit(id, sign) {
    var root = $('#sheet');
    var v = U.num($('#dep-amount', root).value);
    if (!v) { toast('请输入金额'); return; }
    if (sign !== -1) sign = 1;
    Store.depositGoal(id, v * sign);
    closeSheet();
    toast(sign > 0 ? '已存入 ¥' + fmt(v) : '已取出 ¥' + fmt(v));
    render();
  }

  /* ------------------------------------------------------ 启动 */

  /* ------------------------------------------------------ 自动记账 */

  /** 当前环境是否支持通知监听（只有安卓 App 里才有原生桥） */
  function payAvailable() {
    return Store.HAS_NATIVE && Android && typeof Android.listPayInbox === 'function';
  }

  function payBannerHtml() {
    var n = S.pay.inbox.length;
    if (!n) return '';
    return '<div class="pay-banner" data-act="openPayInbox">' +
      '<span class="e">🔔</span>' +
      '<div class="t">' +
        '<div class="l1">检测到 ' + n + ' 笔收付款</div>' +
        '<div class="l2">来自微信 / 支付宝通知，点开核对后写入账本</div>' +
      '</div>' +
      '<span style="color:var(--accent);font-size:19px">›</span>' +
    '</div>';
  }

  /** 读取待确认记录；数量变化时刷新界面 */
  function refreshPayInbox(silent) {
    if (!payAvailable()) return;
    var list;
    try {
      list = JSON.parse(Android.listPayInbox()) || [];
    } catch (e) {
      return;
    }
    try { S.pay.access = !!Android.hasPayAccess(); } catch (e) { S.pay.access = false; }

    var prev = S.pay.inbox.length;
    S.pay.inbox = list;

    if (list.length && Store.settings().payAutoImport) {
      autoImportPay();
      return;
    }

    if (list.length !== prev) {
      // 用户正在输入时不要重绘，免得打断输入
      var ae = document.activeElement;
      var typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
      if (!typing && (S.tab === 'add' || S.tab === 'list')) {
        render();
        if (list.length > prev && !silent) {
          toast('检测到 ' + (list.length - prev) + ' 笔新的收付款');
        }
      }
    }
  }

  /** 开启自动入账时，直接把这些记录写进账本并清空收件箱 */
  function autoImportPay() {
    var inbox = S.pay.inbox;
    if (!inbox.length) return;
    var ids = [];
    var recs = [];
    inbox.forEach(function (p) {
      var when = new Date(p.ts || Date.now());
      var cat = Store.suggestCategory(p.content, p.source, p.type).category.id;
      recs.push({
        date: U.dateStr(when), time: U.timeStr(when),
        amount: p.amount, type: p.type,
        content: p.content, note: '自动记账 · ' + p.source,
        category: cat, auto: true
      });
      ids.push(p.id);
    });
    Store.addRecords(recs);
    try { Android.removePayInbox(JSON.stringify(ids)); } catch (e) { /* ignore */ }
    S.pay.inbox = [];
    toast('已自动记账 ' + recs.length + ' 笔（来自' +
          (inbox[0] ? inbox[0].source : '通知') + '）');
    if (S.tab === 'add' || S.tab === 'list') render();
  }

  function openPayInbox() {
    if (!S.pay.inbox.length) { toast('暂时没有待确认的记录'); return; }
    S.pay.checked = {};
    S.pay.inbox.forEach(function (p) { S.pay.checked[p.id] = true; });
    renderPaySheet();
  }

  function payRowHtml(p) {
    var isIncome = p.type === 'income';
    var srcCls = p.source === '微信' ? 'wx' : (p.source === '支付宝' ? 'ali' : '');
    var when = new Date(p.ts || Date.now());
    return '<div class="pay-item">' +
      '<input type="checkbox" data-act="payToggle" data-id="' + esc(p.id) + '" ' +
        (S.pay.checked[p.id] ? 'checked' : '') + ' />' +
      '<div class="pm" data-act="payEdit" data-id="' + esc(p.id) + '" title="点这里修改这笔记录">' +
        '<div class="l1">' + esc(p.content) +
          (p.edited ? '<span class="edited-tag">已改</span>' : '') + '</div>' +
        '<div class="l2"><span class="src-pill ' + srcCls + '">' + esc(p.source) + '</span>' +
          U.dateStr(when) + ' ' + U.timeStr(when) +
          (p.category ? ' · ' + esc(Store.catMeta(p.category).name) : '') + '</div>' +
        (p.note ? '<div class="l3">' + esc(p.note) + '</div>' : '') +
        '<div class="raw">' + esc(p.raw || '') + '</div>' +
      '</div>' +
      '<div class="pa' + (isIncome ? ' income' : '') + '">' +
        (isIncome ? '+' : '−') + '¥' + fmt(p.amount) + '</div>' +
    '</div>';
  }

  /** 点击待确认记录 → 修改它的内容信息 */
  function openPayEdit(id) {
    var p = null;
    S.pay.inbox.forEach(function (x) { if (x.id === id) p = x; });
    if (!p) return;

    S.payEditId = id;
    S.payEditType = p.type;
    var when = new Date(p.ts || Date.now());
    var kind = p.type === 'income' ? 'income' : 'expense';

    var cats = Classify.list(kind).concat(
      Store.customCategories().filter(function (c) {
        return (c.kind || 'expense') === kind;
      })
    );

    var html =
      '<div class="field"><label>内容</label>' +
        '<input class="input" type="text" id="pe-content" value="' + esc(p.content) + '" /></div>' +
      '<div class="input-row field">' +
        '<div><label>金额</label>' +
          '<input class="input num" type="text" inputmode="decimal" id="pe-amount" value="' +
            p.amount + '" /></div>' +
        '<div><label>类型</label>' +
          '<div class="seg">' +
            '<button class="' + (p.type !== 'income' ? 'active' : '') +
              '" data-act="peType" data-type="expense">支出</button>' +
            '<button class="' + (p.type === 'income' ? 'active' : '') +
              '" data-act="peType" data-type="income">进账</button>' +
          '</div></div>' +
      '</div>' +
      '<div class="field"><label>分类</label>' +
        '<select class="select" id="pe-cat">' +
          '<option value="">自动识别</option>' +
          cats.map(function (c) {
            return '<option value="' + esc(c.id) + '"' +
              (p.category === c.id ? ' selected' : '') + '>' +
              esc(c.icon) + ' ' + esc(c.name) + '</option>';
          }).join('') +
        '</select>' +
        '<div class="hint" style="margin-top:6px">留空则按内容自动归类</div></div>' +
      '<div class="input-row field">' +
        '<div><label>日期</label>' +
          '<input class="input" type="date" id="pe-date" value="' + U.dateStr(when) + '" /></div>' +
        '<div><label>时间</label>' +
          '<input class="input" type="time" id="pe-time" value="' + U.timeStr(when) + '" /></div>' +
      '</div>' +
      '<div class="field"><label>备注</label>' +
        '<input class="input" type="text" id="pe-note" placeholder="可留空" value="' +
          esc(p.note || '') + '" /></div>' +
      '<div class="diag-box"><div class="k">通知原文</div>' +
        '<div class="v">' + esc(p.raw || '（无）') + '</div></div>';

    openSheet('修改这笔收付款', html, null,
      '<div class="btn-row">' +
        '<button class="btn" data-act="payEditCancel">返回</button>' +
        '<button class="btn primary" data-act="payEditSave" data-id="' + esc(id) + '">保存</button>' +
      '</div>');
  }

  function savePayEdit(id) {
    var p = null;
    S.pay.inbox.forEach(function (x) { if (x.id === id) p = x; });
    if (!p) { renderPaySheet(); return; }

    var content = ($('#pe-content') ? $('#pe-content').value : '').trim();
    if (content) p.content = content;

    var amt = parseFloat(($('#pe-amount') ? $('#pe-amount').value : '').replace(/[^\d.]/g, ''));
    if (amt > 0) p.amount = Math.round(amt * 100) / 100;

    p.type = S.payEditType || p.type;
    p.category = $('#pe-cat') ? $('#pe-cat').value : '';
    p.note = $('#pe-note') ? $('#pe-note').value.trim() : '';

    var dEl = $('#pe-date');
    var tEl = $('#pe-time');
    if (dEl && /^\d{4}-\d{2}-\d{2}$/.test(dEl.value)) {
      var tt = (tEl && /^\d{1,2}:\d{2}$/.test(tEl.value)) ? tEl.value : '00:00';
      var parts = dEl.value.split('-');
      p.ts = new Date(+parts[0], +parts[1] - 1, +parts[2],
        +tt.split(':')[0], +tt.split(':')[1]).getTime();
    }

    p.edited = true;
    renderPaySheet();
    toast('已修改，核对后导入');
  }

  function payConfirmLabel() {
    var n = 0;
    S.pay.inbox.forEach(function (p) { if (S.pay.checked[p.id]) n++; });
    return '导入选中的 ' + n + ' 笔';
  }

  function renderPaySheet() {
    openSheet('待确认的收付款',
      '<div class="hint" style="line-height:1.9;margin-bottom:12px">' +
        '这些是通过系统「通知使用权」读到的收付款通知。' +
        '识别属于尽力而为，请核对后再写入账本。<br>' +
        '<b>点某一条可以直接改它的内容、金额、分类和时间。</b>' +
      '</div>' +
      '<div class="btn-row" style="margin-bottom:9px">' +
        '<button class="btn sm" data-act="payAll" data-all="1">全选</button>' +
        '<button class="btn sm" data-act="payAll" data-all="0">全不选</button>' +
      '</div>' +
      '<div class="items">' + S.pay.inbox.map(payRowHtml).join('') + '</div>',
      null,
      '<div class="btn-row">' +
        '<button class="btn danger" data-act="payClear">清空</button>' +
        '<button class="btn primary" data-act="payConfirm" id="payConfirmBtn">' +
          payConfirmLabel() + '</button>' +
      '</div>');
  }

  function updatePayConfirmBtn() {
    var b = $('#payConfirmBtn');
    if (b) b.textContent = payConfirmLabel();
  }

  function confirmPayImport() {
    var ids = [];
    var recs = [];
    S.pay.inbox.forEach(function (p) {
      if (!S.pay.checked[p.id]) return;
      var when = new Date(p.ts || Date.now());
      // 用户手动改过分类就用他的，否则按内容自动归类
      var cat = p.category || Store.suggestCategory(p.content, p.source, p.type).category.id;
      recs.push({
        date: U.dateStr(when), time: U.timeStr(when),
        amount: p.amount, type: p.type,
        content: p.content, note: p.note || ('自动记账 · ' + p.source),
        category: cat, auto: true
      });
      ids.push(p.id);
    });
    if (!recs.length) { toast('没有勾选任何记录'); return; }

    Store.addRecords(recs);
    try { Android.removePayInbox(JSON.stringify(ids)); } catch (e) { /* ignore */ }
    S.pay.inbox = S.pay.inbox.filter(function (p) { return ids.indexOf(p.id) < 0; });

    if (S.pay.inbox.length) {
      S.pay.checked = {};
      S.pay.inbox.forEach(function (p) { S.pay.checked[p.id] = true; });
      renderPaySheet();
    } else {
      closeSheet();
    }
    toast('已导入 ' + recs.length + ' 笔');
    render();
  }

  /* ------------------------------------------------------ 账单导入 */

  function openBillImport() {
    S.imp = { images: [], records: [], checked: {}, busy: false, raw: '' };
    var hasVision = BillImport.visionConfigured();

    openSheet('从账单导入', '' +
      '<div class="hint" style="line-height:1.9;margin-bottom:12px">' +
        '支持微信 / 支付宝的<b>账单截图</b>（长截图也行），或<b>导出的 CSV / 明细文本</b>。<br>' +
        '识别结果会先列出来让你核对勾选，确认后才写进账本。' +
      '</div>' +

      '<label class="drop-zone file-btn" style="display:block">' +
        '<div class="e">📷</div>' +
        '<div class="t">选择账单截图</div>' +
        '<div class="s">可多选 · 长图会自动压缩后交给视觉模型识别</div>' +
        '<input type="file" accept="image/*" multiple id="bill-file" />' +
      '</label>' +

      '<div class="sec-title">或者粘贴账单文本 / CSV</div>' +
      '<textarea class="textarea" id="bill-text" style="min-height:130px" ' +
        'placeholder="把支付宝或微信导出的账单明细、CSV 内容粘贴到这里。这条路径完全本地解析，不需要 API。">' +
      '</textarea>' +
      '<div class="btn-row" style="margin-top:10px">' +
        '<button class="btn" data-act="billRun">📝 解析文本</button>' +
      '</div>' +

      '<div id="billStatus" class="hint" style="margin-top:12px;line-height:1.85"></div>' +
      '<div id="billPreview"></div>' +

      (!hasVision
        ? '<div class="hint" style="margin-top:14px;color:var(--warn);line-height:1.85">' +
          '⚠️ 截图识别需要配置一个能读图的模型。<br>' +
          '到「设置 → 大模型接口」，把『视觉模型』填成 qwen-vl-max、glm-4v、gpt-4o 之类的多模态模型。<br>' +
          '「粘贴文本」这条路径不需要任何 API。' +
          '</div>'
        : ''),

      function (root) {
        var fi = $('#bill-file', root);
        if (!fi) return;
        fi.addEventListener('change', function (e) {
          var files = Array.prototype.slice.call(e.target.files || []);
          if (files.length) handleBillImages(files);
        });
      });
  }

  function setBillStatus(msg, isErr) {
    var el = $('#billStatus');
    if (!el) return;
    el.innerHTML = esc(msg).replace(/\n/g, '<br>');
    el.style.color = isErr ? 'var(--danger)' : '';
  }

  function handleBillImages(files) {
    if (!BillImport.visionConfigured()) {
      setBillStatus('还没有配置视觉模型，无法识别截图。可以先改用下面的「粘贴账单文本」。', true);
      return;
    }
    if (S.imp.busy) { toast('正在识别中，请稍候'); return; }
    S.imp.busy = true;
    setBillStatus('正在压缩 ' + files.length + ' 张图片…');

    var images = [];
    var done = 0;
    files.forEach(function (f, idx) {
      BillImport.compressImageFile(f, 1600, 0.82, function (dataUrl) {
        if (dataUrl) images[idx] = dataUrl;
        done++;
        if (done < files.length) return;
        images = images.filter(Boolean);
        if (!images.length) {
          S.imp.busy = false;
          setBillStatus('图片读取失败，换一张试试。', true);
          return;
        }
        S.imp.images = images;
        setBillStatus('已压缩 ' + images.length + ' 张，正在请求视觉模型识别…');
        runVisionRecognize(images);
      });
    });
  }

  function runVisionRecognize(images) {
    S.imp.raw = '';
    BillImport.recognizeImages(images, {
      onDelta: function (t) {
        S.imp.raw += t;
        setBillStatus('模型正在识别…已收到 ' + S.imp.raw.length + " 字符");
      },
      onDone: function (records) {
        S.imp.busy = false;
        S.imp.records = records;
        S.imp.checked = {};
        records.forEach(function (r, i) { S.imp.checked[i] = true; });
        var note = records.fixedYears
          ? '（有 ' + records.fixedYears + ' 条没识别到年份，已按最近的时间填成 ' +
            Store.util.dateStr(new Date()) + ' 前后）'
          : '请核对后导入。';
        setBillStatus('识别到 ' + records.length + ' 条记录，' + note);
        renderBillPreview();
      },
      onError: function (msg) {
        S.imp.busy = false;
        setBillStatus(msg, true);
      }
    });
  }

  function runBillRecognize() {
    var txt = $('#bill-text') ? $('#bill-text').value : '';
    if (!String(txt).trim()) { toast('请先粘贴账单文本'); return; }
    var records = BillImport.parseText(txt);
    if (!records.length) {
      setBillStatus('没能从这段文本里解析出记录。\n请确认粘贴的是账单明细或 CSV 内容。', true);
      return;
    }
    S.imp.records = records;
    S.imp.checked = {};
    records.forEach(function (r, i) { S.imp.checked[i] = true; });
    setBillStatus('解析出 ' + records.length + ' 条记录（本地解析，未使用 API），请核对后导入。');
    renderBillPreview();
  }

  function billConfirmLabel() {
    var n = 0;
    S.imp.records.forEach(function (r, i) { if (S.imp.checked[i]) n++; });
    return '导入选中的 ' + n + ' 笔';
  }

  function updateBillImportCount() {
    var btn = $('#billConfirmBtn');
    if (btn) btn.textContent = billConfirmLabel();
  }

  function renderBillPreview() {
    var el = $('#billPreview');
    if (!el) return;
    var recs = S.imp.records;
    if (!recs.length) { el.innerHTML = ''; return; }

    var rows = recs.map(function (r, i) {
      var isIncome = r.type === 'income';
      var guessed = r.category || Store.suggestCategory(r.content, '', r.type).category.id;
      var options = catsFor(r.type).map(function (c) {
        return '<option value="' + c.id + '"' + (c.id === guessed ? ' selected' : '') + '>' +
               c.icon + ' ' + esc(c.name) + '</option>';
      }).join('');

      return '<div class="imp-item">' +
        '<input type="checkbox" data-i="' + i + '" data-act="billToggle" ' +
          (S.imp.checked[i] ? 'checked' : '') + ' />' +
        '<div class="im">' +
          '<div class="l1">' + esc(r.content) + '</div>' +
          '<div class="l2">' + esc(r.date) + ' ' + esc(r.time) +
            (r.note ? ' · ' + esc(r.note) : '') + '</div>' +
          '<select data-act="billCat" data-i="' + i + '">' + options + '</select>' +
        '</div>' +
        '<div class="ia' + (isIncome ? ' income' : '') + '">' +
          (isIncome ? '+' : '−') + '¥' + fmt(r.amount) + '</div>' +
      '</div>';
    }).join('');

    el.innerHTML = '<div class="sec-title">识别结果</div>' +
      '<div class="btn-row" style="margin-bottom:9px">' +
        '<button class="btn sm" data-act="billSelectAll" data-all="1">全选</button>' +
        '<button class="btn sm" data-act="billSelectAll" data-all="0">全不选</button>' +
      '</div>' +
      '<div class="items" id="billList">' + rows + '</div>' +
      '<button class="btn primary block lg" style="margin-top:12px" data-act="billConfirm" ' +
        'id="billConfirmBtn">' + billConfirmLabel() + '</button>';
  }

  function confirmBillImport() {
    var toAdd = [];
    S.imp.records.forEach(function (r, i) {
      if (!S.imp.checked[i]) return;
      var cat = r.category || Store.suggestCategory(r.content, '', r.type).category.id;
      toAdd.push({
        date: r.date, time: r.time, amount: r.amount, type: r.type,
        content: r.content, note: r.note, category: cat, auto: true
      });
      // 顺手学习一次，下次同样内容直接归类
      Store.learnCategory(r.content, cat, r.type);
    });

    if (!toAdd.length) { toast('没有勾选任何记录'); return; }
    Store.addRecords(toAdd);
    closeSheet();
    toast('已导入 ' + toAdd.length + ' 笔记录');
    render();
  }

  /* ------------------------------------------------------ 图标合成工具

     设置页里的「自定义桌面图标」和「首页图标」共用这套逻辑。
     单独暴露出来有两个用处：
       1) 后续要在别处（比如目标配图）复用同一套合成规则
       2) 自动化测试与截图脚本可以绕过 <input type=file> 直接驱动它
     ---------------------------------------------------------------- */

  var IconKit = {
    /** 背景选项 -> 实际颜色值 */
    bgValue: iconBgValue,

    /** 把「背景 + 图片」合成正方形 PNG（保留透明通道） */
    compose: composeIconPng,

    /** 读取用户选择的图片文件，输出 PNG dataURL（保留 alpha） */
    loadFile: loadImageFile,

    /** 当前裁剪选区状态（只读快照） */
    cropState: function () {
      return {
        ready: !!crop.img, x: crop.x, y: crop.y, zoom: crop.zoom,
        base: crop.base, w: crop.w, h: crop.h,
        imgW: crop.zw, imgH: crop.zh,
        target: S.cropTarget, presets: Object.keys(CROP_PRESETS)
      };
    },

    /**
     * 直接载入一张图片到裁剪器。
     * 自动化测试和截图脚本靠它绕过 <input type=file>。
     * @param {string} src
     * @param {string} [target] 'hero' | 'goal'
     * @param {Function} [done]
     */
    loadInto: function (src, target, done) {
      if (typeof target === 'function') { done = target; target = 'hero'; }
      var p = CROP_PRESETS[target] || CROP_PRESETS.hero;
      S.cropTarget = CROP_PRESETS[target] ? target : 'hero';
      var box = document.querySelector('#crop-box');
      if (box) box.style.display = '';
      var lb = document.querySelector('#crop-label');
      if (lb) lb.textContent = p.label;
      cropInit(src, p.w, p.ratio, done);
    },

    /** 平移裁剪选区（模拟拖动） */
    panBy: function (dx, dy) {
      crop.x += dx;
      crop.y += dy;
      cropDraw();
    },

    /** 设置缩放倍数（1~4） */
    zoomTo: function (z) {
      crop.zoom = Math.max(1, Math.min(4, Number(z) || 1));
      cropDraw();
    },

    /** 输出当前裁剪切图 */
    output: cropOutput,
    redraw: cropDraw
  };
  window.IconKit = IconKit;

  function init() {
    Store.init();
    applyTheme();
    bindInputs();

    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!el) return;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return;
      handleAction(el.dataset.act, el);
    });

    /* 滚动阴影 */
    $('#view').addEventListener('scroll', function () {
      var v = $('#view');
      var top = v.scrollTop > 4;
      var bar = document.querySelector('.topbar');
      if (bar) bar.classList.toggle('scrolled', top);
    });

    /* 离开页面时确保落盘 */
    window.addEventListener('pagehide', function () { Store.flush(); });
    window.addEventListener('beforeunload', function () { Store.flush(); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) Store.flush();
    });

    /* 时间输入默认值 */
    S.form.date = todayStr();
    S.form.time = nowTime();
    S.income.date = todayStr();
    S.income.time = nowTime();

    // 默认分类
    S.form.category = Store.suggestCategory('', '', 'expense').category.id;
    S.income.category = Store.suggestCategory('', '', 'income').category.id;

    S.cal = Calendar.initial();

    // 桌面图标可能被系统或其它设备改过，以实际启用的为准
    if (Store.HAS_NATIVE && Android.getLauncherIcon) {
      try {
        var realIcon = Android.getLauncherIcon();
        if (realIcon && realIcon !== Store.settings().launcherIcon) {
          Store.saveSettings({ launcherIcon: realIcon });
        }
      } catch (e) { /* 忽略 */ }
    }

    // 自动记账：读取待确认记录，并在前台定时轮询（通知服务会持续写入收件箱）
    if (payAvailable()) {
      refreshPayInbox(true);
      S.pay.timer = setInterval(function () { refreshPayInbox(false); }, 6000);
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) refreshPayInbox(true);
      });
    }

    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
