import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { parse } from '../middleware/validate.js';
import { pushReady, sendTestToUser } from '../services/push.js';

const r = Router();

/** Kunci publik VAPID dibutuhkan HP untuk mendaftar notifikasi. Tidak rahasia. */
r.get('/push/public-key', (_req, res) => {
  res.json({ enabled: pushReady(), public_key: config.vapid.publicKey || null });
});

r.use(requireAuth);

// pemberitahuan yang boleh dilihat pengguna ini (sesuai pilihan site & jenis)
const VISIBLE = `(n.site_id IS NULL OR (u.role = 'admin' AND (u.notif_site_ids IS NULL OR n.site_id = ANY (u.notif_site_ids))) OR (u.role <> 'admin' AND n.site_id = u.site_id))
  AND (u.notif_mode = 'all' OR n.kind IN ('p2h_stop','p2h_finding','finding_closed'))`;

r.get('/', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 40, 1), 100);
  const [list, unread] = await Promise.all([
    query(
      `SELECT n.id, n.kind, n.severity, n.title, n.body, n.site_id, n.unit_id, n.form_id, n.created_at,
              (n.actor_user_id IS NOT NULL AND n.actor_user_id = u.id) AS mine
         FROM notifications n, users u
        WHERE u.id = $1 AND ${VISIBLE}
        ORDER BY n.id DESC LIMIT ${limit}`,
      [req.user.id],
    ),
    query(
      `SELECT count(*)::int AS n FROM notifications n, users u
        WHERE u.id = $1 AND n.id > u.notif_seen_id AND ${VISIBLE}
          AND (n.actor_user_id IS NULL OR n.actor_user_id <> u.id)`,
      [req.user.id],
    ),
  ]);
  res.json({ items: list.rows, unread: unread.rows[0].n, seen_id: req.user.notif_seen_id });
});

r.post('/seen', async (req, res) => {
  const b = parse(z.object({ id: z.number().int().optional() }), req.body);
  const upTo = b.id ?? (await query('SELECT COALESCE(max(id),0) AS m FROM notifications')).rows[0].m;
  await query('UPDATE users SET notif_seen_id = GREATEST(notif_seen_id, $1) WHERE id = $2', [upTo, req.user.id]);
  res.json({ ok: true });
});

/* ---- Web Push: daftar / cabut / uji ---- */

const SubIn = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(300), auth: z.string().min(10).max(100) }),
});

r.post('/push/subscribe', async (req, res) => {
  const s = parse(SubIn, req.body);
  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (endpoint) DO UPDATE
       SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
           user_agent = EXCLUDED.user_agent, fail_count = 0`,
    [req.user.id, s.endpoint, s.keys.p256dh, s.keys.auth, String(req.headers['user-agent'] || '').slice(0, 200)],
  );
  res.json({ ok: true });
});

r.post('/push/unsubscribe', async (req, res) => {
  const b = parse(z.object({ endpoint: z.string().url().max(1000) }), req.body);
  await query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [b.endpoint, req.user.id]);
  res.json({ ok: true });
});

r.post('/push/test', async (req, res) => {
  res.json(await sendTestToUser(req.user.id));
});

export default r;
