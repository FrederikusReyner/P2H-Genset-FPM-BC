import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon, Slashes, type IconName } from './Icon';
import type { Danger, ResultKind, TileState } from '../lib/types';

/* ---------- logo ---------- */

export function BrandLockup({ reversed = false, height = 30 }: { reversed?: boolean; height?: number }) {
  return (
    <img
      src={reversed ? '/logos/berau-wordmark-rev.png' : '/logos/berau-wordmark.png'}
      alt="Berau Coal"
      height={height}
      style={{ height, width: 'auto' }}
    />
  );
}

export function MtlMark({ height = 28 }: { height?: number }) {
  return <img src="/logos/mtl-logo.png" alt="Mutiara Tanjung Lestari" height={height} style={{ height, width: 'auto' }} />;
}

/* ---------- judul halaman ---------- */

export function PageHead({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <header className="pagehead">
      <div className="pagehead__text">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="h1">{title}</h1>
      </div>
      {children && <div className="pagehead__actions">{children}</div>}
    </header>
  );
}

export function SectionTitle({ children, hint, right }: { children: ReactNode; hint?: ReactNode; right?: ReactNode }) {
  return (
    <div className="sectitle">
      <div className="grow">
        <h2 className="h2">
          <Slashes size={16} className="sectitle__mark" />
          {children}
        </h2>
        {hint && <div className="small muted sectitle__hint">{hint}</div>}
      </div>
      {right}
    </div>
  );
}

/* ---------- chip hasil / kode ---------- */

const RESULT: Record<ResultKind, { icon: IconName; label: string; cls: string }> = {
  baik: { icon: 'check', label: 'Semua baik', cls: 'ok' },
  temuan_a: { icon: 'alert', label: 'Ada temuan', cls: 'warn' },
  stop_aa: { icon: 'stop', label: 'STOP OPERASI', cls: 'stop' },
};

export function ResultChip({ result, compact = false }: { result: ResultKind; compact?: boolean }) {
  const r = RESULT[result];
  return (
    <span className={`chip chip--${r.cls}`}>
      <Icon name={r.icon} size={compact ? 13 : 15} stroke={2.4} />
      {!compact && r.label}
      {compact && <span className="sr-only">{r.label}</span>}
    </span>
  );
}

export function DangerCode({ code, title }: { code: Danger; title?: boolean }) {
  return (
    <span
      className={`dcode dcode--${code}`}
      title={title === false ? undefined : code === 'AA' ? 'AA = STOP OPERASI, unit harus diperbaiki sebelum dijalankan' : 'A = harus diperbaiki dalam 1 x 12 jam'}
    >
      {code}
    </span>
  );
}

const TILE_LABEL: Record<TileState, { icon: IconName; label: string }> = {
  ok: { icon: 'check', label: 'Baik' },
  warn: { icon: 'alert', label: 'Ada temuan' },
  stop: { icon: 'stop', label: 'STOP' },
  pending: { icon: 'clock', label: 'Belum P2H' },
  off: { icon: 'wrench', label: 'Tidak jalan' },
};
export const tileInfo = (s: TileState) => TILE_LABEL[s];

/* ---------- kontrol pilihan ---------- */

interface Opt<T extends string | number> {
  value: T;
  label: ReactNode;
  tone?: 'ok' | 'warn' | 'stop';
  icon?: IconName;
  disabled?: boolean;
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  className = '',
  block = false,
}: {
  value: T | null;
  options: Opt<T>[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
  block?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    let j = i;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % options.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + options.length) % options.length;
    else return;
    e.preventDefault();
    refs.current[j]?.focus();
    onChange(options[j].value);
  };
  return (
    <div className={`seg ${block ? 'seg--block' : ''} ${className}`} role="radiogroup" aria-label={label}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on || (value === null && i === 0) ? 0 : -1}
            disabled={o.disabled}
            className={`seg__btn ${on ? `is-on ${o.tone ? `seg__btn--${o.tone}` : ''}` : ''}`}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {o.icon && <Icon name={o.icon} size={16} stroke={2.4} />}
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- isian formulir ---------- */

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  className = '',
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={`field ${error ? 'has-error' : ''} ${className}`}>
      <label className="field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? <div className="field__error" role="alert">{error}</div> : hint ? <div className="field__hint">{hint}</div> : null}
    </div>
  );
}

/* ---------- kosong / memuat ---------- */

export function Empty({ icon = 'info', title, hint, children }: { icon?: IconName; title: string; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__icon">
        <Icon name={icon} size={26} />
      </div>
      <div className="empty__title">{title}</div>
      {hint && <div className="empty__hint">{hint}</div>}
      {children}
    </div>
  );
}

export function Spinner({ label = 'Memuat…' }: { label?: string }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner__dot" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : 'Terjadi kesalahan.';
  return (
    <div className="banner banner--stop" role="alert">
      <Icon name="alert" size={18} />
      <div className="grow">{msg}</div>
      {onRetry && (
        <button type="button" className="btn btn--sm btn--ghost" onClick={onRetry}>
          Coba lagi
        </button>
      )}
    </div>
  );
}

/* ---------- jendela (sheet) ---------- */

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>('[data-autofocus], input, textarea, select, button.btn');
      el?.focus();
    }, 30);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(t);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="sheet-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`sheet ${wide ? 'sheet--wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id}>
        <div className="sheet__head">
          <h2 id={id} className="h2">
            {title}
          </h2>
          <button type="button" className="iconbtn iconbtn--plain" onClick={onClose} aria-label="Tutup">
            <Icon name="x" />
          </button>
        </div>
        <div className="sheet__body">{children}</div>
        {footer && <div className="sheet__foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({
  open,
  title,
  body,
  confirmLabel = 'Ya',
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Batal
          </button>
          <button type="button" className={`btn ${danger ? 'btn--stop' : 'btn--primary'}`} onClick={onConfirm} disabled={busy} data-autofocus>
            {busy ? 'Memproses…' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="prose">{body}</div>
    </Sheet>
  );
}

/* ---------- tabel angka sederhana / halaman ---------- */

export function Pager({ total, limit, offset, onChange }: { total: number; limit: number; offset: number; onChange: (offset: number) => void }) {
  if (total <= limit) return null;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);
  return (
    <div className="pager">
      <button type="button" className="btn btn--sm btn--ghost" disabled={offset <= 0} onClick={() => onChange(Math.max(0, offset - limit))}>
        <Icon name="chevL" size={16} /> Sebelumnya
      </button>
      <span className="small muted">
        Halaman {page} dari {pages} · {total} data
      </span>
      <button type="button" className="btn btn--sm btn--ghost" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>
        Berikutnya <Icon name="chevR" size={16} />
      </button>
    </div>
  );
}

/** Menu unduh PDF / Excel / Word */
export function DownloadMenu({
  onPick,
  label = 'Unduh',
  disabled = false,
  busy = false,
}: {
  onPick: (f: 'pdf' | 'xlsx' | 'docx') => void;
  label?: string;
  disabled?: boolean;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) ref.current.removeAttribute('open');
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const pick = (f: 'pdf' | 'xlsx' | 'docx') => {
    ref.current?.removeAttribute('open');
    onPick(f);
  };
  return (
    <details className="menu" ref={ref} aria-disabled={disabled}>
      <summary className={`btn btn--dark ${disabled || busy ? 'is-disabled' : ''}`} onClick={(e) => (disabled || busy) && e.preventDefault()}>
        <Icon name="download" size={18} />
        {busy ? 'Menyiapkan…' : label}
      </summary>
      <div className="menu__list" role="menu">
        <button type="button" role="menuitem" onClick={() => pick('pdf')}>
          <Icon name="file" size={18} /> PDF <span className="muted small">siap cetak</span>
        </button>
        <button type="button" role="menuitem" onClick={() => pick('xlsx')}>
          <Icon name="table" size={18} /> Excel <span className="muted small">.xlsx</span>
        </button>
        <button type="button" role="menuitem" onClick={() => pick('docx')}>
          <Icon name="pen" size={18} /> Word <span className="muted small">.docx</span>
        </button>
      </div>
    </details>
  );
}
