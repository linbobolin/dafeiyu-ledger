package com.ledgerbook.app;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 暴露给网页层的原生能力。
 *
 * 设计要点：
 *  - 网络请求走原生 HTTP，绕开浏览器同源策略(CORS)，因此可以直连任意大模型 API。
 *  - 数据落在 app 私有目录 filesDir/ledger 下，比 WebView localStorage 更可靠、容量更大。
 *  - 流式输出采用「后台线程 + 轮询」模型：JS 侧定时调用 streamPoll 取回增量文本。
 */
public class JsBridge {

    private static final String TAG = "LedgerBridge";

    private final Context ctx;
    private final File baseDir;
    private final Handler main = new Handler(Looper.getMainLooper());

    private static final Map<String, StreamJob> JOBS = new ConcurrentHashMap<String, StreamJob>();
    private static int seq = 0;

    public JsBridge(Context context) {
        this.ctx = context.getApplicationContext();
        this.baseDir = new File(ctx.getFilesDir(), "ledger");
        if (!baseDir.exists()) {
            //noinspection ResultOfMethodCallIgnored
            baseDir.mkdirs();
        }
    }

    // ---------------------------------------------------------------- 工具

    private File resolve(String rel) throws IOException {
        String clean = rel == null ? "" : rel.replace('\\', '/');
        while (clean.startsWith("/")) {
            clean = clean.substring(1);
        }
        File f = new File(baseDir, clean);
        String base = baseDir.getCanonicalPath();
        String path = f.getCanonicalPath();
        if (!path.equals(base) && !path.startsWith(base + File.separator)) {
            throw new IOException("illegal path: " + rel);
        }
        return f;
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) {
            out.write(buf, 0, n);
        }
        return out.toByteArray();
    }

    private static String clip(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, max) + "…";
    }

    // ------------------------------------------------------- 文件持久化

    @JavascriptInterface
    public boolean fsReady() {
        return baseDir.exists() && baseDir.isDirectory();
    }

    @JavascriptInterface
    public String fsRead(String rel) {
        try {
            File f = resolve(rel);
            if (!f.exists() || !f.isFile()) return null;
            FileInputStream in = new FileInputStream(f);
            String text = new String(readAll(in), "UTF-8");
            in.close();
            return text;
        } catch (Exception e) {
            return null;
        }
    }

    @JavascriptInterface
    public boolean fsWrite(String rel, String content) {
        try {
            File f = resolve(rel);
            File parent = f.getParentFile();
            if (parent != null && !parent.exists()) {
                //noinspection ResultOfMethodCallIgnored
                parent.mkdirs();
            }
            FileOutputStream out = new FileOutputStream(f);
            out.write(content.getBytes("UTF-8"));
            out.flush();
            out.close();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @JavascriptInterface
    public boolean fsExists(String rel) {
        try {
            return resolve(rel).exists();
        } catch (Exception e) {
            return false;
        }
    }

    @JavascriptInterface
    public boolean fsDelete(String rel) {
        try {
            return deleteRecursive(resolve(rel));
        } catch (Exception e) {
            return false;
        }
    }

    private static boolean deleteRecursive(File f) {
        if (f.isDirectory()) {
            File[] kids = f.listFiles();
            if (kids != null) {
                for (File k : kids) {
                    deleteRecursive(k);
                }
            }
        }
        return !f.exists() || f.delete();
    }

    @JavascriptInterface
    public String fsList(String rel) {
        try {
            File dir = resolve(rel);
            File[] kids = dir.listFiles();
            List<String> names = new ArrayList<String>();
            if (kids != null) {
                for (File k : kids) {
                    names.add(k.getName());
                }
            }
            Collections.sort(names);
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < names.size(); i++) {
                if (i > 0) sb.append(',');
                sb.append(JSONObject.quote(names.get(i)));
            }
            return sb.append(']').toString();
        } catch (Exception e) {
            return "[]";
        }
    }

    // ----------------------------------------------------------- 图片

    @JavascriptInterface
    public boolean saveImage(String name, String dataUrl) {
        try {
            String b64 = dataUrl == null ? "" : dataUrl;
            int comma = b64.indexOf(',');
            if (b64.startsWith("data:") && comma > 0) {
                b64 = b64.substring(comma + 1);
            }
            byte[] data = Base64.decode(b64, Base64.DEFAULT);
            File f = resolve("images/" + name);
            File parent = f.getParentFile();
            if (parent != null && !parent.exists()) {
                //noinspection ResultOfMethodCallIgnored
                parent.mkdirs();
            }
            FileOutputStream out = new FileOutputStream(f);
            out.write(data);
            out.flush();
            out.close();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @JavascriptInterface
    public String loadImage(String name) {
        try {
            File f = resolve("images/" + name);
            if (!f.exists() || !f.isFile()) return null;
            FileInputStream in = new FileInputStream(f);
            byte[] data = readAll(in);
            in.close();
            String mime = name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
            return "data:" + mime + ";base64,"
                    + Base64.encodeToString(data, Base64.NO_WRAP);
        } catch (Exception e) {
            return null;
        }
    }

    @JavascriptInterface
    public boolean deleteImage(String name) {
        try {
            return deleteRecursive(resolve("images/" + name));
        } catch (Exception e) {
            return false;
        }
    }

    // ----------------------------------------------------------- 网络

    @JavascriptInterface
    public String httpRequest(String method, String url, String headersJson, String body) {
        HttpURLConnection conn = null;
        try {
            conn = open(method, url, headersJson, body);
            int code = conn.getResponseCode();
            InputStream in = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String text = in == null ? "" : new String(readAll(in), "UTF-8");
            JSONObject r = new JSONObject();
            r.put("status", code);
            r.put("body", text);
            return r.toString();
        } catch (Exception e) {
            return errorJson(-1, String.valueOf(e.getMessage()));
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private HttpURLConnection open(String method, String url, String headersJson, String body)
            throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setRequestMethod(method == null || method.length() == 0 ? "POST" : method);
        conn.setConnectTimeout(20000);
        conn.setReadTimeout(180000);
        conn.setInstanceFollowRedirects(true);
        if (headersJson != null && headersJson.length() > 0) {
            JSONObject h = new JSONObject(headersJson);
            Iterator<String> it = h.keys();
            while (it.hasNext()) {
                String k = it.next();
                conn.setRequestProperty(k, h.getString(k));
            }
        }
        if (body != null) {
            conn.setDoOutput(true);
            byte[] payload = body.getBytes("UTF-8");
            conn.setRequestProperty("Content-Length", String.valueOf(payload.length));
            OutputStream os = conn.getOutputStream();
            os.write(payload);
            os.flush();
            os.close();
        }
        return conn;
    }

    private static String errorJson(int status, String message) {
        try {
            JSONObject r = new JSONObject();
            r.put("status", status);
            r.put("body", "");
            r.put("error", message == null ? "unknown" : message);
            return r.toString();
        } catch (Exception e) {
            return "{\"status\":-1,\"body\":\"\",\"error\":\"unknown\"}";
        }
    }

    // ------------------------------------------------------- 流式输出

    @JavascriptInterface
    public String streamStart(String url, String headersJson, String body) {
        pruneJobs();
        String id;
        synchronized (JsBridge.class) {
            id = "s" + (++seq);
        }
        StreamJob job = new StreamJob(id, url, headersJson, body);
        JOBS.put(id, job);
        job.start();
        return id;
    }

    @JavascriptInterface
    public String streamPoll(String id) {
        StreamJob job = JOBS.get(id);
        if (job == null) {
            return "{\"text\":\"\",\"done\":true,\"error\":\"任务不存在或已结束\"}";
        }
        return job.drain();
    }

    @JavascriptInterface
    public void streamAbort(String id) {
        StreamJob job = JOBS.remove(id);
        if (job != null) job.abort();
    }

    private static void pruneJobs() {
        long now = System.currentTimeMillis();
        for (Iterator<Map.Entry<String, StreamJob>> it = JOBS.entrySet().iterator(); it.hasNext(); ) {
            StreamJob j = it.next().getValue();
            if ((j.done || j.aborted) && now - j.lastTouch > 120000L) {
                it.remove();
            }
        }
        // 保险：任务数过多时丢弃最旧的已结束任务
        if (JOBS.size() > 12) {
            List<Map.Entry<String, StreamJob>> list =
                    new ArrayList<Map.Entry<String, StreamJob>>(JOBS.entrySet());
            Collections.sort(list, new java.util.Comparator<Map.Entry<String, StreamJob>>() {
                public int compare(Map.Entry<String, StreamJob> a, Map.Entry<String, StreamJob> b) {
                    return Long.compare(a.getValue().startedAt, b.getValue().startedAt);
                }
            });
            for (int i = 0; i < list.size() && JOBS.size() > 6; i++) {
                if (list.get(i).getValue().done) {
                    JOBS.remove(list.get(i).getKey());
                }
            }
        }
    }

    /** 一个后台流式请求任务 */
    static class StreamJob {
        final String id;
        final String url;
        final String headersJson;
        final String body;
        final long startedAt = System.currentTimeMillis();
        final StringBuilder pending = new StringBuilder();
        final StringBuilder raw = new StringBuilder();
        volatile boolean done = false;
        volatile boolean aborted = false;
        volatile String error = null;
        volatile long lastTouch = System.currentTimeMillis();
        private volatile HttpURLConnection conn;
        private Thread thread;

        StreamJob(String id, String url, String headersJson, String body) {
            this.id = id;
            this.url = url;
            this.headersJson = headersJson;
            this.body = body;
        }

        void start() {
            thread = new Thread(new Runnable() {
                public void run() {
                    runJob();
                }
            });
            thread.setDaemon(true);
            thread.start();
        }

        void abort() {
            aborted = true;
            done = true;
            HttpURLConnection c = conn;
            if (c != null) {
                try {
                    c.disconnect();
                } catch (Exception ignored) {
                }
            }
        }

        synchronized void push(String s) {
            if (s == null || s.length() == 0) return;
            pending.append(s);
        }

        synchronized String drain() {
            lastTouch = System.currentTimeMillis();
            String text = pending.toString();
            pending.setLength(0);
            StringBuilder sb = new StringBuilder("{");
            sb.append("\"text\":").append(JSONObject.quote(text));
            sb.append(",\"done\":").append(done);
            if (error != null) {
                sb.append(",\"error\":").append(JSONObject.quote(error));
            }
            return sb.append('}').toString();
        }

        private void runJob() {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                conn = c;
                c.setRequestMethod("POST");
                c.setConnectTimeout(20000);
                c.setReadTimeout(180000);
                c.setDoOutput(true);
                c.setRequestProperty("Accept", "text/event-stream");
                if (headersJson != null && headersJson.length() > 0) {
                    JSONObject h = new JSONObject(headersJson);
                    Iterator<String> it = h.keys();
                    while (it.hasNext()) {
                        String k = it.next();
                        c.setRequestProperty(k, h.getString(k));
                    }
                }
                byte[] payload = body.getBytes("UTF-8");
                c.setRequestProperty("Content-Length", String.valueOf(payload.length));
                OutputStream os = c.getOutputStream();
                os.write(payload);
                os.flush();
                os.close();

                int code = c.getResponseCode();
                InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                if (in == null) {
                    error = "HTTP " + code + " 且无响应体";
                    return;
                }
                if (code >= 400) {
                    error = "HTTP " + code + " " + clip(new String(readAll(in), "UTF-8"), 400);
                    return;
                }

                BufferedReader br = new BufferedReader(new InputStreamReader(in, "UTF-8"));
                String line;
                boolean sawData = false;
                while (!aborted && (line = br.readLine()) != null) {
                    if (line.startsWith("data:")) {
                        sawData = true;
                        String data = line.substring(5).trim();
                        if ("[DONE]".equals(data)) break;
                        if (data.length() == 0) continue;
                        String delta = extractDelta(data);
                        if (delta != null && delta.length() > 0) push(delta);
                    } else if (line.length() > 0 && !line.startsWith(":")) {
                        if (raw.length() < 2000000) raw.append(line);
                    }
                }
                br.close();

                // 服务端未按 SSE 返回（例如某些代理直接返回完整 JSON）
                if (!sawData && raw.length() > 0 && pending.length() == 0 && error == null) {
                    String content = extractDelta(raw.toString());
                    if (content == null || content.length() == 0) {
                        content = raw.toString();
                    }
                    push(content);
                }
            } catch (Exception e) {
                if (!aborted) {
                    error = String.valueOf(e.getMessage());
                }
            } finally {
                done = true;
                HttpURLConnection c = conn;
                if (c != null) {
                    try {
                        c.disconnect();
                    } catch (Exception ignored) {
                    }
                }
            }
        }

        /**
         * 兼容多种大模型流式协议，提取增量文本：
         *   OpenAI / DeepSeek / Qwen / Moonshot / Ollama(openai兼容): choices[0].delta.content
         *   OpenAI 补全接口:                                        choices[0].text
         *   Anthropic:                                             type=content_block_delta → delta.text
         *   Ollama 原生:                                            message.content / response
         */
        private static String extractDelta(String json) {
            try {
                JSONObject o = new JSONObject(json);
                if (o.has("choices")) {
                    org.json.JSONArray arr = o.optJSONArray("choices");
                    if (arr != null && arr.length() > 0) {
                        JSONObject c0 = arr.optJSONObject(0);
                        if (c0 != null) {
                            JSONObject d = c0.optJSONObject("delta");
                            if (d != null && d.optString("content", null) != null) {
                                return d.optString("content", "");
                            }
                            JSONObject m = c0.optJSONObject("message");
                            if (m != null && m.optString("content", null) != null) {
                                return m.optString("content", "");
                            }
                            if (c0.optString("text", null) != null) {
                                return c0.optString("text", "");
                            }
                        }
                    }
                }
                if (o.has("delta")) {
                    JSONObject d = o.optJSONObject("delta");
                    if (d != null && d.optString("text", null) != null) {
                        return d.optString("text", "");
                    }
                }
                if (o.optString("response", null) != null && o.has("response")) {
                    return o.optString("response", "");
                }
                if (o.has("message")) {
                    JSONObject m = o.optJSONObject("message");
                    if (m != null && m.optString("content", null) != null) {
                        return m.optString("content", "");
                    }
                }
                if (o.has("content")) {
                    Object c = o.opt("content");
                    if (c instanceof String) return (String) c;
                }
                // 错误对象
                if (o.has("error")) {
                    Object err = o.opt("error");
                    if (err instanceof JSONObject) {
                        return "\n[接口错误] " + ((JSONObject) err).optString("message", err.toString());
                    }
                    return "\n[接口错误] " + err;
                }
            } catch (Exception ignored) {
            }
            return "";
        }
    }

    // ----------------------------------------------------------- 其它

    @JavascriptInterface
    public void toast(final String msg) {
        main.post(new Runnable() {
            public void run() {
                Toast.makeText(ctx, msg == null ? "" : msg, Toast.LENGTH_SHORT).show();
            }
        });
    }

    /** 复制文本到系统剪贴板（用于导出文本记录 / 备份 JSON） */
    @JavascriptInterface
    public boolean copy(String text) {
        try {
            ClipboardManager cm = (ClipboardManager) ctx.getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm == null) return false;
            cm.setPrimaryClip(ClipData.newPlainText("记账本", text == null ? "" : text));
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** 通过系统分享面板发送文本（微信 / 邮件 / 备忘录等） */
    @JavascriptInterface
    public boolean share(String text) {
        try {
            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType("text/plain");
            intent.putExtra(Intent.EXTRA_SUBJECT, "记账本 · 文本记录");
            intent.putExtra(Intent.EXTRA_TEXT, text == null ? "" : text);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(Intent.createChooser(intent, "分享记账记录")
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @JavascriptInterface
    public String dataDir() {
        return baseDir.getAbsolutePath();
    }

    // ------------------------------------------------------ 桌面图标切换

    /**
     * 桌面图标由一组 activity-alias 提供，同一时刻只启用其中一个。
     * 顺序必须与 AndroidManifest.xml 中的声明保持一致。
     */
    private static final String[][] LAUNCHER_ALIASES = {
            {"whale_q_blue", "com.ledgerbook.app.LauncherWhaleQBlue"},
            {"whale_q_pink", "com.ledgerbook.app.LauncherWhaleQPink"},
            {"whale_q_light", "com.ledgerbook.app.LauncherWhaleQLight"},
            {"whale_q_face", "com.ledgerbook.app.LauncherWhaleQFace"},
            {"whale_m_blue", "com.ledgerbook.app.LauncherWhaleMature"},
            {"fish_meme", "com.ledgerbook.app.LauncherFish"},
            {"classic", "com.ledgerbook.app.LauncherClassic"},
    };

    /**
     * 切换桌面图标。
     * 注意：任何时刻都必须保留恰好一个启用的别名，否则应用会从桌面消失。
     *
     * @param key 图标标识，取值见 LAUNCHER_ALIASES
     * @return 是否切换成功
     */
    @JavascriptInterface
    public boolean setLauncherIcon(String key) {
        int target = -1;
        for (int i = 0; i < LAUNCHER_ALIASES.length; i++) {
            if (LAUNCHER_ALIASES[i][0].equals(key)) {
                target = i;
                break;
            }
        }
        if (target < 0) return false;

        PackageManager pm = ctx.getPackageManager();
        try {
            for (int i = 0; i < LAUNCHER_ALIASES.length; i++) {
                int state = (i == target)
                        ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                        : PackageManager.COMPONENT_ENABLED_STATE_DISABLED;
                pm.setComponentEnabledSetting(
                        new ComponentName(ctx, LAUNCHER_ALIASES[i][1]),
                        state,
                        PackageManager.DONT_KILL_APP);
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** 返回当前启用的桌面图标标识 */
    @JavascriptInterface
    public String getLauncherIcon() {
        PackageManager pm = ctx.getPackageManager();
        for (int i = 0; i < LAUNCHER_ALIASES.length; i++) {
            try {
                ComponentName cn = new ComponentName(ctx, LAUNCHER_ALIASES[i][1]);
                int state = pm.getComponentEnabledSetting(cn);
                if (state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED) {
                    return LAUNCHER_ALIASES[i][0];
                }
                // 从未显式设置过时，取清单里声明的默认值
                if (state == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT) {
                    ActivityInfo ai = pm.getActivityInfo(cn, 0);
                    if (ai != null && ai.enabled) return LAUNCHER_ALIASES[i][0];
                }
            } catch (Exception ignored) {
            }
        }
        return "whale_q_blue";
    }

    // ------------------------------------------------------ 自动记账

    /**
     * 是否已经拿到「通知使用权」。
     * 微信 / 支付宝都没有公开的账单接口，只能通过读取系统通知来识别收付款。
     */
    @JavascriptInterface
    public boolean hasPayAccess() {
        try {
            String flat = Settings.Secure.getString(
                    ctx.getContentResolver(), "enabled_notification_listeners");
            if (flat == null || flat.isEmpty()) return false;
            return flat.contains(ctx.getPackageName());
        } catch (Exception e) {
            return false;
        }
    }

    /** 跳转到系统的「通知使用权」设置页 */
    @JavascriptInterface
    public boolean openPayAccessSettings() {
        try {
            Intent i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            return true;
        } catch (Exception e) {
            try {
                Intent i2 = new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS");
                i2.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(i2);
                return true;
            } catch (Exception e2) {
                return false;
            }
        }
    }

    /** 读取待确认的收付款记录（JSON 数组字符串） */
    @JavascriptInterface
    public String listPayInbox() {
        try {
            return PayStore.read(ctx).toString();
        } catch (Exception e) {
            return "[]";
        }
    }

    /** 导入完成后，把已处理的记录从收件箱移除 */
    @JavascriptInterface
    public boolean removePayInbox(String idsJson) {
        try {
            JSONArray ids = new JSONArray(idsJson);
            java.util.List<String> list = new ArrayList<String>();
            for (int i = 0; i < ids.length(); i++) {
                list.add(ids.getString(i));
            }
            PayStore.remove(ctx, list);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @JavascriptInterface
    public boolean clearPayInbox() {
        try {
            PayStore.clear(ctx);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * 手动塞一条测试记录，用来在收不到真实通知时验证整条链路。
     */
    @JavascriptInterface
    public boolean injectTestPay(String source, String type, double amount, String content) {
        try {
            PayStore.inject(ctx, source, type, amount, content);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * 用真实的解析规则试跑一段通知文本，方便排查「为什么没识别出来」。
     * 返回解析结果 JSON，或被拒绝的原因。
     */
    @JavascriptInterface
    public String testPayParse(String pkg, String title, String body) {
        try {
            PayParser.Result r = PayParser.parse(pkg, title, body);
            JSONObject o = new JSONObject();
            if (r == null) {
                o.put("ok", false);
                o.put("reason", "没识别成交易：需要同时出现「金额」和「收/付款」关键词");
                return o.toString();
            }
            o.put("ok", true);
            o.put("source", r.source);
            o.put("type", r.type);
            o.put("amount", r.amount);
            o.put("content", r.content);
            return o.toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"reason\":\"解析异常\"}";
        }
    }

    // ------------------------------------------------------ 自定义桌面图标

    /** 固定快捷方式的 id，用来后续更新同一枚图标 */
    private static final String CUSTOM_SHORTCUT_ID = "ledger_custom_icon";

    /**
     * 当前设备是否支持「把自定义图标固定到桌面」。
     *
     * 注：安卓不允许应用在运行时替换自己的启动器图标（资源在编译期就固定了），
     * 所以自定义图标是通过 ShortcutManager 以桌面快捷方式的形式添加的，
     * 这是系统唯一官方支持的做法。
     */
    @JavascriptInterface
    public boolean canPinCustomIcon() {
        if (Build.VERSION.SDK_INT < 26) return false;
        try {
            ShortcutManager sm = (ShortcutManager) ctx.getSystemService(Context.SHORTCUT_SERVICE);
            return sm != null && sm.isRequestPinShortcutSupported();
        } catch (Exception e) {
            return false;
        }
    }

    /** 是否已经往桌面添加过自定义图标 */
    @JavascriptInterface
    public boolean hasPinnedCustomIcon() {
        if (Build.VERSION.SDK_INT < 26) return false;
        try {
            ShortcutManager sm = (ShortcutManager) ctx.getSystemService(Context.SHORTCUT_SERVICE);
            if (sm == null) return false;
            for (ShortcutInfo s : sm.getPinnedShortcuts()) {
                if (CUSTOM_SHORTCUT_ID.equals(s.getId())) return true;
            }
        } catch (Exception ignored) {
        }
        return false;
    }

    /**
     * 用一张 PNG（支持透明通道）在桌面上添加/更新自定义图标。
     *
     * @param dataUrl 形如 data:image/png;base64,xxxx
     * @param label   桌面显示的名称
     * @return 是否成功发起
     */
    @JavascriptInterface
    public boolean pinCustomIcon(String dataUrl, String label) {
        if (Build.VERSION.SDK_INT < 26) return false;
        try {
            ShortcutManager sm = (ShortcutManager) ctx.getSystemService(Context.SHORTCUT_SERVICE);
            if (sm == null || !sm.isRequestPinShortcutSupported()) return false;

            String b64 = dataUrl == null ? "" : dataUrl;
            int comma = b64.indexOf(',');
            if (b64.startsWith("data:") && comma > 0) {
                b64 = b64.substring(comma + 1);
            }
            byte[] raw = Base64.decode(b64, Base64.DEFAULT);
            Bitmap bmp = BitmapFactory.decodeByteArray(raw, 0, raw.length);
            if (bmp == null) return false;

            // 同时存一份，便于以后重新固定或恢复
            try {
                File out = resolve("custom-icon.png");
                FileOutputStream fos = new FileOutputStream(out);
                fos.write(raw);
                fos.flush();
                fos.close();
            } catch (Exception ignored) {
            }

            Intent intent = new Intent(ctx, MainActivity.class);
            intent.setAction(Intent.ACTION_MAIN);
            intent.addCategory(Intent.CATEGORY_LAUNCHER);

            String name = (label == null || label.trim().isEmpty()) ? "记账本" : label.trim();
            ShortcutInfo info = new ShortcutInfo.Builder(ctx, CUSTOM_SHORTCUT_ID)
                    .setShortLabel(name.length() > 10 ? name.substring(0, 10) : name)
                    .setLongLabel(name)
                    .setIcon(Icon.createWithBitmap(bmp))
                    .setIntent(intent)
                    .build();

            // 已固定过就更新，否则请求系统固定
            for (ShortcutInfo s : sm.getPinnedShortcuts()) {
                if (CUSTOM_SHORTCUT_ID.equals(s.getId())) {
                    sm.updateShortcuts(java.util.Collections.singletonList(info));
                    return true;
                }
            }
            return sm.requestPinShortcut(info, null);
        } catch (Exception e) {
            return false;
        }
    }

    /** 把之前保存在本地的自定义图标读回来（dataURL 形式） */
    @JavascriptInterface
    public String loadCustomIcon() {
        try {
            File f = resolve("custom-icon.png");
            if (!f.exists()) return "";
            FileInputStream in = new FileInputStream(f);
            byte[] data = readAll(in);
            in.close();
            return "data:image/png;base64," + Base64.encodeToString(data, Base64.NO_WRAP);
        } catch (Exception e) {
            return "";
        }
    }

    // ------------------------------------------------------ 自动记账自检

    /**
     * 自动记账的诊断信息。
     *
     * 用来区分三种情况：没授权 / 授权了但收不到通知（被系统或厂商 ROM 限制）/
     * 收到了但没认出来。前两种情况用户自己能处理，第三种才需要改代码。
     */
    @JavascriptInterface
    public String payDiagnostics() {
        try {
            JSONObject o = PayStore.readStatus(ctx);
            o.put("hasAccess", hasPayAccess());
            o.put("inbox", PayStore.read(ctx).length());
            o.put("sdk", Build.VERSION.SDK_INT);
            return o.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    /** 请求系统重新绑定通知监听服务（服务被厂商 ROM 杀掉后用得上） */
    @JavascriptInterface
    public boolean reconnectPay() {
        try {
            android.service.notification.NotificationListenerService.requestRebind(
                    new ComponentName(ctx, PayListenerService.class));
            return true;
        } catch (Throwable e) {
            return false;
        }
    }
}
