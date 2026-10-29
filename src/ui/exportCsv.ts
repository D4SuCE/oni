// A playlist or Liked as a CSV file (the user: "all of it", from other clients — docs/other-clients.md;
// the text — csv.ts). On the desktop it is saved as a file; on the iPhone the share sheet takes it
// ("Save to Files", a messenger…).

import type { Track } from '../api/types.ts';
import { transport } from '../api/client.ts';
import { tr } from '../i18n.ts';
import { toast } from '../store.ts';
import { fileName, tracksCsv } from './csv.ts';

/** Saves (the desktop) or shares (the iPhone) the list as a CSV file. */
export async function exportCsv(tracks: Track[], list: string) {
  const file = new File([tracksCsv(tracks, list)], fileName(list), { type: 'text/csv' });
  if (transport.platform === 'ios') {
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: list }).catch(() => {});
    else toast(tr().menu.csvFailed);
    return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
