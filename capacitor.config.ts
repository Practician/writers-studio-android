import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.practician.writersstudio',
  appName: 'Writers Studio',
  // Vite bundle копируется в APK. Remote server URL намеренно не задан.
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
  // Внешние AI API (включая NVIDIA) не всегда разрешают CORS из capacitor://localhost.
  // Native HTTP передаёт запрос через Android-сетевой стек, не ослабляя HTTPS-ограничения.
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
