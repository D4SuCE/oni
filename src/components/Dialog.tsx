import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { tr, useT } from '../i18n.ts';

interface DialogState {
  /** Every dialog mounts fresh, with its own input value. */
  id: number;
  title: string;
  message?: string;
  input?: string;
  confirmLabel: string;
  danger?: boolean;
  resolve: (value: string | null) => void;
}

const useDialog = create<DialogState | null>(() => null);

let seq = 0;
function open(d: Omit<DialogState, 'resolve' | 'id'>) {
  return new Promise<string | null>((resolve) => useDialog.setState({ ...d, id: ++seq, resolve }, true));
}

/** Text input dialog (window.prompt is not available in Electron). */
export function askText(title: string, initial = '', confirmLabel = tr().common.done) {
  return open({ title, input: initial, confirmLabel });
}

export async function confirmDialog(title: string, message: string, confirmLabel = tr().common.delete) {
  return (await open({ title, message, confirmLabel, danger: true })) !== null;
}

export function DialogHost() {
  const d = useDialog();
  return d ? <Dialog key={d.id} d={d} /> : null;
}

function Dialog({ d }: { d: DialogState }) {
  const [value, setValue] = useState(d.input ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const t = useT();

  useEffect(() => {
    setTimeout(() => inputRef.current?.select(), 0);
  }, []);

  const finish = (v: string | null) => {
    useDialog.setState(null, true);
    d.resolve(v);
  };
  const submit = () => {
    if (d.input !== undefined && !value.trim()) return;
    finish(d.input !== undefined ? value.trim() : '');
  };

  return (
    <div className="dialog-backdrop" onMouseDown={() => finish(null)}>
      <form
        className="dialog glass"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onKeyDown={(e) => e.key === 'Escape' && finish(null)}
      >
        <h3>{d.title}</h3>
        {d.message && <p>{d.message}</p>}
        {d.input !== undefined && <input ref={inputRef} className="input" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={() => finish(null)}>
            {t.common.cancel}
          </button>
          <button type="submit" className={d.danger ? 'btn danger' : 'btn primary'} autoFocus={d.input === undefined}>
            {d.confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
