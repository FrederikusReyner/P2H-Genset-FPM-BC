import { query } from '../db.js';

/** Catat siapa mengubah apa (bisa dilihat lewat DBeaver di tabel audit_log). */
export async function audit(client, user, action, entity, entityId, detail) {
  const run = client ? client.query.bind(client) : query;
  try {
    await run(
      `INSERT INTO audit_log (user_id, user_name, action, entity, entity_id, detail) VALUES ($1,$2,$3,$4,$5,$6)`,
      [user?.id ?? null, user?.name ?? null, action, entity, entityId == null ? null : String(entityId), detail ? JSON.stringify(detail) : null],
    );
  } catch (err) {
    // pencatatan tidak boleh menggagalkan pekerjaan utama
    console.error('[audit] gagal mencatat:', err.message);
  }
}
