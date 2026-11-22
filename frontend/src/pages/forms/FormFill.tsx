import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../components/Icon';
import { PhotoPicker } from '../../components/Photos';
import { SignaturePad } from '../../components/SignaturePad';
import { Empty, ErrorBox, Field, SectionTitle, Segmented, Spinner } from '../../components/ui';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { addDays, dayName, parseNum, shiftLabel, shortDate, todayWita } from '../../lib/format';
import { enqueue } from '../../lib/outbox';
import { FORM_PHOTO_BASE, RESULT_TEXT, formPath, limitText, useFormChecklist, useFormOverview , lowerFirst } from '../../lib/forms';
import { MAX_PHOTOS, compressImage } from '../../lib/photos';
import type { FormItem, FormOverview, FormRecordDetail, FormResult, FormSection, FormSubject, HeaderField } from '../../lib/types';
import { SiteChips, useFormSite } from './SiteChips';

/* =====================================================================
   Isi / ubah form digital (semua jenis form memakai halaman ini)
   ===================================================================== */

interface Ans {
  c: 'good' | 'bad' | null;
  values: Record<string, string>;
  value: string;
  note: string;
  plan: string;
  photos: string[];
  keep: number[];
}
const EMPTY: Ans = { c: null, values: {}, value: '', note: '', plan: '', photos: [], keep: [] };
const newUuid = () => {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

/** Hasil satu butir ukur: null = belum diisi, 'bad' = ada angka di luar batas. */
function measureState(it: FormItem, a: Ans | undefined): { any: boolean; full: boolean; out: boolean; invalid: boolean } {
  const fields = it.fields.length ? it.fields : [{ key: 'v', label: 'Hasil' }];
  let any = false;
  let full = true;
  let out = false;
  let invalid = false;
  for (const f of fields) {
    const n = parseNum(a?.values[f.key] ?? '');
    if (n == null) {
      full = false;
      continue;
    }
    if (Number.isNaN(n)) {
      invalid = true;
      continue;
    }
    any = true;
    if ((it.min_value != null && n < it.min_value) || (it.max_value != null && n > it.max_value)) out = true;
  }
  return { any, full, out, invalid };
}

/** Butir dianggap "temuan" (untuk ringkasan di bawah). */
function isBad(it: FormItem, a: Ans | undefined) {
  if (it.kind === 'check') return a?.c === 'bad';
  if (it.kind === 'measure') return measureState(it, a).out;
  return false;
}
function isAnswered(it: FormItem, a: Ans | undefined) {
  if (it.kind === 'check') return !!a?.c;
  if (it.kind === 'measure') return it.required ? measureState(it, a).full : measureState(it, a).any;
  return !!a?.value.trim();
}

export function NewFormPage() {
  const { code = '' } = useParams();
  const [sp] = useSearchParams();
  const ov = useFormOverview(code);
  const [nonce, setNonce] = useState(0);
  if (ov.isLoading) return <Spinner />;
  if (ov.error && !ov.data) return <ErrorBox error={ov.error} onRetry={() => void ov.refetch()} />;
  if (!ov.data) return null;
  return (
    <FormBody
      key={`${sp.get('subject') ?? 'x'}-${nonce}`}
      code={code}
      ov={ov.data}
      presetSubject={Number(sp.get('subject')) || null}
      onAgain={() => {
        setNonce((n) => n + 1);
        window.scrollTo({ top: 0 });
      }}
    />
  );
}

export function EditFormPage() {
  const { code = '', id } = useParams();
  const ov = useFormOverview(code);
  const q = useQuery({ queryKey: ['form-record', code, id], queryFn: () => api.get<FormRecordDetail>(`/api/forms/${code}/records/${id}`) });
  if (ov.isLoading || q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  if (!ov.data || !q.data) return null;
  if (!q.data.permissions.can_edit)
    return (
      <Empty icon="lock" title="Form ini tidak bisa diubah" hint="Sudah diverifikasi pengawas, atau Anda bukan pengisinya. Hubungi admin bila perlu.">
        <Link to={formPath(code, `/r/${id}`)} className="btn btn--dark">
          Kembali
        </Link>
      </Empty>
    );
  return <FormBody code={code} ov={ov.data} detail={q.data} />;
}

function FormBody({ code, ov, presetSubject, detail, onAgain }: { code: string; ov: FormOverview; presetSubject?: number | null; detail?: FormRecordDetail; onAgain?: () => void }) {
  const { user, setUser } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const t = ov.type;
  const edit = !!detail;
  const topRef = useRef<HTMLDivElement>(null);

  const [subjectId, setSubjectId] = useState<number | null>(detail?.record.subject_id ?? presetSubject ?? null);
  const subject: FormSubject | undefined = ov.subjects.find((s) => s.id === subjectId);
  const cl = useFormChecklist(code, subjectId, false, !!subjectId);
  const sections: FormSection[] = useMemo(() => (cl.data?.sections ?? []).filter((s) => s.items.length), [cl.data]);
  const items = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  const [uuid] = useState(newUuid);
  const [date, setDate] = useState(detail?.record.record_date ?? (t.period === 'shift' ? ov.shift.shift_date : todayWita()));
  const [shift, setShift] = useState<1 | 2>((detail?.record.shift as 1 | 2) || ov.shift.shift);
  const [header, setHeader] = useState<Record<string, string>>(() =>
    detail ? Object.fromEntries(Object.entries(detail.record.header).map(([k, v]) => [k, String(v)])) : {},
  );
  const [prefilled, setPrefilled] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<number, Ans>>(() => (detail ? fromDetail(detail) : {}));
  const [notes, setNotes] = useState(detail?.record.notes ?? '');
  const [sigMode, setSigMode] = useState<'saved' | 'new'>(detail?.record.signature_png ? 'new' : 'saved');
  const [signature, setSignature] = useState<string | null>(null);
  const [saveSig, setSaveSig] = useState(true);
  const ansRef = useRef(answers);
  ansRef.current = answers;

  // data objek dari pemeriksaan terakhir (mis. model / merk generator) diisi otomatis; angka & tanggal tidak
  useEffect(() => {
    if (edit || !cl.data?.last_header) return;
    const keep = t.header_fields.filter((f) => f.type === 'text' || f.type === 'select');
    const fill: Record<string, string> = {};
    for (const f of keep) {
      const v = cl.data.last_header[f.key];
      if (v != null && String(v).trim()) fill[f.key] = String(v);
    }
    setHeader((h) => ({ ...fill, ...Object.fromEntries(Object.entries(h).filter(([, v]) => v)) }));
    setPrefilled(Object.keys(fill));
  }, [cl.data, edit, t.header_fields]);

  const patch = useCallback((id: number, p: Partial<Ans>) => setAnswers((s) => ({ ...s, [id]: { ...EMPTY, ...s[id], ...p } })), []);
  const setAllGood = (sec: FormSection) =>
    setAnswers((s) => {
      const a = { ...s };
      for (const it of sec.items) if (it.kind === 'check') a[it.id] = { ...EMPTY, ...a[it.id], c: 'good', note: '', photos: [], keep: [] };
      return a;
    });

  /* ---- foto ---- */
  const [photoBusy, setPhotoBusy] = useState<number | null>(null);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const addPhotos = useCallback(async (id: number, files: File[]) => {
    setPhotoErr(null);
    setPhotoBusy(id);
    try {
      for (const file of files) {
        const cur = ansRef.current[id] ?? EMPTY;
        if (cur.photos.length + cur.keep.length >= MAX_PHOTOS) break;
        const data = await compressImage(file);
        setAnswers((s) => {
          const a = { ...EMPTY, ...s[id] };
          if (a.photos.length + a.keep.length >= MAX_PHOTOS) return s;
          return { ...s, [id]: { ...a, photos: [...a.photos, data] } };
        });
      }
    } catch (e) {
      setPhotoErr(e instanceof Error ? e.message : 'Foto gagal diproses.');
    } finally {
      setPhotoBusy(null);
    }
  }, []);

  /* ---- ringkasan ---- */
  const summary = useMemo(() => {
    let done = 0;
    let need = 0;
    let stop = 0;
    let fix = 0;
    let filled = 0;
    for (const it of items) {
      const a = answers[it.id];
      if (it.required) need += 1;
      if (it.required && isAnswered(it, a)) done += 1;
      if (isAnswered(it, a) || (it.kind === 'measure' && measureState(it, a).any)) filled += 1;
      if (isBad(it, a) && it.severity !== 'note') {
        if (it.severity === 'stop') stop += 1;
        else fix += 1;
      }
    }
    const result: FormResult = stop ? 'stop' : fix ? 'finding' : 'ok';
    return { done, need, stop, fix, result, filled, total: items.length };
  }, [items, answers]);

  /* ---- periksa isian ---- */
  const [errors, setErrors] = useState<{ key: string; msg: string }[]>([]);
  const validate = useCallback(() => {
    const e: { key: string; msg: string }[] = [];
    if (!subjectId) e.push({ key: 'subject', msg: `Pilih ${lowerFirst(t.subject_label)} dulu.` });
    for (const f of t.header_fields) {
      if (f.type === 'number' && header[f.key] && Number.isNaN(parseNum(header[f.key]))) e.push({ key: `h-${f.key}`, msg: `${f.label}: isi dengan angka.` });
    }
    let missing = 0;
    let firstMissing: string | null = null;
    for (const it of items) {
      const a = answers[it.id];
      const key = `item-${it.id}`;
      if (it.kind === 'measure' && measureState(it, a).invalid) e.push({ key, msg: `${it.text}: isi dengan angka.` });
      if (it.required && !isAnswered(it, a)) {
        missing += 1;
        firstMissing ??= key;
      }
      if (it.kind === 'check' && a?.c === 'bad') {
        if (a.note.trim().length < 3) e.push({ key, msg: `${it.text}: tulis catatan singkat.` });
        if (it.needs_photo && a.photos.length + a.keep.length < 1) e.push({ key, msg: `${it.text}: lampirkan foto (wajib).` });
      }
    }
    if (missing && firstMissing) e.push({ key: firstMissing, msg: `Masih ada ${missing} butir wajib yang belum diisi (ketuk untuk ke yang pertama).` });
    if (subjectId && items.length && !items.some((it) => isAnswered(it, answers[it.id]) || (it.kind === 'measure' && measureState(it, answers[it.id]).any)))
      e.push({ key: `item-${items[0].id}`, msg: 'Isi minimal satu butir.' });
    const hasSig = sigMode === 'saved' ? !!user?.signature_png || !!signature : !!signature;
    if (ov.settings.require_signature && !hasSig && !(edit && detail?.record.signature_png)) e.push({ key: 'sig', msg: 'Tanda tangan wajib diisi.' });
    return e;
  }, [subjectId, t, header, items, answers, sigMode, user, signature, ov.settings.require_signature, edit, detail]);
  useEffect(() => {
    setErrors((cur) => (cur.length ? validate() : cur));
  }, [validate]);

  const [busy, setBusy] = useState(false);
  const [submitErr, setSubmitErr] = useState<{ msg: string; existing?: number | null } | null>(null);
  const [done, setDone] = useState<{ id?: number; result: FormResult; queued?: boolean } | null>(null);

  const scrollTo = (key: string) => {
    const el = document.querySelector<HTMLElement>(`[data-key="${key}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('flash');
      window.setTimeout(() => el.classList.remove('flash'), 1600);
    }
  };

  const submit = async () => {
    if (busy) return;
    setSubmitErr(null);
    const e = validate();
    setErrors(e);
    if (e.length) {
      topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const payload: Record<string, unknown> = {
      header: Object.fromEntries(Object.entries(header).filter(([, v]) => v.trim())),
      answers: items
        .filter((it) => isAnswered(it, answers[it.id]) || (it.kind === 'measure' && measureState(it, answers[it.id]).any))
        .map((it) => {
          const a = answers[it.id] ?? EMPTY;
          const bad = isBad(it, a);
          return {
            item_id: it.id,
            ...(it.kind === 'check' ? { condition: a.c } : {}),
            ...(it.kind === 'measure' ? { values: Object.fromEntries(Object.entries(a.values).map(([k, v]) => [k, parseNum(v)])) } : {}),
            ...(it.kind === 'input' ? { value: a.value.trim() } : {}),
            note: a.note.trim() || null,
            ...(bad ? { photos: a.photos, keep_photo_ids: a.keep, plan_date: a.plan || null } : {}),
          };
        }),
      notes: notes.trim() || null,
      signature_png: signature || (sigMode === 'saved' ? user?.signature_png ?? null : null),
      use_saved_signature: sigMode === 'saved' && !signature && !!user?.signature_png,
      save_signature: !!signature && saveSig,
    };
    if (!edit) Object.assign(payload, { client_uuid: uuid, subject_id: subjectId, record_date: date, shift: t.period === 'shift' ? shift : 0, filled_at: new Date().toISOString() });
    setBusy(true);
    try {
      const r = edit
        ? await api.put<{ id: number; result: FormResult }>(`/api/forms/${code}/records/${detail!.record.id}`, payload, { timeout: 120_000 })
        : await api.post<{ id: number; result: FormResult }>(`/api/forms/${code}/records`, payload, { timeout: 120_000 });
      if (payload.save_signature && signature && user) setUser({ ...user, signature_png: signature, has_signature: true });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['form'] }),
        qc.invalidateQueries({ queryKey: ['forms'] }),
        qc.invalidateQueries({ queryKey: ['form-records'] }),
        qc.invalidateQueries({ queryKey: ['form-findings'] }),
        qc.invalidateQueries({ queryKey: ['form-record'] }),
        qc.invalidateQueries({ queryKey: ['form-checklist'] }),
      ]);
      setDone({ id: r.id, result: r.result });
    } catch (err) {
      if (err instanceof ApiError && err.isTemporary && !edit) {
        // tidak ada sinyal / server belum siap: simpan di HP, dikirim otomatis begitu ada sinyal
        await enqueue({
          uuid,
          url: `/api/forms/${code}/records`,
          form_code: code,
          user_id: user?.id,
          payload,
          label: [t.short_name, subject?.name, t.period === 'shift' ? `Shift ${shiftLabel(shift)}` : '', shortDate(date)].filter(Boolean).join(' · '),
        });
        const stop = items.some((it) => it.severity === 'stop' && isBad(it, answers[it.id]));
        const finding = items.some((it) => it.severity !== 'note' && isBad(it, answers[it.id]));
        setDone({ queued: true, result: stop ? 'stop' : finding ? 'finding' : 'ok' });
      } else if (err instanceof ApiError) {
        const d = err.details as { existing_id?: number; item_ids?: number[]; item_id?: number } | undefined;
        setSubmitErr({ msg: err.message, existing: d?.existing_id ?? null });
        const k = d?.item_id ?? d?.item_ids?.[0];
        if (k) window.setTimeout(() => scrollTo(`item-${k}`), 50);
        else topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else setSubmitErr({ msg: 'Gagal mengirim. Coba lagi.' });
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    const tone = done.result === 'stop' ? 'stop' : done.result === 'finding' ? 'warn' : 'ok';
    return (
      <div className={`done done--${tone}`} role="status">
        <div className="done__icon">
          <Icon name={done.result === 'stop' ? 'stop' : done.result === 'finding' ? 'alert' : 'check'} size={44} stroke={2.4} />
        </div>
        <h1 className="done__title">{done.result === 'stop' ? 'STOP' : edit ? 'Perubahan tersimpan' : done.queued ? 'Tersimpan di HP' : `${t.short_name} terkirim`}</h1>
        {done.queued && (
          <p className="done__text">
            Belum ada sinyal. Isian ini <b>disimpan di HP</b> dan <b>terkirim otomatis</b> begitu ada sinyal lagi (aplikasi cukup dibuka sesekali). Jangan hapus data browser / aplikasi sebelum terkirim.
          </p>
        )}
        <p className="done__text">
          {done.result === 'stop' ? (
            <>
              <b className="mono">{subject?.name ?? detail?.record.subject_name}</b> punya temuan STOP. <b>Jangan dioperasikan</b> sebelum diperbaiki. {done.queued ? 'Pengawas diberi tahu begitu isian terkirim.' : 'Pengawas sudah diberi tahu.'}
            </>
          ) : done.result === 'finding' ? (
            <>
              Ada temuan di <b className="mono">{subject?.name ?? detail?.record.subject_name}</b>. Perbaiki dalam {t.fix_hours} jam; pantau di menu Temuan.
            </>
          ) : (
            <>{done.queued ? 'Hasil pemeriksaan: semua baik.' : 'Tercatat, semua baik. Terima kasih!'}</>
          )}
        </p>
        <div className="done__actions">
          {done.id != null && (
            <button type="button" className="btn btn--dark" onClick={() => nav(formPath(code, `/r/${done.id}`))}>
              <Icon name="eye" size={18} /> Lihat hasil
            </button>
          )}
          {!edit && (
            <button type="button" className="btn btn--primary" onClick={onAgain}>
              <Icon name="plus" size={18} /> Isi {lowerFirst(t.subject_label)} lain
            </button>
          )}
          <Link to={formPath(code)} className="btn btn--ghost">
            Ke ringkasan
          </Link>
        </div>
      </div>
    );
  }

  let no = 1;
  return (
    <div className="pform" ref={topRef}>
      <header className="pagehead pagehead--form">
        <div className="pagehead__text">
          <div className="eyebrow">{edit ? `Ubah ${t.short_name}` : t.name}</div>
          <h1 className="h1">{edit ? detail!.record.subject_name : `${t.short_name} baru`}</h1>
        </div>
        <Link to={edit ? formPath(code, `/r/${detail!.record.id}`) : formPath(code)} className="btn btn--ghost btn--sm">
          <Icon name="x" size={16} /> Batal
        </Link>
      </header>

      {photoErr && (
        <div className="banner banner--warn" role="alert">
          <Icon name="camera" size={18} />
          <div className="grow">{photoErr}</div>
        </div>
      )}
      {submitErr && (
        <div className="banner banner--stop" role="alert">
          <Icon name="alert" size={18} />
          <div className="grow">
            {submitErr.msg}{' '}
            {submitErr.existing && (
              <Link to={formPath(code, `/r/${submitErr.existing}`)} className="link">
                Buka isian itu
              </Link>
            )}
          </div>
        </div>
      )}
      {errors.length > 0 && (
        <div className="banner banner--stop errsum" role="alert">
          <Icon name="alert" size={18} />
          <div className="grow">
            <b>Belum bisa dikirim. Mohon lengkapi:</b>
            <ul>
              {errors.map((e, i) => (
                <li key={i}>
                  <button type="button" className="link" onClick={() => scrollTo(e.key)}>
                    {e.msg}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ---------- objek ---------- */}
      <section className="fcard" data-key="subject">
        <SectionTitle hint={edit ? undefined : `Pilih ${lowerFirst(t.subject_label)} yang diperiksa`}>{no++} · {t.subject_label}</SectionTitle>
        {edit || subject ? (
          <div className="unitsum">
            <div className="unitsum__main">
              <div className="mono unitsum__code">{subject?.name ?? detail?.record.subject_name}</div>
              <div className="muted">{[subject?.detail ?? detail?.record.subject_detail, subject?.site_name ?? detail?.record.site_name].filter(Boolean).join(' · ')}</div>
            </div>
            {!edit && (
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setSubjectId(null)}>
                Ganti
              </button>
            )}
          </div>
        ) : (
          <SubjectPicker subjects={ov.subjects} label={t.subject_label} onPick={(s) => setSubjectId(s.id)} />
        )}
        {subject && (subject.open_stop > 0 || subject.open_fix > 0) && (
          <div className={`banner ${subject.open_stop ? 'banner--stop' : 'banner--warn'}`}>
            <Icon name={subject.open_stop ? 'stop' : 'alert'} size={18} />
            <div className="grow">
              Masih ada temuan terbuka: {subject.open_stop ? `${subject.open_stop} STOP` : ''}
              {subject.open_stop && subject.open_fix ? ' dan ' : ''}
              {subject.open_fix ? `${subject.open_fix} perlu diperbaiki` : ''}.{' '}
              <Link to={formPath(code, '/temuan')} className="link">
                Lihat temuan
              </Link>
            </div>
          </div>
        )}
      </section>

      {/* ---------- kepala form ---------- */}
      <section className="fcard">
        <SectionTitle>{no++} · Data pemeriksaan</SectionTitle>
        <div className="grid2">
          <Field label={t.filler_label}>
            <input className="input" value={edit ? detail!.record.filler_name : user?.name ?? ''} readOnly />
          </Field>
          <Field label="Tanggal" htmlFor="tgl" hint={dayName(date)}>
            <input id="tgl" className="input" type="date" value={date} max={todayWita()} min={addDays(todayWita(), -31)} disabled={edit} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </Field>
          {t.period === 'shift' && (
            <Field label="Shift">
              <Segmented
                label="Shift"
                block
                value={shift}
                onChange={(v) => !edit && setShift(v as 1 | 2)}
                options={[
                  { value: 1, label: `I · ${ov.settings.shift1_start}`, disabled: edit },
                  { value: 2, label: `II · ${ov.settings.shift2_start}`, disabled: edit },
                ]}
              />
            </Field>
          )}
          {t.header_fields.map((f) => (
            <HeaderInput
              key={f.key}
              f={f}
              value={header[f.key] ?? ''}
              prefilled={prefilled.includes(f.key)}
              error={errors.find((e) => e.key === `h-${f.key}`)?.msg}
              onChange={(v) => setHeader((h) => ({ ...h, [f.key]: v }))}
            />
          ))}
        </div>
      </section>

      {/* ---------- daftar cek ---------- */}
      {subjectId && cl.isLoading && <Spinner label="Memuat daftar cek…" />}
      {subjectId && cl.error && <ErrorBox error={cl.error} onRetry={() => void cl.refetch()} />}
      {subjectId && cl.data && sections.length === 0 && <Empty icon="list" title="Daftar cek masih kosong" hint="Minta admin mengisi butir cek di Kelola." />}
      {sections.map((sec) => {
        const secNo = no++;
        const answered = sec.items.filter((i) => isAnswered(i, answers[i.id])).length;
        const hasCheck = sec.items.some((i) => i.kind === 'check');
        return (
          <section key={sec.id} className="fcard fcard--check">
            <header className="checkhead">
              <div className="grow">
                <div className="eyebrow">{secNo}</div>
                <h2 className="h2">{sec.title}</h2>
                {sec.note && <div className="small muted fsec__note">{sec.note}</div>}
              </div>
              <span className={`checkhead__count ${answered === sec.items.length ? 'is-full' : ''}`}>
                {answered}/{sec.items.length}
              </span>
              {hasCheck && (
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => setAllGood(sec)}>
                  <Icon name="check" size={16} stroke={2.6} /> Semua {sec.items.find((i) => i.kind === 'check')?.good_label.toLowerCase()}
                </button>
              )}
            </header>
            <ol className="crows">
              {sec.items.map((it) => (
                <ItemRow
                  key={it.id}
                  it={it}
                  a={answers[it.id]}
                  photoBusy={photoBusy === it.id}
                  invalid={errors.some((e) => e.key === `item-${it.id}`)}
                  onPatch={patch}
                  onAddPhotos={addPhotos}
                />
              ))}
            </ol>
          </section>
        );
      })}

      {/* ---------- catatan ---------- */}
      <section className="fcard">
        <SectionTitle>{no++} · Catatan</SectionTitle>
        <Field label="Catatan (boleh kosong)" htmlFor="cat">
          <textarea id="cat" className="input textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1500} placeholder="Hal lain yang perlu diketahui pengawas" />
        </Field>
      </section>

      {/* ---------- tanda tangan ---------- */}
      <section className="fcard" data-key="sig">
        <SectionTitle hint={`Tanda tangan ${t.filler_label.toLowerCase()}. Berstatus Terverifikasi setelah ${t.verifier_label.toLowerCase()} menandatangani.`}>{no++} · Tanda tangan</SectionTitle>
        {user?.signature_png && (
          <Segmented
            label="Sumber tanda tangan"
            value={sigMode}
            onChange={(v) => setSigMode(v)}
            options={[
              { value: 'saved', label: 'Pakai tanda tangan saya' },
              { value: 'new', label: 'Gambar ulang' },
            ]}
          />
        )}
        {user?.signature_png && sigMode === 'saved' ? (
          <div className="sigprev">
            <img src={user.signature_png} alt="Tanda tangan tersimpan" />
          </div>
        ) : (
          <>
            <SignaturePad initial={edit ? detail?.record.signature_png : signature} onChange={setSignature} />
            {signature && (
              <label className="check">
                <input type="checkbox" checked={saveSig} onChange={(e) => setSaveSig(e.target.checked)} />
                <span>Simpan sebagai tanda tangan saya</span>
              </label>
            )}
          </>
        )}
        {errors.find((e) => e.key === 'sig') && <div className="field__error">{errors.find((e) => e.key === 'sig')!.msg}</div>}
      </section>

      <div className="fpad" />
      <div className="subbar" role="region" aria-label="Kirim">
        <div className="subbar__in">
          <div className="subbar__info">
            <div className="subbar__row">
              <b>{summary.need ? `${summary.done}/${summary.need}` : `${summary.filled}/${summary.total}`}</b> {summary.need ? 'butir wajib diisi' : 'butir diisi'}
              <span className="subbar__bar" aria-hidden="true">
                <span style={{ width: `${summary.need ? (summary.done / summary.need) * 100 : summary.total ? (summary.filled / summary.total) * 100 : 0}%` }} />
              </span>
            </div>
            <div className="subbar__row small">
              <span className={`chip chip--${summary.result === 'stop' ? 'stop' : summary.result === 'finding' ? 'warn' : 'ok'}`}>{RESULT_TEXT[summary.result]}</span>
              {summary.stop > 0 && <span className="stop-text">{summary.stop} STOP</span>}
              {summary.fix > 0 && <span className="warn-text">{summary.fix} temuan</span>}
            </div>
          </div>
          <button type="button" className="btn btn--primary btn--lg" onClick={() => void submit()} disabled={busy}>
            <Icon name="send" size={20} />
            {busy ? 'Mengirim…' : edit ? 'Simpan perubahan' : 'Kirim'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- isian kepala form ---------- */

function HeaderInput({ f, value, prefilled, error, onChange }: { f: HeaderField; value: string; prefilled: boolean; error?: string; onChange: (v: string) => void }) {
  const id = `h-${f.key}`;
  const hint = prefilled ? 'Diisi dari pemeriksaan terakhir, ubah bila berbeda.' : f.unit ? `dalam ${f.unit}` : undefined;
  return (
    <Field label={f.label} htmlFor={id} hint={hint} error={error} className={f.type === 'textarea' ? 'field--wide' : ''}>
      {f.type === 'select' ? (
        <Segmented label={f.label} block value={value || null} onChange={onChange} options={(f.options ?? []).map((o) => ({ value: o, label: f.unit ? `${o} ${f.unit}` : o }))} />
      ) : f.type === 'textarea' ? (
        <textarea id={id} data-key={id} className="input textarea" rows={3} value={value} maxLength={1500} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input
          id={id}
          data-key={id}
          className={`input ${f.type === 'number' ? 'mono' : ''}`}
          type={f.type === 'date' ? 'date' : 'text'}
          inputMode={f.type === 'number' ? 'decimal' : undefined}
          value={value}
          maxLength={200}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

/* ---------- satu butir ---------- */

const ItemRow = memo(function ItemRow({
  it,
  a,
  photoBusy,
  invalid,
  onPatch,
  onAddPhotos,
}: {
  it: FormItem;
  a: Ans | undefined;
  photoBusy: boolean;
  invalid: boolean;
  onPatch: (id: number, p: Partial<Ans>) => void;
  onAddPhotos: (id: number, files: File[]) => void;
}) {
  const ans = a ?? EMPTY;
  const ms = it.kind === 'measure' ? measureState(it, ans) : null;
  const bad = it.kind === 'check' ? ans.c === 'bad' : !!ms?.out;
  const fields = it.fields.length ? it.fields : [{ key: 'v', label: 'Hasil' }];
  const limit = limitText(it.min_value, it.max_value, it.unit);
  return (
    <li className={`crow ${bad ? 'crow--bad' : ''} ${ans.c === 'good' ? 'crow--ok' : ''} ${invalid ? 'crow--invalid' : ''}`} data-key={`item-${it.id}`}>
      <div className="crow__top">
        <span className="crow__no">{it.label ?? ''}</span>
        <div className="crow__text">
          {it.text}
          {(it.spec || limit) && <div className="crow__hint">{[it.spec, it.kind === 'measure' && limit && !it.spec?.includes('maks') ? `standar ${limit}` : null].filter(Boolean).join(' · ')}</div>}
          {!it.required && <div className="crow__hint">boleh dilewati</div>}
        </div>
        {it.kind !== 'input' && it.severity === 'stop' && <span className="dcode dcode--AA" title="Tidak baik = STOP">STOP</span>}
      </div>

      {it.kind === 'check' && (
        <Segmented
          label={`Hasil: ${it.text}`}
          block
          className="crow__seg"
          value={ans.c}
          onChange={(v) => onPatch(it.id, { c: v })}
          options={[
            { value: 'good', label: it.good_label, tone: 'ok', icon: 'check' },
            { value: 'bad', label: it.bad_label, tone: it.severity === 'stop' ? 'stop' : 'warn', icon: 'x' },
          ]}
        />
      )}

      {it.kind === 'measure' && (
        <div className={`mgrid ${fields.length > 3 ? 'mgrid--many' : ''}`}>
          {fields.map((f) => {
            const n = parseNum(ans.values[f.key] ?? '');
            const out = n != null && !Number.isNaN(n) && ((it.min_value != null && n < it.min_value) || (it.max_value != null && n > it.max_value));
            return (
              <label key={f.key} className={`mcell ${out ? 'is-out' : ''}`}>
                <span className="mcell__label">{f.label}</span>
                <span className="mcell__in">
                  <input
                    className="input input--num mono"
                    inputMode="decimal"
                    value={ans.values[f.key] ?? ''}
                    placeholder="—"
                    aria-invalid={out || Number.isNaN(n)}
                    onChange={(e) => onPatch(it.id, { values: { ...ans.values, [f.key]: e.target.value } })}
                  />
                  {it.unit && <span className="mcell__unit">{it.unit}</span>}
                </span>
              </label>
            );
          })}
        </div>
      )}

      {it.kind === 'input' && (
        <input
          className="input"
          type={it.input_type === 'date' ? 'date' : 'text'}
          inputMode={it.input_type === 'number' ? 'decimal' : undefined}
          value={ans.value}
          onChange={(e) => onPatch(it.id, { value: e.target.value })}
          aria-label={it.text}
        />
      )}

      {bad && (
        <div className="crow__bad">
          {it.severity === 'stop' && (
            <div className="crow__stop">
              <Icon name="stop" size={16} stroke={2.6} /> STOP: jangan dioperasikan sebelum diperbaiki.
            </div>
          )}
          {it.kind === 'measure' && <div className="small warn-text">Di luar batas standar ({limit}). Akan dicatat sebagai temuan.</div>}
          <textarea
            className="input textarea crow__note"
            rows={2}
            value={ans.note}
            maxLength={500}
            onChange={(e) => onPatch(it.id, { note: e.target.value })}
            placeholder={it.kind === 'check' ? 'Apa yang rusak / tidak normal? (wajib)' : 'Catatan (boleh kosong)'}
            aria-label={`Catatan ${it.text}`}
          />
          {it.severity !== 'note' && (
            <label className="fplan">
              <span className="small muted">Rencana selesai (boleh kosong)</span>
              <input className="input input--auto" type="date" value={ans.plan} min={todayWita()} onChange={(e) => onPatch(it.id, { plan: e.target.value })} />
            </label>
          )}
          <PhotoPicker
            photos={ans.photos}
            kept={ans.keep}
            max={MAX_PHOTOS}
            busy={photoBusy}
            base={FORM_PHOTO_BASE}
            required={it.kind === 'check' && it.needs_photo}
            invalid={invalid && it.kind === 'check' && it.needs_photo && ans.photos.length + ans.keep.length === 0}
            label={it.text}
            onAdd={(files) => onAddPhotos(it.id, files)}
            onRemoveNew={(i) => onPatch(it.id, { photos: ans.photos.filter((_, j) => j !== i) })}
            onRemoveKept={(pid) => onPatch(it.id, { keep: ans.keep.filter((x) => x !== pid) })}
          />
        </div>
      )}
    </li>
  );
});

/* ---------- pilih objek ---------- */

function SubjectPicker({ subjects, label, onPick }: { subjects: FormSubject[]; label: string; onPick: (s: FormSubject) => void }) {
  const [q, setQ] = useState('');
  const [site, setSite] = useFormSite();
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    return subjects.filter((s) => (!site || s.site_id === site) && (!k || `${s.name} ${s.detail ?? ''} ${s.site_name}`.toLowerCase().includes(k)));
  }, [subjects, q, site]);
  if (!subjects.length) return <div className="muted small">Belum ada {lowerFirst(label)} di site Anda. Minta admin menambahkannya di Kelola.</div>;
  return (
    <div className="upick">
      <SiteChips value={site} onChange={setSite} />
      {subjects.length > 6 && (
        <label className="searchbox">
          <Icon name="search" size={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Cari ${lowerFirst(label)}…`} aria-label="Cari" />
        </label>
      )}
      <ul className="ulist">
        {list.length === 0 && <li className="muted small upick__none">Tidak ada yang cocok di site ini.</li>}
        {list.map((s) => (
          <li key={s.id}>
            <button type="button" className="upick__row" onClick={() => onPick(s)}>
              <span className="upick__main">
                <span className="mono upick__code">{s.name}</span>
                <span className="small muted">{[s.detail, s.site_name].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="upick__tags">
                {s.done_now && <span className="chip chip--ok">Sudah diperiksa</span>}
                {s.open_stop > 0 && <span className="chip chip--stop">STOP</span>}
                {!s.open_stop && s.open_fix > 0 && <span className="chip chip--warn">Temuan</span>}
              </span>
              <Icon name="chevR" size={18} className="muted" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function fromDetail(d: FormRecordDetail): Record<number, Ans> {
  const out: Record<number, Ans> = {};
  for (const s of d.sections)
    for (const a of s.items) {
      if (a.item_id == null) continue;
      const vals: Record<string, string> = {};
      if (a.kind === 'measure' && a.values) for (const [k, v] of Object.entries(a.values)) vals[k] = v == null ? '' : String(v).replace('.', ',');
      out[a.item_id] = {
        c: a.kind === 'check' ? a.condition : null,
        values: vals,
        value: a.kind === 'input' && a.values ? String(a.values.value ?? '') : '',
        note: a.note ?? '',
        plan: a.fix_plan_date ?? '',
        photos: [],
        keep: a.photos ?? [],
      };
    }
  return out;
}
