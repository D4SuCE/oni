// Entry point for both windows: the main app, or (#mini) the small always-on-top player,
// which is only a remote and must not load the player itself.

import './fonts.css';
import './styles.css';

// Electron windows use Windows acrylic, so the page itself must stay see-through.
if (window.wave?.platform === 'electron') document.documentElement.classList.add('acrylic');

if (location.hash === '#mini') import('./mini/MiniPlayer.tsx').then((m) => m.mountMini());
else import('./boot.tsx');
