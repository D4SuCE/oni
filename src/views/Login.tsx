import { KeyRound, LogIn } from 'lucide-react';
import { useState } from 'react';
import { transport } from '../api/client.ts';
import { useT } from '../i18n.ts';
import { loginWithToken, loginWithYandex } from '../store.ts';

export function Login() {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const t = useT();
  return (
    <div className="login">
      <div className="login-card glass">
        <span className="logo-mark big" />
        <h1>Oni</h1>
        <p className="muted">{t.login.tagline}</p>
        {transport.login && (
          <button
            className="btn primary big wide"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await loginWithYandex();
              setBusy(false);
            }}
          >
            <LogIn size={18} /> {t.login.withYandex}
          </button>
        )}
        <div className="or">{t.login.orToken}</div>
        <form
          className="token-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!token.trim()) return;
            setBusy(true);
            await loginWithToken(token.trim());
            setBusy(false);
          }}
        >
          <input className="input" type="password" placeholder="y0_AgAAAA…" value={token} onChange={(e) => setToken(e.target.value)} />
          <button className="btn glass-btn" disabled={busy || !token.trim()} title={t.login.orToken}>
            <KeyRound size={16} />
          </button>
        </form>
        <p className="hint login-hint">{t.login.plusHint}</p>
      </div>
    </div>
  );
}
