import { Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import type { Track } from '../api/types.ts';
import { useT } from '../i18n.ts';
import type { PlayContext } from '../player/player.ts';
import { smartShuffle, useSmartEvery } from '../recs/smartShuffle.ts';

export function SmartShuffleButton({ tracks, title, from }: { tracks: Track[]; title: string; from?: PlayContext }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const every = useSmartEvery((s) => s.every);
  return (
    <button
      className="btn glass-btn"
      disabled={busy || tracks.length < 3}
      title={t.common.smartShuffleHint(every)}
      onClick={async () => {
        setBusy(true);
        try {
          await smartShuffle(tracks, title, from);
        } finally {
          setBusy(false);
        }
      }}
      data-testid="smart-shuffle"
    >
      {busy ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />} {t.common.smartShuffle}
    </button>
  );
}
