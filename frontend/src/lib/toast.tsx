import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../components/Icon';

export type ToastTone = 'ok' | 'info' | 'warn' | 'danger';
interface ToastItem {
  id: number;
  title: string;
  body?: string;
  tone: ToastTone;
  onClick?: () => void;
}
interface ToastCtx {
  push: (t: { title: string; body?: string; tone?: ToastTone; onClick?: () => void; ms?: number }) => void;
}

const Ctx = createContext<ToastCtx>({ push: () => undefined });
const ICON: Record<ToastTone, IconName> = { ok: 'check', info: 'info', warn: 'alert', danger: 'stop' };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setItems((l) => l.filter((x) => x.id !== id)), []);

  const push = useCallback<ToastCtx['push']>(
    ({ title, body, tone = 'info', onClick, ms }) => {
      seq.current += 1;
      const id = seq.current;
      setItems((l) => [...l.slice(-2), { id, title, body, tone, onClick }]);
      const life = ms ?? (tone === 'danger' ? 9000 : 5000);
      window.setTimeout(() => dismiss(id), life);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push }), [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="region" aria-label="Pemberitahuan" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast--${t.tone}`} role={t.tone === 'danger' ? 'alert' : 'status'}>
            <button
              type="button"
              className="toast__main"
              onClick={() => {
                t.onClick?.();
                dismiss(t.id);
              }}
            >
              <span className="toast__icon" aria-hidden="true">
                <Icon name={ICON[t.tone]} size={18} />
              </span>
              <span className="toast__text">
                <strong>{t.title}</strong>
                {t.body && <span>{t.body}</span>}
              </span>
            </button>
            <button type="button" className="toast__x" onClick={() => dismiss(t.id)} aria-label="Tutup">
              <Icon name="x" size={16} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
