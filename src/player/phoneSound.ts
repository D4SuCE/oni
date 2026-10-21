// The iPhone's sound preferences: a slider for the phone's volume on Now Playing (volume.ts).

import { create } from 'zustand';
import { loadJson, storage } from '../api/client.ts';

interface Prefs {
  volumeSlider: boolean;
}

const KEY = 'audio.processing';
export const usePhoneSound = create<Prefs>(() => ({ volumeSlider: loadJson<Prefs>(KEY, { volumeSlider: false }).volumeSlider }));

export function setPhoneSound(patch: Partial<Prefs>) {
  usePhoneSound.setState(patch);
  storage.setItem(KEY, JSON.stringify(usePhoneSound.getState()));
}
