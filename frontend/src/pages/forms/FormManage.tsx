import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../components/Icon';
import { Confirm, ErrorBox, Field, PageHead, SectionTitle, Segmented, Sheet, Spinner } from '../../components/ui';
import { ApiError, api } from '../../lib/api';
import { useMeta } from '../../lib/hooks';
import { PERIOD_TEXT, SEVERITY_TEXT, limitText, useFormChecklist, useFormOverview , lowerFirst } from '../../lib/forms';
import { useToast } from '../../lib/toast';
import type { FormItem, FormItemKind, FormPeriod, FormSection, FormSeverity, FormSubject, FormType } from '../../lib/types';
import { SiteChips, useFormSite } from './SiteChips';

/** Kelola (admin): pengaturan form, objek yang diperiksa, dan daftar butir cek. */
export default function FormManagePage() {
  const { code = '' } = useParams();
  const ov = useFormOverview(code, true);
  const [scope, setScope] = useState<number | null>(null); // null = bagian umum
  const [site, setSite] = useFormSite();
  if (ov.isLoading) return <Spinner />;
  if (ov.error) return <ErrorBox error={ov.error} onRetry={() => void ov.refetch()} />;
  if (!ov.data) return null;
  const t = ov.data.type;
  const subs = ov.data.subjects.filter((s) => !site || s.site_id === site);
  const perSite: Record<number, number> = {};
  for (const s of ov.data.subjects) perSite[s.site_id] = (perSite[s.site_id] ?? 0) + 1;
  return (
    <div className="page fmanage">
      <PageHead eyebrow={`Kelola · ${t.short_name}`} title={t.name} />
      <TypeSettings t={t} />
      <SiteChips
        value={site}
        onChange={(v) => {
          setSite(v);
          setScope(null);
        }}
        counts={perSite}
      />
      <SubjectsPanel code={code} t={t} subjects={subs} allSubjects={ov.data.subjects} site={site} onOpenChecklist={(id) => setScope(id)} />
      <ChecklistPanel code={code} t={t} subjects={subs} scope={scope} setScope={setScope} sharedCount={ov.data.shared_items} />
    </div>
  );
}

function useRefresh() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['form'] }),
      qc.invalidateQueries({ queryKey: ['forms'] }),
      qc.invalidateQueries({ queryKey: ['form-checklist'] }),
    ]);
}

function errText(e: unknown) {
  return e instanceof ApiError ? e.message : 'Gagal menyimpan.';
}

/* ---------- pengaturan jenis form ---------- */

function TypeSettings({ t }: { t: FormType }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [v, setV] = useState({
    short_name: t.short_name,
    name: t.name,
    period: t.period,
    fix_hours: String(t.fix_hours),
    subject_label: t.subject_label,
    filler_label: t.filler_label,
    verifier_label: t.verifier_label,
    is_active: t.is_active,
    wa_findings: t.wa_findings,
    wa_verify: t.wa_verify,
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/api/forms/${t.code}`, { ...v, fix_hours: Math.max(1, Math.round(Number(v.fix_hours) || 24)) });
      await refresh();
      toast.push({ title: 'Pengaturan form disimpan', tone: 'ok' });
    } catch (e) {
      toast.push({ title: 'Gagal menyimpan', body: errText(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card fcard">
      <SectionTitle hint="Nama, periode pemeriksaan, dan batas waktu perbaikan temuan.">Pengaturan form</SectionTitle>
      <div className="grid2">
        <Field label="Nama di menu" htmlFor="sn">
          <input id="sn" className="input" value={v.short_name} maxLength={40} onChange={(e) => setV({ ...v, short_name: e.target.value })} />
        </Field>
        <Field label="Judul lengkap" htmlFor="nm">
          <input id="nm" className="input" value={v.name} maxLength={200} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Field label="Periode pemeriksaan" hint="Dipakai untuk menghitung yang sudah / belum diperiksa.">
          <select className="input" value={v.period} onChange={(e) => setV({ ...v, period: e.target.value as FormPeriod })}>
            {(['shift', 'day', 'week', 'biweek', 'month', 'quarter', 'half', 'none'] as FormPeriod[]).map((p) => (
              <option key={p} value={p}>
                {PERIOD_TEXT[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Batas perbaikan temuan (jam)" htmlFor="fh" hint="Untuk temuan yang bukan STOP.">
          <input id="fh" className="input mono" inputMode="numeric" value={v.fix_hours} onChange={(e) => setV({ ...v, fix_hours: e.target.value })} />
        </Field>
        <Field label="Sebutan objek" htmlFor="sl" hint="mis. Unit LV, Conveyor, Lokasi">
          <input id="sl" className="input" value={v.subject_label} maxLength={40} onChange={(e) => setV({ ...v, subject_label: e.target.value })} />
        </Field>
        <Field label="Sebutan pengisi" htmlFor="fl">
          <input id="fl" className="input" value={v.filler_label} maxLength={60} onChange={(e) => setV({ ...v, filler_label: e.target.value })} />
        </Field>
        <Field label="Sebutan pemeriksa (verifikasi)" htmlFor="vl">
          <input id="vl" className="input" value={v.verifier_label} maxLength={60} onChange={(e) => setV({ ...v, verifier_label: e.target.value })} />
        </Field>
        <Field label="Status">
          <label className="check">
            <input type="checkbox" checked={v.is_active} onChange={(e) => setV({ ...v, is_active: e.target.checked })} />
            <span>Form ini dipakai (tampil di layar pilih form)</span>
          </label>
        </Field>
        <Field label="Kabar ke grup WhatsApp" className="field--wide" hint="Hanya bila WhatsApp sudah ditautkan di Pengaturan.">
          <label className="check">
            <input type="checkbox" checked={v.wa_findings} onChange={(e) => setV({ ...v, wa_findings: e.target.checked })} />
            <span>Kirim setiap temuan (STOP &amp; perbaiki) dan saat temuan selesai diperbaiki</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={v.wa_verify} onChange={(e) => setV({ ...v, wa_verify: e.target.checked })} />
            <span>
              Kirim saat diverifikasi{' '}
              {v.period === 'shift' ? '(satu rekap per site per shift setelah semua isian shift itu terverifikasi)' : '(satu pesan per isian)'}
            </span>
          </label>
        </Field>
      </div>
      <div className="row">
        <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={busy}>
          {busy ? 'Menyimpan…' : 'Simpan pengaturan'}
        </button>
      </div>
      <WaGroupPicker t={t} />
    </section>
  );
}

type WaGroup = { id: string; name: string; size: number | null };

/**
 * Grup WhatsApp khusus form ini. Nomor yang ditautkan tetap satu (scan sekali di Pengaturan),
 * tetapi tiap form bisa mengirim ke grup yang berbeda. Kosong = grup utama.
 */
function WaGroupPicker({ t }: { t: FormType }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [groups, setGroups] = useState<WaGroup[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try {
      setGroups((await api.get<{ items: WaGroup[] }>('/api/admin/whatsapp/groups')).items);
    } catch (e) {
      toast.push({ title: 'Daftar grup gagal diambil', body: `${errText(e)} Pastikan WhatsApp sudah ditautkan di Pengaturan.`, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };
  const pick = async (id: string | null) => {
    setBusy(true);
    try {
      await api.put(`/api/forms/${t.code}/wa-group`, { id });
      await refresh();
      toast.push({ title: id ? 'Grup WhatsApp form ini disimpan' : 'Form ini memakai grup utama', tone: 'ok' });
    } catch (e) {
      toast.push({ title: 'Gagal memilih grup', body: errText(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fwa">
      <div className="fwa__head">
        <Icon name="send" size={18} />
        <div className="grow">
          <b>Grup WhatsApp form ini</b>
          <div className="small muted">
            {t.wa_group_id ? (
              <>
                Kabar {t.short_name} dikirim ke <b>{t.wa_group_name || t.wa_group_id}</b>.
              </>
            ) : (
              <>Memakai grup utama (diatur di Pengaturan &gt; WhatsApp). Pilih grup lain bila form ini punya grup sendiri.</>
            )}{' '}
            Nomor WhatsApp yang ditautkan cukup satu, dan harus sudah menjadi anggota grup tujuan.
          </div>
        </div>
      </div>
      {groups == null ? (
        <div className="row">
          <button type="button" className="btn btn--ghost" onClick={() => void load()} disabled={busy}>
            {busy ? 'Mengambil…' : t.wa_group_id ? 'Ganti grup' : 'Pilih grup sendiri'}
          </button>
          {t.wa_group_id && (
            <button type="button" className="btn btn--ghost" onClick={() => void pick(null)} disabled={busy}>
              Pakai grup utama
            </button>
          )}
        </div>
      ) : (
        <div className="row row--wrap">
          <select
            className="input input--auto"
            aria-label="Grup WhatsApp"
            value={t.wa_group_id ?? ''}
            disabled={busy}
            onChange={(e) => void pick(e.target.value || null).then(() => setGroups(null))}
          >
            <option value="">Grup utama (bawaan)</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
                {g.size ? ` (${g.size} anggota)` : ''}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn--ghost" onClick={() => setGroups(null)}>
            Batal
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- objek ---------- */

function SubjectsPanel({
  code,
  t,
  subjects,
  allSubjects,
  site,
  onOpenChecklist,
}: {
  code: string;
  t: FormType;
  subjects: FormSubject[];
  allSubjects: FormSubject[];
  site: number | null;
  onOpenChecklist: (id: number) => void;
}) {
  const [edit, setEdit] = useState<FormSubject | 'new' | null>(null);
  return (
    <section className="card fcard">
      <SectionTitle
        hint={`Daftar ${lowerFirst(t.subject_label)} yang bisa dipilih saat mengisi.`}
        right={
          <button type="button" className="btn btn--sm btn--primary" onClick={() => setEdit('new')}>
            <Icon name="plus" size={16} /> Tambah
          </button>
        }
      >
        {t.subject_label}
      </SectionTitle>
      {subjects.length === 0 && <div className="muted small">Belum ada. Tekan Tambah.</div>}
      <div className="tableview__scroll">
        <table className="table table--tight">
          <thead>
            <tr>
              <th>Nama</th>
              <th>Keterangan</th>
              <th>Site</th>
              <th className="num">Butir khusus</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {subjects.map((s) => (
              <tr key={s.id} className={s.is_active ? '' : 'is-off'}>
                <td className="mono">
                  {s.name} {!s.is_active && <span className="chip chip--idle">nonaktif</span>}
                </td>
                <td className="small">{s.detail ?? '—'}</td>
                <td className="small">{s.site_name}</td>
                <td className="num">
                  <button type="button" className="link" onClick={() => onOpenChecklist(s.id)}>
                    {s.own_items}
                  </button>
                </td>
                <td className="num">
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => setEdit(s)}>
                    <Icon name="pencil" size={14} /> Ubah
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SubjectSheet code={code} t={t} subjects={allSubjects} defaultSite={site} target={edit} onClose={() => setEdit(null)} />
    </section>
  );
}

function SubjectSheet({
  code,
  t,
  subjects,
  defaultSite,
  target,
  onClose,
}: {
  code: string;
  t: FormType;
  subjects: FormSubject[];
  defaultSite: number | null;
  target: FormSubject | 'new' | null;
  onClose: () => void;
}) {
  const meta = useMeta();
  const toast = useToast();
  const refresh = useRefresh();
  const isNew = target === 'new';
  const s = target && target !== 'new' ? target : null;
  const [v, setV] = useState({ name: '', detail: '', site_id: 0, is_active: true, copy_from: 0 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!target) return;
    setErr(null);
    setV({
      name: s?.name ?? '',
      detail: s?.detail ?? '',
      site_id: s?.site_id ?? defaultSite ?? meta.data?.sites[0]?.id ?? 0,
      is_active: s?.is_active ?? true,
      copy_from: 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const body = { name: v.name.trim(), detail: v.detail.trim() || null, site_id: v.site_id, is_active: v.is_active };
      if (isNew) await api.post(`/api/forms/${code}/subjects`, { ...body, copy_from: v.copy_from || null });
      else await api.put(`/api/forms/${code}/subjects/${s!.id}`, body);
      await refresh();
      toast.push({ title: isNew ? `${t.subject_label} ditambahkan` : 'Tersimpan', tone: 'ok' });
      onClose();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const withItems = subjects.filter((x) => x.own_items > 0);
  return (
    <Sheet
      open={!!target}
      onClose={onClose}
      title={isNew ? `Tambah ${lowerFirst(t.subject_label)}` : `Ubah ${s?.name ?? ''}`}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Batal
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={busy || !v.name.trim() || !v.site_id}>
            {busy ? 'Menyimpan…' : 'Simpan'}
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Nama / kode" htmlFor="snm" hint="mis. LV-012, CV-20, GEN-01">
          <input id="snm" className="input mono" value={v.name} maxLength={80} onChange={(e) => setV({ ...v, name: e.target.value })} data-autofocus />
        </Field>
        <Field label="Keterangan (boleh kosong)" htmlFor="sdt" hint="mis. merek / tipe / lokasi">
          <input id="sdt" className="input" value={v.detail} maxLength={160} onChange={(e) => setV({ ...v, detail: e.target.value })} />
        </Field>
        <Field label="Site">
          <select className="input" value={v.site_id} onChange={(e) => setV({ ...v, site_id: Number(e.target.value) })}>
            {meta.data?.sites.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </Field>
        {isNew && withItems.length > 0 && (
          <Field label="Salin butir khusus dari" hint="Berguna kalau daftar butirnya mirip (mis. conveyor lain). Bisa diubah sesudahnya.">
            <select className="input" value={v.copy_from} onChange={(e) => setV({ ...v, copy_from: Number(e.target.value) })}>
              <option value={0}>Tidak menyalin</option>
              {withItems.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} ({x.own_items} butir)
                </option>
              ))}
            </select>
          </Field>
        )}
        {!isNew && (
          <label className="check">
            <input type="checkbox" checked={v.is_active} onChange={(e) => setV({ ...v, is_active: e.target.checked })} />
            <span>Aktif (bisa dipilih saat mengisi)</span>
          </label>
        )}
        {err && <div className="banner banner--stop">{err}</div>}
      </div>
    </Sheet>
  );
}

/* ---------- daftar butir cek ---------- */

function ChecklistPanel({
  code,
  t,
  subjects,
  scope,
  setScope,
  sharedCount,
}: {
  code: string;
  t: FormType;
  subjects: FormSubject[];
  scope: number | null;
  setScope: (v: number | null) => void;
  sharedCount: number;
}) {
  const cl = useFormChecklist(code, scope, true);
  const toast = useToast();
  const refresh = useRefresh();
  const [item, setItem] = useState<{ item: FormItem | null; section: FormSection } | null>(null);
  const [sec, setSec] = useState<FormSection | 'new' | null>(null);
  const [delSec, setDelSec] = useState<FormSection | null>(null);
  // hanya bagian milik pilihan ini yang bisa diubah di sini
  const sections = (cl.data?.sections ?? []).filter((s) => (scope ? s.subject_id === scope : s.subject_id == null));

  const move = async (it: FormItem, dir: 'up' | 'down') => {
    try {
      await api.put(`/api/forms/${code}/items/${it.id}`, { ...itemBody(it), move: dir });
      await refresh();
    } catch (e) {
      toast.push({ title: 'Gagal', body: errText(e), tone: 'danger' });
    }
  };
  const moveSec = async (s: FormSection, dir: 'up' | 'down') => {
    try {
      await api.put(`/api/forms/${code}/sections/${s.id}`, { title: s.title, note: s.note, move: dir });
      await refresh();
    } catch (e) {
      toast.push({ title: 'Gagal', body: errText(e), tone: 'danger' });
    }
  };
  const toggle = async (it: FormItem) => {
    try {
      await api.put(`/api/forms/${code}/items/${it.id}`, { ...itemBody(it), is_active: !it.is_active });
      await refresh();
    } catch (e) {
      toast.push({ title: 'Gagal', body: errText(e), tone: 'danger' });
    }
  };
  const removeSec = async () => {
    if (!delSec) return;
    try {
      await api.del(`/api/forms/${code}/sections/${delSec.id}`);
      await refresh();
      setDelSec(null);
    } catch (e) {
      toast.push({ title: 'Gagal menghapus', body: errText(e), tone: 'danger' });
    }
  };

  return (
    <section className="card fcard">
      <SectionTitle
        hint="Butir umum berlaku untuk semua objek; butir khusus hanya untuk satu objek (mis. safety device per conveyor)."
        right={
          <button type="button" className="btn btn--sm btn--primary" onClick={() => setSec('new')}>
            <Icon name="plus" size={16} /> Bagian baru
          </button>
        }
      >
        Daftar butir cek
      </SectionTitle>
      <div className="chips chips--wrap" role="tablist" aria-label="Berlaku untuk">
        <button type="button" role="tab" aria-selected={scope === null} className={`fchip ${scope === null ? 'is-on' : ''}`} onClick={() => setScope(null)}>
          Semua {lowerFirst(t.subject_label)} ({sharedCount})
        </button>
        {subjects.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={scope === s.id} className={`fchip ${scope === s.id ? 'is-on' : ''}`} onClick={() => setScope(s.id)}>
            {s.name} ({s.own_items})
          </button>
        ))}
      </div>
      {cl.isLoading && <Spinner />}
      {cl.error && <ErrorBox error={cl.error} />}
      {cl.data && sections.length === 0 && <div className="muted small">Belum ada bagian di sini. Tekan "Bagian baru".</div>}
      {sections.map((s, si) => (
        <div key={s.id} className="mansec">
          <header className="mansec__head">
            <div className="grow">
              <b>{s.title}</b>
              {s.note && <div className="small muted">{s.note}</div>}
            </div>
            <button type="button" className="iconbtn iconbtn--plain" aria-label="Naikkan bagian" disabled={si === 0} onClick={() => void moveSec(s, 'up')}>
              <Icon name="chevU" size={16} />
            </button>
            <button type="button" className="iconbtn iconbtn--plain" aria-label="Turunkan bagian" disabled={si === sections.length - 1} onClick={() => void moveSec(s, 'down')}>
              <Icon name="chevD" size={16} />
            </button>
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setSec(s)}>
              <Icon name="pencil" size={14} /> Ubah
            </button>
            {s.items.length === 0 && (
              <button type="button" className="btn btn--sm btn--ghost btn--danger-text" onClick={() => setDelSec(s)}>
                <Icon name="trash" size={14} />
              </button>
            )}
          </header>
          <ol className="manitems">
            {s.items.map((it, i) => (
              <li key={it.id} className={it.is_active ? '' : 'is-off'}>
                <span className="manitems__no mono">{it.label ?? ''}</span>
                <span className="grow">
                  {it.text}
                  <span className="manitems__tags">
                    <span className="chip chip--idle">{it.kind === 'check' ? `${it.good_label} / ${it.bad_label}` : it.kind === 'measure' ? `Ukur${it.unit ? ` (${it.unit})` : ''}` : 'Isian'}</span>
                    {it.kind !== 'input' && <span className={`chip chip--${it.severity === 'stop' ? 'stop' : it.severity === 'fix' ? 'warn' : 'idle'}`}>{SEVERITY_TEXT[it.severity]}</span>}
                    {it.kind === 'measure' && limitText(it.min_value, it.max_value, it.unit) && <span className="chip chip--info">{limitText(it.min_value, it.max_value, it.unit)}</span>}
                    {!it.required && <span className="chip chip--idle">boleh dilewati</span>}
                    {!it.is_active && <span className="chip chip--idle">nonaktif</span>}
                  </span>
                </span>
                <button type="button" className="iconbtn iconbtn--plain" aria-label="Naikkan" disabled={i === 0} onClick={() => void move(it, 'up')}>
                  <Icon name="chevU" size={16} />
                </button>
                <button type="button" className="iconbtn iconbtn--plain" aria-label="Turunkan" disabled={i === s.items.length - 1} onClick={() => void move(it, 'down')}>
                  <Icon name="chevD" size={16} />
                </button>
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => setItem({ item: it, section: s })}>
                  Ubah
                </button>
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => void toggle(it)}>
                  {it.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                </button>
              </li>
            ))}
          </ol>
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => setItem({ item: null, section: s })}>
            <Icon name="plus" size={14} /> Tambah butir
          </button>
        </div>
      ))}
      <SectionSheet code={code} target={sec} subjectId={scope} onClose={() => setSec(null)} />
      <ItemSheet code={code} t={t} target={item} sections={sections} onClose={() => setItem(null)} />
      <Confirm open={!!delSec} danger title="Hapus bagian kosong ini?" body={<>Bagian "{delSec?.title}" akan dihapus.</>} confirmLabel="Hapus" onClose={() => setDelSec(null)} onConfirm={() => void removeSec()} />
    </section>
  );
}

function SectionSheet({ code, target, subjectId, onClose }: { code: string; target: FormSection | 'new' | null; subjectId: number | null; onClose: () => void }) {
  const refresh = useRefresh();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!target) return;
    setErr(null);
    setTitle(target === 'new' ? '' : target.title);
    setNote(target === 'new' ? '' : target.note ?? '');
  }, [target]);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (target === 'new') await api.post(`/api/forms/${code}/sections`, { title: title.trim(), note: note.trim() || null, subject_id: subjectId });
      else await api.put(`/api/forms/${code}/sections/${target!.id}`, { title: title.trim(), note: note.trim() || null });
      await refresh();
      onClose();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={!!target}
      onClose={onClose}
      title={target === 'new' ? 'Bagian baru' : 'Ubah bagian'}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Batal
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={busy || !title.trim()}>
            Simpan
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Judul bagian" htmlFor="stt">
          <input id="stt" className="input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} data-autofocus />
        </Field>
        <Field label="Petunjuk (boleh kosong)" htmlFor="snt" hint='mis. STOP bekerja jika ada jawaban "Tidak"'>
          <input id="snt" className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {err && <div className="banner banner--stop">{err}</div>}
      </div>
    </Sheet>
  );
}

const FIELD_PRESETS: Record<string, { key: string; label: string }[]> = {
  single: [{ key: 'v', label: 'Hasil' }],
  rst: [
    { key: 'r', label: 'R' },
    { key: 's', label: 'S' },
    { key: 't', label: 'T' },
  ],
  rst2: [
    { key: 'k_r', label: 'Kosongan R' },
    { key: 'k_s', label: 'Kosongan S' },
    { key: 'k_t', label: 'Kosongan T' },
    { key: 'm_r', label: 'Muatan R' },
    { key: 'm_s', label: 'Muatan S' },
    { key: 'm_t', label: 'Muatan T' },
  ],
};
const presetOf = (fields: { key: string }[]) =>
  Object.entries(FIELD_PRESETS).find(([, f]) => f.length === fields.length && f.every((x, i) => x.key === fields[i]?.key))?.[0] ?? 'single';

function itemBody(it: FormItem) {
  return {
    section_id: it.section_id,
    label: it.label,
    text: it.text,
    spec: it.spec,
    kind: it.kind,
    severity: it.severity,
    good_label: it.good_label,
    bad_label: it.bad_label,
    input_type: it.input_type,
    fields: it.fields,
    unit: it.unit,
    min_value: it.min_value,
    max_value: it.max_value,
    required: it.required,
    needs_photo: it.needs_photo,
    is_active: it.is_active,
  };
}

function ItemSheet({ code, t, target, sections, onClose }: { code: string; t: FormType; target: { item: FormItem | null; section: FormSection } | null; sections: FormSection[]; onClose: () => void }) {
  const refresh = useRefresh();
  const toast = useToast();
  const blank = {
    section_id: 0,
    label: '',
    text: '',
    spec: '',
    kind: 'check' as FormItemKind,
    severity: 'fix' as FormSeverity,
    good_label: 'Baik',
    bad_label: 'Rusak',
    input_type: 'text' as 'text' | 'date' | 'number',
    preset: 'single',
    unit: '',
    min: '',
    max: '',
    required: true,
    needs_photo: t.photo_required,
    is_active: true,
  };
  const [v, setV] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!target) return;
    setErr(null);
    const it = target.item;
    const sib = target.section.items.find((x) => x.kind === 'check');
    setV(
      it
        ? {
            section_id: it.section_id,
            label: it.label ?? '',
            text: it.text,
            spec: it.spec ?? '',
            kind: it.kind,
            severity: it.severity,
            good_label: it.good_label,
            bad_label: it.bad_label,
            input_type: it.input_type,
            preset: presetOf(it.fields),
            unit: it.unit ?? '',
            min: it.min_value != null ? String(it.min_value) : '',
            max: it.max_value != null ? String(it.max_value) : '',
            required: it.required,
            needs_photo: it.needs_photo,
            is_active: it.is_active,
          }
        : // butir baru: ikuti pilihan Baik/Tidak butir lain di bagian itu
          { ...blank, section_id: target.section.id, good_label: sib?.good_label ?? 'Baik', bad_label: sib?.bad_label ?? 'Rusak', severity: sib?.severity ?? 'fix', label: String(target.section.items.length + 1) },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
  const save = async () => {
    const min = num(v.min);
    const max = num(v.max);
    if ((min != null && Number.isNaN(min)) || (max != null && Number.isNaN(max))) {
      setErr('Batas harus berupa angka.');
      return;
    }
    setBusy(true);
    setErr(null);
    const body = {
      section_id: v.section_id,
      label: v.label.trim() || null,
      text: v.text.trim(),
      spec: v.spec.trim() || null,
      kind: v.kind,
      severity: v.severity,
      good_label: v.good_label.trim() || 'Baik',
      bad_label: v.bad_label.trim() || 'Rusak',
      input_type: v.input_type,
      fields: v.kind === 'measure' ? FIELD_PRESETS[v.preset] : [],
      unit: v.unit.trim() || null,
      min_value: min,
      max_value: max,
      required: v.required,
      needs_photo: v.needs_photo,
      is_active: v.is_active,
    };
    try {
      if (target?.item) await api.put(`/api/forms/${code}/items/${target.item.id}`, body);
      else await api.post(`/api/forms/${code}/items`, body);
      await refresh();
      toast.push({ title: 'Butir tersimpan', tone: 'ok' });
      onClose();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={!!target}
      onClose={onClose}
      wide
      title={target?.item ? 'Ubah butir' : 'Butir baru'}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Batal
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={busy || v.text.trim().length < 2}>
            {busy ? 'Menyimpan…' : 'Simpan'}
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="grid2">
          <Field label="No." htmlFor="ilb" hint="mis. 1, 2a">
            <input id="ilb" className="input mono" value={v.label} maxLength={10} onChange={(e) => setV({ ...v, label: e.target.value })} />
          </Field>
          <Field label="Bagian">
            <select className="input" value={v.section_id} onChange={(e) => setV({ ...v, section_id: Number(e.target.value) })}>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Butir yang diperiksa" htmlFor="itx">
          <input id="itx" className="input" value={v.text} maxLength={300} onChange={(e) => setV({ ...v, text: e.target.value })} data-autofocus />
        </Field>
        <Field label="Keterangan tambahan (boleh kosong)" htmlFor="isp" hint="mis. model / merek / jumlah, atau KW motor">
          <input id="isp" className="input" value={v.spec} maxLength={200} onChange={(e) => setV({ ...v, spec: e.target.value })} />
        </Field>
        <Field label="Jenis isian">
          <Segmented
            label="Jenis isian"
            block
            value={v.kind}
            onChange={(k) => setV({ ...v, kind: k })}
            options={[
              { value: 'check', label: 'Pilihan baik / tidak' },
              { value: 'measure', label: 'Angka ukur' },
              { value: 'input', label: 'Isian bebas' },
            ]}
          />
        </Field>
        {v.kind === 'check' && (
          <div className="grid2">
            <Field label="Label baik" htmlFor="igl" hint="mis. Baik, Ya, Fungsi, Ketarik">
              <input id="igl" className="input" value={v.good_label} maxLength={20} onChange={(e) => setV({ ...v, good_label: e.target.value })} />
            </Field>
            <Field label="Label tidak baik" htmlFor="ibl" hint="mis. Rusak, Tidak">
              <input id="ibl" className="input" value={v.bad_label} maxLength={20} onChange={(e) => setV({ ...v, bad_label: e.target.value })} />
            </Field>
          </div>
        )}
        {v.kind === 'measure' && (
          <>
            <Field label="Kolom ukur">
              <Segmented
                label="Kolom ukur"
                block
                value={v.preset}
                onChange={(p) => setV({ ...v, preset: p })}
                options={[
                  { value: 'single', label: 'Satu nilai' },
                  { value: 'rst', label: 'R / S / T' },
                  { value: 'rst2', label: 'R S T kosongan & muatan' },
                ]}
              />
            </Field>
            <div className="grid2">
              <Field label="Satuan" htmlFor="iun" hint="mis. A, V, MOhm, Ohm">
                <input id="iun" className="input" value={v.unit} maxLength={12} onChange={(e) => setV({ ...v, unit: e.target.value })} />
              </Field>
              <span />
              <Field label="Batas minimum (boleh kosong)" htmlFor="imn">
                <input id="imn" className="input mono" inputMode="decimal" value={v.min} onChange={(e) => setV({ ...v, min: e.target.value })} />
              </Field>
              <Field label="Batas maksimum (boleh kosong)" htmlFor="imx">
                <input id="imx" className="input mono" inputMode="decimal" value={v.max} onChange={(e) => setV({ ...v, max: e.target.value })} />
              </Field>
            </div>
          </>
        )}
        {v.kind === 'input' && (
          <Field label="Jenis isian">
            <Segmented
              label="Jenis isian bebas"
              block
              value={v.input_type}
              onChange={(k) => setV({ ...v, input_type: k })}
              options={[
                { value: 'text', label: 'Teks' },
                { value: 'date', label: 'Tanggal' },
                { value: 'number', label: 'Angka' },
              ]}
            />
          </Field>
        )}
        {v.kind !== 'input' && (
          <Field label={v.kind === 'check' ? `Bila "${v.bad_label}"` : 'Bila di luar batas'}>
            <Segmented
              label="Tingkat temuan"
              block
              value={v.severity}
              onChange={(s) => setV({ ...v, severity: s })}
              options={[
                { value: 'stop', label: 'STOP', tone: 'stop' },
                { value: 'fix', label: `Perbaiki (${t.fix_hours} jam)`, tone: 'warn' },
                { value: 'note', label: 'Dicatat saja' },
              ]}
            />
          </Field>
        )}
        <label className="check">
          <input type="checkbox" checked={v.required} onChange={(e) => setV({ ...v, required: e.target.checked })} />
          <span>Wajib diisi</span>
        </label>
        {v.kind === 'check' && (
          <label className="check">
            <input type="checkbox" checked={v.needs_photo} onChange={(e) => setV({ ...v, needs_photo: e.target.checked })} />
            <span>Wajib foto bila "{v.bad_label}"</span>
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={v.is_active} onChange={(e) => setV({ ...v, is_active: e.target.checked })} />
          <span>Aktif (muncul di form)</span>
        </label>
        {err && <div className="banner banner--stop">{err}</div>}
      </div>
    </Sheet>
  );
}
