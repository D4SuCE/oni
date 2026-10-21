// The iOS shell (Capacitor): what electron/main.cjs and preload.cjs do on the desktop.
// Requests go through the native HTTP stack (no CORS in the way), the OAuth token lives in
// the Keychain (the OniKeychain plugin in ios/App/App), and sign-in runs in an in-app browser
// that watches for the redirect carrying the token, as the desktop sign-in window does.

import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
import { DefaultWebViewOptions, InAppBrowser } from '@capacitor/inappbrowser';
import type { HttpRequest, HttpResponse, Transport } from './transport.ts';

interface KeychainPlugin {
  /** { value } when stored, {} when not. */
  get(options: { key: string }): Promise<{ value?: string }>;
  set(options: { key: string; value: string | null }): Promise<void>;
}

const Keychain = registerPlugin<KeychainPlugin>('OniKeychain');

const TOKEN_KEY = 'yandex-oauth-token';
const OAUTH_CLIENT_ID = '23cabbbdc6cd418abb4b39c32c41195d'; // official Yandex Music client, as on the desktop
const DEFAULT_CLIENT = 'YandexMusicAndroid/24023621';

export const isNativeIos = () => Capacitor.getPlatform() === 'ios';

function needsAuth(url: URL) {
  const host = url.hostname;
  return host === 'api.music.yandex.net' || host.endsWith('.music.yandex.net') || host.endsWith('.music.yandex.ru');
}

/** The token from a redirect URL, like the desktop sign-in window reads it. */
export function tokenFromUrl(url: string | undefined): string | null {
  const m = url ? /[#&?]access_token=([^&]+)/.exec(url) : null;
  return m ? decodeURIComponent(m[1]) : null;
}

export function capacitorTransport(): Transport {
  let token: string | null | undefined;
  const loadToken = async () => {
    if (token === undefined) {
      try {
        token = (await Keychain.get({ key: TOKEN_KEY })).value ?? null;
      } catch (e) {
        console.warn('[keychain] read failed', e);
        token = null;
      }
    }
    return token;
  };
  const saveToken = async (value: string | null) => {
    token = value;
    await Keychain.set({ key: TOKEN_KEY, value });
  };

  return {
    platform: 'ios',
    // Set by the Debug build for the simulator runs in CI (ios/App/App/OniBridge.swift).
    testMode: Boolean((window as { __oniTest?: boolean }).__oniTest),
    canAnalyzeAudio: false,
    canUpload: false,

    async request<T = any>(req: HttpRequest): Promise<HttpResponse<T>> {
      if (req.multipart) throw new Error('uploads are not supported on iOS');
      const url = new URL(req.url);
      for (const [k, v] of Object.entries(req.query || {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      const headers: Record<string, string> = { ...req.headers };
      if (needsAuth(url)) {
        const t = await loadToken();
        if (t) headers.Authorization = `OAuth ${t}`;
        headers['X-Yandex-Music-Client'] ??= DEFAULT_CLIENT;
      }
      let data: unknown;
      if (req.form) {
        data = new URLSearchParams(Object.entries(req.form).map(([k, v]) => [k, String(v)])).toString();
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      } else if (req.json !== undefined) {
        data = req.json;
        headers['Content-Type'] = 'application/json';
      }
      const resp = await CapacitorHttp.request({
        url: url.href,
        method: req.method || (data !== undefined ? 'POST' : 'GET'),
        headers,
        data,
        // Parse JSON here, like the desktop: the native side only parses it for JSON content types.
        responseType: 'text',
      });
      let body: any = resp.data;
      if (req.responseType !== 'text' && typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch {
          /* keep text */
        }
      }
      return { status: resp.status, ok: resp.status >= 200 && resp.status < 300, data: body };
    },

    async hasToken() {
      return Boolean(await loadToken());
    },

    setToken: (value) => saveToken(value),

    login() {
      return new Promise<boolean>((resolve) => {
        let done = false;
        const handles: Promise<{ remove: () => Promise<void> }>[] = [];
        const finish = (ok: boolean) => {
          if (done) return;
          done = true;
          for (const h of handles) h.then((x) => x.remove()).catch(() => {});
          resolve(ok);
        };
        handles.push(
          InAppBrowser.addListener('browserPageNavigationCompleted', async ({ url }) => {
            const found = tokenFromUrl(url);
            if (!found || done) return;
            await saveToken(found);
            finish(true);
            InAppBrowser.close().catch(() => {});
          }),
          InAppBrowser.addListener('browserClosed', () => finish(false)),
        );
        InAppBrowser.openInWebView({
          url: `https://oauth.yandex.ru/authorize?response_type=token&client_id=${OAUTH_CLIENT_ID}`,
          options: { ...DefaultWebViewOptions, showURL: false, showNavigationButtons: false, closeButtonText: '✕' },
        }).catch(() => finish(false));
      });
    },

    log(level, source, message) {
      (level === 'error' ? console.error : level === 'warn' ? console.warn : console.info)(`[${source}] ${message}`);
    },
  };
}
