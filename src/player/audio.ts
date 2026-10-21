// The one audio element everything plays through. Its own module so the player and the
// equalizer (which call each other) both take it without depending on each other's load order.
// On the iPhone it is the native player behind an element's surface (nativeAudio.ts).

import { transport } from '../api/client.ts';
import { isIos } from '../ui/platform.ts';
import { NativeAudio } from './nativeAudio.ts';

export const audio: HTMLAudioElement = isIos ? (new NativeAudio() as unknown as HTMLAudioElement) : new Audio();
audio.preload = 'auto';
// CORS mode so Web Audio (the equalizer) can process the stream; the shell adds the header.
// Only where Web Audio may hear the stream (see Transport.canAnalyzeAudio): elsewhere a CORS request would not play.
if (transport.canAnalyzeAudio) audio.crossOrigin = 'anonymous';
