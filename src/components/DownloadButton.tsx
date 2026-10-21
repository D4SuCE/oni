import { Check, Download, Loader2, X } from 'lucide-react';
import type { Track } from '../api/types.ts';
import { useT } from '../i18n.ts';
import { offline } from '../player/player.ts';
import { background, downloadList, useBatches, useOfflineVersion } from '../ui/offline.ts';

/** "Download" for a whole playlist, album, mix or "Liked": progress while it runs, "Downloaded" after. */
export function DownloadButton({ listKey, tracks }: { listKey: string; tracks: Track[] }) {
  const t = useT().downloads;
  useOfflineVersion((s) => s.v);
  const running = useBatches((s) => s[listKey]);
  if (!offline || !tracks.length) return null;
  const playable = tracks.filter((x) => x.available !== false);
  const all = playable.length > 0 && playable.every((x) => offline!.has(x.id));
  // The iPhone's lists download through iOS in the background, also across app restarts.
  const batch = background?.pendingFor(listKey) ? { done: playable.filter((x) => offline!.has(x.id)).length, total: playable.length } : running;
  // While it runs the button shows how far it is, and a tap cancels it.
  if (batch)
    return (
      <button className="btn glass-btn busy" onClick={() => downloadList(listKey, playable)} title={t.cancel} data-testid="download-all">
        <Loader2 size={16} className="spin" /> <span className="dl-full">{t.progress(batch.done, batch.total)}</span>
        <span className="dl-short">
          {batch.done} / {batch.total}
        </span>
        <X size={15} />
      </button>
    );
  return (
    <button className="btn glass-btn" onClick={() => !all && downloadList(listKey, playable)} disabled={all} data-testid="download-all" data-done={all || undefined}>
      {all ? <Check size={16} /> : <Download size={16} />} {all ? t.done : t.download}
    </button>
  );
}
