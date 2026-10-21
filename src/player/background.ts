// The iPhone with the equalizer on (processing.ts): iOS suspends Web Audio when the app goes to
// the background or the screen locks, and the music went on in silence, though the context may
// still call itself running. So the moment the page is hidden, a plain second element, outside
// the graph, takes over the sound from the same place, and the graph is muted (should it go on,
// nothing plays twice); back in the app, the graph has the sound again. The main element keeps
// running and stays in charge: queue, lock screen, the next track all follow it as usual. The
// switch happens at once: a delay let iOS freeze the page first (checked by the user on 1.5.4).

import { audio } from './audio.ts';
import { audioContext, muteGraph } from './eq.ts';

const plain = new Audio();
let covering = false;

function cover() {
  if (covering || audio.paused || !audio.src) return;
  covering = true;
  muteGraph(true);
  plain.src = audio.src;
  plain.currentTime = audio.currentTime;
  plain.play().catch(() => {
    covering = false;
    muteGraph(false);
  });
}

function uncover() {
  if (!covering) return;
  covering = false;
  // If the sleeping graph held the main element still, it picks up where the cover got to.
  if (Math.abs(audio.currentTime - plain.currentTime) > 1) audio.currentTime = plain.currentTime;
  plain.pause();
  plain.removeAttribute('src');
  plain.load();
  muteGraph(false);
}

function wake() {
  const ctx = audioContext();
  if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
}

export function keepSoundInBackground() {
  const session = (navigator as { audioSession?: { type: string } }).audioSession;
  if (session) session.type = 'playback';

  const check = () => {
    if (document.hidden) cover();
    else {
      wake();
      uncover();
    }
  };
  document.addEventListener('visibilitychange', check);
  window.addEventListener('pagehide', cover);

  // While covering, the plain element follows the main one: a new track, a seek, a pause.
  audio.addEventListener('loadeddata', () => {
    if (!covering) return;
    plain.src = audio.src;
    plain.currentTime = audio.currentTime;
    if (!audio.paused) plain.play().catch(() => {});
  });
  audio.addEventListener('seeked', () => covering && Math.abs(plain.currentTime - audio.currentTime) > 1 && (plain.currentTime = audio.currentTime));
  // The cover reached the end: if the main element stood still meanwhile, it ends the track for it,
  // so the player goes on to the next one (a main element that kept up ends it itself).
  plain.addEventListener('ended', () =>
    setTimeout(() => covering && !audio.ended && audio.currentTime < audio.duration - 1 && audio.dispatchEvent(new Event('ended')), 1000),
  );
  audio.addEventListener('pause', () => covering && plain.pause());
  audio.addEventListener('play', () => {
    if (covering) plain.play().catch(() => {});
    else if (document.hidden) cover();
  });
}
