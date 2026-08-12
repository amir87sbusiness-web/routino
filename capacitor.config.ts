import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // appId باید یکتا باشد؛ فرمت معکوس دامنه (reverse-DNS). قبل از انتشار در
  // App Store / Google Play این مقدار را با دامنه‌ی واقعی خودت جایگزین کن.
  appId: 'com.routino.app',
  appName: 'Novino',
  // خروجی بیلد SPA که vite.mobile.config.ts می‌سازد
  webDir: 'www',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_icon_config_sample',
      iconColor: '#488AFF',
    },
    SplashScreen: {
      launchShowDuration: 300,
      backgroundColor: '#ffffffff',
    },
  },
};

export default config;
