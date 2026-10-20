import { Check, X } from 'lucide-react';
import { useEffect } from 'react';
import type { StreamQuality } from '../api/yandex.ts';
import { useT } from '../i18n.ts';
import { EQ_BANDS, EQ_PRESETS, EQ_RANGE, applyPreset, setBand, setEqEnabled, setPreamp, useEq, type EqPreset } from '../player/eq.ts';
import { setQuality, usePlayer } from '../player/player.ts';
import { useApp } from '../store.ts';
import { cx } from '../ui/util.ts';

const QUALITIES: StreamQuality[] = ['lossless', 'nq', 'lq'];
const band = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : String(hz));

function EqSlider({ value, onChange, label, testid }: { value: number; onChange: (v: number) => void; label: string; testid?: string }) {
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
          data-testid={testid}
        />
      </div>
      <span className="eq-label">{label}</span>
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
  const close = () => useApp.setState({ soundOpen: false });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="sound-backdrop" onMouseDown={close}>
      <div className="sound-panel glass" onMouseDown={(e) => e.stopPropagation()} data-testid="sound-panel">
        <div className="sound-head">
          <h3>{s.title}</h3>
          <button className="icon-btn" onClick={close} title={t.common.close}>
            <X size={18} />
          </button>
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

        <select className="input sound-preset" value={eq.preset ?? ''} onChange={(e) => e.target.value && applyPreset(e.target.value as EqPreset)} data-testid="eq-preset">
          {eq.preset === null && <option value="">{s.custom}</option>}
          {(Object.keys(EQ_PRESETS) as EqPreset[]).map((p) => (
            <option key={p} value={p}>
              {s.presets[p]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
