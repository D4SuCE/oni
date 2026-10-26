import { Check, Download, Loader2, X } from 'lucide-react';
import type { Track } from '../api/types.ts';
import { useT } from '../i18n.ts';
import { offline } from '../player/player.ts';
import { background, downloadList, useBatches, useOfflineVersion } from '../ui/offline.ts';
import { isIos } from '../ui/platform.ts';

/** "Download" for a whole playlist, album, mix or "Liked": progress while it runs, "Downloaded" after. */
export function DownloadButton({ listKey, tracks, title }: { listKey: string; tracks: Track[]; title?: string }) {
  const t = useT().downloads;
  useOfflineVersion((s) => s.v);
  const running = useBatches((s) => s[listKey]);
  if (!offline || !tracks.length) return null;
  const playable = tracks.filter((x) => x.available !== false || offline!.has(x.id));
  const all = playable.length > 0 && playable.every((x) => offline!.has(x.id));
  // The iPhone's lists download through iOS in the background, also across app restarts.
  const batch = background?.pendingFor(listKey) ? { done: playable.filter((x) => offline!.has(x.id)).length, total: playable.length } : running;
  // While it runs the button shows how far it is, and a tap cancels it. On the iPhone it stays a
  // round button like its neighbours, a ring filling around a cross (as the App Store's): the
  // count in it ("123 / 1676") pushed "…" off the screen (the user on 1.6.1); the count is in
  // the island and on the lock screen.
  if (batch && isIos) {
    const r = 17;
    const c = 2 * Math.PI * r;
    const p = batch.total ? batch.done / batch.total : 0;
    return (
      <button className="btn glass-btn busy dl-round" onClick={() => downloadList(listKey, playable, title)} aria-label={`${t.cancel}: ${batch.done} / ${batch.total}`} data-testid="download-all" data-progress={p.toFixed(2)}>
        <svg className="dl-ring" viewBox="0 0 42 42">
          <circle cx={21} cy={21} r={r} className="dl-ring-track" />
          <circle cx={21} cy={21} r={r} className="dl-ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - p)} transform="rotate(-90 21 21)" />
        </svg>
        <X size={14} />
      </button>
    );
  }
  if (batch)
    return (
      <button className="btn glass-btn busy" onClick={() => downloadList(listKey, playable, title)} title={t.cancel} data-testid="download-all">
        <Loader2 size={16} className="spin" /> {t.progress(batch.done, batch.total)}
        <X size={15} />
      </button>
    );
  return (
    <button className="btn glass-btn" onClick={() => !all && downloadList(listKey, playable, title)} disabled={all} data-testid="download-all" data-done={all || undefined}>
      {all ? <Check size={16} /> : <Download size={16} />} {all ? t.done : t.download}
    </button>
  );
}
