import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../components/Icon';
import { SignaturePad } from '../components/SignaturePad';
import { DangerCode, Empty, ErrorBox, Field, ResultChip, SectionTitle, Segmented, Spinner } from '../components/ui';
import { ApiError, api, downloadFile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { safeDel, safeGet, safeSet } from '../lib/cache';
import { addDays, dayName, locationOf, modelOf, num, parseNum, segments, shiftLabel, shortDate, todayWita, unitTitle } from '../lib/format';
import { useMeta, useOnline, useUnits } from '../lib/hooks';
import { enqueue } from '../lib/outbox';
import type { ChecklistItem, ChecklistSection, Condition, FormDetail, Meta, P2HPayload, ResultKind, Unit } from '../lib/types';

/* =====================================================================
   Form P2H: dipakai untuk "P2H baru" dan "Ubah P2H".
   Isian disimpan sebagai draf di HP, jadi aman kalau layar mati / sinyal hilang.
   ===================================================================== */

interface FormState {
  uuid: string;
  unitId: number | null;
  date: string;
  shift: 1 | 2;
  location: string;
  jobSite: string;
  hmStart: string;
  hmEnd: string;
  answers: Record<number, { c: Condition | null; note: string }>;
  params: Record<string, { idle: string; load: string }>;
  notes: string;
  signature: string | null; // gambar baru (dari kotak tanda tangan)
  sigMode: 'saved' | 'new';
  saveSig: boolean;
  startedAt: number;
}

const DRAFT_KEY = (uid: number) => `p2h.draft.v2.${uid}`;
const newUuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-4000-8000-000000000000`);

function blankState(meta: Meta, unitId: number | null): FormState {
  return {
    uuid: newUuid(),
    unitId,
    date: meta.shift.shift_date,
    shift: meta.shift.shift,
    location: '',
    jobSite: '',
    hmStart: '',
    hmEnd: '',
    answers: {},
    params: Object.fromEntries(meta.params.map((p) => [p.key, { idle: '', load: '' }])),
    notes: '',
    signature: null,
    sigMode: 'saved',
    saveSig: true,
    startedAt: Date.now(),
  };
}

function allItems(cl: ChecklistSection[]) {
  return cl.flatMap((s) => s.items.filter((i) => i.is_active).map((i) => ({ ...i, section: s })));
}

/* =====================================================================
   Halaman: P2H baru
   ===================================================================== */

export function NewP2HPage() {
  const meta = useMeta();
  const [sp] = useSearchParams();
  const [nonce, setNonce] = useState(0);
  if (meta.isLoading) return <Spinner />;
  if (meta.error && !meta.data) return <ErrorBox error={meta.error} onRetry={() => void meta.refetch()} />;
  if (!meta.data) return null;
  const pre = Number(sp.get('unit')) || null;
  return (
    <P2HFormBody
      key={`${pre ?? 'x'}-${nonce}`}
      mode="create"
      meta={meta.data}
      presetUnit={pre}
      onReset={() => {
        setNonce((n) => n + 1);
        window.scrollTo({ top: 0 });
      }}
    />
  );
}

/* =====================================================================
   Halaman: ubah P2H
   ===================================================================== */

export function EditP2HPage() {
  const { id } = useParams();
  const meta = useMeta();
  const q = useQuery({ queryKey: ['p2h', id], queryFn: () => api.get<FormDetail>(`/api/p2h/${id}`) });
  if (meta.isLoading || q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  if (!meta.data || !q.data) return null;
  if (!q.data.permissions.can_edit)
    return (
      <Empty icon="lock" title="P2H ini tidak bisa diubah" hint="Sudah ditandatangani pengawas, atau Anda bukan pembuatnya. Hubungi admin bila perlu.">
        <Link to={`/p2h/${id}`} className="btn btn--dark">
          Kembali
        </Link>
      </Empty>
    );
  return <P2HFormBody mode="edit" meta={meta.data} detail={q.data} />;
}

/* =====================================================================
   Isi form
   ===================================================================== */

function P2HFormBody({
  mode,
  meta,
  presetUnit,
  detail,
  onReset,
}: {
  mode: 'create' | 'edit';
  meta: Meta;
  presetUnit?: number | null;
  detail?: FormDetail;
  onReset?: () => void;
}) {
  const { user, setUser } = useAuth();
  const qc = useQueryClient();
  const online = useOnline();
  const unitsQ = useUnits();
  const units = unitsQ.data?.items ?? [];
  const items = useMemo(() => allItems(meta.checklist), [meta.checklist]);
  const topRef = useRef<HTMLDivElement>(null);

  // isi awal: dari P2H yang diubah, atau draf yang tersimpan di HP, atau form kosong (dihitung sekali saat dibuka)
  const init = useMemo(() => {
    if (mode === 'edit' && detail) return { state: fromDetail(meta, detail), restored: false };
    const blank = blankState(meta, presetUnit ?? null);
    if (user) {
      try {
        const raw = safeGet(DRAFT_KEY(user.id));
        if (raw) {
          const d = JSON.parse(raw) as FormState;
          const fresh = Date.now() - d.startedAt < 20 * 3600_000;
          const sameUnit = !presetUnit || d.unitId === presetUnit;
          if (fresh && sameUnit && Object.keys(d.answers || {}).length > 0) {
            return { state: { ...blank, ...d, params: { ...blank.params, ...d.params } }, restored: true };
          }
        }
      } catch {
        /* draf rusak: abaikan */
      }
    }
    return { state: blank, restored: false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [restored, setRestored] = useState(init.restored);
  const [st, setSt] = useState<FormState>(init.state);

  // simpan draf (hanya form baru)
  const saveTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (mode !== 'create' || !user) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => safeSet(DRAFT_KEY(user.id), JSON.stringify(st)), 500);
    return () => window.clearTimeout(saveTimer.current);
  }, [st, mode, user]);

  const unit: Unit | undefined = useMemo(() => units.find((u) => u.id === st.unitId), [units, st.unitId]);
  const set = useCallback(<K extends keyof FormState>(k: K, v: FormState[K]) => setSt((s) => ({ ...s, [k]: v })), []);

  // saat unit dipilih: isi lokasi / job site / HM awal otomatis (hanya kalau masih kosong)
  useEffect(() => {
    if (mode !== 'create' || !unit) return;
    setSt((s) => ({
      ...s,
      location: s.location || unit.location || '',
      jobSite: s.jobSite || unit.job_site || unit.site_job_site || '',
      hmStart: s.hmStart || (unit.last_hm != null ? num(unit.last_hm) : ''),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit?.id]);

  const setAnswer = useCallback((id: number, c: Condition) => {
    setSt((s) => ({ ...s, answers: { ...s.answers, [id]: { c, note: s.answers[id]?.note ?? '' } } }));
  }, []);
  const setNote = useCallback((id: number, note: string) => {
    setSt((s) => ({ ...s, answers: { ...s.answers, [id]: { c: s.answers[id]?.c ?? null, note } } }));
  }, []);
  const setAllGood = useCallback((sec: ChecklistSection) => {
    setSt((s) => {
      const a = { ...s.answers };
      for (const it of sec.items) if (it.is_active) a[it.id] = { c: 'baik', note: '' };
      return { ...s, answers: a };
    });
  }, []);

  /* ---- hitung ringkasan ---- */
  const summary = useMemo(() => {
    let done = 0;
    let aa = 0;
    let a = 0;
    for (const it of items) {
      const ans = st.answers[it.id];
      if (!ans?.c) continue;
      done += 1;
      if (ans.c !== 'baik') {
        if (it.danger_code === 'AA') aa += 1;
        else a += 1;
      }
    }
    const result: ResultKind = aa ? 'stop_aa' : a ? 'temuan_a' : 'baik';
    return { done, total: items.length, aa, a, result };
  }, [items, st.answers]);

  /* ---- periksa isian ---- */
  const [errors, setErrors] = useState<{ key: string; msg: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [submitErr, setSubmitErr] = useState<{ msg: string; existing?: number | null } | null>(null);
  const [done, setDone] = useState<null | { kind: 'sent' | 'queued'; id?: number; result: ResultKind; edited?: boolean }>(null);

  const validate = useCallback((): { key: string; msg: string }[] => {
    const e: { key: string; msg: string }[] = [];
    if (mode === 'create' && !st.unitId) e.push({ key: 'unit', msg: 'Pilih unit genset dulu.' });
    const hs = parseNum(st.hmStart);
    const he = parseNum(st.hmEnd);
    if (Number.isNaN(hs)) e.push({ key: 'hm', msg: 'HM awal harus berupa angka.' });
    if (Number.isNaN(he)) e.push({ key: 'hm', msg: 'HM akhir harus berupa angka.' });
    if (hs != null && he != null && !Number.isNaN(hs) && !Number.isNaN(he) && he < hs) e.push({ key: 'hm', msg: 'HM akhir tidak boleh lebih kecil dari HM awal.' });
    let unanswered = 0;
    let firstUnanswered: string | null = null;
    for (const it of items) {
      const a = st.answers[it.id];
      if (!a?.c) {
        unanswered += 1;
        if (!firstUnanswered) firstUnanswered = `item-${it.id}`;
      } else if (a.c !== 'baik' && a.note.trim().length < 3) {
        e.push({ key: `item-${it.id}`, msg: `${it.section.title} no. ${it.no}: tulis catatan singkat (apa yang rusak).` });
      }
    }
    if (unanswered > 0 && firstUnanswered) e.push({ key: firstUnanswered, msg: `Masih ada ${unanswered} butir cek yang belum diisi (ketuk untuk ke yang pertama).` });
    for (const p of meta.params) {
      for (const k of ['idle', 'load'] as const) {
        const raw = st.params[p.key]?.[k] ?? '';
        const v = parseNum(raw);
        if (Number.isNaN(v)) e.push({ key: `param-${p.key}`, msg: `${p.label}: isi dengan angka.` });
        else if (v != null && (v < p.min || v > p.max)) e.push({ key: `param-${p.key}`, msg: `${p.label}: ${raw} ${p.unit} tidak masuk akal (batas ${p.min}–${p.max}).` });
      }
    }
    const hasSig = st.sigMode === 'saved' ? !!user?.signature_png || !!st.signature : !!st.signature;
    if (meta.settings.require_signature && !hasSig && !(mode === 'edit' && detail?.form.signature_png)) e.push({ key: 'sig', msg: 'Tanda tangan wajib diisi.' });
    return e;
  }, [mode, st, items, meta, user, detail]);

  const buildPayload = (): P2HPayload => {
    const params: P2HPayload['params'] = {};
    for (const p of meta.params) {
      const i = parseNum(st.params[p.key]?.idle ?? '');
      const l = parseNum(st.params[p.key]?.load ?? '');
      if (i != null || l != null) params[p.key] = { idle: i, load: l };
    }
    const useSaved = st.sigMode === 'saved' && !st.signature && !!user?.signature_png;
    const payload: P2HPayload = {
      location: st.location.trim() || null,
      job_site: st.jobSite.trim() || null,
      hm_start: parseNum(st.hmStart),
      hm_end: parseNum(st.hmEnd),
      params,
      answers: items.map((it) => ({ item_id: it.id, condition: st.answers[it.id]!.c as Condition, note: st.answers[it.id]!.c === 'baik' ? null : st.answers[it.id]!.note.trim() })),
      notes: st.notes.trim() || null,
      signature_png: st.signature || (st.sigMode === 'saved' ? user?.signature_png ?? null : null),
      use_saved_signature: useSaved,
      save_signature: !!st.signature && st.saveSig,
    };
    if (mode === 'create') {
      payload.client_uuid = st.uuid;
      payload.unit_id = st.unitId!;
      payload.shift_date = st.date;
      payload.shift = st.shift;
      payload.filled_at = new Date().toISOString();
    }
    return payload;
  };

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
    const payload = buildPayload();
    setBusy(true);
    try {
      if (mode === 'edit') {
        const r = await api.put<{ id: number; result: ResultKind }>(`/api/p2h/${detail!.form.id}`, payload);
        await invalidate();
        setDone({ kind: 'sent', id: r.id, result: r.result, edited: true });
      } else {
        const r = await api.post<{ id: number; result: ResultKind; duplicate?: boolean }>('/api/p2h', payload);
        if (user) safeDel(DRAFT_KEY(user.id));
        if (payload.save_signature && payload.signature_png && user) setUser({ ...user, signature_png: payload.signature_png, has_signature: true });
        await invalidate();
        setDone({ kind: 'sent', id: r.id, result: r.result });
      }
    } catch (err) {
      if (err instanceof ApiError && err.isTemporary && mode === 'create') {
        // tidak ada sinyal: simpan di HP, kirim otomatis nanti
        await enqueue({
          uuid: st.uuid,
          payload,
          label: `${unit?.code ?? 'P2H'} · Shift ${shiftLabel(st.shift)} · ${shortDate(st.date)}`,
        });
        if (user) safeDel(DRAFT_KEY(user.id));
        setDone({ kind: 'queued', result: summary.result });
      } else if (err instanceof ApiError) {
        const existing = (err.details as { existing_form_id?: number } | undefined)?.existing_form_id ?? null;
        setSubmitErr({ msg: err.message, existing });
        topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        setSubmitErr({ msg: 'Gagal mengirim. Coba lagi.' });
      }
    } finally {
      setBusy(false);
    }
  };

  async function invalidate() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['dashboard'] }),
      qc.invalidateQueries({ queryKey: ['units'] }),
      qc.invalidateQueries({ queryKey: ['history'] }),
      qc.invalidateQueries({ queryKey: ['findings'] }),
      qc.invalidateQueries({ queryKey: ['p2h'] }),
    ]);
  }

  const discardDraft = () => {
    if (user) safeDel(DRAFT_KEY(user.id));
    setSt(blankState(meta, presetUnit ?? null));
    setRestored(false);
    setErrors([]);
  };

  /* ---------- layar selesai ---------- */
  if (done) return <DoneScreen done={done} unit={unit} detail={detail} onAgain={() => onReset?.()} />;

  const dup = unit && st.date === unitsQ.data?.shift.shift_date && st.shift === unitsQ.data?.shift.shift && unit.current_form_id ? unit.current_form_id : null;

  return (
    <div className="pform" ref={topRef}>
      <header className="pagehead pagehead--form">
        <div className="pagehead__text">
          <div className="eyebrow">{mode === 'edit' ? 'Ubah P2H' : 'Form inspeksi harian genset'}</div>
          <h1 className="h1">{mode === 'edit' ? detail?.form.unit_code : 'P2H baru'}</h1>
        </div>
        <Link to={mode === 'edit' ? `/p2h/${detail?.form.id}` : '/'} className="btn btn--ghost btn--sm">
          <Icon name="x" size={16} /> Batal
        </Link>
      </header>

      {restored && mode === 'create' && (
        <div className="banner banner--info" role="status">
          <Icon name="history" size={18} />
          <div className="grow">
            <b>Draf dipulihkan.</b> Isian terakhir Anda masih tersimpan di HP ini.
          </div>
          <button type="button" className="btn btn--sm btn--ghost" onClick={discardDraft}>
            Mulai baru
          </button>
        </div>
      )}
      {!online && (
        <div className="banner banner--warn" role="status">
          <Icon name="wifiOff" size={18} />
          <div className="grow">Tidak ada sinyal. Anda tetap bisa mengisi lalu menekan Kirim: data disimpan di HP dan dikirim otomatis nanti.</div>
        </div>
      )}
      {submitErr && (
        <div className="banner banner--stop" role="alert">
          <Icon name="alert" size={18} />
          <div className="grow">
            {submitErr.msg}
            {submitErr.existing && (
              <>
                {' '}
                <Link to={`/p2h/${submitErr.existing}`} className="link">
                  Buka P2H itu
                </Link>
              </>
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

      {/* ---------- 1. unit ---------- */}
      <section className="fcard" data-key="unit">
        <SectionTitle hint={mode === 'edit' ? undefined : 'Pilih genset yang Anda periksa'}>1 · Unit genset</SectionTitle>
        {mode === 'edit' ? (
          <div className="unitsum">
            <div className="mono unitsum__code">{unitTitle({ code: detail!.form.unit_code, old_code: detail!.form.unit_old_code })}</div>
            <div className="muted">{[detail!.form.unit_brand, detail!.form.unit_model].filter(Boolean).join(' ')} · {detail!.form.site_name}</div>
          </div>
        ) : (
          <UnitPicker units={units} loading={unitsQ.isLoading} sites={meta.sites} selected={unit} onPick={(u) => set('unitId', u.id)} onClear={() => set('unitId', null)} siteId={user?.site_id ?? null} />
        )}
        {dup && (
          <div className="banner banner--warn">
            <Icon name="alert" size={18} />
            <div className="grow">
              Unit ini sudah di-P2H pada shift ini.{' '}
              <Link to={`/p2h/${dup}`} className="link">
                Buka P2H-nya
              </Link>{' '}
              (bisa diubah dari sana).
            </div>
          </div>
        )}
        {unit && (unit.open_aa > 0 || unit.open_a > 0) && (
          <div className={`banner ${unit.open_aa ? 'banner--stop' : 'banner--warn'}`}>
            <Icon name={unit.open_aa ? 'stop' : 'alert'} size={18} />
            <div className="grow">
              Unit ini masih punya temuan terbuka: {unit.open_aa ? `${unit.open_aa} STOP (AA)` : ''}
              {unit.open_aa && unit.open_a ? ' dan ' : ''}
              {unit.open_a ? `${unit.open_a} perlu diperbaiki (A)` : ''}.{' '}
              <Link to="/temuan" className="link">
                Lihat temuan
              </Link>
            </div>
          </div>
        )}
      </section>

      {/* ---------- 2. data shift ---------- */}
      <section className="fcard">
        <SectionTitle>2 · Data shift</SectionTitle>
        <div className="grid2">
          <Field label="Nama">
            <input className="input" value={user?.name ?? ''} readOnly aria-readonly="true" />
          </Field>
          <Field label="Hari / tanggal" htmlFor="tgl" hint={dayName(st.date)}>
            <input
              id="tgl"
              className="input"
              type="date"
              value={st.date}
              max={todayWita()}
              min={addDays(todayWita(), -7)}
              disabled={mode === 'edit'}
              onChange={(e) => e.target.value && set('date', e.target.value)}
            />
          </Field>
          <Field label="Shift">
            <Segmented
              label="Shift"
              block
              value={st.shift}
              onChange={(v) => mode === 'create' && set('shift', v as 1 | 2)}
              options={[
                { value: 1, label: `I · ${meta.settings.shift1_start}`, disabled: mode === 'edit' },
                { value: 2, label: `II · ${meta.settings.shift2_start}`, disabled: mode === 'edit' },
              ]}
            />
          </Field>
          <Field label="Lokasi" htmlFor="lok">
            <input id="lok" className="input" value={st.location} onChange={(e) => set('location', e.target.value)} placeholder="mis. CPP Suaran" maxLength={80} />
          </Field>
          <Field label="Job site" htmlFor="job">
            <input id="job" className="input" value={st.jobSite} onChange={(e) => set('jobSite', e.target.value)} placeholder="mis. BMO 1" maxLength={60} />
          </Field>
          <Field label="Model unit">
            <input className="input" value={unit ? modelOf(unit) : mode === 'edit' ? [detail?.form.unit_brand, detail?.form.unit_model].filter(Boolean).join(' ') : ''} readOnly placeholder="otomatis dari unit" />
          </Field>
          <Field
            label="HM / KM awal"
            htmlFor="hms"
            hint={unit?.last_hm != null && mode === 'create' ? `HM terakhir tercatat: ${num(unit.last_hm)}` : undefined}
            error={errors.find((e) => e.key === 'hm')?.msg}
          >
            <input id="hms" data-key="hm" className="input mono" inputMode="decimal" value={st.hmStart} onChange={(e) => set('hmStart', e.target.value)} placeholder="0" />
          </Field>
          <Field label="HM / KM akhir" htmlFor="hme" hint="Boleh dikosongkan, bisa diisi nanti lewat Ubah.">
            <input id="hme" className="input mono" inputMode="decimal" value={st.hmEnd} onChange={(e) => set('hmEnd', e.target.value)} placeholder="" />
          </Field>
        </div>
      </section>

      {/* ---------- 3. daftar cek ---------- */}
      <div className="legend-note small">
        <DangerCode code="AA" /> rusak = <b>STOP OPERASI</b> (unit tidak boleh dijalankan). <DangerCode code="A" /> rusak = perbaiki dalam 12 jam.
      </div>
      {meta.checklist.map((sec, si) => {
        const its = sec.items.filter((i) => i.is_active);
        const answered = its.filter((i) => st.answers[i.id]?.c).length;
        return (
          <section key={sec.id} className="fcard fcard--check">
            <header className="checkhead">
              <div className="grow">
                <div className="eyebrow">3.{si + 1}</div>
                <h2 className="h2">{sec.title}</h2>
              </div>
              <span className={`checkhead__count ${answered === its.length ? 'is-full' : ''}`}>
                {answered}/{its.length}
              </span>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setAllGood(sec)}>
                <Icon name="check" size={16} stroke={2.6} /> Semua baik
              </button>
            </header>
            <ol className="crows">
              {its.map((it) => (
                <CheckRow
                  key={it.id}
                  item={it}
                  value={st.answers[it.id]?.c ?? null}
                  note={st.answers[it.id]?.note ?? ''}
                  invalid={errors.some((e) => e.key === `item-${it.id}`)}
                  onChange={setAnswer}
                  onNote={setNote}
                />
              ))}
            </ol>
          </section>
        );
      })}

      {/* ---------- 4. parameter ---------- */}
      <section className="fcard">
        <SectionTitle hint="Isi dari panel genset. Kosongan = belum dibebani, Berbeban = saat sudah memikul beban.">4 · Parameter panel genset</SectionTitle>
        <div className="params">
          <div className="params__head" aria-hidden="true">
            <span />
            <span>Kosongan</span>
            <span>Berbeban</span>
          </div>
          {meta.params.map((p) => {
            const nominal =
              p.key === 'rpm' ? unit?.rated_rpm ?? detail?.form.rated_rpm : p.key === 'volt' ? unit?.rated_voltage ?? detail?.form.rated_voltage : p.key === 'load' ? unit?.rated_kw ?? detail?.form.rated_kw : null;
            const err = errors.find((e) => e.key === `param-${p.key}`)?.msg;
            return (
              <div className={`prow ${err ? 'has-error' : ''}`} key={p.key} data-key={`param-${p.key}`}>
                <div className="prow__label">
                  <span>{p.label}</span>
                  <span className="muted small">
                    {p.unit}
                    {nominal ? ` · nominal ${num(nominal)}` : ''}
                  </span>
                </div>
                {(['idle', 'load'] as const).map((k) => (
                  <label className="prow__cell" key={k}>
                    <span className="sr-only">
                      {p.label} {k === 'idle' ? 'kosongan' : 'berbeban'}
                    </span>
                    <input
                      className="input input--num mono"
                      inputMode="decimal"
                      value={st.params[p.key]?.[k] ?? ''}
                      onChange={(e) => setSt((s) => ({ ...s, params: { ...s.params, [p.key]: { ...s.params[p.key], [k]: e.target.value } } }))}
                      placeholder="—"
                      aria-invalid={!!err}
                    />
                    <span className="prow__unit">{p.unit}</span>
                  </label>
                ))}
                {err && <div className="field__error prow__err">{err}</div>}
              </div>
            );
          })}
        </div>
      </section>

      {/* ---------- 5. catatan ---------- */}
      <section className="fcard">
        <SectionTitle>5 · Info tambahan dan tindak lanjut</SectionTitle>
        <Field label="Catatan (boleh kosong)" htmlFor="cat">
          <textarea id="cat" className="input textarea" rows={3} value={st.notes} onChange={(e) => set('notes', e.target.value)} maxLength={1500} placeholder="Tulis hal lain yang perlu diketahui pengawas" />
        </Field>
      </section>

      {/* ---------- 6. tanda tangan ---------- */}
      <section className="fcard" data-key="sig">
        <SectionTitle hint="Tanda tangan Mekanik / Electrician">6 · Tanda tangan</SectionTitle>
        {user?.signature_png && (
          <Segmented
            label="Sumber tanda tangan"
            value={st.sigMode}
            onChange={(v) => set('sigMode', v)}
            options={[
              { value: 'saved', label: 'Pakai tanda tangan saya' },
              { value: 'new', label: 'Gambar ulang' },
            ]}
          />
        )}
        {user?.signature_png && st.sigMode === 'saved' ? (
          <div className="sigprev">
            <img src={user.signature_png} alt="Tanda tangan tersimpan" />
            <div className="small muted">Tanda tangan tersimpan akan dipakai. Pilih "Gambar ulang" kalau mau mengganti.</div>
          </div>
        ) : (
          <>
            <SignaturePad initial={mode === 'edit' ? detail?.form.signature_png : st.signature} onChange={(png) => set('signature', png)} />
            {st.signature && (
              <label className="check">
                <input type="checkbox" checked={st.saveSig} onChange={(e) => set('saveSig', e.target.checked)} />
                <span>Simpan sebagai tanda tangan saya (besok tidak perlu menggambar lagi)</span>
              </label>
            )}
          </>
        )}
        {errors.find((e) => e.key === 'sig') && <div className="field__error">{errors.find((e) => e.key === 'sig')!.msg}</div>}
      </section>

      <div className="fpad" />
      {/* ---------- bar kirim ---------- */}
      <div className="subbar" role="region" aria-label="Kirim P2H">
        <div className="subbar__in">
          <div className="subbar__info">
            <div className="subbar__row">
              <b>
                {summary.done}/{summary.total}
              </b>{' '}
              butir diisi
              <span className="subbar__bar" aria-hidden="true">
                <span style={{ width: `${summary.total ? (summary.done / summary.total) * 100 : 0}%` }} />
              </span>
            </div>
            <div className="subbar__row small">
              {summary.done === 0 ? <span className="muted">Belum ada yang diisi</span> : <ResultChip result={summary.result} />}
              {summary.aa > 0 && <span className="stop-text">{summary.aa} temuan AA</span>}
              {summary.a > 0 && <span className="warn-text">{summary.a} temuan A</span>}
            </div>
          </div>
          <button type="button" className="btn btn--primary btn--lg" onClick={() => void submit()} disabled={busy}>
            <Icon name="send" size={20} />
            {busy ? 'Mengirim…' : mode === 'edit' ? 'Simpan perubahan' : 'Kirim P2H'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* =====================================================================
   Satu baris butir cek
   ===================================================================== */

interface RowProps {
  item: ChecklistItem;
  value: Condition | null;
  note: string;
  invalid: boolean;
  onChange: (id: number, c: Condition) => void;
  onNote: (id: number, note: string) => void;
}

const CheckRow = memo(function CheckRow({ item, value, note, invalid, onChange, onNote }: RowProps) {
  const bad = value === 'rusak' || value === 'perbaiki';
  return (
    <li className={`crow ${bad ? 'crow--bad' : ''} ${value === 'baik' ? 'crow--ok' : ''} ${invalid ? 'crow--invalid' : ''}`} data-key={`item-${item.id}`}>
      <div className="crow__top">
        <span className="crow__no">{item.no}</span>
        <div className="crow__text">
          {segments(item.text).map((s, i) => (s.bold ? <strong key={i}>{s.text}</strong> : <span key={i}>{s.text}</span>))}
          {item.hint && <div className="crow__hint">{item.hint}</div>}
        </div>
        <DangerCode code={item.danger_code} />
      </div>
      <Segmented
        label={`Kondisi: ${item.text.replace(/\*\*/g, '')}`}
        block
        className="crow__seg"
        value={value}
        onChange={(v) => onChange(item.id, v)}
        options={[
          { value: 'baik', label: 'Baik', tone: 'ok', icon: 'check' },
          { value: 'rusak', label: 'Rusak', tone: 'stop', icon: 'x' },
          { value: 'perbaiki', label: 'Perbaiki', tone: 'warn', icon: 'wrench' },
        ]}
      />
      {bad && (
        <div className="crow__bad">
          {item.danger_code === 'AA' && (
            <div className="crow__stop">
              <Icon name="stop" size={16} stroke={2.6} /> Kode AA: unit tidak boleh dijalankan sebelum diperbaiki (STOP OPERASI).
            </div>
          )}
          <label className="sr-only" htmlFor={`note-${item.id}`}>
            Catatan butir {item.no}
          </label>
          <textarea
            id={`note-${item.id}`}
            className="input textarea crow__note"
            rows={2}
            value={note}
            maxLength={500}
            onChange={(e) => onNote(item.id, e.target.value)}
            placeholder="Apa yang rusak / perlu diperbaiki? (wajib diisi)"
            aria-invalid={invalid && note.trim().length < 3}
          />
        </div>
      )}
    </li>
  );
});

/* =====================================================================
   Pilih unit
   ===================================================================== */

function UnitPicker({
  units,
  loading,
  sites,
  selected,
  onPick,
  onClear,
  siteId,
}: {
  units: Unit[];
  loading: boolean;
  sites: Meta['sites'];
  selected?: Unit;
  onPick: (u: Unit) => void;
  onClear: () => void;
  siteId: number | null;
}) {
  const [site, setSite] = useState<number | null>(siteId);
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    return units.filter(
      (u) =>
        u.status !== 'inactive' &&
        (!site || u.site_id === site) &&
        (!k || `${u.code} ${u.old_code ?? ''} ${u.brand ?? ''} ${u.model ?? ''} ${u.location ?? ''}`.toLowerCase().includes(k)),
    );
  }, [units, site, q]);

  if (selected) {
    return (
      <div className="unitsum">
        <div className="unitsum__main">
          <div className="mono unitsum__code">{unitTitle(selected)}</div>
          <div className="muted">
            {[modelOf(selected), selected.capacity_kva ? `${num(selected.capacity_kva)} kVA` : ''].filter(Boolean).join(' · ')} · {selected.site_name}
            {locationOf(selected) ? ` · ${locationOf(selected)}` : ''}
          </div>
        </div>
        <button type="button" className="btn btn--sm btn--ghost" onClick={onClear}>
          Ganti unit
        </button>
      </div>
    );
  }
  return (
    <div className="upick">
      <div className="chips" role="tablist" aria-label="Pilih site">
        <button type="button" role="tab" aria-selected={site === null} className={`fchip ${site === null ? 'is-on' : ''}`} onClick={() => setSite(null)}>
          Semua
        </button>
        {sites.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={site === s.id} className={`fchip ${site === s.id ? 'is-on' : ''}`} onClick={() => setSite(s.id)}>
            {s.name}
          </button>
        ))}
      </div>
      <label className="searchbox">
        <Icon name="search" size={18} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari kode, merek, lokasi…" aria-label="Cari unit" />
      </label>
      {loading && <Spinner label="Memuat daftar unit…" />}
      <ul className="ulist">
        {list.map((u) => (
          <li key={u.id}>
            <button type="button" className="upick__row" onClick={() => onPick(u)}>
              <span className="upick__main">
                <span className="mono upick__code">{unitTitle(u)}</span>
                <span className="small muted">
                  {modelOf(u) || '—'} · {u.site_name}
                  {locationOf(u) ? ` · ${locationOf(u)}` : ''}
                </span>
              </span>
              <span className="upick__tags">
                {u.current_form_id && <span className="chip chip--ok">Sudah P2H</span>}
                {u.status === 'breakdown' && <span className="chip chip--idle">Breakdown</span>}
                {u.open_aa > 0 && <span className="chip chip--stop">STOP</span>}
                {!u.open_aa && u.open_a > 0 && <span className="chip chip--warn">Temuan</span>}
              </span>
              <Icon name="chevR" size={18} className="muted" />
            </button>
          </li>
        ))}
        {!loading && list.length === 0 && <li className="muted small upick__none">Tidak ada unit yang cocok.</li>}
      </ul>
    </div>
  );
}

/* =====================================================================
   Layar setelah kirim
   ===================================================================== */

function DoneScreen({
  done,
  unit,
  detail,
  onAgain,
}: {
  done: { kind: 'sent' | 'queued'; id?: number; result: ResultKind; edited?: boolean };
  unit?: Unit;
  detail?: FormDetail;
  onAgain: () => void;
}) {
  const nav = useNavigate();
  const code = unit?.code ?? detail?.form.unit_code ?? '';
  const title =
    done.kind === 'queued'
      ? 'Tersimpan di HP'
      : done.result === 'stop_aa'
        ? 'STOP OPERASI'
        : done.result === 'temuan_a'
          ? 'P2H terkirim, ada temuan'
          : done.edited
            ? 'Perubahan tersimpan'
            : 'P2H terkirim';
  const tone = done.kind === 'queued' ? 'info' : done.result === 'stop_aa' ? 'stop' : done.result === 'temuan_a' ? 'warn' : 'ok';
  const icon = done.kind === 'queued' ? 'cloud' : done.result === 'stop_aa' ? 'stop' : done.result === 'temuan_a' ? 'alert' : 'check';
  return (
    <div className={`done done--${tone}`} role="status">
      <div className="done__icon">
        <Icon name={icon} size={44} stroke={2.4} />
      </div>
      <h1 className="done__title">{title}</h1>
      <p className="done__text">
        {done.kind === 'queued' ? (
          <>
            Tidak ada sinyal, jadi P2H <b className="mono">{code}</b> disimpan di HP ini. Akan dikirim otomatis begitu sinyal kembali. Jangan hapus aplikasi sebelum terkirim.
          </>
        ) : done.result === 'stop_aa' ? (
          <>
            <b className="mono">{code}</b> punya temuan kode AA. Unit <b>tidak boleh dijalankan</b> sebelum diperbaiki. Semua orang di aplikasi sudah diberi tahu.
          </>
        ) : done.result === 'temuan_a' ? (
          <>
            Temuan di <b className="mono">{code}</b> harus diperbaiki dalam 12 jam. Pengawas dan rekan sudah diberi tahu.
          </>
        ) : (
          <>
            P2H <b className="mono">{code}</b> tercatat, semua butir baik. Terima kasih!
          </>
        )}
      </p>
      <div className="done__actions">
        {done.id && (
          <button type="button" className="btn btn--dark" onClick={() => nav(`/p2h/${done.id}`)}>
            <Icon name="eye" size={18} /> Lihat P2H
          </button>
        )}
        {done.id && (
          <button type="button" className="btn btn--ghost" onClick={() => void downloadFile({ kind: 'p2h', format: 'pdf', id: done.id })}>
            <Icon name="download" size={18} /> Unduh PDF
          </button>
        )}
        {!done.edited && (
          <button type="button" className="btn btn--primary" onClick={onAgain}>
            <Icon name="plus" size={18} /> Isi unit lain
          </button>
        )}
        <Link to="/" className="btn btn--ghost">
          Ke beranda
        </Link>
      </div>
    </div>
  );
}

/* =====================================================================
   Isi awal untuk mode ubah
   ===================================================================== */

function fromDetail(meta: Meta, d: FormDetail): FormState {
  const base = blankState(meta, d.form.unit_id);
  const answers: FormState['answers'] = {};
  for (const s of d.sections) for (const it of s.items) if (it.item_id != null) answers[it.item_id] = { c: it.condition, note: it.note ?? '' };
  const params: FormState['params'] = { ...base.params };
  for (const p of d.params) params[p.key] = { idle: p.idle != null ? num(p.idle) : '', load: p.load != null ? num(p.load) : '' };
  return {
    ...base,
    uuid: '',
    unitId: d.form.unit_id,
    date: d.form.shift_date,
    shift: d.form.shift,
    location: d.form.location ?? '',
    jobSite: d.form.job_site ?? '',
    hmStart: d.form.hm_start != null ? num(d.form.hm_start) : '',
    hmEnd: d.form.hm_end != null ? num(d.form.hm_end) : '',
    answers,
    params,
    notes: d.form.notes ?? '',
    signature: null,
    sigMode: d.form.signature_png ? 'new' : 'saved',
    saveSig: false,
  };
}
