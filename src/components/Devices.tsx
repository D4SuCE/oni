// The account's other devices in the player (sync/elsewhere.ts): a button lists them with what plays
// there; picked, this one is its remote. Shown only once Yandex Disk is connected and another device
// has been seen.

import { Check, MonitorSmartphone } from 'lucide-react';
import { artistNames } from '../api/yandex.ts';
import { useT } from '../i18n.ts';
import { control, deviceName, disconnect, leave, useElsewhere } from '../sync/elsewhere.ts';
import { cx } from '../ui/util.ts';
import { openMenu, type MenuItem } from './Menu.tsx';

export function DevicesButton({ size = 18 }: { size?: number }) {
  const t = useT();
  const devices = useElsewhere((s) => s.devices);
  const controlling = useElsewhere((s) => s.controlling);
  if (!devices.length) return null;
  const e = t.elsewhere;
  // While a remote: let go (the other plays on), or move the music here (the user, 25.10.2026: "Play
  // here" alone was taken for "disconnect", and it paused the PC and played on the phone).
  const items = (): MenuItem[] => [
    ...(controlling
      ? [
          { label: e.disconnect(deviceName(controlling)), onClick: disconnect },
          { label: e.playHere(deviceName(controlling)), onClick: () => leave('here') },
          { label: '', separator: true },
        ]
      : [{ label: e.here, icon: <Check size={16} /> }]),
    ...devices.map((d) => ({
      label: e.item(deviceName(d.device), d.remoteOf ? e.remote : d.track ? `${artistNames(d.track)} — ${d.track.title}${d.live ? '' : ` (${e.paused})`}` : e.nothing),
      icon: controlling?.id === d.device.id ? <Check size={16} /> : undefined,
      // A remote plays nothing to control.
      onClick: () => controlling?.id !== d.device.id && !d.remoteOf && control(d.device),
    })),
  ];
  return (
    <button className={cx('icon-btn', controlling && 'on')} onClick={(ev) => openMenu(ev, items())} title={e.title} data-testid="devices">
      <MonitorSmartphone size={size} />
    </button>
  );
}

/** "Playing on PC", under the track, while this device is a remote; "Controlled from iPhone" while
 * another is this one's (so it is plain who controls whom). */
export function PlayingOn({ className }: { className?: string }) {
  const t = useT();
  const controlling = useElsewhere((s) => s.controlling);
  const remote = useElsewhere((s) => s.remotes[0]);
  if (!controlling && !remote) return null;
  return (
    <div className={cx('playing-on', className)} data-testid="playing-on">
      <MonitorSmartphone size={12} /> {controlling ? t.elsewhere.playingOn(deviceName(controlling)) : t.elsewhere.controlledBy(deviceName(remote!))}
    </div>
  );
}
