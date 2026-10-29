// A right click in a text field (Search, a playlist's name, …) on the desktop: Cut, Copy, Paste,
// Select all, in Oni's own menu (the user, 29.10.2026: without a keyboard nothing could be pasted;
// Electron shows no menu of its own). The iPhone has the system's.

import { openMenu } from '../components/Menu.tsx';
import { tr } from '../i18n.ts';

type Action = 'cut' | 'copy' | 'paste' | 'selectAll';

export function connectEditMenu() {
  const shell = (window as unknown as { wave?: { edit?: (a: Action) => void } }).wave;
  if (!shell?.edit) return;
  window.addEventListener('contextmenu', (e) => {
    if (e.defaultPrevented) return; // a menu of its own opened
    const field = (e.target as Element | null)?.closest?.('input, textarea');
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) || field.disabled) return;
    if (field instanceof HTMLInputElement && !/^(text|search|url|email|password|number)?$/.test(field.type)) return;
    const { selectionStart: from, selectionEnd: to } = field;
    const selected = from !== null && to !== null && to > from;
    const writable = !field.readOnly;
    // The menu takes the focus: the field gets it back, with what was selected, before the command.
    const run = (action: Action) => () => {
      field.focus();
      if (from !== null && to !== null) field.setSelectionRange(from, to);
      shell.edit!(action);
    };
    const t = tr().menu;
    openMenu(e, [
      ...(selected && writable ? [{ label: t.cut, onClick: run('cut') }] : []),
      ...(selected ? [{ label: t.copy, onClick: run('copy') }] : []),
      ...(writable ? [{ label: t.paste, onClick: run('paste') }] : []),
      { label: t.selectAll, onClick: run('selectAll') },
    ]);
  });
}
