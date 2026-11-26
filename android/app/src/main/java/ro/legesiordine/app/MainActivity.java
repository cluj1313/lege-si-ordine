package ro.legesiordine.app;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import ro.legesiordine.app.system.LsoSystemPlugin;
import ro.legesiordine.app.voice.LsoVoicePlugin;

public class MainActivity extends BridgeActivity {
    // Dezinstalează un service worker rămas pe https://localhost (cache-first din 1.2.2)
    // care ar putea servi CSS/JS vechi peste APK-ul nou. Nu atinge IndexedDB.
    private static final String FLUSH_STALE_SW =
        "(function(){"
        + "var VER='1.2.4';"
        + "if(sessionStorage.getItem('lso_sw_gone')===VER) return;"
        + "Promise.resolve().then(function(){return (async function(){"
        + "  try {"
        + "    var had=false;"
        + "    if('serviceWorker' in navigator){"
        + "      var regs=await navigator.serviceWorker.getRegistrations();"
        + "      had=regs.length>0;"
        + "      await Promise.all(regs.map(function(r){return r.unregister();}));"
        + "    }"
        + "    if(window.caches){"
        + "      var keys=await caches.keys();"
        + "      await Promise.all(keys.filter(function(k){return k.indexOf('lso-cache-')===0;}).map(function(k){return caches.delete(k);}));"
        + "    }"
        + "    sessionStorage.setItem('lso_sw_gone', VER);"
        + "    if(had) location.reload();"
        + "  } catch(e) {}"
        + "})();});"
        + "})()";

    private void flushStaleServiceWorker() {
        WebView web = getBridge() != null ? getBridge().getWebView() : null;
        if (web == null) return;
        web.evaluateJavascript(FLUSH_STALE_SW, null);
    }

    private void refreshWidgetsNow() {
        try {
            AppWidgetManager mgr = AppWidgetManager.getInstance(getApplicationContext());
            ComponentName cn = new ComponentName(getApplicationContext(), LsoClockWidget.class);
            int[] ids = mgr.getAppWidgetIds(cn);
            if (ids != null && ids.length > 0) {
                for (int id : ids) {
                    LsoClockWidget.updateOneWidget(getApplicationContext(), mgr, id);
                }
            }
        } catch (Exception ignored) {
        }
    }

    public class LsoWidgetBridge {
        @JavascriptInterface
        public void updateWidget(String jsonPayload) {
            if (jsonPayload == null) return;
            try {
                File out = new File(getApplicationContext().getFilesDir(), "lso_widget_state.json");
                Files.write(out.toPath(), jsonPayload.getBytes(StandardCharsets.UTF_8));
            } catch (Exception ignored) {
            }
            runOnUiThread(() -> refreshWidgetsNow());
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(LsoVoicePlugin.class);
        registerPlugin(LsoSystemPlugin.class);
        super.onCreate(savedInstanceState);
        WebView web = getBridge() != null ? getBridge().getWebView() : null;
        if (web != null) {
            web.getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
            try {
                web.addJavascriptInterface(new LsoWidgetBridge(), "LsoWidgetBridge");
            } catch (Exception ignored) {
            }
            // Rulează după ce pagina (posibil servită din SW vechi) e în memorie, ca JS-ul să poată dezinstala SW-ul.
            web.post(this::flushStaleServiceWorker);
            web.postDelayed(this::flushStaleServiceWorker, 400);
            web.postDelayed(this::flushStaleServiceWorker, 1600);
        }
        refreshWidgetsNow();
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView view = getBridge() != null ? getBridge().getWebView() : null;
                if (view == null) {
                    moveTaskToBack(true);
                    return;
                }
                view.evaluateJavascript(
                    "(function(){try{return !!(window.LSO&&window.LSO.handleBack&&window.LSO.handleBack());}catch(e){return false;}})()",
                    value -> {
                        if (value == null || !value.contains("true")) {
                            moveTaskToBack(true);
                        }
                    }
                );
            }
        });
    }
}
