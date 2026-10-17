import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../components/Icon';
import { Confirm, DangerCode, Empty, ErrorBox, Field, PageHead, SectionTitle, Sheet, Spinner } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ROLE_LABEL, ago, dateTime, segments } from '../lib/format';
import { useMeta } from '../lib/hooks';
import { useToast } from '../lib/toast';
import type { ChecklistSection, Role, Settings, UserRow } from '../lib/types';

/* =====================================================================
   Pengguna
   ===================================================================== */

const ROLES: Role[] = ['teknisi', 'pengawas', 'admin'];

async function copyText(s: string) {
  try {
    await navigator.clipboard.writeText(s);
    return true;
  } catch {
    return false;
  }
}

export function UsersPage() {
  const meta = useMeta();
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['users'], queryFn: () => api.get<{ items: UserRow[] }>('/api/users') });
  const [edit, setEdit] = useState<UserRow | 'new' | null>(null);
  const [imp, setImp] = useState(false);
  const [cred, setCred] = useState<{ title: string; lines: { nrp: string; name: string; pw: string }[] } | null>(null);
  const [filter, setFilter] = useState('');
  const sites = meta.data?.sites ?? [];

  const list = useMemo(() => {
    const k = filter.trim().toLowerCase();
    return (q.data?.items ?? []).filter((u) => !k || `${u.nrp} ${u.name} ${u.role} ${u.company ?? ''} ${u.job_title ?? ''}`.toLowerCase().includes(k));
  }, [q.data, filter]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });

  return (
    <div className="page">
      <PageHead eyebrow="Kelola" title="Pengguna">
        <button type="button" className="btn btn--ghost" onClick={() => setImp(true)}>
          <Icon name="table" size={18} /> Impor dari Excel
        </button>
        <button type="button" className="btn btn--primary" onClick={() => setEdit('new')}>
          <Icon name="plus" size={18} /> Tambah
        </button>
      </PageHead>

      <label className="searchbox">
        <Icon name="search" size={18} />
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Cari nama, No SID, atau perusahaan…" aria-label="Cari pengguna" />
      </label>

      {q.isLoading && <Spinner />}
      {q.error && <ErrorBox error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && list.length === 0 && <Empty icon="users" title="Tidak ada pengguna" />}

      <div className="card tablecard">
        <table className="table table--hover">
          <thead>
            <tr>
              <th>Nama</th>
              <th>No SID</th>
              <th>Peran</th>
              <th className="hide-on-phone">Site</th>
              <th className="hide-on-phone">Masuk terakhir</th>
              <th className="hide-on-phone num">HP notif</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id} className="is-click" onClick={() => setEdit(u)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setEdit(u)}>
                <td>
                  <b>{u.name}</b>
                  {(u.company || u.job_title) && <div className="small muted">{[u.company, u.job_title].filter(Boolean).join(' · ')}</div>}
                </td>
                <td className="mono">{u.nrp}</td>
                <td>{ROLE_LABEL[u.role]}</td>
                <td className="hide-on-phone">{u.role === 'admin' ? 'Semua site' : sites.find((s) => s.id === u.site_id)?.name ?? <span className="stop-text">belum ada</span>}</td>
                <td className="hide-on-phone small">{u.last_login_at ? ago(u.last_login_at) : <span className="muted">belum pernah</span>}</td>
                <td className="hide-on-phone num">{u.devices}</td>
                <td>
                  {!u.is_active ? <span className="chip chip--idle">Nonaktif</span> : u.must_change_password ? <span className="chip chip--warn">Belum ganti password</span> : <span className="chip chip--ok">Aktif</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <UserSheet
        target={edit}
        sites={sites}
        isSelf={(id) => id === me?.id}
        onClose={() => setEdit(null)}
        onSaved={async (c) => {
          await refresh();
          if (c) setCred(c);
        }}
      />
      <ImportSheet
        open={imp}
        onClose={() => setImp(false)}
        onDone={async (lines) => {
          await refresh();
          setImp(false);
          setCred({ title: 'Akun yang dibuat', lines });
          toast.push({ title: `${lines.length} akun dibuat`, tone: 'ok' });
        }}
      />
      <CredSheet cred={cred} onClose={() => setCred(null)} />
    </div>
  );
}

function CredSheet({ cred, onClose }: { cred: { title: string; lines: { nrp: string; name: string; pw: string }[] } | null; onClose: () => void }) {
  const toast = useToast();
  const text = (cred?.lines ?? []).map((l) => `${l.nrp}\t${l.name}\t${l.pw}`).join('\n');
  return (
    <Sheet
      open={!!cred}
      onClose={onClose}
      title={cred?.title ?? ''}
      wide
      footer={
        <>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={async () => toast.push({ title: (await copyText(`No SID\tNama\tPassword awal\n${text}`)) ? 'Disalin (siap ditempel ke Excel)' : 'Tidak bisa menyalin', tone: 'info' })}
          >
            <Icon name="copy" size={16} /> Salin semua
          </button>
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Selesai
          </button>
        </>
      }
    >
      <div className="banner banner--warn">
        <Icon name="key" size={18} />
        <div className="grow">
          <b>Catat sekarang.</b> Password awal hanya tampil sekali dan tidak bisa dilihat lagi. Setiap orang wajib membuat password baru saat masuk pertama kali.
        </div>
      </div>
      <table className="table table--tight">
        <thead>
          <tr>
            <th>No SID</th>
            <th>Nama</th>
            <th>Password awal</th>
          </tr>
        </thead>
        <tbody>
          {cred?.lines.map((l) => (
            <tr key={l.nrp}>
              <td className="mono">{l.nrp}</td>
              <td>{l.name}</td>
              <td className="mono"><b>{l.pw}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Sheet>
  );
}

function UserSheet({
  target,
  sites,
  isSelf,
  onClose,
  onSaved,
}: {
  target: UserRow | 'new' | null;
  sites: { id: number; name: string }[];
  isSelf: (id: number) => boolean;
  onClose: () => void;
  onSaved: (cred?: { title: string; lines: { nrp: string; name: string; pw: string }[] }) => Promise<unknown>;
}) {
  const toast = useToast();
  const [f, setF] = useState({ nrp: '', name: '', company: '', role: 'teknisi' as Role, site_id: '' as string | number, job_title: '', phone: '', password: '', is_active: true });
  const [loaded, setLoaded] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reset, setReset] = useState(false);

  if (target !== loaded) {
    setLoaded(target);
    setErr(null);
    if (target === 'new') setF({ nrp: '', name: '', company: '', role: 'teknisi', site_id: sites[0]?.id ?? '', job_title: '', phone: '', password: '', is_active: true });
    else if (target) setF({ nrp: target.nrp, name: target.name, company: target.company ?? '', role: target.role, site_id: target.site_id ?? '', job_title: target.job_title ?? '', phone: target.phone ?? '', password: '', is_active: target.is_active });
  }
  const up = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const isNew = target === 'new';
  const self = !isNew && target && isSelf(target.id);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (f.role !== 'admin' && f.site_id === '') {
        setErr('Pilih site untuk teknisi / pengawas. Mereka hanya akan melihat data di site itu.');
        setBusy(false);
        return;
      }
      const common = {
        name: f.name.trim(),
        role: f.role,
        site_id: f.role === 'admin' || f.site_id === '' ? null : Number(f.site_id),
        company: f.company.trim() || null,
        job_title: f.job_title.trim() || null,
        phone: f.phone.trim() || null,
      };
      if (isNew) {
        const r = await api.post<{ item: UserRow; initial_password: string }>('/api/users', { nrp: f.nrp.trim(), ...common, password: f.password || undefined });
        toast.push({ title: 'Akun dibuat', tone: 'ok' });
        await onSaved({ title: 'Akun baru', lines: [{ nrp: r.item.nrp, name: r.item.name, pw: r.initial_password }] });
      } else {
        await api.put(`/api/users/${(target as UserRow).id}`, { ...common, is_active: f.is_active });
        toast.push({ title: 'Perubahan disimpan', tone: 'ok' });
        await onSaved();
      }
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Gagal menyimpan.');
    } finally {
      setBusy(false);
    }
  };

  const doReset = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ nrp: string; name: string; initial_password: string }>(`/api/users/${(target as UserRow).id}/reset-password`);
      setReset(false);
      onClose();
      await onSaved({ title: 'Password direset', lines: [{ nrp: r.nrp, name: r.name, pw: r.initial_password }] });
    } catch (e) {
      setReset(false);
      setErr(e instanceof ApiError ? e.message : 'Gagal mereset.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Sheet
        open={!!target}
        onClose={onClose}
        title={isNew ? 'Tambah pengguna' : 'Ubah pengguna'}
        footer={
          <>
            {!isNew && (
              <button type="button" className="btn btn--ghost" onClick={() => setReset(true)} disabled={busy}>
                <Icon name="key" size={16} /> Reset password
              </button>
            )}
            <span className="grow" />
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
              Batal
            </button>
            <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={busy || f.name.trim().length < 2 || (isNew && f.nrp.trim().length < 2)}>
              {busy ? 'Menyimpan…' : 'Simpan'}
            </button>
          </>
        }
      >
        <div className="stack">
          <div className="grid2">
            <Field label="No SID (untuk masuk)" htmlFor="x-nrp" hint={isNew ? 'Huruf / angka, tanpa spasi' : undefined}>
              <input id="x-nrp" className="input mono" value={f.nrp} onChange={(e) => up('nrp', e.target.value)} disabled={!isNew} autoCapitalize="none" data-autofocus />
            </Field>
            <Field label="Nama lengkap" htmlFor="x-name">
              <input id="x-name" className="input" value={f.name} onChange={(e) => up('name', e.target.value)} />
            </Field>
            <Field label="Perusahaan" htmlFor="x-company">
              <input id="x-company" className="input" value={f.company} onChange={(e) => up('company', e.target.value)} placeholder="mis. PT Mutiara Tanjung Lestari" />
            </Field>
            <Field label="Jabatan" htmlFor="x-job">
              <input id="x-job" className="input" value={f.job_title} onChange={(e) => up('job_title', e.target.value)} placeholder="mis. Electrician" />
            </Field>
            <Field label="Peran" htmlFor="x-role">
              <select id="x-role" className="input" value={f.role} onChange={(e) => up('role', e.target.value as Role)} disabled={!!self}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Site" htmlFor="x-site" hint={f.role === 'admin' ? 'Admin melihat semua site.' : 'Hanya melihat data di site ini.'}>
              <select id="x-site" className="input" value={f.role === 'admin' ? '' : f.site_id} onChange={(e) => up('site_id', e.target.value)} disabled={f.role === 'admin'}>
                {f.role === 'admin' ? (
                  <option value="">Semua site</option>
                ) : (
                  <option value="" disabled>
                    Pilih site…
                  </option>
                )}
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="No. HP" htmlFor="x-hp">
              <input id="x-hp" className="input" inputMode="tel" value={f.phone} onChange={(e) => up('phone', e.target.value)} />
            </Field>
          </div>
          {isNew && (
            <Field label="Password awal (boleh kosong)" htmlFor="x-pw" hint="Kosong = dibuatkan otomatis. Orangnya wajib menggantinya saat masuk pertama kali.">
              <input id="x-pw" className="input mono" value={f.password} onChange={(e) => up('password', e.target.value)} autoComplete="off" />
            </Field>
          )}
          {!isNew && (
            <label className="check">
              <input type="checkbox" checked={f.is_active} onChange={(e) => up('is_active', e.target.checked)} disabled={!!self} />
              <span>Akun aktif (matikan kalau orangnya sudah tidak bertugas)</span>
            </label>
          )}
          <div className="small muted">
            <b>Peran:</b> Teknisi = isi P2H dan perbarui temuan · Pengawas = periksa dan verifikasi P2H (tanda tangan) dan perbarui temuan · Admin = kelola akun, unit, daftar cek, dan pengaturan, melihat semua site. Teknisi dan pengawas hanya melihat site-nya.
          </div>
          {err && (
            <div className="banner banner--stop" role="alert">
              <Icon name="alert" size={18} />
              <div className="grow">{err}</div>
            </div>
          )}
        </div>
      </Sheet>
      <Confirm open={reset} title="Reset password?" confirmLabel="Reset" busy={busy} onClose={() => setReset(false)} onConfirm={() => void doReset()} body="Password lama langsung tidak berlaku dan semua HP orang ini akan keluar. Password sementara yang baru akan ditampilkan sekali." />
    </>
  );
}

/* ---------- impor tempel dari Excel ---------- */

interface ParsedRow {
  nrp: string;
  name: string;
  company: string;
  job_title: string;
  role: string;
  site: string;
  password: string;
}

function parsePaste(text: string): ParsedRow[] {
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.split(/\t|;/).map((c) => c.trim()))
    .filter((r) => r.some(Boolean));
  if (rows.length && /sid|nrp|id\s*karyawan|^id$/i.test(rows[0][0] ?? '') && /nama/i.test(rows[0][1] ?? '')) rows.shift();
  // urutan kolom: No SID, Nama, Perusahaan, Jabatan, Peran, Site, Password (boleh kosong)
  return rows.map((r) => ({ nrp: r[0] ?? '', name: r[1] ?? '', company: r[2] ?? '', job_title: r[3] ?? '', role: r[4] ?? '', site: r[5] ?? '', password: r[6] ?? '' }));
}

function ImportSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (lines: { nrp: string; name: string; pw: string }[]) => Promise<unknown> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ created: number; failed: number; results: { row: number; nrp: string; name: string; status: string; message?: string; initial_password?: string }[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const rows = useMemo(() => parsePaste(text), [text]);

  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<NonNullable<typeof res>>('/api/users/import', { users: rows });
      setRes(r);
      if (r.failed === 0) {
        await onDone(r.results.filter((x) => x.initial_password).map((x) => ({ nrp: x.nrp, name: x.name, pw: x.initial_password! })));
        setText('');
        setRes(null);
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Gagal mengimpor.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      wide
      title="Impor akun dari Excel"
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Tutup
          </button>
          {res && res.created > 0 && (
            <button
              type="button"
              className="btn btn--dark"
              onClick={() => void onDone(res.results.filter((x) => x.initial_password).map((x) => ({ nrp: x.nrp, name: x.name, pw: x.initial_password! })))}
            >
              Lihat password yang dibuat ({res.created})
            </button>
          )}
          <button type="button" className="btn btn--primary" onClick={() => void go()} disabled={busy || rows.length === 0}>
            {busy ? 'Memproses…' : `Buat ${rows.length} akun`}
          </button>
        </>
      }
    >
      <div className="stack">
        <ol className="steps">
          <li>
            Di Excel, siapkan kolom: <b>No SID · Nama · Perusahaan · Jabatan · Peran · Site</b> (kolom ke-7 password boleh kosong). Template ada di folder <b>docs</b>.
          </li>
          <li>
            Blok semua barisnya, <b>salin (Ctrl+C)</b>, lalu <b>tempel (Ctrl+V)</b> di kotak bawah.
          </li>
          <li>
            Peran: teknisi / pengawas / admin (juga boleh "electrician", "foreman", "spv"). Site: Binungan, Suaran, Gurimbang, Lati, Sambarata. Site wajib untuk teknisi dan pengawas.
          </li>
        </ol>
        <textarea className="input textarea mono" rows={8} value={text} onChange={(e) => { setText(e.target.value); setRes(null); }} placeholder={'12345\tAndi\tPT Mutiara Tanjung Lestari\tElectrician\tteknisi\tSuaran\n12346\tBudi\tPT Berau Coal\tForeman\tpengawas\tBinungan'} aria-label="Tempel dari Excel" />
        {rows.length > 0 && <div className="small muted">{rows.length} baris terbaca.</div>}
        {err && (
          <div className="banner banner--stop" role="alert">
            <Icon name="alert" size={18} />
            <div className="grow">{err}</div>
          </div>
        )}
        {res && (
          <div className="stack">
            <div className={`banner ${res.failed ? 'banner--warn' : 'banner--ok'}`}>
              <Icon name={res.failed ? 'alert' : 'check'} size={18} />
              <div className="grow">
                {res.created} akun dibuat, {res.failed} gagal. Yang gagal tidak dibuat; perbaiki barisnya lalu tempel ulang hanya baris yang gagal.
              </div>
            </div>
            <table className="table table--tight">
              <tbody>
                {res.results.filter((x) => x.status === 'gagal').map((x) => (
                  <tr key={x.row}>
                    <td className="num">{x.row}</td>
                    <td className="mono">{x.nrp}</td>
                    <td>{x.name}</td>
                    <td className="stop-text">{x.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/* =====================================================================
   Daftar cek
   ===================================================================== */

export function ChecklistPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin-checklist'], queryFn: () => api.get<{ sections: ChecklistSection[] }>('/api/admin/checklist') });
  const [edit, setEdit] = useState<{ id?: number; section_code: string; text: string; hint: string; danger_code: 'AA' | 'A'; is_active: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: ['admin-checklist'] }), qc.invalidateQueries({ queryKey: ['meta'] })]);
  };

  const move = useMutation({
    mutationFn: (v: { id: number; dir: 'up' | 'down' }) => api.post(`/api/admin/checklist/items/${v.id}/move`, { dir: v.dir }),
    onSuccess: refresh,
  });
  const toggle = useMutation({
    mutationFn: (it: { id: number; section: string; text: string; hint: string | null; danger_code: 'AA' | 'A'; is_active: boolean }) =>
      api.put(`/api/admin/checklist/items/${it.id}`, { section_code: it.section, text: it.text, hint: it.hint, danger_code: it.danger_code, is_active: !it.is_active }),
    onSuccess: refresh,
  });

  const save = async () => {
    if (!edit) return;
    setBusy(true);
    setErr(null);
    try {
      const body = { section_code: edit.section_code, text: edit.text.trim(), hint: edit.hint.trim() || null, danger_code: edit.danger_code, is_active: edit.is_active };
      if (edit.id) await api.put(`/api/admin/checklist/items/${edit.id}`, body);
      else await api.post('/api/admin/checklist/items', body);
      await refresh();
      toast.push({ title: 'Daftar cek disimpan', tone: 'ok' });
      setEdit(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Gagal menyimpan.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHead eyebrow="Kelola" title="Daftar cek" />
      <div className="banner banner--info">
        <Icon name="info" size={18} />
        <div className="grow">
          Perubahan hanya berlaku untuk P2H <b>baru</b>. P2H lama tetap memakai teks aslinya. Untuk menghapus butir, matikan saja ("Nonaktif") supaya arsip tetap utuh. Tulis <code>**tebal**</code> untuk huruf tebal.
        </div>
      </div>
      {q.isLoading && <Spinner />}
      {q.error && <ErrorBox error={q.error} onRetry={() => void q.refetch()} />}
      {q.data?.sections.map((s) => (
        <section key={s.id} className="card">
          <SectionTitle right={<button type="button" className="btn btn--sm btn--ghost" onClick={() => setEdit({ section_code: s.code, text: '', hint: '', danger_code: 'A', is_active: true })}><Icon name="plus" size={16} /> Tambah butir</button>}>{s.title}</SectionTitle>
          <ol className="cl">
            {s.items.map((it, i) => (
              <li key={it.id} className={`cl__row ${it.is_active ? '' : 'is-off'}`}>
                <span className="cl__no">{it.is_active ? it.no : '—'}</span>
                <span className="cl__text">
                  {segments(it.text).map((x, k) => (x.bold ? <strong key={k}>{x.text}</strong> : <span key={k}>{x.text}</span>))}
                  {it.hint && <span className="small muted"> · {it.hint}</span>}
                </span>
                <DangerCode code={it.danger_code} />
                <span className="cl__actions">
                  <button type="button" className="iconbtn iconbtn--plain" aria-label="Geser naik" disabled={i === 0} onClick={() => move.mutate({ id: it.id, dir: 'up' })}>
                    <Icon name="chevU" size={18} />
                  </button>
                  <button type="button" className="iconbtn iconbtn--plain" aria-label="Geser turun" disabled={i === s.items.length - 1} onClick={() => move.mutate({ id: it.id, dir: 'down' })}>
                    <Icon name="chevD" size={18} />
                  </button>
                  <button type="button" className="iconbtn iconbtn--plain" aria-label="Ubah" onClick={() => setEdit({ id: it.id, section_code: s.code, text: it.text, hint: it.hint ?? '', danger_code: it.danger_code, is_active: it.is_active })}>
                    <Icon name="pencil" size={18} />
                  </button>
                  <button type="button" className={`btn btn--sm ${it.is_active ? 'btn--ghost' : 'btn--dark'}`} onClick={() => toggle.mutate({ id: it.id, section: s.code, text: it.text, hint: it.hint, danger_code: it.danger_code, is_active: it.is_active })}>
                    {it.is_active ? 'Matikan' : 'Aktifkan'}
                  </button>
                </span>
              </li>
            ))}
          </ol>
        </section>
      ))}

      <Sheet
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? 'Ubah butir cek' : 'Tambah butir cek'}
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setEdit(null)} disabled={busy}>
              Batal
            </button>
            <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={busy || (edit?.text.trim().length ?? 0) < 3}>
              {busy ? 'Menyimpan…' : 'Simpan'}
            </button>
          </>
        }
      >
        {edit && (
          <div className="stack">
            <Field label="Tulisan butir cek" htmlFor="c-text">
              <textarea id="c-text" className="input textarea" rows={2} value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} data-autofocus />
            </Field>
            <Field label="Petunjuk kecil (boleh kosong)" htmlFor="c-hint">
              <input id="c-hint" className="input" value={edit.hint} onChange={(e) => setEdit({ ...edit, hint: e.target.value })} placeholder="mis. Sesuaikan dengan type engine" />
            </Field>
            <Field label="Kode bahaya">
              <div className="seg seg--block" role="radiogroup" aria-label="Kode bahaya">
                {(['AA', 'A'] as const).map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={edit.danger_code === c} className={`seg__btn ${edit.danger_code === c ? 'is-on' : ''}`} onClick={() => setEdit({ ...edit, danger_code: c })}>
                    {c === 'AA' ? 'AA · STOP OPERASI' : 'A · perbaiki ≤ 12 jam'}
                  </button>
                ))}
              </div>
            </Field>
            {err && (
              <div className="banner banner--stop" role="alert">
                <Icon name="alert" size={18} />
                <div className="grow">{err}</div>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}

/* =====================================================================
   Pengaturan
   ===================================================================== */

export function SettingsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin-settings'], queryFn: () => api.get<{ settings: Settings }>('/api/admin/settings') });
  const audit = useQuery({ queryKey: ['audit'], queryFn: () => api.get<{ items: { id: number; user_name: string | null; action: string; entity: string; entity_id: string | null; created_at: string }[] }>('/api/admin/audit?limit=60') });
  const [f, setF] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cur = f ?? q.data?.settings ?? null;

  const save = async () => {
    if (!cur) return;
    setBusy(true);
    setErr(null);
    try {
      await api.put('/api/admin/settings', cur);
      await Promise.all([qc.invalidateQueries({ queryKey: ['admin-settings'] }), qc.invalidateQueries({ queryKey: ['meta'] })]);
      toast.push({ title: 'Pengaturan disimpan', tone: 'ok' });
      setF(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Gagal menyimpan.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHead eyebrow="Kelola" title="Pengaturan" />
      {q.isLoading && <Spinner />}
      {q.error && <ErrorBox error={q.error} onRetry={() => void q.refetch()} />}
      {cur && (
        <section className="card">
          <SectionTitle hint="Berlaku untuk semua site">Shift dan aturan form</SectionTitle>
          <div className="stack">
            <div className="grid2">
              <Field label="Shift I mulai jam" htmlFor="s1" hint="Shift I berjalan sampai Shift II mulai">
                <input id="s1" className="input mono" type="time" value={cur.shift1_start} onChange={(e) => setF({ ...cur, shift1_start: e.target.value })} />
              </Field>
              <Field label="Shift II mulai jam" htmlFor="s2" hint="Berjalan sampai Shift I besok (lewat tengah malam tetap dihitung tanggal kemarin)">
                <input id="s2" className="input mono" type="time" value={cur.shift2_start} onChange={(e) => setF({ ...cur, shift2_start: e.target.value })} />
              </Field>
              <Field label="Batas perbaikan temuan kode A (jam)" htmlFor="dl" hint="Di form tertulis 1 x 12 jam">
                <input id="dl" className="input mono" type="number" min={1} max={72} value={cur.a_deadline_hours} onChange={(e) => setF({ ...cur, a_deadline_hours: Number(e.target.value) })} />
              </Field>
            </div>
            <label className="check">
              <input type="checkbox" checked={cur.require_signature} onChange={(e) => setF({ ...cur, require_signature: e.target.checked })} />
              <span>Tanda tangan mekanik wajib saat mengirim P2H</span>
            </label>
            {err && (
              <div className="banner banner--stop" role="alert">
                <Icon name="alert" size={18} />
                <div className="grow">{err}</div>
              </div>
            )}
            <div className="row">
              <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={busy || !f}>
                {busy ? 'Menyimpan…' : 'Simpan pengaturan'}
              </button>
              {f && (
                <button type="button" className="btn btn--ghost" onClick={() => setF(null)}>
                  Batalkan perubahan
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="card">
        <SectionTitle hint="Siapa mengubah apa (60 terakhir)">Catatan aktivitas</SectionTitle>
        {audit.isLoading && <Spinner />}
        {audit.data && (
          <div className="tableview__scroll">
            <table className="table table--tight">
              <thead>
                <tr>
                  <th>Waktu</th>
                  <th>Siapa</th>
                  <th>Apa</th>
                  <th>Objek</th>
                </tr>
              </thead>
              <tbody>
                {audit.data.items.map((a) => (
                  <tr key={a.id}>
                    <td className="small nowrap">{dateTime(a.created_at)}</td>
                    <td>{a.user_name ?? '—'}</td>
                    <td className="mono small">{a.action}</td>
                    <td className="small muted">
                      {a.entity} {a.entity_id}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
