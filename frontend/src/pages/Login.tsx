import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { BrandLockup, Field, MtlMark } from '../components/ui';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function LoginPage() {
  const { user, login, loading } = useAuth();
  const loc = useLocation();
  const [nrp, setNrp] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!loading && user) {
    const from = (loc.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== '/login' ? from : '/'} replace />;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await login(nrp.trim(), pw);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Tidak bisa masuk. Coba lagi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <aside className="login__art" aria-hidden="false">
        <svg className="login__slashes" viewBox="0 0 400 420" aria-hidden="true" focusable="false">
          <g fill="none" strokeLinecap="round" strokeWidth="46">
            <path d="M40 330L250 120" stroke="#4fb127" />
            <path d="M120 400L330 190" stroke="#4fb127" opacity=".7" />
            <path d="M220 410l110-110" stroke="#4fb127" opacity=".45" />
          </g>
        </svg>
        <div className="login__brand">
          <BrandLockup reversed height={38} />
          <span className="login__x" aria-hidden="true" />
          <MtlMark height={34} />
        </div>
        <div className="login__title">
          <div className="eyebrow login__eyebrow">Pemeriksaan harian</div>
          <h1>
            P2H
            <br />
            GENSET
          </h1>
          <p>Isi P2H dari HP, pantau semua genset di Binungan, Suaran, Gurimbang, Lati, dan Sambarata dalam satu layar.</p>
        </div>
        <ul className="login__facts">
          <li>
            <b>5</b> site
          </li>
          <li>
            <b>25</b> genset
          </li>
          <li>
            <b>30</b> butir cek
          </li>
        </ul>
      </aside>

      <main className="login__panel">
        <form className="login__form" onSubmit={submit} noValidate>
          <div className="eyebrow">Masuk</div>
          <h2 className="login__h">Selamat datang</h2>
          <p className="muted">Pakai ID karyawan dan password dari admin site.</p>

          {err && (
            <div className="banner banner--stop" role="alert">
              <Icon name="alert" size={18} />
              <div className="grow">{err}</div>
            </div>
          )}

          <Field label="ID karyawan" htmlFor="nrp">
            <input
              id="nrp"
              className="input"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={nrp}
              onChange={(e) => setNrp(e.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field label="Password" htmlFor="pw">
            <div className="input-wrap">
              <input
                id="pw"
                className="input"
                name="password"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                required
              />
              <button type="button" className="input-wrap__btn" onClick={() => setShow((v) => !v)} aria-label={show ? 'Sembunyikan password' : 'Tampilkan password'}>
                <Icon name={show ? 'eyeOff' : 'eye'} size={20} />
              </button>
            </div>
          </Field>

          <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={busy || !nrp.trim() || !pw}>
            {busy ? 'Memeriksa…' : 'Masuk'}
          </button>
          <p className="small muted login__help">Lupa password atau belum punya akun? Hubungi admin P2H di site Anda.</p>
        </form>
        <footer className="login__foot tiny muted">PT Berau Coal · Mutiara Tanjung Lestari</footer>
      </main>
    </div>
  );
}
