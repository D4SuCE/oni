// Smoke run for the iOS simulator in CI (.github/workflows/ios.yml). The Debug build signs in
// with the runner's token and sets window.__oniTest; this script then walks the main path and
// prints "SMOKE <step> ok|FAIL" lines, which the workflow reads from the console. Nothing is
// sent to the account: test mode keeps wave feedback and listening reports off.

type Wave = {
  audio: HTMLAudioElement;
  usePlayer: { getState(): { queue: { title: string }[]; index: number } };
};

const wave = () => (window as unknown as { __wave: Wave }).__wave;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(what: () => unknown, timeout: number) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (what()) return true;
    await sleep(250);
  }
  return false;
}

const report = (step: string, ok: boolean, detail = '') => console.log(`SMOKE ${step} ${ok ? 'ok' : 'FAIL'}${detail ? ` ${detail}` : ''}`);
const click = (selector: string) => (document.querySelector(selector) as HTMLElement | null)?.click();

export async function runSmoke() {
  try {
    report('home', await until(() => document.querySelector('.wave-hero'), 30000));
    const mixes = await until(() => document.querySelectorAll('[data-testid="mix-card"]').length, 60000);
    report('mixes', mixes, String(document.querySelectorAll('[data-testid="mix-card"]').length));

    click('[data-testid="wave-play"]');
    const playing = await until(() => !wave().audio.paused && wave().audio.currentTime > 2, 30000);
    const { queue, index } = wave().usePlayer.getState();
    const title = queue[index]?.title ?? '';
    report('playback', playing, `"${title}" at ${wave().audio.currentTime.toFixed(1)} s`);
    // No CORS request for the stream here: the CDN would refuse it and nothing would play.
    report('no-cors-audio', wave().audio.crossOrigin === null);
    report('media-session', navigator.mediaSession?.metadata?.title === title, `"${navigator.mediaSession?.metadata?.title ?? ''}"`);

    click('.pb-cover');
    report('now-playing', await until(() => document.querySelector('.nowplaying'), 5000));
    await sleep(2500);
  } catch (e) {
    report('crash', false, String(e));
  }
  console.log('SMOKE done');
}
