import webpush from 'web-push';
import { config } from '../config.js';
import { query } from '../db.js';

let ready = false;

export function initPush() {
  const { publicKey, privateKey, subject } = config.vapid;
  if (!publicKey || !privateKey) {
    console.warn('[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY belum diisi: notifikasi ke HP dimatikan (pemberitahuan di dalam aplikasi tetap jalan).');
    return;
  }
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    ready = true;
    console.log('[push] notifikasi HP aktif');
  } catch (err) {
    console.error('[push] kunci VAPID tidak valid:', err.message);
  }
}

export const pushReady = () => ready;

/**
 * Simpan pemberitahuan di dalam aplikasi lalu kirim ke HP yang sudah mengaktifkan notifikasi.
 *  - isFinding: true untuk temuan / STOP / selesai diperbaiki (tetap dikirim ke yang memilih "hanya temuan")
 *  - actorUserId: pembuat kejadian (tidak dikirimi notifikasi, dia sudah tahu)
 */
export async function notifyEvent({ kind, severity, title, body, siteId, unitId, formId, actorUserId, isFinding, path }) {
  const { rows } = await query(
    `INSERT INTO notifications (kind, severity, title, body, site_id, unit_id, form_id, actor_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, created_at`,
    [kind, severity, title, body, siteId ?? null, unitId ?? null, formId ?? null, actorUserId ?? null],
  );
  const notif = rows[0];
  if (!ready) return { id: notif.id, sent: 0 };

  const subs = await query(
    `SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth
       FROM push_subscriptions ps
       JOIN users u ON u.id = ps.user_id
      WHERE u.is_active
        AND ($1::int IS NULL OR u.id <> $1)
        AND (u.notif_site_ids IS NULL OR $2::int IS NULL OR $2 = ANY (u.notif_site_ids))
        AND (u.notif_mode = 'all' OR $3::boolean)`,
    [actorUserId ?? null, siteId ?? null, !!isFinding],
  );

  const payload = JSON.stringify({
    id: notif.id,
    kind,
    severity,
    title,
    body,
    url: `${config.appUrl}${path || '/'}`,
    path: path || '/',
    tag: formId ? `p2h-${formId}-${kind}` : `n-${notif.id}`,
    ts: notif.created_at,
  });

  const results = await Promise.allSettled(subs.rows.map((s) => sendOne(s, payload, severity)));
  const sent = results.filter((r) => r.status === 'fulfilled' && r.value).length;
  return { id: notif.id, sent, total: subs.rowCount };
}

async function sendOne(sub, payload, severity) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
      { TTL: severity === 'danger' ? 6 * 3600 : 3600, urgency: severity === 'danger' ? 'high' : 'normal' },
    );
    await query('UPDATE push_subscriptions SET last_ok_at = now(), fail_count = 0 WHERE id = $1', [sub.id]);
    return true;
  } catch (err) {
    const code = err.statusCode;
    if (code === 404 || code === 410) {
      // HP sudah mencabut izin / aplikasi dihapus: buang
      await query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
    } else {
      await query(
        `UPDATE push_subscriptions SET fail_count = fail_count + 1 WHERE id = $1`,
        [sub.id],
      );
      await query('DELETE FROM push_subscriptions WHERE id = $1 AND fail_count >= 8', [sub.id]);
      console.error(`[push] gagal kirim (${code || err.code || 'error'}): ${err.body || err.message}`);
    }
    return false;
  }
}

/** Kirim uji coba hanya ke HP milik satu pengguna. */
export async function sendTestToUser(userId) {
  if (!ready) return { ok: false, reason: 'VAPID belum diisi di server.' };
  const subs = await query('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1', [userId]);
  if (!subs.rowCount) return { ok: false, reason: 'HP ini belum mengaktifkan notifikasi.' };
  const payload = JSON.stringify({
    kind: 'test',
    severity: 'info',
    title: 'Tes notifikasi P2H Genset',
    body: 'Kalau Anda membaca ini, notifikasi di HP ini sudah berfungsi.',
    url: `${config.appUrl}/`,
    path: '/',
    tag: 'test',
    ts: new Date().toISOString(),
  });
  const results = await Promise.allSettled(subs.rows.map((s) => sendOne(s, payload, 'info')));
  const sent = results.filter((r) => r.status === 'fulfilled' && r.value).length;
  return { ok: sent > 0, sent, total: subs.rowCount };
}
