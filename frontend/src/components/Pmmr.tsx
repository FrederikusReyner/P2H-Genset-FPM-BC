import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './Icon';
import { SectionTitle } from './ui';
import { downloadFile } from '../lib/api';
import { CAN_SIGN, useAuth } from '../lib/auth';
import { todayWita } from '../lib/format';
import { useToast } from '../lib/toast';

/* =====================================================================
   Bagian bersama untuk rekap PMMR: pilih bulan dan unduh Excel
   ===================================================================== */

export const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

export type YM = { year: number; month: number };

export function thisMonth(): YM {
  const [y, m] = todayWita().split('-').map(Number);
  return { year: y, month: m };
}

const index = (v: YM) => v.year * 12 + (v.month - 1);
const shift = (v: YM, d: 1 | -1): YM => {
  const i = index(v) + d;
  return { year: Math.floor(i / 12), month: (i % 12) + 1 };
};

/** Pilih bulan dengan tombol panah (tidak bisa melewati bulan ini). */
export function MonthStep({ value, onChange }: { value: YM; onChange: (v: YM) => void }) {
  const atNow = index(value) >= index(thisMonth());
  return (
    <div className="pstep">
      <button type="button" className="iconbtn iconbtn--frame" onClick={() => onChange(shift(value, -1))} aria-label="Bulan sebelumnya">
        <Icon name="chevL" />
      </button>
      <div className="pstep__label" aria-live="polite">
        {MONTHS[value.month - 1]} {value.year}
      </div>
      <button type="button" className="iconbtn iconbtn--frame" onClick={() => onChange(shift(value, 1))} disabled={atNow} aria-label="Bulan berikutnya">
        <Icon name="chevR" />
      </button>
    </div>
  );
}

/** Tombol unduh Excel PMMR untuk bulan yang dipilih. */
export function PmmrButton({ value, className = 'btn btn--dark' }: { value: YM; className?: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await downloadFile({ kind: 'pmmr', format: 'xlsx', filters: { year: value.year, month: value.month } });
    } catch (e) {
      toast.push({ title: 'Gagal menyiapkan unduhan', body: e instanceof Error ? e.message : undefined, tone: 'danger' });
    } finally {
      window.setTimeout(() => setBusy(false), 1500);
    }
  };
  return (
    <button type="button" className={className} onClick={() => void go()} disabled={busy}>
      <Icon name="download" size={18} /> {busy ? 'Menyiapkan…' : 'Unduh Excel PMMR'}
    </button>
  );
}

/** Kartu di halaman Rekap: unduh rekap PMMR per bulan. */
export function PmmrCard() {
  const { user } = useAuth();
  const [ym, setYm] = useState<YM>(thisMonth);
  const canSign = !!user && CAN_SIGN.includes(user.role);
  return (
    <section className="card pmmrcard" aria-label="Rekap PMMR">
      <SectionTitle hint="Excel lengkap seperti file PMMR DATA GENSET ALL SITE: status genset, data unit, PH, dan hour meter.">Rekap PMMR (Excel)</SectionTitle>
      <MonthStep value={ym} onChange={setYm} />
      <div className="row row--wrap">
        <PmmrButton value={ym} />
        {canSign && (
          <Link to="/bulanan" className="btn btn--ghost">
            <Icon name="pen" size={16} /> Isi kWh bulanan
          </Link>
        )}
      </div>
    </section>
  );
}
