import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  // appId باید یکتا باشد؛ فرمت معکوس دامنه (reverse-DNS). قبل از انتشار در
  // App Store / Google Play این مقدار را با دامنه‌ی واقعی خودت جایگزین کن.
  appId: "com.routino.app",
  appName: "Routino",
  // خروجی بیلد SPA که vite.mobile.config.ts می‌سازد
  webDir: "www",
  server: {
    androidScheme: "https",
  },
  android: {
    // targetSdk 35 makes edge-to-edge mandatory on Android 15. Capacitor owns
    // the WebView margins here, so CSS safe-area rules remain zero on Android
    // and cannot double-pad app content.
    adjustMarginsForEdgeToEdge: "force",
  },
  plugins: {
    LocalNotifications: {
      smallIcon: "ic_stat_routino",
      iconColor: "#F97316",
    },
    SplashScreen: {
      launchShowDuration: 300,
      backgroundColor: "#ffffffff",
    },
  },
};

export default config;
