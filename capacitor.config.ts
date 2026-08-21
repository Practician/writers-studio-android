import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.practician.writersstudio',
  appName: 'Writers Studio',
  // Vite bundle копируется в APK. Remote server URL намеренно не задан.
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
};

export default config;
