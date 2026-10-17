import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '../components/Icon';
import { PhotoStrip } from '../components/Photos';
import { DangerCode, Empty, ErrorBox, PageHead, Spinner } from '../components/ui';
import { CAN_FIX, useAuth } from '../lib/auth';
import { CONDITION_LABEL, FIX_LABEL, ago, dateTime, mediumDate, modelOf, plain, shiftLabel, span } from '../lib/format';
import { useFindings, useMeta } from '../lib/hooks';
import type { Answer, Finding } from '../lib/types';
import { FixSheet } from './P2HDetail';

export default function FindingsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const meta = useMeta();
  const [tab, setTab] = useState<'open' | 'closed'>('open');
  const [site, setSite] = useState<number | null>(null);
  const q = useFindings(tab, site);
  const [fix, setFix] = useState<Finding | null>(null);
  const canFix = !!user && CAN_FIX.includes(user.role);
  const items = q.data?.items ?? [];

  const open = useFindings('open', null);
  const nOpen = open.data?.items.length ?? 0;

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['findings'] }),
      qc.invalidateQueries({ queryKey: ['dashboard'] }),
      qc.invalidateQueries({ queryKey: ['units'] }),
      qc.invalidateQueries({ queryKey: ['p2h'] }),
    ]);
  };

  // FixSheet bekerja dengan bentuk Answer; temuan kita ubah ke bentuk itu
  const asAnswer = (f: Finding): Answer => ({
    id: f.id,
    item_id: f.item_id,
    section_code: f.section_code,
    section_title: f.section_title,
    section_order: 0,
    item_no: f.item_no,
    item_text: f.item_text,
    hint: null,
    danger_code: f.danger_code,
    condition: f.condition,
    note: f.note,
    fix_status: f.status,
    fix_note: null,
    fix_by_name: null,
    fix_at: null,
    due_at: f.due_at,
    photos: [],
  });

  return (
    <div className="page">
      <PageHead eyebrow="Kerusakan yang dilaporkan di P2H" title="Temuan" />

      <div className="tabs" role="tablist" aria-label="Status temuan">
        <button type="button" role="tab" aria-selected={tab === 'open'} className={`tab ${tab === 'open' ? 'is-on' : ''}`} onClick={() => setTab('open')}>
          Terbuka {nOpen > 0 && <span className="badge badge--warn">{nOpen}</span>}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'closed'} className={`tab ${tab === 'closed' ? 'is-on' : ''}`} onClick={() => setTab('closed')}>
          Selesai
        </button>
      </div>

      {(meta.data?.sites.length ?? 0) > 1 && (
        <div className="chips" role="tablist" aria-label="Site">
          <button type="button" role="tab" aria-selected={site === null} className={`fchip ${site === null ? 'is-on' : ''}`} onClick={() => setSite(null)}>
            Semua site
          </button>
          {meta.data?.sites.map((s) => (
            <button key={s.id} type="button" role="tab" aria-selected={site === s.id} className={`fchip ${site === s.id ? 'is-on' : ''}`} onClick={() => setSite(s.id)}>
              {s.name}
            </button>
          ))}
        </div>
      )}

      {q.isLoading && <Spinner />}
      {q.error && !q.data && <ErrorBox error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && items.length === 0 && (
        <Empty
          icon="check"
          title={tab === 'open' ? 'Tidak ada temuan terbuka' : 'Belum ada temuan yang selesai'}
          hint={tab === 'open' ? 'Semua kerusakan yang dilaporkan sudah diperbaiki.' : 'Temuan yang sudah ditandai selesai akan muncul di sini.'}
        />
      )}

      <ul className="fcards">
        {items.map((f) => (
          <li key={`${f.id}-${f.fix_at ?? ''}`}>
            <article className={`fcard2 fcard2--${f.danger_code} ${f.status === 'closed' ? 'is-closed' : ''}`}>
              <div className="fcard2__bar" aria-hidden="true" />
              <div className="fcard2__body">
                <header className="fcard2__head">
                  <DangerCode code={f.danger_code} />
                  <Link to={`/p2h/${f.form_id}`} className="mono fcard2__unit">
                    {f.unit_code}
                  </Link>
                  <span className="small muted">
                    {f.site_name} · {modelOf({ brand: f.unit_brand, model: f.unit_model })}
                  </span>
                  <span className="grow" />
                  {f.status === 'closed' ? (
                    <span className="chip chip--ok">
                      <Icon name="check" size={13} stroke={2.6} /> {FIX_LABEL.closed}
                    </span>
                  ) : f.status === 'in_progress' ? (
                    <span className="chip chip--info">
                      <Icon name="wrench" size={13} stroke={2.4} /> {FIX_LABEL.in_progress}
                    </span>
                  ) : f.danger_code === 'AA' ? (
                    <span className="chip chip--stop">
                      <Icon name="stop" size={13} stroke={2.6} /> STOP OPERASI
                    </span>
                  ) : (
                    <span className="chip chip--warn">
                      <Icon name="alert" size={13} stroke={2.6} /> Perlu diperbaiki
                    </span>
                  )}
                </header>

                <h3 className="fcard2__text">
                  {plain(f.item_text)}
                  <span className="fcard2__cond"> — {CONDITION_LABEL[f.condition]}</span>
                </h3>
                {f.note && <p className="fcard2__note">“{f.note}”</p>}
                {f.photo_ids && f.photo_ids.length > 0 && <PhotoStrip items={f.photo_ids.slice(0, 6)} label={plain(f.item_text)} />}

                <div className="fcard2__meta small muted">
                  {f.status === 'closed' ? (
                    <>
                      Selesai {dateTime(f.fix_at)} oleh {f.fix_by_name}
                      {f.fix_note ? ` · ${f.fix_note}` : ''}
                    </>
                  ) : (
                    <>
                      Dilaporkan {f.inspector_name}, {mediumDate(f.shift_date)} Shift {shiftLabel(f.shift)}
                      {f.times > 1 ? ` · ${f.times}× berturut-turut` : ''} · sejak {ago(f.first_seen_at ?? f.last_seen_at)}
                    </>
                  )}
                </div>

                {f.status !== 'closed' && (
                  <div className="fcard2__due">
                    {f.overdue && f.due_at ? (
                      <span className="stop-text">
                        <Icon name="clock" size={14} /> Lewat batas 12 jam ({span((Date.now() - new Date(f.due_at).getTime()) / 3600_000)})
                      </span>
                    ) : f.due_at ? (
                      <span className="warn-text">
                        <Icon name="clock" size={14} /> Batas perbaikan {span((new Date(f.due_at).getTime() - Date.now()) / 3600_000)} lagi
                      </span>
                    ) : (
                      <span className="stop-text">
                        <Icon name="stop" size={14} /> Jangan dijalankan sebelum diperbaiki
                      </span>
                    )}
                    {f.maybe_fixed && (
                      <span className="chip chip--info">
                        <Icon name="info" size={13} /> P2H terbaru menyatakan Baik, mohon cek lalu tutup
                      </span>
                    )}
                  </div>
                )}

                {canFix && f.status !== 'closed' && (
                  <div className="fcard2__actions">
                    <button type="button" className="btn btn--sm btn--primary" onClick={() => setFix(f)}>
                      <Icon name="wrench" size={16} /> Tindak lanjut
                    </button>
                    <Link to={`/p2h/${f.form_id}`} className="btn btn--sm btn--ghost">
                      Buka P2H
                    </Link>
                  </div>
                )}
              </div>
            </article>
          </li>
        ))}
      </ul>

      <FixSheet answer={fix ? asAnswer(fix) : null} onClose={() => setFix(null)} onDone={refresh} />
    </div>
  );
}
