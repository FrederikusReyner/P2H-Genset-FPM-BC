import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../components/Icon';
import { PhotoStrip } from '../../components/Photos';
import { DownloadMenu, Empty, ErrorBox, PageHead, Pager, Spinner } from '../../components/ui';
import { CAN_FIX, useAuth } from '../../lib/auth';
import { FIX_LABEL, addDays, ago, dateTime, mediumDate, shiftLabel, span, todayWita } from '../../lib/format';
import { FORM_PHOTO_BASE, RESULT_TEXT, RESULT_TONE, fmtNum, formPath, useFormFindings, useFormOverview, useFormRecords , lowerFirst } from '../../lib/forms';
import type { FormFinding } from '../../lib/types';
import { FormFixSheet, type FixTarget } from './FormRecord';
import { SiteChips, useFormSite } from './SiteChips';
import { useFormDownload } from './useFormDownload';

/* =====================================================================
   Riwayat isian satu jenis form
   ===================================================================== */

export function FormHistoryPage() {
  const { code = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const ov = useFormOverview(code);
  const subject = Number(sp.get('subject')) || null;
  const unverified = sp.get('unverified') === '1';
  const result = sp.get('result') ?? '';
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  const { download, busy } = useFormDownload(code);
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [site, setSite] = useFormSite();
  const list = useFormRecords(code, { site_id: site, subject_id: subject, unverified, result: result || undefined, from: from || undefined, to: to || undefined, q: q.trim() || undefined, limit: 30, offset });
  const setParam = (k: string, v: string | null) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    setSp(n, { replace: true });
    setOffset(0);
  };
  const t = ov.data?.type;

  return (
    <div className="page">
      <PageHead eyebrow={t?.short_name ?? ''} title="Riwayat">
        <DownloadMenu
          label="Unduh rekap"
          busy={busy}
          onPick={(f) => void download(f, { from: from || (to ? addDays(to, -29) : addDays(todayWita(), -29)), to: to || todayWita(), site_id: site })}
        />
      </PageHead>
      <SiteChips
        value={site}
        onChange={(v) => {
          setSite(v);
          setOffset(0);
          if (subject && v && ov.data?.subjects.find((s) => s.id === subject)?.site_id !== v) setParam('subject', null);
        }}
      />
      <div className="ffilters">
        <select className="input input--auto" value={subject ?? ''} onChange={(e) => setParam('subject', e.target.value || null)} aria-label="Objek">
          <option value="">Semua {lowerFirst(t?.subject_label) ?? 'objek'}</option>
          {ov.data?.subjects.filter((s) => !site || s.site_id === site).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select className="input input--auto" value={result} onChange={(e) => setParam('result', e.target.value || null)} aria-label="Hasil">
          <option value="">Semua hasil</option>
          <option value="stop">STOP</option>
          <option value="finding">Ada temuan</option>
          <option value="ok">Semua baik</option>
        </select>
        <label className="ffilters__date">
          <span className="small muted">Dari</span>
          <input type="date" className="input input--auto" value={from} max={to || todayWita()} onChange={(e) => setParam('from', e.target.value || null)} aria-label="Dari tanggal" />
        </label>
        <label className="ffilters__date">
          <span className="small muted">s.d.</span>
          <input type="date" className="input input--auto" value={to} min={from || undefined} max={todayWita()} onChange={(e) => setParam('to', e.target.value || null)} aria-label="Sampai tanggal" />
        </label>
        <label className="check check--chip">
          <input type="checkbox" checked={unverified} onChange={(e) => setParam('unverified', e.target.checked ? '1' : null)} />
          <span>Belum diverifikasi</span>
        </label>
        <label className="searchbox">
          <Icon name="search" size={18} />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOffset(0);
            }}
            placeholder="Cari nama / pengisi…"
            aria-label="Cari"
          />
        </label>
      </div>

      {list.isLoading && <Spinner />}
      {list.error && !list.data && <ErrorBox error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && list.data.items.length === 0 && <Empty icon="history" title="Belum ada isian" hint="Isian yang cocok dengan saringan akan muncul di sini." />}
      <ul className="hlist">
        {list.data?.items.map((r) => (
          <li key={r.id}>
            <Link to={formPath(code, `/r/${r.id}`)} className={`hitem hitem--${RESULT_TONE[r.result]}`}>
              <span className="hitem__bar" aria-hidden="true" />
              <span className="hitem__main">
                <span className="hitem__title">
                  <b className="mono">{r.subject_name}</b>
                  <span className="small muted">
                    {mediumDate(r.record_date)}
                    {r.shift ? ` · Shift ${shiftLabel(r.shift)}` : ''} · {r.site_name}
                  </span>
                </span>
                <span className="small muted">
                  {r.filler_name} · {dateTime(r.filled_at)}
                </span>
              </span>
              <span className="hitem__side">
                <span className={`chip chip--${RESULT_TONE[r.result]}`}>{RESULT_TEXT[r.result]}</span>
                {r.verified ? (
                  <span className="chip chip--ok">
                    <Icon name="verified" size={13} stroke={2.4} /> Terverifikasi
                  </span>
                ) : (
                  <span className="chip chip--idle">Menunggu verifikasi</span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="small muted">Unduh rekap memakai tanggal &amp; site di atas (tanpa tanggal: 30 hari terakhir). Isinya angka utama, grafik, daftar isian, dan daftar temuan.</p>
      {list.data && <Pager total={list.data.total} limit={list.data.limit} offset={offset} onChange={setOffset} />}
    </div>
  );
}

/* =====================================================================
   Temuan satu jenis form
   ===================================================================== */

export function FormFindingsPage() {
  const { code = '' } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const ov = useFormOverview(code);
  const [tab, setTab] = useState<'open' | 'closed'>('open');
  const [site, setSite] = useFormSite();
  const q = useFormFindings(code, tab, site);
  const open = useFormFindings(code, 'open', site);
  const [fix, setFix] = useState<FixTarget | null>(null);
  const canFix = !!user && CAN_FIX.includes(user.role);
  const items = q.data?.items ?? [];
  const t = ov.data?.type;

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['form-findings'] }),
      qc.invalidateQueries({ queryKey: ['form'] }),
      qc.invalidateQueries({ queryKey: ['forms'] }),
      qc.invalidateQueries({ queryKey: ['form-record'] }),
    ]);
  };

  return (
    <div className="page">
      <PageHead eyebrow={t ? `${t.short_name} · batas perbaikan ${t.fix_hours} jam` : ''} title="Temuan" />
      <SiteChips value={site} onChange={setSite} />
      <div className="tabs" role="tablist" aria-label="Status temuan">
        <button type="button" role="tab" aria-selected={tab === 'open'} className={`tab ${tab === 'open' ? 'is-on' : ''}`} onClick={() => setTab('open')}>
          Terbuka {(open.data?.items.length ?? 0) > 0 && <span className="badge badge--warn">{open.data?.items.length}</span>}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'closed'} className={`tab ${tab === 'closed' ? 'is-on' : ''}`} onClick={() => setTab('closed')}>
          Selesai
        </button>
      </div>

      {q.isLoading && <Spinner />}
      {q.error && !q.data && <ErrorBox error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && items.length === 0 && (
        <Empty icon="check" title={tab === 'open' ? 'Tidak ada temuan terbuka' : 'Belum ada temuan yang selesai'} hint={tab === 'open' ? 'Semua temuan sudah ditindaklanjuti.' : undefined} />
      )}

      <ul className="fcards">
        {items.map((f) => (
          <li key={f.id}>
            <FindingCard
              code={code}
              f={f}
              canFix={canFix}
              onFix={() => setFix({ id: f.id, item_text: f.item_text, subject_name: f.subject_name, severity: f.severity, note: f.note, plan: f.fix_plan_date })}
            />
          </li>
        ))}
      </ul>
      <FormFixSheet code={code} target={fix} onClose={() => setFix(null)} onDone={refresh} />
    </div>
  );
}

function FindingCard({ code, f, canFix, onFix }: { code: string; f: FormFinding; canFix: boolean; onFix: () => void }) {
  const closed = f.fix_status === 'closed';
  const vals = f.kind === 'measure' && f.values ? Object.values(f.values).filter((v) => v != null) : [];
  return (
    <article className={`fcard2 fcard2--${f.severity === 'stop' ? 'AA' : 'A'} ${closed ? 'is-closed' : ''}`}>
      <div className="fcard2__bar" aria-hidden="true" />
      <div className="fcard2__body">
        <header className="fcard2__head">
          {f.severity === 'stop' && <span className="dcode dcode--AA">STOP</span>}
          <Link to={formPath(code, `/r/${f.record_id}`)} className="mono fcard2__unit">
            {f.subject_name}
          </Link>
          <span className="small muted">
            {f.site_name} · {f.section_title}
          </span>
          <span className="grow" />
          <span className={`chip chip--${closed ? 'ok' : f.fix_status === 'in_progress' ? 'info' : f.severity === 'stop' ? 'stop' : 'warn'}`}>
            {closed ? FIX_LABEL.closed : f.fix_status === 'in_progress' ? FIX_LABEL.in_progress : f.severity === 'stop' ? 'STOP' : 'Perlu diperbaiki'}
          </span>
        </header>
        <h3 className="fcard2__text">
          {f.item_text}
          <span className="fcard2__cond">
            {' '}
            — {f.kind === 'measure' ? `di luar batas (${vals.map((v) => fmtNum(v as number)).join(' / ')}${f.unit ? ` ${f.unit}` : ''})` : f.bad_label}
          </span>
        </h3>
        {f.note && <p className="fcard2__note">“{f.note}”</p>}
        {f.photo_ids.length > 0 && <PhotoStrip items={f.photo_ids.slice(0, 6)} label={f.item_text} base={FORM_PHOTO_BASE} />}
        <div className="fcard2__meta small muted">
          {closed ? (
            <>
              Selesai {dateTime(f.fix_at)} oleh {f.fix_by_name}
              {f.fix_note ? ` · ${f.fix_note}` : ''}
            </>
          ) : (
            <>
              Dilaporkan {f.filler_name}, {mediumDate(f.record_date)}
              {f.shift ? ` Shift ${shiftLabel(f.shift)}` : ''} · sejak {ago(f.seen_at)}
              {f.fix_plan_date ? ` · rencana selesai ${mediumDate(f.fix_plan_date)}` : ''}
            </>
          )}
        </div>
        {!closed && (
          <div className="fcard2__due">
            {f.severity === 'stop' ? (
              <span className="stop-text">
                <Icon name="stop" size={14} /> Jangan dioperasikan sebelum diperbaiki
              </span>
            ) : f.overdue && f.due_at ? (
              <span className="stop-text">
                <Icon name="clock" size={14} /> Lewat batas ({span((Date.now() - new Date(f.due_at).getTime()) / 3600_000)})
              </span>
            ) : f.due_at ? (
              <span className="warn-text">
                <Icon name="clock" size={14} /> Batas perbaikan {span((new Date(f.due_at).getTime() - Date.now()) / 3600_000)} lagi
              </span>
            ) : null}
          </div>
        )}
        {canFix && !closed && (
          <div className="fcard2__actions">
            <button type="button" className="btn btn--sm btn--primary" onClick={onFix}>
              <Icon name="wrench" size={16} /> Tindak lanjut
            </button>
            <Link to={formPath(code, `/r/${f.record_id}`)} className="btn btn--sm btn--ghost">
              Buka isian
            </Link>
          </div>
        )}
      </div>
    </article>
  );
}
