// The one audio element everything plays through. Its own module so the player and the
// equalizer (which call each other) both take it without depending on each other's load order.

import { transport } from '../api/client.ts';

export const audio = new Audio();
audio.preload = 'auto';
// CORS mode so Web Audio (the equalizer) can process the stream; the shell adds the header.
// Only where Web Audio may hear the stream (see Transport.canAnalyzeAudio): elsewhere a CORS request would not play.
if (transport.canAnalyzeAudio) audio.crossOrigin = 'anonymous';
