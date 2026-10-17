import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { Spinner } from './components/ui';
import { CAN_FILL, useAuth } from './lib/auth';
import type { Role } from './lib/types';
import LoginPage from './pages/Login';
import DashboardPage from './pages/Dashboard';
import AccountPage, { ForcePassword } from './pages/Account';

// halaman yang jarang dibuka dimuat belakangan supaya aplikasi cepat terbuka
const HistoryPage = lazy(() => import('./pages/History'));
const P2HDetailPage = lazy(() => import('./pages/P2HDetail'));
const FindingsPage = lazy(() => import('./pages/Findings'));
const UnitsPage = lazy(() => import('./pages/Units'));
const NotificationsPage = lazy(() => import('./pages/Notifications'));
const NewP2HPage = lazy(() => import('./pages/P2HForm').then((m) => ({ default: m.NewP2HPage })));
const EditP2HPage = lazy(() => import('./pages/P2HForm').then((m) => ({ default: m.EditP2HPage })));
const UsersPage = lazy(() => import('./pages/Admin').then((m) => ({ default: m.UsersPage })));
const ChecklistPage = lazy(() => import('./pages/Admin').then((m) => ({ default: m.ChecklistPage })));
const SettingsPage = lazy(() => import('./pages/Admin').then((m) => ({ default: m.SettingsPage })));

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
  return (
    <BrowserRouter>
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
            <Route index element={<DashboardPage />} />
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
    </BrowserRouter>
  );
}
