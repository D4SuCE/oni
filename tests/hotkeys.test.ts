// Global hotkeys as Settings records and shows them (src/ui/hotkeys.ts). Run: npm run test:hotkeys
import { accelerator, showAccelerator } from '../src/ui/hotkeys.ts';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e: any) {
    failed++;
    console.log(`  FAIL ${name}: ${e?.stack || e}`);
  }
}
function eq(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
const press = (code: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}) =>
  accelerator({ code, ctrlKey: Boolean(mods.ctrl), altKey: Boolean(mods.alt), shiftKey: Boolean(mods.shift), metaKey: Boolean(mods.meta) });

test('a key with modifiers becomes an accelerator, by its place on the keyboard', () => {
  eq(press('KeyP', { ctrl: true, alt: true }), 'Control+Alt+P');
  eq(press('ArrowRight', { ctrl: true, shift: true }), 'Control+Shift+Right');
  eq(press('Digit5', { alt: true }), 'Alt+5');
  eq(press('Numpad7', { ctrl: true }), 'Control+num7');
  eq(press('Space', { meta: true }), 'Super+Space');
});

test('only modifiers, or a plain letter, is not a key yet', () => {
  eq(press('ControlLeft', { ctrl: true }), null);
  eq(press('KeyA'), null);
  eq(press('KeyA', { shift: true }), null);
  eq(press('Space'), null);
});

test('F keys and media keys may stand alone', () => {
  eq(press('F9'), 'F9');
  eq(press('F13', { shift: true }), 'Shift+F13');
  eq(press('MediaPlayPause'), 'MediaPlayPause');
});

test('shown as people read it', () => {
  eq(showAccelerator('Control+Alt+Right'), 'Ctrl + Alt + →');
  eq(showAccelerator('Control+Alt+Space'), 'Ctrl + Alt + Space');
  eq(showAccelerator('Super+num7'), 'Win + Num 7');
  eq(showAccelerator('MediaPlayPause'), '⏯');
});

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed) process.exit(1);
