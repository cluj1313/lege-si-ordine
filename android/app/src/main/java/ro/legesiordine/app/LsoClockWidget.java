package ro.legesiordine.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.io.File;
import java.text.DateFormatSymbols;
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

        Typeface oswaldLight = loadOswaldLight(context);
        Bitmap timeBmp = renderTimeBitmap(timeText, oswaldLight, 152f, Color.WHITE);
        views.setImageViewBitmap(R.id.widget_time, timeBmp);
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

    private static Typeface loadOswaldLight(Context context) {
        String[] candidatePaths = new String[]{
                "public/fonts/Oswald-Light.ttf",
                "public/fonts/Oswald[wght].ttf",
                "fonts/Oswald-Light.ttf",
                "fonts/Oswald[wght].ttf"
        };
        for (String assetPath : candidatePaths) {
            try {
                Typeface tf = Typeface.createFromAsset(context.getAssets(), assetPath);
                if (tf != null) {
                    return Typeface.create(tf, 300, false);
                }
            } catch (Exception ignored) {
            }
        }
        return Typeface.create("sans-serif-light", Typeface.NORMAL);
    }

    private static Bitmap renderTimeBitmap(String text, Typeface typeface, float textSizePx, int color) {
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setTypeface(typeface);
        paint.setTextSize(textSizePx);
        paint.setColor(color);
        paint.setLetterSpacing(0.02f);

        Paint.FontMetrics fm = paint.getFontMetrics();
        float width = Math.max(1f, paint.measureText(text) + 12f);
        float height = Math.max(1f, fm.descent - fm.ascent + 8f);

        Bitmap bmp = Bitmap.createBitmap(
                Math.max(1, Math.round(width)),
                Math.max(1, Math.round(height)),
                Bitmap.Config.ARGB_8888
        );
        Canvas canvas = new Canvas(bmp);
        canvas.drawColor(Color.TRANSPARENT);
        canvas.drawText(text, 4f, -fm.ascent + 2f, paint);
        return bmp;
    }

    private static String readWidgetStateJson(Context context) {
        try {
            File f = new File(context.getFilesDir(), "lso_widget_state.json");
            if (f.exists()) {
                byte[] bytes = java.nio.file.Files.readAllBytes(f.toPath());
                return new String(bytes, java.nio.charset.StandardCharsets.UTF_8);
            }
        } catch (Exception ignored) {
        }
        return null;
    }
}
