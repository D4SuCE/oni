// Keeps the desktop shell (taskbar thumbnail buttons, tray menu, window title)
// in step with the player, and runs the commands those buttons send back.

import type { ShellPlayback } from '../api/transport.ts';
import { artistNames } from '../api/yandex.ts';
import { tr, useLang } from '../i18n.ts';
import { historyStep } from '../store.ts';
import { next, prev, toggle, usePlayer } from './player.ts';

function snapshot(): ShellPlayback {
  const s = usePlayer.getState();
  const t = s.queue[s.index];
  const l = tr();
  return {
    hasTrack: Boolean(t),
    playing: s.playing,
    title: t?.title ?? '',
    artist: t ? artistNames(t) : '',
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
    else if (cmd === 'back' || cmd === 'forward') historyStep(cmd);
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
  push();
}
