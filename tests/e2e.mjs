// End-to-end UI test: launches the real Electron app against the real API, clicks through the
// main screens, verifies audio actually plays, saves screenshots. The steps are in tests/e2e/,
// by subject, in this order (later steps build on what earlier ones left: a playing wave, …).
// Run: npm run test:e2e   (needs YANDEX_MUSIC_TOKEN; one step: E2E_ONLY=<part of its name>)
import { finish } from './e2e/harness.mjs';

await import('./e2e/01-start.mjs');
await import('./e2e/02-wave.mjs');
await import('./e2e/03-now-playing.mjs');
await import('./e2e/04-recs.mjs');
await import('./e2e/05-tracks.mjs');
await import('./e2e/06-lists.mjs');
await import('./e2e/07-playback.mjs');
await import('./e2e/08-layout.mjs');
await import('./e2e/09-history-sync.mjs');
await import('./e2e/10-recap-ui.mjs');
await import('./e2e/11-import.mjs');
await import('./e2e/12-share.mjs');
await import('./e2e/13-together.mjs');
await finish();
