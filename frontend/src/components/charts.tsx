import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { DangerCode, tileInfo } from './ui';
import { dayMonth, dayName, plain, shiftLabel } from '../lib/format';
import type { DashSite, DashUnit, Dashboard, TileState } from '../lib/types';

/* =====================================================================
   Grafik sederhana, digambar dengan SVG / HTML (tanpa pustaka grafik).
   Aturan: batang tipis, garis kisi tipis, nilai ada di tooltip DAN di tabel.
   ===================================================================== */

/** Lebar kotak induk (supaya grafik pas di HP maupun komputer). */
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

/* ---------- tooltip ---------- */

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

/* ---------- bar status bertumpuk (kepala dashboard) ---------- */

const ORDER: TileState[] = ['ok', 'warn', 'stop', 'pending'];

export function StatusBar({ units }: { units: DashUnit[] }) {
  const counts = useMemo(() => {
    const c: Record<TileState, number> = { ok: 0, warn: 0, stop: 0, pending: 0, off: 0 };
    for (const u of units) if (u.required || u.state === 'stop') c[u.state] += 1;
    return c;
  }, [units]);
  const total = ORDER.reduce((n, k) => n + counts[k], 0);
  const [tip, setTip] = useState<Tip | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const showTip = (e: React.PointerEvent | React.FocusEvent, k: TileState) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const t = e.currentTarget.getBoundingClientRect();
    setTip({
      x: t.left - r.left + t.width / 2,
      y: -6,
      node: (
        <>
          <strong>{counts[k]} unit</strong>
          <span>{tileInfo(k).label}</span>
        </>
      ),
    });
  };

  return (
    <div className="statusbar" ref={box} onPointerLeave={() => setTip(null)}>
      <div
        className="statusbar__track"
        role="img"
        aria-label={`Status unit: ${ORDER.map((k) => `${counts[k]} ${tileInfo(k).label}`).join(', ')}`}
      >
        {total === 0 && <div className="statusbar__seg statusbar__seg--empty" style={{ flex: 1 }} />}
        {ORDER.filter((k) => counts[k] > 0).map((k) => (
          <div
            key={k}
            className={`statusbar__seg statusbar__seg--${k}`}
            style={{ flex: counts[k] }}
            tabIndex={0}
            onPointerMove={(e) => showTip(e, k)}
            onFocus={(e) => showTip(e, k)}
            onBlur={() => setTip(null)}
          />
        ))}
      </div>
      <ul className="legend">
        {ORDER.map((k) => (
          <li key={k} className={`legend__item legend__item--${k}`}>
            <span className={`legend__swatch legend__swatch--${k}`} aria-hidden="true">
              <Icon name={tileInfo(k).icon} size={12} stroke={3} />
            </span>
            <span className="legend__num">{counts[k]}</span>
            <span className="legend__label">{tileInfo(k).label}</span>
          </li>
        ))}
      </ul>
      <TipBox tip={tip} bounds={box.current?.clientWidth ?? 300} />
    </div>
  );
}

/* ---------- tren kepatuhan harian ---------- */

export function TrendChart({
  data,
  selected,
  onPick,
}: {
  data: Dashboard['trend'];
  selected: string;
  onPick?: (date: string) => void;
}) {
  const [wrap, W] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const H = 176;
  const pad = { l: 34, r: 8, t: 14, b: 26 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const n = data.length;
  const slot = innerW / n;
  const bw = Math.min(22, slot * 0.62);
  const y = (v: number) => pad.t + innerH - (innerH * v) / 100;
  const avg = n ? Math.round(data.reduce((s, d) => s + d.pct, 0) / n) : 0;
  const labelEvery = slot < 26 ? 3 : slot < 40 ? 2 : 1;
  const selIdx = data.findIndex((d) => d.date === selected);

  const idxAt = (clientX: number) => {
    const r = wrap.current!.getBoundingClientRect();
    return Math.min(n - 1, Math.max(0, Math.floor((clientX - r.left - pad.l) / slot)));
  };
  const showTip = (i: number) => {
    const d = data[i];
    setHover(i);
    setTip({
      x: pad.l + slot * i + slot / 2,
      y: y(d.pct) - 6,
      node: (
        <>
          <strong>{d.pct}% sudah P2H</strong>
          <span>
            {dayName(d.date)}, {dayMonth(d.date)}
          </span>
          <span>
            Shift I: {d.s1} · Shift II: {d.s2}
          </span>
          {d.findings > 0 && <span>{d.findings} P2H ada temuan</span>}
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
        aria-label={`Kepatuhan P2H ${n} hari terakhir, rata-rata ${avg} persen`}
        onPointerMove={(e) => showTip(idxAt(e.clientX))}
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
        {data.map((d, i) => {
          const x = pad.l + slot * i + (slot - bw) / 2;
          const h = Math.max(d.pct > 0 ? 3 : 0, y(0) - y(d.pct));
          const isSel = d.date === selected;
          const isHover = hover === i;
          return (
            <g key={d.date}>
              {isHover && <rect x={pad.l + slot * i} y={pad.t} width={slot} height={innerH} className="chart__hoverband" />}
              {h > 0 && (
                <path
                  d={`M${x} ${y(0)} V${y(0) - h + 4} Q${x} ${y(0) - h} ${x + 4} ${y(0) - h} H${x + bw - 4} Q${x + bw} ${y(0) - h} ${x + bw} ${y(0) - h + 4} V${y(0)} Z`}
                  className={`chart__col ${isSel ? 'is-selected' : ''}`}
                />
              )}
              {isSel && d.pct > 0 && (
                <text x={x + bw / 2} y={y(d.pct) - 5} textAnchor="middle" className="chart__value">
                  {d.pct}%
                </text>
              )}
              {isSel || (i % labelEvery === 0 && (selIdx < 0 || Math.abs(i - selIdx) * slot >= 46)) ? (
                <text x={x + bw / 2} y={H - 8} textAnchor="middle" className={`chart__tick ${isSel ? 'is-selected' : ''}`}>
                  {dayMonth(d.date)}
                </text>
              ) : null}
              <rect
                x={pad.l + slot * i}
                y={pad.t}
                width={slot}
                height={innerH + pad.b}
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={`${dayName(d.date)} ${dayMonth(d.date)}: ${d.pct} persen`}
                onFocus={() => showTip(i)}
                onBlur={() => { setTip(null); setHover(null); }}
                onClick={() => onPick?.(d.date)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onPick?.(d.date)}
                style={{ cursor: onPick ? 'pointer' : 'default', outline: 'none' }}
              />
            </g>
          );
        })}
      </svg>
      <TipBox tip={tip} bounds={W} />
      <div className="chart__note small muted">
        Rata-rata {n} hari: <strong className="ink">{avg}%</strong> · {onPick ? 'Tekan batang untuk melihat harinya' : ''}
      </div>
      <details className="tableview">
        <summary>
          <Icon name="table" size={14} /> Lihat sebagai tabel
        </summary>
        <div className="tableview__scroll">
          <table className="table table--tight">
            <thead>
              <tr>
                <th>Tanggal</th>
                <th className="num">Shift I</th>
                <th className="num">Shift II</th>
                <th className="num">Ada temuan</th>
                <th className="num">Sudah P2H</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((d) => (
                <tr key={d.date}>
                  <td>
                    {dayName(d.date)}, {dayMonth(d.date)}
                  </td>
                  <td className="num">{d.s1}</td>
                  <td className="num">{d.s2}</td>
                  <td className="num">{d.findings}</td>
                  <td className="num">{d.pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/* ---------- temuan terbanyak (batang mendatar) ---------- */

export function TopItems({ items }: { items: Dashboard['top_items'] }) {
  const max = Math.max(1, ...items.map((i) => i.n));
  const [tip, setTip] = useState<Tip | null>(null);
  const box = useRef<HTMLDivElement>(null);
  if (!items.length) return null;

  const show = (e: React.PointerEvent | React.FocusEvent, it: Dashboard['top_items'][number]) => {
    const r = box.current?.getBoundingClientRect();
    const t = e.currentTarget.getBoundingClientRect();
    if (!r) return;
    setTip({
      x: Math.min(r.width - 8, t.left - r.left + t.width * 0.5),
      y: t.top - r.top + t.height / 2,
      node: (
        <>
          <strong>{it.n}× dilaporkan</strong>
          <span>{plain(it.item_text)}</span>
          <span>di {it.units} unit</span>
        </>
      ),
    });
  };

  return (
    <div className="hbars" ref={box} onPointerLeave={() => setTip(null)}>
      <ul className="hbars__list">
        {items.map((it) => (
          <li
            key={it.item_text}
            className="hbars__row"
            tabIndex={0}
            onPointerMove={(e) => show(e, it)}
            onFocus={(e) => show(e, it)}
            onBlur={() => setTip(null)}
          >
            <div className="hbars__label">
              <DangerCode code={it.danger_code} title={false} />
              <span className="hbars__text" title={plain(it.item_text)}>
                {plain(it.item_text)}
              </span>
            </div>
            <div className="hbars__track">
              <div className={`hbars__fill hbars__fill--${it.danger_code}`} style={{ width: `${(it.n / max) * 100}%` }} />
              <span className="hbars__val">{it.n}</span>
            </div>
          </li>
        ))}
      </ul>
      <ul className="legend legend--inline">
        <li className="legend__item">
          <span className="legend__key legend__key--AA" aria-hidden="true" /> AA: STOP OPERASI
        </li>
        <li className="legend__item">
          <span className="legend__key legend__key--A" aria-hidden="true" /> A: perbaiki dalam 12 jam
        </li>
      </ul>
      <TipBox tip={tip} bounds={box.current?.clientWidth ?? 300} />
    </div>
  );
}

/* ---------- temuan per site (AA / A bertumpuk) ---------- */

export function SiteFindings({ sites }: { sites: DashSite[] }) {
  const max = Math.max(1, ...sites.map((s) => s.findings_30d.aa + s.findings_30d.a));
  const [tip, setTip] = useState<Tip | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const show = (e: React.PointerEvent | React.FocusEvent, s: DashSite) => {
    const r = box.current?.getBoundingClientRect();
    const t = e.currentTarget.getBoundingClientRect();
    if (!r) return;
    setTip({
      x: Math.min(r.width - 8, t.left - r.left + t.width * 0.5),
      y: t.top - r.top + t.height / 2,
      node: (
        <>
          <strong>{s.name}</strong>
          <span>AA (STOP): {s.findings_30d.aa}</span>
          <span>A (perbaiki): {s.findings_30d.a}</span>
        </>
      ),
    });
  };

  return (
    <div className="hbars" ref={box} onPointerLeave={() => setTip(null)}>
      <ul className="hbars__list">
        {sites.map((s) => {
          const t = s.findings_30d.aa + s.findings_30d.a;
          return (
            <li key={s.id} className="hbars__row hbars__row--site" tabIndex={0} onPointerMove={(e) => show(e, s)} onFocus={(e) => show(e, s)} onBlur={() => setTip(null)}>
              <div className="hbars__label">
                <span className="hbars__text">{s.name}</span>
              </div>
              <div className="hbars__track hbars__track--stack">
                {s.findings_30d.aa > 0 && <div className="hbars__fill hbars__fill--AA" style={{ width: `${(s.findings_30d.aa / max) * 100}%` }} />}
                {s.findings_30d.a > 0 && <div className="hbars__fill hbars__fill--A" style={{ width: `${(s.findings_30d.a / max) * 100}%` }} />}
                <span className="hbars__val">{t}</span>
              </div>
            </li>
          );
        })}
      </ul>
      <ul className="legend legend--inline">
        <li className="legend__item">
          <span className="legend__key legend__key--AA" aria-hidden="true" /> AA: STOP OPERASI
        </li>
        <li className="legend__item">
          <span className="legend__key legend__key--A" aria-hidden="true" /> A: perbaiki dalam 12 jam
        </li>
      </ul>
      <TipBox tip={tip} bounds={box.current?.clientWidth ?? 300} />
    </div>
  );
}

/* ---------- label shift ---------- */
export const ShiftTag = ({ shift }: { shift: number }) => <span className="shifttag">Shift {shiftLabel(shift)}</span>;
