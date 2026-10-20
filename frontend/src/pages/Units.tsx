import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '../components/Icon';
import { Confirm, Empty, ErrorBox, Field, PageHead, ResultChip, Sheet, Spinner } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { CAN_FILL, useAuth } from '../lib/auth';
import { UNIT_STATUS_LABEL, locationOf, mediumDate, modelOf, num, numGroup, parseNum, shiftLabel, unitTitle } from '../lib/format';
import { useMeta, useUnits } from '../lib/hooks';
import { useToast } from '../lib/toast';
import type { Unit, UnitStatus } from '../lib/types';

/** Isian data lengkap ala PMMR: dipakai di lembar lihat dan lembar ubah. */
type Def = { k: keyof Unit; label: string; num?: boolean; date?: boolean; wide?: boolean };
const ENGINE_DEFS: Def[] = [
  { k: 'made_in', label: 'Dibuat di (negara)' },
  { k: 'weight_kg', label: 'Berat (kg)', num: true },
  { k: 'engine_serial_no', label: 'Nomor seri mesin' },
  { k: 'engine_hp', label: 'Daya mesin (HP)', num: true },
  { k: 'engine_rpm', label: 'Putaran mesin (rpm)', num: true },
];
const ALT_DEFS: Def[] = [
  { k: 'alt_brand', label: 'Merek alternator' },
  { k: 'alt_made_in', label: 'Dibuat di (negara)' },
  { k: 'alt_type', label: 'Tipe (frame core)' },
  { k: 'alt_serial_no', label: 'Nomor seri alternator' },
  { k: 'alt_phase', label: 'Fasa', num: true },
  { k: 'alt_freq', label: 'Frekuensi (Hz)', num: true },
  { k: 'alt_base_kva', label: 'Base rate (kVA)', num: true },
  { k: 'alt_base_kw', label: 'Base rate (kW)', num: true },
  { k: 'alt_voltage', label: 'Tegangan (VAC)', num: true },
  { k: 'alt_ampere', label: 'Arus base rate (A)', num: true },
  { k: 'alt_cos_phi', label: 'Cos φ', num: true },
  { k: 'alt_rpm', label: 'Putaran alternator (rpm)', num: true },
  { k: 'alt_avr', label: 'Tipe AVR' },
];
const BUY_DEFS: Def[] = [
  { k: 'purchase_year', label: 'Tahun pembelian' },
  { k: 'po_number', label: 'Nomor PO' },
  { k: 'recommendation', label: 'Rekomendasi', wide: true },
  { k: 'remark', label: 'Keterangan (remark)', wide: true },
];
const GOH_DEFS: Def[] = [
  { k: 'goh_total', label: 'Jumlah overhaul (GOH)' },
  { k: 'goh_po_pi', label: 'PO / PI overhaul' },
];
const SKO_DEFS: Def[] = [
  { k: 'issue', label: 'Isu SKO / SLO', wide: true },
  { k: 'sko_expiry', label: 'SKO berlaku sampai', date: true },
  { k: 'sko_note', label: 'Catatan SKO' },
];
const GROUP_DEFS: Def[] = [
  { k: 'pmmr_status', label: 'Keterangan status di PMMR' },
  { k: 'bib_location', label: 'Lokasi di daftar BIB' },
];
const ALL_DEFS: Def[] = [...ENGINE_DEFS, ...ALT_DEFS, ...BUY_DEFS, ...GOH_DEFS, ...SKO_DEFS, ...GROUP_DEFS];
const GOH_ROWS = 3;

const show = (u: Unit, d: Def): string => {
  const v = u[d.k];
  if (v === null || v === undefined || v === '') return '';
  if (d.num && typeof v === 'number') return num(v);
  if (d.date && typeof v === 'string') return mediumDate(v);
  return String(v);
};

export default function UnitsPage() {
  const { user } = useAuth();
  const meta = useMeta();
  const q = useUnits();
  const [site, setSite] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'' | UnitStatus>('');
  const [view, setView] = useState<Unit | null>(null);
  const [edit, setEdit] = useState<Unit | 'new' | null>(null);
  const [archive, setArchive] = useState(false);
  const isAdmin = user?.role === 'admin';
  const canFill = !!user && CAN_FILL.includes(user.role);

  const archiveCount = useMemo(() => (q.data?.items ?? []).filter((u) => u.pmmr_group === 'arsip').length, [q.data]);
  const list = useMemo(() => {
    const k = text.trim().toLowerCase();
    return (q.data?.items ?? []).filter(
      (u) =>
        (archive || u.pmmr_group !== 'arsip') &&
        (!site || u.site_id === site) &&
        (!status || u.status === status) &&
        (!k || `${u.code} ${u.old_code ?? ''} ${u.brand ?? ''} ${u.model ?? ''} ${u.location ?? ''} ${u.serial_no ?? ''}`.toLowerCase().includes(k)),
    );
  }, [q.data, site, status, text, archive]);

  return (
    <div className="page">
      <PageHead eyebrow="Data induk" title="Unit genset">
        {isAdmin && (
          <button type="button" className="btn btn--primary" onClick={() => setEdit('new')}>
            <Icon name="plus" size={18} /> Tambah unit
          </button>
        )}
      </PageHead>

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
      <div className="row row--wrap filters__row">
        <label className="searchbox grow">
          <Icon name="search" size={18} />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Cari kode, merek, model, lokasi, nomor seri…" aria-label="Cari unit" />
        </label>
        <select className="input input--auto" value={status} onChange={(e) => setStatus(e.target.value as '' | UnitStatus)} aria-label="Status unit">
          <option value="">Semua status</option>
          <option value="running">Jalan</option>
          <option value="standby">Standby</option>
          <option value="breakdown">Breakdown</option>
          <option value="inactive">Tidak aktif</option>
        </select>
        {isAdmin && archiveCount > 0 && (
          <label className="check" title="Genset yang hanya ada di rekap Excel PMMR (Breakdown, GOH, BIB), tidak ikut P2H">
            <input type="checkbox" checked={archive} onChange={(e) => setArchive(e.target.checked)} /> Tampilkan arsip PMMR ({archiveCount})
          </label>
        )}
      </div>

      {q.isLoading && <Spinner />}
      {q.error && !q.data && <ErrorBox error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && list.length === 0 && <Empty icon="bolt" title="Tidak ada unit" hint="Coba ubah penyaring." />}

      <div className="card tablecard hide-on-phone">
        <table className="table table--hover">
          <thead>
            <tr>
              <th>Kode unit</th>
              <th>Merek / model</th>
              <th className="num">kVA</th>
              <th>Site · lokasi</th>
              <th>Status</th>
              <th className="num">HM terakhir</th>
              <th>P2H terakhir</th>
              <th>Temuan</th>
            </tr>
          </thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id} onClick={() => setView(u)} className="is-click" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setView(u)}>
                <td>
                  <span className="mono">{u.code}</span> {u.pmmr_group === 'arsip' && <span className="chip chip--unit-inactive">Arsip</span>}
                  {u.old_code && <div className="small muted">lama: {u.old_code}</div>}
                </td>
                <td>{modelOf(u) || '—'}</td>
                <td className="num">{numGroup(u.capacity_kva)}</td>
                <td>
                  {u.site_name}
                  <div className="small muted">{locationOf(u)}</div>
                </td>
                <td>
                  <span className={`chip chip--unit-${u.status}`}>{UNIT_STATUS_LABEL[u.status]}</span>
                </td>
                <td className="num mono">{num(u.last_hm) || '—'}</td>
                <td>
                  {u.last_shift_date ? (
                    <span className="small">
                      {mediumDate(u.last_shift_date)} · Shift {shiftLabel(u.last_shift)}
                    </span>
                  ) : (
                    <span className="small muted">belum pernah</span>
                  )}
                </td>
                <td>
                  {u.open_aa > 0 && <span className="chip chip--stop">{u.open_aa} AA</span>} {u.open_a > 0 && <span className="chip chip--warn">{u.open_a} A</span>}
                  {!u.open_aa && !u.open_a && <span className="small muted">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="cards only-phone">
        {list.map((u) => (
          <li key={u.id}>
            <button type="button" className="hcard" onClick={() => setView(u)}>
              <div className="hcard__top">
                <span className="mono hcard__code">{unitTitle(u)}</span>
                <span className={`chip chip--unit-${u.status}`}>{u.pmmr_group === 'arsip' ? 'Arsip' : UNIT_STATUS_LABEL[u.status]}</span>
              </div>
              <div className="small">
                {modelOf(u) || '—'} · {u.site_name}
                {locationOf(u) ? ` · ${locationOf(u)}` : ''}
              </div>
              <div className="small muted">
                HM {num(u.last_hm) || '—'}
                {u.last_shift_date ? ` · P2H terakhir ${mediumDate(u.last_shift_date)}` : ' · belum pernah P2H'}
                {u.open_aa + u.open_a > 0 ? ` · temuan ${u.open_aa ? u.open_aa + ' AA ' : ''}${u.open_a ? u.open_a + ' A' : ''}` : ''}
              </div>
            </button>
          </li>
        ))}
      </ul>

      <UnitView unit={view} onClose={() => setView(null)} onEdit={isAdmin ? (u) => { setView(null); setEdit(u); } : undefined} canFill={canFill} />
      <UnitEdit target={edit} sites={meta.data?.sites ?? []} onClose={() => setEdit(null)} />
    </div>
  );
}

/** Data lengkap (mesin, alternator, pembelian, overhaul, SKO): hanya bagian yang ada isinya. */
function UnitMore({ unit }: { unit: Unit }) {
  const block = (title: string, defs: Def[]) => {
    const rows = defs.map((d) => ({ d, v: show(unit, d) })).filter((r) => r.v);
    if (!rows.length) return null;
    return (
      <>
        <h4 className="fold__title">{title}</h4>
        <dl className="dl">
          {rows.map(({ d, v }) => (
            <div key={d.k} className={d.wide ? 'dl__wide' : undefined}><dt>{d.label}</dt><dd>{v}</dd></div>
          ))}
        </dl>
      </>
    );
  };
  const goh = (unit.goh_history ?? []).filter((g) => g.year || g.location || g.hm != null);
  const archived = unit.pmmr_group === 'arsip';
  return (
    <details className="fold">
      <summary>Data lengkap (spesifikasi, pembelian, overhaul, SKO)</summary>
      <div className="fold__body">
        {archived && (
          <div className="banner banner--info" role="note">
            <Icon name="info" size={18} />
            <div className="grow">Genset ini hanya tercatat di rekap Excel PMMR. Tidak ikut P2H dan tidak tampil di dashboard.</div>
          </div>
        )}
        {block('Genset dan mesin', ENGINE_DEFS)}
        {block('Alternator / generator', ALT_DEFS)}
        {block('Pembelian dan rekomendasi', BUY_DEFS)}
        {(show(unit, GOH_DEFS[0]) || show(unit, GOH_DEFS[1]) || goh.length > 0) && (
          <>
            {block('Overhaul (GOH)', GOH_DEFS)}
            {goh.length > 0 && (
              <ul className="small">
                {goh.map((g, i) => (
                  <li key={i}>
                    {[g.year, g.location].filter(Boolean).join(' · ') || 'Overhaul'}
                    {g.hm != null ? ` · HM ${num(g.hm)}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {block('SKO / SLO', SKO_DEFS)}
        {block('Catatan PMMR', GROUP_DEFS)}
        {!ALL_DEFS.some((d) => show(unit, d)) && goh.length === 0 && <p className="muted small">Belum ada data lengkap. Admin bisa mengisinya lewat tombol Ubah data unit.</p>}
      </div>
    </details>
  );
}

function UnitView({ unit, onClose, onEdit, canFill }: { unit: Unit | null; onClose: () => void; onEdit?: (u: Unit) => void; canFill: boolean }) {
  return (
    <Sheet
      open={!!unit}
      onClose={onClose}
      title={unit ? unit.code : ''}
      wide
      footer={
        unit && (
          <>
            {onEdit && (
              <button type="button" className="btn btn--ghost" onClick={() => onEdit(unit)}>
                <Icon name="pencil" size={16} /> Ubah data unit
              </button>
            )}
            <Link to={`/p2h?unit=${unit.id}`} className="btn btn--ghost" onClick={onClose}>
              Riwayat P2H
            </Link>
            {canFill && unit.status !== 'inactive' && unit.pmmr_group !== 'arsip' && (
              <Link to={`/p2h/baru?unit=${unit.id}`} className="btn btn--primary" onClick={onClose}>
                <Icon name="plus" size={16} /> Isi P2H
              </Link>
            )}
          </>
        )
      }
    >
      {unit && (
        <dl className="dl">
          <div><dt>Kode lama</dt><dd className="mono">{unit.old_code || '—'}</dd></div>
          <div><dt>Site · lokasi</dt><dd>{unit.site_name}{locationOf(unit) ? ` · ${locationOf(unit)}` : ''}</dd></div>
          <div><dt>Job site</dt><dd>{unit.job_site || unit.site_job_site || '—'}</dd></div>
          <div><dt>Merek / model</dt><dd>{modelOf(unit) || '—'}</dd></div>
          <div><dt>Nomor seri</dt><dd className="mono">{unit.serial_no || '—'}</dd></div>
          <div><dt>Mesin</dt><dd>{unit.engine_model || '—'}</dd></div>
          <div><dt>Kapasitas</dt><dd>{unit.capacity_kva ? `${numGroup(unit.capacity_kva)} kVA` : '—'}{unit.rated_kw ? ` · ${numGroup(unit.rated_kw)} kW` : ''}</dd></div>
          <div><dt>Tegangan · putaran</dt><dd>{unit.rated_voltage ? `${num(unit.rated_voltage)} V` : '—'}{unit.rated_rpm ? ` · ${num(unit.rated_rpm)} rpm` : ''}</dd></div>
          <div><dt>Status</dt><dd><span className={`chip chip--unit-${unit.status}`}>{UNIT_STATUS_LABEL[unit.status]}</span></dd></div>
          <div><dt>HM terakhir</dt><dd className="mono">{num(unit.last_hm) || '—'}</dd></div>
          <div>
            <dt>P2H terakhir</dt>
            <dd>
              {unit.last_form_id && unit.last_result ? (
                <Link to={`/p2h/${unit.last_form_id}`} onClick={onClose} className="row">
                  {mediumDate(unit.last_shift_date!)} · Shift {shiftLabel(unit.last_shift)} <ResultChip result={unit.last_result} compact />
                </Link>
              ) : (
                'belum pernah'
              )}
            </dd>
          </div>
          <div><dt>Temuan terbuka</dt><dd>{unit.open_aa || unit.open_a ? `${unit.open_aa} AA · ${unit.open_a} A` : 'tidak ada'}</dd></div>
          {unit.notes && <div className="dl__wide"><dt>Catatan</dt><dd>{unit.notes}</dd></div>}
        </dl>
      )}
      {unit && <UnitMore unit={unit} />}
    </Sheet>
  );
}

type Extra = { x: Record<string, string>; goh: { year: string; location: string; hm: string }[]; group: 'produksi' | 'arsip' };
const blankExtra = (): Extra => ({
  x: Object.fromEntries(ALL_DEFS.map((d) => [d.k, ''])),
  goh: Array.from({ length: GOH_ROWS }, () => ({ year: '', location: '', hm: '' })),
  group: 'produksi',
});
const extraOf = (u: Unit): Extra => {
  const e = blankExtra();
  for (const d of ALL_DEFS) {
    const v = u[d.k];
    e.x[d.k] = v === null || v === undefined ? '' : d.num && typeof v === 'number' ? num(v) : String(v);
  }
  (u.goh_history ?? []).slice(0, GOH_ROWS).forEach((g, i) => {
    e.goh[i] = { year: g.year ?? '', location: g.location ?? '', hm: g.hm != null ? num(g.hm) : '' };
  });
  e.group = u.pmmr_group === 'arsip' ? 'arsip' : 'produksi';
  return e;
};

const EMPTY = {
  code: '', old_code: '', site_id: '' as string | number, location: '', job_site: '', brand: '', model: '', serial_no: '', engine_model: '',
  capacity_kva: '', rated_kw: '', rated_voltage: '', rated_rpm: '', status: 'running' as UnitStatus, hm_master: '', notes: '',
};

function DefFields({ defs, x, set }: { defs: Def[]; x: Record<string, string>; set: (k: string, v: string) => void }) {
  return (
    <div className="grid2">
      {defs.map((d) => (
        <Field key={d.k} label={d.label} htmlFor={`u-${d.k}`} className={d.wide ? 'field--wide' : ''}>
          <input
            id={`u-${d.k}`}
            className={`input ${d.num ? 'mono' : ''}`}
            type={d.date ? 'date' : 'text'}
            inputMode={d.num ? 'decimal' : undefined}
            value={x[d.k] ?? ''}
            onChange={(e) => set(d.k, e.target.value)}
          />
        </Field>
      ))}
    </div>
  );
}

function UnitEdit({ target, sites, onClose }: { target: Unit | 'new' | null; sites: { id: number; name: string }[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState(EMPTY);
  const [ex, setEx] = useState<Extra>(blankExtra);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [del, setDel] = useState(false);
  const [loadedFor, setLoadedFor] = useState<unknown>(null);

  // isi form setiap kali target berganti
  if (target !== loadedFor) {
    setLoadedFor(target);
    setErr(null);
    if (target === 'new') {
      setF({ ...EMPTY, site_id: sites[0]?.id ?? '' });
      setEx(blankExtra());
    } else if (target) {
      setEx(extraOf(target));
      setF({
        code: target.code, old_code: target.old_code ?? '', site_id: target.site_id, location: target.location ?? '', job_site: target.job_site ?? '',
        brand: target.brand ?? '', model: target.model ?? '', serial_no: target.serial_no ?? '', engine_model: target.engine_model ?? '',
        capacity_kva: target.capacity_kva != null ? num(target.capacity_kva) : '', rated_kw: target.rated_kw != null ? num(target.rated_kw) : '',
        rated_voltage: target.rated_voltage != null ? num(target.rated_voltage) : '', rated_rpm: target.rated_rpm != null ? num(target.rated_rpm) : '',
        status: target.status, hm_master: target.hm_master != null ? num(target.hm_master) : '', notes: target.notes ?? '',
      });
    }
  }

  const up = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => setF((s) => ({ ...s, [k]: v }));
  const n = (s: string) => parseNum(s);
  const setX = (k: string, v: string) => setEx((e) => ({ ...e, x: { ...e.x, [k]: v } }));
  const setGoh = (i: number, k: 'year' | 'location' | 'hm', v: string) =>
    setEx((e) => ({ ...e, goh: e.goh.map((g, j) => (j === i ? { ...g, [k]: v } : g)) }));

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const body = {
        code: f.code.trim(), old_code: f.old_code.trim() || null, site_id: Number(f.site_id), location: f.location.trim() || null,
        job_site: f.job_site.trim() || null, brand: f.brand.trim() || null, model: f.model.trim() || null, serial_no: f.serial_no.trim() || null,
        engine_model: f.engine_model.trim() || null, capacity_kva: n(f.capacity_kva), rated_kw: n(f.rated_kw), rated_voltage: n(f.rated_voltage),
        rated_rpm: n(f.rated_rpm), status: f.status, hm_master: n(f.hm_master), notes: f.notes.trim() || null,
      };
      for (const k of ['capacity_kva', 'rated_kw', 'rated_voltage', 'rated_rpm', 'hm_master'] as const) {
        if (Number.isNaN(body[k])) throw new Error('Kolom angka harus diisi angka saja.');
      }
      // data lengkap: semua dikirim, supaya isian yang dikosongkan ikut terhapus
      const more: Record<string, unknown> = { pmmr_group: ex.group };
      for (const d of ALL_DEFS) {
        const raw = (ex.x[d.k] ?? '').trim();
        if (d.num) {
          const v = parseNum(raw);
          if (Number.isNaN(v)) throw new Error(`"${d.label}" harus diisi angka saja.`);
          more[d.k] = v;
        } else more[d.k] = raw || null;
      }
      const goh = ex.goh.map((g) => ({ year: g.year.trim() || null, location: g.location.trim() || null, hm: parseNum(g.hm) }));
      if (goh.some((g) => Number.isNaN(g.hm))) throw new Error('HM overhaul harus diisi angka saja.');
      more.goh_history = goh.filter((g) => g.year || g.location || g.hm != null);
      const full = { ...body, ...more };
      if (target === 'new') await api.post('/api/units', full);
      else await api.put(`/api/units/${(target as Unit).id}`, full);
      await Promise.all([qc.invalidateQueries({ queryKey: ['units'] }), qc.invalidateQueries({ queryKey: ['dashboard'] })]);
      toast.push({ title: target === 'new' ? 'Unit ditambahkan' : 'Data unit disimpan', tone: 'ok' });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Gagal menyimpan.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`/api/units/${(target as Unit).id}`);
      await qc.invalidateQueries({ queryKey: ['units'] });
      toast.push({ title: 'Unit dihapus', tone: 'info' });
      setDel(false);
      onClose();
    } catch (e) {
      setDel(false);
      setErr(e instanceof ApiError ? e.message : 'Gagal menghapus.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Sheet
        open={!!target}
        onClose={onClose}
        wide
        title={target === 'new' ? 'Tambah unit genset' : 'Ubah unit genset'}
        footer={
          <>
            {target && target !== 'new' && (
              <button type="button" className="btn btn--ghost btn--danger-text" onClick={() => setDel(true)} disabled={busy}>
                <Icon name="trash" size={16} /> Hapus
              </button>
            )}
            <span className="grow" />
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
              Batal
            </button>
            <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={busy || f.code.trim().length < 2 || !f.site_id}>
              {busy ? 'Menyimpan…' : 'Simpan'}
            </button>
          </>
        }
      >
        <div className="grid2">
          <Field label="Kode unit (kode baru)" htmlFor="u-code"><input id="u-code" className="input mono" value={f.code} onChange={(e) => up('code', e.target.value)} placeholder="BC-GE-P-31" data-autofocus /></Field>
          <Field label="Kode lama (kalau ada)" htmlFor="u-old"><input id="u-old" className="input mono" value={f.old_code} onChange={(e) => up('old_code', e.target.value)} placeholder="GE-30" /></Field>
          <Field label="Site" htmlFor="u-site">
            <select id="u-site" className="input" value={f.site_id} onChange={(e) => up('site_id', e.target.value)}>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Status" htmlFor="u-status">
            <select id="u-status" className="input" value={f.status} onChange={(e) => up('status', e.target.value as UnitStatus)}>
              <option value="running">Jalan (wajib P2H)</option>
              <option value="standby">Standby (wajib P2H)</option>
              <option value="breakdown">Breakdown (tidak dihitung)</option>
              <option value="inactive">Tidak aktif (disembunyikan)</option>
            </select>
          </Field>
          <Field label="Lokasi" htmlFor="u-loc"><input id="u-loc" className="input" value={f.location} onChange={(e) => up('location', e.target.value)} placeholder="mis. PH LMO / SUARAN" /></Field>
          <Field label="Job site (di form)" htmlFor="u-job" hint="Kosong = ikut site"><input id="u-job" className="input" value={f.job_site} onChange={(e) => up('job_site', e.target.value)} placeholder="mis. BMO 1" /></Field>
          <Field label="Merek" htmlFor="u-brand"><input id="u-brand" className="input" value={f.brand} onChange={(e) => up('brand', e.target.value)} placeholder="Komatsu" /></Field>
          <Field label="Model" htmlFor="u-model"><input id="u-model" className="input" value={f.model} onChange={(e) => up('model', e.target.value)} placeholder="EGS1200-6" /></Field>
          <Field label="Nomor seri" htmlFor="u-sn"><input id="u-sn" className="input mono" value={f.serial_no} onChange={(e) => up('serial_no', e.target.value)} /></Field>
          <Field label="Model mesin" htmlFor="u-eng"><input id="u-eng" className="input" value={f.engine_model} onChange={(e) => up('engine_model', e.target.value)} /></Field>
          <Field label="Kapasitas (kVA)" htmlFor="u-kva"><input id="u-kva" className="input mono" inputMode="decimal" value={f.capacity_kva} onChange={(e) => up('capacity_kva', e.target.value)} /></Field>
          <Field label="Daya (kW)" htmlFor="u-kw"><input id="u-kw" className="input mono" inputMode="decimal" value={f.rated_kw} onChange={(e) => up('rated_kw', e.target.value)} /></Field>
          <Field label="Tegangan (VAC)" htmlFor="u-v"><input id="u-v" className="input mono" inputMode="decimal" value={f.rated_voltage} onChange={(e) => up('rated_voltage', e.target.value)} /></Field>
          <Field label="Putaran (rpm)" htmlFor="u-rpm"><input id="u-rpm" className="input mono" inputMode="decimal" value={f.rated_rpm} onChange={(e) => up('rated_rpm', e.target.value)} /></Field>
          <Field label="HM awal (dari data PMMR)" htmlFor="u-hm"><input id="u-hm" className="input mono" inputMode="decimal" value={f.hm_master} onChange={(e) => up('hm_master', e.target.value)} /></Field>
        </div>
        <Field label="Catatan" htmlFor="u-note"><textarea id="u-note" className="input textarea" rows={2} value={f.notes} onChange={(e) => up('notes', e.target.value)} maxLength={500} /></Field>

        <details className="fold">
          <summary>Data lengkap untuk rekap Excel PMMR (boleh dikosongkan)</summary>
          <div className="fold__body">
            <h4 className="fold__title">Genset dan mesin</h4>
            <DefFields defs={ENGINE_DEFS} x={ex.x} set={setX} />
            <h4 className="fold__title">Alternator / generator</h4>
            <DefFields defs={ALT_DEFS} x={ex.x} set={setX} />
            <h4 className="fold__title">Pembelian dan rekomendasi</h4>
            <DefFields defs={BUY_DEFS} x={ex.x} set={setX} />
            <h4 className="fold__title">Overhaul (GOH)</h4>
            <DefFields defs={GOH_DEFS} x={ex.x} set={setX} />
            {ex.goh.map((g, i) => (
              <div key={i} className="gohrow">
                <Field label={`Overhaul ${i + 1}: tahun / tanggal`} htmlFor={`u-goh-y${i}`}><input id={`u-goh-y${i}`} className="input" value={g.year} onChange={(e) => setGoh(i, 'year', e.target.value)} /></Field>
                <Field label="Dikerjakan di / oleh" htmlFor={`u-goh-l${i}`}><input id={`u-goh-l${i}`} className="input" value={g.location} onChange={(e) => setGoh(i, 'location', e.target.value)} /></Field>
                <Field label="HM saat overhaul" htmlFor={`u-goh-h${i}`}><input id={`u-goh-h${i}`} className="input mono" inputMode="decimal" value={g.hm} onChange={(e) => setGoh(i, 'hm', e.target.value)} /></Field>
              </div>
            ))}
            <h4 className="fold__title">SKO / SLO</h4>
            <DefFields defs={SKO_DEFS} x={ex.x} set={setX} />
            <h4 className="fold__title">Pengelompokan di rekap PMMR</h4>
            <div className="grid2">
              <Field label="Kelompok" htmlFor="u-group" hint="Arsip = hanya muncul di rekap Excel, tidak ikut P2H dan dashboard">
                <select id="u-group" className="input" value={ex.group} onChange={(e) => setEx((v) => ({ ...v, group: e.target.value as 'produksi' | 'arsip' }))}>
                  <option value="produksi">Genset produksi (ikut P2H)</option>
                  <option value="arsip">Arsip PMMR (Breakdown, GOH, BIB)</option>
                </select>
              </Field>
            </div>
            <DefFields defs={GROUP_DEFS} x={ex.x} set={setX} />
          </div>
        </details>
        {err && (
          <div className="banner banner--stop" role="alert">
            <Icon name="alert" size={18} />
            <div className="grow">{err}</div>
          </div>
        )}
      </Sheet>
      <Confirm
        open={del}
        danger
        title="Hapus unit ini?"
        confirmLabel="Hapus"
        busy={busy}
        onClose={() => setDel(false)}
        onConfirm={() => void remove()}
        body="Unit yang sudah punya riwayat P2H tidak bisa dihapus (ubah statusnya menjadi Tidak aktif saja)."
      />
    </>
  );
}
