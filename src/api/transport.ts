// The platform shell (Electron on Windows, Capacitor on iOS) performs the
// actual HTTP requests and keeps the token; the shared code only describes them.

import { tr } from '../i18n.ts';
import { capacitorTransport, isNativeIos } from './capacitor.ts';

export interface HttpRequest {
  method?: 'GET' | 'POST';
  url: string;
  query?: Record<string, string | number | boolean | undefined>;
  form?: Record<string, string | number>;
  json?: unknown;
  multipart?: { field: string; filename: string; contentType: string; data: ArrayBuffer };
  headers?: Record<string, string>;
  responseType?: 'json' | 'text';
}

export interface HttpResponse<T = any> {
  status: number;
  ok: boolean;
  data: T;
}

export interface Transport {
  platform: string;
  /** Automated test run: don't send listening signals to the real account. */
  testMode?: boolean;
  /**
   * Web Audio may hear the music (equalizer, beat pulse): the desktop shell makes the audio CDN
   * CORS-enabled; on iOS it can't, and a CORS request for the stream would not play at all.
   */
  canAnalyzeAudio?: boolean;
  /** Uploading your own mp3 files into a playlist. */
  canUpload?: boolean;
  /** The app's own folder for downloaded tracks (plain file names, no paths). */
  files?: {
    write(name: string, data: ArrayBuffer): Promise<void>;
    read(name: string): Promise<ArrayBuffer>;
    remove(name: string): Promise<void>;
    list(): Promise<{ name: string; size: number }[]>;
  };
  /** The bytes behind a URL, fetched natively (the audio CDN sends no CORS headers). */
  fetchBytes?(url: string): Promise<ArrayBuffer>;
  /** Tests only: pretend the network is down (true) or back (false). */
  setNetworkForTest?(up: boolean): void;
  request<T = any>(req: HttpRequest): Promise<HttpResponse<T>>;
  hasToken(): Promise<boolean>;
  setToken(value: string | null): Promise<void>;
  /** Sign-in through Yandex; `lang` is the interface language, for the sign-in page. */
  login?(lang?: string): Promise<boolean>;
  /** Appends a line to the app's log file. */
  log?(level: 'error' | 'warn' | 'info', source: string, message: string): void;
  /** Opens the log file in the system's default viewer. */
  openLogs?(): Promise<string>;

  // Desktop shell (taskbar buttons, tray); absent on platforms without one.
  onCommand?(cb: (cmd: ShellCommand) => void): void;
  setPlayback?(state: ShellPlayback): void;
  shellPrefs?(): { closeToTray: boolean; autostart?: boolean; discord?: boolean };
  setCloseToTray?(enabled: boolean): void;
  setAutostart?(enabled: boolean): void;
  /** Discord's status (electron/discord.cjs): on or off, and what plays (null: nothing). */
  setDiscord?(enabled: boolean): void;
  setPresence?(track: Presence | null): void;
  setProgress?(p: ShellProgress): void;
  openMini?(): void;
  // auto-update (installed desktop app)
  updateState?(): UpdateState;
  onUpdate?(cb: (state: UpdateState) => void): void;
  checkUpdate?(): void;
  /** Quits, installs the downloaded version and starts it. */
  installUpdate?(): void;
  openReleases?(): void;
  // the mini player window's side
  miniCommand?(cmd: MiniCommand): void;
  /** Mini player: listeners are set, send the current state. */
  miniReady?(): void;
  onPlayback?(cb: (state: ShellPlayback) => void): void;
  onProgress?(cb: (p: ShellProgress) => void): void;
}

export interface UpdateState {
  /** off: development build; portable: the portable exe, updated by hand. */
  status: 'off' | 'portable' | 'idle' | 'checking' | 'latest' | 'downloading' | 'ready' | 'error';
  version?: string;
  percent?: number;
  error?: string;
  /** The iPhone: the new version's IPA, for SideStore. */
  url?: string;
}

export type MiniCommand = 'toggle' | 'next' | 'prev' | 'like' | 'expand' | 'close';

/** What Discord shows: times in ms epoch (the start, as if played from the top, and the end). */
export interface Presence {
  title: string;
  artists: string;
  album?: string;
  cover?: string;
  url?: string;
  start: number;
  end: number;
}

export interface ShellProgress {
  position: number;
  duration: number;
  playing: boolean;
}

export type ShellCommand = 'toggle' | 'next' | 'prev' | 'like' | 'back' | 'forward';

export interface ShellPlayback {
  hasTrack: boolean;
  playing: boolean;
  title: string;
  artist: string;
  /** For the mini player. */
  cover?: string;
  liked?: boolean;
  /** Localized menu and tooltip labels; the shell has no dictionary of its own. */
  labels: Record<'play' | 'pause' | 'next' | 'prev' | 'show' | 'quit' | 'nothing', string>;
}

declare global {
  interface Window {
    wave?: Transport;
  }
}

export function platformTransport(): Transport {
  if (window.wave) return window.wave;
  if (isNativeIos()) return capacitorTransport();
  throw new Error(tr().errors.noTransport);
}
