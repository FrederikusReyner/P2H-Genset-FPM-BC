import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Icon, type IconName } from './Icon';
import { BrandLockup, MtlMark } from './ui';
import { wakeServer } from '../lib/api';
import { CAN_FILL, useAuth } from '../lib/auth';
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
  const open = useFindings('open');
  const notices = useNotices();
  const meta = useMeta();
  const mySite = user && user.role !== 'admin' ? meta.data?.sites.find((s) => s.id === user.site_id)?.name : undefined;
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [sw, setSw] = useState(swState());
  const toastedUpTo = useRef<number | null>(null);

  const canFill = !!user && CAN_FILL.includes(user.role);
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
  }, [qc]);

  const flush = useCallback(async () => {
    const r = await flushOutbox();
    if (r.sent > 0) {
      toast.push({ title: `${r.sent} P2H terkirim`, body: 'Data yang tertunda sudah masuk ke server.', tone: 'ok' });
      refreshAll();
    }
  }, [refreshAll, toast]);

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
        onClick: () => nav(n.form_id ? `/p2h/${n.form_id}` : '/temuan'),
      });
    }
    if (fresh.length) refreshAll();
  }, [notices.data, nav, refreshAll, toast]);

  /* ---- menu ---- */
  const items: NavDef[] = [
    { to: '/', label: 'Beranda', icon: 'home', end: true },
    ...(canFill ? [{ to: '/p2h/baru', label: 'P2H baru', icon: 'plus' as IconName }] : []),
    { to: '/p2h', label: 'Riwayat', icon: 'history', end: true },
    { to: '/rekap', label: 'Rekap', icon: 'chart' },
    { to: '/temuan', label: 'Temuan', icon: 'alert', badge: openCount },
    { to: '/unit', label: 'Unit genset', icon: 'bolt' },
    { to: '/akun', label: 'Akun saya', icon: 'user' },
  ];
  const admin: NavDef[] =
    user?.role === 'admin'
      ? [
          { to: '/admin/pengguna', label: 'Pengguna', icon: 'users' },
          { to: '/admin/daftar-cek', label: 'Daftar cek', icon: 'list' },
          { to: '/admin/pengaturan', label: 'Pengaturan', icon: 'settings' },
        ]
      : [];

  const phoneItems = items.filter((i) => ['/', '/p2h', '/temuan', '/akun'].includes(i.to));
  const half = Math.ceil(phoneItems.length / 2);
  const bottomLeft = phoneItems.slice(0, half);
  const bottomRight = phoneItems.slice(half);

  const pendingBlocked = outbox.filter((o) => o.blocked);
  const pendingSend = outbox.filter((o) => !o.blocked);

  return (
    <div className="shell" data-focus={/^\/p2h\/baru$|\/ubah$/.test(loc.pathname) ? "true" : undefined}>
      <header className="topbar">
        <div className="topbar__in">
          <NavLink to="/" className="topbar__brand" aria-label="Beranda P2H Genset">
            <BrandLockup reversed height={26} />
            <span className="topbar__sep" aria-hidden="true" />
            <span className="topbar__product">
              P2H <b>GENSET</b>
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
                  {!!i.badge && <span className={`badge ${openAA ? 'badge--stop' : 'badge--warn'}`}>{i.badge}</span>}
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
                <b>{pendingSend.length} P2H menunggu terkirim</b> ({pendingSend.map((p) => p.label).join('; ')}).
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
          <Outlet />
        </main>
      </div>

      <nav className="bottomnav" aria-label="Menu utama" style={{ ['--cols' as string]: phoneItems.length + (canFill ? 1 : 0) }}>
        {bottomLeft.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => `bn__link ${isActive ? 'is-active' : ''}`}>
            <span className="bn__icon">
              <Icon name={i.icon} size={22} />
              {!!i.badge && <span className={`badge badge--dot ${openAA ? 'badge--stop' : 'badge--warn'}`}>{i.badge > 9 ? '9+' : i.badge}</span>}
            </span>
            <span>{i.label}</span>
          </NavLink>
        ))}
        {canFill && (
          <NavLink to="/p2h/baru" className={({ isActive }) => `bn__fab ${isActive ? 'is-active' : ''}`} aria-label="Isi P2H baru">
            <span className="bn__fabshape">
              <Icon name="plus" size={26} stroke={2.8} />
            </span>
            <span className="bn__faclabel">P2H</span>
          </NavLink>
        )}
        {bottomRight.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => `bn__link ${isActive ? 'is-active' : ''}`}>
            <span className="bn__icon">
              <Icon name={i.icon} size={22} />
              {!!i.badge && <span className={`badge badge--dot ${openAA ? 'badge--stop' : 'badge--warn'}`}>{i.badge > 9 ? '9+' : i.badge}</span>}
            </span>
            <span>{i.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
