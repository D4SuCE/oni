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
  let last = -1;
  const read = () =>
    OniVolume.get()
      .then(({ value }) => value !== last && show((last = value)))
      .catch(() => {});
  read();
  OniVolume.addListener('change', ({ value }) => show((last = value)));
  // The volume buttons did not move the slider on the user's phone (1.5.4): while the slider is
  // on screen, the volume is also read twice a second.
  setInterval(() => !document.hidden && document.querySelector('.np-volume') && read(), 500);
}
