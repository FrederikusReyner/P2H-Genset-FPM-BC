import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { dayMonth, dayName } from '../lib/format';
import type { BucketKind } from '../lib/types';

/* =====================================================================
   Grafik rekap form digital. Gayanya sama dengan grafik P2H Genset (charts.tsx):
   SVG ringan, garis kisi tipis, nilai di tooltip DAN di tabel.
   ===================================================================== */

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const ROMAN = ['I', 'II', 'III', 'IV'];
export function bucketLabel(start: string, kind: BucketKind): string {
  const [yy, mm] = start.split('-').map(Number);
  if (kind === 'quarter') return `Q${Math.floor((mm - 1) / 3) + 1} ${String(yy).slice(2)}`;
  if (kind === 'half') return `S${mm <= 6 ? 1 : 2} ${String(yy).slice(2)}`;
  if (kind === 'month') {
    const [y, m] = start.split('-').map(Number);
    return `${BULAN[m - 1]} ${String(y).slice(2)}`;
  }
  return dayMonth(start);
}
function bucketLong(start: string, kind: BucketKind): string {
  if (kind === 'day') return `${dayName(start)}, ${dayMonth(start)}`;
  const [yy, mm] = start.split('-').map(Number);
  if (kind === 'quarter') return `Kuartal ${ROMAN[Math.floor((mm - 1) / 3)]} ${yy}`;
  if (kind === 'half') return `Semester ${mm <= 6 ? 1 : 2} ${yy}`;
  if (kind === 'week') return `Minggu mulai ${dayMonth(start)}`;
  if (kind === 'biweek') return `2 minggu mulai ${dayMonth(start)}`;
  const [y, m] = start.split('-').map(Number);
  return `${BULAN[m - 1]} ${y}`;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(320);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(220, Math.floor(el.clientWidth))));
    ro.observe(el);
    setW(Math.max(220, Math.floor(el.clientWidth)));
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

interface Tip {
  x: number;
  y: number;
  node: ReactNode;
}
function TipBox({ tip, bounds }: { tip: Tip | null; bounds: number }) {
  if (!tip) return null;
  const flip = tip.x > bounds * 0.62;
  return (
    <div className="tip" role="tooltip" style={{ left: tip.x, top: tip.y, transform: `translate(${flip ? 'calc(-100% - 10px)' : '10px'}, -50%)` }}>
      {tip.node}
    </div>
  );
}

/** Angka sumbu yang "bulat" (0, 5, 10, ...). */
function niceMax(v: number) {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/* ---------- tren isian: Baik / Ada temuan / STOP bertumpuk ---------- */

export function ResultTrend({ data, kind }: { data: { start: string; ok: number; finding: number; stop: number }[]; kind: BucketKind }) {
  const [wrap, W] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const H = 190;
  const pad = { l: 30, r: 8, t: 12, b: 26 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const n = Math.max(1, data.length);
  const slot = innerW / n;
  const bw = Math.min(24, slot * 0.64);
  const max = niceMax(Math.max(1, ...data.map((d) => d.ok + d.finding + d.stop)));
  const y = (v: number) => pad.t + innerH - (innerH * v) / max;
  const labelEvery = Math.max(1, Math.ceil(46 / slot));
  const total = data.reduce((s, d) => s + d.ok + d.finding + d.stop, 0);

  const show = (i: number) => {
    const d = data[i];
    setHover(i);
    setTip({
      x: pad.l + slot * i + slot / 2,
      y: y(d.ok + d.finding + d.stop) - 6,
      node: (
        <>
          <strong>{d.ok + d.finding + d.stop} isian</strong>
          <span>{bucketLong(d.start, kind)}</span>
          <span>Baik: {d.ok}</span>
          <span>Ada temuan: {d.finding}</span>
          <span>STOP: {d.stop}</span>
        </>
      ),
    });
  };
  const seg = (x: number, from: number, to: number, cls: string) =>
    to > from ? <rect x={x} y={y(to)} width={bw} height={Math.max(1, y(from) - y(to))} className={cls} /> : null;

  return (
    <div className="chart" ref={wrap} onPointerLeave={() => { setTip(null); setHover(null); }}>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Tren isian: ${total} isian`}
        onPointerMove={(e) => {
          const r = wrap.current!.getBoundingClientRect();
          show(Math.min(data.length - 1, Math.max(0, Math.floor((e.clientX - r.left - pad.l) / slot))));
        }}
        style={{ touchAction: 'pan-y' }}
      >
        {[0, max / 2, max].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className={v === 0 ? 'chart__axis' : 'chart__grid'} />
            <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" className="chart__tick">
              {Math.round(v)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad.l + slot * i + (slot - bw) / 2;
          return (
            <g key={d.start}>
              {hover === i && <rect x={pad.l + slot * i} y={pad.t} width={slot} height={innerH} className="chart__hoverband" />}
              {seg(x, 0, d.ok, 'fbar fbar--ok')}
              {seg(x, d.ok, d.ok + d.finding, 'fbar fbar--warn')}
              {seg(x, d.ok + d.finding, d.ok + d.finding + d.stop, 'fbar fbar--stop')}
              {i % labelEvery === 0 && (
                <text x={x + bw / 2} y={H - 8} textAnchor="middle" className="chart__tick">
                  {bucketLabel(d.start, kind)}
                </text>
              )}
              <rect x={pad.l + slot * i} y={pad.t} width={slot} height={innerH + pad.b} fill="transparent" tabIndex={0} onFocus={() => show(i)} onBlur={() => setTip(null)} style={{ outline: 'none' }} />
            </g>
          );
        })}
      </svg>
      <TipBox tip={tip} bounds={W} />
      <ul className="legend legend--inline">
        <li className="legend__item"><span className="fkey fkey--ok" aria-hidden="true" /> Semua baik</li>
        <li className="legend__item"><span className="fkey fkey--warn" aria-hidden="true" /> Ada temuan</li>
        <li className="legend__item"><span className="fkey fkey--stop" aria-hidden="true" /> STOP</li>
      </ul>
      <details className="tableview">
        <summary>
          <Icon name="table" size={14} /> Lihat sebagai tabel
        </summary>
        <div className="tableview__scroll">
          <table className="table table--tight">
            <thead>
              <tr>
                <th>{({ day: 'Tanggal', week: 'Minggu', biweek: '2 minggu', month: 'Bulan', quarter: 'Kuartal', half: 'Semester' } as const)[kind]}</th>
                <th className="num">Baik</th>
                <th className="num">Ada temuan</th>
                <th className="num">STOP</th>
                <th className="num">Jumlah</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((d) => (
                <tr key={d.start}>
                  <td>{bucketLong(d.start, kind)}</td>
                  <td className="num">{d.ok}</td>
                  <td className="num">{d.finding}</td>
                  <td className="num">{d.stop}</td>
                  <td className="num">{d.ok + d.finding + d.stop}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/* ---------- kepatuhan per periode (persen objek yang sudah diperiksa) ---------- */

export function ComplianceChart({ items, kind, unit }: { items: { start: string; done: number; expected: number; pct: number }[]; kind: BucketKind; unit: string }) {
  const [wrap, W] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const H = 170;
  const pad = { l: 34, r: 8, t: 12, b: 26 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const n = Math.max(1, items.length);
  const slot = innerW / n;
  const bw = Math.min(24, slot * 0.64);
  const y = (v: number) => pad.t + innerH - (innerH * v) / 100;
  const labelEvery = Math.max(1, Math.ceil(46 / slot));
  const avg = items.length ? Math.round(items.reduce((s, d) => s + d.pct, 0) / items.length) : 0;
  const show = (i: number) => {
    const d = items[i];
    setHover(i);
    setTip({
      x: pad.l + slot * i + slot / 2,
      y: y(d.pct) - 6,
      node: (
        <>
          <strong>{d.pct}% diperiksa</strong>
          <span>{bucketLong(d.start, kind)}</span>
          <span>
            {d.done} dari {d.expected} {unit}
          </span>
        </>
      ),
    });
  };
  return (
    <div className="chart" ref={wrap} onPointerLeave={() => { setTip(null); setHover(null); }}>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Kepatuhan rata-rata ${avg} persen`}
        onPointerMove={(e) => {
          const r = wrap.current!.getBoundingClientRect();
          show(Math.min(items.length - 1, Math.max(0, Math.floor((e.clientX - r.left - pad.l) / slot))));
        }}
        style={{ touchAction: 'pan-y' }}
      >
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className={v === 0 ? 'chart__axis' : 'chart__grid'} />
            <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" className="chart__tick">
              {v}%
            </text>
          </g>
        ))}
        {items.map((d, i) => {
          const x = pad.l + slot * i + (slot - bw) / 2;
          const h = Math.max(d.pct > 0 ? 2 : 0, y(0) - y(d.pct));
          return (
            <g key={d.start}>
              {hover === i && <rect x={pad.l + slot * i} y={pad.t} width={slot} height={innerH} className="chart__hoverband" />}
              {h > 0 && <rect x={x} y={y(0) - h} width={bw} height={h} className={`fbar ${d.pct >= 100 ? 'fbar--ok' : d.pct >= 50 ? 'fbar--warn' : 'fbar--stop'}`} />}
              {i % labelEvery === 0 && (
                <text x={x + bw / 2} y={H - 8} textAnchor="middle" className="chart__tick">
                  {bucketLabel(d.start, kind)}
                </text>
              )}
              <rect x={pad.l + slot * i} y={pad.t} width={slot} height={innerH + pad.b} fill="transparent" tabIndex={0} onFocus={() => show(i)} onBlur={() => setTip(null)} style={{ outline: 'none' }} />
            </g>
          );
        })}
      </svg>
      <TipBox tip={tip} bounds={W} />
      <div className="chart__note small muted">
        Rata-rata: <strong className="ink">{avg}%</strong> · hijau = semua diperiksa, kuning ≥ 50%, merah &lt; 50%
      </div>
    </div>
  );
}

/* ---------- batang mendatar: STOP + perbaiki ---------- */

export function FindingBars({ rows, empty }: { rows: { key: string | number; label: string; sub?: string; stop: number; fix: number; tip?: string }[]; empty: string }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const max = Math.max(1, ...rows.map((r) => r.stop + r.fix));
  if (!rows.length || rows.every((r) => r.stop + r.fix === 0)) return <div className="small muted">{empty}</div>;
  const show = (e: React.PointerEvent | React.FocusEvent, r: (typeof rows)[number]) => {
    const b = box.current?.getBoundingClientRect();
    const t = e.currentTarget.getBoundingClientRect();
    if (!b) return;
    setTip({
      x: Math.min(b.width - 8, t.left - b.left + t.width * 0.5),
      y: t.top - b.top + t.height / 2,
      node: (
        <>
          <strong>{r.label}</strong>
          {r.tip && <span>{r.tip}</span>}
          <span>STOP: {r.stop}</span>
          <span>Perlu diperbaiki: {r.fix}</span>
        </>
      ),
    });
  };
  return (
    <div className="hbars" ref={box} onPointerLeave={() => setTip(null)}>
      <ul className="hbars__list">
        {rows
          .filter((r) => r.stop + r.fix > 0)
          .map((r) => (
            <li key={r.key} className="hbars__row" tabIndex={0} onPointerMove={(e) => show(e, r)} onFocus={(e) => show(e, r)} onBlur={() => setTip(null)}>
              <div className="hbars__label">
                <span className="hbars__text" title={r.label}>
                  {r.label}
                  {r.sub && <span className="muted small"> · {r.sub}</span>}
                </span>
              </div>
              <div className="hbars__track hbars__track--stack">
                {r.stop > 0 && <div className="hbars__fill hbars__fill--AA" style={{ width: `${(r.stop / max) * 100}%` }} />}
                {r.fix > 0 && <div className="hbars__fill hbars__fill--A" style={{ width: `${(r.fix / max) * 100}%` }} />}
                <span className="hbars__val">{r.stop + r.fix}</span>
              </div>
            </li>
          ))}
      </ul>
      <ul className="legend legend--inline">
        <li className="legend__item">
          <span className="legend__key legend__key--AA" aria-hidden="true" /> STOP
        </li>
        <li className="legend__item">
          <span className="legend__key legend__key--A" aria-hidden="true" /> Perlu diperbaiki
        </li>
      </ul>
      <TipBox tip={tip} bounds={box.current?.clientWidth ?? 300} />
    </div>
  );
}

/* ---------- cincin persen kecil (untuk kartu angka) ---------- */

export function Ring({ pct, tone }: { pct: number; tone: 'ok' | 'warn' | 'stop' }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <svg width="46" height="46" viewBox="0 0 46 46" aria-hidden="true" className="ring">
      <circle cx="23" cy="23" r={r} className="ring__track" />
      <circle cx="23" cy="23" r={r} className={`ring__val ring__val--${tone}`} strokeDasharray={`${(c * Math.max(0, Math.min(100, pct))) / 100} ${c}`} transform="rotate(-90 23 23)" />
    </svg>
  );
}
