package com.qudlink;

import android.app.Activity;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;

public class Main extends Activity {
    WebView web;

    // Native HTTP so requests skip WebView CORS rules (the mod requires an X-QudLink header).
    public class Native {
        @JavascriptInterface public String get(String path) {
            java.net.HttpURLConnection c = null;
            try {
                c = (java.net.HttpURLConnection) new java.net.URL("http://127.0.0.1:8765" + path).openConnection();
                c.setConnectTimeout(1500); c.setReadTimeout(4000);
                c.setRequestProperty("X-QudLink", "1");
                int code = c.getResponseCode();
                java.io.InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
                if (in == null) return "{\"error\":\"HTTP " + code + "\"}";
                java.io.ByteArrayOutputStream o = new java.io.ByteArrayOutputStream();
                byte[] b = new byte[8192]; int n;
                while ((n = in.read(b)) > 0) o.write(b, 0, n);
                String body = o.toString("UTF-8");
                return code < 400 ? body : "{\"error\":\"HTTP " + code + "\"}";
            } catch (Exception e) {
                return "{\"error\":\"" + e.getClass().getSimpleName() + "\"}";
            } finally { if (c != null) c.disconnect(); }
        }
    }

    public class Haptics {
        @JavascriptInterface public void tick() {
            Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (v != null) v.vibrate(VibrationEffect.createOneShot(12, 80));
        }
        @JavascriptInterface public void buzz(int ms) {
            Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (v != null) v.vibrate(VibrationEffect.createOneShot(Math.max(1, Math.min(ms, 1000)), 255));
        }
    }

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        // Touch works, but keyboard/controller focus stays on Qud (top screen).
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE);
        web = new WebView(this);
        web.setBackgroundColor(0xFF041312);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        web.addJavascriptInterface(new Haptics(), "Haptics");
        web.addJavascriptInterface(new Native(), "Native");
        setContentView(web);
        hideBars();
        web.loadUrl("file:///android_asset/index.html");
    }

    void hideBars() {
        web.setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    @Override protected void onResume() { super.onResume(); hideBars(); }

    @Override public void onBackPressed() { /* don't close on accidental back */ }
}
