// Listening together in the player (src/together/): a button with the room's menu, and "Together · 3"
// under the track while in one. Starting needs Yandex Disk (friends afar are reached through it).

import { Users } from 'lucide-react';
import { useT } from '../i18n.ts';
import { toast } from '../store.ts';
import { inviteLink, leaveTogether, startTogether, useTogether } from '../together/index.ts';
import { share } from '../ui/share.ts';
import { cx } from '../ui/util.ts';
import { openMenu, type MenuItem } from './Menu.tsx';

function invite(title: string) {
  const link = inviteLink();
  if (link) void share({ kind: 'listen', ...link }, title);
}

export function TogetherButton({ size = 18 }: { size?: number }) {
  const t = useT();
  const room = useTogether((s) => s.room);
  const started = useTogether((s) => s.started);
  const people = useTogether((s) => s.people);
  const heard = useTogether((s) => s.heard);
  const link = useTogether((s) => s.link);
  const g = t.together;
  const items = (): MenuItem[] => {
    if (!room)
      return [
        {
          label: g.start,
          icon: <Users size={16} />,
          onClick: async () => {
            await startTogether();
            if (useTogether.getState().room) {
              toast(g.started);
              invite(g.inviteTitle);
            }
          },
        },
      ];
    return [
      ...(people.length ? people.map((p) => ({ label: g.person(p.name, p.near) })) : [{ label: g.alone }]),
      { label: '', separator: true },
      { label: g.invite, onClick: () => invite(g.inviteTitle) },
      // A guest from afar is heard once the one who started opens his own link (together/disk.ts).
      ...(!started && !heard ? [link ? { label: g.sendBack, onClick: () => (toast(g.sendBackHint), invite(g.inviteTitle)) } : { label: g.noDisk }] : []),
      { label: g.leave, danger: true, onClick: () => void leaveTogether().then(() => toast(g.left)) },
    ];
  };
  return (
    <button className={cx('icon-btn', room && 'on')} onClick={(ev) => openMenu(ev, items())} title={g.title} data-testid="together">
      <Users size={size} />
    </button>
  );
}

/** "Together · 3" under the track while in a room. */
export function TogetherBadge({ className }: { className?: string }) {
  const t = useT();
  const room = useTogether((s) => s.room);
  const people = useTogether((s) => s.people.length);
  if (!room) return null;
  return (
    <div className={cx('playing-on', className)} data-testid="together-badge">
      <Users size={12} /> {t.together.badge(people)}
    </div>
  );
}
