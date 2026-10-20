import { LogOut } from 'lucide-react';
import { Segmented } from '../components/Wave.tsx';
import { LANGS, setLang, useLang, useT } from '../i18n.ts';
import { setNormalize, usePlayer } from '../player/player.ts';
import { logout, useApp } from '../store.ts';

export function SettingsView() {
  const account = useApp((s) => s.account);
  const normalize = usePlayer((s) => s.normalize);
  const lang = useLang((s) => s.lang);
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
        <h3>{s.playback}</h3>
        <label className="toggle-row">
          <div>
            <div>{s.normalize}</div>
            <div className="hint">{s.normalizeHint}</div>
          </div>
          <input type="checkbox" className="switch" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} />
        </label>
      </div>

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

      <p className="hint center">{s.disclaimer}</p>
    </div>
  );
}
