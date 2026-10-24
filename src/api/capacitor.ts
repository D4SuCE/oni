// The iOS shell (Capacitor): what electron/main.cjs and preload.cjs do on the desktop.
// Requests go through the native HTTP stack (no CORS in the way), the OAuth token lives in
// the Keychain (the OniKeychain plugin in ios/App/App), and sign-in runs in the app's own browser
// sheet (OniLogin) that catches the redirect carrying the token, as the desktop sign-in window does.

import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { fromBase64, toBase64 } from './bytes.ts';
import type { HttpRequest, HttpResponse, Transport } from './transport.ts';

interface KeychainPlugin {
  /** { value } when stored, {} when not. */
  get(options: { key: string }): Promise<{ value?: string }>;
  set(options: { key: string; value: string | null }): Promise<void>;
}

const Keychain = registerPlugin<KeychainPlugin>('OniKeychain');

interface LoginPlugin {
  /** Opens the sign-in page; { token } from the redirect, {} when closed without one. */
  open(options: { url: string; lang?: string }): Promise<{ token?: string }>;
}

/** Native, not @capacitor/inappbrowser: that one let iOS hand the redirect to Yandex's own app. */
export const OniLogin = registerPlugin<LoginPlugin>('OniLogin');

const TOKEN_KEY = 'yandex-oauth-token';
const DISK_TOKEN_KEY = 'yandex-disk-token';
/** Oni's own app at oauth.yandex.ru: only its folder on Yandex Disk (the shared history), as on the desktop. */
const DISK_CLIENT_ID = 'e3a9ad75307d4369a7b9250d0be40af2';
const OAUTH_CLIENT_ID = '23cabbbdc6cd418abb4b39c32c41195d'; // official Yandex Music client, as on the desktop
const DEFAULT_CLIENT = 'YandexMusicAndroid/24023621';
/** Downloaded tracks: Library/offline, kept by iOS (Caches could be purged when space runs low). */
const OFFLINE = { dir: 'offline', directory: Directory.Library };
const offlinePath = (name: string) => `${OFFLINE.dir}/${name}`;
const asBytes = (data: string | ArrayBuffer | Blob) => (typeof data === 'string' ? fromBase64(data).buffer : data);

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
  let diskToken: string | null | undefined;
  const loadDiskToken = async () => {
    if (diskToken === undefined) diskToken = (await Keychain.get({ key: DISK_TOKEN_KEY }).catch(() => ({ value: undefined }))).value ?? null;
    return diskToken;
  };
  const saveDiskToken = async (value: string | null) => {
    diskToken = value;
    await Keychain.set({ key: DISK_TOKEN_KEY, value });
  };

  return {
    platform: 'ios',
    // Set by the Debug build for the simulator runs in CI (ios/App/App/OniBridge.swift).
    testMode: Boolean((window as { __oniTest?: boolean }).__oniTest),
    canAnalyzeAudio: false,
    canUpload: true,

    files: {
      async write(name, data) {
        await Filesystem.writeFile({ path: offlinePath(name), data: toBase64(new Uint8Array(data)), directory: OFFLINE.directory, recursive: true });
      },
      async read(name) {
        const { data } = await Filesystem.readFile({ path: offlinePath(name), directory: OFFLINE.directory });
        return asBytes(data as string) as ArrayBuffer;
      },
      async remove(name) {
        await Filesystem.deleteFile({ path: offlinePath(name), directory: OFFLINE.directory }).catch(() => {});
      },
      async list() {
        const r = await Filesystem.readdir({ path: OFFLINE.dir, directory: OFFLINE.directory }).catch(() => ({ files: [] }));
        return r.files.map((f) => ({ name: f.name, size: f.size }));
      },
    },

    async fetchBytes(url) {
      const r = await CapacitorHttp.request({ url, method: 'GET', responseType: 'arraybuffer' });
      if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status}`);
      return asBytes(r.data) as ArrayBuffer;
    },

    async request<T = any>(req: HttpRequest): Promise<HttpResponse<T>> {
      const url = new URL(req.url);
      for (const [k, v] of Object.entries(req.query || {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      const headers: Record<string, string> = { ...req.headers };
      if (needsAuth(url)) {
        const t = await loadToken();
        if (t) headers.Authorization = `OAuth ${t}`;
        headers['X-Yandex-Music-Client'] ??= DEFAULT_CLIENT;
      } else if (url.hostname === 'cloud-api.yandex.net') {
        const t = await loadDiskToken();
        if (t) headers.Authorization = `OAuth ${t}`;
      }
      let data: unknown;
      let dataType: 'formData' | undefined;
      if (req.multipart) {
        // An upload (your own mp3): the native side builds the multipart body from base64.
        const { field, filename, contentType, data: bytes } = req.multipart;
        data = [{ key: field, value: toBase64(new Uint8Array(bytes)), type: 'base64File', fileName: filename, contentType }];
        dataType = 'formData';
        headers['Content-Type'] = 'multipart/form-data';
      } else if (req.form) {
        data = new URLSearchParams(Object.entries(req.form).map(([k, v]) => [k, String(v)])).toString();
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      } else if (req.json !== undefined) {
        data = req.json;
        headers['Content-Type'] = 'application/json';
      } else if (req.body !== undefined) {
        data = req.body;
      }
      const resp = await CapacitorHttp.request({
        url: url.href,
        method: req.method || (data !== undefined ? 'POST' : 'GET'),
        headers,
        data,
        dataType,
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

    hasDiskToken: async () => Boolean(await loadDiskToken()),
    setDiskToken: (value) => saveDiskToken(value),
    async diskLogin(lang) {
      try {
        const { token: found } = await OniLogin.open({ url: `https://oauth.yandex.ru/authorize?response_type=token&client_id=${DISK_CLIENT_ID}`, lang });
        if (!found) return false;
        await saveDiskToken(found);
        return true;
      } catch {
        return false;
      }
    },

    async login(lang) {
      try {
        const { token: found } = await OniLogin.open({
          url: `https://oauth.yandex.ru/authorize?response_type=token&client_id=${OAUTH_CLIENT_ID}`,
          lang,
        });
        if (!found) return false;
        await saveToken(found);
        return true;
      } catch {
        return false;
      }
    },

    log(level, source, message) {
      (level === 'error' ? console.error : level === 'warn' ? console.warn : console.info)(`[${source}] ${message}`);
    },
  };
}
