// The platform shell (Electron today, Capacitor on iOS later) performs the
// actual HTTP requests and keeps the token; the shared code only describes them.

import { tr } from '../i18n.ts';

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
  request<T = any>(req: HttpRequest): Promise<HttpResponse<T>>;
  hasToken(): Promise<boolean>;
  setToken(value: string | null): Promise<void>;
  login?(): Promise<boolean>;
  /** Appends a line to the app's log file. */
  log?(level: 'error' | 'warn' | 'info', source: string, message: string): void;
  /** Opens the log file in the system's default viewer. */
  openLogs?(): Promise<string>;

  // Desktop shell (taskbar buttons, tray); absent on platforms without one.
  onCommand?(cb: (cmd: ShellCommand) => void): void;
  setPlayback?(state: ShellPlayback): void;
  shellPrefs?(): { closeToTray: boolean };
  setCloseToTray?(enabled: boolean): void;
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
}

export type MiniCommand = 'toggle' | 'next' | 'prev' | 'like' | 'expand' | 'close';

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
  throw new Error(tr().errors.noTransport);
}
