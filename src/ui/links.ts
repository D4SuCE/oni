// Links into the app: oni://search?text=… opens Search with that query, the way iPhone
// Shortcuts open yandexmusic://search?text=… in Yandex's own app (swap the prefix, keep the rest).
// iOS only for now: the scheme is declared in ios/App/App/Info.plist.

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

/** Listens for links while running and takes the one the app was launched with. The store is
 * loaded here, not at the top, so the parser above stays testable on its own (tests/links.test.ts). */
export async function connectLinks() {
  const { Capacitor } = await import('@capacitor/core');
  if (Capacitor.getPlatform() !== 'ios') return;
  const [{ App }, { navigate, useApp }] = await Promise.all([import('@capacitor/app'), import('../store.ts')]);
  const open = (link: string) => {
    const query = searchFromLink(link);
    if (query === null) return;
    useApp.setState({ searchQuery: query });
    navigate({ name: 'search' });
  };
  App.addListener('appUrlOpen', ({ url }) => open(url));
  const launch = await App.getLaunchUrl();
  if (launch?.url) open(launch.url);
}
