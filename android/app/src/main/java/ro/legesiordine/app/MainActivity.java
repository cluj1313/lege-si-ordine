package ro.legesiordine.app;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
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
