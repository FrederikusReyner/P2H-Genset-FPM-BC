/*
 * Isi awal form digital, disalin dari form kertas:
 *  - Master ESUA tools Monthly (Inspeksi Peralatan)
 *  - Form pengukuran ampere terbaru 2026 (Pengukuran Arus Motor)
 *  - Form Pengecekan Safety Device (mingguan, per conveyor)
 *  - Form Pengujian Metal Catcher
 *  - 2026 Pengukuran Grounding Penyalur Petir, Form Pemeriksaan Jembatan Timbang,
 *    FORM Pengecekan Trafo (bulanan + butir tahunan)
 *  - Form Checklist Pemeriksaan Oil Trap (Power House), Form Pemeriksaan Panel (MCC),
 *    Form Pemeriksaan Motor Listrik (koneksi terminal)
 * Dimuat sekali saat server pertama kali hidup. Setelah itu admin mengubahnya dari aplikasi (Kelola).
 */

/** butir cek singkat */
const ck = (label, text, o = {}) => ({ label, text, kind: 'check', ...o });
/** butir ukur satu kolom */
const ms = (label, text, unit, o = {}) => ({ label, text, kind: 'measure', unit, fields: [{ key: 'v', label: 'Hasil' }], ...o });

/* ---------- Inspeksi peralatan (tools) bulanan ---------- */
const tool = (name, model, brand, qty, unit) => ({
  text: name,
  spec: [model, brand, qty ? `${qty} ${unit}` : null].filter(Boolean).join(' · '),
});
const TOOLS = {
  Peralatan: [
    tool('Current Clamp', '337', 'FLUKE', 1, 'Unit'),
    tool('Insulation Tester', 'BM 223', 'AVO', 1, 'Pcs'),
    tool('Phase Detector', '8031', 'KYORITSU', 1, 'Unit'),
    tool('Earth Tester', '1605/1700', 'TES', 1, 'Set'),
    tool('Multi Meter TRUE RMS', '28II', 'FLUKE', 1, 'Set'),
    tool('Multi Meter', 'CD-800A', 'SANWA', 1, 'Pcs'),
    tool('Multi Meter', 'Fluke 289', 'FLUKE', 1, 'Pcs'),
    tool('High Voltage Stick 20 KV', 'P002-0081', 'CHANCE', 1, 'Unit'),
    tool('Hydraulics Crimping Tools Set', 'C0-400', 'KRISBOW', 1, 'Set'),
    tool('Torque Wrench for Spanner Heads Drive 9x12 MM', '2035-60 (6-60 Nm)', 'ELORA', 1, 'Pcs'),
    tool('Electric Hand Drill', 'HP 1500', 'MAKITA', 1, 'Unit'),
    tool('Portable Sump Pump', 'KP 150', 'GRUNDFOS', 1, 'Unit'),
    tool('Portable Blower', 'CTF-45 1500 RPM, 700 WATT', 'KRISBOW', 1, 'Unit'),
    tool('Portable Blower', 'CTF-45 1500 RPM, 700 WATT', 'KRISBOW', 1, 'Unit'),
    tool('Portable Blower', 'CTF-45 1500 RPM, 700 WATT', 'KRISBOW', 1, 'Unit'),
    tool('Portable Blower', 'SJ-S45 3000 RPM, 700 WATT', 'KRISBOW', 1, 'Unit'),
    tool('Portable Blower', 'SJ-S45 3000 RPM, 700 WATT', 'KRISBOW', 1, 'Unit'),
    tool('Portable Blower', 'SF-45 3000 RPM, 1700 WATT', 'KRISBOW', 1, 'Unit'),
    tool('Portable Blower', 'SJ-S30 450/550 WATT', 'KRISBOW', 1, 'Unit'),
    tool('Vacum Cleaner', 'GBL 550', 'BOSCH', 1, 'Unit'),
    tool('Charger Accu', '24 VDC', 'DELTA', 1, 'Pcs'),
    tool('Combination Plier', null, 'ELORA', 1, 'Pcs'),
    tool('Combination Plier', null, 'KRISBOW', 1, 'Pcs'),
    tool('Combination Plier', null, 'KRISBOW', 1, 'Pcs'),
    tool('Long Nose Plier', null, 'KRISBOW', 1, 'Pcs'),
    tool('Long Nose Plier', null, 'ELORA', 1, 'Pcs'),
    tool('Grip Plier', null, 'ELORA', 1, 'Pcs'),
    tool('Tang Kupas', null, 'KRISBOW', 1, 'Pcs'),
    tool('Water Pump Plier (Adjustable)', null, 'KRISBOW', 1, 'Pcs'),
    tool('Claw Hammer', null, 'KENZO', 1, 'Pcs'),
    tool('Soft Faced Hammer', null, 'ELORA', 1, 'Pcs'),
    tool('Hacksaw Frame (Gagang Gergaji)', null, 'ELORA', 2, 'Pcs'),
    tool('Connector Set + Crimping', null, 'HELLA', 1, 'Set'),
    tool('Roll Meter 50 M', 'LKC 50 M', 'JASON', 1, 'Pcs'),
    tool('Cutting Cable', 'up to 120 MM2', 'N/B', 1, 'Unit'),
    tool('Bor Plong Set 3/4"', 'K 100/40', 'STARRET', 1, 'Set'),
    tool('Circuit Tester VDC', '8103', 'KINCROME', 1, 'Pcs'),
    tool('HSS Drill Metric Set', 'D101 SM3', 'SUTTON', 1, 'Set'),
    tool('Socket Set Drive 1/2" & 1/4", Combined', '714-6MU', 'ELORA', 1, 'Set'),
    tool('Ring Spanner Head 2062-7 s.d. 19', '2062', 'ELORA', 1, 'Set'),
    tool('Ball End Hexagon Key Set KU-1.5 s.d. 10', '159SKU', 'ELORA', 1, 'Set'),
    tool('Torx Ball End Key Set (L-Bintang) TXKU-9 s.d. 40', '162S-TXKU', 'ELORA', 1, 'Set'),
    tool('Impact Screwdriver Set 5/16"', '3401-S12', 'ELORA', 1, 'Set'),
  ],
  Screwdriver: [
    tool('Screwdriver Cross (+) 160 MM', null, 'KRISBOW', 1, 'Pcs'),
    tool('Screwdriver Cross (+) 100 MM', null, 'KRISBOW', 1, 'Pcs'),
    tool('Screwdriver Cross (+) 60 MM', null, 'KRISBOW', 1, 'Pcs'),
    tool('Screwdriver Cross (+) 80 MM', null, 'PROTO', 1, 'Pcs'),
    tool('Screwdriver Flat (-) 150 MM', null, 'KRISBOW', 1, 'Pcs'),
    tool('Screwdriver Flat (-) 145 MM', null, 'KRISBOW', 1, 'Pcs'),
  ],
  'Reversible gear spanner': [8, 10, 12, 13, 14, 17, 19].map((n) => tool(`Reverse Gear Spanner ${n}`, null, 'KINCROME', 1, 'Pcs')),
  'Double open ended spanner': [
    tool('Open Ended Spanner 13 MM', 'MS16-13 MM', 'SIBILLE', 1, 'Pcs'),
    tool('Open Ended Spanner 17 MM', 'MS16-17 MM', 'SIBILLE', 1, 'Pcs'),
  ],
  'APD & perlengkapan lain': [
    tool('High Voltage Glove 5 KV', 'Class 0', 'REGELTEX', 1, 'Set'),
    tool('Ear Muff Partial', null, 'MSA', 5, 'Pcs'),
    tool('Full Body Harness', 'KB001', 'KINGS', 1, 'Pcs'),
    tool('Band It Tool', null, 'DENVER', 1, 'Pcs'),
    tool('DC Power Supply', 'GT 3200', 'MIRUSA', 1, 'Unit'),
    tool('Radio Rig', 'GM 338', 'MOTOROLA', 1, 'Unit'),
    tool('Tangga Segitiga Fiber', null, 'WERNER', 1, 'Unit'),
    tool('Tangga Panjang Fiber 12 M', null, 'WERNER', 1, 'Unit'),
    tool('Senter 6 Battery', 'Bf-777 N/M', 'PANASONIC', 1, 'Pcs'),
    tool('Soldering Gun', 'TQ77 GOOT', 'TAIYO', 1, 'Pcs'),
    tool('Radio HT', 'GP 328', 'MOTOROLA', 3, 'Unit'),
    tool('Head Lamp', 'M2000', 'N/B', 2, 'Unit'),
    tool('Ultra Bright Flashlight', 'Police 1500W', 'CREE LED', 1, 'Pcs'),
    tool('High Pressure Cleaner', null, 'KARCHER', 1, 'Pcs'),
  ],
};
let toolNo = 0;
const TOOLS_MONTHLY = {
  code: 'tools_monthly',
  name: 'Inspeksi Tools & Equipment',
  short_name: 'Tools & Equipment',
  description: 'Inspeksi kondisi tools & equipment electric tiap kuartal.',
  icon: 'wrench',
  period: 'quarter',
  subject_label: 'Lokasi / gudang tools',
  fix_hours: 168,
  photo_required: false,
  filler_label: 'Tools Keeper / Assessor',
  verifier_label: 'PIC Area / T&E Coordinator',
  sort_order: 2,
  header_fields: [
    { key: 'assessor', label: 'Assessor (Teknisi / AK3 Listrik)', type: 'text' },
    { key: 'berita_acara', label: 'Berita acara pengamanan tools dan equipment', type: 'textarea' },
  ],
  sections: [],
  subjects: [
    {
      site: 'SRN',
      name: 'Electric Suaran (ESUA)',
      detail: 'PT. Berau Coal',
      sections: Object.entries(TOOLS).map(([title, list]) => ({
        title,
        items: list.map((t) => {
          toolNo += 1;
          return { label: String(toolNo), ...t, kind: 'check', severity: 'fix', good: 'Ya', bad: 'Tidak', needs_photo: false };
        }),
      })),
    },
  ],
};

/* ---------- Pengukuran arus motor ---------- */
const RST = [
  { key: 'k_r', label: 'Kosongan R' },
  { key: 'k_s', label: 'Kosongan S' },
  { key: 'k_t', label: 'Kosongan T' },
  { key: 'm_r', label: 'Muatan R' },
  { key: 'm_s', label: 'Muatan S' },
  { key: 'm_t', label: 'Muatan T' },
];
const motor = (label, text, kw, max) => ({
  label,
  text,
  kind: 'measure',
  unit: 'A',
  fields: RST,
  spec: kw != null ? `${kw} kW · arus maks ${max} A` : null,
  max_value: max ?? null,
  severity: 'fix',
  required: false,
  needs_photo: false,
});
const sampler = (kwMax) =>
  [
    ['1', 'Primary Sampler'],
    ['2', 'Belt Feeder 1'],
    ['3', 'Crusher 1'],
    ['4', 'Crusher 2'],
    ['5', 'Belt Feeder 2'],
    ['6', 'Secondary Sampler'],
  ].map(([l, t], i) => motor(l, t, kwMax[i][0], kwMax[i][1]));

const AMPERE = {
  code: 'ampere',
  name: 'Pengukuran Arus Motor',
  short_name: 'Arus Motor',
  description: 'Pengukuran arus R / S / T motor conveyor, sampler, dan pompa saat kosongan dan bermuatan.',
  icon: 'bolt',
  period: 'month',
  subject_label: 'Lokasi',
  fix_hours: 72,
  photo_required: false,
  filler_label: 'Electrician',
  verifier_label: 'Supervisor Electric',
  sort_order: 3,
  header_fields: [{ key: 'no_catatan', label: 'No. catatan', type: 'text' }],
  sections: [],
  subjects: [
    {
      site: 'SRN',
      name: 'Suaran',
      detail: 'Inloading, outloading, sampler, pompa',
      sections: [
        { title: 'Inloading 1', items: [motor('1', 'CV-11', 45, 81), motor('2', 'CV-12', 132, 240), motor('3', 'CV-13', 200, 350), motor('4', 'Tripercar', 5.5, 10), motor('5', 'Motor Storm Brake', 1.5, 4)] },
        { title: 'Inloading 3', items: [motor('1', 'CV-46', 55, 102), motor('2', 'CV-47', 132, 240), motor('3', 'CV-48', 200, 350), motor('4', 'Tripercar', 5.5, 10)] },
        {
          title: 'Outloading',
          items: [
            motor('1', 'CV-10 Motor 1', 200, 350),
            motor('1', 'CV-10 Motor 2', 200, 350),
            motor('2', 'CV-14', 132, 231),
            motor('3', 'CV-15', 132, 237),
            motor('4', 'CV-18 Motor 1', 400, 551),
            motor('4', 'CV-18 Motor 2', 400, 551),
            motor('5', 'CV-19', 45, 85.2),
            motor('6', 'CV-49', 315, 550),
            motor('7', 'CV-50', 315, 550),
          ],
        },
        { title: 'Sampler CV-12', items: sampler([[22, 39.6], [0.55, 1.22], [5.5, 11.3], [5.5, 11.3], [0.75, 2.15], [0.75, 2.15]]) },
        { title: 'Sampler CV-47', items: sampler([[9.2, 18.7], [0.55, 3.05], [5.5, 11.3], [5.5, 11.3], [0.75, 2.15], [0.75, 2.15]]) },
        { title: 'Sampler CV-10', items: sampler([[9.2, 32.7], [0.55, 1.2], [5.5, 20.4], [5.5, 20.4], [0.55, 1.1], [1.1, 2.1]]) },
        { title: 'Pompa', items: [motor('1', 'KM-23 Motor 1', 37, 71), motor('1', 'KM-23 Motor 2', 37, 71), motor('2', 'KM-30', 11, 23.4), motor('3', 'Pompa Becoal', null, null)] },
      ],
    },
  ],
};

/* ---------- Safety device mingguan (per conveyor) ---------- */
const sd = (list) => [
  { title: 'Safety device', items: list.map((t, i) => ({ label: String(i + 1), text: t, kind: 'check', severity: 'fix', good: 'Fungsi', bad: 'Tidak' })) },
];
const SAFETY = {
  code: 'safety_device',
  name: 'Pengecekan Mingguan Electric Safety Device',
  short_name: 'Safety Device',
  description: 'Pengecekan mingguan fungsi safety device tiap conveyor.',
  icon: 'shield',
  period: 'week',
  subject_label: 'Conveyor',
  fix_hours: 24,
  photo_required: true,
  filler_label: 'Electrician',
  verifier_label: 'Supervisor Electric',
  doc_no: 'DOC IV-ALL-172-3.7.1',
  sort_order: 4,
  header_fields: [{ key: 'no_catatan', label: 'No. catatan', type: 'text' }],
  sections: [],
  subjects: [
    {
      site: 'SRN', name: 'CV-11', detail: 'Inloading',
      sections: sd(['Tilt Switch / Level Switch / Blockage Switch', 'Miss Alligment Switch Kiri', 'Miss Alligment Switch Kanan', 'Emergency Switch Bawah sebelah kanan', 'Emergency Switch Atas sebelah kiri', 'Rotation Detector', 'Kondisi Kabel Kontrol Unit', 'Kondisi Kabel Power Unit', 'Kondisi Junction Box Safety Device', 'Belt Rip Tail Pulley', 'Belt Rip Head Pulley']),
    },
    {
      site: 'SRN', name: 'CV-12', detail: 'Inloading',
      sections: sd(['Tilt Switch / Level Switch / Blockage Switch', 'Miss Alligment Switch Kiri Bag. Depan', 'Miss Alligment Switch Kiri Bag. Belakang', 'Miss Alligment Switch Kanan Bag. Depan', 'Miss Alligment Switch Kanan Bag. Belakang', 'Emergency Switch Sebelah Kiri Tengah', 'Emergency Switch Sebelah Kanan Tengah', 'Rotation Detector', 'Kondisi Kabel Kontrol Unit', 'Kondisi Kabel Power Unit', 'Kondisi Junction Box Safety Device', 'Belt Rip Tail Pulley (2 pcs)', 'Belt Rip Contaminan (1 pcs)']),
    },
    {
      site: 'SRN', name: 'CV-13', detail: 'Inloading',
      sections: sd(['Tilt Switch Blockage Switch Chute', 'Miss Alligment Switch Kiri Bag. Depan', 'Miss Alligment Switch Kanan Bag. Depan', 'Belt Rip Chute dan BP 4', 'Tilt Switch Blockage Switch BP4', 'Tilt Switch Blockage Switch BP3', 'Emergency Switch Bag. BP 3 dan BP 2', 'Tilt Switch Blockage Switch BP2', 'Belt Rip BP 2 dan BP1', 'Tilt Switch Blockage Switch BP1', 'Emergency Switch Bag. Kiri BP 1', 'Emergency Switch Bag. Kanan BP 1', 'Miss Alligment Switch Kanan dekat Chute 12', 'Miss Alligment Switch Kiri dekat Chute 12', 'Belt Rip di bawah Chute CV-12 (3 pcs)', 'Belt Rip Tail Pulley', 'Emergency Switch Chute CV-12', 'Rotation Detector', 'Kondisi Kabel Kontrol Unit', 'Kondisi Kabel Power Unit', 'Kondisi Junction Box Safety Device']),
    },
    {
      site: 'SRN', name: 'CV-19', detail: 'Outloading',
      sections: sd(['Tilt Switch / Level Switch / Blockage Switch', 'Miss Alligment Switch Kiri Bag. Depan', 'Miss Alligment Switch Kiri Bag. Belakang', 'Miss Alligment Switch Kanan Bag. Depan', 'Miss Alligment Switch Kanan Bag. Belakang', 'Emergency Switch Bag. Kiri', 'Emergency Switch Bag. Kanan', 'Rotation Detector', 'Kondisi Kabel Kontrol Unit', 'Kondisi Kabel Power Unit', 'Kondisi Junction Box Safety Device', 'Belt Rip Tail Pulley', 'Belt Rip Head Pulley', 'Belt Rip di bawah Chute CV-12']),
    },
    {
      site: 'SRN', name: 'CV-14', detail: 'Outloading',
      sections: sd(['Block Chute', 'Proximity Block Chute', 'Miss Alligment Switch Kiri Bag. Depan', 'Miss Alligment Switch Kiri Bag. Belakang', 'Miss Alligment Switch Kanan Bag. Depan', 'Miss Alligment Switch Kanan Bag. Belakang', 'Emergency Switch Bag. Kiri', 'Emergency Switch Bag. Kanan', 'Kondisi Kabel Kontrol Unit', 'Kondisi Kabel Power Unit', 'Kondisi Junction Box Safety Device']),
    },
    {
      site: 'SRN', name: 'CV-15', detail: 'Outloading',
      sections: sd(['Block Chute', 'Proximity Block Chute', 'Miss Alligment Switch Kiri Bag. Depan', 'Miss Alligment Switch Kiri Bag. Belakang', 'Miss Alligment Switch Kanan Bag. Depan', 'Miss Alligment Switch Kanan Bag. Belakang', 'Emergency Switch Bag. Kiri', 'Emergency Switch Bag. Kanan', 'Kondisi Kabel Kontrol Unit', 'Kondisi Kabel Power Unit', 'Kondisi Junction Box Safety Device']),
    },
    {
      site: 'SRN', name: 'CV-18', detail: 'Outloading',
      sections: sd([
        'Tilt Switch / Level Switch / Blockage Switch',
        'Miss Alligment Switch Kiri Bag. Tengah (return)',
        'Miss Alligment Switch Kanan Bag. Tengah (return)',
        'Miss Alligment Switch Kiri Bag. Tengah',
        'Miss Alligment Switch Kanan Bag. Tengah',
        'Miss Alligment Switch Kiri Bag. Belakang (tail)',
        'Miss Alligment Switch Kanan Bag. Belakang (tail)',
        ...Array.from({ length: 13 }, (_, i) => `Emergency Switch no ${i + 1}${i === 0 || i === 12 ? ' (sebelah kanan)' : ''}`),
        'Rotation Detector',
        'Kondisi Kabel Kontrol Unit',
        'Kondisi Kabel Power Unit',
        'Kondisi Junction Box Safety Device',
        'Belt Rip Kucuran CV-15 (2 unit)',
        'Belt Rip Tail Pulley (7 unit)',
        'Belt Rip Head Pulley',
        'Belt Rip Bend Pulley',
      ]),
    },
    {
      site: 'SRN', name: 'CV-10', detail: 'Outloading',
      sections: sd([
        'Miss Alligment Switch Kiri (River side C)', 'Miss Alligment Switch Kanan (River side C)',
        'Miss Alligment Switch Kiri (River side B)', 'Miss Alligment Switch Kanan (River side B)',
        'Miss Alligment Switch Kiri (Land side D)', 'Miss Alligment Switch Kanan (Land side D)',
        'Miss Alligment Switch Kiri (Land side C)', 'Miss Alligment Switch Kanan (Land side C)',
        'Miss Alligment Switch Kiri (Land side B)', 'Miss Alligment Switch Kanan (Land side B)',
        'Miss Alligment Switch Kiri (Land side A)', 'Miss Alligment Switch Kanan (Land side A)',
        'Emergency Switch Kiri (River side A)', 'Emergency Switch Kanan (River side A)', 'Emergency Switch Kiri (River side B)',
        'Emergency Switch Kiri (Land side C)', 'Emergency Switch Kiri (Land side B)', 'Emergency Switch Kiri (Land side A)',
        'Rotation Detector', 'Belt Rip Bend Pulley', 'Belt Rip dekat Sampler', 'Belt Rip (sensor kontaminan)', 'Belt Rip Chute CV-18', 'Belt Rip Tail Pulley',
        'Kondisi Kabel Kontrol Unit', 'Kondisi Kabel Power Unit', 'Kondisi Junction Box Safety Device',
      ]),
    },
  ],
};

/* ---------- Pengujian metal catcher ---------- */
const METAL = {
  code: 'metal_catcher',
  name: 'Pengujian Metal Catcher',
  short_name: 'Metal Catcher',
  description: 'Uji fungsi metal catcher dengan plat besi berbagai ukuran.',
  icon: 'magnet',
  period: 'week',
  subject_label: 'Unit',
  fix_hours: 24,
  photo_required: false,
  filler_label: 'Electrician / Operator CPP',
  verifier_label: 'Supervisor FPM / CPP',
  sort_order: 5,
  header_fields: [
    { key: 'merk_type', label: 'Merk / type', type: 'text' },
    { key: 'operator_cpp', label: 'Operator CPP', type: 'text' },
  ],
  sections: [
    {
      title: 'Metal yang dites',
      note: 'Hasil "Tidak" = plat tidak tertarik oleh metal catcher.',
      items: ['30 mm x 30 mm', '50 mm x 50 mm', '60 mm x 60 mm', '80 mm x 80 mm', '40 mm x 100 mm'].map((s, i) => ({
        label: String(i + 1),
        text: `Plate 3 mm x ${s}`,
        kind: 'check',
        severity: 'fix',
        good: 'Ketarik',
        bad: 'Tidak',
        needs_photo: false,
      })),
    },
  ],
  subjects: [],
};

/* ---------- Pengukuran pentanahan (grounding) penyalur petir ---------- */
const GROUNDING = {
  code: 'grounding',
  name: 'Pengukuran Pentanahan (Grounding) Penyalur Petir',
  short_name: 'Grounding',
  description: 'Pengukuran tahanan pentanahan titik grounding dan penyalur petir.',
  icon: 'ground',
  period: 'half',
  subject_label: 'Lokasi',
  fix_hours: 168,
  photo_required: false,
  filler_label: 'Electrician',
  verifier_label: 'Penanggung Jawab Area',
  sort_order: 7,
  header_fields: [{ key: 'no_catatan', label: 'No. catatan', type: 'text' }],
  sections: [],
  subjects: [
    {
      site: 'SRN',
      name: 'Suaran - BMO 1',
      detail: 'Titik grounding & penyalur petir',
      sections: [
        {
          title: 'Titik grounding',
          note: 'Besar tahanan dalam Ohm. Batas maksimum 5 Ohm (ubah di Kelola bila standarnya berbeda).',
          items: [
            'CV-12', 'CV-13', 'Workshop FPM Km 28', 'Tower IT KM-28', 'Power House Km 30', 'Counter weight CV-18', 'Tower IT KM-30',
            'BLC (CV-10)', 'Tower IT Office PBO', 'Tower Pos Dermaga', 'Penyalur petir Main tank no. 31', 'Penyalur petir Main tank no. 63A & 63B',
            'Penyalur petir Main tank no. 68 & 69', 'Penyalur petir Main tank no. 70 & 71', 'Penyalur petir Main tank no. 74', 'Tower IT Jembatan timbang',
            'Penyalur petir CV-50', 'Penyalur petir CV-47', 'Penyalur petir CV-48', 'Penyalur petir Lab Sucofindo', 'Penyalur petir PLTS',
          ].map((t, i) => ms(String(i + 1), t, 'Ohm', { spec: 'Titik A', max_value: 5, severity: 'fix', needs_photo: false })),
        },
      ],
    },
  ],
};

/* ---------- Pemeriksaan jembatan timbang ---------- */
const baikBuruk = { severity: 'fix', good: 'Baik', bad: 'Buruk' };
const WEIGHBRIDGE = {
  code: 'weighbridge',
  name: 'Form Pemeriksaan Jembatan Timbang',
  short_name: 'Jembatan Timbang',
  description: 'Pemeriksaan kondisi jembatan timbang, load cell, dan peralatan control room.',
  icon: 'scale',
  period: 'week',
  subject_label: 'Unit',
  fix_hours: 72,
  photo_required: true,
  filler_label: 'Electrician',
  verifier_label: 'Sub Section Head',
  doc_no: 'DOK IV-ALL-173-3.7.1',
  sort_order: 8,
  header_fields: [{ key: 'no_catatan', label: 'No. catatan', type: 'text' }],
  sections: [
    {
      title: 'Jembatan & area',
      items: [
        ck('1', 'Struktur plat jembatan', baikBuruk),
        ck('2', 'Kondisi penerangan area timbangan', baikBuruk),
        ck('3', 'Lampu indikasi traffic light', baikBuruk),
      ],
    },
    ...Array.from({ length: 7 }, (_, i) => ({
      title: `Kondisi fisik load cell ${i + 1}`,
      items: [
        ck('a', 'Posisi load cell', baikBuruk),
        ck('b', 'Kebersihan load cell', baikBuruk),
        ck('c', 'Kondisi kabel load cell', baikBuruk),
      ],
    })),
    {
      title: 'Control room timbangan',
      items: [
        ck('1', 'Kondisi APAR (control room timbangan)', baikBuruk),
        ck('2', 'Display Fairbank (mesin timbang)', baikBuruk),
        ck('3', 'Zeroing position', baikBuruk),
        ck('4', 'Pembacaan nilai timbang', baikBuruk),
        ck('5', 'Kebersihan control room timbangan', baikBuruk),
      ],
    },
  ],
  subjects: [{ site: 'SRN', name: 'Jembatan Timbang', detail: 'Suaran', sections: [] }],
};

/* nilai ukur yang hanya dicatat (tanpa batas) */
const note = { severity: 'note', needs_photo: false };

/* ---------- Pemeriksaan transformator (bulanan, dengan butir tahunan) ---------- */
const goodBad = { severity: 'fix', good: 'Good', bad: 'Bad' };
const cuaca = { key: 'cuaca', label: 'Kondisi cuaca', type: 'select', options: ['Cerah', 'Berawan', 'Hujan'] };
const RSTPE = [
  { key: 'r', label: 'R - PE' },
  { key: 's', label: 'S - PE' },
  { key: 't', label: 'T - PE' },
];
const yearly = { required: false, needs_photo: false };
const TRAFO = {
  code: 'trafo',
  name: 'Pemeriksaan Transformator',
  short_name: 'Trafo',
  description: 'Pemeriksaan bulanan tegangan, beban, oli, tangki, bushing, dan kebersihan trafo, plus butir tahunan (megger, grounding, bushing).',
  icon: 'transformer',
  period: 'month',
  subject_label: 'Trafo',
  fix_hours: 72,
  photo_required: true,
  filler_label: 'Electrician',
  verifier_label: 'Spv Electric',
  sort_order: 9,
  header_fields: [cuaca],
  sections: [
    {
      title: 'Pengukuran',
      note: 'Berdasarkan metering yang terpasang, atau alat ukur bila memungkinkan. Kosongkan bila tidak ada (NA).',
      items: [
        ms('1', 'Tegangan primer', 'V', note),
        ms('2', 'Tegangan sekunder', 'V', note),
        ms('3', 'Load', 'kW', note),
        ms('4', 'Oil temperature', '°C', { ...note, required: false }),
        ms('5', 'Oil pressure', 'psi', { ...note, required: false }),
        ms('6', 'Oil level', '%', { ...note, required: false }),
      ],
    },
    {
      title: 'Tangki',
      items: [ck('1', 'Korosi (corrosion)', goodBad), ck('2', 'Kebocoran (leakage)', goodBad), ck('3', 'Drain valve', { ...goodBad, required: false })],
    },
    { title: 'Sirip pendingin', items: [ck('1', 'Kebocoran (leakage)', goodBad)] },
    {
      title: 'Bushing',
      items: [ck('1', 'Korosi (corrosion)', goodBad), ck('2', 'Kebocoran (leakage)', goodBad), ck('3', 'Kebersihan (cleanliness)', goodBad)],
    },
    {
      title: 'Kondisi lain',
      items: [ck('1', 'Suara (tidak ada suara abnormal)', goodBad), ck('2', 'Bau (tidak ada bau abnormal)', goodBad), ck('3', 'Kebersihan dari tanaman liar', goodBad)],
    },
    {
      title: 'Tahunan · pengukuran',
      note: 'Diisi saat pemeriksaan tahunan; pada pemeriksaan bulanan boleh dilewati.',
      items: [
        { label: '1', text: 'Megger primer', kind: 'measure', unit: 'MOhm', fields: RSTPE, severity: 'note', ...yearly },
        { label: '2', text: 'Megger sekunder', kind: 'measure', unit: 'MOhm', fields: RSTPE, severity: 'note', ...yearly },
        ms('3', 'Resistance grounding', 'Ohm', { max_value: 5, severity: 'fix', ...yearly }),
      ],
    },
    {
      title: 'Tahunan · bushing & peralatan',
      note: 'Diisi saat pemeriksaan tahunan; pada pemeriksaan bulanan boleh dilewati.',
      items: [
        ck('1', 'Cleaning bushing', { severity: 'fix', good: 'Selesai', bad: 'Belum', ...yearly }),
        ck('2', 'Re-torque bushing', { severity: 'fix', good: 'Selesai', bad: 'Belum', ...yearly }),
        ck('3', 'Leakage check', { ...goodBad, ...yearly }),
        ck('4', 'Temperature gauge', { ...goodBad, ...yearly }),
        ck('5', 'Pressure gauge', { ...goodBad, ...yearly }),
        ck('6', 'Level meter', { ...goodBad, ...yearly }),
      ],
    },
  ],
  subjects: [
    { site: 'SRN', name: 'KM-30', detail: 'Transformator', sections: [] },
    { site: 'SRN', name: 'KM-28', detail: 'Transformator', sections: [] },
  ],
};
/* ---------- Checklist pemeriksaan oil trap (Power House) ---------- */
const yn = { severity: 'fix', good: 'Y', bad: 'N' };
const OIL_TRAP = {
  code: 'oil_trap',
  name: 'Checklist Pemeriksaan Oil Trap',
  short_name: 'Oil Trap',
  description: 'Pemeriksaan mingguan bak dan saluran oil trap (tidak tercampur air hujan, tidak bocor, bersih).',
  icon: 'drop',
  period: 'week',
  subject_label: 'Lokasi',
  fix_hours: 72,
  photo_required: true,
  filler_label: 'Pemeriksa',
  verifier_label: 'Penanggung Jawab Area',
  doc_no: 'DOKIV-ALL-28-3.7.5',
  sort_order: 10,
  sections: [
    {
      title: 'Pemeriksaan bak oil trap',
      note: 'Bila ada yang "N": tulis tindakan, dan isi rencana tanggal perbaikan / pembersihan.',
      items: [
        ck('1', 'Tidak tercampur air hujan', yn),
        ck('2', 'Kondisi bangunan baik / tidak bocor', yn),
        ck('3', 'Bersih dari lumpur / sampah', yn),
        ck('4', 'Bersih dari minyak', yn),
      ],
    },
    {
      title: 'Pemeriksaan saluran oil trap',
      items: [ck('1', 'Tidak tercampur air hujan', yn), ck('2', 'Kondisi saluran baik / tidak bocor', yn), ck('3', 'Bersih dari lumpur / sampah', yn)],
    },
  ],
  subjects: [{ site: 'SRN', name: 'Power House', detail: 'Oil trap power house', sections: [] }],
};

/* ---------- Pemeriksaan panel room / MCC (tiap 2 minggu) ---------- */
const PANEL = {
  code: 'panel',
  name: 'Form Pemeriksaan Panel Room',
  short_name: 'Panel / MCC',
  description: 'Pemeriksaan panel room / MCC tiap 2 minggu: pendingin, kebersihan, APAR, wiring diagram, kondisi fisik, koneksi, dan kabel.',
  icon: 'panel',
  period: 'biweek',
  subject_label: 'Panel',
  fix_hours: 72,
  photo_required: true,
  filler_label: 'Electrician',
  verifier_label: 'Supervisor Electric',
  doc_no: 'DOK IV-ALL-173-3.7.1',
  sort_order: 11,
  header_fields: [{ key: 'no_catatan', label: 'No. catatan', type: 'text' }],
  sections: [
    {
      title: 'Panel room',
      note: 'Butir 1 s/d 3 untuk panel di dalam ruangan; lewati bila panel di luar ruangan.',
      items: [
        ck('1', 'Kondisi alat pendingin / AC (panel room)', { ...baikBuruk, required: false }),
        ck('2', 'Kebersihan ruangan panel', { ...baikBuruk, required: false }),
        ck('3', 'Kondisi APAR (panel room)', { ...baikBuruk, required: false }),
        ck('4', 'Wiring diagram panel', baikBuruk),
      ],
    },
    {
      title: 'Kondisi fisik panel',
      items: [
        ck('5a', 'Kabel gland masih lengkap', baikBuruk),
        ck('5b', 'Tidak ada lubang yang tidak terpakai', baikBuruk),
        ck('5c', 'Kondisi panel tidak berkarat', baikBuruk),
        ck('5d', 'Kondisi panel tidak hancur', baikBuruk),
      ],
    },
    {
      title: 'Bagian dalam panel',
      items: [
        ck('6', 'Kebersihan di dalam panel', baikBuruk),
        ck('7', 'Kekencangan koneksi', baikBuruk),
        ck('8', 'Kerapian kabel (teridentifikasi)', baikBuruk),
        ck('9', 'Kondisi isolasi kabel', baikBuruk),
      ],
    },
  ],
  subjects: [
    ...['MCC 1', 'MCC 2', 'MCC 4', 'MCC 5'].map((name) => ({ site: 'SRN', name, detail: 'Suaran', sections: [] })),
    ...['CV-14', 'CV-15'].map((cv) => ({
      site: 'SRN',
      name: `Panel Metal Catcher ${cv}`,
      detail: 'Suaran',
      sections: [{ title: 'Metering & indikasi', items: [ck('10', 'Metering / display', baikBuruk), ck('11', 'Lampu indikasi', baikBuruk)] }],
    })),
  ],
};

/* ---------- Pemeriksaan motor listrik: koneksi terminal (tiap kuartal) ---------- */
const brk = { severity: 'fix', good: 'Baik', bad: 'Rusak / kurang' };
const opt = { required: false, needs_photo: false };
const MOTOR_TERMINAL = {
  code: 'motor_terminal',
  name: 'Pemeriksaan Motor Listrik (Koneksi Terminal)',
  short_name: 'Terminal Motor',
  description: 'Pemeriksaan koneksi terminal dan fisik motor listrik tiap kuartal, dengan uji tahanan isolasi, tahanan belitan, dan uji tanpa beban.',
  icon: 'motor',
  period: 'quarter',
  subject_label: 'Motor',
  fix_hours: 168,
  photo_required: true,
  filler_label: 'Electrician',
  verifier_label: 'Supervisor Electric',
  sort_order: 12,
  header_fields: [
    { key: 'inv_no', label: 'Inv. no.', type: 'text' },
    { key: 'merk', label: 'Merk', type: 'text' },
    { key: 'type', label: 'Type', type: 'text' },
    { key: 'voltage', label: 'Voltage', type: 'text' },
    { key: 'rpm', label: 'rpm', type: 'text' },
    { key: 'test_volt', label: 'Volt uji isolasi', type: 'select', options: ['250 V', '500 V', '1000 V'] },
  ],
  sections: [
    {
      title: 'Koneksi terminal',
      note: 'Periksa kotak terminal, plat isolator, kekencangan baut & mur terminal, dan jumper.',
      items: [
        ck('1', 'Terminal box (kotak terminal)', brk),
        ck('2', 'Terminal plate (plat isolator)', brk),
        ck('3', 'Terminal bolts & nuts (kekencangan)', brk),
        ck('4', 'Jumper delta / star (D / Y)', brk),
      ],
    },
    {
      title: 'Pemeriksaan fisik',
      items: [
        ck('5', 'Fin (sirip-sirip)', brk),
        ck('6', 'Fan guard (tutup kipas)', brk),
        ck('7', 'Outer shaft (poros luar)', brk),
        ck('8', 'Painting (kondisi cat)', brk),
        ck('9', 'Nipple grease', brk),
        ck('10', 'Fan', brk),
        ck('11', 'Drive end bearing', brk),
        ck('12', 'Non drive end bearing', brk),
      ],
    },
    {
      title: 'Uji tahanan isolasi',
      note: 'Diisi bila diuji. Standar lebih dari 1 MOhm.',
      items: [
        {
          label: '1',
          text: 'Tahanan isolasi',
          kind: 'measure',
          unit: 'MOhm',
          fields: ['U - V', 'U - W', 'V - W', 'U - G', 'V - G', 'W - G'].map((l) => ({ key: l.replace(/ - /, '').toLowerCase(), label: l })),
          min_value: 1,
          severity: 'fix',
          ...opt,
        },
      ],
    },
    {
      title: 'Uji tahanan belitan',
      note: 'Diisi bila diuji. Ketiga hasil harus sama (equal).',
      items: [
        {
          label: '1',
          text: 'Tahanan belitan',
          kind: 'measure',
          unit: 'Ohm',
          fields: [
            { key: 'u', label: 'U1 - U2' },
            { key: 'v', label: 'V1 - V2' },
            { key: 'w', label: 'W1 - W2' },
          ],
          severity: 'note',
          ...opt,
        },
      ],
    },
    {
      title: 'Uji tanpa beban',
      note: 'Diisi bila diuji.',
      items: [
        { label: '1', text: 'Tegangan', kind: 'measure', unit: 'V', fields: [{ key: 'r', label: 'R' }, { key: 's', label: 'S' }, { key: 't', label: 'T' }], severity: 'note', ...opt },
        { label: '2', text: 'Arus', kind: 'measure', unit: 'A', fields: [{ key: 'r', label: 'R' }, { key: 's', label: 'S' }, { key: 't', label: 'T' }], severity: 'note', ...opt },
        ms('3', 'Frekuensi', 'Hz', { severity: 'note', ...opt }),
      ],
    },
  ],
  // motor utama dari form pengukuran arus (motor sampler bisa ditambah di Kelola)
  subjects: [
    ['Inloading 1', [['CV-11', 45], ['CV-12', 132], ['CV-13', 200], ['Tripercar CV-13', 5.5]]],
    ['Inloading 3', [['CV-46', 55], ['CV-47', 132], ['CV-48', 200], ['Tripercar CV-48', 5.5]]],
    ['Outloading', [['CV-10 Motor 1', 200], ['CV-10 Motor 2', 200], ['CV-14', 132], ['CV-15', 132], ['CV-18 Motor 1', 400], ['CV-18 Motor 2', 400], ['CV-19', 45], ['CV-49', 315], ['CV-50', 315]]],
    ['Pompa', [['Pompa KM-23 Motor 1', 37], ['Pompa KM-23 Motor 2', 37], ['Pompa KM-30', 11]]],
  ].flatMap(([area, list]) => list.map(([name, kw]) => ({ site: 'SRN', name, detail: `${area} · ${kw} kW`, sections: [] }))),
};

export const FORM_SEED = [TOOLS_MONTHLY, AMPERE, SAFETY, METAL, GROUNDING, WEIGHBRIDGE, TRAFO, OIL_TRAP, PANEL, MOTOR_TERMINAL];
