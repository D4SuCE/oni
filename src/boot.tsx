// The main window: the full app.

import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { useLang } from './i18n.ts';
import { startBeatPulse } from './player/pulse.ts';
import { connectDesktopShell } from './player/shell.ts';
import { installGlobalErrorLogging } from './ui/log.ts';

installGlobalErrorLogging();
connectDesktopShell();
startBeatPulse();
document.documentElement.lang = useLang.getState().lang;

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary kind="screen">
    <App />
  </ErrorBoundary>,
);
