# quotle-community — votes + nominations backend

The write path for the homepage **research bench**: `+1` to prioritise a queued quote, and
nominate new authors/quotes. quotle.info is static (GitHub Pages), so this small Cloudflare
Worker + D1 is the only stateful piece. The static page calls it cross-origin.

- **Storage:** D1 (SQLite) — `votes`, `vote_log` (dedupe), `nominations` (moderation queue).
- **Abuse control:** Cloudflare Turnstile on both POST routes + per-IP dedupe/limits (IPs are
  salted-hashed, never stored raw — matches the site's no-PII ethos).
- **Anti-fabrication guardrail:** nominations are **never auto-published**. They sit in the
  `nominations` table as `pending` until a human reviews and promotes them into the harvest
  backlog. Votes only reorder the research queue — they never change a verified page.

## Where it runs — a SEPARATE Cloudflare account

Deploy this to its **own Cloudflare account**, NOT the Mast/`runmast.com` account. A public,
internet-writable endpoint (votes + user nominations = an abuse magnet) must not share a blast
radius or billing surface with Mast's production tenant infrastructure. Cloudflare lets one
login own multiple accounts — create a fresh `quotle` account under your existing login. No
domain move is needed: the Worker runs at a `*.workers.dev` URL and the static site calls it
via CORS. quotle.info stays on GitHub Pages.

## One-time setup

```bash
cd worker
npm i -g wrangler          # or use `npx wrangler ...` below
wrangler login             # browser auth; PICK THE quotle ACCOUNT if prompted

# 1. Create the D1 database, then paste the printed database_id into wrangler.jsonc
wrangler d1 create quotle-community

# 2. Create the tables (remote = the live D1, not a local copy)
wrangler d1 execute quotle-community --remote --file schema.sql

# 3. Turnstile: dashboard → Turnstile → Add widget for quotle.info.
#    Copy the SITE KEY (public) and SECRET KEY (server-side).
wrangler secret put TURNSTILE_SECRET     # paste the Turnstile SECRET key
wrangler secret put ADMIN_TOKEN          # paste a random string (gates /nominations)
wrangler secret put IP_SALT              # paste a random string (salts the IP hash)

# 4. Deploy — note the printed https://quotle-community.<subdomain>.workers.dev URL
wrangler deploy
```

## Turn the feature on (frontend)

Both values below are **public** (the Turnstile *site* key is meant to ship in HTML). Put them in
`../data/harvest-config.json` (create it), then rebuild + deploy the site:

```json
{
  "votesApi": "https://quotle-community.<subdomain>.workers.dev",
  "turnstileSitekey": "0x4AAAAAAA................"
}
```

```bash
cd ..
node tools/build.js       # regenerates index.html with vote buttons + nominate form wired
git add data/harvest-config.json index.html who-said/index.html && git commit && git push
```

When `harvest-config.json` is absent or empty, `build-index.js` renders the bench in **display-only**
mode (the "coming soon" note) — so the site is never broken by a missing backend.

## Operate

**Review nominations (moderation queue):**
```bash
curl "https://quotle-community.<subdomain>.workers.dev/nominations?token=$ADMIN_TOKEN&status=pending"
# or straight from D1:
wrangler d1 execute quotle-community --remote \
  --command "SELECT id,author,quote,note,created FROM nominations WHERE status='pending' ORDER BY created DESC"
```
Approve a good one → add it to a harvest-output-shaped JSON and fold it into the backlog with
`node ../tools/harvest.js sync <file>`, then mark it done:
```bash
wrangler d1 execute quotle-community --remote --command "UPDATE nominations SET status='approved' WHERE id=<ID>"
```

**Pull vote tallies into the backlog** (so `harvest.js select` weights by community demand):
```bash
curl "https://quotle-community.<subdomain>.workers.dev/votes" > /tmp/votes.json
node ../tools/harvest.js votes /tmp/votes.json    # writes `votes` onto candidates + re-sorts
```

## Cost

Comfortably within Cloudflare's free tier (Workers 100k req/day; D1 5GB + 5M rows read/day free).
No paid plan needed for this traffic.


## Admin auth — headers, with a transition

`/sources`, `/nominations` and `/mail` accept the admin token **either** as
`Authorization: Bearer <token>` (preferred) or as `?token=` (legacy). `/triage` has always used the
header.

The query-string form put the credential into Cloudflare's logs on every call, because
`wrangler.jsonc` sets `observability: { enabled: true }`. That token guards every reporter's email
address and can trigger outbound mail, so it should not be in a URL.

**Deploy order matters, because this worker deploys by hand and not from CI.** The worker must accept
headers *before* any caller sends them — otherwise the nightly reports pass 401s, and `review.js`
degrades politely on a 401, which looks exactly like a quiet night with no reader reports.

1. Deploy this worker (accepts both). ← you are here once this is merged and deployed
2. Switch `tools/review.js` and `tools/verify-review-spine.js` to send the header.
3. Then, and only then, drop the `?token=` branch from `isAdmin()`.
