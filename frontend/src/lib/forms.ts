// Form digital serbaguna (tools, arus motor, safety device, metal catcher, panel, ...)
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { IconName } from '../components/Icon';
import { api, qs } from './api';
import { loadSnapshot } from './cache';
import { withSnapshot } from './hooks';
import type { FormFinding, FormOverview, FormRecordListItem, FormResult, FormSection, FormSeverity, FormStats, FormTypeSummary } from './types';

export const FORM_PHOTO_BASE = '/api/forms/photos';

/** Kode P2H Genset di daftar hak akses form. */
export const GENSET_CODE = 'p2h_genset';
/** Boleh membuka form ini? Admin selalu boleh; form_access kosong = semua form. */
export const canUseForm = (u: { role: string; form_access?: string[] | null } | null | undefined, code: string) =>
  !!u && (u.role === 'admin' || !u.form_access || u.form_access.includes(code));
export const formPath = (code: string, rest = '') => `/f/${code}${rest}`;

const ICONS = new Set<IconName>(['truck', 'wrench', 'bolt', 'shield', 'magnet', 'gauge', 'generator', 'list', 'flag', 'table', 'ground', 'scale', 'transformer']);
export const formIcon = (name: string): IconName => (ICONS.has(name as IconName) ? (name as IconName) : 'list');

export const RESULT_TEXT: Record<FormResult, string> = { ok: 'Semua baik', finding: 'Ada temuan', stop: 'STOP' };
export const RESULT_TONE: Record<FormResult, 'ok' | 'warn' | 'stop'> = { ok: 'ok', finding: 'warn', stop: 'stop' };
export const SEVERITY_TEXT: Record<FormSeverity, string> = { stop: 'STOP', fix: 'Perbaiki', note: 'Catat' };
export const PERIOD_TEXT: Record<string, string> = { shift: 'Tiap shift', day: 'Harian', week: 'Mingguan', biweek: 'Tiap 2 minggu', month: 'Bulanan', quarter: 'Per kuartal (3 bulan)', half: 'Per semester (6 bulan)', none: 'Sesuai kebutuhan' };

export function useFormTypes() {
  return useQuery({
    queryKey: ['forms'],
    queryFn: () => withSnapshot('forms', () => api.get<{ items: FormTypeSummary[] }>('/api/forms')),
    staleTime: 20_000,
    initialData: () => loadSnapshot<{ items: FormTypeSummary[] }>('forms')?.data,
    initialDataUpdatedAt: () => loadSnapshot<unknown>('forms')?.at,
    refetchInterval: () => (document.visibilityState === 'visible' ? 60_000 : false),
  });
}

export function useFormOverview(code: string, all = false) {
  return useQuery({
    queryKey: ['form', code, all],
    // salinan terakhir disimpan di HP supaya form tetap bisa dibuka & diisi saat tanpa sinyal
    queryFn: () => (all ? api.get<FormOverview>(`/api/forms/${code}?all=1`) : withSnapshot(`form.${code}`, () => api.get<FormOverview>(`/api/forms/${code}`))),
    staleTime: 15_000,
    initialData: () => (all ? undefined : loadSnapshot<FormOverview>(`form.${code}`)?.data),
    initialDataUpdatedAt: () => (all ? undefined : loadSnapshot<unknown>(`form.${code}`)?.at),
  });
}

type Checklist = { sections: FormSection[]; last_header: Record<string, string | number> | null };

export function useFormChecklist(code: string, subjectId: number | null, all = false, enabled = true) {
  return useQuery({
    queryKey: ['form-checklist', code, subjectId, all],
    queryFn: () => {
      const get = () => api.get<Checklist>(`/api/forms/${code}/checklist${qs({ subject_id: subjectId, all: all ? 1 : undefined })}`);
      return all ? get() : withSnapshot(`form-cl.${code}.${subjectId ?? 0}`, get);
    },
    initialData: () => (all ? undefined : loadSnapshot<Checklist>(`form-cl.${code}.${subjectId ?? 0}`)?.data),
    initialDataUpdatedAt: () => (all ? undefined : loadSnapshot<unknown>(`form-cl.${code}.${subjectId ?? 0}`)?.at),
    enabled,
    staleTime: 30_000,
  });
}

export interface FormHistoryFilter {
  site_id?: number | null;
  subject_id?: number | null;
  from?: string;
  to?: string;
  result?: string;
  unverified?: boolean;
  mine?: boolean;
  q?: string;
  limit?: number;
  offset?: number;
}

export function useFormRecords(code: string, f: FormHistoryFilter) {
  return useQuery({
    queryKey: ['form-records', code, f],
    queryFn: () =>
      api.get<{ items: FormRecordListItem[]; total: number; limit: number; offset: number }>(
        `/api/forms/${code}/records${qs({ ...f, unverified: f.unverified ? 1 : undefined, mine: f.mine ? 1 : undefined })}`,
      ),
    placeholderData: keepPreviousData,
  });
}

export function useFormFindings(code: string, status: 'open' | 'closed', siteId?: number | null) {
  return useQuery({
    queryKey: ['form-findings', code, status, siteId ?? null],
    queryFn: () => api.get<{ items: FormFinding[] }>(`/api/forms/${code}/findings${qs({ status, site_id: siteId })}`),
    placeholderData: keepPreviousData,
    refetchInterval: () => (document.visibilityState === 'visible' ? 60_000 : false),
  });
}

/** "Unit LV" -> "unit LV" (singkatan tetap kapital) */
export const lowerFirst = (s: string | null | undefined) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : '');

/** Angka ukur ditampilkan rapi: 12.5 -> "12,5" */
export function fmtNum(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString('id-ID', { maximumFractionDigits: 3 });
}

/** "maks 81 A", "min 1 MOhm", "0,44 – 2 Ohm" */
export function limitText(min: number | null, max: number | null, unit: string | null): string {
  const u = unit ? ` ${unit}` : '';
  if (min != null && max != null) return `${fmtNum(min)} – ${fmtNum(max)}${u}`;
  if (max != null) return `maks ${fmtNum(max)}${u}`;
  if (min != null) return `min ${fmtNum(min)}${u}`;
  return '';
}

export function useFormStats(code: string, from: string, to: string, siteId: number | null) {
  return useQuery({
    queryKey: ['form-stats', code, from, to, siteId],
    queryFn: () => api.get<FormStats>(`/api/forms/${code}/stats${qs({ from, to, site_id: siteId })}`),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}
