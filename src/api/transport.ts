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
