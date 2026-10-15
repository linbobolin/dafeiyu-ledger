package com.ledgerbook.app;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

/**
 * 监听微信 / 支付宝的收付款通知。
 *
 * 用户在「设置 → 自动记账」里跳转到系统的通知使用权页面授权后，
 * 本服务才会收到回调。识别到的内容写入 PayStore，等用户在应用里确认。
 *
 * 注意：本服务必须做到「永不崩溃」——通知回调抛异常会影响系统通知栏。
 * 因此所有逻辑都包在 try/catch 里。
 */
public class PayListenerService extends NotificationListenerService {

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            handle(sbn);
        } catch (Throwable ignored) {
            // 通知服务不能因为任何解析问题而崩溃
        }
    }

    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        // 连接成功时不做历史补扫：系统并不会给出很久之前的通知，
        // 而重复补扫容易产生重复账单，交给用户手动导入更稳妥。
        PayStore.mark(this, "connected", true);
        PayStore.mark(this, "connectedAt", System.currentTimeMillis());
    }

    @Override
    public void onListenerDisconnected() {
        super.onListenerDisconnected();
        PayStore.mark(this, "connected", false);
        PayStore.mark(this, "disconnectedAt", System.currentTimeMillis());
    }

    private void handle(StatusBarNotification sbn) {
        if (sbn == null || sbn.getNotification() == null) return;

        String pkg = sbn.getPackageName();
        if (!PayParser.isSupported(pkg)) return;

        Bundle ex = sbn.getNotification().extras;
        if (ex == null) return;

        String title = str(ex.getCharSequence(Notification.EXTRA_TITLE));
        StringBuilder body = new StringBuilder();
        body.append(str(ex.getCharSequence(Notification.EXTRA_TEXT))).append(' ');
        body.append(str(ex.getCharSequence(Notification.EXTRA_BIG_TEXT))).append(' ');
        body.append(str(ex.getCharSequence(Notification.EXTRA_SUB_TEXT)));

        CharSequence[] lines = ex.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
        if (lines != null) {
            for (CharSequence c : lines) {
                body.append(' ').append(str(c));
            }
        }

        String bodyText = body.toString().trim();

        // 把「确实收到了通知」这件事记下来，方便用户在自检里判断
        // 到底是没收到通知，还是收到了但没认出来。
        PayStore.markSeen(this, pkg, title, bodyText, false);

        PayParser.Result r = PayParser.parse(pkg, title, bodyText);
        if (r == null) return;

        PayStore.append(this, r, sbn.getPostTime());
        PayStore.markSeen(this, pkg, title, bodyText, true);
        PayStore.mark(this, "connected", true);
    }

    private static String str(CharSequence cs) {
        return cs == null ? "" : cs.toString().trim();
    }
}
