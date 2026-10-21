// iOS shell (Capacitor): the same interface as the desktop app, built by Vite into dist/.
// The native project lives in ios/; `npx cap sync ios` copies dist/ and the plugins into it.
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'local.wave.player',
  appName: 'Oni',
  webDir: 'dist',
  ios: {
    // The page draws under the status bar and the home indicator itself (safe-area insets).
    contentInset: 'never',
    backgroundColor: '#090909',
    scheme: 'Oni',
  },
};

export default config;
