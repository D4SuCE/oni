// Global hotkeys as Settings shows and records them: a pressed key → an Electron accelerator
// ('Control+Alt+Space') and back to what a person reads ('Ctrl + Alt + Space').

export interface KeyPress {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/** By `code`, the key's place: the same on the Russian layout as on the English one. */
const NAMED: Record<string, string> = {
  Space: 'Space',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Insert',
  Delete: 'Delete',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadDecimal: 'numdec',
  MediaPlayPause: 'MediaPlayPause',
  MediaTrackNext: 'MediaNextTrack',
  MediaTrackPrevious: 'MediaPreviousTrack',
  MediaStop: 'MediaStop',
};

function keyOf(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `num${code.slice(6)}`;
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  return NAMED[code] ?? null;
}

/**
 * The accelerator for a key pressed with its modifiers; null while only modifiers are down or for a
 * key no program could share (a letter without Ctrl / Alt / Win would take that letter from typing).
 */
export function accelerator(e: KeyPress): string | null {
  const key = keyOf(e.code);
  if (!key) return null;
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean) as string[];
  const standsAlone = /^F\d+$/.test(key) || key.startsWith('Media');
  if (!standsAlone && !mods.some((m) => m !== 'Shift')) return null;
  return [...mods, key].join('+');
}

const SHOWN: Record<string, string> = {
  Control: 'Ctrl',
  Super: 'Win',
  Left: '←',
  Right: '→',
  Up: '↑',
  Down: '↓',
  MediaPlayPause: '⏯',
  MediaNextTrack: '⏭',
  MediaPreviousTrack: '⏮',
  MediaStop: '⏹',
  numadd: 'Num +',
  numsub: 'Num −',
  nummult: 'Num *',
  numdiv: 'Num /',
  numdec: 'Num .',
};

/** 'Control+Alt+Right' → 'Ctrl + Alt + →'. */
export function showAccelerator(accel: string): string {
  return accel
    .split('+')
    .map((part) => SHOWN[part] ?? (/^num\d$/.test(part) ? `Num ${part.slice(3)}` : part))
    .join(' + ');
}
