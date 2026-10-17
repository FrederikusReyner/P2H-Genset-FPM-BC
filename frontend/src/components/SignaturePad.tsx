import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

type Pt = { x: number; y: number }; // 0..1 dari lebar/tinggi kotak, supaya tetap pas saat layar diputar

const OUT_W = 420;
const OUT_H = 150;

interface Props {
  /** dipanggil setiap tanda tangan berubah: gambar PNG (latar transparan) atau null bila kosong */
  onChange: (png: string | null) => void;
  /** isi awal (mis. dari draf) */
  initial?: string | null;
  disabled?: boolean;
}

export function SignaturePad({ onChange, initial, disabled }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Pt[][]>([]);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(!initial);
  const [bg, setBg] = useState<string | null>(initial ?? null); // gambar awal (belum berupa coretan)

  const paint = useCallback(() => {
    const c = canvas.current;
    const w = wrap.current;
    if (!c || !w) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = w.clientWidth;
    const ch = w.clientHeight;
    if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) {
      c.width = Math.round(cw * dpr);
      c.height = Math.round(ch * dpr);
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#10130d';
    ctx.lineWidth = Math.max(2, cw / 150);
    for (const s of strokes.current) {
      if (!s.length) continue;
      ctx.beginPath();
      ctx.moveTo(s[0].x * cw, s[0].y * ch);
      if (s.length === 1) ctx.lineTo(s[0].x * cw + 0.1, s[0].y * ch + 0.1);
      for (let i = 1; i < s.length - 1; i += 1) {
        const mx = ((s[i].x + s[i + 1].x) / 2) * cw;
        const my = ((s[i].y + s[i + 1].y) / 2) * ch;
        ctx.quadraticCurveTo(s[i].x * cw, s[i].y * ch, mx, my);
      }
      if (s.length > 1) ctx.lineTo(s[s.length - 1].x * cw, s[s.length - 1].y * ch);
      ctx.stroke();
    }
  }, []);

  // gambar awal (draf) ditaruh di bawah coretan baru
  useEffect(() => {
    paint();
    const w = wrap.current;
    if (!w) return;
    const ro = new ResizeObserver(() => paint());
    ro.observe(w);
    return () => ro.disconnect();
  }, [paint]);

  const exportPng = useCallback((): string | null => {
    const c = canvas.current;
    if (!c) return null;
    const out = document.createElement('canvas');
    out.width = OUT_W;
    out.height = OUT_H;
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(c, 0, 0, OUT_W, OUT_H);
    return out.toDataURL('image/png');
  }, []);

  const pos = (e: React.PointerEvent): Pt => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  const down = (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drawing.current = true;
    if (bg) setBg(null); // mulai coretan baru: gambar lama diganti
    strokes.current.push([pos(e)]);
    paint();
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    e.preventDefault();
    const s = strokes.current[strokes.current.length - 1];
    const p = pos(e);
    const last = s[s.length - 1];
    if (Math.abs(p.x - last.x) + Math.abs(p.y - last.y) < 0.002) return;
    s.push(p);
    paint();
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const has = strokes.current.some((s) => s.length > 0);
    setEmpty(!has);
    onChange(has ? exportPng() : null);
  };

  const clear = () => {
    strokes.current = [];
    setBg(null);
    setEmpty(true);
    paint();
    onChange(null);
  };

  return (
    <div className="sigpad">
      <div className={`sigpad__area ${disabled ? 'is-disabled' : ''}`} ref={wrap}>
        {bg && <img src={bg} alt="Tanda tangan tersimpan" className="sigpad__bg" draggable={false} />}
        <canvas
          ref={canvas}
          className="sigpad__canvas"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          aria-label="Kotak tanda tangan. Gambar tanda tangan dengan jari."
        />
        {empty && !bg && <div className="sigpad__hint">Tanda tangan di sini dengan jari</div>}
        <div className="sigpad__line" aria-hidden="true" />
      </div>
      <div className="row row--between sigpad__bar">
        <span className="small muted">{empty && !bg ? 'Belum ada tanda tangan' : 'Tanda tangan terisi'}</span>
        <button type="button" className="btn btn--sm btn--ghost" onClick={clear} disabled={disabled || (empty && !bg)}>
          <Icon name="undo" size={16} /> Ulangi
        </button>
      </div>
    </div>
  );
}
