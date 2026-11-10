package ro.legesiordine.app.system;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;
import ro.legesiordine.app.MainActivity;
import ro.legesiordine.app.R;

/**
 * „Mesaje de la creator” (port din Notis NewsReceiver): citește fișierul public de pe GitHub Pages
 * cu o alarmă inexactă (primul tick la o oră, apoi la 6 ore) și notifică doar id-urile noi.
 * La primul poll („primed”) nu notifică stocul vechi. Preferințe separate: SharedPreferences „news”.
 */
public class NewsReceiver extends BroadcastReceiver {
    static final String URLS = "https://cluj1313.github.io/lso-mesaje/creator.json", CH = "lso_mesaje";
    static final String ACTION = "ro.legesiordine.app.NEWS_POLL";

    static SharedPreferences p(Context c) {
        return c.getSharedPreferences("news", Context.MODE_PRIVATE);
    }

    static PendingIntent pi(Context c) {
        Intent i = new Intent(c, NewsReceiver.class).setAction(ACTION);
        return PendingIntent.getBroadcast(c, 4711, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void set(Context c, boolean on, String lang, boolean pollNow) {
        p(c).edit().putBoolean("on", on).putString("lang", lang == null ? "ro" : lang).commit();
        arm(c);
        if (on && pollNow) new Thread(() -> poll(c)).start();
    }

    static void arm(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        am.cancel(pi(c));
        if (p(c).getBoolean("on", false)) {
            am.setInexactRepeating(
                AlarmManager.ELAPSED_REALTIME,
                android.os.SystemClock.elapsedRealtime() + AlarmManager.INTERVAL_HOUR,
                6 * AlarmManager.INTERVAL_HOUR,
                pi(c)
            );
        }
    }

    static synchronized void seen(Context c, String id) {
        if (id == null) return;
        Set<String> s = new HashSet<>(p(c).getStringSet("seen", new HashSet<>()));
        s.add(id);
        p(c).edit().putStringSet("seen", s).apply();
    }

    static synchronized void poll(Context c) {
        try {
            if (!p(c).getBoolean("on", false)) return;
            HttpURLConnection k = (HttpURLConnection) new URL(URLS + "?t=" + System.currentTimeMillis()).openConnection();
            k.setUseCaches(false);
            k.setConnectTimeout(15000);
            k.setReadTimeout(15000);
            if (k.getResponseCode() != 200) { k.disconnect(); return; }
            StringBuilder sb = new StringBuilder();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(k.getInputStream(), "UTF-8"))) {
                String l;
                while ((l = r.readLine()) != null) sb.append(l).append('\n');
            }
            k.disconnect();
            JSONArray a = new JSONObject(sb.toString()).optJSONArray("messages");
            if (a == null) return;
            boolean first = !p(c).getBoolean("primed", false);
            Set<String> s = new HashSet<>(p(c).getStringSet("seen", new HashSet<>()));
            for (int i = 0; i < a.length(); i++) {
                JSONObject m = a.optJSONObject(i);
                if (m == null) continue;
                String id = m.optString("id", "");
                if (id.isEmpty() || s.contains(id)) continue;
                s.add(id);
                if (!first) notify(c, id, m);
            }
            p(c).edit().putStringSet("seen", s).putBoolean("primed", true).apply();
        } catch (Exception ignored) {
            // eșec tăcut
        }
    }

    static void channel(Context c) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            if (nm != null && nm.getNotificationChannel(CH) == null) {
                NotificationChannel ch = new NotificationChannel(CH, "Mesaje de la creator – LEGE ȘI ORDINE", NotificationManager.IMPORTANCE_DEFAULT);
                ch.setDescription("Anunțuri scurte de la creatorul aplicației LEGE ȘI ORDINE");
                nm.createNotificationChannel(ch);
            }
        }
    }

    static void notify(Context c, String id, JSONObject m) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(c, android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        channel(c);
        String lang = p(c).getString("lang", "ro");
        String title = m.optString("title", ""), body = m.optString("body", "");
        JSONObject L = m.optJSONObject("lang");
        if (L != null && !"ro".equals(lang) && L.optJSONObject(lang) != null) {
            JSONObject x = L.optJSONObject(lang);
            title = x.optString("title", title);
            body = x.optString("body", body);
        }
        Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, id.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CH)
            .setSmallIcon(R.drawable.ic_stat_lso)
            .setColor(0xFFC9A24A)
            .setContentTitle(title.isEmpty() ? "Mesaj nou de la creator" : title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(pi);
        try { NotificationManagerCompat.from(c).notify(("news:" + id).hashCode(), b.build()); } catch (SecurityException ignored) {}
    }

    @Override
    public void onReceive(Context c, Intent intent) {
        String a = intent != null ? intent.getAction() : null;
        if (Intent.ACTION_BOOT_COMPLETED.equals(a) || "android.intent.action.MY_PACKAGE_REPLACED".equals(a)) {
            arm(c);
            return;
        }
        final PendingResult pr = goAsync();
        new Thread(() -> {
            try { poll(c); } finally { pr.finish(); }
        }).start();
    }
}
