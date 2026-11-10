package ro.legesiordine.app.system;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Deschide pagina de notificări a aplicației (pentru cazul „refuzat definitiv”). */
@CapacitorPlugin(name = "LsoSystem")
public class LsoSystemPlugin extends Plugin {
    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        String pkg = getContext().getPackageName();
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            intent.putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
        } else {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg));
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(intent);
        } catch (Exception e) {
            Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg));
            fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try { getActivity().startActivity(fallback); } catch (Exception ignored) { call.reject("indisponibil"); return; }
        }
        JSObject r = new JSObject();
        r.put("opened", true);
        call.resolve(r);
    }
}
