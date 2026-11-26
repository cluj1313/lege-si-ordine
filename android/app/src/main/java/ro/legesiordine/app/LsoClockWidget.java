package ro.legesiordine.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Calendar;
import java.util.Locale;

public class LsoClockWidget extends AppWidgetProvider {

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
            AppWidgetManager mgr = AppWidgetManager.getInstance(context);
            ComponentName cn = new ComponentName(context, LsoClockWidget.class);
            int[] ids = mgr.getAppWidgetIds(cn);
            if (ids != null) {
                for (int id : ids) {
                    updateOneWidget(context, mgr, id);
                }
            }
        }
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateOneWidget(context, appWidgetManager, appWidgetId);
        }
    }

    static void updateOneWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_clock);

        Calendar cal = Calendar.getInstance();
        String hh = String.format(Locale.getDefault(), "%02d", cal.get(Calendar.HOUR_OF_DAY));
        String mm = String.format(Locale.getDefault(), "%02d", cal.get(Calendar.MINUTE));
        String timeText = hh + ":" + mm;

        String dayName = DAYS_RO[cal.get(Calendar.DAY_OF_WEEK)];
        int dayNum = cal.get(Calendar.DAY_OF_MONTH);
        String monthName = MONTHS_RO[cal.get(Calendar.MONTH)];
        int year = cal.get(Calendar.YEAR);
        String dateText = dayName + ", " + dayNum + " " + monthName + " " + year;

        int activeCount = 0;
        String ringColor = "red";
        try {
            String jsonStr = readWidgetStateJson(context);
            if (jsonStr != null && !jsonStr.isEmpty()) {
                JSONObject obj = new JSONObject(jsonStr);
                activeCount = obj.optInt("activeCount", 0);
                ringColor = obj.optString("ringColor", activeCount > 0 ? "green" : "red");
            }
        } catch (Exception ignored) {
        }

        views.setTextViewText(R.id.widget_time, timeText);
        views.setTextViewText(R.id.widget_date, dateText);

        int ringRes = "green".equals(ringColor) ? R.drawable.widget_ring_green : R.drawable.widget_ring_red;
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
        try {
            File f = new File(context.getFilesDir(), "lso_widget_state.json");
            if (f.exists()) {
                byte[] bytes = Files.readAllBytes(f.toPath());
                return new String(bytes, StandardCharsets.UTF_8);
            }
        } catch (Exception ignored) {
        }
        return null;
    }
}
