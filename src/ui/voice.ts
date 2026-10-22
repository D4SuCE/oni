// Siri without "in Oni" (the user's wish): iOS lets an app's own phrases only name the app, and
// only the phone's owner can make a shortcut of any other name. The user's own shortcuts, shared
// through iCloud, are offered here: one tap, and Shortcuts asks before adding it. They run Oni's
// actions of this signing (SideStore's suffix on the bundle id), so they work on the user's own
// Apple ID (a reinstall, a new phone), not on someone else's.

export const VOICE_SHORTCUTS: { phrase: string; link: string }[] = [
  { phrase: 'Лайкни трек', link: 'https://www.icloud.com/shortcuts/578dbb98593248dbb5e1329feb9da16b' },
  { phrase: 'Включи волну', link: 'https://www.icloud.com/shortcuts/406b96b83b9d44dbb79784302c2be754' },
];

/** Opens the shortcut's page in Shortcuts (it asks before adding it). */
export function addVoiceShortcut(link: string) {
  location.href = link;
}
