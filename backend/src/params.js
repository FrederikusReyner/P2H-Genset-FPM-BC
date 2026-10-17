// Parameter Panel Genset (6 baris di form): diisi saat Kosongan (tanpa beban) dan Berbeban.
export const PARAMS = [
  { key: 'temp', label: 'Temperature Radiator', unit: '°C', min: 0, max: 200 },
  { key: 'oil', label: 'Oil Pressure', unit: 'psi', min: 0, max: 300 },
  { key: 'rpm', label: 'RPM Generator', unit: 'rpm', min: 0, max: 4000 },
  { key: 'load', label: 'Load', unit: 'kW', min: 0, max: 5000 },
  { key: 'volt', label: 'Voltage L-L', unit: 'VAC', min: 0, max: 20000 },
  { key: 'batt', label: 'Voltage Battery', unit: 'VDC', min: 0, max: 60 },
];

export const PARAM_KEYS = PARAMS.map((p) => p.key);

/** Rapikan isi params dari HP: hanya kunci yang dikenal, hanya angka dalam batas wajar. */
export function cleanParams(input) {
  const out = {};
  for (const p of PARAMS) {
    const raw = input?.[p.key];
    if (!raw || typeof raw !== 'object') continue;
    const row = {};
    for (const mode of ['idle', 'load']) {
      const v = raw[mode];
      if (v === null || v === undefined || v === '') continue;
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
      if (!Number.isFinite(n)) throw new RangeError(`${p.label}: angka tidak valid`);
      if (n < p.min || n > p.max) throw new RangeError(`${p.label}: ${n} ${p.unit} di luar batas wajar (${p.min}–${p.max})`);
      row[mode] = n;
    }
    if (Object.keys(row).length) out[p.key] = row;
  }
  return out;
}
