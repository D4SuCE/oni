import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { useLang } from './i18n.ts';
import './styles.css';

document.documentElement.lang = useLang.getState().lang;

// Electron window uses Windows acrylic, so the page itself must stay see-through.
if (window.wave?.platform === 'electron') document.documentElement.classList.add('acrylic');

createRoot(document.getElementById('root')!).render(<App />);
