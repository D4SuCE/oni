// Entry point for both windows: the main app, or (#mini) the small always-on-top player,
// which is only a remote and must not load the player itself.

import './fonts.css';
import './styles.css';

import { isIos } from './ui/platform.ts';

// Electron windows use Windows acrylic, so the page itself must stay see-through.
if (window.wave?.platform === 'electron') document.documentElement.classList.add('acrylic');
if (isIos) document.documentElement.classList.add('ios');
// Asked by the iPhone's shell when Oni comes back from the background (OniViewController.checkPage):
// a page that shows nothing (or does not answer) is loaded anew instead of staying black.
(window as { __oniAlive?: () => boolean }).__oniAlive = () => (document.getElementById('root')?.childElementCount ?? 0) > 0;

if (location.hash === '#mini') import('./mini/MiniPlayer.tsx').then((m) => m.mountMini());
else import('./boot.tsx');

// iOS simulator runs in CI (Debug builds only set the flag): walk the main path once.
if ((window as { __oniTest?: boolean }).__oniTest) import('./ios-smoke.ts').then((m) => m.runSmoke());
