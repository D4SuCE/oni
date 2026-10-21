import { Check, Download, Loader2 } from 'lucide-react';
import type { Track } from '../api/types.ts';
import { useT } from '../i18n.ts';
import { offline } from '../player/player.ts';
import { downloadList, useBatches, useOfflineVersion } from '../ui/offline.ts';

/** "Download" for a whole playlist, album, mix or "Liked": progress while it runs, "Downloaded" after. */
export function DownloadButton({ listKey, tracks }: { listKey: string; tracks: Track[] }) {
  const t = useT().downloads;
  useOfflineVersion((s) => s.v);
  const batch = useBatches((s) => s[listKey]);
  if (!offline || !tracks.length) return null;
  const playable = tracks.filter((x) => x.available !== false);
  const all = playable.length > 0 && playable.every((x) => offline!.has(x.id));
  if (batch)
    return (
      <button className="btn glass-btn busy" disabled data-testid="download-all">
        <Loader2 size={16} className="spin" /> {t.progress(batch.done, batch.total)}
      </button>
    );
  return (
    <button className="btn glass-btn" onClick={() => !all && downloadList(listKey, playable)} disabled={all} data-testid="download-all" data-done={all || undefined}>
      {all ? <Check size={16} /> : <Download size={16} />} {all ? t.done : t.download}
    </button>
  );
}
