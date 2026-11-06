// One step of an end-to-end run (tests/e2e/harness.mjs, desktop.mjs, update.mjs, login.mjs,
// offline.mjs). A failed step gets a second try at once: on GitHub's machines a step failed now and
// then on code nobody had touched (a slow CDN, a busy Disk, a late frame), and the whole run of
// ~10 minutes was started again for it, five times in a row once (5.11.2026). A step that passes on
// the second try is "unsteady": it is printed, and on GitHub shown as a warning, but does not fail
// the run; a step that fails twice does. The unsteady ones are for fixing, not for forgetting
// (ROADMAP, «Неустойчивые шаги»).
import fs from 'node:fs';

/** E2E_ONLY=<regex>: only the main run's steps it matches (tests/e2e/; the other scripts are short
 * and their steps build on each other, they run whole). */
const ONLY = process.env.E2E_ONLY ? new RegExp(process.env.E2E_ONLY, 'i') : null;

/** A broken connection to Yandex or Disk, not the app: told so on the second try. Disk also answers
 * 404 for a file just written now and then, and 5xx when busy. */
const NETWORK = /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|Yandex Disk: no answer|Yandex Disk[^:]*: HTTP (404|5\d\d)|net::ERR_/i;

/** @param {{ suite: string, filter?: boolean, recover?: () => Promise<void>, onFail?: (name: string) => Promise<void> }} o
 * filter: E2E_ONLY applies; recover: after a failed try (menus left open closed, and the like);
 * onFail: after the last one (a screenshot). */
export function steps({ suite, filter = false, recover = async () => {}, onFail = async () => {} }) {
  const only = filter ? ONLY : null;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const unsteady = [];
  const failures = [];

  /** @param {{ always?: boolean }} [o] always: run even under E2E_ONLY (later steps need it). */
  async function step(name, fn, { always = false } = {}) {
    if (only && !always && !only.test(name)) return void skipped++;
    let first = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await fn();
        passed++;
        if (attempt === 1) console.log(`  ok   ${name}`);
        else {
          unsteady.push({ name, why: first });
          console.log(`  ok   ${name} (on the second try; the first: ${first.split('\n')[0].slice(0, 200)})`);
        }
        return;
      } catch (e) {
        const why = e?.message || String(e);
        if (attempt === 1) {
          first = why;
          console.log(`  ..   ${name}: ${NETWORK.test(why) ? 'the network broke' : 'failed'} (${why.split('\n')[0].slice(0, 160)}), trying again`);
          await recover().catch(() => {});
          await new Promise((r) => setTimeout(r, NETWORK.test(why) ? 5000 : 1500));
          continue;
        }
        failed++;
        failures.push({ name, why });
        console.log(`  FAIL ${name}: ${why}`);
        await onFail(name).catch(() => {});
        await recover().catch(() => {});
      }
    }
  }

  /** The count; on GitHub also warnings and the run's summary page. Returns the exit code. */
  function summary() {
    console.log(`\n${suite}: ${passed} passed, ${failed} failed${unsteady.length ? `, ${unsteady.length} on the second try` : ''}${skipped ? `, ${skipped} skipped (E2E_ONLY)` : ''}.`);
    for (const u of unsteady) console.log(`  unsteady: ${u.name}`);
    if (process.env.GITHUB_ACTIONS) {
      const one = (s) => s.replace(/\s+/g, ' ').slice(0, 300);
      for (const u of unsteady) console.log(`::warning title=e2e: on the second try::${one(u.name)} — ${one(u.why)}`);
      for (const f of failures) console.log(`::error title=e2e: failed twice::${one(f.name)} — ${one(f.why)}`);
      const file = process.env.GITHUB_STEP_SUMMARY;
      if (file && (unsteady.length || failures.length)) {
        const rows = [...failures.map((f) => `| ❌ | ${f.name} | ${one(f.why)} |`), ...unsteady.map((u) => `| ⚠️ | ${u.name} | ${one(u.why)} |`)];
        fs.appendFileSync(file, `\n### ${suite}\n\n| | Шаг | Первая ошибка |\n| --- | --- | --- |\n${rows.map((r) => r.replace(/\n/g, ' ')).join('\n')}\n`);
      }
    }
    return failed ? 1 : 0;
  }

  return { step, summary };
}
