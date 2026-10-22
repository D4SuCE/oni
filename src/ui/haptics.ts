// A light tap of the iPhone's Taptic Engine at the fine moments of a touch (the user's idea): a
// track picked up to be dragged, put down in its new place, a menu opened by a long press.
// navigator.vibrate does nothing on the iPhone, so it is the system's feedback generator
// (OniHaptics in ios/App/App/OniBridge.swift). Nothing on the desktop.

import { registerPlugin } from '@capacitor/core';
import { isIos } from './platform.ts';

/** `pick`: something taken up (a drag, a menu); `drop`: put down; `tick`: a small step. */
export type HapticKind = 'pick' | 'drop' | 'tick';

interface HapticsPlugin {
  tap(options: { kind: HapticKind }): Promise<void>;
}

export const OniHaptics = registerPlugin<HapticsPlugin>('OniHaptics');

export function haptic(kind: HapticKind) {
  if (isIos) OniHaptics.tap({ kind }).catch(() => {});
}
