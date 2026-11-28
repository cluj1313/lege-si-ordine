package ro.legesiordine.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Calendar;
import java.util.Locale;

public class LsoClockWidget extends AppWidgetProvider {

    private static final String STATE_FILE_NAME = "lso_widget_state.json";

    private static final String[] DAYS_RO = {
            "", "duminică", "luni", "marți", "miercuri", "joi", "vineri", "sâmbătă"
    };

    private static final String[] MONTHS_RO = {
            "ianuarie", "februarie", "martie", "aprilie", "mai", "iunie",
            "iulie", "august", "septembrie", "octombrie", "noiembrie", "decembrie"
    };

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent != null ? intent.getAction() : null;
        if (Intent.ACTION_TIME_TICK.equals(action)
                || Intent.ACTION_TIME_CHANGED.equals(action)
                || Intent.ACTION_DATE_CHANGED.equals(action)
                || Intent.ACTION_TIMEZONE_CHANGED.equals(action)) {
            refreshAllWidgets(context);
        }
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        if (appWidgetIds == null) return;
        for (int appWidgetId : appWidgetIds) {
            updateOneWidget(context, appWidgetManager, appWidgetId);
        }
    }

    static void refreshAllWidgets(Context context) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(context);
        if (mgr == null) return;
        ComponentName cn = new ComponentName(context, LsoClockWidget.class);
        int[] ids = mgr.getAppWidgetIds(cn);
        if (ids != null) {
            for (int id : ids) {
                updateOneWidget(context, mgr, id);
            }
        }
    }

    static void updateOneWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_clock);

        Calendar cal = Calendar.getInstance();
        String hh = String.format(Locale.getDefault(), "%02d", cal.get(Calendar.HOUR_OF_DAY));
        String mm = String.format(Locale.getDefault(), "%02d", cal.get(Calendar.MINUTE));
        String timeText = hh + ":" + mm;

        int dayOfWeek = cal.get(Calendar.DAY_OF_WEEK);
        String dayName = (dayOfWeek >= 1 && dayOfWeek < DAYS_RO.length) ? DAYS_RO[dayOfWeek] : "";
        int dayNum = cal.get(Calendar.DAY_OF_MONTH);
        int monthIndex = cal.get(Calendar.MONTH);
        String monthName = (monthIndex >= 0 && monthIndex < MONTHS_RO.length) ? MONTHS_RO[monthIndex] : "";
        int year = cal.get(Calendar.YEAR);
        String dateText = dayName.isEmpty()
                ? (dayNum + " " + monthName + " " + year)
                : (dayName + ", " + dayNum + " " + monthName + " " + year);

        int activeCount = 0;
        String ringColor = "red";
        try {
            String jsonStr = readWidgetStateJson(context);
            if (jsonStr != null && !jsonStr.isEmpty()) {
                JSONObject obj = new JSONObject(jsonStr);
                activeCount = Math.max(0, obj.optInt("activeCount", 0));
                ringColor = obj.optString("ringColor", activeCount > 0 ? "green" : "red");
            }
        } catch (Exception ignored) {
        }

        views.setTextViewText(R.id.widget_time, timeText);
        views.setTextViewText(R.id.widget_date, dateText);

        int ringRes = "green".equalsIgnoreCase(ringColor) ? R.drawable.widget_ring_green : R.drawable.widget_ring_red;
        views.setInt(R.id.widget_ring, "setBackgroundResource", ringRes);
        views.setTextViewText(R.id.widget_ring, String.valueOf(activeCount));

        Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launchIntent != null) {
            PendingIntent pi = PendingIntent.getActivity(
                    context,
                    0,
                    launchIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            views.setOnClickPendingIntent(R.id.widget_root, pi);
        }

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    private static String readWidgetStateJson(Context context) {
        File f = new File(context.getFilesDir(), STATE_FILE_NAME);
        if (!f.exists() || !f.isFile()) {
            return null;
        }
        StringBuilder sb = new StringBuilder();
        try (FileInputStream fis = new FileInputStream(f);
             InputStreamReader isr = new InputStreamReader(fis, StandardCharsets.UTF_8);
             BufferedReader br = new BufferedReader(isr)) {
            String line;
            while ((line = br.readLine()) != null) {
                sb.append(line);
            }
            return sb.toString();
        } catch (Exception ignored) {
            return null;
        }
    }
}
