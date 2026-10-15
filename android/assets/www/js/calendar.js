/* ============================================================
   日历视图
   - 按天显示「+ / − 余额」
   - 两种配色规则（可在设置里切换）：
       budget  ：以日额度为基准，没花完显示绿色 +剩余，花超了显示红色 −超出
       expense ：只要有支出就显示红色 −金额；当天的进账用绿色 +金额 另列
   ============================================================ */
(function (global) {
  'use strict';

  var WEEK_HEAD = ['一', '二', '三', '四', '五', '六', '日'];

  function round2(v) { return Math.round((Number(v) || 0) * 100) / 100; }

  /** 日历格子空间很小，金额要压缩显示 */
  function short(v) {
    v = Math.abs(Number(v) || 0);
    if (v >= 10000) return (v / 10000).toFixed(1) + '万';
    if (v >= 1000) return (Math.round(v / 100) / 10) + 'k';
    if (v >= 100) return String(Math.round(v));
    if (v === 0) return '0';
    return String(Math.round(v * 10) / 10);
  }

  function monthTitle(year, month) {
    return year + '年' + (month + 1) + '月';
  }

  /** 该月在日历里的日额度（budget 模式用） */
  function dailyAllowance(dayCount) {
    var s = global.Store.settings();
    if (Number(s.dailyBudget) > 0) return round2(s.dailyBudget);
    if (Number(s.monthlyBudget) > 0 && dayCount > 0) {
      return round2(Number(s.monthlyBudget) / dayCount);
    }
    return 0;
  }

  /**
   * 渲染整块日历（含月份切换、格子、图例、月度汇总、选中日明细）
   * @param {Object} state     { year, month, selected, mode }
   * @param {Function} renderRow 由 app.js 注入的单条记录渲染函数
   */
  function render(state, renderRow) {
    var Store = global.Store;
    var s = Store.settings();
    var mode = state.mode || s.calendarMode || 'budget';
    var grid = Store.monthGrid(state.year, state.month);
    var allowance = mode === 'budget' ? dailyAllowance(grid.days.length) : 0;

    var todayStr = Store.util.dateStr(new Date());

    /* --- 表头 --- */
    var head = '' +
      '<div class="cal-head">' +
        '<button class="cal-nav" data-act="calPrev">‹</button>' +
        '<div class="title">' + monthTitle(state.year, state.month) + '</div>' +
        '<button class="cal-nav" data-act="calNext">›</button>' +
      '</div>' +
      '<div class="cal-grid">' +
        WEEK_HEAD.map(function (w, i) {
          return '<div class="cal-wd' + (i >= 5 ? ' we' : '') + '">' + w + '</div>';
        }).join('') +
      '</div>';

    /* --- 格子 --- */
    var offset = (new Date(state.year, state.month, 1).getDay() + 6) % 7; // 周一为第一列
    var cells = '';
    for (var i = 0; i < offset; i++) {
      cells += '<div class="cal-cell empty"></div>';
    }

    grid.days.forEach(function (d) {
      var main = '';
      var cls = 'zero';
      var sub = '';

      if (mode === 'budget') {
        if (allowance > 0) {
          if (d.expense > 0 || d.income > 0) {
            var v = round2(allowance - d.expense + d.income);
            main = (v >= 0 ? '+' : '−') + short(v);
            cls = v >= 0 ? 'pos' : 'neg';
          }
        } else {
          // 没设预算时退化为「纯支出」显示
          if (d.expense > 0) { main = '−' + short(d.expense); cls = 'neg'; }
          if (d.income > 0) {
            if (!main) { main = '+' + short(d.income); cls = 'pos'; }
            else sub = '+' + short(d.income);
          }
        }
      } else {
        if (d.expense > 0) { main = '−' + short(d.expense); cls = 'neg'; }
        if (d.income > 0) {
          if (!main) { main = '+' + short(d.income); cls = 'pos'; }
          else sub = '+' + short(d.income);
        }
      }

      var isToday = d.date === todayStr;
      var isSel = d.date === state.selected;
      cells += '<div class="cal-cell' + (isToday ? ' today' : '') +
        (isSel ? ' sel' : '') + (d.count ? ' has' : '') +
        '" data-act="calDay" data-date="' + d.date + '">' +
        '<span class="d">' + d.day + '</span>' +
        (main ? '<span class="v ' + cls + '">' + main + '</span>' : '') +
        (sub ? '<span class="sub pos">' + sub + '</span>' : '') +
        '<span class="dotm"></span>' +
      '</div>';
    });

    /* --- 月度汇总 --- */
    var totalExpense = 0, totalIncome = 0;
    grid.days.forEach(function (d) {
      totalExpense = round2(totalExpense + d.expense);
      totalIncome = round2(totalIncome + d.income);
    });
    var net = round2(totalIncome - totalExpense);

    var summary = '<div class="cal-sum">' +
      '<div class="s"><div class="k">本月支出</div><div class="v" style="color:#FF5C68">¥' +
        Store.util.money(totalExpense) + '</div></div>' +
      '<div class="s"><div class="k">本月进账</div><div class="v" style="color:var(--accent)">¥' +
        Store.util.money(totalIncome) + '</div></div>' +
      '<div class="s"><div class="k">结余</div><div class="v" style="color:' +
        (net >= 0 ? 'var(--accent)' : '#FF5C68') + '">¥' + Store.util.money(net) + '</div></div>' +
    '</div>';

    /* --- 图例 --- */
    var legend = '<div class="cal-legend">' +
      '<span class="k"><span class="sw" style="background:#22C55E"></span>绿色 + ：' +
        (mode === 'budget' ? '没花完的剩余额度' : '当天有进账') + '</span>' +
      '<span class="k"><span class="sw" style="background:#FF5C68"></span>红色 − ：' +
        (mode === 'budget' ? '花超了 / 支出' : '当天有支出') + '</span>' +
      '<span class="k"><span class="sw" style="background:var(--accent);border-radius:50%"></span>小圆点：当天有记录</span>' +
    '</div>';

    /* --- 选中日的明细 --- */
    var detail = '';
    if (state.selected) {
      var dayRecords = Store.query({ from: state.selected, to: state.selected });
      var dayTotal = Store.sumExpense(dayRecords);
      var dayIn = Store.sumIncome(dayRecords);
      detail = '<div class="day-group" style="margin-top:14px">' +
        '<div class="day-head"><span class="d">' + state.selected + ' ' +
          global.Store.util.weekday(state.selected) + '</span>' +
          '<span class="t">' +
            (dayIn > 0 ? '<span style="color:var(--accent)">+¥' + Store.util.money(dayIn) + '</span> ' : '') +
            '−¥' + Store.util.money(dayTotal) +
          '</span></div>' +
        (dayRecords.length
          ? '<div class="items">' + dayRecords.map(function (r) {
              return renderRow ? renderRow(r) : '';
            }).join('') + '</div>'
          : '<div class="hint" style="padding:6px 4px">这天没有记录</div>') +
      '</div>';
    }

    return head + '<div class="cal-grid">' + cells + '</div>' + legend + summary + detail;
  }

  /** 生成一个月的状态对象（默认定位到当前月） */
  function initial(year, month) {
    var now = new Date();
    return {
      year: year === undefined ? now.getFullYear() : year,
      month: month === undefined ? now.getMonth() : month,
      selected: Store.util.dateStr(now),
      mode: Store.settings().calendarMode || 'budget'
    };
  }

  function shift(state, delta) {
    var d = new Date(state.year, state.month + delta, 1);
    state.year = d.getFullYear();
    state.month = d.getMonth();
    return state;
  }

  global.Calendar = {
    render: render,
    initial: initial,
    shift: shift,
    WEEK_HEAD: WEEK_HEAD,
    monthTitle: monthTitle,
    dailyAllowance: dailyAllowance,
    short: short
  };
})(window);
