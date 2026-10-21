// The iPhone's lock screen and Control Center player, run by the OniRemote plugin
// (ios/App/App/OniBridge.swift): WebKit's own showed -10 s / +10 s instead of previous / next and
// had no like. The page tells it what plays; it sends back what the user pressed.

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { artistNames, trackCover } from '../api/yandex.ts';
import { toggleLike, useApp } from '../store.ts';
import { audio, next, prev, seek, toggle, usePlayer } from './player.ts';

interface NowPlaying {
  title: string;
  artist: string;
  album: string;
  artwork?: string;
  duration: number;
  position: number;
  playing: boolean;
  liked: boolean;
}

interface RemotePlugin {
  setNowPlaying(info: NowPlaying): Promise<void>;
  /** For the simulator run: what the system was told and which commands are on. */
  state(): Promise<{ title: string; next: boolean; prev: boolean; skip: boolean; like: boolean }>;
  addListener(event: 'command', cb: (e: { name: string; position?: number }) => void): Promise<PluginListenerHandle>;
}

export const OniRemote = registerPlugin<RemotePlugin>('OniRemote');

const current = () => {
  const s = usePlayer.getState();
  return s.queue[s.index];
};

export function connectRemote() {
  const push = () => {
    const t = current();
    if (!t) return;
    OniRemote.setNowPlaying({
      title: t.title + (t.version ? ` (${t.version})` : ''),
      artist: artistNames(t),
      album: t.albums?.[0]?.title || '',
      artwork: trackCover(t, 400) || undefined,
      duration: Number.isFinite(audio.duration) ? audio.duration : (t.durationMs || 0) / 1000,
      position: audio.currentTime || 0,
      playing: !audio.paused,
      liked: useApp.getState().liked.has(String(t.id)),
    }).catch(() => {});
  };

  OniRemote.addListener('command', ({ name, position }) => {
    const t = current();
    if (name === 'play' && audio.paused) toggle();
    else if (name === 'pause' && !audio.paused) toggle();
    else if (name === 'toggle') toggle();
    else if (name === 'next') next(true);
    else if (name === 'prev') prev();
    else if (name === 'seek' && position !== undefined) seek(position);
    else if (name === 'like' && t) toggleLike(t);
  });

  usePlayer.subscribe((s, was) => {
    if (s.index !== was.index || s.queue[s.index] !== was.queue[was.index] || s.playing !== was.playing) push();
  });
  useApp.subscribe((s, was) => s.liked !== was.liked && push());
  // The system runs the clock between updates from the rate; these keep it honest.
  for (const event of ['play', 'pause', 'seeked', 'durationchange']) audio.addEventListener(event, push);
}
