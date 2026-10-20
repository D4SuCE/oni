// Keeps the desktop shell (taskbar thumbnail buttons, tray menu, window title)
// in step with the player, and runs the commands those buttons send back.

import type { ShellPlayback } from '../api/transport.ts';
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
}
