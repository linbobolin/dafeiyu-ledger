import com.ledgerbook.app.PayParser;

import java.util.ArrayList;
import java.util.List;

/**
 * 直接验证 PayParser 的解析规则。
 *
 * PayParser 只依赖 java.util.regex，不引用任何 Android 类，
 * 所以可以用普通 javac 编译并直接跑，不需要模拟器。
 *
 * 用法：
 *   javac -encoding UTF-8 -d <outDir> android/java/com/ledgerbook/app/PayParser.java test/PayParserTest.java
 *   java -cp <outDir> PayParserTest
 */
public class PayParserTest {

    private static int pass = 0;
    private static int fail = 0;

    private static void ok(String name, Object got, Object want) {
        boolean same = String.valueOf(got).equals(String.valueOf(want));
        if (same) {
            pass++;
            System.out.println("  \u2713 " + name);
        } else {
            fail++;
            System.out.println("  \u2717 " + name + "   got=" + got + "  want=" + want);
        }
    }

    private static void yes(String name, boolean cond, String extra) {
        if (cond) {
            pass++;
            System.out.println("  \u2713 " + name);
        } else {
            fail++;
            System.out.println("  \u2717 " + name + (extra == null ? "" : "   " + extra));
        }
    }

    private static void sec(String t) {
        System.out.println("\n\u2500\u2500 " + t + " \u2500\u2500");
    }

    private static final String WX = PayParser.PKG_WECHAT;
    private static final String ALI = PayParser.PKG_ALIPAY;

    public static void main(String[] args) {
        PayParser.Result r;

        /* ---------------------------------------------- 微信 */
        sec("微信通知解析");

        r = PayParser.parse(WX, "微信支付", "向 星巴克 付款 32.00 元");
        yes("普通付款能识别", r != null, null);
        if (r != null) {
            ok("  金额", r.amount, 32.0);
            ok("  类型", r.type, "expense");
            ok("  来源", r.source, "微信");
            yes("  内容含商户名", r.content.contains("星巴克"), "content=" + r.content);
            yes("  内容不含金额单位", !r.content.contains("元"), "content=" + r.content);
        }

        r = PayParser.parse(WX, "微信支付凭证", "已支付 ¥128.50");
        yes("¥ 金额能识别", r != null, null);
        if (r != null) {
            ok("  金额", r.amount, 128.5);
            ok("  类型", r.type, "expense");
        }

        r = PayParser.parse(WX, "微信支付收款", "收款到账 88.88 元");
        yes("收款通知识别为进账（同时含「支付」「收款」也不误判）", r != null, null);
        if (r != null) {
            ok("  金额", r.amount, 88.88);
            ok("  类型", r.type, "income");
        }

        r = PayParser.parse(WX, "微信支付", "已支付 ¥1,234.56");
        yes("带千分位的金额能识别", r != null, null);
        if (r != null) ok("  金额", r.amount, 1234.56);

        r = PayParser.parse(WX, "微信支付", "已支付¥19.32");
        yes("实测通知「微信支付 / 已支付¥19.32」能识别", r != null, null);
        if (r != null) {
            ok("  金额", r.amount, 19.32);
            ok("  类型", r.type, "expense");
            ok("  来源", r.source, "微信");
        }

        r = PayParser.parse(WX, "微信支付", "已支付 ¥19.32");
        yes("金额与符号间有空格也能识别", r != null, null);
        if (r != null) ok("  金额", r.amount, 19.32);

        r = PayParser.parse(WX, "微信支付", "微信支付凭证");
        yes("只有标题、没有金额 → null", r == null,
            r == null ? "null" : ("amount=" + r.amount));

        /* ---------------------------------------------- 支付宝 */
        sec("支付宝通知解析");

        r = PayParser.parse(ALI, "支付宝", "付款成功 25.00 元 收款方：某某便利店");
        yes("「付款成功 … 收款方：」判为支出而非收入", r != null, null);
        if (r != null) {
            ok("  类型", r.type, "expense");
            ok("  金额", r.amount, 25.0);
            ok("  来源", r.source, "支付宝");
        }

        r = PayParser.parse(ALI, "支付宝", "收款到账 200.00 元");
        yes("收款到账判为进账", r != null, null);
        if (r != null) {
            ok("  类型", r.type, "income");
            ok("  金额", r.amount, 200.0);
        }

        r = PayParser.parse(ALI, "支付宝", "退款到账 66.00 元");
        yes("退款判为进账", r != null, null);
        if (r != null) ok("  类型", r.type, "income");

        r = PayParser.parse(ALI, "支付宝", "你有一笔消费 15 元");
        yes("「消费 xx 元」能识别", r != null, null);
        if (r != null) {
            ok("  金额", r.amount, 15.0);
            ok("  类型", r.type, "expense");
        }

        /* ---------------------------------------------- 应当被过滤 */
        sec("不该被当成交易的");

        ok("聊天消息 → null", PayParser.parse(WX, "微信", "您有一条新消息"), null);
        ok("版本更新 → null", PayParser.parse(WX, "微信支付", "版本更新啦，快来体验"), null);
        ok("无金额的支付提示 → null", PayParser.parse(WX, "微信支付", "请完成付款"), null);
        ok("只有金额没有收支词 → null",
                PayParser.parse(WX, "微信支付", "您今天走了 8000 步"), null);
        ok("非微信/支付宝的包 → null",
                PayParser.parse("com.example.app", "支付", "付款 10.00 元"), null);
        ok("空文本 → null", PayParser.parse(WX, "", ""), null);

        /* ---------------------------------------------- 来源识别 */
        sec("来源与判断辅助");

        yes("微信包名受支持", PayParser.isSupported(WX), null);
        yes("支付宝包名受支持", PayParser.isSupported(ALI), null);
        yes("其它包名不受支持", !PayParser.isSupported("com.tencent.mobileqq"), null);
        ok("来源名称", PayParser.sourceName(ALI), "支付宝");

        /* ---------------------------------------------- 去重特征 */
        sec("去重特征");

        PayParser.Result a = PayParser.parse(WX, "微信支付", "向 星巴克 付款 32.00 元");
        PayParser.Result b = PayParser.parse(WX, "微信支付", "向 星巴克 付款 32.00 元");
        PayParser.Result c = PayParser.parse(WX, "微信支付", "向 星巴克 付款 33.00 元");
        yes("同一笔的 signature 相同", a != null && b != null && a.signature().equals(b.signature()),
                a == null || b == null ? "解析失败" : a.signature() + " vs " + b.signature());
        yes("不同金额的 signature 不同", a != null && c != null && !a.signature().equals(c.signature()), null);

        /* ---------------------------------------------- 结果 */
        System.out.println();
        System.out.println(fail == 0
                ? "\u5168\u90e8 " + pass + " \u9879\u901a\u8fc7"
                : fail + " \u9879\u5931\u8d25\uff0c" + pass + " \u9879\u901a\u8fc7");
        System.out.println("Java \u89e3\u6790\u5668\u6d4b\u8bd5: pass=" + pass + " fail=" + fail);
        System.exit(fail == 0 ? 0 : 1);
    }
}
