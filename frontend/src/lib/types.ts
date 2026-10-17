// Bentuk data yang dikirim server (sama dengan nama kolom di database)

export type Role = 'mekanik' | 'pengawas' | 'manajemen' | 'admin';
export type Condition = 'baik' | 'rusak' | 'perbaiki';
export type Danger = 'AA' | 'A';
export type ResultKind = 'baik' | 'temuan_a' | 'stop_aa';
export type FixStatus = 'open' | 'in_progress' | 'closed';
export type UnitStatus = 'running' | 'standby' | 'breakdown' | 'inactive';
export type TileState = 'ok' | 'warn' | 'stop' | 'pending' | 'off';

export interface User {
  id: number;
  nrp: string;
  name: string;
  role: Role;
  site_id: number | null;
  job_title: string | null;
  phone: string | null;
  must_change_password: boolean;
  notif_mode: 'all' | 'findings';
  notif_site_ids: number[] | null;
  has_signature: boolean;
  signature_png?: string | null;
}

export interface Site {
  id: number;
  code: string;
  name: string;
  job_site: string | null;
  sort_order: number;
}

export interface ChecklistItem {
  id: number;
  no: number | null;
  text: string;
  hint: string | null;
  danger_code: Danger;
  sort_order: number;
  is_active: boolean;
}

export interface ChecklistSection {
  id: number;
  code: string;
  title: string;
  sort_order: number;
  items: ChecklistItem[];
}

export interface ParamDef {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
}

export interface ShiftInfo {
  shift_date: string;
  shift: 1 | 2;
}

export interface Settings {
  shift1_start: string;
  shift2_start: string;
  require_signature: boolean;
  a_deadline_hours: number;
}

export interface Meta {
  server_time: string;
  wita: { date: string; H: number; M: number; minutes: number; time: string };
  shift: ShiftInfo;
  sites: Site[];
  checklist: ChecklistSection[];
  params: ParamDef[];
  settings: Settings;
  version: string;
}

export interface Unit {
  id: number;
  code: string;
  old_code: string | null;
  site_id: number;
  site_code: string;
  site_name: string;
  site_job_site: string | null;
  location: string | null;
  job_site: string | null;
  brand: string | null;
  model: string | null;
  serial_no: string | null;
  engine_model: string | null;
  capacity_kva: number | null;
  rated_kw: number | null;
  rated_voltage: number | null;
  rated_rpm: number | null;
  status: UnitStatus;
  hm_master: number | null;
  notes: string | null;
  last_form_id: number | null;
  last_shift_date: string | null;
  last_shift: number | null;
  last_hm_start: number | null;
  last_hm_end: number | null;
  last_result: ResultKind | null;
  last_hm: number | null;
  current_form_id: number | null;
  current_result: ResultKind | null;
  open_aa: number;
  open_a: number;
}

export interface P2HListItem {
  id: number;
  shift_date: string;
  shift: 1 | 2;
  unit_id: number;
  unit_code: string;
  unit_old_code: string | null;
  unit_brand: string | null;
  unit_model: string | null;
  site_id: number;
  site_name: string;
  job_site: string | null;
  location: string | null;
  inspector_name: string;
  inspector_nrp: string | null;
  result: ResultKind;
  n_aa: number;
  n_a: number;
  hm_start: number | null;
  hm_end: number | null;
  filled_at: string;
  submitted_at: string;
  signed: boolean;
  sup_name: string | null;
  sup_signed_at: string | null;
  notes: string | null;
}

export interface Answer {
  id: number;
  item_id: number | null;
  section_code: string;
  section_title: string;
  section_order: number;
  item_no: number;
  item_text: string;
  hint: string | null;
  danger_code: Danger;
  condition: Condition;
  note: string | null;
  fix_status: FixStatus | null;
  fix_note: string | null;
  fix_by_name: string | null;
  fix_at: string | null;
  due_at: string | null;
}

export interface FormFull {
  id: number;
  unit_id: number;
  site_id: number;
  shift_date: string;
  shift: 1 | 2;
  user_id: number;
  inspector_name: string;
  inspector_nrp: string | null;
  unit_code: string;
  unit_old_code: string | null;
  unit_brand: string | null;
  unit_model: string | null;
  site_name: string;
  job_site: string | null;
  location: string | null;
  hm_start: number | null;
  hm_end: number | null;
  notes: string | null;
  signature_png: string | null;
  result: ResultKind;
  n_aa: number;
  n_a: number;
  filled_at: string | null;
  submitted_at: string;
  edited_at: string | null;
  edited_by_name: string | null;
  sup_name: string | null;
  sup_nrp: string | null;
  sup_signature_png: string | null;
  sup_signed_at: string | null;
  rated_kw: number | null;
  rated_voltage: number | null;
  rated_rpm: number | null;
  capacity_kva: number | null;
}

export interface FormDetail {
  form: FormFull;
  sections: { code: string; title: string; order: number; items: Answer[] }[];
  params: { key: string; label: string; unit: string; idle: number | null; load: number | null }[];
  permissions: { can_edit: boolean; can_sign: boolean; can_unsign: boolean; can_delete: boolean };
}

export interface Finding {
  id: number;
  form_id: number;
  item_id: number | null;
  section_code: string;
  section_title: string;
  item_no: number;
  item_text: string;
  danger_code: Danger;
  condition: Condition;
  note: string | null;
  unit_id: number;
  unit_code: string;
  unit_brand: string | null;
  unit_model: string | null;
  site_id: number;
  site_name: string;
  shift_date: string;
  shift: 1 | 2;
  inspector_name: string;
  last_seen_at: string;
  first_seen_at?: string;
  times: number;
  status: FixStatus;
  maybe_fixed: boolean;
  due_at: string | null;
  hours_open: number | null;
  overdue: boolean;
  fix_note?: string | null;
  fix_by_name?: string | null;
  fix_at?: string | null;
}

export interface DashUnit {
  id: number;
  code: string;
  old_code: string | null;
  brand: string | null;
  model: string | null;
  status: UnitStatus;
  site_id: number;
  location: string | null;
  form_id: number | null;
  result: ResultKind | null;
  inspector_name: string | null;
  signed: boolean | null;
  filled_at: string | null;
  open_aa: number;
  open_a: number;
  required: boolean;
  done: boolean;
  state: TileState;
}

export interface DashSite {
  id: number;
  code: string;
  name: string;
  required: number;
  done: number;
  missing: number;
  stop: number;
  warn: number;
  findings_30d: { aa: number; a: number };
  units: DashUnit[];
}

export interface Dashboard {
  context: { date: string; shift: 1 | 2; is_current: boolean; current: ShiftInfo };
  kpi: {
    required: number;
    done: number;
    missing: number;
    stop: number;
    warn: number;
    ok: number;
    unsigned: number;
    forms_total: number;
    open_findings: number;
    open_aa: number;
    compliance_pct: number;
  };
  sites: DashSite[];
  trend: { date: string; s1: number; s2: number; findings: number; pct: number }[];
  top_items: { item_text: string; danger_code: Danger; section_code: string; n: number; units: number }[];
  open_findings: { total: number; items: Finding[] };
  recent: P2HListItem[];
  generated_at: string;
}

export interface Notice {
  id: number;
  kind: string;
  severity: 'ok' | 'info' | 'warn' | 'danger';
  title: string;
  body: string;
  site_id: number | null;
  unit_id: number | null;
  form_id: number | null;
  created_at: string;
  /** kejadian ini dibuat oleh pengguna yang sedang masuk */
  mine: boolean;
}

export interface UserRow {
  id: number;
  nrp: string;
  name: string;
  role: Role;
  site_id: number | null;
  job_title: string | null;
  phone: string | null;
  is_active: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
  created_at: string;
  has_signature: boolean;
  devices: number;
}

/** Isi yang dikirim saat membuat / mengubah P2H */
export interface P2HPayload {
  client_uuid?: string;
  unit_id?: number;
  shift_date?: string;
  shift?: number;
  filled_at?: string;
  location?: string | null;
  job_site?: string | null;
  hm_start?: number | null;
  hm_end?: number | null;
  params: Record<string, { idle?: number | null; load?: number | null }>;
  answers: { item_id: number; condition: Condition; note?: string | null }[];
  notes?: string | null;
  signature_png?: string | null;
  use_saved_signature?: boolean;
  save_signature?: boolean;
}
