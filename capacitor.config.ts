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
