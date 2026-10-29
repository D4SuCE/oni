// A list of tracks as CSV text (exportCsv.ts saves it). Exportify's columns, so services that move
// playlists, and Oni's own import (src/import), read it; a byte-order mark, so Excel shows Cyrillic.

import type { Track } from '../api/types.ts';

export const HEAD = ['Track Name', 'Artist Name(s)', 'Album Name', 'Duration (ms)', 'Length', 'Playlist', 'Yandex Music URL'];

const cell = (v: string | number) => {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const clock = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The file's text: a header, then a line per track. */
export function tracksCsv(tracks: Track[], list: string): string {
  const lines = tracks.map((t) => {
    const album = t.albums?.[0];
    const title = t.title + (t.version ? ` (${t.version})` : '');
    const ms = t.durationMs || 0;
    const url = album ? `https://music.yandex.ru/album/${album.id}/track/${t.id}` : `https://music.yandex.ru/track/${t.id}`;
    // Several artists with commas, as Exportify writes them (and src/import reads them).
    const artists = (t.artists || []).map((a) => a.name).join(', ');
    return [title, artists, album?.title ?? '', ms || '', ms ? clock(ms) : '', list, url].map(cell).join(',');
  });
  return '﻿' + [HEAD.join(','), ...lines].join('\r\n') + '\r\n';
}

/** A name Windows and iOS take for a file: no \ / : * ? " < > |. */
export const fileName = (list: string) => `${list.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Oni'}.csv`;
