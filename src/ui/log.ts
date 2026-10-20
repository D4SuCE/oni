// Errors go to the console and, in Electron, to userData/logs/wave.log.

export function errorDetails(e: unknown) {
  if (e instanceof Error) return e.stack || `${e.name}: ${e.message}`;
  return typeof e === 'string' ? e : JSON.stringify(e);
}

export function logError(source: string, e: unknown) {
  console.error(`[${source}]`, e);
  try {
    window.wave?.log?.('error', source, errorDetails(e));
  } catch {
    /* logging must never throw */
  }
}

/** Catches what React error boundaries can't: event handlers, timers, promises. */
export function installGlobalErrorLogging() {
  window.addEventListener('error', (e) => logError('window', e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => logError('promise', e.reason));
}
