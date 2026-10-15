/* ============================================================
   大模型接入层
   - 多厂商预设，接口统一走 OpenAI 兼容的 /chat/completions
   - 原生端通过 JsBridge 发请求（无 CORS 限制），浏览器端降级为 fetch
   - 支持流式（SSE）与一次性返回
   ============================================================ */
(function (global) {
  'use strict';

  var HAS_NATIVE = (typeof Android !== 'undefined') && Android &&
                   (typeof Android.httpRequest === 'function');

  /*
   * 预设服务商。
   *
   * vision 字段标出「能看图」的模型，用于账单截图识别；
   * free 字段标出「有免费额度 / 完全免费」的选项，
   * 因为很多人只想用免费额度做截图识别。
   */
  var PRESETS = [
    { id: 'deepseek', name: 'DeepSeek 深度求索', base: 'https://api.deepseek.com', model: 'deepseek-chat', keyUrl: 'https://platform.deepseek.com' },

    // ---- 有免费额度的视觉模型（截图识别用这些最省钱）----
    { id: 'zhipu', name: '智谱 GLM（GLM-4V-Flash 免费）', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', vision: 'glm-4v-flash', keyUrl: 'https://open.bigmodel.cn', free: true,
      note: 'glm-4v-flash 目前免费，适合做账单截图识别' },
    { id: 'siliconflow', name: '硅基流动 SiliconFlow（有免费模型）', base: 'https://api.siliconflow.cn', model: 'Qwen/Qwen2.5-7B-Instruct', vision: 'Qwen/Qwen2-VL-7B-Instruct', keyUrl: 'https://siliconflow.cn', free: true,
      note: '注册送额度，部分视觉模型免费' },
    { id: 'dashscope', name: '阿里云通义千问（有免费额度）', base: 'https://dashscope.aliyuncs.com/compatible-mode', model: 'qwen-plus', vision: 'qwen-vl-max', keyUrl: 'https://bailian.console.aliyun.com', free: true,
      note: '新用户有免费额度，qwen-vl-max 识图效果很好' },
    { id: 'doubao', name: '豆包 Doubao（火山方舟）', base: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-1-5-pro-32k-250115', vision: 'doubao-1-5-vision-pro-32k-250115', keyUrl: 'https://console.volcengine.com/ark', free: true,
      note: '需要先在火山方舟控制台开通并创建推理接入点；模型名也可以直接填接入点 ID（ep-xxxx）' },

    // ---- 其它常见服务商 ----
    { id: 'openai', name: 'OpenAI', base: 'https://api.openai.com', model: 'gpt-4o-mini', vision: 'gpt-4o-mini', keyUrl: 'https://platform.openai.com' },
    { id: 'moonshot', name: '月之暗面 Kimi', base: 'https://api.moonshot.cn', model: 'moonshot-v1-8k', vision: 'moonshot-v1-8k-vision-preview', keyUrl: 'https://platform.moonshot.cn' },
    { id: 'openrouter', name: 'OpenRouter 聚合', base: 'https://openrouter.ai/api', model: 'openai/gpt-4o-mini', vision: 'openai/gpt-4o-mini', keyUrl: 'https://openrouter.ai' },

    // ---- 本地部署：完全不要 key，也不要钱 ----
    { id: 'ollama', name: 'Ollama 本地（免费，无需 key）', base: 'http://127.0.0.1:11434', model: 'qwen2.5:7b', vision: 'qwen2.5vl:7b', keyUrl: '', free: true,
      note: '先在电脑上装 Ollama 并 ollama pull qwen2.5vl:7b，手机和电脑要在同一网络，地址改成电脑的 IP' },
    { id: 'lmstudio', name: 'LM Studio 本地（免费，无需 key）', base: 'http://127.0.0.1:1234', model: 'local-model', vision: 'local-model', keyUrl: '', free: true },
    { id: 'oneapi', name: 'One-API / New-API 中转', base: 'http://127.0.0.1:3000', model: 'gpt-4o-mini', vision: 'gpt-4o-mini', keyUrl: '' },
    { id: 'custom', name: '自定义 (手动填写)', base: '', model: '', keyUrl: '' }
  ];

  var QUICK_PROMPTS = [
    { icon: '🔍', title: '找出不必要的花费', q: '请逐条找出这段记录里「不必要的花费」，说明判断理由和金额，并按可节省金额从高到低排序。' },
    { icon: '📊', title: '总结消费结构', q: '请总结我的消费结构：钱主要花在哪里？哪些分类占比过高？与合理比例相比有什么问题？' },
    { icon: '💡', title: '给出省钱方案', q: '请给我一套具体可执行的省钱方案，包括每月能省下多少钱、具体削减哪些项目、替代方案是什么。' },
    { icon: '🎯', title: '评估预算合理性', q: '结合我的实际支出，评估我的月度预算是否合理，并给出一个更合适的预算分配建议（按分类列出）。' },
    { icon: '📈', title: '分析消费趋势', q: '请分析我在这段时间内的消费趋势和波动，指出异常的日子或大额支出，并分析原因。' },
    { icon: '🐷', title: '制定存钱计划', q: '请根据我的收入与消费情况（如信息不足请说明需要补充什么），帮我制定一个可行的存钱计划。' }
  ];

  /** 把用户填写的地址补全为标准 chat/completions 端点 */
  function resolveEndpoint(base) {
    var b = String(base || '').trim().replace(/\s+/g, '');
    if (!b) return '';
    b = b.replace(/\/+$/, '');
    if (/\/chat\/completions$/i.test(b)) return b;
    if (/\/completions$/i.test(b) && !/chat/i.test(b)) return b;
    if (/\/v\d+$/i.test(b)) return b + '/chat/completions';
    return b + '/v1/chat/completions';
  }

  function systemPrompt() {
    return [
      '你是一位务实、说话干脆的个人理财分析师，擅长从记账流水里看出消费结构问题。',
      '请遵守以下规则：',
      '1. 只依据用户提供的记账数据分析，绝不编造未出现的数据或收入信息。',
      '2. 金额统一用人民币（元），保留两位小数；引用数据时给出具体条目与日期。',
      '3. **回答要简洁**：先给结论，再给理由。能用一句话说清就不要写一段，',
      '   能用三条说清就不要写十条。总长度尽量控制在一屏以内，不要复述同一件事。',
      '4. **不要使用 Markdown 加粗（**文字**）、斜体或 # 标题符号**，',
      '   直接用普通文字和短横线列表即可，中文标点用全角。',
      '5. 指出「不必要的花费」时，必须给出：具体条目、金额、判断理由、可执行的削减建议。',
      '6. 数据不足以判断时，明确说还缺什么，不要强行下结论。'
    ].join('\n');
  }

  function buildMessages(records, question, opts) {
    opts = opts || {};
    var report = global.Store.toReport(records, { includeNote: opts.includeNote !== false });
    var user = [
      '以下是我的记账数据：',
      '',
      report,
      '',
      '===== 我的问题 =====',
      question || '请帮我分析这份记账数据，指出不必要的花费并给出省钱建议。'
    ].join('\n');

    return [
      { role: 'system', content: systemPrompt() },
      { role: 'user', content: user }
    ];
  }

  function headersFor() {
    var s = global.Store.settings().llm;
    var h = { 'Content-Type': 'application/json' };
    if (s.key && String(s.key).trim()) {
      h['Authorization'] = 'Bearer ' + String(s.key).trim();
    }
    return h;
  }

  function payloadFor(messages, stream) {
    var s = global.Store.settings().llm;
    var p = {
      model: String(s.model || '').trim() || 'deepseek-chat',
      messages: messages,
      temperature: typeof s.temperature === 'number' ? s.temperature : 0.6,
      stream: !!stream
    };
    var mt = parseInt(s.maxTokens, 10);
    if (mt > 0) p.max_tokens = mt;
    return p;
  }

  function isConfigured() {
    var s = global.Store.settings().llm;
    return !!(String(s.base || '').trim() && String(s.model || '').trim());
  }

  /* ------------------------------------------------- 非流式 */

  function requestOnce(messages, cb) {
    var s = global.Store.settings().llm;
    var url = resolveEndpoint(s.base);
    if (!url) { cb('尚未配置 API 地址'); return null; }

    var body = JSON.stringify(payloadFor(messages, false));
    var headers = headersFor();

    if (HAS_NATIVE) {
      try {
        var res = JSON.parse(Android.httpRequest('POST', url, JSON.stringify(headers), body));
        if (res.error) { cb('网络错误：' + res.error); return null; }
        if (res.status >= 400) { cb(friendlyError(res.status, res.body)); return null; }
        cb(null, extractContent(res.body));
      } catch (e) {
        cb('解析响应失败：' + e.message);
      }
      return null;
    }

    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    fetch(url, { method: 'POST', headers: headers, body: body, signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { return r.text().then(function (t) { return { ok: r.ok, status: r.status, text: t }; }); })
      .then(function (r) {
        if (!r.ok) { cb(friendlyError(r.status, r.text)); return; }
        cb(null, extractContent(r.text));
      })
      .catch(function (e) { cb('请求失败：' + e.message); });

    return ctrl ? function () { ctrl.abort(); } : null;
  }

  function extractContent(text) {
    try {
      var o = JSON.parse(text);
      if (o.error) return '[接口错误] ' + (o.error.message || JSON.stringify(o.error));
      var c = o.choices && o.choices[0];
      if (!c) return text;
      if (c.message && c.message.content) return c.message.content;
      if (c.text) return c.text;
      return text;
    } catch (e) {
      return text;
    }
  }

  function brief(t) {
    t = String(t || '');
    return t.length > 300 ? t.slice(0, 300) + '…' : t;
  }

  /** 从接口返回体里挖出人类可读的报错文案 */
  function errorDetail(body) {
    var t = String(body || '').trim();
    if (!t) return '（服务端没有返回内容）';
    try {
      var o = JSON.parse(t);
      if (o.error && o.error.message) return String(o.error.message);
      if (o.error && typeof o.error === 'string') return o.error;
      if (o.message) return String(o.message);
      if (o.error) return JSON.stringify(o.error);
    } catch (e) { /* 不是 JSON，直接当文本 */ }
    return brief(t);
  }

  /**
   * 把 HTTP 状态码翻译成「能照着排查」的中文说明。
   * 401 会额外回显本机填写的 Key 末四位与长度，
   * 方便和服务端回显的末四位对照，立刻判断是拼错还是 Key 失效。
   */
  function friendlyError(status, body) {
    var detail = errorDetail(body);
    var s = global.Store ? global.Store.settings().llm : {};
    var key = String((s && s.key) || '').trim();
    var tail = key.length >= 4 ? key.slice(-4) : (key ? key : '（空）');

    if (status === 401) {
      return 'API Key 无效，服务端拒绝鉴权。\n\n' +
        '· 服务端提示：' + detail + '\n' +
        '· 应用发出的 Key：长度 ' + key.length + '，末四位「' + tail + '」\n\n' +
        '请对照上面服务端回显的末四位：\n' +
        '  — 如果两边不一致，说明 Key 复制错了或复制不全；\n' +
        '  — 如果两边一致，说明 Key 本身已失效/被删除，请到控制台重新生成。';
    }
    if (status === 402) {
      return '账户余额不足，无法调用。\n\n· 服务端提示：' + detail +
        '\n\n请到服务商控制台充值后再试。';
    }
    if (status === 403) {
      return '没有访问权限。\n\n· 服务端提示：' + detail +
        '\n\n可能是该 Key 未开通这个模型，或账号地区受限。';
    }
    if (status === 404) {
      return 'API 地址不存在。\n\n· 服务端提示：' + detail +
        '\n\n请检查设置里的「API 地址」。\n' +
        'DeepSeek 应填 https://api.deepseek.com\n' +
        '（程序会自动补全 /v1/chat/completions）';
    }
    if (status === 429) {
      return '请求过于频繁或额度已用尽。\n\n· 服务端提示：' + detail +
        '\n\n稍等片刻再试；本地模型则可能是并发数受限。';
    }
    if (status === 400) {
      return '请求格式有误。\n\n· 服务端提示：' + detail +
        '\n\n常见原因：模型名称填错、上下文超出长度上限。';
    }
    if (status >= 500) {
      return '服务端错误（' + status + '）。\n\n· 服务端提示：' + detail +
        '\n\n这是对方服务器的问题，稍后重试即可。';
    }
    return 'HTTP ' + status + '\n\n· 服务端提示：' + detail;
  }

  /** 把 Java 端回传的 "HTTP 401 {...}" 形式的错误串翻译成中文说明 */
  function friendlyTransportError(msg) {
    var m = /^HTTP (\d+)\s*([\s\S]*)$/.exec(String(msg || ''));
    if (m) return friendlyError(parseInt(m[1], 10), m[2]);
    return String(msg || '');
  }

  /* ------------------------------------------------- 流式 */

  /** 返回 {abort: fn}；回调 onDelta(text) / onDone(full) / onError(msg) */
  function requestStream(messages, handlers) {
    var s = global.Store.settings().llm;
    var url = resolveEndpoint(s.base);
    if (!url) { handlers.onError('尚未配置 API 地址'); return { abort: function () {} }; }

    var body = JSON.stringify(payloadFor(messages, true));
    var headers = headersFor();
    var full = '';
    var stopped = false;

    /* --- 原生流式：后台线程 + 轮询 --- */
    if (HAS_NATIVE && Android.streamStart) {
      var jobId;
      try {
        jobId = Android.streamStart(url, JSON.stringify(headers), body);
      } catch (e) {
        handlers.onError('无法启动请求：' + e.message);
        return { abort: function () {} };
      }

      var timer = setInterval(function () {
        if (stopped) return;
        var chunk;
        try { chunk = JSON.parse(Android.streamPoll(jobId)); }
        catch (e) { return; }
        if (chunk.text) {
          full += chunk.text;
          handlers.onDelta(chunk.text);
        }
        if (chunk.error) {
          clearInterval(timer);
          stopped = true;
          handlers.onError(friendlyTransportError(chunk.error));
          return;
        }
        if (chunk.done) {
          clearInterval(timer);
          stopped = true;
          handlers.onDone(full);
        }
      }, 120);

      return {
        abort: function () {
          if (stopped) return;
          stopped = true;
          clearInterval(timer);
          try { Android.streamAbort(jobId); } catch (e) { /* ignore */ }
          handlers.onDone(full);
        }
      };
    }

    /* --- 浏览器 fetch 流式 --- */
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    fetch(url, { method: 'POST', headers: headers, body: body, signal: ctrl ? ctrl.signal : undefined })
      .then(function (resp) {
        if (!resp.ok) {
          return resp.text().then(function (t) {
            handlers.onError(friendlyError(resp.status, t));
          });
        }
        if (!resp.body || !resp.body.getReader) {
          return resp.text().then(function (t) {
            var c = extractContent(t);
            full = c;
            handlers.onDelta(c);
          });
        }
        var reader = resp.body.getReader();
        var decoder = new TextDecoder('utf-8');
        var buffer = '';

        function pump() {
          return reader.read().then(function (r) {
            if (r.done) return;
            buffer += decoder.decode(r.value, { stream: true });
            var lines = buffer.split('\n');
            buffer = lines.pop();
            lines.forEach(function (line) {
              line = line.trim();
              if (!line || line.charAt(0) === ':') return;
              if (line.indexOf('data:') !== 0) return;
              var data = line.slice(5).trim();
              if (data === '[DONE]') return;
              var piece = deltaFromJson(data);
              if (piece) { full += piece; handlers.onDelta(piece); }
            });
            return pump();
          });
        }
        return pump();
      })
      .then(function () { handlers.onDone(full); })
      .catch(function (e) {
        if (e && e.name === 'AbortError') { handlers.onDone(full); return; }
        handlers.onError('请求失败：' + (e && e.message ? e.message : e));
      });

    return {
      abort: function () {
        if (ctrl) ctrl.abort();
        handlers.onDone(full);
      }
    };
  }

  function deltaFromJson(data) {
    try {
      var o = JSON.parse(data);
      if (o.choices && o.choices[0]) {
        var c = o.choices[0];
        if (c.delta && typeof c.delta.content === 'string') return c.delta.content;
        if (c.message && typeof c.message.content === 'string') return c.message.content;
        if (typeof c.text === 'string') return c.text;
      }
      if (o.delta && typeof o.delta.text === 'string') return o.delta.text;
      if (typeof o.response === 'string') return o.response;
      if (o.message && typeof o.message.content === 'string') return o.message.content;
    } catch (e) { /* ignore */ }
    return '';
  }

  /* ------------------------------------------------- 对外 API */

  function chat(messages, handlers, useStream) {
    var s = global.Store.settings().llm;
    var streaming = (useStream !== undefined) ? useStream : !!s.stream;
    if (streaming) return requestStream(messages, handlers);

    var ctrl = requestOnce(messages, function (err, text) {
      if (err) { handlers.onError(err); return; }
      handlers.onDelta(text);
      handlers.onDone(text);
    });
    return { abort: function () { if (ctrl) ctrl(); handlers.onDone(''); } };
  }

  function analyze(records, question, handlers, opts) {
    opts = opts || {};
    var messages = buildMessages(records, question, opts);
    return chat(messages, handlers, opts.stream);
  }

  function testConnection(cb) {
    var s = global.Store.settings().llm;
    if (!String(s.base || '').trim()) { cb('请先填写 API 地址'); return; }
    var messages = [
      { role: 'system', content: '你是一个测试助手。' },
      { role: 'user', content: '请只回复四个字：连接成功' }
    ];
    requestOnce(messages, function (err, text) {
      if (err) { cb(err); return; }
      cb(null, String(text || '').trim().slice(0, 60));
    });
  }

  global.AI = {
    PRESETS: PRESETS,
    QUICK_PROMPTS: QUICK_PROMPTS,
    resolveEndpoint: resolveEndpoint,
    buildMessages: buildMessages,
    isConfigured: isConfigured,
    analyze: analyze,
    chat: chat,
    testConnection: testConnection,
    extractContent: extractContent,
    friendlyError: friendlyError,
    friendlyTransportError: friendlyTransportError
  };
})(window);
