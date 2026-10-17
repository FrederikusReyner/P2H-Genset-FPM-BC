// Ikon garis (24 x 24), digambar sendiri: ujung kotak, sudut tegas, supaya serasi dengan tampilan "lembar inspeksi".

const P = {
  home: 'M3 11l9-8 9 8M5 9.5V21h5v-6h4v6h5V9.5',
  plus: 'M12 4v16M4 12h16',
  history: 'M7 4H5v17h14V4h-2M8 3h8v4H8zM8.5 13.5l2.5 2.5 4.5-5',
  alert: 'M12 3.5L21.5 20h-19zM12 10v5M12 17.5v.5',
  stop: 'M8.5 3h7L21 8.5v7L15.5 21h-7L3 15.5v-7zM8 12h8',
  check: 'M4 12.5l5 5L20 6.5',
  x: 'M5 5l14 14M19 5L5 19',
  bell: 'M6 17v-6a6 6 0 0 1 12 0v6l2 2H4zM10 21h4',
  bellOff: 'M6 17v-6c0-1 .2-2 .7-2.8M9 4.5A6 6 0 0 1 18 11v4M4 19h13M10 21h4M3 3l18 18',
  download: 'M12 3v12M7 10.5l5 5 5-5M4 20h16',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-2.5A4.5 4.5 0 0 1 8.5 14h7a4.5 4.5 0 0 1 4.5 4.5V21',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20v-2A4.5 4.5 0 0 1 7 13.5h4a4.5 4.5 0 0 1 4.5 4.5v2M16 4.5a3.5 3.5 0 0 1 0 6.8M18 13.5a4.5 4.5 0 0 1 3.5 4.5v2',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4v6M9 14v6',
  logout: 'M10 4H4v16h6M15 7.5l4.5 4.5L15 16.5M19.5 12H9',
  chevR: 'M9 5l7 7-7 7',
  chevL: 'M15 5l-7 7 7 7',
  chevD: 'M5 9l7 7 7-7',
  chevU: 'M5 15l7-7 7 7',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5L21 21',
  calendar: 'M4 6h16v15H4zM4 10.5h16M8 3v5M16 3v5',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5.5l3.5 2',
  wrench: 'M14.7 6.3a4.2 4.2 0 0 0-5.6 5.3L3 17.7 6.3 21l6.1-6.1a4.2 4.2 0 0 0 5.3-5.6l-2.8 2.8-2.6-.5-.5-2.6z',
  bolt: 'M13 2.5L4.5 14H11l-1 7.5L19.5 10H13z',
  pin: 'M12 21.5s7-6.2 7-11.8A7 7 0 0 0 5 9.7c0 5.6 7 11.8 7 11.8zM12 12.5a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4z',
  refresh: 'M20 11.5A8 8 0 0 0 5.6 7M4.5 4v4h4M4 12.5A8 8 0 0 0 18.4 17M19.5 20v-4h-4',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.2',
  pencil: 'M4 20l1-5L16.5 3.5l4 4L9 19zM14 6l4 4',
  trash: 'M4.5 7h15M9.5 7V4h5v3M6.5 7l1 14h9l1-14M10 11v6M14 11v6',
  eye: 'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12zM12 14.7a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4z',
  eyeOff: 'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12zM12 14.7a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4zM3 3l18 18',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
  sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8',
  pen: 'M3.5 20.5h4L19 9l-4-4L3.5 16.5zM13 7l4 4M12 20.5h8.5',
  share: 'M12 15V3M7.5 7.5L12 3l4.5 4.5M5 12v9h14v-9',
  phone: 'M7 2.5h10v19H7zM11 18.5h2',
  file: 'M6 2.5h8.5L19 7v14.5H6zM14 2.5v5h5M9 12.5h6M9 16h6',
  filter: 'M3.5 5h17l-6.5 8v6l-4 2v-8z',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.5M3.5 12h.5M3.5 18h.5',
  wifiOff: 'M2.5 9a15 15 0 0 1 4-2.4M21.5 9a15 15 0 0 0-9.5-3.5M5.5 12.5a10 10 0 0 1 3-1.8M18.5 12.5a10 10 0 0 0-4-2.3M9 16a5 5 0 0 1 2-1.1M15 16a5 5 0 0 0-1.3-.9M12 19.5v.2M3 3l18 18',
  cloud: 'M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9.5 4 4 0 0 1 17.5 18zM12 11v5M9.5 13.5L12 11l2.5 2.5',
  shield: 'M12 2.5l8 3v6c0 5-3.4 8.7-8 10-4.6-1.3-8-5-8-10v-6z',
  key: 'M14.5 10a4.5 4.5 0 1 0-1.7-3.5M3 21l8-8M8 16l2 2M11 13l2 2',
  copy: 'M8 8h12v13H8zM16 8V3H4v13h4',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  table: 'M3.5 5h17v14h-17zM3.5 10h17M3.5 15h17M9 5v14',
  chart: 'M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3',
  flag: 'M5 21V4M5 4h12l-2 4 2 4H5',
  lock: 'M6 11h12v10H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  send: 'M3 11.5L21 3l-8.5 18-2-7.5zM21 3L10.5 13.5',
  external: 'M14 3h7v7M21 3l-9 9M18 14v7H3V6h7',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  menu: 'M4 6h16M4 12h16M4 18h16',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  camera: 'M3.5 7.5h4l1.5-3h6l1.5 3h4v12h-17zM12 17a3.7 3.7 0 1 0 0-7.4 3.7 3.7 0 0 0 0 7.4z',
  image: 'M3.5 4.5h17v15h-17zM3.5 16.5l5-5 4 4 3-3 5 5M9 9.5v.01',
  verified: 'M12 2.5l8 3v6c0 5-3.4 8.7-8 10-4.6-1.3-8-5-8-10v-6zM8.5 12l2.5 2.5 4.5-5',
} as const;

export type IconName = keyof typeof P;

interface Props {
  name: IconName;
  size?: number;
  className?: string;
  stroke?: number;
  title?: string;
}

export function Icon({ name, size = 20, className, stroke = 2, title }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="square"
      strokeLinejoin="miter"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title && <title>{title}</title>}
      <path d={P[name]} />
    </svg>
  );
}

/** Tiga garis miring ala lambang Berau Coal: hiasan kecil di judul / halaman masuk */
export function Slashes({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round">
        <path d="M4 15.5L13.5 6" />
        <path d="M9 19.5l9.5-9.5" />
        <path d="M14.5 21l6-6" />
      </g>
    </svg>
  );
}
