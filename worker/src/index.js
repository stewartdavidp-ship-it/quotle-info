/**
 * quotle-info community backend — votes ("+1 to prioritise") + nominations for the
 * homepage "research bench". quotle.info is a static GitHub Pages site, so this Worker is
 * the write path it can't have on its own. Storage = D1 (SQLite); abuse control = Turnstile
 * + per-IP dedupe/limits. Nominations land in a MODERATION queue and are NEVER auto-published
 * (the anti-fabrication guardrail — a human promotes reviewed ones into the harvest backlog).
 *
 * NO SECRETS in this file. Set via `wrangler secret put`:
 *   TURNSTILE_SECRET  — Cloudflare Turnstile secret key (server-side verify)
 *   ADMIN_TOKEN       — random string; gates GET /nominations (moderation read)
 *   IP_SALT           — random string; salts the IP hash so raw IPs are never stored
 *
 * Routes:
 *   GET  /votes                     → { votes: { slug: count, ... } }
 *   POST /vote        {slug,token}  → { ok, count }            (Turnstile + 1/IP/slug dedupe)
 *   POST /nominate    {author,quote?,note?,token} → { ok }     (Turnstile + daily per-IP cap)
 *   GET  /nominations?token=&status=pending → { nominations } (ADMIN_TOKEN only)
 */

const ALLOWED_ORIGINS = ['https://quotle.info', 'https://www.quotle.info', 'http://localhost:8099'];
const MAX_NOMS_PER_DAY = 5;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    const cors = {
      'Access-Control-Allow-Origin': allow,
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };
    const send = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (url.pathname === '/votes' && req.method === 'GET') {
        const { results } = await env.DB.prepare('SELECT slug, count FROM votes').all();
        const votes = {};
        for (const r of results) votes[r.slug] = r.count;
        return send({ votes });
      }

      if (url.pathname === '/vote' && req.method === 'POST') {
        const body = await req.json().catch(() => ({}));
        const slug = String(body.slug || '').trim();
        if (!/^[a-z0-9-]{3,80}$/.test(slug)) return send({ error: 'bad slug' }, 400);
        if (!(await verifyTurnstile(env, body.token, req))) return send({ error: 'verification failed' }, 403);

        const iphash = await ipHash(req, env);
        const dup = await env.DB.prepare('SELECT 1 FROM vote_log WHERE iphash=? AND slug=?').bind(iphash, slug).first();
        if (dup) {
          const cur = await env.DB.prepare('SELECT count FROM votes WHERE slug=?').bind(slug).first();
          return send({ ok: true, already: true, count: cur ? cur.count : 0 });
        }
        const now = new Date().toISOString();
        await env.DB.batch([
          env.DB.prepare('INSERT INTO votes (slug,count,updated) VALUES (?,1,?) ON CONFLICT(slug) DO UPDATE SET count=count+1, updated=excluded.updated').bind(slug, now),
          env.DB.prepare('INSERT OR IGNORE INTO vote_log (iphash,slug,created) VALUES (?,?,?)').bind(iphash, slug, now),
        ]);
        const cur = await env.DB.prepare('SELECT count FROM votes WHERE slug=?').bind(slug).first();
        return send({ ok: true, count: cur ? cur.count : 1 });
      }

      if (url.pathname === '/nominate' && req.method === 'POST') {
        const body = await req.json().catch(() => ({}));
        const author = String(body.author || '').trim().slice(0, 120);
        const quote = String(body.quote || '').trim().slice(0, 600);
        const note = String(body.note || '').trim().slice(0, 600);
        if (!author && !quote) return send({ error: 'need at least an author or a quote' }, 400);
        if (!(await verifyTurnstile(env, body.token, req))) return send({ error: 'verification failed' }, 403);

        const iphash = await ipHash(req, env);
        const since = new Date(Date.now() - 86400000).toISOString();
        const cnt = await env.DB.prepare('SELECT COUNT(*) AS n FROM nominations WHERE iphash=? AND created>?').bind(iphash, since).first();
        if (cnt && cnt.n >= MAX_NOMS_PER_DAY) return send({ error: 'daily nomination limit reached — thanks!' }, 429);

        await env.DB.prepare('INSERT INTO nominations (quote,author,note,status,created,iphash) VALUES (?,?,?,?,?,?)')
          .bind(quote, author, note, 'pending', new Date().toISOString(), iphash).run();
        return send({ ok: true });
      }

      if (url.pathname === '/nominations' && req.method === 'GET') {
        const token = url.searchParams.get('token') || '';
        if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return send({ error: 'unauthorized' }, 401);
        const status = url.searchParams.get('status') || 'pending';
        const { results } = await env.DB.prepare(
          'SELECT id,quote,author,note,status,created FROM nominations WHERE status=? ORDER BY created DESC LIMIT 200'
        ).bind(status).all();
        return send({ nominations: results });
      }

      return send({ error: 'not found' }, 404);
    } catch (e) {
      return send({ error: String((e && e.message) || e) }, 500);
    }
  },
};

async function verifyTurnstile(env, token, req) {
  if (!env.TURNSTILE_SECRET || !token) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', String(token));
  const ip = req.headers.get('CF-Connecting-IP');
  if (ip) form.append('remoteip', ip);
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const data = await r.json().catch(() => ({}));
  return !!data.success;
}

// One-way IP hash (salted, truncated) — we store a fingerprint for dedupe/limits, never the raw IP.
async function ipHash(req, env) {
  const ip = req.headers.get('CF-Connecting-IP') || '0.0.0.0';
  const salt = env.IP_SALT || 'quotle-fallback-salt';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + '|' + salt));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}
