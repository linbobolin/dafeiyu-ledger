/* ============================================================
   自动归档识别引擎
   规则：对「花费内容 + 备注」做关键词加权打分，取最高分分类。
   权重：强特征 3 分 / 普通特征 2 分 / 弱特征 1 分；
        命中词越长额外加分，避免「饭」压过「火锅」这类误判。
   ============================================================ */
(function (global) {
  'use strict';

  var CATEGORIES = [
    {
      id: 'food', name: '餐饮食物', icon: '🍜', color: '#FF8A3D',
      strong: ['早餐', '午餐', '晚餐', '夜宵', '外卖', '食堂', '火锅', '烧烤', '快餐', '奶茶',
               '咖啡', '零食', '水果', '麻辣烫', '米线', '汉堡', '披萨', '寿司', '炸鸡', '面条',
               '包子', '豆浆', '吃饭', '买菜', '下馆子', '聚餐', '吃过', '吃顿', '喝了', '点了'],
      normal: ['饭', '菜', '饮料', '可乐', '蛋糕', '面包', '牛奶', '酸奶', '啤酒', '酒',
               '肯德基', '麦当劳', '星巴克', '瑞幸', '蜜雪', '海底捞', '沙县', '黄焖鸡', '必胜客',
               '烧烤店', '小笼包', '煎饼', '螺蛳粉', '自助餐', '食堂饭', 'food'],
      weak: ['美团', '饿了么', '生鲜', '超市食品']
    },
    {
      id: 'shopping', name: '购物消费', icon: '🛍️', color: '#FF5C8A',
      // 说明：电商平台名（淘宝/京东/天猫…）只代表「购买渠道」，不代表商品种类，
      // 因此只给弱权重，让「纸巾」「显示器」这类具体商品词能够胜出。
      strong: ['购物', '买东西', '网购', '下单', '买买买'],
      normal: ['衣服', '鞋', '裤', '外套', '裙', '包', '帽子', '围巾', '手套', '袜子',
               '化妆品', '护肤品', '面膜', '口红', '香水', '首饰', '手表', '眼镜'],
      weak: ['淘宝', '京东', '拼多多', '天猫', '唯品会', '苏宁', '抖音商城', '闲鱼', '得物',
             '代购', '商场', '专柜', '优惠券', '折扣', '会员购']
    },
    {
      id: 'transport', name: '交通出行', icon: '🚗', color: '#4F8CFF',
      strong: ['地铁', '公交', '打车', '滴滴', '出租车', '高铁', '动车', '火车', '机票',
               '飞机', '加油', '油费', '停车费', '过路费', 'ETC', '共享单车', '哈啰', '摩拜',
               '公交卡', '网约车', '顺风车'],
      normal: ['车票', '交通', '车费', '地铁卡', '通勤', '代驾', '洗车', '保养', '车险'],
      weak: ['车', '票', '出行', '机场', '地铁站']
    },
    {
      id: 'housing', name: '居住住房', icon: '🏠', color: '#8B7BFF',
      strong: ['房租', '水费', '电费', '燃气费', '天然气', '物业费', '宽带费', '房贷',
               '取暖费', '中介费', '押金', '租金', '垃圾费', '电梯费'],
      normal: ['物业', '宽带', '水电气', '装修', '家具', '家电维修', '保洁', '搬家'],
      weak: ['房', '住', '水电']
    },
    {
      id: 'entertainment', name: '娱乐休闲', icon: '🎮', color: '#FFC42E',
      strong: ['电影', '游戏', 'KTV', '唱歌', '酒吧', '旅游', '门票', '演唱会', '密室',
               '剧本杀', '网吧', '动漫', '展览', '话剧', '音乐会', '游乐园', '动物园',
               '充点券', '皮肤', 'steam', '游乐场'],
      normal: ['视频会员', '音乐会员', '会员', '追剧', '麻将', '台球', '桌游', '漂流', '温泉'],
      weak: ['玩', '娱乐', '休闲', '票务']
    },
    {
      id: 'daily', name: '生活用品', icon: '🧻', color: '#2ED3B7',
      strong: ['纸巾', '卫生纸', '洗发水', '沐浴露', '牙膏', '牙刷', '洗衣液', '洗洁精',
               '垃圾袋', '清洁剂', '毛巾', '拖鞋', '雨伞', '电池', '收纳', '日用品'],
      normal: ['洗衣粉', '肥皂', '护肤品日用', '厨房用品', '锅具', '炒锅', '碗', '杯子', '五金', '灯泡'],
      weak: ['超市', '日用', '家居', '生活用品']
    },
    {
      id: 'medical', name: '医疗健康', icon: '💊', color: '#FF6B6B',
      strong: ['医院', '药店', '看病', '挂号', '体检', '牙医', '拔牙', '住院', '手术',
               '疫苗', '中医', '推拿', '理疗', '保健品', '买药'],
      normal: ['药', '感冒', '发烧', '维生素', '钙片', '眼药水', '创可贴', '血常规'],
      weak: ['健康', '医疗', '康复']
    },
    {
      id: 'telecom', name: '通讯网络', icon: '📱', color: '#5AC8FA',
      strong: ['话费', '流量', '手机费', '充话费', '宽带续费', '电话费', '移动套餐', '联通套餐',
               '电信套餐', '充值话费'],
      normal: ['套餐', '漫游', '短信费', '副卡', '宽带'],
      weak: ['话费充值', '网络费']
    },
    {
      id: 'study', name: '学习成长', icon: '📚', color: '#A78BFA',
      strong: ['书', '买书', '课程', '培训', '学费', '网课', '考试', '报名费', '教材',
               '辅导', '补习', '文具', '笔记本', '考证', '驾校', '英语'],
      normal: ['订阅', '专栏', '知识付费', '论文', '打印', '复印', '字典'],
      weak: ['学习', '教育', '资料']
    },
    {
      id: 'social', name: '人情往来', icon: '🎁', color: '#F472B6',
      strong: ['红包', '礼物', '份子钱', '随礼', '请客', '发红包', '压岁钱', '孝敬',
               '人情', '过年礼', '婚礼', '生日礼'],
      normal: ['转账', '送礼', '聚餐请客', '慰问', '白事', '喜酒'],
      weak: ['礼', '人情往来']
    },
    {
      id: 'pet', name: '宠物', icon: '🐾', color: '#34D399',
      strong: ['猫粮', '狗粮', '宠物', '猫砂', '疫苗针', '驱虫', '宠物医院', '猫', '狗',
               '罐头粮', '猫爬架', '牵引绳'],
      normal: ['宠物用品', '洗澡美容', '寄养', '猫抓板'],
      weak: ['铲屎', '毛孩子']
    },
    {
      id: 'digital', name: '数码电器', icon: '💻', color: '#60A5FA',
      strong: ['手机', '电脑', '笔记本电', '平板', '耳机', '显卡', '显示器', '键盘', '鼠标',
               '相机', '镜头', '充电宝', '路由器', '硬盘', 'U盘', '游戏机', 'switch',
               'ps5', 'xbox', '音响', '打印机'],
      normal: ['充电器', '数据线', '电源', '内存', '散热器', '摄像头', '投影仪'],
      weak: ['数码', '电器', '电子']
    },
    {
      id: 'apparel', name: '服饰美容', icon: '💄', color: '#FB923C',
      strong: ['理发', '剪发', '烫发', '染发', '美甲', '美容', '按摩', 'spa', '洗脸',
               '纹眉', '美睫', '医美', '妆'],
      normal: ['洗面奶', '防晒', '精华', '眼影', '指甲油', '精油'],
      weak: ['美发', '护理']
    },
    {
      id: 'travel', name: '旅行', icon: '✈️', color: '#38BDF8',
      strong: ['酒店', '民宿', '住宿', '旅行社', '跟团', '签证', '护照', '景点', '迪士尼',
               '环球影城', '度假', '露营'],
      normal: ['住宿费', '导游', '行李', '旅游保险', '接送机'],
      weak: ['出差', '旅行']
    },
    {
      id: 'other', name: '其他', icon: '📦', color: '#94A3B8',
      strong: [],
      normal: [],
      weak: []
    }
  ];

  /* ------------------------------------------------------ 收入分类 */

  var INCOME_CATEGORIES = [
    { id: 'salary', name: '工资', icon: '💼', color: '#22C55E', kind: 'income',
      strong: ['工资', '薪资', '发薪', '月薪', '薪水', '工钱'], normal: ['底薪', '基本工资'], weak: [] },
    { id: 'bonus', name: '奖金', icon: '🏆', color: '#F59E0B', kind: 'income',
      strong: ['奖金', '年终奖', '绩效', '提成', '分红'], normal: ['奖励', '激励'], weak: [] },
    { id: 'redpack', name: '红包', icon: '🧧', color: '#EF4444', kind: 'income',
      strong: ['红包', '压岁钱', '拜年'], normal: ['收红包'], weak: [] },
    { id: 'invest', name: '理财收益', icon: '📈', color: '#3B82F6', kind: 'income',
      strong: ['理财', '基金', '股票', '利息', '余额宝', '收益到账'], normal: ['定投', '国债', '分红到账'], weak: [] },
    { id: 'reimburse', name: '报销', icon: '🧾', color: '#8B5CF6', kind: 'income',
      strong: ['报销', '报销款', '差旅补贴'], normal: ['发票', '补贴'], weak: [] },
    { id: 'parttime', name: '兼职', icon: '💪', color: '#14B8A6', kind: 'income',
      strong: ['兼职', '外快', '稿费', '私活', '接单'], normal: ['副业'], weak: [] },
    { id: 'refund', name: '退款', icon: '↩️', color: '#06B6D4', kind: 'income',
      strong: ['退款', '退货', '返现', '退回'], normal: ['补偿', '赔付'], weak: [] },
    { id: 'giftmoney', name: '礼金', icon: '🎁', color: '#EC4899', kind: 'income',
      strong: ['礼金', '份子', '随礼', '礼钱'], normal: ['贺礼'], weak: [] },
    { id: 'other_income', name: '其他收入', icon: '💰', color: '#94A3B8', kind: 'income',
      strong: [], normal: [], weak: [] }
  ];

  CATEGORIES.forEach(function (c) { c.kind = 'expense'; });

  var ALL_CATEGORIES = CATEGORIES.concat(INCOME_CATEGORIES);

  var BY_ID = {};
  ALL_CATEGORIES.forEach(function (c) { BY_ID[c.id] = c; });

  var OTHER = BY_ID.other;
  var OTHER_INCOME = BY_ID.other_income;

  function normalize(text) {
    return String(text == null ? '' : text)
      .toLowerCase()
      .replace(/[\s\u3000]+/g, '')
      .replace(/[，。！？、；：""''（）【】,.!?;:"'()\[\]]/g, '');
  }

  /* ------------------------------------------------------ 相似度 */

  function bigrams(s) {
    var out = [];
    for (var i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
    if (!out.length && s.length) out.push(s);
    return out;
  }

  /**
   * 0~1 的相似度：
   *   完全相同 → 1；互为子串 → 0.9；否则用二元组 Dice 系数。
   * 这样「公司楼下快餐」和「公司楼下快餐店」能判为同一类。
   */
  function similarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.length >= 2 && b.length >= 2 && (a.indexOf(b) >= 0 || b.indexOf(a) >= 0)) return 0.9;
    var A = bigrams(a), B = bigrams(b);
    if (!A.length || !B.length) return 0;
    var pool = {};
    B.forEach(function (x) { pool[x] = (pool[x] || 0) + 1; });
    var inter = 0;
    A.forEach(function (x) { if (pool[x] > 0) { inter++; pool[x]--; } });
    return (2 * inter) / (A.length + B.length);
  }

  var SIMILAR_THRESHOLD = 0.62;

  /** 在用户手动归类过的规则里找匹配（优先完全一致，其次相似） */
  function matchRule(primary, rules, kind) {
    if (!primary || !rules || !rules.length) return null;
    var best = null;
    var bestScore = 0;
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (!r || !r.key) continue;
      if ((r.kind || 'expense') !== kind) continue;
      var sim = similarity(primary, r.key);
      if (sim < SIMILAR_THRESHOLD) continue;
      // 命中次数多的规则稍微优先
      var score = sim + Math.min(r.hits || 1, 10) * 0.003;
      if (score > bestScore) { bestScore = score; best = r; }
    }
    return best;
  }

  /* ------------------------------------------------------ 主识别 */

  /**
   * 识别分类。
   * @param {string} content 花费 / 收入内容
   * @param {string} note    备注（可选，权重略低）
   * @param {Object} ctx     { kind:'expense'|'income', custom:[], rules:[] }
   * @returns {{category:Object, confidence:number, matched:string[], source:string}}
   */
  function classify(content, note, ctx) {
    ctx = ctx || {};
    var kind = ctx.kind === 'income' ? 'income' : 'expense';
    var custom = ctx.custom || [];
    var rules = ctx.rules || [];
    var fallback = kind === 'income' ? OTHER_INCOME : OTHER;

    var primary = normalize(content);
    var secondary = normalize(note);

    if (!primary && !secondary) {
      return { category: fallback, confidence: 0, matched: [], source: 'none' };
    }

    // 1) 用户之前手动归类过的（相同或相似内容优先命中）
    var learned = matchRule(primary, rules, kind);
    if (learned) {
      // 学到的可能是自定义分类，要先在自定义分类里找
      var lc = null;
      for (var ci = 0; ci < custom.length; ci++) {
        if (custom[ci].id === learned.category) {
          lc = {
            id: custom[ci].id, name: custom[ci].name, icon: custom[ci].icon,
            color: custom[ci].color, kind: custom[ci].kind, custom: true
          };
          break;
        }
      }
      if (!lc) lc = BY_ID[learned.category] || null;
      if (lc) {
        return {
          category: lc, confidence: 1,
          matched: ['曾归类为「' + lc.name + '」'], source: 'learned'
        };
      }
    }

    // 2) 自定义分类的关键词
    var bestCustom = null;
    var bestCustomScore = 0;
    var bestCustomWord = '';
    custom.forEach(function (c) {
      if ((c.kind || 'expense') !== kind) return;
      var words = (c.keywords || []).slice();
      if (c.name) words.push(c.name);
      words.forEach(function (kw) {
        var w = normalize(kw);
        if (!w) return;
        var s = 0;
        if (primary.indexOf(w) >= 0) {
          s = 4 + Math.min(w.length, 4) * 0.4;
        } else if (secondary.indexOf(w) >= 0) {
          s = 2.6;
        }
        if (s > bestCustomScore) {
          bestCustomScore = s;
          bestCustom = c;
          bestCustomWord = kw;
        }
      });
    });
    if (bestCustom) {
      return {
        category: {
          id: bestCustom.id, name: bestCustom.name,
          icon: bestCustom.icon, color: bestCustom.color, custom: true
        },
        confidence: Math.min(1, bestCustomScore / 5),
        matched: [bestCustomWord],
        source: 'custom'
      };
    }

    // 3) 内置关键词加权打分
    var pool = kind === 'income' ? INCOME_CATEGORIES : CATEGORIES;
    var best = null;
    var bestScore = 0;
    var bestMatched = [];

    pool.forEach(function (cat) {
      if (cat.id === 'other' || cat.id === 'other_income') return;
      var score = 0;
      var matched = [];

      function scan(words, weight, noteFactor) {
        for (var i = 0; i < words.length; i++) {
          var w = normalize(words[i]);
          if (!w) continue;
          if (primary && primary.indexOf(w) >= 0) {
            // 内容命中：全额权重 + 长词加成（越具体的关键词越有分量）
            score += weight + Math.min(w.length, 4) * 0.35;
            matched.push(words[i]);
          } else if (noteFactor > 0 && secondary && secondary.indexOf(w) >= 0) {
            // 备注命中：打折权重，且不计入长词加成
            score += weight * noteFactor;
            matched.push(words[i] + '(备注)');
          }
        }
      }

      scan(cat.strong, 3, 0.8);
      scan(cat.normal, 2, 0.6);
      scan(cat.weak, 1, 0.5);

      if (score > bestScore) {
        bestScore = score;
        best = cat;
        bestMatched = matched;
      }
    });

    if (!best || bestScore <= 0) {
      return { category: fallback, confidence: 0, matched: [], source: 'none' };
    }

    var confidence = Math.max(0, Math.min(1, bestScore / 5));
    return { category: best, confidence: confidence, matched: bestMatched, source: 'keyword' };
  }

  function byId(id) { return BY_ID[id] || OTHER; }

  /** 取某一类的全部分类（支出 / 收入） */
  function list(kind) {
    return kind === 'income' ? INCOME_CATEGORIES : CATEGORIES;
  }

  global.Classify = {
    CATEGORIES: CATEGORIES,
    INCOME_CATEGORIES: INCOME_CATEGORIES,
    list: list,
    byId: byId,
    classify: classify,
    normalize: normalize,
    similarity: similarity,
    OTHER: OTHER,
    OTHER_INCOME: OTHER_INCOME
  };
})(window);
