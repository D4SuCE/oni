// The iPhone's volume slider moves the phone's own volume (OniVolume in
// ios/App/App/OniBridge.swift), and follows the hardware buttons. The player keeps it in its
// `volume` like the desktop's, so the same slider component shows it.

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

interface VolumePlugin {
  get(): Promise<{ value: number }>;
  set(options: { value: number }): Promise<void>;
  addListener(event: 'change', cb: (e: { value: number }) => void): Promise<PluginListenerHandle>;
}

export const OniVolume = registerPlugin<VolumePlugin>('OniVolume');

/** Mirrors the phone's volume into the player state (`show`), now and on every change. */
export function followSystemVolume(show: (value: number) => void) {
  OniVolume.get()
    .then(({ value }) => show(value))
    .catch(() => {});
  OniVolume.addListener('change', ({ value }) => show(value));
}
