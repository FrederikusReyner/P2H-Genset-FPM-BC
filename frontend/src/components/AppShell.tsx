import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Icon, type IconName } from './Icon';
import { BrandLockup, Empty, MtlMark } from './ui';
import { wakeServer } from '../lib/api';
import { CAN_FILL, CAN_SIGN, useAuth } from '../lib/auth';
import { GENSET_CODE, canUseForm, useFormTypes } from '../lib/forms';
import { useFindings, useMeta, useNotices, useOnline, useSlowServer } from '../lib/hooks';
import { flushOutbox, onOutboxChange, removeFromOutbox, type OutboxItem } from '../lib/outbox';
import { syncPush } from '../lib/push';
import { useToast } from '../lib/toast';
import { ROLE_LABEL } from '../lib/format';
import { swState, applySwUpdate, onSwChange } from '../lib/pwa';

interface NavDef {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
  badge?: number;
  admin?: boolean;
}

export function AppShell() {
  const { user, logout, offline, refresh } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const online = useOnline();
  const slow = useSlowServer();
  const gensetOk = canUseForm(user, GENSET_CODE);
  const open = useFindings('open', null, gensetOk);
  const notices = useNotices();
  const meta = useMeta();
  const formTypes = useFormTypes();
  const mySite = user && user.role !== 'admin' ? meta.data?.sites.find((s) => s.id === user.site_id)?.name : undefined;
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [sw, setSw] = useState(swState());
  const toastedUpTo = useRef<number | null>(null);

  const canFill = !!user && CAN_FILL.includes(user.role);
  const canSign = !!user && CAN_SIGN.includes(user.role);
  const openCount = open.data?.items.length ?? 0;
  const openAA = open.data?.items.filter((f) => f.danger_code === 'AA').length ?? 0;
  const unread = notices.data?.unread ?? 0;

  // server kembali terjangkau (pengecekan pemberitahuan berhasil): keluar dari mode tanpa sinyal
  useEffect(() => {
    if (offline && notices.isSuccess && !notices.isFetching) void refresh();
  }, [offline, notices.isSuccess, notices.isFetching, notices.dataUpdatedAt, refresh]);

  /* ---- kotak keluar (P2H yang menunggu terkirim) ---- */
  useEffect(() => onOutboxChange(setOutbox), []);
  useEffect(() => onSwChange(() => setSw(swState())), []);

  const refreshAll = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    void qc.invalidateQueries({ queryKey: ['findings'] });
    void qc.invalidateQueries({ queryKey: ['notices'] });
    void qc.invalidateQueries({ queryKey: ['history'] });
    void qc.invalidateQueries({ queryKey: ['units'] });
    void qc.invalidateQueries({ queryKey: ['forms'] });
    void qc.invalidateQueries({ queryKey: ['form'] });
    void qc.invalidateQueries({ queryKey: ['form-findings'] });
    void qc.invalidateQueries({ queryKey: ['form-records'] });
    void qc.invalidateQueries({ queryKey: ['form-stats'] });
  }, [qc]);

  const flush = useCallback(async () => {
    const r = await flushOutbox(user?.id);
    if (r.sent > 0) {
      toast.push({ title: `${r.sent} isian terkirim`, body: 'Data yang tertunda (dikirim saat tanpa sinyal) sudah masuk ke server.', tone: 'ok' });
      refreshAll();
    }
  }, [refreshAll, toast, user?.id]);

  useEffect(() => {
    wakeServer();
    void syncPush();
    void flush();
  }, [flush]);

  useEffect(() => {
    if (online) {
      void flush();
      refreshAll();
    }
  }, [online, flush, refreshAll]);

  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) void flush();
    }, 30_000);
    return () => window.clearInterval(t);
  }, [flush]);

  /* ---- pesan dari service worker: notifikasi masuk / ketuk notifikasi ---- */
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (!d) return;
      if (d.type === 'push') {
        refreshAll();
        if (document.visibilityState === 'visible') {
          const p = d.payload || {};
          toast.push({
            title: p.title || 'P2H Genset',
            body: p.body,
            tone: p.severity === 'danger' ? 'danger' : p.severity === 'warn' ? 'warn' : p.severity === 'ok' ? 'ok' : 'info',
            onClick: () => nav(p.path || '/'),
          });
        }
      }
      if (d.type === 'navigate' && typeof d.path === 'string') nav(d.path);
    };
    navigator.serviceWorker.addEventListener('message', onMsg);
    return () => navigator.serviceWorker.removeEventListener('message', onMsg);
  }, [nav, refreshAll, toast]);

  /* ---- pemberitahuan baru lewat pengecekan berkala (untuk yang belum mengaktifkan notifikasi HP) ---- */
  useEffect(() => {
    const items = notices.data?.items;
    if (!items) return;
    const maxId = items.reduce((m, n) => Math.max(m, n.id), 0);
    if (toastedUpTo.current === null) {
      toastedUpTo.current = maxId; // pertama kali: jangan munculkan yang lama
      return;
    }
    const fresh = items.filter((n) => n.id > (toastedUpTo.current ?? 0) && !n.mine);
    toastedUpTo.current = Math.max(toastedUpTo.current, maxId);
    if (document.visibilityState !== 'visible') return;
    for (const n of fresh.slice(0, 2)) {
      toast.push({
        title: n.title,
        body: n.body,
        tone: n.severity === 'danger' ? 'danger' : n.severity === 'warn' ? 'warn' : n.severity === 'ok' ? 'ok' : 'info',
        onClick: () => nav(n.path || (n.form_id ? `/p2h/${n.form_id}` : '/temuan')),
      });
    }
    if (fresh.length) refreshAll();
  }, [notices.data, nav, refreshAll, toast]);

  /* ---- menu: menyesuaikan form yang sedang dibuka ---- */
  const formCode = /^\/f\/([^/]+)/.exec(loc.pathname)?.[1] ?? null;
  const formType = formCode ? formTypes.data?.items.find((t) => t.code === formCode) : undefined;
  const mod: 'genset' | 'form' | 'home' = formCode
    ? 'form'
    : /^\/(genset|p2h|rekap|bulanan|temuan|unit|admin\/daftar-cek)(\/|$)/.test(loc.pathname)
      ? 'genset'
      : 'home';
  const isAdmin = user?.role === 'admin';

  const gensetItems: NavDef[] = [
    { to: '/genset', label: 'Ringkasan', icon: 'home', end: true },
    ...(canFill ? [{ to: '/p2h/baru', label: 'P2H baru', icon: 'plus' as IconName }] : []),
    { to: '/p2h', label: 'Riwayat', icon: 'history', end: true },
    { to: '/rekap', label: 'Rekap', icon: 'chart' },
    ...(canSign ? [{ to: '/bulanan', label: 'Data bulanan', icon: 'table' as IconName }] : []),
    { to: '/temuan', label: 'Temuan', icon: 'alert', badge: openCount },
    { to: '/unit', label: 'Unit genset', icon: 'bolt' },
    ...(isAdmin ? [{ to: '/admin/daftar-cek', label: 'Daftar cek', icon: 'list' as IconName }] : []),
  ];
  const fp = (rest = '') => `/f/${formCode}${rest}`;
  const formOpen = (formType?.open_stop ?? 0) + (formType?.open_fix ?? 0);
  const formItems: NavDef[] = formCode
    ? [
        { to: fp(), label: 'Ringkasan', icon: 'home', end: true },
        ...(canFill ? [{ to: fp('/baru'), label: 'Isi baru', icon: 'plus' as IconName }] : []),
        { to: fp('/riwayat'), label: 'Riwayat', icon: 'history' },
        { to: fp('/rekap'), label: 'Rekap', icon: 'chart' },
        { to: fp('/temuan'), label: 'Temuan', icon: 'alert', badge: formOpen },
        ...(isAdmin ? [{ to: fp('/kelola'), label: 'Kelola', icon: 'settings' as IconName }] : []),
      ]
    : [];
  const items: NavDef[] = [{ to: '/', label: 'Pilih form', icon: 'grid', end: true }];
  const moduleItems = mod === 'genset' ? gensetItems : mod === 'form' ? formItems : [];
  const moduleTitle = mod === 'genset' ? 'P2H Genset' : formType?.short_name ?? '';
  const account: NavDef[] = [{ to: '/akun', label: 'Akun saya', icon: 'user' }];
  const admin: NavDef[] = isAdmin
    ? [
        { to: '/admin/pengguna', label: 'Pengguna', icon: 'users' },
        { to: '/admin/pengaturan', label: 'Pengaturan', icon: 'settings' },
      ]
    : [];
  const moduleStop = mod === 'genset' ? openAA > 0 : (formType?.open_stop ?? 0) > 0;

  // menu bawah di HP: 4 tombol + tombol isi di tengah
  const phoneItems: NavDef[] =
    mod === 'genset'
      ? [items[0], gensetItems[0], ...gensetItems.filter((i) => i.to === '/p2h' || i.to === '/temuan')]
      : mod === 'form'
        ? [items[0], formItems[0], ...formItems.filter((i) => i.to === fp('/riwayat') || i.to === fp('/temuan'))]
        : [items[0], { to: '/notifikasi', label: 'Pemberitahuan', icon: 'bell', badge: unread }, ...account];
  const fab = mod === 'genset' && canFill ? { to: '/p2h/baru', label: 'P2H' } : mod === 'form' && canFill ? { to: fp('/baru'), label: 'Isi' } : null;
  const half = Math.ceil(phoneItems.length / 2);
  const bottomLeft = phoneItems.slice(0, half);
  const bottomRight = phoneItems.slice(half);
  const product = mod === 'genset' ? ['P2H', 'GENSET'] : mod === 'form' && formType ? [formType.short_name.split(' ')[0], formType.short_name.split(' ').slice(1).join(' ')] : ['FORM', 'DIGITAL'];

  const mine = outbox.filter((o) => o.user_id == null || o.user_id === user?.id);
  const pendingBlocked = mine.filter((o) => o.blocked);
  const pendingSend = mine.filter((o) => !o.blocked);

  return (
    <div className="shell" data-focus={/\/baru$|\/ubah$/.test(loc.pathname) ? "true" : undefined}>
      <header className="topbar">
        <div className="topbar__in">
          <NavLink to="/" className="topbar__brand" aria-label="Pilih form">
            <BrandLockup reversed height={26} />
            <span className="topbar__sep" aria-hidden="true" />
            <span className="topbar__product">
              {product[0]} <b>{product[1]?.toUpperCase()}</b>
            </span>
          </NavLink>
          <span className="grow" />
          <span className="topbar__mtl hide-on-phone">
            <MtlMark height={24} />
          </span>
          <NavLink to="/notifikasi" className="iconbtn iconbtn--frame" aria-label={`Pemberitahuan${unread ? `, ${unread} belum dibaca` : ''}`}>
            <Icon name="bell" />
            {unread > 0 && <span className="badge badge--dot">{unread > 9 ? '9+' : unread}</span>}
          </NavLink>
          <button type="button" className="topbar__user hide-on-phone" onClick={() => nav('/akun')} aria-label="Akun saya">
            <span className="topbar__avatar" aria-hidden="true">
              {user?.name?.slice(0, 1).toUpperCase()}
            </span>
            <span className="topbar__who">
              <b>{user?.name}</b>
              <i>{user ? `${ROLE_LABEL[user.role]}${mySite ? ` · ${mySite}` : ''}` : ''}</i>
            </span>
          </button>
        </div>
      </header>

      <div className="body">
        <nav className="rail" aria-label="Menu utama">
          <ul>
            {items.map((i) => (
              <li key={i.to}>
                <NavLink to={i.to} end={i.end} className={({ isActive }) => `rail__link ${isActive ? 'is-active' : ''}`}>
                  <Icon name={i.icon} size={20} />
                  <span>{i.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
          {moduleItems.length > 0 && (
            <>
              <div className="rail__group eyebrow">{moduleTitle}</div>
              <ul>
                {moduleItems.map((i) => (
                  <li key={i.to}>
                    <NavLink to={i.to} end={i.end} className={({ isActive }) => `rail__link ${isActive ? 'is-active' : ''}`}>
                      <Icon name={i.icon} size={20} />
                      <span>{i.label}</span>
                      {!!i.badge && <span className={`badge ${moduleStop ? 'badge--stop' : 'badge--warn'}`}>{i.badge}</span>}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="rail__group eyebrow">Akun</div>
          <ul>
            {account.map((i) => (
              <li key={i.to}>
                <NavLink to={i.to} className={({ isActive }) => `rail__link ${isActive ? 'is-active' : ''}`}>
                  <Icon name={i.icon} size={20} />
                  <span>{i.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
          {admin.length > 0 && (
            <>
              <div className="rail__group eyebrow">Kelola</div>
              <ul>
                {admin.map((i) => (
                  <li key={i.to}>
                    <NavLink to={i.to} className={({ isActive }) => `rail__link ${isActive ? 'is-active' : ''}`}>
                      <Icon name={i.icon} size={20} />
                      <span>{i.label}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="rail__foot">
            <button type="button" className="rail__link" onClick={logout}>
              <Icon name="logout" size={20} />
              <span>Keluar</span>
            </button>
            <div className="tiny muted rail__ver">PT Berau Coal · MTL</div>
          </div>
        </nav>

        <main className="main" id="isi">
          {(!online || offline) && (
            <div className="banner banner--warn" role="status">
              <Icon name="wifiOff" size={18} />
              <div className="grow">
                <b>Tidak ada sinyal.</b> Anda masih bisa mengisi P2H; datanya disimpan di HP dan dikirim otomatis saat sinyal kembali.
              </div>
            </div>
          )}
          {online && slow && (
            <div className="banner banner--info" role="status">
              <Icon name="cloud" size={18} />
              <div className="grow">
                <b>Menyambung ke server…</b> Server bisa butuh sampai 1 menit kalau baru bangun. Mohon tunggu.
              </div>
            </div>
          )}
          {pendingSend.length > 0 && (
            <div className="banner banner--info" role="status">
              <Icon name="send" size={18} />
              <div className="grow">
                <b>{pendingSend.length} isian menunggu sinyal</b> ({pendingSend.map((p) => p.label).join('; ')}). Terkirim otomatis begitu ada sinyal.
              </div>
              <button type="button" className="btn btn--sm btn--dark" onClick={() => void flush()}>
                Kirim sekarang
              </button>
            </div>
          )}
          {pendingBlocked.map((p) => (
            <div key={p.uuid} className="banner banner--stop" role="alert">
              <Icon name="alert" size={18} />
              <div className="grow">
                <b>{p.label} tidak bisa dikirim:</b> {p.blocked}
              </div>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => void removeFromOutbox(p.uuid)}>
                Buang
              </button>
            </div>
          ))}
          {sw.needRefresh && (
            <div className="banner banner--ok" role="status">
              <Icon name="refresh" size={18} />
              <div className="grow">
                <b>Versi baru aplikasi tersedia.</b> Muat ulang untuk memakainya (pastikan form yang sedang diisi sudah dikirim).
              </div>
              <button type="button" className="btn btn--sm btn--dark" onClick={() => applySwUpdate()}>
                Muat ulang
              </button>
            </div>
          )}
          {(mod === 'genset' && !gensetOk) || (mod === 'form' && formCode && !canUseForm(user, formCode)) ? (
            <Empty icon="lock" title="Akun Anda tidak diberi akses ke form ini" hint="Minta admin menambahkan form ini di menu Pengguna.">
              <NavLink to="/" className="btn btn--dark">
                Ke pilih form
              </NavLink>
            </Empty>
          ) : (
            <Outlet />
          )}
        </main>
      </div>

      <nav className="bottomnav" aria-label="Menu utama" style={{ ['--cols' as string]: phoneItems.length + (fab ? 1 : 0) }}>
        {bottomLeft.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => `bn__link ${isActive ? 'is-active' : ''}`}>
            <span className="bn__icon">
              <Icon name={i.icon} size={22} />
              {!!i.badge && <span className={`badge badge--dot ${moduleStop ? 'badge--stop' : 'badge--warn'}`}>{i.badge > 9 ? '9+' : i.badge}</span>}
            </span>
            <span>{i.label}</span>
          </NavLink>
        ))}
        {fab && (
          <NavLink to={fab.to} className={({ isActive }) => `bn__fab ${isActive ? 'is-active' : ''}`} aria-label="Isi baru">
            <span className="bn__fabshape">
              <Icon name="plus" size={26} stroke={2.8} />
            </span>
            <span className="bn__faclabel">{fab.label}</span>
          </NavLink>
        )}
        {bottomRight.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => `bn__link ${isActive ? 'is-active' : ''}`}>
            <span className="bn__icon">
              <Icon name={i.icon} size={22} />
              {!!i.badge && <span className={`badge badge--dot ${moduleStop ? 'badge--stop' : 'badge--warn'}`}>{i.badge > 9 ? '9+' : i.badge}</span>}
            </span>
            <span>{i.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
