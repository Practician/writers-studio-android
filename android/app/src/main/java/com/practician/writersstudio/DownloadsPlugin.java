package com.practician.writersstudio;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/** Сохраняет созданные приложением DOCX в общую папку Downloads. */
@CapacitorPlugin(name = "WriterStudioDownloads")
public class DownloadsPlugin extends Plugin {
    private static final String DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    @PluginMethod
    public void saveDocx(PluginCall call) {
        final String filename = call.getString("filename");
        final String base64 = call.getString("data");

        if (filename == null || !filename.matches("[A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9 ._()-]{0,180}\\.docx")) {
            call.reject("Некорректное имя Word-файла.");
            return;
        }
        if (base64 == null || base64.isEmpty()) {
            call.reject("Пустой Word-файл нельзя сохранить.");
            return;
        }

        try {
            final byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            final String uri = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                    ? saveWithMediaStore(filename, bytes)
                    : saveLegacy(filename, bytes);
            JSObject result = new JSObject();
            result.put("uri", uri);
            result.put("filename", filename);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Не удалось сохранить Word-файл в Загрузки.", error);
        }
    }

    private String saveWithMediaStore(String filename, byte[] bytes) throws Exception {
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
        values.put(MediaStore.Downloads.MIME_TYPE, DOCX_MIME);
        values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
        values.put(MediaStore.Downloads.IS_PENDING, 1);

        ContentResolver resolver = getContext().getContentResolver();
        Uri uri = resolver.insert(MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values);
        if (uri == null) throw new IllegalStateException("MediaStore не выделил путь в Downloads.");

        try (OutputStream stream = resolver.openOutputStream(uri, "w")) {
            if (stream == null) throw new IllegalStateException("Не удалось открыть поток записи Downloads.");
            stream.write(bytes);
        } catch (Exception error) {
            resolver.delete(uri, null, null);
            throw error;
        }

        values.clear();
        values.put(MediaStore.Downloads.IS_PENDING, 0);
        resolver.update(uri, values, null, null);
        return uri.toString();
    }

    @SuppressWarnings("deprecation")
    private String saveLegacy(String filename, byte[] bytes) throws Exception {
        File downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        if (!downloads.exists() && !downloads.mkdirs()) {
            throw new IllegalStateException("Не удалось создать папку Загрузки.");
        }
        File file = new File(downloads, filename);
        try (FileOutputStream stream = new FileOutputStream(file)) {
            stream.write(bytes);
        }
        return FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file).toString();
    }
}
