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
 *   POST /nominate    {author,quote?,note?,email?,token} → { ok }  (Turnstile + daily per-IP cap)
 *   GET  /nominations?token=&status=pending → { nominations } (ADMIN_TOKEN only)
 *   POST /submit-source {slug,url,stance,note?,email?,token} → { ok } (Turnstile + daily per-IP cap;
 *                       reader-submitted source EVIDENCE, never an edit — a URL to validate)
 *   GET  /sources?token=&status=pending → { sources }         (ADMIN_TOKEN only)
 *
 * `email` is OPTIONAL on both write paths and exists for exactly one purpose: telling the reader
 * what we found. The forms promise a single reply and no sharing, and /privacy/ says the same;
 * do not add a second use.
 *
 *   GET  /mail?token=&status=drafted → { mail, mode }        (ADMIN_TOKEN only — read the drafts)
 *
 * SENDING is gated behind the `EMAIL_MODE` var in wrangler.jsonc, which ships as "draft": replies
 * are composed and stored in email_sends, and nothing leaves the Worker. See replyToReport() for
 * the abuse model that shapes the message body — it is the reason none of the reader's own text
 * ever appears in it.
 *
 * RESEND_API_KEY is Mast's PLATFORM key (GCP project mast-platform-prod), which is restricted to
 * sending only — it cannot list or manage the account. That restriction is why it is acceptable
 * for it to live on a Worker whose other endpoints accept anonymous writes.
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

    // Public verify endpoints allow ANY origin (agents/apps); the community endpoints stay scoped.
    if (req.method === 'OPTIONS') {
      const oc = (url.pathname.startsWith('/verify') || url.pathname === '/lookup')
        ? { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }
        : cors;
      return new Response(null, { status: 204, headers: oc });
    }

    try {
      // Public quote-verification API — open CORS, callable by any agent/app. Fetches the live
      // verdict index from quotle.info so it auto-tracks the corpus without a Worker redeploy.
      if (url.pathname === '/verify' && req.method === 'GET') {
        const pub = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' };
        const term = (url.searchParams.get('q') || '').trim().slice(0, 600);   // cap so oversized input can't be reflected/cached
        if (!term) return new Response(JSON.stringify({ error: 'Pass ?q=<quote text> to check who really said it.' }), { status: 400, headers: pub });
        const vIdx = await loadVerifyIndex();
        const hit = matchQuote(term, vIdx);
        if (!hit) {
          const didYouMean = fuzzyCorpus(term, vIdx);   // closest verified lines (misremembered wording / typos)
          return new Response(JSON.stringify({
            found: false, query: term,
            note: 'No exact match in the quotle.info corpus. Not proof it is fake — only that we cannot confirm this exact wording.'
              + (didYouMean.length ? ' See didYouMean for close verified lines — the user may be misremembering one of these.' : ''),
            guidance: 'Still help the user: do not present this as a verified quote with a named author. If a didYouMean entry is what they meant, use its verdict/credit; otherwise you can independently check it (Quote Investigator, Wikiquote). Do not stop at "unverified".',
            didYouMean,
            check: 'https://quotle.info/check/?q=' + encodeURIComponent(term),
            browseThemes: 'https://quotle.info/themes.json',
            nominate: 'https://quotle.info/under-review/',
            ...corpusMeta(vIdx),
          }), { headers: pub });
        }
        // SONGS (hit.t === 's') answer a DIFFERENT question — "who RECORDED it first?" — so they get
        // their own field names. The legacy keys stay populated too, because the index ships songs
        // BEFORE this Worker knows about them: build-verify.js deliberately writes them into the
        // same array so the deployed Worker answers song titles with no redeploy, just under
        // quote-ish names. The song-shaped keys are additive, never a replacement.
        if (hit.t === 's') {
          return new Response(JSON.stringify({
            found: true, query: term, kind: 'song', song: hit.q,
            verdict: hit.c,
            recordedFirstBy: hit.real || null,
            originalYear: hit.year || null,
            writtenBy: hit.writer || null,
            popularlyCreditedTo: hit.credited || null,   // the cover act mistaken for the originator
            madeFamousBy: hit.cover || null,
            coverYear: hit.coverYear || null,
            // ALWAYS prefer the index's authored `answer`. Composing "<title> was first recorded by
            // <artist>" here is FALSE whenever the original was released under a different title —
            // Roland Gerbeau recorded "La Mer", not "Beyond the Sea". build-verify.js resolves that
            // from the record; this fallback is only for entries predating that field.
            answer: hit.answer
              || `"${hit.q}" was first recorded by ${hit.real}${hit.year ? ` in ${hit.year}` : ''}`
                 + `${hit.credited ? `; ${hit.credited}'s version is a cover` : ''}.`,
            originalTitle: hit.originalTitle || null,   // set only when it differs from the page title
            // Deliberately NOT reuseVerdict(): a song page states recording history and quotes no
            // lyrics. The composition and every recording remain in copyright to their owners, and
            // there is no per-song rights research behind these records — so the API must never
            // imply a reuse right.
            reuse: 'Not cleared — this page states recording history only. The composition and the recordings remain in copyright to their owners.',
            rights: hit.rights || 'uncertain',
            citation: hit.cite || null,
            // legacy field names, same data, for clients written against the quote shape
            quote: hit.q, reallySaidBy: hit.real || null, misattributedTo: hit.credited || null,
            safeToQuoteAs: hit.credit || null,
            url: hit.u, source: 'quotle.info', ...corpusMeta(vIdx),
          }), { headers: pub });
        }
        // WRITING-AXIS (hit.t === 'w') answers "who WROTE this song?" — distinct from both quotes
        // ("who said it") and songs ("who recorded it first"). The performer is correctly credited AS
        // the performer, so nobody is misattributed on a credit/contested page; only the `misbelief`
        // shape carries a false belief (the public thinks the performer wrote it).
        if (hit.t === 'w') {
          return new Response(JSON.stringify({
            found: true, query: term, kind: 'song-writing', song: hit.q,
            verdict: hit.c,
            writtenBy: hit.writtenBy || hit.real || null,
            performedBy: hit.performedBy || null,        // correctly credited AS the performer
            shape: hit.shape || null,                    // credit | misbelief | contested
            answer: hit.answer
              || `"${hit.q}" was written by ${hit.real}${hit.performedBy ? `; ${hit.performedBy}'s recording is the version most people know` : ''}.`,
            // A song page quotes no lyrics; the composition and recordings remain in copyright.
            reuse: 'Not cleared — this page states authorship and recording history only. The composition and the recordings remain in copyright to their owners.',
            rights: hit.rights || 'uncertain',
            citation: hit.cite || null,
            // legacy field names for clients written against the quote shape. reallySaidBy = the WRITER
            // (true). misattributedTo is set ONLY for `misbelief` (the performer wrongly thought to be
            // the writer); on credit/contested nobody is wrongly credited, so it stays null.
            quote: hit.q, reallySaidBy: hit.writtenBy || hit.real || null,
            misattributedTo: hit.shape === 'misbelief' ? (hit.performedBy || null) : null,
            safeToQuoteAs: hit.credit || null,
            url: hit.u, source: 'quotle.info', ...corpusMeta(vIdx),
          }), { headers: pub });
        }
        return new Response(JSON.stringify({
          found: true, query: term, quote: hit.q,
          verdict: hit.c,                          // verified | attributed | disputed
          reallySaidBy: hit.real || null,
          misattributedTo: hit.credited || null,
          safeToQuoteAs: hit.credit || (hit.real ? `— ${hit.real}` : null), // paste-ready CORRECT credit
          reuse: reuseVerdict(hit.rights),         // plain-English "can I put it on a slide?"
          rights: hit.rights || null,
          citation: hit.cite || null,              // full authored Chicago citation for a references slide
          // NOTE: image direction is intentionally NOT returned to agents. The usefulness test
          // showed handing a model our terse templated prompt made its image ideas WORSE than the
          // one it writes free-form. The grounded prompt still serves HUMANS on /check (which reads
          // verify-index.json.img directly). Agents should invent their own image; we add rights,
          // not image direction.
          url: hit.u, source: 'quotle.info', ...corpusMeta(vIdx),
        }), { headers: pub });
      }

      // Batch "verify my deck" — an agent POSTs every quote in a draft presentation and gets back a
      // per-quote verdict + correct credit + reuse status + paste-ready citation, plus a summary that
      // flags which quotes would embarrass (misattributed) or can't be confirmed. Read-only, open CORS.
      if (url.pathname === '/verify-batch' && req.method === 'POST') {
        const pub = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
        const body = await req.json().catch(() => null);
        const list = Array.isArray(body) ? body : (body && Array.isArray(body.quotes) ? body.quotes : null);
        if (!list) return new Response(JSON.stringify({ error: 'POST a JSON array of quotes, or { "quotes": [ ... ] }.' }), { status: 400, headers: pub });
        if (list.length > 100) return new Response(JSON.stringify({ error: 'Max 100 quotes per batch.' }), { status: 400, headers: pub });
        const idx = await loadVerifyIndex();
        const results = list.map((raw) => {
          const query = String(raw == null ? '' : (typeof raw === 'object' ? (raw.quote || raw.text || '') : raw)).trim().slice(0, 600);
          const hit = query ? matchQuote(query, idx) : null;
          if (!hit) return { query, found: false, note: 'Not in the verified corpus — cannot confirm. Do not present as a verified quote with a named author.' };
          return {
            query, found: true, verdict: hit.c, reallySaidBy: hit.real || null, misattributedTo: hit.credited || null,
            safeToQuoteAs: hit.credit || (hit.real ? `— ${hit.real}` : null), reuse: reuseVerdict(hit.rights),
            rights: hit.rights || null, citation: hit.cite || null, url: hit.u,
          };
        });
        const summary = {
          checked: results.length,
          verified: results.filter((r) => r.found && r.verdict === 'verified').length,
          attributed: results.filter((r) => r.found && r.verdict === 'attributed').length,
          misattributed: results.filter((r) => r.found && r.verdict === 'disputed').length,
          notFound: results.filter((r) => !r.found).length,
          inCopyright: results.filter((r) => r.rights === 'in-copyright').length,
          ...corpusMeta(idx),
        };
        summary.needsAttention = results
          .map((r, i) => ((r.found && r.verdict === 'disputed') || !r.found ? i : -1))
          .filter((i) => i >= 0);
        return new Response(JSON.stringify({ summary, results, source: 'quotle.info' }), { headers: pub });
      }

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
        const email = cleanEmail(body.email);
        if (!author && !quote) return send({ error: 'need at least an author or a quote' }, 400);
        if (!(await verifyTurnstile(env, body.token, req))) return send({ error: 'verification failed' }, 403);

        const iphash = await ipHash(req, env);
        const since = new Date(Date.now() - 86400000).toISOString();
        const cnt = await env.DB.prepare('SELECT COUNT(*) AS n FROM nominations WHERE iphash=? AND created>?').bind(iphash, since).first();
        if (cnt && cnt.n >= MAX_NOMS_PER_DAY) return send({ error: 'daily nomination limit reached — thanks!' }, 429);

        // DEDUPE BY QUOTE, AND ENRICH RATHER THAN DUPLICATE.
        //
        // /lookup auto-queues a BARE nomination when Wikiquote confirms a line literally — author
        // empty, note "wikiquote-auto". The reader's own submission then arrived here separately,
        // and with no dedupe that produced either a duplicate row or (once the client learned to
        // skip the POST) the silent LOSS of everything the reader wrote. A real submission —
        // "genuinely Beckett, from Worstward Ho, the estate is strict, truncating it inverts the
        // meaning" — was reduced to a machine stub indistinguishable from auto-queued fragments
        // like "leave the gun, take the".
        //
        // So: same normalised quote already pending → fill in whatever that row is missing and
        // return. Never two rows for one quote, and the human's context always wins over the
        // machine's placeholder.
        const nq = normQ(quote || '');
        if (nq) {
          const { results } = await env.DB.prepare("SELECT id,quote,author,note,email FROM nominations WHERE status='pending' ORDER BY created DESC LIMIT 500").all();
          const dupe = (results || []).find((r) => normQ(r.quote || '') === nq);
          if (dupe) {
            const better = (existing, incoming) => {
              const e = String(existing || '').trim();
              const i = String(incoming || '').trim();
              if (!i) return e;
              if (!e || /^wikiquote-auto/.test(e)) return i;      // machine placeholder loses
              return e.includes(i) ? e : `${e} | ${i}`;           // otherwise keep both
            };
            // email does NOT go through better() — that concatenates with ' | ', which would make
            // the column hold two addresses and turn one reply into a mailing list. First address
            // on the row wins; a later submitter's is discarded. One report, one reply, one person.
            const keepEmail = String(dupe.email || '').trim() || email;
            await env.DB.prepare('UPDATE nominations SET author=?, note=?, email=? WHERE id=?')
              .bind(better(dupe.author, author), better(dupe.note, note), keepEmail, dupe.id).run();
            return send({ ok: true, merged: true });
          }
        }
        await env.DB.prepare('INSERT INTO nominations (quote,author,note,email,status,created,iphash) VALUES (?,?,?,?,?,?,?)')
          .bind(quote, author, note, email, 'pending', new Date().toISOString(), iphash).run();
        return send({ ok: true });
      }

      if (url.pathname === '/nominations' && req.method === 'GET') {
        const token = url.searchParams.get('token') || '';
        if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return send({ error: 'unauthorized' }, 401);
        const status = url.searchParams.get('status') || 'pending';
        const { results } = await env.DB.prepare(
          'SELECT id,quote,author,note,email,status,created FROM nominations WHERE status=? ORDER BY created DESC LIMIT 200'
        ).bind(status).all();
        return send({ nominations: results });
      }

      // Reader-submitted SOURCE EVIDENCE for a quote page: a URL that supports or refutes what the
      // page says. This is NOT an edit — it only enqueues a link for a human to validate, exactly
      // like /nominate. Same anti-abuse gate (Turnstile + per-IP daily cap). Nothing here ever
      // changes a live page; a human reviews via /sources and, if it holds up, updates the record
      // through the normal build.
      if (url.pathname === '/submit-source' && req.method === 'POST') {
        const body = await req.json().catch(() => ({}));
        const slug = String(body.slug || '').trim().slice(0, 120);
        // Slug format, deliberately NOT the /vote pattern. Song pages submit `song:<songSlug>`
        // (build-songs.js), so a bare [a-z0-9-] regex would 400 every report from ~97 live song
        // pages — caught in review before it shipped. '' is explicitly allowed: /report/ sends it
        // when the reader typed the line instead of pasting a link. That is a real report, routed
        // to the unresolvable bucket downstream, not a malformed one to reject here.
        if (slug && !/^(song:)?[a-z0-9-]{3,80}$/.test(slug)) return send({ error: 'bad slug' }, 400);
        let submittedUrl = String(body.url || '').trim().slice(0, 500);
        const stance = body.stance === 'refutes' ? 'refutes' : 'supports';
        const note = String(body.note || '').trim().slice(0, 600);
        const email = cleanEmail(body.email);
        // `supports` is the one reason that is NOT a complaint — it keeps the older "I have a source
        // that backs this up" capability alive inside the single control, instead of a second form.
        // It is also the only value that makes stance meaningful; everything else is a refutation.
        const REASONS = ['wrong-person', 'wrong-wording', 'rights', 'dead-link', 'supports', 'other'];
        const reason = REASONS.includes(body.reason) ? body.reason : '';
        // A URL is NO LONGER REQUIRED — a reason is an acceptable report on its own.
        //
        // This endpoint used to reject anything without a source ("that is the whole point of the
        // submission"). In practice that rejected the most common thing a reader actually has:
        // "Napoleon didn't say this" — confident, frequently right, and not about to go hunt a
        // citation. Those readers hit a wall, and the only other route was a nomination form built
        // for quotes we are MISSING, which is a different intent entirely.
        //
        // So: url OR reason. When a url IS supplied it must still be a real absolute http(s) one —
        // a malformed link is worse than none, because it looks like evidence. When absent we store
        // '' (the column is NOT NULL; rebuilding the table is not worth it), so "this report carries
        // evidence" is `url <> ''`, never `url IS NOT NULL`.
        if (submittedUrl) {
          let parsed;
          try { parsed = new URL(submittedUrl); } catch (_) { parsed = null; }
          if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
            return send({ error: 'That does not look like a valid link. Leave it blank if you do not have one.' }, 400);
          }
          submittedUrl = parsed.href;
        }
        if (!submittedUrl && !reason) return send({ error: 'Tell us what is wrong, or add a source link.' }, 400);
        if (!(await verifyTurnstile(env, body.token, req))) return send({ error: 'verification failed' }, 403);

        const iphash = await ipHash(req, env);
        const since = new Date(Date.now() - 86400000).toISOString();
        const cnt = await env.DB.prepare('SELECT COUNT(*) AS n FROM source_submissions WHERE iphash=? AND created>?').bind(iphash, since).first();
        if (cnt && cnt.n >= MAX_NOMS_PER_DAY) return send({ error: 'daily submission limit reached — thank you!' }, 429);

        await env.DB.prepare('INSERT INTO source_submissions (slug,url,stance,reason,note,email,status,created,iphash) VALUES (?,?,?,?,?,?,?,?,?)')
          .bind(slug, submittedUrl, stance, reason, note, email, 'pending', new Date().toISOString(), iphash).run();
        return send({ ok: true });
      }

      // Admin review queue for submitted source evidence (mirrors /nominations).
      // POST /triage — the write that was missing entirely. Without it nothing could ever close a
      // report: /sources?status=pending never drained, so review.js re-scored the same slugs at
      // +2000/+4000 on every run forever, and the staleness lane starved behind them.
      //
      // It sets `status`, not a side column. An earlier draft wrote triage/triaged_at only — which
      // leaves status='pending', so the row keeps coming back and the job is non-idempotent by
      // construction. The UPDATE is guarded on status='pending', so a second run changes 0 rows and
      // does not re-stamp the timestamp.
      if (url.pathname === '/triage' && req.method === 'POST') {
        const auth = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
        if (!env.ADMIN_TOKEN || !safeEq(auth, env.ADMIN_TOKEN)) return send({ error: 'unauthorized' }, 401);
        const body = await req.json().catch(() => ({}));
        const id = parseInt(body.id, 10);
        const VERDICTS = ['accepted', 'rejected', 'unresolvable'];
        const verdict = VERDICTS.includes(body.verdict) ? body.verdict : '';
        const note = String(body.note || '').trim().slice(0, 600);
        if (!Number.isFinite(id) || !verdict) return send({ error: 'need {id, verdict: accepted|rejected|unresolvable}' }, 400);
        // 'unresolvable' is a real outcome, not a failure: a report whose slug was renamed, deleted
        // or never given joins to no record. Without a drain it becomes a second silent queue —
        // which is the exact bug this endpoint exists to stop.
        const status = verdict === 'accepted' ? 'accepted' : 'rejected';
        // Read the row BEFORE closing it — the reply needs its address and slug, and after the
        // UPDATE we can no longer tell whether this call was the one that closed it.
        const row = await env.DB.prepare('SELECT id,slug,email FROM source_submissions WHERE id=?').bind(id).first();
        const res = await env.DB.prepare(
          "UPDATE source_submissions SET status=?, triage=?, triaged_at=? WHERE id=? AND status='pending'"
        ).bind(status, verdict + (note ? ' | ' + note : ''), new Date().toISOString(), id).run();
        const changed = (res && res.meta && res.meta.changes) || 0;
        // Reply ONLY on the call that actually closed the report. Gating on `changed` means a
        // second /triage is a no-op for the mail too, not just for the row — the idempotency
        // guard and the one-reply guarantee are then the same guarantee rather than two that
        // have to agree with each other.
        let reply = 'skipped';
        if (changed && row) {
          try { reply = await replyToReport(env, row, verdict); }
          catch (e) { reply = 'error'; console.log('reply failed for ' + id + ': ' + ((e && e.message) || e)); }
        }
        return send({ ok: true, changed, alreadyClosed: changed === 0, reply });
      }

      // The drafts an operator has to READ for draft mode to mean anything. A gate that composes
      // replies nobody ever looks at is not a trust ladder, it is a spam generator with a delay.
      // Returns the full body deliberately: judging the copy is the entire exercise.
      if (url.pathname === '/mail' && req.method === 'GET') {
        const token = url.searchParams.get('token') || '';
        if (!env.ADMIN_TOKEN || !safeEq(token, env.ADMIN_TOKEN)) return send({ error: 'unauthorized' }, 401);
        const status = url.searchParams.get('status') || 'drafted';
        const { results } = await env.DB.prepare(
          'SELECT idempotency_key,kind,ref_id,to_email,subject,body,mode,status,resend_id,error,created,sent_at FROM email_sends WHERE status=? ORDER BY created DESC LIMIT 100'
        ).bind(status).all();
        return send({ mail: results, mode: env.EMAIL_MODE === 'send' ? 'send' : 'draft' });
      }

      if (url.pathname === '/sources' && req.method === 'GET') {
        const token = url.searchParams.get('token') || '';
        if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return send({ error: 'unauthorized' }, 401);
        const status = url.searchParams.get('status') || 'pending';
        const { results } = await env.DB.prepare(
          'SELECT id,slug,url,stance,reason,note,email,status,created FROM source_submissions WHERE status=? ORDER BY created DESC LIMIT 200'
        ).bind(status).all();
        return send({ sources: results });
      }

      // /check "is this real?" escalation. The /check page matches the corpus in the browser; on a
      // MISS it calls this to walk the rest of the ladder the user can't reach client-side:
      //   corpus (safety net) → our harvest backlog → an existing pending nomination → Wikiquote.
      // If Wikiquote genuinely carries the line (STRICT, server-verified — the anti-abuse gate), we
      // add it as a PENDING nomination (never straight into the backlog — the moderation guardrail
      // above still holds; a human promotes it) and tell the client so it can offer the Wikiquote
      // page. Read-mostly; open CORS. The one write is a heavily-gated nomination.
      if (url.pathname === '/lookup' && req.method === 'GET') {
        const pub = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
        const term = (url.searchParams.get('q') || '').trim().slice(0, 600);
        if (term.length < 12) return new Response(JSON.stringify({ stage: 'short' }), { headers: pub });
        const nq = normQ(term);

        // 1. Corpus — safety net; the page already checked client-side, but re-check in case its
        //    index was stale. A hit means "go read the page we already have."
        const lIdx = await loadVerifyIndex();
        const hit = matchQuote(term, lIdx);
        if (hit) return new Response(JSON.stringify({ stage: 'corpus', verdict: hit.c, url: hit.u }), { headers: pub });

        // 2. Already on our harvest list (queued/selected, awaiting a wave).
        const backlog = await loadBacklogIndex();
        const nqKey = nq.length > 28 ? nq.slice(0, 28) : nq;
        if (backlog.some((b) => b === nq || (nqKey.length > 20 && (b.includes(nqKey) || nq.includes(b.slice(0, 28)))))) {
          return new Response(JSON.stringify({ stage: 'backlog' }), { headers: pub });
        }

        // 3. Already nominated by someone (pending moderation) — don't double-add.
        try {
          const { results } = await env.DB.prepare("SELECT quote FROM nominations WHERE status='pending' ORDER BY created DESC LIMIT 500").all();
          if ((results || []).some((r) => normQ(r.quote || '') === nq)) {
            return new Response(JSON.stringify({ stage: 'nominated' }), { headers: pub });
          }
        } catch (_) { /* DB hiccup → fall through, worst case a dup nomination the moderator drops */ }

        // 4. Wikiquote — server-side STRICT check (the pasted wording must literally appear). Optional
        //    author/source hints turn the flaky full-text search into a TARGETED page scan (fetch the
        //    named author/work page directly) — the fix for misremembered lines search can't find.
        const author = (url.searchParams.get('author') || '').trim().slice(0, 120);
        const source = (url.searchParams.get('source') || '').trim().slice(0, 120);
        const wq = await wikiquoteLookup(term, { author, source });
        if (wq.found) {
          let added = false;
          try {
            const iphash = await ipHash(req, env);
            const since = new Date(Date.now() - 86400000).toISOString();
            const cnt = await env.DB.prepare('SELECT COUNT(*) AS n FROM nominations WHERE iphash=? AND created>?').bind(iphash, since).first();
            if (!cnt || cnt.n < MAX_NOMS_PER_DAY) {
              await env.DB.prepare('INSERT INTO nominations (quote,author,note,status,created,iphash) VALUES (?,?,?,?,?,?)')
                .bind(term.slice(0, 600), author, 'wikiquote-auto · found on ' + String(wq.title).slice(0, 200), 'pending', new Date().toISOString(), iphash).run();
              added = true;
            }
          } catch (_) { /* rate/DB error → still show the Wikiquote result, just not "added" */ }
          return new Response(JSON.stringify({ stage: 'wikiquote', added, wikiquoteUrl: wq.url, title: wq.title }), { headers: pub });
        }
        // 4b. Hinted page had no literal match but a CLOSE line — offer it for the user to confirm
        //     (the pasted wording is likely misremembered). We don't auto-add a mangled line.
        if (wq.fuzzy) {
          return new Response(JSON.stringify({ stage: 'wikiquote-fuzzy', wikiquoteUrl: wq.fuzzy.url, title: wq.fuzzy.title, suggestion: wq.fuzzy.suggestion }), { headers: pub });
        }

        // 5. Nowhere we can confirm — but if it's a misremembered wording of a line we DO hold, surface it.
        const near = fuzzyCorpus(term, lIdx);
        if (near.length) return new Response(JSON.stringify({ stage: 'corpus-fuzzy', candidates: near }), { headers: pub });
        return new Response(JSON.stringify({ stage: 'none', wikiquoteSearch: 'https://en.wikiquote.org/w/index.php?search=' + encodeURIComponent(term) }), { headers: pub });
      }

      return send({ error: 'not found' }, 404);
    } catch (e) {
      return send({ error: String((e && e.message) || e) }, 500);
    }
  },
};

// Constant-time string compare for admin tokens. `a === b` leaks length and position through
// timing; cheap to avoid, and /triage is a mutating endpoint.
function safeEq(a, b) {
  const x = String(a || ''), y = String(b || '');
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}

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

// ---- /verify: verdict index (fetched from the live site, cached in-isolate + at the edge) ----
let _idxCache = null, _idxTs = 0, _idxLastMod = null;
async function loadVerifyIndex() {
  const now = Date.now();
  if (_idxCache && (now - _idxTs) < 300000) return _idxCache;
  try {
    // STABLE url — a per-minute cache-bust param used to be appended here, which minted a fresh
    // edge cache key every 60s and meant this 1.5MB index was pulled from the GitHub Pages origin
    // over and over (measured 2026-07-27). cacheTtlByStatus keeps the reason the bust existed —
    // a transient 404/5xx still can't stick in the edge cache — without defeating the cache itself.
    const r = await fetch('https://quotle.info/verify-index.json', {
      cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': 300, '404': 0, '500-599': 0 } },
    });
    if (!r.ok) throw new Error('index ' + r.status);
    const data = await r.json();
    if (Array.isArray(data)) { _idxCache = data; _idxTs = now; _idxLastMod = r.headers.get('last-modified') || _idxLastMod; }
  } catch (_) { /* index not reachable yet — degrade to found:false */ }
  return _idxCache || [];
}
// Freshness/size metadata for machine consumers to gate/cache on — derived free from the index fetch.
function corpusMeta(idx) { return { corpusSize: (idx && idx.length) || 0, dataUpdated: _idxLastMod || null }; }
// Optional contact address. Format-checked and length-capped, never required, and an unusable
// value is DROPPED rather than 400'd — a typo'd address must not cost the reader their report,
// which is the actual content we want. The check is deliberately loose (one @, a dot in the host,
// no whitespace): stricter regexes reject valid addresses, and we are not authenticating anyone.
function cleanEmail(v) {
  const e = String(v || '').trim().slice(0, 200);
  if (!e) return '';
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(e) ? e : '';
}

// ---- THE REPLY PATH ----------------------------------------------------------------
// Storage-and-surfacing shipped first; this is the send half, and it is deliberately timid.
//
// THE ABUSE MODEL, because it drives every rule below: the email field is optional and
// unauthenticated, so anyone can submit a report carrying SOMEONE ELSE'S address. If our reply
// echoed what they typed, we would be a free, reputable-looking delivery service for arbitrary
// text to arbitrary strangers. That is the whole attack, and it is closed by composing the body
// ENTIRELY from our own facts:
//   · the verdict — ours, chosen by an operator through the ADMIN-gated /triage
//   · the page URL — included ONLY when the slug resolves in our own published verify index
//   · nothing else. No note, no quote, no URL they submitted, not even their address in the body.
// Plus ONE reply per report ever (the email_sends primary key), and the per-IP daily cap already
// limits how many reports one person can file.
//
// Text-only, no HTML. Nothing to escape, nothing to break out of, and a plain message from a small
// site reads as more honest than a templated one.
const REPLY_SUBJECT = 'About the quote correction you sent us';

// The slug is SUBMITTER-CONTROLLED (both forms POST it; /report/ derives it from a pasted link),
// and the worker's format check permits 80 characters of kebab-case — which is enough room to
// smuggle a short message into an otherwise trustworthy email. So a slug is only ever named after
// it is found in the PUBLISHED index: if the page exists, the URL is our fact, not their text.
async function slugIsReal(slug) {
  if (!slug) return false;
  const bare = String(slug).replace(/^song:/, '');
  const idx = await loadVerifyIndex();
  return (idx || []).some((r) => r && r.slug === bare);
}

function composeReply(verdict, pageUrl) {
  // 'unresolvable' NEVER names a page, even when the slug happens to resolve — an operator can
  // mark a report unresolvable for reasons other than a missing slug, and "we could not work out
  // which page this was about" immediately followed by "The page: …" is a message that argues
  // with itself. Caught by printing all three verdicts and reading them, not by review.
  const where = (pageUrl && verdict !== 'unresolvable') ? `\n\nThe page: ${pageUrl}\n` : '\n';
  const body = {
    accepted: `Thank you for the correction you sent us about a quote on quotle.info.\n\nYou were right, and we have updated the page.${where}\nCorrections from readers are the main way errors here get found, so we are grateful for it.`,
    rejected: `Thank you for the correction you sent us about a quote on quotle.info.\n\nWe traced it back through the sources and decided to leave the page as it stands.${where}\nThat is not a judgement on your report — it just means the evidence we could find still supports what the page says. If you have a primary source that shows otherwise, we would genuinely like to see it.`,
    unresolvable: `Thank you for the correction you sent us about quotle.info.\n\nWe could not work out which page it referred to, so we have not been able to act on it.\n\nIf you still have it to hand, sending the link to the page would let us pick it up.`,
  }[verdict] || null;
  if (!body) return null;
  // The single-reply promise, stated in the message itself — the same promise the form makes.
  return `${body}\n\nThis is the only email we will send about this report. You can reply to this message if you want to add anything.\n\n— Quotle.info\nhttps://quotle.info/`;
}

async function sendViaResend(env, to, subject, text) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // runmast.com, NOT runmast.email. The plan specified the latter, derived from the OUTREACH
      // Resend account; the account this key belongs to has runmast.com verified and rejects
      // runmast.email with a 403. Verified by an actual send on 2026-07-29.
      from: 'Quotle.info <quotle@runmast.com>',
      reply_to: 'help@quotle.info',
      to: [to],
      subject,
      text,
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d || !d.id) throw new Error((d && d.message) || `resend ${r.status}`);
  return d.id;
}

// Called after a report is triaged. Returns a short status for the /triage response so the
// operator sees what happened without a second query.
async function replyToReport(env, row, verdict) {
  const to = cleanEmail(row && row.email);
  if (!to) return 'no-address';
  const text = composeReply(verdict, (await slugIsReal(row.slug)) ? `https://quotle.info/who-said/${String(row.slug).replace(/^song:/, '')}/` : '');
  if (!text) return 'no-template';
  const key = `source:${row.id}`;
  const now = new Date().toISOString();
  const mode = env.EMAIL_MODE === 'send' ? 'send' : 'draft';
  // THE ONE-REPLY GUARANTEE. INSERT OR IGNORE against a PRIMARY KEY is atomic — two concurrent
  // triages of the same report cannot both win it. A `SELECT then INSERT` could.
  const ins = await env.DB.prepare(
    'INSERT OR IGNORE INTO email_sends (idempotency_key,kind,ref_id,to_email,subject,body,mode,status,created) VALUES (?,?,?,?,?,?,?,?,?)'
  ).bind(key, 'source', row.id, to, REPLY_SUBJECT, text, mode, mode === 'send' ? 'sending' : 'drafted', now).run();
  if (!((ins && ins.meta && ins.meta.changes) || 0)) return 'already-replied';
  if (mode !== 'send') return 'drafted';
  try {
    const id = await sendViaResend(env, to, REPLY_SUBJECT, text);
    await env.DB.prepare("UPDATE email_sends SET status='sent', resend_id=?, sent_at=? WHERE idempotency_key=?").bind(id, new Date().toISOString(), key).run();
    return 'sent';
  } catch (e) {
    // The row STAYS, marked failed. It is not deleted and not retried: a retry loop against a
    // stranger's inbox is exactly the amplification this design is avoiding, and a failure here
    // is something an operator should look at rather than something the system should keep
    // attempting. The report itself is already triaged either way.
    await env.DB.prepare("UPDATE email_sends SET status='failed', error=? WHERE idempotency_key=?").bind(String((e && e.message) || e).slice(0, 300), key).run();
    return 'failed';
  }
}

const normQ = (s) => String(s).toLowerCase().replace(/[’'‘`"“”]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

// ---- /lookup: compact "already on our list" index (queued/selected harvest candidates) ----
let _blCache = null, _blTs = 0;
async function loadBacklogIndex() {
  const now = Date.now();
  if (_blCache && (now - _blTs) < 300000) return _blCache;
  try {
    const r = await fetch('https://quotle.info/backlog-index.json?_=' + Math.floor(now / 60000), { cf: { cacheTtl: 60 } });
    if (r.ok) { const d = await r.json(); if (Array.isArray(d)) { _blCache = d; _blTs = now; } }
  } catch (_) { /* not reachable → degrade to empty */ }
  return _blCache || [];
}

// ---- /lookup: STRICT server-side Wikiquote check ----
// The anti-abuse gate for auto-nomination. Search Wikiquote for the phrase, then RE-FETCH each top
// page as raw wikitext (?action=raw — MediaWiki's own API summarizes/omits the quote list, so raw is
// the only faithful source, exactly the trap the film-harvest hit) and require a substantial
// contiguous chunk of the pasted wording to LITERALLY appear. Fuzzy search hits alone don't count —
// that would let paraphrases and near-misses flood the moderation queue.
const WQ_UA = { 'User-Agent': 'quotle.info-lookup/1.0 (+https://quotle.info; stewartd@runmast.com)' };
// Skip pages that carry quotes but aren't the SOURCE: date/QOTD calendar pages ("May 21"), namespaces
// ("Wikiquote:", "Talk:"), and list pages. Without this, "May the Force be with you" matched a
// "May 21" quote-of-the-day page and we'd have sent the user there. Tested against live Wikiquote.
const WQ_CAL = /^(January|February|March|April|May|June|July|August|September|October|November|December|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/;
const wqSkip = (t) => t.includes(':') || /^List of/i.test(t) || WQ_CAL.test(t) || /^\d/.test(t);
async function wqTitles(srsearch) {
  const url = 'https://en.wikiquote.org/w/api.php?action=query&list=search&format=json&srlimit=8&srprop=&srsearch='
    + encodeURIComponent(srsearch);
  const r = await fetch(url, { headers: WQ_UA, cf: { cacheTtl: 300 } });
  const d = await r.json().catch(() => ({}));
  return ((d.query && d.query.search) || []).map((p) => p.title);
}
// Character-bigram Dice similarity — used to find the closest real line on a hinted page when the
// pasted wording is misremembered (so search + literal-substring both miss).
function wqBigrams(s) { const a = []; for (let i = 0; i < s.length - 1; i++) a.push(s.slice(i, i + 2)); return a; }
function wqDice(qg, s) {
  const bg = wqBigrams(s); if (!qg.length || !bg.length) return 0;
  const m = new Map(); for (const g of qg) m.set(g, (m.get(g) || 0) + 1);
  let inter = 0; for (const g of bg) { const c = m.get(g) || 0; if (c > 0) { inter++; m.set(g, c - 1); } }
  return 2 * inter / (qg.length + bg.length);
}
// Pull quote-shaped lines (top-level bullets) out of raw wikitext, stripped of markup.
function wqCleanLine(line) {
  return line
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '').replace(/<ref[^>]*\/>/gi, '').replace(/<[^>]+>/g, '')
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1').replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\{\{[^{}]*\}\}/g, '').replace(/'''?/g, '').replace(/^\**\s*/, '')
    .replace(/\s+/g, ' ').trim();
}
// A bullet plus its individual sentences — so a short canonical line ("I love the smell of napalm in the
// morning.") embedded in a long monologue bullet can still be suggested on its own.
function wqSentences(line) {
  const out = [line];
  const parts = line.split(/(?<=[.!?])\s+/);
  if (parts.length > 1) for (const p of parts) { const s = p.trim(); if (s.length >= 15 && s.length <= 240) out.push(s); }
  return out;
}
function wqExtractLines(raw) {
  const out = [];
  for (const ln of raw.split('\n')) {
    if (!/^\*+\s*[^*]/.test(ln)) continue;             // top-level bullet = a quote line
    const c = wqCleanLine(ln);
    if (c.length >= 15 && c.length <= 600) for (const s of wqSentences(c)) out.push(s);
    if (out.length >= 800) break;
  }
  return out;
}
async function wikiquoteLookup(term, hints) {
  hints = hints || {};
  const nq = normQ(term);
  if (nq.length < 12) return { found: false };
  const chunk = nq.length > 40 ? nq.slice(0, 40) : nq;           // distinctive opening run
  const chunk2 = nq.length > 70 ? nq.slice(25, 65) : '';         // a second run for longer lines
  const clean = term.replace(/["“”]/g, '').slice(0, 200);
  const qg = wqBigrams(nq);
  let best = null;                                                // {title, url, suggestion, score}
  try {
    // Author/source hints → fetch the NAMED page directly (targeted lookup beats a full-text search that
    // misremembered lines defeat). Then the QUOTED-phrase search surfaces the source page, and the unquoted
    // pass is the recall fallback. The STRICT gate stays the raw-wikitext substring check, so extra titles
    // only add recall — junk still fails the gate and is never auto-added.
    const hintTitles = [];
    if (hints.source) { const s = hints.source; hintTitles.push(s, s + ' (film)', s + ' (novel)', s + ' (play)'); }
    if (hints.author) hintTitles.push(hints.author);
    let searchTitles = [];
    try { searchTitles = searchTitles.concat(await wqTitles('"' + clean + '"')); } catch (_) { /* one search failing is fine */ }
    try { searchTitles = searchTitles.concat(await wqTitles(clean)); } catch (_) { /* ditto */ }
    const seen = new Set();
    const hinted = new Set(hintTitles);
    const titles = [...hintTitles, ...searchTitles].filter((t) => t && !wqSkip(t) && !seen.has(t) && seen.add(t)).slice(0, 8);
    for (const title of titles) {
      const page = encodeURIComponent(String(title).replace(/ /g, '_'));
      // ?action=raw = the faithful wikitext (the API extract summarizes and drops the quote list).
      const raw = await fetch('https://en.wikiquote.org/wiki/' + page + '?action=raw', { headers: WQ_UA, cf: { cacheTtl: 300 } });
      if (!raw.ok) continue;
      const body = await raw.text();
      if (normQ(body).includes(chunk) || (chunk2 && normQ(body).includes(chunk2))) {
        return { found: true, title, url: 'https://en.wikiquote.org/wiki/' + page };
      }
      // No literal hit: if the user NAMED this page, find its closest line to suggest (misremembered wording).
      if (hinted.has(title)) {
        for (const line of wqExtractLines(body)) {
          const ns = normQ(line); if (ns.length < 12) continue;
          const sc = wqDice(qg, ns);   // symmetric: rewards a close-LENGTH line, so junk + a long bullet won't match
          if (sc >= 0.5 && (!best || sc > best.score)) best = { title, url: 'https://en.wikiquote.org/wiki/' + page, suggestion: line.slice(0, 240), score: sc };
        }
      }
    }
  } catch (_) { /* Wikiquote unreachable → treat as not found (never a false "added") */ }
  if (best) return { found: false, fuzzy: best };
  return { found: false };
}
// plain-English "can I put this on a slide?" from the rights state
function reuseVerdict(rights) {
  if (rights === 'public-domain') return 'Free to reuse, including in commercial and paid presentations. No permission needed.';
  if (rights === 'in-copyright') return 'Still under copyright. A short, credited quote is usually fine for talks and internal decks; get permission for commercial or published use.';
  if (rights === 'licensed') return 'Cleared for reuse under licence — keep the credit.';
  return 'Copyright status unconfirmed — we could not establish whether this is public domain or still under copyright. A short, credited quote is usually fine for talks; clear the rights before commercial or published use.';
}
function matchQuote(term, idx) {
  const t = normQ(term);
  if (!t || !Array.isArray(idx)) return null;
  const exact = idx.find((e) => e.n === t);
  if (exact) return exact;
  // substring either direction (handles a partial quote or extra words). GUARDED by length so a trivial
  // query ("a", "1", "hi") can't substring-hit a long entry and get returned as a confident "verified"
  // quote: the entry-contains-query direction needs a distinctive query (>=12 chars), and the
  // query-contains-entry direction needs the matched entry to be a real, non-trivial quote (>=12 chars).
  const sub = idx.filter((e) => e.n && (
    (t.length >= 12 && e.n.includes(t)) ||
    (e.n.length >= 12 && t.includes(e.n))
  ));
  if (sub.length) { sub.sort((a, b) => Math.abs(a.n.length - t.length) - Math.abs(b.n.length - t.length)); return sub[0]; }
  // query-coverage fallback: how many of the QUERY's significant words appear in the entry
  // (handles partial quotes / paraphrases of long lines). Tie-break toward the closest length.
  const tw = t.split(' ').filter((w) => w.length > 3);
  if (tw.length >= 3) {
    const twset = new Set(tw);
    const tWords = t.split(' ');
    let best = null, bestCov = 0, bestGap = Infinity;
    for (const e of idx) {
      const eWords = (e.n || '').split(' ');
      const ewset = new Set(eWords);
      let hits = 0; twset.forEach((w) => { if (ewset.has(w)) hits++; });
      const cov = hits / twset.size;
      if (cov < 0.8) continue;
      // ADJACENCY GUARD. Long entries act as "word sponges": a short query whose ordinary words happen
      // to appear SCATTERED through a 100-word passage hits 0.8 coverage and used to return a confident,
      // wrong verdict — "There is no great achievement without suffering" resolved to Roosevelt's
      // Man-in-the-Arena because there/great/achievement/without each appear somewhere in it. A genuine
      // partial quote shares a CONTIGUOUS run of words; a coincidence only shares scattered singletons.
      if (longestWordRun(tWords, eWords) < 4) continue;
      const gap = Math.abs((e.n || '').length - t.length);
      if (cov > bestCov || (cov === bestCov && gap < bestGap)) { bestCov = cov; bestGap = gap; best = e; }
    }
    if (best) return best;
  }
  return null;
}
// Longest run of CONSECUTIVE shared words between two word arrays (LCSubstring over words).
function longestWordRun(a, b) {
  if (!a.length || !b.length) return 0;
  let best = 0;
  const row = new Array(b.length + 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    let diag = 0;
    for (let j = 0; j < b.length; j++) {
      const tmp = row[j + 1];
      row[j + 1] = a[i] === b[j] ? diag + 1 : 0;
      if (row[j + 1] > best) best = row[j + 1];
      diag = tmp;
    }
  }
  return best;
}
// Forgiving "did you mean?" over the corpus — the SAME bigram-Dice match the /check UI runs client-side,
// exposed on the API path so a miss returns closest verified lines instead of dead-ending. Returns [] for
// junk (top < 0.5) and for anything with a clean exact/substring hit (callers use matchQuote first).
function fuzzyCorpus(term, idx) {
  const t = normQ(term);
  if (t.length < 8 || !Array.isArray(idx)) return [];
  const qg = wqBigrams(t);
  // Two-part gate. Char-bigram Dice alone is too permissive: any two same-length English sentences
  // share ~0.5 of their bigrams (common letters/word-endings), so unrelated lines slip through and we
  // surface junk "did you mean?" instead of routing the miss to Wikiquote. Require BOTH a high Dice
  // (real typo/misremember ≈ 0.9+) AND real shared content-words (>3 chars) — junk scores ~0.5 Dice but
  // only ~0.2 word-overlap, a genuine misremember ~0.8. Empty result → caller falls through to Wikiquote.
  const qw = new Set(t.split(' ').filter((w) => w.length > 3));
  const scored = [];
  for (const e of idx) {
    if (!e.n) continue;
    const s = wqDice(qg, e.n);
    if (s < 0.6) continue;
    const ew = new Set(e.n.split(' '));
    let hits = 0; qw.forEach((w) => { if (ew.has(w)) hits++; });
    if (!qw.size || hits / qw.size < 0.4) continue;
    scored.push({ e, s });
  }
  scored.sort((a, b) => b.s - a.s);
  if (!scored.length) return [];
  const top = scored[0].s, out = [], seen = new Set();
  for (const c of scored) {
    if (out.length >= 3 || c.s < top - 0.12) break;
    if (seen.has(c.e.u)) continue; seen.add(c.e.u);
    out.push({ quote: c.e.q, verdict: c.e.c, reallySaidBy: c.e.real || null, misattributedTo: c.e.credited || null, url: c.e.u });
  }
  return out;
}

// One-way IP hash (salted, truncated) — we store a fingerprint for dedupe/limits, never the raw IP.
async function ipHash(req, env) {
  const ip = req.headers.get('CF-Connecting-IP') || '0.0.0.0';
  const salt = env.IP_SALT || 'quotle-fallback-salt';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + '|' + salt));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}
