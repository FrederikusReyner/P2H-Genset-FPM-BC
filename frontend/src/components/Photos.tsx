import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { photoBlobUrl } from '../lib/photos';

/** Satu gambar: data URL (foto baru di HP) atau nomor foto di server. */
export type PhotoSrc = string | number;

export function PhotoImg({ src, alt, className }: { src: PhotoSrc; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(typeof src === 'string' ? src : null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    if (typeof src === 'string') {
      setUrl(src);
      return undefined;
    }
    setUrl(null);
    photoBlobUrl(src)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [src]);
  if (failed) return <span className={`pimg pimg--fail ${className ?? ''}`}>foto tidak bisa dimuat</span>;
  if (!url) return <span className={`pimg pimg--wait ${className ?? ''}`} aria-label="Memuat foto" />;
  return <img src={url} alt={alt} className={`pimg ${className ?? ''}`} loading="lazy" draggable={false} />;
}

/** Deretan foto kecil yang bisa dibuka besar (dipakai di detail P2H dan halaman Temuan). */
export function PhotoStrip({ items, label }: { items: PhotoSrc[]; label: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!items.length) return null;
  return (
    <>
      <ul className="pstrip" aria-label={`Foto ${label}`}>
        {items.map((s, i) => (
          <li key={typeof s === 'string' ? `n${i}` : s}>
            <button type="button" className="pthumb" onClick={() => setOpen(i)} aria-label={`Buka foto ${i + 1} dari ${items.length}: ${label}`}>
              <PhotoImg src={s} alt={`Foto ${i + 1}: ${label}`} />
            </button>
          </li>
        ))}
      </ul>
      {open !== null && <PhotoViewer items={items} start={open} label={label} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Foto layar penuh dengan tombol geser. */
export function PhotoViewer({ items, start, label, onClose }: { items: PhotoSrc[]; start: number; label: string; onClose: () => void }) {
  const [i, setI] = useState(start);
  const ref = useRef<HTMLDivElement>(null);
  const prev = () => setI((v) => (v - 1 + items.length) % items.length);
  const next = () => setI((v) => (v + 1) % items.length);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={`Foto: ${label}`} ref={ref} tabIndex={-1} onClick={onClose}>
      <button type="button" className="viewer__close iconbtn iconbtn--frame" onClick={onClose} aria-label="Tutup foto">
        <Icon name="x" />
      </button>
      <div className="viewer__stage" onClick={(e) => e.stopPropagation()}>
        <PhotoImg src={items[i]} alt={`Foto ${i + 1}: ${label}`} className="viewer__img" />
      </div>
      <div className="viewer__bar" onClick={(e) => e.stopPropagation()}>
        {items.length > 1 && (
          <button type="button" className="iconbtn iconbtn--frame" onClick={prev} aria-label="Foto sebelumnya">
            <Icon name="chevL" />
          </button>
        )}
        <span className="viewer__cap">
          {label} · {i + 1} / {items.length}
        </span>
        {items.length > 1 && (
          <button type="button" className="iconbtn iconbtn--frame" onClick={next} aria-label="Foto berikutnya">
            <Icon name="chevR" />
          </button>
        )}
      </div>
    </div>
  );
}

/** Kotak ambil foto di form P2H: kamera / galeri, hapus, dan penanda "wajib". */
export function PhotoPicker({
  photos,
  kept,
  max,
  busy,
  invalid,
  onAdd,
  onRemoveNew,
  onRemoveKept,
  label,
}: {
  photos: string[];
  kept: number[];
  max: number;
  busy: boolean;
  invalid: boolean;
  onAdd: (files: File[]) => void;
  onRemoveNew: (index: number) => void;
  onRemoveKept: (id: number) => void;
  label: string;
}) {
  const cam = useRef<HTMLInputElement>(null);
  const gal = useRef<HTMLInputElement>(null);
  const total = photos.length + kept.length;
  const [open, setOpen] = useState<number | null>(null);
  const all: PhotoSrc[] = [...kept, ...photos];
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length) onAdd(files);
  };
  return (
    <div className={`pphotos ${invalid ? 'is-invalid' : ''}`}>
      <div className="pphotos__head">
        <span className="pphotos__title">
          <Icon name="camera" size={16} /> Foto temuan <b className="stop-text">(wajib)</b>
        </span>
        <span className="small muted">
          {total}/{max}
        </span>
      </div>
      <div className="pphotos__row">
        {all.map((s, i) => (
          <div key={typeof s === 'string' ? `n${i}` : `k${s}`} className="pthumb pthumb--edit">
            <button type="button" className="pthumb__open" onClick={() => setOpen(i)} aria-label={`Lihat foto ${i + 1}`}>
              <PhotoImg src={s} alt={`Foto ${i + 1}`} />
            </button>
            <button
              type="button"
              className="pthumb__x"
              onClick={() => (typeof s === 'string' ? onRemoveNew(photos.indexOf(s)) : onRemoveKept(s))}
              aria-label={`Hapus foto ${i + 1}`}
            >
              <Icon name="x" size={14} stroke={3} />
            </button>
          </div>
        ))}
        {total < max && (
          <>
            <button type="button" className="padd" onClick={() => cam.current?.click()} disabled={busy}>
              <Icon name="camera" size={22} />
              <span>{busy ? 'Memproses…' : 'Kamera'}</span>
            </button>
            <button type="button" className="padd padd--alt" onClick={() => gal.current?.click()} disabled={busy}>
              <Icon name="image" size={22} />
              <span>Galeri</span>
            </button>
          </>
        )}
      </div>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={pick} aria-label={`Ambil foto kamera: ${label}`} />
      <input ref={gal} type="file" accept="image/*" multiple hidden onChange={pick} aria-label={`Pilih foto dari galeri: ${label}`} />
      {invalid && <div className="field__error">Lampirkan minimal 1 foto kerusakan supaya bisa dikirim.</div>}
      {open !== null && <PhotoViewer items={all} start={open} label={label} onClose={() => setOpen(null)} />}
    </div>
  );
}
