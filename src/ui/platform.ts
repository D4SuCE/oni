// The iPhone app (Capacitor). Its taps and layout differ from the desktop's, which stays as it is:
// iOS-only styles hang off html.ios (set in main.tsx).

import { Capacitor } from '@capacitor/core';

export const isIos = Capacitor.getPlatform() === 'ios';
