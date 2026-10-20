import { FileText, LogOut } from 'lucide-react';
import { useState } from 'react';
import { Segmented } from '../components/Wave.tsx';
import { LANGS, setLang, useLang, useT } from '../i18n.ts';
import { setNormalize, usePlayer } from '../player/player.ts';
import { logout, useApp } from '../store.ts';
import { setMotion, useMotion } from '../ui/motion.ts';
import { MAX_SEE_THROUGH, setSeeThrough, useSeeThrough } from '../ui/seeThrough.ts';

export function SettingsView() {
  const account = useApp((s) => s.account);
  const normalize = usePlayer((s) => s.normalize);
  const lang = useLang((s) => s.lang);
  const motion = useMotion((s) => s.enabled);
  const seeThrough = useSeeThrough((s) => s.value);
  const [closeToTray, setCloseToTrayState] = useState(() => window.wave?.shellPrefs?.().closeToTray ?? false);
  const t = useT();
  const s = t.settings;
  return (
    <div className="page narrow">
      <h1 className="page-title">{t.nav.settings}</h1>

      <div className="panel glass">
        <h3>{s.account}</h3>
        <div className="settings-row">
          <div>
            <div>{account?.displayName}</div>
            <div className="hint">
              {account?.login} · {account?.hasPlus ? s.plusActive : s.noPlus}
            </div>
          </div>
          <button className="btn ghost" onClick={logout}>
            <LogOut size={16} /> {s.logout}
          </button>
        </div>
      </div>

      <div className="panel glass">
        <h3>{s.language}</h3>
        <div className="settings-row">
          <div className="hint">{s.languageHint}</div>
          <Segmented options={LANGS} value={lang} onChange={setLang} />
        </div>
      </div>

      <div className="panel glass">
        <h3>{s.appearance}</h3>
        <label className="toggle-row">
          <div>
            <div>{s.liveCovers}</div>
            <div className="hint">{s.liveCoversHint}</div>
          </div>
          <input type="checkbox" className="switch" checked={motion} onChange={(e) => setMotion(e.target.checked)} data-testid="live-covers" />
        </label>
        {window.wave?.platform === 'electron' && (
          <div className="slider-row">
            <div className="slider-head">
              <span>{s.seeThrough}</span>
              <span className="slider-value">{Math.round(seeThrough * 100)}%</span>
            </div>
            <input
              type="range"
              className="range"
              min={0}
              max={MAX_SEE_THROUGH * 100}
              step={5}
              value={seeThrough * 100}
              style={{ '--p': `${(seeThrough / MAX_SEE_THROUGH) * 100}%` } as React.CSSProperties}
              onChange={(e) => setSeeThrough(Number(e.target.value) / 100)}
              data-testid="see-through"
            />
            <div className="hint">{s.seeThroughHint}</div>
          </div>
        )}
      </div>

      <div className="panel glass">
        <h3>{s.playback}</h3>
        <label className="toggle-row">
          <div>
            <div>{s.normalize}</div>
            <div className="hint">{s.normalizeHint}</div>
          </div>
          <input type="checkbox" className="switch" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} />
        </label>
      </div>

      {window.wave?.setCloseToTray && (
        <div className="panel glass">
          <h3>{s.window}</h3>
          <label className="toggle-row">
            <div>
              <div>{s.closeToTray}</div>
              <div className="hint">{s.closeToTrayHint}</div>
            </div>
            <input
              type="checkbox"
              className="switch"
              checked={closeToTray}
              onChange={(e) => {
                window.wave?.setCloseToTray?.(e.target.checked);
                setCloseToTrayState(e.target.checked);
              }}
              data-testid="close-to-tray"
            />
          </label>
        </div>
      )}

      <div className="panel glass">
        <h3>{s.shortcuts}</h3>
        <div className="keys">
          <kbd>{s.keySpace}</kbd> <span>{s.playPause}</span>
          <kbd>Ctrl + →</kbd> <span>{s.nextTrack}</span>
          <kbd>Ctrl + ←</kbd> <span>{s.prevTrack}</span>
          <kbd>Ctrl + ↑ / ↓</kbd> <span>{s.volume}</span>
          <kbd>Ctrl + L</kbd> <span>{s.like}</span>
          <kbd>Ctrl + F</kbd> <span>{s.search}</span>
          <kbd>Esc</kbd> <span>{s.collapse}</span>
        </div>
      </div>

      <div className="panel glass">
        <h3>{s.about}</h3>
        <div className="settings-row">
          <div>
            <div>{s.version(__APP_VERSION__)}</div>
            <div className="hint">{s.logHint}</div>
          </div>
          {window.wave?.openLogs && (
            <button className="btn ghost" onClick={() => window.wave?.openLogs?.()}>
              <FileText size={16} /> {t.errors.openLog}
            </button>
          )}
        </div>
      </div>

      <p className="hint center">{s.disclaimer}</p>
    </div>
  );
}
