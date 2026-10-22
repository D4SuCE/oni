// Keeps the desktop shell (taskbar thumbnail buttons, tray menu, window title)
// in step with the player, and runs the commands those buttons send back.

import type { Presence, ShellPlayback } from '../api/transport.ts';
import { artistNames, trackCover } from '../api/yandex.ts';
import { tr, useLang } from '../i18n.ts';
import { historyStep, toggleLike, useApp } from '../store.ts';
import { audio, current, next, prev, toggle, usePlayer } from './player.ts';

function snapshot(): ShellPlayback {
  const s = usePlayer.getState();
  const t = s.queue[s.index];
  const l = tr();
  return {
    hasTrack: Boolean(t),
    playing: s.playing,
    title: t?.title ?? '',
    artist: t ? artistNames(t) : '',
    cover: trackCover(t, 200),
    liked: t ? useApp.getState().liked.has(String(t.id)) : false,
    labels: {
      play: l.player.play,
      pause: l.player.pause,
      next: l.settings.nextTrack,
      prev: l.settings.prevTrack,
      show: l.shell.show,
      quit: l.shell.quit,
      nothing: l.player.nothing,
    },
  };
}

export function connectDesktopShell() {
  const shell = window.wave;
  if (!shell?.setPlayback) return;
  shell.onCommand?.((cmd) => {
    if (cmd === 'toggle') toggle();
    else if (cmd === 'next') next(true);
    else if (cmd === 'prev') prev();
    else if (cmd === 'like') {
      const t = current();
      if (t) toggleLike(t);
    } else if (cmd === 'back' || cmd === 'forward') historyStep(cmd);
  });
  // The player store changes several times a second (position); send only real changes.
  let last = '';
  const push = () => {
    const state = snapshot();
    const key = JSON.stringify(state);
    if (key === last) return;
    last = key;
    shell.setPlayback?.(state);
  };
  usePlayer.subscribe(push);
  useLang.subscribe(push);
  useApp.subscribe(push);
  push();

  // Position for the mini player's progress bar: once a second and on every jump.
  const progress = () => shell.setProgress?.({ position: audio.currentTime || 0, duration: usePlayer.getState().duration, playing: !audio.paused });
  setInterval(progress, 1000);
  for (const ev of ['play', 'pause', 'seeked', 'loadedmetadata']) audio.addEventListener(ev, progress);

  // Discord's status: the track playing, from when it would have started; nothing on a pause.
  usePlayer.subscribe((s, was) => (s.index !== was.index || s.queue[s.index] !== was.queue[was.index] || s.playing !== was.playing || s.duration !== was.duration) && pushPresence());
  for (const ev of ['playing', 'pause', 'seeked']) audio.addEventListener(ev, () => pushPresence());
  pushPresence();
}

let presenceKey = '';
/** Tells Discord what plays (`force`: again, as after it was turned back on). */
export function pushPresence(force = false) {
  const shell = window.wave;
  if (!shell?.setPresence) return;
  const s = usePlayer.getState();
  const t = s.queue[s.index];
  let p: Presence | null = null;
  if (t && !audio.paused) {
    const duration = (Number.isFinite(audio.duration) && audio.duration) || s.duration || (t.durationMs || 0) / 1000;
    const start = Date.now() - (audio.currentTime || 0) * 1000;
    const album = t.albums?.[0];
    p = {
      title: t.title + (t.version ? ` (${t.version})` : ''),
      artists: artistNames(t),
      album: album?.title,
      cover: trackCover(t, 400) || undefined,
      url: album ? `https://music.yandex.ru/album/${album.id}/track/${t.id}` : undefined,
      start,
      end: start + duration * 1000,
    };
  }
  // The same track at the same place (start within 2 s): nothing new to say.
  const key = p ? `${p.title}|${p.artists}|${Math.round(p.start / 2000)}|${Math.round(p.end / 2000)}` : '';
  if (key === presenceKey && !force) return;
  presenceKey = key;
  shell.setPresence(p);
}
