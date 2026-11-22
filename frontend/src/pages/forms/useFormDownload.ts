import { useState } from 'react';
import { openTicket } from '../../lib/api';
import { useToast } from '../../lib/toast';

export type ExportFormat = 'pdf' | 'xlsx' | 'docx';

/** Unduh rekap satu jenis form (PDF / Excel / Word) untuk rentang tanggal & site tertentu. */
export function useFormDownload(code: string) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const download = async (format: ExportFormat, f: { from?: string; to?: string; site_id?: number | null }) => {
    setBusy(true);
    try {
      await openTicket(`/api/forms/${encodeURIComponent(code)}/export`, { format, from: f.from || undefined, to: f.to || undefined, site_id: f.site_id ?? undefined });
    } catch (e) {
      toast.push({ title: 'Gagal menyiapkan unduhan', body: e instanceof Error ? e.message : undefined, tone: 'danger' });
    } finally {
      window.setTimeout(() => setBusy(false), 1200);
    }
  };
  return { download, busy };
}
