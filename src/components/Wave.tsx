import { Loader2, Pause, Play, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api/client.ts';
import { useT } from '../i18n.ts';
import { history, isMyWave, playWave, retuneWave, toggle, usePlayer } from '../player/player.ts';
import { useApp } from '../store.ts';
import { cx, useAsync } from '../ui/util.ts';
import type { Diversity, Language, Mood, WaveTuning } from '../wave/engine.ts';
import { confirmDialog } from './Dialog.tsx';

const DIVERSITY: Diversity[] = ['default', 'favorite', 'discover', 'popular'];
const MOOD: Mood[] = ['all', 'active', 'fun', 'calm', 'sad'];
const LANGUAGE: Language[] = ['any', 'russian', 'not-russian', 'without-words'];

/** Pairs each option with its label from a dictionary record. */
const labeled = <T extends string>(values: T[], labels: Record<T, string>) => values.map((v): [T, string] => [v, labels[v]]);

export function Segmented<T extends string>({ options, value, onChange }: { options: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map(([v, label]) => (
        <button key={v} className={cx(v === value && 'active')} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="toggle-row">
      <div>
        <div>{label}</div>
        {hint && <div className="hint">{hint}</div>}
      </div>
      <input type="checkbox" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Slider({ label, value, min, max, format, onChange }: { label: string; value: number; min: number; max: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <div className="slider-row">
      <div className="slider-head">
        <span>{label}</span>
        <span className="slider-value">{format(value)}</span>
      </div>
      <input
        type="range"
        className="range"
        min={min}
        max={max}
        step={1}
        value={value}
        style={{ '--p': `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function WaveStatsLine() {
  const stats = usePlayer((s) => s.waveStats);
  const t = useT();
  if (!stats) return null;
  const r = stats.rejected;
  const repeats = r.recent + r.overplayed + r.duplicate + r.skipped;
  return (
    <span className="wave-stats" title={t.wave.statsTitle({ received: stats.received, ...r })}>
      {t.wave.statsLine(repeats, stats.received)}
    </span>
  );
}

export function TuningPanel() {
  const tuning = usePlayer((s) => s.tuning);
  const [historySize, setHistorySize] = useState(history.size);
  const contexts = useAsync(() => api.waveContexts(), []);
  const close = () => useApp.setState({ tuningOpen: false });
  const t = useT();
  const w = t.wave;
  const apply = (patch: Partial<WaveTuning>) => {
    retuneWave(patch);
  };

  return (
    <div className="drawer-backdrop" onMouseDown={close}>
      <aside className="drawer glass" onMouseDown={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h2>{w.tuneTitle}</h2>
          <button className="icon-btn" onClick={close} title={t.common.close}>
            <X size={20} />
          </button>
        </div>

        <div className="drawer-group">
          <h3>{w.yandexPicks}</h3>
          <div className="field-label">{w.activity}</div>
          <div className="chips">
            <button className={cx('chip', !tuning.context && 'active')} onClick={() => apply({ context: null })}>
              {w.anyActivity}
            </button>
            {(contexts.data || []).map((c) => (
              <button key={c.tag} className={cx('chip', tuning.context?.tag === c.tag && 'active')} onClick={() => apply({ context: c })}>
                {c.name}
              </button>
            ))}
          </div>
          <div className="field-label">{w.character}</div>
          <Segmented options={labeled(DIVERSITY, w.diversity)} value={tuning.diversity} onChange={(diversity) => apply({ diversity })} />
          <div className="field-label">{w.mood}</div>
          <Segmented options={labeled(MOOD, w.moods)} value={tuning.mood} onChange={(mood) => apply({ mood })} />
          <div className="field-label">{w.language}</div>
          <Segmented options={labeled(LANGUAGE, w.languages)} value={tuning.language} onChange={(language) => apply({ language })} />
        </div>

        <div className="drawer-group">
          <h3>{w.repeatFilter}</h3>
          <p className="hint">{w.repeatFilterHint}</p>
          <Slider
            label={w.noRepeat}
            value={tuning.noRepeatDays}
            min={0}
            max={60}
            format={(v) => (v ? t.count.days(v) : t.common.off)}
            onChange={(noRepeatDays) => apply({ noRepeatDays })}
          />
          <Slider
            label={w.hideOverplayed}
            value={tuning.maxPlays}
            min={0}
            max={20}
            format={(v) => (v ? w.afterPlays(t.count.plays(v)) : t.common.off)}
            onChange={(maxPlays) => apply({ maxPlays })}
          />
          <Slider
            label={w.artistGap}
            value={tuning.artistGap}
            min={0}
            max={10}
            format={(v) => (v ? w.artistGapValue(t.count.tracks(v)) : t.common.off)}
            onChange={(artistGap) => apply({ artistGap })}
          />
          <Toggle checked={tuning.hideSkipped} onChange={(hideSkipped) => apply({ hideSkipped })} label={w.hideSkipped} hint={w.hideSkippedHint} />
          <Toggle checked={tuning.onlyNew} onChange={(onlyNew) => apply({ onlyNew })} label={w.onlyNew} hint={w.onlyNewHint} />
        </div>

        <div className="drawer-group">
          <h3>{w.history}</h3>
          <div className="history-row">
            <span className="hint">{w.historyInfo(t.count.tracks(historySize))}</span>
            <button
              className="btn ghost small"
              onClick={async () => {
                if (await confirmDialog(w.clearHistoryTitle, w.clearHistoryMessage, t.common.clear)) {
                  history.clear();
                  setHistorySize(0);
                }
              }}
            >
              <Trash2 size={14} /> {t.common.clear}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

export function WaveHero() {
  // Only My Wave itself; a track or artist radio is a wave too, but not this one.
  const isWave = usePlayer((s) => isMyWave(s.source));
  const playing = usePlayer((s) => s.playing);
  const busy = usePlayer((s) => s.waveBusy);
  const tuning = usePlayer((s) => s.tuning);
  const active = isWave && playing;
  const t = useT();
  const w = t.wave;
  const desc = [
    tuning.context?.name,
    tuning.diversity !== 'default' && w.diversity[tuning.diversity],
    tuning.mood !== 'all' && w.moods[tuning.mood],
    tuning.language !== 'any' && w.languages[tuning.language],
  ].filter(Boolean);

  return (
    <div className={cx('wave-hero', active && 'active')}>
      <div className="wave-blobs" aria-hidden>
        <i />
        <i />
        <i />
      </div>
      <div className="wave-content">
        <div className="kicker">{w.kicker(tuning.noRepeatDays)}</div>
        <h1>{t.common.myWave}</h1>
        <p className="wave-desc">{desc.length ? desc.join(' · ') : w.tagline}</p>
        <div className="wave-actions">
          <button className="btn primary big" onClick={() => (isWave ? toggle() : playWave())} disabled={busy} data-testid="wave-play">
            {busy ? <Loader2 size={20} className="spin" /> : active ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
            {active ? t.player.pause : isWave ? w.resume : t.common.play}
          </button>
          <button className="btn glass-btn big" onClick={() => useApp.setState({ tuningOpen: true })} data-testid="wave-tune">
            <SlidersHorizontal size={18} /> {w.tune}
          </button>
        </div>
        {isWave && (
          <div className="wave-footer">
            <WaveStatsLine />
          </div>
        )}
      </div>
    </div>
  );
}
