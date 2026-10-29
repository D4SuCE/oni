// Links into the app.
// - oni://search?text=… opens Search with that query, the way iPhone Shortcuts open
//   yandexmusic://search?text=… in Yandex's own app (swap the prefix, keep the rest).
// - oni://track/<id> plays the track; oni://album/<id>, oni://artist/<id>, oni://playlist/<owner>/<kind>
//   open the page. "Share" gives the same thing as a web link, https://oni-music.github.io/#track/<id>:
//   that page (site/, the oni-music organization) opens Oni, or Yandex Music on a device without it.
// - A music.yandex.ru link pasted into Search opens the same way.
// The scheme: ios/App/App/Info.plist on the iPhone, electron/main.cjs and "protocols" in package.json on Windows.

/** The web page "Share" links to (site/index.html, published by scripts/publish-site.mjs). */
export const SITE = 'https://oni-music.github.io/';

export type OniLink = { kind: 'track' | 'album' | 'artist'; id: string } | { kind: 'playlist'; owner: string; id: string };

/** The search query of an oni://search link (+ and %20 are spaces), or null for anything else. */
export function searchFromLink(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.protocol !== 'oni:') return null;
  // oni://search?… has "search" as its host; oni:search?… and oni:///search?… as its path.
  const where = (url.host || url.pathname.replace(/^\/+/, '')).toLowerCase();
  if (where !== 'search') return null;
  const text = (url.searchParams.get('text') ?? url.searchParams.get('q') ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
}

/** "track/123", "playlist/login/1005" (what follows oni:// or the page's #) as a link, or null. */
function fromPath(path: string): OniLink | null {
  let parts: string[];
  try {
    parts = path.replace(/^\/+|\/+$/g, '').split('/').map((s) => decodeURIComponent(s));
  } catch {
    return null;
  }
  const [kind, a, b] = parts;
  if ((kind === 'track' || kind === 'album' || kind === 'artist') && /^\d+$/.test(a ?? '') && b === undefined) return { kind, id: a };
  if (kind === 'playlist' && /^[\w.@-]+$/.test(a ?? '') && /^\d+$/.test(b ?? '')) return { kind, owner: a, id: b };
  return null;
}

/** What an Oni link, the Share page's link or a Yandex Music web link points to; null for anything else. */
export function linkFrom(text: string): OniLink | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  // oni://track/1 has "track" as its host; Windows may add a slash at the end.
  if (url.protocol === 'oni:') return fromPath(url.host + url.pathname);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.host === new URL(SITE).host) return fromPath(url.hash.slice(1));
  if (!/^music\.yandex\.(ru|com|by|kz|uz)$/.test(url.host)) return null;
  // music.yandex.ru/album/1/track/2, /track/2, /album/1, /artist/3, /users/<login>/playlists/<kind>
  const p = url.pathname.split('/').filter(Boolean);
  if (p[0] === 'album' && p[2] === 'track') return fromPath(`track/${p[3]}`);
  if (p[0] === 'users' && p[2] === 'playlists') return fromPath(`playlist/${p[1]}/${p[3]}`);
  return fromPath(p.slice(0, 2).join('/'));
}

/** The web link "Share" gives: opens Oni where it is installed, Yandex Music elsewhere. */
export function shareUrl(link: OniLink) {
  return `${SITE}#${link.kind}/${link.kind === 'playlist' ? `${encodeURIComponent(link.owner)}/` : ''}${link.id}`;
}

/** Does what a link says: a track plays (the one link meant to start music), the rest open their page. */
async function openLink(link: OniLink) {
  const [{ navigate, toast }, { api }, { playTracks }, { tr }] = await Promise.all([import('../store.ts'), import('../api/client.ts'), import('../player/player.ts'), import('../i18n.ts')]);
  if (link.kind === 'album') return navigate({ name: 'album', id: link.id });
  if (link.kind === 'artist') return navigate({ name: 'artist', id: link.id });
  if (link.kind === 'playlist') return navigate({ name: 'playlist', uid: link.owner, kind: link.id });
  const [track] = await api.tracks([link.id]).catch(() => []);
  if (!track) return toast(tr().toast.linkBroken);
  playTracks([track], 0, track.title);
}

/** Opens an Oni or Yandex link pasted into Search; false if the text is not one (then it is searched). */
export function openPasted(text: string) {
  const link = linkFrom(text);
  if (link) void openLink(link);
  return Boolean(link);
}

/** Listens for links while running and takes the one the app was launched with: on the iPhone from
 * iOS, on Windows from the second start that a browser makes (electron/main.cjs). A link waits for the
 * sign-in. The store is loaded here, not at the top, so the parsers above stay testable on their own
 * (tests/links.test.ts). */
export async function connectLinks() {
  const { Capacitor } = await import('@capacitor/core');
  const shell = (window as any).wave;
  const ios = Capacitor.getPlatform() === 'ios';
  if (!ios && !shell?.onLink) return;
  const { navigate, useApp } = await import('../store.ts');
  const signedIn = () =>
    new Promise<void>((done) => {
      if (useApp.getState().auth === 'ready') return done();
      const stop = useApp.subscribe((s) => s.auth === 'ready' && (stop(), done()));
    });
  const open = async (url: string) => {
    const query = searchFromLink(url);
    const link = linkFrom(url);
    if (query === null && !link) return;
    await signedIn();
    if (link) return openLink(link);
    useApp.setState({ searchQuery: query! });
    navigate({ name: 'search' });
  };
  if (ios) {
    const { App } = await import('@capacitor/app');
    App.addListener('appUrlOpen', ({ url }) => open(url));
    const launch = await App.getLaunchUrl();
    if (launch?.url) open(launch.url);
    return;
  }
  shell.onLink((url: string) => open(url));
  const launch = await shell.takeLink();
  if (launch) open(launch);
}
