// The account's other devices in the player (sync/elsewhere.ts): a button lists them with what plays
// there; picked, this one is its remote. Shown only once Yandex Disk is connected and another device
// has been seen.

import { Check, MonitorSmartphone } from 'lucide-react';
import { artistNames } from '../api/yandex.ts';
import { useT } from '../i18n.ts';
import { control, deviceName, leave, useElsewhere } from '../sync/elsewhere.ts';
import { cx } from '../ui/util.ts';
import { openMenu, type MenuItem } from './Menu.tsx';

export function DevicesButton({ size = 18 }: { size?: number }) {
  const t = useT();
  const devices = useElsewhere((s) => s.devices);
  const controlling = useElsewhere((s) => s.controlling);
  if (!devices.length) return null;
  const e = t.elsewhere;
  const items = (): MenuItem[] => [
    controlling
      ? { label: e.playHere, onClick: () => leave('here') }
      : { label: e.here, icon: <Check size={16} /> },
    ...devices.map((d) => ({
      label: e.item(deviceName(d.device), d.track ? `${artistNames(d.track)} — ${d.track.title}${d.live ? '' : ` (${e.paused})`}` : e.nothing),
      icon: controlling?.id === d.device.id ? <Check size={16} /> : undefined,
      onClick: () => controlling?.id !== d.device.id && control(d.device),
    })),
  ];
  return (
    <button className={cx('icon-btn', controlling && 'on')} onClick={(ev) => openMenu(ev, items())} title={e.title} data-testid="devices">
      <MonitorSmartphone size={size} />
    </button>
  );
}

/** "Playing on PC", under the track, while this device is a remote. */
export function PlayingOn({ className }: { className?: string }) {
  const t = useT();
  const controlling = useElsewhere((s) => s.controlling);
  if (!controlling) return null;
  return (
    <div className={cx('playing-on', className)} data-testid="playing-on">
      <MonitorSmartphone size={12} /> {t.elsewhere.playingOn(deviceName(controlling))}
    </div>
  );
}
