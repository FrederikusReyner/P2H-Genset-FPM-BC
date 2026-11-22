import { Component, lazy, Suspense, useEffect, type ComponentType, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { Spinner } from './components/ui';
import { CAN_FILL, CAN_SIGN, useAuth } from './lib/auth';
import type { Role } from './lib/types';
import LoginPage from './pages/Login';
import DashboardPage from './pages/Dashboard';
import AccountPage, { ForcePassword } from './pages/Account';


/*
 * Halaman dimuat belakangan supaya aplikasi cepat terbuka. Begitu aplikasi terbuka (dan ada sinyal),
 * semua halaman diunduh di latar, jadi tetap bisa dibuka saat sinyal hilang di site.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loaders: (() => Promise<unknown>)[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function page<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  let p: Promise<{ default: T }> | null = null;
  const once = () => {
    if (!p) p = load().catch((e) => {
      p = null; // boleh dicoba lagi nanti
      throw e;
    });
    return p;
  };
  loaders.push(once);
  return lazy(once);
}
function preloadPages() {
  const run = () => {
    for (const l of loaders) l().catch(() => undefined);
  };
  if ('requestIdleCallback' in window) (window as Window & { requestIdleCallback: (f: () => void) => void }).requestIdleCallback(run);
  else setTimeout(run, 1500);
}

/** Halaman gagal dimuat (biasanya belum tersimpan di HP dan sedang tanpa sinyal): beri tahu, jangan layar kosong. */
class PageError extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="splash">
        <div style={{ maxWidth: 360, textAlign: 'center', padding: 16 }}>
          <h2>Halaman belum bisa dibuka</h2>
          <p className="muted">Halaman ini belum tersimpan di HP dan sedang tidak ada sinyal. Isian yang sudah dikirim tetap aman di HP dan terkirim otomatis nanti.</p>
          <button type="button" className="btn btn--dark" onClick={() => window.location.reload()}>
            Coba lagi
          </button>{' '}
          <button type="button" className="btn btn--ghost" onClick={() => window.history.back()}>
            Kembali
          </button>
        </div>
      </div>
    );
  }
}

const HistoryPage = page(() => import('./pages/History'));
const P2HDetailPage = page(() => import('./pages/P2HDetail'));
const FindingsPage = page(() => import('./pages/Findings'));
const UnitsPage = page(() => import('./pages/Units'));
const NotificationsPage = page(() => import('./pages/Notifications'));
const RekapPage = page(() => import('./pages/Rekap'));
const BulananPage = page(() => import('./pages/Bulanan'));
const NewP2HPage = page(() => import('./pages/P2HForm').then((m) => ({ default: m.NewP2HPage })));
const EditP2HPage = page(() => import('./pages/P2HForm').then((m) => ({ default: m.EditP2HPage })));
const UsersPage = page(() => import('./pages/Admin').then((m) => ({ default: m.UsersPage })));
const ChecklistPage = page(() => import('./pages/Admin').then((m) => ({ default: m.ChecklistPage })));
const SettingsPage = page(() => import('./pages/Admin').then((m) => ({ default: m.SettingsPage })));
// form digital lain (tools, arus motor, safety device, metal catcher, panel, ...)
const LauncherPage = page(() => import('./pages/Launcher'));
const FormHomePage = page(() => import('./pages/forms/FormHome'));
const NewFormPage = page(() => import('./pages/forms/FormFill').then((m) => ({ default: m.NewFormPage })));
const EditFormPage = page(() => import('./pages/forms/FormFill').then((m) => ({ default: m.EditFormPage })));
const FormRecordPage = page(() => import('./pages/forms/FormRecord'));
const FormHistoryPage = page(() => import('./pages/forms/FormLists').then((m) => ({ default: m.FormHistoryPage })));
const FormFindingsPage = page(() => import('./pages/forms/FormLists').then((m) => ({ default: m.FormFindingsPage })));
const FormManagePage = page(() => import('./pages/forms/FormManage'));
const FormRekapPage = page(() => import('./pages/forms/FormRekap'));

function Splash() {
  return (
    <div className="splash">
      <Spinner label="Membuka aplikasi…" />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Splash />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  if (user.must_change_password) return <ForcePassword />;
  return <>{children}</>;
}

function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  useEffect(() => {
    if (navigator.onLine) preloadPages();
    window.addEventListener('online', preloadPages);
    return () => window.removeEventListener('online', preloadPages);
  }, []);
  return (
    <BrowserRouter>
      <PageError>
      <Suspense fallback={<Splash />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route index element={<LauncherPage />} />
            <Route path="genset" element={<DashboardPage />} />
            <Route path="f/:code" element={<FormHomePage />} />
            <Route
              path="f/:code/baru"
              element={
                <RequireRole roles={CAN_FILL}>
                  <NewFormPage />
                </RequireRole>
              }
            />
            <Route path="f/:code/riwayat" element={<FormHistoryPage />} />
            <Route path="f/:code/temuan" element={<FormFindingsPage />} />
            <Route path="f/:code/rekap" element={<FormRekapPage />} />
            <Route path="f/:code/r/:id" element={<FormRecordPage />} />
            <Route
              path="f/:code/r/:id/ubah"
              element={
                <RequireRole roles={CAN_FILL}>
                  <EditFormPage />
                </RequireRole>
              }
            />
            <Route
              path="f/:code/kelola"
              element={
                <RequireRole roles={['admin']}>
                  <FormManagePage />
                </RequireRole>
              }
            />
            <Route path="p2h" element={<HistoryPage />} />
            <Route
              path="p2h/baru"
              element={
                <RequireRole roles={CAN_FILL}>
                  <NewP2HPage />
                </RequireRole>
              }
            />
            <Route path="p2h/:id" element={<P2HDetailPage />} />
            <Route
              path="p2h/:id/ubah"
              element={
                <RequireRole roles={CAN_FILL}>
                  <EditP2HPage />
                </RequireRole>
              }
            />
            <Route path="rekap" element={<RekapPage />} />
            <Route
              path="bulanan"
              element={
                <RequireRole roles={CAN_SIGN}>
                  <BulananPage />
                </RequireRole>
              }
            />
            <Route path="temuan" element={<FindingsPage />} />
            <Route path="unit" element={<UnitsPage />} />
            <Route path="notifikasi" element={<NotificationsPage />} />
            <Route path="akun" element={<AccountPage />} />
            <Route
              path="admin/pengguna"
              element={
                <RequireRole roles={['admin']}>
                  <UsersPage />
                </RequireRole>
              }
            />
            <Route
              path="admin/daftar-cek"
              element={
                <RequireRole roles={['admin']}>
                  <ChecklistPage />
                </RequireRole>
              }
            />
            <Route
              path="admin/pengaturan"
              element={
                <RequireRole roles={['admin']}>
                  <SettingsPage />
                </RequireRole>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
      </PageError>
    </BrowserRouter>
  );
}
