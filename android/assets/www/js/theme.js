/* ============================================================
   主题系统
   - 一套主色驱动全局强调色
   - 预设：记账绿 / DeepSeek 蓝 / 樱花粉 / 星河紫 / 暖阳橙
   - 角色主题：鲸鱼娘 Q 版、鲸鱼娘成熟版（额外挂载立绘）
   - 自定义：用户用取色器挑任意颜色
   - 所有派生色在 JS 里算好写成 CSS 变量，
     避免依赖 color-mix()（部分老 WebView 不支持）
   ============================================================ */
(function (global) {
  'use strict';

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function hexToRgb(hex) {
    var h = String(hex || '').trim().replace(/^#/, '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return { r: 23, g: 190, b: 139 };
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16)
    };
  }

  function toHex(r, g, b) {
    var f = function (v) { return clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0'); };
    return '#' + f(r) + f(g) + f(b);
  }

  /** 明暗调整：amt 为 -1~1，正数变亮、负数变暗 */
  function shade(hex, amt) {
    var c = hexToRgb(hex);
    if (amt >= 0) {
      return toHex(c.r + (255 - c.r) * amt, c.g + (255 - c.g) * amt, c.b + (255 - c.b) * amt);
    }
    var k = 1 + amt;
    return toHex(c.r * k, c.g * k, c.b * k);
  }

  function rgba(hex, a) {
    var c = hexToRgb(hex);
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
  }

  /** 相对亮度，用于决定强调色上的文字用黑还是白 */
  function luminance(hex) {
    var c = hexToRgb(hex);
    var f = function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }

  /* ------------------------------------------------------ 预设 */

  var PRESETS = [
    {
      id: 'default', name: '记账绿', color: '#17BE8B', dark: '#0E9F6E',
      desc: '默认配色，清爽耐看'
    },
    {
      id: 'deepseek', name: 'DeepSeek 蓝', color: '#4D6BFE', dark: '#3550D8',
      desc: 'DeepSeek 品牌蓝，冷静专业'
    },
    {
      id: 'pink', name: '樱花粉', color: '#FF6FA5', dark: '#E14C87',
      desc: '柔和粉色，少女感'
    },
    {
      id: 'violet', name: '星河紫', color: '#8B5CF6', dark: '#7040E0',
      desc: '梦幻紫，夜间友好'
    },
    {
      id: 'amber', name: '暖阳橙', color: '#F59E0B', dark: '#D97706',
      desc: '温暖橙，醒目有活力'
    },
    {
      id: 'whaleQ', name: '鲸鱼娘 · Q版', color: '#2E7BE8', dark: '#1B54B0',
      desc: 'Q 版大肥鱼主题，深海蓝配色 + 立绘',
      mascot: 'img/mascot-q.png',
      art: 'img/art-q.png',
      defaultBg: 'img/bg-q.jpg',
      bgStyle: { scale: 1.1, opacity: 0.8, blur: 5 }
    },
    {
      id: 'whaleM', name: '鲸鱼娘 · 成熟版', color: '#3053C8', dark: '#1E3A9E',
      desc: '成熟比例鲸鱼娘，钴蓝配色 + 立绘',
      mascot: 'img/mascot-m-face.png',
      art: 'img/art-m.png',
      defaultBg: 'img/bg-m.jpg',
      bgStyle: { scale: 1.1, opacity: 0.8, blur: 5 }
    },
    {
      id: 'fish', name: '大肥鱼表情包', color: '#4D6BFE', dark: '#3550D8',
      desc: 'DeepSeek 蓝 + 大肥鱼表情包头像',
      mascot: 'img/mascot-fish.png'
    },
    {
      id: 'custom', name: '自定义颜色', color: '#17BE8B', dark: '#0E9F6E',
      desc: '自己挑一个喜欢的颜色'
    }
  ];

  var BY_ID = {};
  PRESETS.forEach(function (p) { BY_ID[p.id] = p; });

  var DEFAULT_COLOR = '#17BE8B';

  /* ------------------------------------------------------ 浅色主题背景 */

  /**
   * 浅色模式下的背景方案。
   * 「护眼绿 / 暖黄护眼」是长时间看屏幕时比较舒服的低蓝光底色。
   */
  var LIGHT_PRESETS = [
    { id: 'white', name: '纯白', bg: '#FAFBFC', card: '#FFFFFF',
      card2: '#F2F4F8', line: '#E4E8F0', desc: '默认，干净清爽' },
    { id: 'cream', name: '米白', bg: '#FAF6EF', card: '#FFFDF9',
      card2: '#F5F0E7', line: '#EBE3D6', desc: '微微发暖，不刺眼' },
    { id: 'eye', name: '护眼绿', bg: '#C7EDCC', card: '#E6F7E8',
      card2: '#DBF2DE', line: '#AFDCB5', desc: '经典豆沙绿，长时间看不累' },
    { id: 'sepia', name: '暖黄护眼', bg: '#FBF0D9', card: '#FFF9EC',
      card2: '#F7EBD5', line: '#EBDCBB', desc: '低蓝光，夜里更柔和' },
    { id: 'gray', name: '淡灰蓝', bg: '#E9EEF5', card: '#FFFFFF',
      card2: '#F1F4F9', line: '#D5DEEA', desc: '冷静的中性灰' },
    { id: 'custom', name: '自定义', bg: '#FFFFFF', card: '#FFFFFF',
      card2: '#F2F4F8', line: '#E4E8F0', desc: '自己挑一个背景色' }
  ];

  var LIGHT_BY_ID = {};
  LIGHT_PRESETS.forEach(function (p) { LIGHT_BY_ID[p.id] = p; });

  function lightPresetOf(id) { return LIGHT_BY_ID[id] || LIGHT_BY_ID.white; }

  function isHex(v) { return /^#[0-9a-fA-F]{6}$/.test(String(v || '').trim()); }

  /**
   * 算出浅色模式实际要用的背景 / 卡片 / 描边色。
   * 预设直接用定义好的色值；自定义则以用户选的底色推导出卡片与描边，
   * 保证卡片始终比背景亮、能看出层次。
   */
  function lightPalette(presetId, customBg) {
    var preset = lightPresetOf(presetId);
    if (preset.id !== 'custom') {
      return {
        bg: preset.bg, card: preset.card,
        card2: preset.card2, line: preset.line,
        preset: preset
      };
    }

    var bg = isHex(customBg) ? customBg : '#FFFFFF';
    var card = shade(bg, 0.72);
    if (luminance(card) < 0.62) card = shade(bg, 0.9);
    var card2 = shade(card, -0.08);
    var line = shade(bg, -0.14);
    // 描边不能比卡片还亮，否则边框会消失
    if (luminance(line) > luminance(card)) line = shade(card, -0.14);

    return { bg: bg, card: card, card2: card2, line: line, preset: preset };
  }

  /** 把浅色配色写进 CSS 变量 */
  function applyLight(root, presetId, customBg) {
    var p = lightPalette(presetId, customBg);
    var st = root.style;
    st.setProperty('--bg', p.bg);
    st.setProperty('--bg-2', p.card);
    st.setProperty('--card', p.card);
    st.setProperty('--card-2', p.card2);
    st.setProperty('--line', p.line);
    return p;
  }

  /** 切回深色时把这些被 JS 覆盖过的变量清掉，让 CSS 里的深色值生效 */
  function clearLightOverrides(root) {
    var st = root.style;
    ['--bg', '--bg-2', '--card', '--card-2', '--line'].forEach(function (k) {
      st.removeProperty(k);
    });
  }

  /** 主题里用于插画的立绘（非角色主题返回空） */
  function mascotOf(id) {
    var p = BY_ID[id];
    return (p && p.mascot) || '';
  }

  /** 主题自带的默认应用背景（没有则返回空） */
  function defaultBgOf(id) {
    var p = BY_ID[id];
    return (p && p.defaultBg) || '';
  }

  /** 主题默认背景自带的显示参数（缩放 / 透明度 / 虚化） */
  function defaultBgStyleOf(id) {
    var p = BY_ID[id];
    return (p && p.bgStyle) || null;
  }

  function artOf(id) {
    var p = BY_ID[id];
    return (p && p.art) || '';
  }

  function presetOf(id) { return BY_ID[id] || BY_ID.default; }

  /**
   * 把主题应用到 <html>。
   * @param {Object} settings 应用的 settings 对象
   */
  function apply(settings) {
    settings = settings || {};
    var id = settings.themeId || 'default';
    var preset = presetOf(id);

    var color = preset.color;
    if (id === 'custom') {
      var userColor = String(settings.themeColor || '').trim();
      if (/^#[0-9a-fA-F]{6}$/.test(userColor)) color = userColor;
    }

    var root = document.documentElement;
    var isLight = settings.theme === 'light';
    root.setAttribute('data-theme', isLight ? 'light' : 'dark');
    root.setAttribute('data-theme-id', id);

    // 浅色模式下按用户选的背景方案覆盖底色
    if (isLight) {
      applyLight(root, settings.lightPreset || 'white', settings.lightBg);
    } else {
      clearLightOverrides(root);
    }

    var dark = (id === 'custom') ? shade(color, -0.18) : preset.dark;
    var lum = luminance(color);
    // 强调色上的文字：亮色底用深色字，暗色底用白字
    var ink = lum > 0.55 ? '#0B1220' : '#FFFFFF';

    var style = root.style;
    style.setProperty('--accent', color);
    style.setProperty('--accent-dark', dark);
    style.setProperty('--accent-soft', rgba(color, 0.14));
    style.setProperty('--accent-softer', rgba(color, 0.08));
    style.setProperty('--accent-line', rgba(color, 0.42));
    style.setProperty('--accent-ink', ink);

    return { id: id, color: color, dark: dark, preset: preset };
  }

  global.Theme = {
    PRESETS: PRESETS,
    LIGHT_PRESETS: LIGHT_PRESETS,
    lightPresetOf: lightPresetOf,
    lightPalette: lightPalette,
    presetOf: presetOf,
    mascotOf: mascotOf,
    defaultBgOf: defaultBgOf,
    defaultBgStyleOf: defaultBgStyleOf,
    artOf: artOf,
    apply: apply,
    shade: shade,
    rgba: rgba,
    luminance: luminance,
    hexToRgb: hexToRgb,
    isHex: isHex,
    DEFAULT_COLOR: DEFAULT_COLOR
  };
})(window);
