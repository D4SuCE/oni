import { Download, ExternalLink, FileText, HardDriveDownload, LogOut, Mic, RefreshCw, Trash2, Undo2 } from 'lucide-react';
import { confirmDialog } from '../components/Dialog.tsx';
import { formatSize, setAutoLikes, useAutoLikes, useOfflineVersion } from '../ui/offline.ts';
import { useEffect, useState } from 'react';
import { Segmented } from '../components/Wave.tsx';
import { LANGS, setLang, useLang, useT } from '../i18n.ts';
import { canAnalyzeAudio } from '../player/eq.ts';
import { offline, recsFeedback, setCrossfade, setNormalize, stats, usePlayer } from '../player/player.ts';
import type { SpaceRules } from '../player/offline.ts';
import { logout, navigate, useApp } from '../store.ts';
import { setMotion, setPulse, useMotion, usePulse } from '../ui/motion.ts';
import { isIos } from '../ui/platform.ts';
import { setPhoneSound, usePhoneSound } from '../player/phoneSound.ts';
import { pushPresence } from '../player/shell.ts';
import { MAX_SEE_THROUGH, setSeeThrough, useSeeThrough } from '../ui/seeThrough.ts';
import { checkIosUpdate, installIosUpdate, installUpdateShortcut, setAutoUpdate, setUpdateViaShortcut, UPDATE_SHORTCUT, useAutoUpdate } from '../ui/iosUpdate.ts';
import { useUpdate } from '../ui/update.ts';
import { addVoiceShortcut, VOICE_SHORTCUTS } from '../ui/voice.ts';
import { cx } from '../ui/util.ts';

export function SettingsView() {
  const account = useApp((s) => s.account);
  const normalize = usePlayer((s) => s.normalize);
  const crossfade = usePlayer((s) => s.crossfade);
  const lang = useLang((s) => s.lang);
  const motion = useMotion((s) => s.enabled);
  const pulse = usePulse((s) => s.enabled);
  const seeThrough = useSeeThrough((s) => s.value);
  const summary = stats.summary(30);
  const [closeToTray, setCloseToTrayState] = useState(() => window.wave?.shellPrefs?.().closeToTray ?? false);
  const [autostart, setAutostartState] = useState(() => window.wave?.shellPrefs?.().autostart ?? false);
  const [discordOn, setDiscordState] = useState(() => window.wave?.shellPrefs?.().discord ?? true);
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
        {(canAnalyzeAudio() || isIos) && (
          <label className="toggle-row">
            <div>
              <div>{s.pulse}</div>
              <div className="hint">{s.pulseHint}</div>
            </div>
            <input type="checkbox" className="switch" checked={pulse} onChange={(e) => setPulse(e.target.checked)} data-testid="pulse" />
          </label>
        )}
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
        <div className="slider-row">
          <div className="slider-head">
            <span>{s.crossfade}</span>
            <span className="slider-value">{crossfade ? s.crossfadeValue(crossfade) : t.common.off}</span>
          </div>
          <input
            type="range"
            className="range"
            min={0}
            max={12}
            step={1}
            value={crossfade}
            style={{ '--p': `${(crossfade / 12) * 100}%` } as React.CSSProperties}
            onChange={(e) => setCrossfade(Number(e.target.value))}
            data-testid="crossfade"
          />
          <div className="hint">{s.crossfadeHint}</div>
        </div>
        {isIos && <PhoneSound />}
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
          {window.wave?.setAutostart && (
            <label className="toggle-row">
              <div>
                <div>{s.autostart}</div>
                <div className="hint">{s.autostartHint}</div>
              </div>
              <input
                type="checkbox"
                className="switch"
                checked={autostart}
                onChange={(e) => {
                  window.wave?.setAutostart?.(e.target.checked);
                  setAutostartState(e.target.checked);
                }}
                data-testid="autostart"
              />
            </label>
          )}
          {window.wave?.setDiscord && (
            <label className="toggle-row">
              <div>
                <div>{s.discord}</div>
                <div className="hint">{s.discordHint}</div>
              </div>
              <input
                type="checkbox"
                className="switch"
                checked={discordOn}
                onChange={(e) => {
                  window.wave?.setDiscord?.(e.target.checked);
                  setDiscordState(e.target.checked);
                  if (e.target.checked) pushPresence(true);
                }}
                data-testid="discord"
              />
            </label>
          )}
        </div>
      )}

      <div className="panel glass">
        <h3>{t.stats.title}</h3>
        <div className="hint stats-hint">{t.stats.hint}</div>
        {summary.length ? (
          <table className="stats-table" data-testid="stats">
            <thead>
              <tr>
                <th>{t.stats.source}</th>
                <th>{t.stats.plays}</th>
                <th>{t.stats.finished}</th>
                <th>{t.stats.skipped}</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((row) => (
                <tr key={row.origin}>
                  <td>{t.stats.origins[row.origin]}</td>
                  <td>{row.plays}</td>
                  <td>
                    <span className="stats-bar" style={{ '--v': `${row.finished * 100}%` } as React.CSSProperties} />
                    {Math.round(row.finished * 100)}%
                  </td>
                  <td>{Math.round(row.skipped * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="hint">{t.stats.empty}</div>
        )}
        <MixFeedback />
      </div>

      {isIos && (
        <div className="panel glass" data-testid="voice-panel">
          <h3>{s.voice}</h3>
          <div className="hint">{s.voiceHint}</div>
          <div className="update-actions voice-actions">
            {VOICE_SHORTCUTS.map((v) => (
              <button key={v.link} className="btn ghost" onClick={() => addVoiceShortcut(v.link)} data-testid="voice-shortcut">
                <Mic size={16} /> {s.voiceAdd(v.phrase)}
              </button>
            ))}
          </div>
        </div>
      )}

      {offline && <DownloadsPanel />}

      {/* A phone has no keyboard shortcuts to show. */}
      {!isIos && (
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
            <kbd>Alt + ← / →</kbd> <span>{s.backForward}</span>
            <kbd>{s.mouseButtons}</kbd> <span>{s.backForward}</span>
          </div>
        </div>
      )}

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
        <UpdateRow />
        {isIos && <AutoUpdateRow />}
      </div>

      <p className="hint center">{s.disclaimer}</p>
    </div>
  );
}

/** How much the downloads take, a way to them and to free the space. */
/** The room rules' choices (Settings → Downloads): a limit in GB, months unplayed. */
const LIMITS_GB = [0, 2, 5, 10, 20];
const FORGET_MONTHS = [0, 1, 3, 6];
const GB = 1024 * 1024 * 1024;

function DownloadsPanel() {
  const t = useT();
  const d = t.downloads;
  useOfflineVersion((v) => v.v);
  const autoLikes = useAutoLikes((s) => s.on);
  const count = offline?.entries().length ?? 0;
  const [rules, setRules] = useState(() => offline?.space() ?? { limit: 0, forgetDays: 0 });
  const used = offline?.totalSize() ?? 0;
  // New rules: what they would remove is asked first, then they apply.
  const apply = async (next: SpaceRules) => {
    if (!offline) return;
    const out = offline.plan(next);
    if (out.length && !(await confirmDialog(d.trimTitle, d.trimMessage(t.count.tracks(out.length), formatSize(out.reduce((n, e) => n + e.size, 0))), d.trimOk))) return;
    await offline.setSpace(next);
    setRules(next);
  };
  return (
    <div className="panel glass">
      <h3>{t.nav.downloads}</h3>
      <div className="settings-row" data-testid="downloads-settings">
        <div>
          <div data-testid="downloads-used">
            {count ? `${t.count.tracks(count)} · ${rules.limit ? d.used(formatSize(used), formatSize(rules.limit)) : formatSize(used)}` : d.none}
          </div>
          {rules.limit > 0 && (
            <div className="space-bar" data-testid="space-bar">
              <i style={{ width: `${Math.min(100, (used / rules.limit) * 100)}%` }} />
            </div>
          )}
          <div className="hint">{d.settingsHint}</div>
        </div>
        <div className="update-actions">
          <button className="btn ghost" onClick={() => navigate({ name: 'library', tab: 'downloads' })}>
            <HardDriveDownload size={16} /> {d.open}
          </button>
          {count > 0 && (
            <button
              className="btn ghost"
              onClick={async () => {
                if (await confirmDialog(d.removeAllTitle, d.removeAllMessage(t.count.tracks(count)), d.removeAll)) await offline?.removeAll();
              }}
              data-testid="downloads-remove-all"
            >
              <Trash2 size={16} /> {d.removeAll}
            </button>
          )}
        </div>
      </div>
      <div className="settings-row space-row" data-testid="space-limit">
        <div>{d.limit}</div>
        <Segmented
          options={LIMITS_GB.map((n) => [String(n), n ? `${n} ${d.gb}` : d.off] as [string, string])}
          value={String(Math.round(rules.limit / GB))}
          onChange={(v) => apply({ ...rules, limit: Number(v) * GB })}
        />
      </div>
      <div className="settings-row space-row" data-testid="space-forget">
        <div>{d.forget}</div>
        <Segmented
          options={FORGET_MONTHS.map((n) => [String(n), n ? d.months(n) : d.off] as [string, string])}
          value={String(Math.round(rules.forgetDays / 30))}
          onChange={(v) => apply({ ...rules, forgetDays: Number(v) * 30 })}
        />
      </div>
      <div className="hint space-hint">{d.spaceHint}</div>
      <label className="toggle-row">
        <div>
          <div>{d.autoLikes}</div>
          <div className="hint">{d.autoLikesHint}</div>
        </div>
        <input type="checkbox" className="switch" checked={autoLikes} onChange={(e) => setAutoLikes(e.target.checked)} data-testid="auto-likes" />
      </label>
    </div>
  );
}

/** Hidden tracks and demoted artists, with a way to bring them all back. */
function MixFeedback() {
  const t = useT().stats;
  const [, refresh] = useState(0);
  useEffect(() => {
    return recsFeedback.subscribe(() => refresh((n) => n + 1));
  }, []);
  const hidden = recsFeedback.hiddenCount();
  const artists = recsFeedback.demotedArtists(Date.now());
  if (!hidden && !artists.length) return null;
  const names = artists.length > 3 ? t.andCount(artists.slice(0, 3).join(', '), artists.length - 3) : artists.join(', ');
  return (
    <div className="settings-row mix-feedback" data-testid="mix-feedback">
      <div className="hint">
        {hidden > 0 && <div>{t.hiddenTracks(hidden)}</div>}
        {artists.length > 0 && <div>{t.demoted(names)}</div>}
      </div>
      <button className="btn ghost" onClick={() => recsFeedback.reset()} data-testid="mix-feedback-reset">
        <Undo2 size={16} /> {t.bringBack}
      </button>
    </div>
  );
}

function UpdateRow() {
  const update = useUpdate();
  const u = useT().update;
  const wave = window.wave;
  if (update.status === 'off') return null;
  const text = {
    portable: u.portable,
    idle: u.idle,
    checking: u.checking,
    latest: u.latest,
    downloading: u.downloading(update.version ?? '', update.percent ?? 0),
    ready: isIos ? u.iosReady(update.version ?? '') : u.ready(update.version ?? ''),
    error: u.error(update.error ?? ''),
  }[update.status];
  return (
    <div className="settings-row update-row" data-testid="update" data-status={update.status}>
      <div className={cx('hint', update.status === 'ready' && 'update-ready')}>{text}</div>
      <div className="update-actions">
        {!isIos && (
          <button className="btn ghost" onClick={() => wave?.openReleases?.()}>
            <ExternalLink size={16} /> {u.releases}
          </button>
        )}
        {update.status === 'ready' ? (
          <button className="btn primary" onClick={() => (isIos ? installIosUpdate() : wave?.installUpdate?.())} data-testid="update-install">
            <Download size={16} /> {isIos ? u.iosInstall : u.install}
          </button>
        ) : (
          update.status !== 'portable' && (
            <button className="btn ghost" disabled={update.status === 'checking' || update.status === 'downloading'} onClick={() => (isIos ? checkIosUpdate() : wave?.checkUpdate?.())} data-testid="update-check">
              <RefreshCw size={16} /> {u.check}
            </button>
          )
        )}
      </div>
    </div>
  );
}

/** The iPhone's volume slider on Now Playing (the phone's own volume, src/player/volume.ts). */
function PhoneSound() {
  const t = useT();
  const s = t.settings;
  const volumeSlider = usePhoneSound((p) => p.volumeSlider);
  return (
    <label className="toggle-row">
      <div>
        <div>{s.volumeSlider}</div>
        <div className="hint">{s.volumeSliderHint}</div>
      </div>
      <input type="checkbox" className="switch" checked={volumeSlider} onChange={(e) => setPhoneSound({ volumeSlider: e.target.checked })} data-testid="volume-slider" />
    </label>
  );
}

/** The iPhone's auto-update and the shortcut it may go through (src/ui/iosUpdate.ts). */
function AutoUpdateRow() {
  const u = useT().update;
  const { on, shortcut } = useAutoUpdate();
  return (
    <>
      <label className="toggle-row">
        <div>
          <div>{u.iosAuto}</div>
          <div className="hint">{u.iosAutoHint}</div>
        </div>
        <input type="checkbox" className="switch" checked={on} onChange={(e) => setAutoUpdate(e.target.checked)} data-testid="auto-update" />
      </label>
      <label className="toggle-row">
        <div>
          <div>{u.iosShortcut(UPDATE_SHORTCUT)}</div>
          <div className="hint">{u.iosShortcutHint}</div>
        </div>
        <input type="checkbox" className="switch" checked={shortcut} onChange={(e) => setUpdateViaShortcut(e.target.checked)} data-testid="update-shortcut" />
      </label>
      {shortcut && (
        <button className="btn ghost" onClick={installUpdateShortcut} data-testid="update-shortcut-install">
          <Download size={16} /> {u.iosShortcutInstall}
        </button>
      )}
    </>
  );
}
