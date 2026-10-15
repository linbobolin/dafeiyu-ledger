package com.ledgerbook.app;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 从微信 / 支付宝的通知文本里解析出一笔收付款。
 *
 * ⚠️ 原理说明（很重要）：
 * 微信和支付宝都**没有**提供读取账单的公开接口，任何声称「绑定账号」的方案
 * 本质上都做不到。这里走的是 Android 官方的「通知使用权」
 * （NotificationListenerService），只能读到系统通知栏里出现的文字，因此：
 *   - 通知被折叠、被静音、被用户手动划掉时，可能抓不到
 *   - 解析结果属于「尽力而为」，导入前一律列出让用户确认
 *
 * 解析策略：同时命中「金额」和「收支关键词」才认为是一笔交易，
 * 以此过滤掉活动推广、版本更新之类的通知。
 */
public class PayParser {

    public static final String PKG_WECHAT = "com.tencent.mm";
    public static final String PKG_ALIPAY = "com.eg.android.AlipayGphone";

    /** 金额：¥12.34 / ￥1,234.56 */
    private static final Pattern AMT_YUAN =
            Pattern.compile("[¥￥]\\s*(\\d+(?:,\\d{3})*(?:\\.\\d{1,2})?)");
    /** 金额：12.34元 */
    private static final Pattern AMT_SUFFIX =
            Pattern.compile("(\\d+(?:,\\d{3})*(?:\\.\\d{1,2})?)\\s*元");

    /** 收款侧关键词 */
    private static final String[] RECV_KW = {
            "收款", "到账", "收到", "收入", "退款", "转入", "入账", "已收款"
    };
    /** 付款侧关键词 */
    private static final String[] PAY_KW = {
            "付款", "支付", "支出", "消费", "扣款", "转出", "已付"
    };

    public static boolean isSupported(String pkg) {
        return PKG_WECHAT.equals(pkg) || PKG_ALIPAY.equals(pkg);
    }

    public static String sourceName(String pkg) {
        if (PKG_WECHAT.equals(pkg)) return "微信";
        if (PKG_ALIPAY.equals(pkg)) return "支付宝";
        return "其它";
    }

    public static class Result {
        public double amount;
        public String type;     // expense / income
        public String source;   // 微信 / 支付宝
        public String content;
        public String raw;

        /** 用于去重的特征串 */
        public String signature() {
            return source + "|" + type + "|" + amount + "|" + content;
        }
    }

    /**
     * @param pkg   通知来源包名
     * @param title 通知标题
     * @param body  通知正文（已把 text / bigText / subText / textLines 拼在一起）
     * @return 解析成功返回 Result，否则返回 null
     */
    public static Result parse(String pkg, String title, String body) {
        if (!isSupported(pkg)) return null;

        String all = ((title == null ? "" : title) + " "
                + (body == null ? "" : body)).trim();
        if (all.isEmpty()) return null;

        Double amount = extractAmount(all);
        if (amount == null || amount <= 0 || amount > 100000000) return null;

        String type = detectType(all);
        if (type == null) return null;

        Result r = new Result();
        r.amount = Math.round(amount * 100) / 100.0;
        r.type = type;
        r.source = sourceName(pkg);
        r.content = extractContent(all, r.source, type);
        r.raw = all;
        return r;
    }

    /** 取金额：先找带货币符号的，再找「xx元」 */
    private static Double extractAmount(String s) {
        Matcher m = AMT_YUAN.matcher(s);
        if (m.find()) return parseNum(m.group(1));
        m = AMT_SUFFIX.matcher(s);
        if (m.find()) return parseNum(m.group(1));
        return null;
    }

    private static Double parseNum(String raw) {
        try {
            return Double.parseDouble(raw.replace(",", ""));
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * 判断收 / 支。
     * 同时出现「收款」和「支付」时容易误判，例如：
     *   「微信支付收款到账 12.34 元」→ 其实是收款
     *   「付款成功，收款方：某某便利店」→ 其实是付款
     * 所以冲突时优先看这两个更明确的信号。
     */
    private static String detectType(String s) {
        boolean recv = containsAny(s, RECV_KW);
        boolean pay = containsAny(s, PAY_KW);

        if (recv && !pay) return "income";
        if (pay && !recv) return "expense";

        if (recv && pay) {
            if (s.contains("收款方") || s.contains("付款成功") || s.contains("支付成功")) {
                return "expense";
            }
            if (s.contains("收款到账") || s.contains("已到账") || s.contains("到账")) {
                return "income";
            }
            return "income";
        }
        return null;
    }

    private static boolean containsAny(String s, String[] words) {
        for (String w : words) {
            if (s.contains(w)) return true;
        }
        return false;
    }

    /** 把通知文本里剩下的有效部分当作「对方 / 事由」 */
    private static String extractContent(String s, String source, String type) {
        String t = s;
        t = AMT_YUAN.matcher(t).replaceAll(" ");
        t = AMT_SUFFIX.matcher(t).replaceAll(" ");
        t = t.replaceAll("微信支付|微信收款|微信|支付宝|支付助手|服务通知|通知|凭证|提醒|详情|点击", " ");
        t = t.replaceAll("收款到账|已到账|到账|付款成功|支付成功|已支付|付款|支付|收款|支出|消费|扣款|退款|转入|转出|收入|成功", " ");
        t = t.replaceAll("[\\s\\u3000]+", " ").trim();
        t = t.replaceAll("^[，。、:：\\-—|/]+", "").replaceAll("[，。、:：\\-—|/]+$", "").trim();
        t = t.replaceAll("^[向于在给]\\s*", "").trim();
        if (t.length() > 40) t = t.substring(0, 40);
        if (t.isEmpty()) {
            t = source + ("income".equals(type) ? "收款" : "付款");
        }
        return t;
    }
}
