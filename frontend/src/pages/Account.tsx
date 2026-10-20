import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { SignaturePad } from '../components/SignaturePad';
import { BrandLockup, Field, PageHead, Segmented, SectionTitle } from '../components/ui';
import { ApiError, api, setToken } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ROLE_LABEL } from '../lib/format';
import { useMeta, usePwaInstall } from '../lib/hooks';
import { disablePush, enablePush, getPushInfo, isIOS, isStandalone, sendTestPush, type PushInfo } from '../lib/push';
import { getThemePref, setThemePref, type ThemePref } from '../lib/theme';
import { useToast } from '../lib/toast';

export default function AccountPage() {
  const { user, logout } = useAuth();
  const meta = useMeta();
  if (!user) return null;
  const site = meta.data?.sites.find((s) => s.id === user.site_id);

  return (
    <div className="page account">
      <PageHead eyebrow="Pengaturan pribadi" title="Akun saya" />

      <section className="card profile">
        <div className="profile__avatar" aria-hidden="true">
          {user.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="profile__main">
          <div className="profile__name">{user.name}</div>
          <div className="muted">
            No SID <span className="mono">{user.nrp}</span> · {ROLE_LABEL[user.role]}
            {user.role === 'admin' ? ' · semua site' : site ? ` · site ${site.name}` : ' · site belum ditentukan'}
          </div>
          <div className="muted small">
            {[user.company, user.job_title].filter(Boolean).join(' · ')}
          </div>
        </div>
        <button type="button" className="btn btn--ghost" onClick={logout}>
          <Icon name="logout" size={18} /> Keluar
        </button>
      </section>

      {user.role === 'admin' && (
        <section className="card">
          <SectionTitle hint="Khusus admin">Kelola</SectionTitle>
          <div className="linkgrid">
            <Link to="/unit" className="linktile">
              <Icon name="bolt" size={22} />
              <b>Unit genset</b>
              <span className="small muted">Tambah / ubah data unit</span>
            </Link>
            <Link to="/admin/pengguna" className="linktile">
              <Icon name="users" size={22} />
              <b>Pengguna</b>
              <span className="small muted">Akun, peran, impor dari Excel</span>
            </Link>
            <Link to="/admin/daftar-cek" className="linktile">
              <Icon name="list" size={22} />
              <b>Daftar cek</b>
              <span className="small muted">Butir pemeriksaan di form</span>
            </Link>
            <Link to="/admin/pengaturan" className="linktile">
              <Icon name="settings" size={22} />
              <b>Pengaturan</b>
              <span className="small muted">Jam shift, aturan tanda tangan</span>
            </Link>
          </div>
        </section>
      )}

      <NotificationCard />
      <InstallCard />
      <SignatureCard />
      <ThemeCard />
      <PasswordCard />

      <p className="small muted account__ver">
        P2H Genset v{meta.data?.version ?? '1.0.0'} · <BrandLockup height={14} /> PT Berau Coal · Mutiara Tanjung Lestari
      </p>
    </div>
  );
}

/* ---------- notifikasi ---------- */

function NotificationCard() {
  const { user, setUser } = useAuth();
  const meta = useMeta();
  const toast = useToast();
  const [info, setInfo] = useState<PushInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => setInfo(await getPushInfo()), []);
  useEffect(() => {
    void load();
  }, [load]);

  const savePrefs = async (mode: 'all' | 'findings', sites: number[] | null) => {
    if (!user) return;
    try {
      await api.put('/api/auth/prefs', { notif_mode: mode, notif_site_ids: sites });
      setUser({ ...user, notif_mode: mode, notif_site_ids: sites });
    } catch (e) {
      toast.push({ title: 'Gagal menyimpan pilihan', body: e instanceof Error ? e.message : undefined, tone: 'danger' });
    }
  };

  const turnOn = async () => {
    setBusy(true);
    try {
      await enablePush();
      toast.push({ title: 'Notifikasi aktif', body: 'HP ini akan diberi tahu saat ada P2H baru atau temuan.', tone: 'ok' });
    } catch (e) {
      toast.push({ title: 'Belum bisa mengaktifkan', body: e instanceof Error ? e.message : undefined, tone: 'danger', ms: 9000 });
    } finally {
      setBusy(false);
      void load();
    }
  };
  const turnOff = async () => {
    setBusy(true);
    try {
      await disablePush();
      toast.push({ title: 'Notifikasi dimatikan di HP ini', tone: 'info' });
    } catch (e) {
      toast.push({ title: 'Gagal mematikan', body: e instanceof Error ? e.message : undefined, tone: 'danger' });
    } finally {
      setBusy(false);
      void load();
    }
  };
  const test = async () => {
    setBusy(true);
    try {
      const r = await sendTestPush();
      toast.push(r.ok ? { title: 'Tes terkirim', body: 'Sebentar lagi muncul di HP ini.', tone: 'ok' } : { title: 'Tes gagal', body: r.reason ?? 'Coba aktifkan ulang notifikasi.', tone: 'warn' });
    } catch (e) {
      toast.push({ title: 'Tes gagal', body: e instanceof Error ? e.message : undefined, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const sitesSel = user?.notif_site_ids ?? null;
  const toggleSite = (id: number) => {
    const all = meta.data?.sites.map((s) => s.id) ?? [];
    const cur = sitesSel ?? all;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    if (next.length === 0) return;
    void savePrefs(user!.notif_mode, next.length === all.length ? null : next);
  };

  return (
    <section className="card">
      <SectionTitle hint="Pemberitahuan muncul di HP walau aplikasi sedang tertutup">Notifikasi di HP</SectionTitle>

      {!info && <div className="muted small">Memeriksa…</div>}

      {info && !info.serverEnabled && (
        <div className="banner banner--warn">
          <Icon name="info" size={18} />
          <div className="grow">Server belum diatur untuk notifikasi HP. Pemberitahuan di dalam aplikasi (ikon lonceng) tetap jalan. Minta admin mengisi kunci VAPID (lihat panduan).</div>
        </div>
      )}

      {info && info.needsInstall && (
        <div className="banner banner--info">
          <Icon name="phone" size={18} />
          <div className="grow">
            <b>iPhone / iPad:</b> notifikasi hanya jalan kalau aplikasi sudah dipasang di Layar Utama. Ikuti langkah di kartu <b>Pasang aplikasi</b> di bawah, lalu buka aplikasi dari ikon di Layar Utama dan kembali ke sini.
          </div>
        </div>
      )}

      {info && !info.supported && !info.needsInstall && (
        <div className="banner banner--warn">
          <Icon name="alert" size={18} />
          <div className="grow">Browser ini belum mendukung notifikasi. Pakai Chrome di Android, atau Safari (iOS 16.4 ke atas) dengan aplikasi dipasang di Layar Utama.</div>
        </div>
      )}

      {info && info.supported && !info.needsInstall && (
        <>
          {info.permission === 'denied' ? (
            <div className="banner banner--stop">
              <Icon name="bellOff" size={18} />
              <div className="grow">
                Notifikasi diblokir untuk aplikasi ini. Buka <b>Pengaturan HP → Notifikasi / Aplikasi → P2H Genset</b>, izinkan notifikasi, lalu buka lagi halaman ini.
              </div>
            </div>
          ) : info.subscribed ? (
            <div className="notifstate notifstate--on">
              <span className="notifstate__dot" aria-hidden="true" />
              <div className="grow">
                <b>Notifikasi aktif di HP ini</b>
                <div className="small muted">Anda akan diberi tahu saat ada P2H baru atau temuan.</div>
              </div>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => void test()} disabled={busy}>
                Kirim tes
              </button>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => void turnOff()} disabled={busy}>
                Matikan
              </button>
            </div>
          ) : (
            <div className="notifstate">
              <span className="notifstate__dot" aria-hidden="true" />
              <div className="grow">
                <b>Notifikasi belum aktif</b>
                <div className="small muted">Tekan tombol, lalu pilih "Izinkan" saat HP bertanya.</div>
              </div>
              <button type="button" className="btn btn--primary" onClick={() => void turnOn()} disabled={busy || !info.serverEnabled}>
                <Icon name="bell" size={18} /> {busy ? 'Memproses…' : 'Aktifkan'}
              </button>
            </div>
          )}
        </>
      )}

      {user && (
        <div className="prefs">
          <Segmented
            label="Jenis pemberitahuan"
            block
            value={user.notif_mode}
            onChange={(v) => void savePrefs(v, sitesSel)}
            options={[
              { value: 'all', label: 'Semua P2H' },
              { value: 'findings', label: 'Hanya temuan' },
            ]}
          />
          <div className="small muted">
            <b>Semua P2H</b>: tiap P2H baru + temuan + STOP. <b>Hanya temuan</b>: hanya kalau ada yang rusak, STOP, atau sudah selesai diperbaiki.
          </div>
          {user.role === 'admin' ? (
          <div className="field">
            <div className="field__label">Site yang diikuti</div>
            <div className="chips chips--wrap">
              {meta.data?.sites.map((s) => {
                const on = sitesSel === null || sitesSel.includes(s.id);
                return (
                  <button key={s.id} type="button" role="checkbox" aria-checked={on} className={`fchip ${on ? 'is-on' : ''}`} onClick={() => toggleSite(s.id)}>
                    {on && <Icon name="check" size={14} stroke={3} />} {s.name}
                  </button>
                );
              })}
            </div>
            <div className="field__hint">Berlaku untuk pemberitahuan di HP dan di ikon lonceng.</div>
          </div>
          ) : (
            <div className="small muted">Anda hanya menerima pemberitahuan dari site {meta.data?.sites[0]?.name ?? 'Anda'}.</div>
          )}
        </div>
      )}
    </section>
  );
}

/* ---------- pasang aplikasi ---------- */

function InstallCard() {
  const { canPrompt, prompt } = usePwaInstall();
  const standalone = isStandalone();
  const ios = isIOS();
  return (
    <section className="card">
      <SectionTitle hint="Supaya terbuka seperti aplikasi biasa, layar penuh, dan bisa menerima notifikasi">Pasang aplikasi</SectionTitle>
      {standalone ? (
        <div className="notifstate notifstate--on">
          <span className="notifstate__dot" aria-hidden="true" />
          <div className="grow">
            <b>Aplikasi sudah terpasang</b>
            <div className="small muted">Anda sedang membuka dari ikon aplikasi.</div>
          </div>
        </div>
      ) : canPrompt ? (
        <button type="button" className="btn btn--primary" onClick={() => void prompt()}>
          <Icon name="download" size={18} /> Pasang di HP ini
        </button>
      ) : ios ? (
        <ol className="steps">
          <li>
            Buka alamat aplikasi ini di <b>Safari</b> (bukan Chrome).
          </li>
          <li>
            Ketuk tombol <b>Bagikan</b> <Icon name="share" size={16} /> di bagian bawah layar.
          </li>
          <li>
            Pilih <b>Tambah ke Layar Utama</b>, lalu ketuk <b>Tambah</b>.
          </li>
          <li>Buka aplikasi dari ikon baru di Layar Utama, masuk, lalu aktifkan notifikasi di kartu atas.</li>
        </ol>
      ) : (
        <ol className="steps">
          <li>
            Buka alamat aplikasi ini di <b>Chrome</b>.
          </li>
          <li>
            Ketuk menu <b>⋮</b> di pojok kanan atas.
          </li>
          <li>
            Pilih <b>Pasang aplikasi</b> (atau <b>Tambahkan ke layar utama</b>).
          </li>
        </ol>
      )}
    </section>
  );
}

/* ---------- tanda tangan tersimpan ---------- */

function SignatureCard() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [png, setPng] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  const save = async (value: string | null) => {
    setBusy(true);
    try {
      await api.put('/api/auth/signature', { signature_png: value });
      setUser({ ...user, signature_png: value, has_signature: !!value });
      setEditing(false);
      setPng(null);
      toast.push({ title: value ? 'Tanda tangan disimpan' : 'Tanda tangan dihapus', tone: 'ok' });
    } catch (e) {
      toast.push({ title: 'Gagal menyimpan', body: e instanceof Error ? e.message : undefined, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <SectionTitle hint="Dipakai otomatis saat mengirim P2H atau menandatangani">Tanda tangan saya</SectionTitle>
      {user.signature_png && !editing ? (
        <>
          <div className="sigprev">
            <img src={user.signature_png} alt="Tanda tangan tersimpan" />
          </div>
          <div className="row">
            <button type="button" className="btn btn--ghost" onClick={() => setEditing(true)}>
              <Icon name="pen" size={16} /> Ganti
            </button>
            <button type="button" className="btn btn--ghost btn--danger-text" onClick={() => void save(null)} disabled={busy}>
              <Icon name="trash" size={16} /> Hapus
            </button>
          </div>
        </>
      ) : (
        <>
          <SignaturePad onChange={setPng} />
          <div className="row">
            <button type="button" className="btn btn--primary" onClick={() => void save(png)} disabled={!png || busy}>
              Simpan tanda tangan
            </button>
            {editing && (
              <button type="button" className="btn btn--ghost" onClick={() => setEditing(false)}>
                Batal
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/* ---------- tampilan ---------- */

function ThemeCard() {
  const [t, setT] = useState<ThemePref>(getThemePref());
  return (
    <section className="card">
      <SectionTitle hint="Mode gelap enak dipakai saat shift malam">Tampilan</SectionTitle>
      <Segmented
        label="Tema"
        block
        value={t}
        onChange={(v) => {
          setT(v);
          setThemePref(v);
        }}
        options={[
          { value: 'auto', label: 'Ikut HP', icon: 'phone' },
          { value: 'light', label: 'Terang', icon: 'sun' },
          { value: 'dark', label: 'Gelap', icon: 'moon' },
        ]}
      />
    </section>
  );
}

/* ---------- ganti password ---------- */

function PasswordCard({ forced = false, onDone }: { forced?: boolean; onDone?: () => void }) {
  const { refresh } = useAuth();
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [nw2, setNw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (nw.length < 5) return setErr('Password baru minimal 5 karakter.');
    if (nw !== nw2) return setErr('Pengulangan password baru tidak sama.');
    setBusy(true);
    try {
      const r = await api.post<{ token: string }>('/api/auth/password', { current_password: cur, new_password: nw });
      setToken(r.token);
      await refresh();
      setCur('');
      setNw('');
      setNw2('');
      toast.push({ title: 'Password diganti', tone: 'ok' });
      onDone?.();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Gagal mengganti password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={forced ? '' : 'card'}>
      {!forced && <SectionTitle hint="Ganti secara berkala; jangan dibagikan ke siapa pun">Ganti password</SectionTitle>}
      <form className="stack" onSubmit={submit}>
        {err && (
          <div className="banner banner--stop" role="alert">
            <Icon name="alert" size={18} />
            <div className="grow">{err}</div>
          </div>
        )}
        <Field label={forced ? 'Password dari admin' : 'Password sekarang'} htmlFor="p-cur">
          <input id="p-cur" className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
        </Field>
        <Field label="Password baru" htmlFor="p-new" hint="Minimal 5 karakter">
          <input id="p-new" className="input" type="password" autoComplete="new-password" value={nw} onChange={(e) => setNw(e.target.value)} required minLength={5} />
        </Field>
        <Field label="Ulangi password baru" htmlFor="p-new2">
          <input id="p-new2" className="input" type="password" autoComplete="new-password" value={nw2} onChange={(e) => setNw2(e.target.value)} required />
        </Field>
        <button type="submit" className={`btn ${forced ? 'btn--primary btn--lg btn--block' : 'btn--dark'}`} disabled={busy || !cur || !nw || !nw2}>
          {busy ? 'Menyimpan…' : 'Simpan password baru'}
        </button>
      </form>
    </section>
  );
}

/* ---------- wajib ganti password (akun baru / reset) ---------- */

export function ForcePassword() {
  const { logout, user } = useAuth();
  return (
    <div className="login login--gate">
      <main className="login__panel">
        <div className="login__form">
          <div className="eyebrow">Langkah pertama</div>
          <h1 className="login__h">Buat password baru</h1>
          <p className="muted">
            Halo {user?.name}. Password dari admin hanya untuk sekali pakai. Buat password Anda sendiri sebelum memakai aplikasi.
          </p>
          <PasswordCard forced />
          <button type="button" className="btn btn--ghost btn--block" onClick={logout}>
            Keluar
          </button>
        </div>
      </main>
    </div>
  );
}

