import { Check, ChevronDown, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { StreamQuality } from '../api/yandex.ts';
import { useT } from '../i18n.ts';
import { EQ_BANDS, EQ_PRESETS, EQ_RANGE, applyPreset, canProcessAudio, setBand, setEqEnabled, setPreamp, useEq, type EqPreset } from '../player/eq.ts';
import { setQuality, usePlayer } from '../player/player.ts';
import { useApp } from '../store.ts';
import { cx } from '../ui/util.ts';
import { useSwipeDown } from '../ui/swipe.ts';

const QUALITIES: StreamQuality[] = ['lossless', 'nq', 'lq'];
const band = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : String(hz));

function EqSlider({ value, onChange, label, testid }: { value: number; onChange: (v: number) => void; label: string; testid?: string }) {
  // the red fill runs from the 0 dB line to the knob
  const at = ((value + EQ_RANGE) / (2 * EQ_RANGE)) * 100;
  const fill = { '--from': `${Math.min(50, at)}%`, '--to': `${Math.max(50, at)}%` } as React.CSSProperties;
  return (
    <div className="eq-band">
      <div className="eq-track">
        <input
          type="range"
          className="eq-slider"
          min={-EQ_RANGE}
          max={EQ_RANGE}
          step={0.5}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onDoubleClick={() => onChange(0)}
          title={`${value > 0 ? '+' : ''}${value} dB`}
          style={fill}
          data-testid={testid}
        />
      </div>
      <span className="eq-label">{label}</span>
    </div>
  );
}

/** The preset picker: a pill like the official app's, with a glass list that opens upwards. */
function PresetPicker({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const s = useT().sound;
  const preset = useEq((e) => e.preset);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', away);
    return () => window.removeEventListener('mousedown', away);
  }, [open, setOpen]);
  return (
    <div className="preset-picker" ref={box}>
      <button className={cx('preset-button', open && 'open')} onClick={() => setOpen(!open)} data-testid="eq-preset">
        <span>{preset ? s.presets[preset] : s.custom}</span>
        <ChevronDown size={18} className="preset-chevron" />
      </button>
      {open && (
        <div className="preset-list glass" role="listbox">
          {(Object.keys(EQ_PRESETS) as EqPreset[]).map((p) => (
            <button
              key={p}
              role="option"
              aria-selected={preset === p}
              className={cx('preset-option', preset === p && 'active')}
              onClick={() => {
                applyPreset(p);
                setOpen(false);
              }}
              data-testid={`preset-${p}`}
            >
              <span>{s.presets[p]}</span>
              {preset === p && <Check size={16} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Sound settings (as in the official app): stream quality and a 10-band equalizer. */
export function SoundPanel() {
  const t = useT();
  const s = t.sound;
  const quality = usePlayer((p) => p.quality);
  const stream = usePlayer((p) => p.stream);
  const eq = useEq();
  const [pickerOpen, setPickerOpen] = useState(false);
  const close = useCallback(() => useApp.setState({ soundOpen: false }), []);
  const sheet = useRef<HTMLDivElement>(null);
  const grip = useRef<HTMLDivElement>(null);
  useSwipeDown(sheet, close, grip);
  useEffect(() => {
    // Escape closes the preset list first, then the panel.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (pickerOpen) setPickerOpen(false);
      else close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pickerOpen, close]);

  return (
    <div className="sound-backdrop" onMouseDown={close}>
      <div ref={sheet} className="sound-panel glass" onMouseDown={(e) => e.stopPropagation()} data-testid="sound-panel">
        {/* On the iPhone a sheet from below, dragged down by its top to close (as Tune). */}
        <div ref={grip} className="drawer-grip-zone">
          <div className="drawer-grip" />
          <div className="sound-head">
            <h3>{s.title}</h3>
            <button className="icon-btn" onClick={close} title={t.common.close}>
              <X size={18} />
            </button>
          </div>
        </div>

        {QUALITIES.map((q) => (
          <button key={q} className={cx('sound-quality', quality === q && 'active')} onClick={() => setQuality(q)} data-testid={`quality-${q}`}>
            <span>
              <span className="sound-quality-name">{s.quality[q]}</span>
              <span className="hint">{s.qualityHint[q]}</span>
            </span>
            {quality === q && <Check size={18} />}
          </button>
        ))}
        {stream && <div className="hint sound-now">{s.now(stream.codec, stream.bitrate)}</div>}

        {canProcessAudio() && (
          <>
            <label className="toggle-row sound-eq-toggle">
              <span className="sound-eq-title">{s.equalizer}</span>
              <input type="checkbox" className="switch" checked={eq.enabled} onChange={(e) => setEqEnabled(e.target.checked)} data-testid="eq-toggle" />
            </label>

            <div className={cx('eq-grid', !eq.enabled && 'off')}>
              <div className="eq-scale">
                <span>+{EQ_RANGE} {s.db}</span>
                <span>0 {s.db}</span>
                <span>−{EQ_RANGE} {s.db}</span>
              </div>
              <EqSlider value={eq.preamp} onChange={setPreamp} label={s.level} testid="eq-preamp" />
              <span className="eq-divider" />
              {EQ_BANDS.map((hz, i) => (
                <EqSlider key={hz} value={eq.gains[i] ?? 0} onChange={(v) => setBand(i, v)} label={band(hz)} testid={`eq-band-${i}`} />
              ))}
            </div>

            <PresetPicker open={pickerOpen} setOpen={setPickerOpen} />
          </>
        )}
      </div>
    </div>
  );
}
