package com.routino.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(TimerNotificationPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
