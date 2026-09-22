package com.routino.app;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;

import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.net.URI;

@CapacitorPlugin(name = "AndroidUpdate")
public class AndroidUpdatePlugin extends Plugin {
    private static final String APK_URL = "https://routino.me/downloads/routino-android-1.0.apk";
    private static final String APK_NAME = "routino-update.apk";
    private static final String PREFS = "routino_android_update";
    private static final String DOWNLOAD_ID = "download_id";
    private BroadcastReceiver downloadReceiver;

    @Override
    public void load() {
        downloadReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                long completedId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
                if (completedId == storedDownloadId()) installIfComplete(completedId);
            }
        };
        ContextCompat.registerReceiver(
            getContext(), downloadReceiver,
            new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
            ContextCompat.RECEIVER_NOT_EXPORTED);
        long existingId = storedDownloadId();
        if (existingId >= 0) installIfComplete(existingId);
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        long existingId = storedDownloadId();
        if (existingId >= 0) installIfComplete(existingId);
    }

    @Override
    protected void handleOnDestroy() {
        if (downloadReceiver != null) {
            try {
                getContext().unregisterReceiver(downloadReceiver);
            } catch (IllegalArgumentException ignored) {
                // Already detached by Android.
            }
        }
        super.handleOnDestroy();
    }

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        if (!isAllowedUpdateUrl(url)) {
            call.reject("Invalid update URL");
            return;
        }

        long existingId = storedDownloadId();
        if (existingId >= 0) {
            int status = downloadStatus(existingId);
            if (status == DownloadManager.STATUS_PENDING
                || status == DownloadManager.STATUS_RUNNING
                || status == DownloadManager.STATUS_PAUSED) {
                call.resolve();
                return;
            }
            if (status == DownloadManager.STATUS_SUCCESSFUL) {
                installIfComplete(existingId);
                call.resolve();
                return;
            }
            clearDownloadId();
        }

        File directory = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (directory == null) {
            call.reject("Downloads directory is unavailable");
            return;
        }
        File apk = new File(directory, APK_NAME);
        if (apk.exists() && !apk.delete()) {
            call.reject("Could not replace the previous update file");
            return;
        }

        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(APK_URL))
            .setTitle("به‌روزرسانی روتینو")
            .setDescription("در حال دانلود نسخه جدید")
            .setMimeType("application/vnd.android.package-archive")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationUri(Uri.fromFile(apk));
        DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        try {
            long id = manager.enqueue(request);
            getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putLong(DOWNLOAD_ID, id).apply();
            call.resolve();
        } catch (RuntimeException error) {
            call.reject("Could not start update download", error);
        }
    }

    static boolean isAllowedUpdateUrl(String value) {
        if (value == null) return false;
        try {
            URI uri = URI.create(value);
            return "https".equals(uri.getScheme())
                && "routino.me".equals(uri.getHost())
                && "/downloads/routino-android-1.0.apk".equals(uri.getPath())
                && uri.getQuery() == null
                && uri.getFragment() == null;
        } catch (IllegalArgumentException error) {
            return false;
        }
    }

    private long storedDownloadId() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getLong(DOWNLOAD_ID, -1L);
    }

    private void installIfComplete(long id) {
        DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        int status = downloadStatus(id);
        if (status == DownloadManager.STATUS_FAILED) {
            clearDownloadId();
            return;
        }
        if (status != DownloadManager.STATUS_SUCCESSFUL) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                .setData(Uri.parse("package:" + getContext().getPackageName()))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                getContext().startActivity(settings);
            } catch (RuntimeException ignored) {
                // Keep the completed download so installation can be retried later.
            }
            return;
        }

        File directory = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (directory == null) return;
        File apk = new File(directory, APK_NAME);
        if (!apk.isFile()) return;
        Uri contentUri = FileProvider.getUriForFile(
            getContext(), getContext().getPackageName() + ".fileprovider", apk);
        Intent install = new Intent(Intent.ACTION_VIEW)
            .setDataAndType(contentUri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(install);
            clearDownloadId();
        } catch (RuntimeException ignored) {
            // Keep the completed download so installation can be retried later.
        }
    }

    private int downloadStatus(long id) {
        DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        try (Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(id))) {
            if (!cursor.moveToFirst()) return -1;
            return cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
        } catch (RuntimeException error) {
            return -1;
        }
    }

    private void clearDownloadId() {
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().remove(DOWNLOAD_ID).apply();
    }
}
