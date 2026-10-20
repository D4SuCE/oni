import { AlertTriangle, FileText, Home, RotateCw } from 'lucide-react';
import { Component, type ReactNode } from 'react';
import { useT } from '../i18n.ts';
import { navigate } from '../store.ts';
import { logError } from '../ui/log.ts';

interface Props {
  /** 'screen' replaces the whole window, 'view' replaces one page and keeps the shell. */
  kind: 'screen' | 'view';
  children: ReactNode;
}

/**
 * Without a boundary React 19 unmounts the whole tree on a render error,
 * which leaves nothing but an empty see-through window.
 */
export class ErrorBoundary extends Component<Props, { error: unknown }> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown) {
    logError(this.props.kind === 'screen' ? 'react' : 'view', error);
  }

  render() {
    if (this.state.error === null) return this.props.children;
    const reset = () => this.setState({ error: null });
    return this.props.kind === 'screen' ? <CrashScreen error={this.state.error} /> : <ViewError error={this.state.error} onRetry={reset} />;
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function LogButton() {
  const t = useT();
  if (!window.wave?.openLogs) return null;
  return (
    <button className="btn ghost" onClick={() => window.wave?.openLogs?.()}>
      <FileText size={16} /> {t.errors.openLog}
    </button>
  );
}

function CrashScreen({ error }: { error: unknown }) {
  const t = useT();
  return (
    <div className="crash">
      <div className="main-drag drag" />
      <div className="crash-card glass">
        <AlertTriangle size={30} className="crash-icon" />
        <h2>{t.errors.title}</h2>
        <p className="muted">{t.errors.screenHint}</p>
        <pre className="crash-details">{message(error)}</pre>
        <div className="crash-actions">
          <button className="btn primary" onClick={() => location.reload()}>
            <RotateCw size={16} /> {t.errors.reload}
          </button>
          <LogButton />
        </div>
      </div>
    </div>
  );
}

function ViewError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useT();
  return (
    <div className="page">
      <div className="crash-card glass inline">
        <AlertTriangle size={26} className="crash-icon" />
        <h2>{t.errors.viewTitle}</h2>
        <pre className="crash-details">{message(error)}</pre>
        <div className="crash-actions">
          <button className="btn primary" onClick={onRetry}>
            <RotateCw size={16} /> {t.common.retry}
          </button>
          <button className="btn glass-btn" onClick={() => navigate({ name: 'home' })}>
            <Home size={16} /> {t.errors.home}
          </button>
          <LogButton />
        </div>
      </div>
    </div>
  );
}
