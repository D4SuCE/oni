import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { useLang } from './i18n.ts';
import { connectDesktopShell } from './player/shell.ts';
import { installGlobalErrorLogging } from './ui/log.ts';
import './fonts.css';
import './styles.css';

installGlobalErrorLogging();
connectDesktopShell();
document.documentElement.lang = useLang.getState().lang;

// Electron window uses Windows acrylic, so the page itself must stay see-through.
if (window.wave?.platform === 'electron') document.documentElement.classList.add('acrylic');

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary kind="screen">
    <App />
  </ErrorBoundary>,
);
