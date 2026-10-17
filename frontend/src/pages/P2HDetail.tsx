import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../components/Icon';
import { PhotoStrip } from '../components/Photos';
import { SignaturePad } from '../components/SignaturePad';
import { Confirm, DangerCode, DownloadMenu, ErrorBox, ResultChip, Sheet, Spinner } from '../components/ui';
import { ApiError, api, downloadFile } from '../lib/api';
import { CAN_FIX, useAuth } from '../lib/auth';
import { CONDITION_LABEL, FIX_LABEL, ago, dateTime, dayName, longDate, modelOf, num, plain, segments, shiftLabel, span, unitTitle } from '../lib/format';
import { useToast } from '../lib/toast';
import type { Answer, FixStatus, FormDetail } from '../lib/types';

export default function P2HDetailPage() {
  const { id } = useParams();
  const { user, setUser } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [fixFor, setFixFor] = useState<Answer | null>(null);
  const [signOpen, setSignOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [dl, setDl] = useState(false);

  const q = useQuery({ queryKey: ['p2h', id], queryFn: () => api.get<FormDetail>(`/api/p2h/${id}`) });

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['p2h', id] }),
      qc.invalidateQueries({ queryKey: ['dashboard'] }),
      qc.invalidateQueries({ queryKey: ['findings'] }),
      qc.invalidateQueries({ queryKey: ['history'] }),
      qc.invalidateQueries({ queryKey: ['units'] }),
    ]);
  };

  const del = useMutation({
    mutationFn: () => api.del(`/api/p2h/${id}`),
    onSuccess: async () => {
      await refresh();
      toast.push({ title: 'P2H dihapus', tone: 'info' });
      nav('/p2h', { replace: true });
    },
    onError: (e) => toast.push({ title: 'Gagal menghapus', body: e instanceof Error ? e.message : undefined, tone: 'danger' }),
  });

  const unsign = useMutation({
    mutationFn: () => api.del(`/api/p2h/${id}/verify`),
    onSuccess: refresh,
  });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return null;
  const { form: f, sections, params, permissions: perm } = q.data;
  const canFix = !!user && CAN_FIX.includes(user.role);

  const download = async (format: 'pdf' | 'xlsx' | 'docx') => {
    setDl(true);
    try {
      await downloadFile({ kind: 'p2h', format, id: f.id });
    } catch (e) {
      toast.push({ title: 'Gagal menyiapkan unduhan', body: e instanceof Error ? e.message : undefined, tone: 'danger' });
    } finally {
      window.setTimeout(() => setDl(false), 1200);
    }
  };

  const findings = sections.flatMap((s) => s.items).filter((i) => i.condition !== 'baik');

  return (
    <div className="page detail">
      <div className="crumbs">
        <Link to="/p2h" className="link">
          <Icon name="chevL" size={16} /> Riwayat
        </Link>
      </div>

      <header className={`dhead card dhead--${f.result}`}>
        <div className="dhead__main">
          <div className="eyebrow">
            P2H #{f.id} · Shift {shiftLabel(f.shift)}
          </div>
          <h1 className="dhead__code mono">{unitTitle({ code: f.unit_code, old_code: f.unit_old_code })}</h1>
          <div className="dhead__sub">
            {modelOf({ brand: f.unit_brand, model: f.unit_model }) || '—'} · {f.site_name}
            {f.location ? ` · ${f.location}` : ''}
            {f.job_site ? ` · ${f.job_site}` : ''}
          </div>
          <div className="dhead__meta small">
            <span>
              <Icon name="calendar" size={14} /> {longDate(f.shift_date)}
            </span>
            <span>
              <Icon name="user" size={14} /> {f.inspector_name}
            </span>
            <span>
              <Icon name="clock" size={14} /> {dateTime(f.filled_at || f.submitted_at)}
            </span>
            {f.edited_at && (
              <span className="muted">diubah {ago(f.edited_at)} oleh {f.edited_by_name}</span>
            )}
          </div>
        </div>
        <div className="dhead__side">
          <ResultChip result={f.result} />
          {f.sup_signed_at ? (
            <span className="chip chip--ok" title={`Diverifikasi ${dateTime(f.sup_signed_at)}`}>
              <Icon name="verified" size={14} stroke={2.4} /> Terverifikasi
            </span>
          ) : (
            <span className="chip chip--idle">
              <Icon name="clock" size={14} stroke={2.4} /> Menunggu verifikasi
            </span>
          )}
          <div className="dhead__counts small">
            {f.n_aa > 0 && <span className="stop-text">{f.n_aa} temuan AA</span>}
            {f.n_a > 0 && <span className="warn-text">{f.n_a} temuan A</span>}
            {f.n_aa + f.n_a === 0 && <span className="muted">tidak ada temuan</span>}
          </div>
        </div>
      </header>

      <div className="actionbar">
        <DownloadMenu onPick={download} busy={dl} />
        {perm.can_edit && (
          <Link to={`/p2h/${f.id}/ubah`} className="btn btn--ghost">
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

      {!f.sup_signed_at ? (
        <div className="banner banner--info">
          <Icon name="clock" size={18} />
          <div className="grow">
            <b>Menunggu verifikasi pengawas.</b> Status berubah menjadi <b>Terverifikasi</b> setelah pengawas memeriksa P2H ini dan menandatanganinya.
          </div>
        </div>
      ) : (
        <div className="banner banner--ok">
          <Icon name="verified" size={18} />
          <div className="grow">
            <b>Terverifikasi</b> oleh {f.sup_name}
            {f.sup_company ? ` (${f.sup_company})` : ''} · {dateTime(f.sup_signed_at)}
          </div>
        </div>
      )}

      {/* ---------- daftar cek ---------- */}
      {sections.map((s) => (
        <section key={s.code} className="card dsec">
          <header className="dsec__head">
            <h2 className="h2">{s.title}</h2>
            <span className="small muted">
              {s.items.filter((i) => i.condition === 'baik').length}/{s.items.length} baik
            </span>
          </header>
          <ol className="drows">
            {s.items.map((it) => (
              <li key={it.id} className={`drow ${it.condition !== 'baik' ? 'drow--bad' : ''}`}>
                <span className="drow__no">{it.item_no}</span>
                <div className="drow__main">
                  <div className="drow__text">
                    {segments(it.item_text).map((x, i) => (x.bold ? <strong key={i}>{x.text}</strong> : <span key={i}>{x.text}</span>))}
                  </div>
                  {it.condition !== 'baik' && (
                    <div className="drow__finding">
                      {it.note && <div className="drow__note">“{it.note}”</div>}
                      {it.photos?.length > 0 && <PhotoStrip items={it.photos.map((x) => x.id)} label={plain(it.item_text)} />}
                      <div className="drow__fix">
                        <FixBadge status={it.fix_status} />
                        {it.fix_status === 'closed' && (
                          <span className="small muted">
                            {it.fix_by_name} · {dateTime(it.fix_at)}
                            {it.fix_note ? ` · ${it.fix_note}` : ''}
                          </span>
                        )}
                        {it.fix_status !== 'closed' && it.due_at && <DueText due={it.due_at} />}
                        {canFix && it.fix_status !== 'closed' && (
                          <button type="button" className="btn btn--sm btn--ghost" onClick={() => setFixFor(it)}>
                            <Icon name="wrench" size={14} /> Tindak lanjut
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <div className="drow__chips">
                  <DangerCode code={it.danger_code} />
                  <span className={`cond cond--${it.condition}`}>
                    <Icon name={it.condition === 'baik' ? 'check' : it.condition === 'rusak' ? 'x' : 'wrench'} size={14} stroke={2.8} />
                    {CONDITION_LABEL[it.condition]}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}

      {/* ---------- parameter ---------- */}
      <section className="card dsec">
        <header className="dsec__head">
          <h2 className="h2">Parameter panel genset</h2>
          <span className="small muted">
            HM awal <b className="mono">{num(f.hm_start) || '—'}</b> · HM akhir <b className="mono">{num(f.hm_end) || '—'}</b>
          </span>
        </header>
        <table className="table table--tight dparams">
          <thead>
            <tr>
              <th>Parameter</th>
              <th className="num">Kosongan</th>
              <th className="num">Berbeban</th>
            </tr>
          </thead>
          <tbody>
            {params.map((p) => (
              <tr key={p.key}>
                <td>{p.label}</td>
                <td className="num mono">{p.idle != null ? `${num(p.idle)} ${p.unit}` : '—'}</td>
                <td className="num mono">{p.load != null ? `${num(p.load)} ${p.unit}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ---------- catatan + tanda tangan ---------- */}
      <section className="card dsec">
        <header className="dsec__head">
          <h2 className="h2">Info tambahan dan tindak lanjut</h2>
        </header>
        <div className="dnote">{f.notes || <span className="muted">Tidak ada catatan.</span>}</div>
        {findings.length > 0 && (
          <div className="small muted dnote__sum">
            {findings.length} butir ditandai rusak / perlu diperbaiki. Status perbaikan ada di daftar cek di atas dan di halaman Temuan.
          </div>
        )}
      </section>

      <section className="signs">
        <div className="sign card">
          <div className="eyebrow">Tanda tangan · Teknisi</div>
          {f.signature_png ? <img src={f.signature_png} alt={`Tanda tangan ${f.inspector_name}`} className="sign__img" /> : <div className="sign__img sign__img--none muted">tidak ada</div>}
          <div className="sign__name">( {f.inspector_name} )</div>
          <div className="small muted">
            {[f.inspector_nrp ? `No SID ${f.inspector_nrp}` : '', f.inspector_company].filter(Boolean).join(' · ')}
          </div>
          <div className="small muted">{dateTime(f.filled_at || f.submitted_at)}</div>
        </div>
        <div className={`sign card ${f.sup_signed_at ? 'sign--verified' : ''}`}>
          <div className="eyebrow">Verifikasi · Pengawas</div>
          {f.sup_signature_png ? (
            <img src={f.sup_signature_png} alt={`Tanda tangan ${f.sup_name}`} className="sign__img" />
          ) : (
            <div className="sign__img sign__img--none muted">menunggu verifikasi</div>
          )}
          <div className="sign__name">{f.sup_name ? `( ${f.sup_name} )` : '(                    )'}</div>
          {f.sup_signed_at ? (
            <>
              <div className="small muted">{[f.sup_nrp ? `No SID ${f.sup_nrp}` : '', f.sup_company].filter(Boolean).join(' · ')}</div>
              <div className="sign__stamp">
                <Icon name="verified" size={14} stroke={2.4} /> Terverifikasi · {dateTime(f.sup_signed_at)}
              </div>
            </>
          ) : (
            <div className="small muted">Belum diverifikasi</div>
          )}
        </div>
      </section>

      <p className="small muted detail__foot">
        {dayName(f.shift_date)}, {longDate(f.shift_date)} · dikirim {dateTime(f.submitted_at)}
      </p>

      <FixSheet answer={fixFor} onClose={() => setFixFor(null)} onDone={refresh} />
      <SignSheet
        open={signOpen}
        onClose={() => setSignOpen(false)}
        savedSig={user?.signature_png ?? null}
        formId={f.id}
        onDone={async (png) => {
          if (png && user) setUser({ ...user, signature_png: png, has_signature: true });
          await refresh();
        }}
      />
      <Confirm
        open={delOpen}
        danger
        title="Hapus P2H ini?"
        confirmLabel="Hapus"
        busy={del.isPending}
        onClose={() => setDelOpen(false)}
        onConfirm={() => del.mutate()}
        body={
          <>
            P2H <b className="mono">{f.unit_code}</b> tanggal {longDate(f.shift_date)} Shift {shiftLabel(f.shift)} akan dihapus permanen beserta temuannya. Pakai ini hanya untuk data uji coba atau salah isi.
          </>
        }
      />
    </div>
  );
}

function FixBadge({ status }: { status: FixStatus | null }) {
  if (!status) return null;
  const cls = status === 'closed' ? 'ok' : status === 'in_progress' ? 'info' : 'warn';
  return <span className={`chip chip--${cls}`}>{FIX_LABEL[status]}</span>;
}

function DueText({ due }: { due: string }) {
  const hours = (new Date(due).getTime() - Date.now()) / 3600_000;
  return hours >= 0 ? (
    <span className="small muted">batas perbaikan {span(hours)} lagi</span>
  ) : (
    <span className="small stop-text">lewat batas {span(hours)}</span>
  );
}

/* ---------- lembar tindak lanjut ---------- */

export function FixSheet({ answer, onClose, onDone }: { answer: Answer | null; onClose: () => void; onDone: () => Promise<unknown> | void }) {
  const toast = useToast();
  const [status, setStatus] = useState<'in_progress' | 'closed'>('closed');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!answer) return;
    setBusy(true);
    setErr(null);
    try {
      await api.patch(`/api/findings/${answer.id}`, { status, note: note.trim() || null });
      await onDone();
      toast.push({ title: status === 'closed' ? 'Temuan ditandai selesai' : 'Temuan: sedang diperbaiki', tone: 'ok' });
      setNote('');
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Gagal menyimpan.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={!!answer}
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
      {answer && (
        <div className="stack">
          <div className="fixinfo">
            <DangerCode code={answer.danger_code} />
            <div>
              <div>{segments(answer.item_text).map((x, i) => (x.bold ? <strong key={i}>{x.text}</strong> : <span key={i}>{x.text}</span>))}</div>
              {answer.note && <div className="small muted">“{answer.note}”</div>}
            </div>
          </div>
          <fieldset className="radios">
            <legend className="field__label">Statusnya sekarang</legend>
            <label className={`radio ${status === 'in_progress' ? 'is-on' : ''}`}>
              <input type="radio" name="st" checked={status === 'in_progress'} onChange={() => setStatus('in_progress')} />
              <span>
                <b>Sedang diperbaiki</b>
                <i>Teknisi sudah menangani, belum selesai.</i>
              </span>
            </label>
            <label className={`radio ${status === 'closed' ? 'is-on' : ''}`}>
              <input type="radio" name="st" checked={status === 'closed'} onChange={() => setStatus('closed')} />
              <span>
                <b>Sudah selesai diperbaiki</b>
                <i>{answer.danger_code === 'AA' ? 'Unit boleh dijalankan lagi (kalau tidak ada temuan AA lain).' : 'Temuan ditutup.'}</i>
              </span>
            </label>
          </fieldset>
          <div className="field">
            <label className="field__label" htmlFor="fixnote">
              Catatan perbaikan {status === 'closed' ? '(wajib)' : '(boleh kosong)'}
            </label>
            <textarea id="fixnote" className="input textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. Seal depan diganti, oli ditambah, level normal" maxLength={500} data-autofocus />
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

/* ---------- lembar tanda tangan pengawas ---------- */

function SignSheet({ open, onClose, savedSig, formId, onDone }: { open: boolean; onClose: () => void; savedSig: string | null; formId: number; onDone: (png: string | null) => Promise<unknown> | void }) {
  const toast = useToast();
  const [mode, setMode] = useState<'saved' | 'new'>(savedSig ? 'saved' : 'new');
  const [png, setPng] = useState<string | null>(null);
  const [save, setSave] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/api/p2h/${formId}/verify`, mode === 'saved' ? {} : { signature_png: png, save_signature: save });
      await onDone(mode === 'new' && save ? png : null);
      toast.push({ title: 'P2H terverifikasi', body: 'Statusnya sekarang Terverifikasi.', tone: 'ok' });
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
      title="Verifikasi pengawas"
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
        <p className="muted">
          Dengan menandatangani, Anda menyatakan sudah memeriksa form P2H ini (termasuk foto kerusakan). Setelah itu P2H berstatus <b>Terverifikasi</b> dan tidak bisa diubah lagi oleh teknisi.
        </p>
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

