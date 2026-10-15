package com.ledgerbook.app;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.List;

/**
 * 自动记账的「待确认收件箱」。
 *
 * 通知监听服务识别到的收付款先落盘到这里，网页层打开时读取，
 * 由用户勾选确认后才写入账本。这样即使 App 没在前台，
 * 通知也不会丢。
 */
public class PayStore {

    private static final String FILE = "pay-inbox.json";
    private static final int MAX_KEEP = 300;
    private static final long DEDUP_WINDOW_MS = 120000L;

    private static File fileOf(Context c) {
        File dir = new File(c.getFilesDir(), "ledger");
        if (!dir.exists()) {
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
        }
        return new File(dir, FILE);
    }

    private static byte[] readAll(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toByteArray();
    }

    public static synchronized JSONArray read(Context c) {
        try {
            File f = fileOf(c);
            if (!f.exists()) return new JSONArray();
            FileInputStream in = new FileInputStream(f);
            String text = new String(readAll(in), "UTF-8");
            in.close();
            JSONArray arr = new JSONArray(text);
            return arr;
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    private static synchronized void write(Context c, JSONArray arr) {
        try {
            FileOutputStream out = new FileOutputStream(fileOf(c));
            out.write(arr.toString().getBytes("UTF-8"));
            out.flush();
            out.close();
        } catch (Exception ignored) {
        }
    }

    /**
     * 追加一条识别结果。同一笔交易在短时间内被重复通知时只保留一条。
     */
    public static synchronized void append(Context c, PayParser.Result r, long postTime) {
        if (r == null) return;
        try {
            JSONArray arr = read(c);
            long now = System.currentTimeMillis();

            // 去重：最近 40 条内，金额 + 类型 + 内容都相同且在时间窗内，视为重复
            for (int i = arr.length() - 1; i >= 0 && i >= arr.length() - 40; i--) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                if (Math.abs(now - o.optLong("ts", 0)) > DEDUP_WINDOW_MS) continue;
                if (Math.abs(o.optDouble("amount", -1) - r.amount) < 0.005
                        && r.type.equals(o.optString("type"))
                        && r.content.equals(o.optString("content"))) {
                    return;
                }
            }

            JSONObject o = new JSONObject();
            o.put("id", "p" + now + "_" + Integer.toHexString(r.signature().hashCode()));
            o.put("ts", now);
            o.put("postTime", postTime);
            o.put("source", r.source);
            o.put("type", r.type);
            o.put("amount", r.amount);
            o.put("content", r.content);
            o.put("raw", r.raw);
            arr.put(o);

            while (arr.length() > MAX_KEEP) {
                arr.remove(0);
            }
            write(c, arr);
        } catch (Exception ignored) {
        }
    }

    /** 删除指定 id 的记录（导入成功后调用） */
    public static synchronized void remove(Context c, List<String> ids) {
        if (ids == null || ids.isEmpty()) return;
        try {
            JSONArray arr = read(c);
            JSONArray out = new JSONArray();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                if (!ids.contains(o.optString("id"))) out.put(o);
            }
            write(c, out);
        } catch (Exception ignored) {
        }
    }

    public static synchronized void clear(Context c) {
        write(c, new JSONArray());
    }

    /** 手动塞一条，用于在没有真实通知时验证整条链路 */
    public static void inject(Context c, String source, String type, double amount, String content) {
        try {
            PayParser.Result r = new PayParser.Result();
            r.amount = Math.round(Math.abs(amount) * 100) / 100.0;
            r.type = "income".equals(type) ? "income" : "expense";
            r.source = source == null || source.isEmpty() ? "测试" : source;
            r.content = content == null || content.isEmpty() ? "手动测试记录" : content;
            r.raw = "[手动测试] " + r.source + " " + r.content + " " + r.amount;
            append(c, r, System.currentTimeMillis());
        } catch (Exception ignored) {
        }
    }

    // ------------------------------------------------------ 运行状态（自检用）

    private static final String STATUS_FILE = "pay-status.json";

    private static File statusFile(Context c) {
        File dir = new File(c.getFilesDir(), "ledger");
        if (!dir.exists()) {
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
        }
        return new File(dir, STATUS_FILE);
    }

    public static synchronized JSONObject readStatus(Context c) {
        try {
            File f = statusFile(c);
            if (!f.exists()) return new JSONObject();
            FileInputStream in = new FileInputStream(f);
            String text = new String(readAll(in), "UTF-8");
            in.close();
            return new JSONObject(text);
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private static synchronized void writeStatus(Context c, JSONObject o) {
        try {
            FileOutputStream out = new FileOutputStream(statusFile(c));
            out.write(o.toString().getBytes("UTF-8"));
            out.flush();
            out.close();
        } catch (Exception ignored) {
        }
    }

    /** 记录一个状态字段，供应用内的自检面板读取 */
    public static synchronized void mark(Context c, String key, Object value) {
        try {
            JSONObject o = readStatus(c);
            o.put(key, value);
            o.put("updatedAt", System.currentTimeMillis());
            writeStatus(c, o);
        } catch (Exception ignored) {
        }
    }

    public static synchronized void markSeen(Context c, String pkg, String title,
                                            String body, boolean parsed) {
        try {
            JSONObject o = readStatus(c);
            o.put("lastPkg", pkg);
            o.put("lastTitle", cut(title, 120));
            o.put("lastBody", cut(body, 300));
            o.put("lastAt", System.currentTimeMillis());
            o.put("lastParsed", parsed);
            o.put("seen", o.optInt("seen", 0) + 1);
            writeStatus(c, o);
        } catch (Exception ignored) {
        }
    }

    private static String cut(String s, int max) {
        if (s == null) return "";
        String t = s.trim();
        return t.length() <= max ? t : t.substring(0, max) + "…";
    }
}
