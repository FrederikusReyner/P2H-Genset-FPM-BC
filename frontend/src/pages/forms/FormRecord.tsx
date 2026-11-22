import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../components/Icon';
import { PhotoStrip } from '../../components/Photos';
import { SignaturePad } from '../../components/SignaturePad';
import { Confirm, ErrorBox, Sheet, Spinner } from '../../components/ui';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { FIX_LABEL, ago, dateTime, longDate, mediumDate, shiftLabel, span, todayWita } from '../../lib/format';
import { FORM_PHOTO_BASE, RESULT_TEXT, RESULT_TONE, fmtNum, formPath, limitText } from '../../lib/forms';
import { useToast } from '../../lib/toast';
import type { FixStatus, FormAnswer, FormRecordDetail, FormSeverity } from '../../lib/types';

export default function FormRecordPage() {
  const { code = '', id } = useParams();
  const { user, setUser } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [fixFor, setFixFor] = useState<FixTarget | null>(null);
  const [signOpen, setSignOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);

  const q = useQuery({ queryKey: ['form-record', code, id], queryFn: () => api.get<FormRecordDetail>(`/api/forms/${code}/records/${id}`) });
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['form-record', code, id] }),
      qc.invalidateQueries({ queryKey: ['form'] }),
      qc.invalidateQueries({ queryKey: ['forms'] }),
      qc.invalidateQueries({ queryKey: ['form-records'] }),
      qc.invalidateQueries({ queryKey: ['form-findings'] }),
    ]);
  };
  const del = useMutation({
    mutationFn: () => api.del(`/api/forms/${code}/records/${id}`),
    onSuccess: async () => {
      await refresh();
      toast.push({ title: 'Isian dihapus', tone: 'info' });
      nav(formPath(code, '/riwayat'), { replace: true });
    },
    onError: (e) => toast.push({ title: 'Gagal menghapus', body: e instanceof Error ? e.message : undefined, tone: 'danger' }),
  });
  const unsign = useMutation({ mutationFn: () => api.del(`/api/forms/${code}/records/${id}/verify`), onSuccess: refresh });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return null;
  const { type: t, record: r, sections, permissions: perm } = q.data;
  const headerRows = t.header_fields.filter((f) => r.header[f.key] != null && String(r.header[f.key]) !== '');
  const resultTone = RESULT_TONE[r.result];

  return (
    <div className="page detail frecord">
      <div className="crumbs noprint">
        <Link to={formPath(code, '/riwayat')} className="link">
          <Icon name="chevL" size={16} /> Riwayat {t.short_name}
        </Link>
      </div>

      <div className="printhead">
        <b>BERAU COAL GREEN MINING SYSTEM</b>
        <span>{t.name}</span>
        {t.doc_no && <span className="small">{t.doc_no}</span>}
      </div>

      <header className={`dhead card dhead--${r.result === 'stop' ? 'stop_aa' : r.result === 'finding' ? 'temuan_a' : 'baik'}`}>
        <div className="dhead__main">
          <div className="eyebrow">
            {t.short_name} #{r.id}
            {r.shift ? ` · Shift ${shiftLabel(r.shift)}` : ''}
          </div>
          <h1 className="dhead__code mono">{r.subject_name}</h1>
          <div className="dhead__sub">{[r.subject_detail, r.site_name].filter(Boolean).join(' · ')}</div>
          <div className="dhead__meta small">
            <span>
              <Icon name="calendar" size={14} /> {longDate(r.record_date)}
            </span>
            <span>
              <Icon name="user" size={14} /> {r.filler_name}
            </span>
            <span>
              <Icon name="clock" size={14} /> {dateTime(r.filled_at)}
            </span>
            {r.edited_at && <span className="muted">diubah {ago(r.edited_at)} oleh {r.edited_by_name}</span>}
          </div>
        </div>
        <div className="dhead__side">
          <span className={`chip chip--${resultTone}`}>
            <Icon name={r.result === 'stop' ? 'stop' : r.result === 'finding' ? 'alert' : 'check'} size={15} stroke={2.4} /> {RESULT_TEXT[r.result]}
          </span>
          {r.sup_signed_at ? (
            <span className="chip chip--ok">
              <Icon name="verified" size={14} stroke={2.4} /> Terverifikasi
            </span>
          ) : (
            <span className="chip chip--idle">
              <Icon name="clock" size={14} stroke={2.4} /> Menunggu verifikasi
            </span>
          )}
          <div className="dhead__counts small">
            {r.n_stop > 0 && <span className="stop-text">{r.n_stop} temuan STOP</span>}
            {r.n_fix > 0 && <span className="warn-text">{r.n_fix} temuan perbaiki</span>}
            {r.n_stop + r.n_fix === 0 && <span className="muted">tidak ada temuan</span>}
          </div>
        </div>
      </header>

      <div className="actionbar noprint">
        <button type="button" className="btn btn--dark" onClick={() => window.print()}>
          <Icon name="print" size={18} /> Cetak / PDF
        </button>
        {perm.can_edit && (
          <Link to={formPath(code, `/r/${r.id}/ubah`)} className="btn btn--ghost">
            <Icon name="pencil" size={18} /> Ubah
          </Link>
        )}
        {perm.can_sign && (
          <button type="button" className="btn btn--primary" onClick={() => setSignOpen(true)}>
            <Icon name="verified" size={18} /> Verifikasi &amp; tanda tangan
          </button>
        )}
        <span className="grow" />
        {perm.can_unsign && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => unsign.mutate()} disabled={unsign.isPending}>
            Batalkan verifikasi
          </button>
        )}
        {perm.can_delete && (
          <button type="button" className="btn btn--sm btn--ghost btn--danger-text" onClick={() => setDelOpen(true)}>
            <Icon name="trash" size={16} /> Hapus
          </button>
        )}
      </div>

      {r.sup_signed_at ? (
        <div className="banner banner--ok">
          <Icon name="verified" size={18} />
          <div className="grow">
            <b>Terverifikasi</b> oleh {r.sup_name} · {dateTime(r.sup_signed_at)}
            {r.sup_note && (
              <div>
                <b>Catatan / rekomendasi:</b> {r.sup_note}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="banner banner--info noprint">
          <Icon name="clock" size={18} />
          <div className="grow">
            <b>Menunggu verifikasi {t.verifier_label.toLowerCase()}.</b> Statusnya berubah menjadi Terverifikasi setelah diperiksa dan ditandatangani.
          </div>
        </div>
      )}

      {headerRows.length > 0 && (
        <section className="card dsec">
          <header className="dsec__head">
            <h2 className="h2">Data pemeriksaan</h2>
          </header>
          <dl className="hdl">
            {headerRows.map((f) => (
              <div key={f.key} className={f.type === 'textarea' ? 'hdl--wide' : ''}>
                <dt>{f.label}</dt>
                <dd className={f.type === 'number' ? 'mono' : ''}>
                  {f.type === 'date' ? mediumDate(String(r.header[f.key])) : f.type === 'number' ? fmtNum(r.header[f.key]) : String(r.header[f.key])}
                  {f.unit ? ` ${f.unit}` : ''}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {sections.map((s) => {
        const checks = s.items.filter((i) => i.kind === 'check');
        return (
          <section key={`${s.order}-${s.title}`} className="card dsec">
            <header className="dsec__head">
              <h2 className="h2">{s.title}</h2>
              {checks.length > 0 && (
                <span className="small muted">
                  {checks.filter((i) => i.condition === 'good').length}/{checks.length} {checks[0].good_label?.toLowerCase()}
                </span>
              )}
            </header>
            <ol className="drows">
              {s.items.map((a) => (
                <AnswerRow key={a.id} a={a} canFix={perm.can_fix} onFix={() => setFixFor(asTarget(a, r.subject_name))} />
              ))}
            </ol>
          </section>
        );
      })}

      <section className="card dsec">
        <header className="dsec__head">
          <h2 className="h2">Catatan</h2>
        </header>
        <div className="dnote">{r.notes || <span className="muted">Tidak ada catatan.</span>}</div>
      </section>

      <section className="signs">
        <div className="sign card">
          <div className="eyebrow">Tanda tangan · {t.filler_label}</div>
          {r.signature_png ? <img src={r.signature_png} alt={`Tanda tangan ${r.filler_name}`} className="sign__img" /> : <div className="sign__img sign__img--none muted">tidak ada</div>}
          <div className="sign__name">( {r.filler_name} )</div>
          <div className="small muted">{r.filler_nrp ? `No SID ${r.filler_nrp}` : ''}</div>
          <div className="small muted">{dateTime(r.filled_at)}</div>
        </div>
        <div className={`sign card ${r.sup_signed_at ? 'sign--verified' : ''}`}>
          <div className="eyebrow">Verifikasi · {t.verifier_label}</div>
          {r.sup_signature_png ? <img src={r.sup_signature_png} alt={`Tanda tangan ${r.sup_name}`} className="sign__img" /> : <div className="sign__img sign__img--none muted">menunggu verifikasi</div>}
          <div className="sign__name">{r.sup_name ? `( ${r.sup_name} )` : '(                    )'}</div>
          {r.sup_signed_at ? (
            <div className="sign__stamp">
              <Icon name="verified" size={14} stroke={2.4} /> Terverifikasi · {dateTime(r.sup_signed_at)}
            </div>
          ) : (
            <div className="small muted">Belum diverifikasi</div>
          )}
        </div>
      </section>

      <FormFixSheet code={code} target={fixFor} onClose={() => setFixFor(null)} onDone={refresh} />
      <VerifySheet
        open={signOpen}
        code={code}
        id={r.id}
        hasFindings={r.n_stop + r.n_fix > 0}
        savedSig={user?.signature_png ?? null}
        onClose={() => setSignOpen(false)}
        onDone={async (png) => {
          if (png && user) setUser({ ...user, signature_png: png, has_signature: true });
          await refresh();
        }}
      />
      <Confirm
        open={delOpen}
        danger
        title="Hapus isian ini?"
        confirmLabel="Hapus"
        busy={del.isPending}
        onClose={() => setDelOpen(false)}
        onConfirm={() => del.mutate()}
        body={
          <>
            {t.short_name} <b className="mono">{r.subject_name}</b> tanggal {longDate(r.record_date)} akan dihapus permanen beserta temuan dan fotonya. Pakai hanya untuk data uji coba atau salah isi.
          </>
        }
      />
    </div>
  );
}

/* ---------- satu baris jawaban ---------- */

function AnswerRow({ a, canFix, onFix }: { a: FormAnswer; canFix: boolean; onFix: () => void }) {
  const bad = a.condition === 'bad';
  const limit = limitText(a.min_value, a.max_value, a.unit);
  return (
    <li className={`drow ${bad ? 'drow--bad' : ''}`}>
      <span className="drow__no">{a.item_label ?? ''}</span>
      <div className="drow__main">
        <div className="drow__text">{a.item_text}</div>
        {a.item_spec && <div className="small muted">{a.item_spec}</div>}
        {a.kind === 'measure' && a.values && <MeasureValues a={a} />}
        {a.kind === 'measure' && !a.values && <div className="small muted">tidak diukur</div>}
        {a.kind === 'measure' && limit && !a.item_spec?.includes('maks') && <div className="small muted">standar {limit}</div>}
        {a.kind === 'input' && (
          <div className="mono">{a.values?.value ? (/^\d{4}-\d{2}-\d{2}$/.test(String(a.values.value)) ? mediumDate(String(a.values.value)) : String(a.values.value)) : '—'}</div>
        )}
        {(a.note || a.photos.length > 0 || a.is_finding) && (
          <div className="drow__finding">
            {a.note && <div className="drow__note">“{a.note}”</div>}
            {a.photos.length > 0 && <PhotoStrip items={a.photos} label={a.item_text} base={FORM_PHOTO_BASE} />}
            {a.is_finding && (
              <div className="drow__fix">
                <FixBadge status={a.fix_status} />
                {a.fix_plan_date && a.fix_status !== 'closed' && <span className="small muted">rencana selesai {mediumDate(a.fix_plan_date)}</span>}
                {a.fix_status === 'closed' && (
                  <span className="small muted">
                    {a.fix_by_name} · {dateTime(a.fix_at)}
                    {a.fix_note ? ` · ${a.fix_note}` : ''}
                  </span>
                )}
                {a.fix_status !== 'closed' && a.due_at && <DueText due={a.due_at} />}
                {canFix && a.fix_status !== 'closed' && (
                  <button type="button" className="btn btn--sm btn--ghost noprint" onClick={onFix}>
                    <Icon name="wrench" size={14} /> Tindak lanjut
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="drow__chips">
        {a.severity === 'stop' && a.kind !== 'input' && <span className="dcode dcode--AA">STOP</span>}
        {a.kind === 'check' && a.condition && (
          <span className={`cond cond--${a.condition === 'good' ? 'baik' : a.severity === 'stop' ? 'rusak' : 'perbaiki'}`}>
            <Icon name={a.condition === 'good' ? 'check' : 'x'} size={14} stroke={2.8} />
            {a.condition === 'good' ? a.good_label : a.bad_label}
          </span>
        )}
        {a.kind === 'check' && !a.condition && <span className="small muted">dilewati</span>}
        {a.kind === 'measure' && a.condition && (
          <span className={`cond cond--${a.condition === 'good' ? 'baik' : 'perbaiki'}`}>{a.condition === 'good' ? 'Normal' : 'Di luar batas'}</span>
        )}
      </div>
    </li>
  );
}

function MeasureValues({ a }: { a: FormAnswer }) {
  const entries = Object.entries(a.values ?? {});
  const out = (v: unknown) => {
    const n = typeof v === 'number' ? v : null;
    return n != null && ((a.min_value != null && n < a.min_value) || (a.max_value != null && n > a.max_value));
  };
  const labelOf = (k: string) =>
    ({ v: 'Hasil', k_r: 'Kosong R', k_s: 'Kosong S', k_t: 'Kosong T', m_r: 'Muatan R', m_s: 'Muatan S', m_t: 'Muatan T' })[k] ?? k;
  return (
    <div className="mvals">
      {entries.map(([k, v]) => (
        <span key={k} className={`mval ${out(v) ? 'is-out' : ''}`}>
          <i>{labelOf(k)}</i>
          <b className="mono">
            {fmtNum(v as number | null)}
            {v != null && a.unit ? ` ${a.unit}` : ''}
          </b>
        </span>
      ))}
    </div>
  );
}

export function FixBadge({ status }: { status: FixStatus | null }) {
  if (!status) return null;
  const cls = status === 'closed' ? 'ok' : status === 'in_progress' ? 'info' : 'warn';
  return <span className={`chip chip--${cls}`}>{FIX_LABEL[status]}</span>;
}

export function DueText({ due }: { due: string }) {
  const hours = (new Date(due).getTime() - Date.now()) / 3600_000;
  return hours >= 0 ? <span className="small muted">batas perbaikan {span(hours)} lagi</span> : <span className="small stop-text">lewat batas {span(hours)}</span>;
}

/* ---------- tindak lanjut temuan ---------- */

export interface FixTarget {
  id: number;
  item_text: string;
  subject_name: string;
  severity: FormSeverity;
  note: string | null;
  plan: string | null;
}
const asTarget = (a: FormAnswer, subject: string): FixTarget => ({ id: a.id, item_text: a.item_text, subject_name: subject, severity: a.severity, note: a.note, plan: a.fix_plan_date });

export function FormFixSheet({ code, target, onClose, onDone }: { code: string; target: FixTarget | null; onClose: () => void; onDone: () => Promise<unknown> | void }) {
  const toast = useToast();
  const [status, setStatus] = useState<'in_progress' | 'closed'>('closed');
  const [note, setNote] = useState('');
  const [plan, setPlan] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!target) return;
    setBusy(true);
    setErr(null);
    try {
      await api.patch(`/api/forms/${code}/findings/${target.id}`, { status, note: note.trim() || null, plan_date: plan || null });
      await onDone();
      toast.push({ title: status === 'closed' ? 'Temuan ditandai selesai' : 'Temuan: sedang diperbaiki', tone: 'ok' });
      setNote('');
      setPlan('');
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Gagal menyimpan.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={!!target}
      onClose={onClose}
      title="Tindak lanjut temuan"
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Batal
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={busy || (status === 'closed' && note.trim().length < 3)}>
            {busy ? 'Menyimpan…' : 'Simpan'}
          </button>
        </>
      }
    >
      {target && (
        <div className="stack">
          <div className="fixinfo">
            {target.severity === 'stop' && <span className="dcode dcode--AA">STOP</span>}
            <div>
              <div>
                <b className="mono">{target.subject_name}</b> · {target.item_text}
              </div>
              {target.note && <div className="small muted">“{target.note}”</div>}
            </div>
          </div>
          <fieldset className="radios">
            <legend className="field__label">Statusnya sekarang</legend>
            <label className={`radio ${status === 'in_progress' ? 'is-on' : ''}`}>
              <input type="radio" name="st" checked={status === 'in_progress'} onChange={() => setStatus('in_progress')} />
              <span>
                <b>Sedang diperbaiki</b>
                <i>Sudah ditangani, belum selesai. Isi rencana selesainya.</i>
              </span>
            </label>
            <label className={`radio ${status === 'closed' ? 'is-on' : ''}`}>
              <input type="radio" name="st" checked={status === 'closed'} onChange={() => setStatus('closed')} />
              <span>
                <b>Sudah selesai diperbaiki</b>
                <i>{target.severity === 'stop' ? 'Boleh dioperasikan lagi (kalau tidak ada temuan STOP lain).' : 'Temuan ditutup.'}</i>
              </span>
            </label>
          </fieldset>
          {status === 'in_progress' && (
            <div className="field">
              <label className="field__label" htmlFor="fplan">
                Rencana penyelesaian {target.plan ? `(sekarang ${mediumDate(target.plan)})` : ''}
              </label>
              <input id="fplan" className="input input--auto" type="date" value={plan} min={todayWita()} onChange={(e) => setPlan(e.target.value)} />
            </div>
          )}
          <div className="field">
            <label className="field__label" htmlFor="fixnote">
              {status === 'closed' ? 'Tindakan perbaikan (wajib)' : 'Tindakan (boleh kosong)'}
            </label>
            <textarea id="fixnote" className="input textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} data-autofocus />
          </div>
          {err && (
            <div className="banner banner--stop" role="alert">
              <Icon name="alert" size={18} />
              <div className="grow">{err}</div>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

/* ---------- verifikasi pengawas ---------- */

function VerifySheet({
  open,
  code,
  id,
  hasFindings,
  savedSig,
  onClose,
  onDone,
}: {
  open: boolean;
  code: string;
  id: number;
  hasFindings: boolean;
  savedSig: string | null;
  onClose: () => void;
  onDone: (png: string | null) => Promise<unknown> | void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<'saved' | 'new'>(savedSig ? 'saved' : 'new');
  const [png, setPng] = useState<string | null>(null);
  const [save, setSave] = useState(true);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/api/forms/${code}/records/${id}/verify`, { ...(mode === 'saved' ? {} : { signature_png: png, save_signature: save }), note: note.trim() || null });
      await onDone(mode === 'new' && save ? png : null);
      toast.push({ title: 'Terverifikasi', tone: 'ok' });
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Gagal menyimpan.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Verifikasi"
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Batal
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void go()} disabled={busy || (mode === 'new' && !png)}>
            {busy ? 'Menyimpan…' : 'Verifikasi'}
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="muted">Dengan menandatangani, Anda menyatakan sudah memeriksa isian ini termasuk fotonya. Setelah itu isian tidak bisa diubah lagi oleh pengisi.</p>
        <div className="field">
          <label className="field__label" htmlFor="vnote">
            {hasFindings ? 'Rekomendasi (mis. Stop / tetap beroperasi, alasannya)' : 'Catatan (boleh kosong)'}
          </label>
          <textarea id="vnote" className="input textarea" rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        </div>
        {savedSig && (
          <div className="seg seg--block" role="radiogroup" aria-label="Sumber tanda tangan">
            <button type="button" role="radio" aria-checked={mode === 'saved'} className={`seg__btn ${mode === 'saved' ? 'is-on' : ''}`} onClick={() => setMode('saved')}>
              Pakai tanda tangan saya
            </button>
            <button type="button" role="radio" aria-checked={mode === 'new'} className={`seg__btn ${mode === 'new' ? 'is-on' : ''}`} onClick={() => setMode('new')}>
              Gambar ulang
            </button>
          </div>
        )}
        {mode === 'saved' && savedSig ? (
          <div className="sigprev">
            <img src={savedSig} alt="Tanda tangan tersimpan" />
          </div>
        ) : (
          <>
            <SignaturePad onChange={setPng} />
            <label className="check">
              <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
              <span>Simpan sebagai tanda tangan saya</span>
            </label>
          </>
        )}
        {err && (
          <div className="banner banner--stop" role="alert">
            <Icon name="alert" size={18} />
            <div className="grow">{err}</div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
