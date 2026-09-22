package com.routino.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class AndroidUpdatePluginTest {
    @Test
    public void acceptsOnlyTheFixedHttpsRoutinoApk() {
        assertTrue(AndroidUpdatePlugin.isAllowedUpdateUrl(
            "https://routino.me/downloads/routino-android-1.0.apk"));
        assertFalse(AndroidUpdatePlugin.isAllowedUpdateUrl(
            "http://routino.me/downloads/routino-android-1.0.apk"));
        assertFalse(AndroidUpdatePlugin.isAllowedUpdateUrl(
            "https://evil.example/downloads/routino-android-1.0.apk"));
        assertFalse(AndroidUpdatePlugin.isAllowedUpdateUrl(
            "https://routino.me/downloads/other.apk"));
    }
}
