import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Icon, type IconName } from '../components/Icon';
import { Empty, ErrorBox, PageHead, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { ago, dateTime } from '../lib/format';
import { useNotices } from '../lib/hooks';

const ICON: Record<string, IconName> = { ok: 'check', info: 'info', warn: 'alert', danger: 'stop' };

export default function NotificationsPage() {
  const q = useNotices();
  const qc = useQueryClient();
  const items = q.data?.items ?? [];

  // buka halaman ini = tandai semua sudah dibaca
  useEffect(() => {
    if (!q.data || q.data.unread === 0) return;
    const t = window.setTimeout(() => {
      api
        .post('/api/notifications/seen', {})
        .then(() => qc.invalidateQueries({ queryKey: ['notices'] }))
        .catch(() => undefined);
    }, 1500);
    return () => window.clearTimeout(t);
  }, [q.data, qc]);

  return (
    <div className="page">
      <PageHead eyebrow="Kabar terbaru" title="Pemberitahuan" />
      {q.isLoading && <Spinner />}
      {q.error && !q.data && <ErrorBox error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && items.length === 0 && <Empty icon="bell" title="Belum ada pemberitahuan" hint="P2H baru, temuan, dan perbaikan akan muncul di sini." />}
      <ul className="notes">
        {items.map((n) => {
          const isNew = n.id > (q.data?.seen_id ?? 0) && !n.mine;
          const inner = (
            <>
              <span className={`note__icon note__icon--${n.severity}`}>
                <Icon name={ICON[n.severity] ?? 'info'} size={18} stroke={2.4} />
              </span>
              <span className="note__main">
                <span className="note__title">
                  {n.title}
                  {isNew && <span className="note__new">baru</span>}
                </span>
                <span className="note__body">{n.body}</span>
                <span className="note__time small muted" title={dateTime(n.created_at)}>
                  {ago(n.created_at)}
                  {n.mine ? ' · oleh Anda' : ''}
                </span>
              </span>
            </>
          );
          return (
            <li key={n.id} className={`note ${isNew ? 'is-new' : ''}`}>
              {n.form_id ? (
                <Link to={`/p2h/${n.form_id}`} className="note__row">
                  {inner}
                </Link>
              ) : (
                <Link to="/temuan" className="note__row">
                  {inner}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
