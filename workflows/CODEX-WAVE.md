# Quote waves with Codex agents

David authorized this route on 9 November 2026: “update the process to use the available agents and run the wave of 100”. It replaces the unavailable legacy `Workflow` launcher for quote waves. The seven stages and editorial gates in README.md still apply. This is an execution adapter, not permission to lower research standards, skip audits, or publish a short wave.

## Runtime and isolation

The coordinating agent uses the host's `collaboration.spawn_agent` and follow-up tools. No API key, paid API runner, headless Claude process, or external workflow service is needed. Use the current frontier model at high reasoning effort; retain the parent model when the host does not expose a stronger one. This process explicitly authorizes parallel helper agents for research, independent audit and tagging. Stay within the host's concurrency limit, using bounded groups with a durable result for every quote. One agent can research several quotes sequentially; batching is scheduling, never permission to infer one quote from another.

Use a dedicated worktree for the content wave. Process/tool changes belong on a separate branch/PR, merged before the wave. Pass absolute repo paths to all agents. Researchers and auditors write only their assigned files under `/private/tmp`; they never edit generators or the shared main checkout. Fix agents may edit only explicitly assigned new quote records. Only the coordinator runs ingest/build/sync/git.

## 1. Draw and deduplicate

Follow README step 1: rank, select the requested count plus a small reserve, and batch. Compare each candidate against both `displayQuote` and `schema.quotationText`/`alternateName`, and compare candidates with one another. Check unique slugs and semantic variants, not just exact text/Jaccard. Remove duplicates from the research batch and replace their slots from reserves. At the end, sync built records first, then `unselect --wave rN` to release all unbuilt reserves. Never hand-edit the harvest queue or use hate/harm-only `skip` for duplicates.

## 2. Plan research using the existing contracts

```sh
node workflows/agent-bridge.js plan --stage research --repo /absolute/wave-worktree \
  --input /absolute/wave-worktree/data/.harvest-batch-rN.json \
  --verified-date '9 Nov 2026' --date-modified 2026-11-09 \
  --out /private/tmp/rN-research-plan.json
```

Use the actual New York date from `node tools/et-date.js`, not the example date. The adapter reads `researchPrompt` and `DOSSIER_SCHEMA` directly from `generate.js`; it does not maintain another prompt or `toRecord`. The plan carries source hashes, schema, exact item IDs and fully expanded prompts. Assign disjoint ID groups to agents and provide the corresponding candidate metadata as leads, not verified facts.

Every quote gets actual source research, source-fetch evidence, honest confidence and independently determined rights. Preserve an evidence file naming each fetched URL, the claim it supports, access limitations and a short supporting excerpt or paraphrase. Never mark a failed fetch as verified. Use fewer links rather than inventing four relevant sources. Observe applicable source quotation limits, including cumulative quotations when several records cite one copyrighted source. A title in a candidate feed is not automatically a verbatim historic quotation. No forced invented author/date/translation to fill a slot.

Each completed research result is an object:

```json
{"id":0,"agent":"/root/research-a","completedAt":"2026-11-09T19:00:00Z","dossier":{}}
```

The dossier must satisfy the plan's schema. Save completed results incrementally in each agent's separate JSON array. A completion timestamp identifies actual completion; it is not the publication date. Wait for all assigned agents to finish before collection. Count IDs, not lines or chat summaries.

```sh
node workflows/agent-bridge.js collect --plan /private/tmp/rN-research-plan.json \
  --results /private/tmp/rN-research-a.json,/private/tmp/rN-research-b.json \
  --out /private/tmp/rN-research-journal.jsonl
```

Collection fails on missing, duplicate or unknown IDs, malformed dossiers or missing completion receipts. It writes a NEW journal only after complete validation; it cannot overwrite an existing journal. Its compatibility `started` entries are marked `planned:true`, not a claim to reproduce legacy runtime events. Results are explicitly labeled `runtime:codex-agents` with the actual agent and completion receipt. Never fabricate a legacy workflow transcript.

## 3–4. Prep, ingest and build

Use the existing README prep command with this adapter journal and today's dates. Existing escaping, stub, identity matching and credited-to rules remain mandatory. Re-run missing/stubbed items; do not use `--allow-partial` to turn a requested 100 into a smaller wave. Ingest with `_ingest.js`, then build. Do not bypass validators or edit generated HTML.

## 5. Independent audit, skeptic, fix and recheck

```sh
node workflows/agent-bridge.js plan --stage audit --repo /absolute/wave-worktree \
  --input /absolute/wave-worktree/workflows/.scratch/audit-args-rN.json \
  --out /private/tmp/rN-audit-plan.json
```

Assign every rendered page to a DIFFERENT agent from its researcher. Rotate groups or use fresh agents; an author's self-review is not the independent audit. Each auditor reads the full rendered HTML and rechecks all source claims/links using `audit.js`'s exact prompt. Preserve every finding and unavailable-source limitation. Return `{id,agent,completedAt,audit}` with `AUDIT_SCHEMA`, then collect with the same CLI and run `parse-audit.js` with explicit `--out`.

For every high/blocker, a different agent independently reads the finding, source and page using `audit.js`'s `skepticPrompt`; preserve `{slug,location,finding,standsUp,reasoning}` alongside the audit journal. Do not erase a finding merely because a later run says PASS. Union all findings and fix every confirmed issue in the source record. Refuted findings need saved reasons; ambiguous issues remain open. Fix agents may modify only their assigned records; report generator defects separately. Rebuild, then have independent agents recheck the changed claims. Require exact audit coverage for all requested records and no unresolved confirmed blocker/high before publishing.

## 6. Themes and game

Run the existing theme stage through host agents: give the fixed vocabulary and `tagPrompt` from `tag-themes.js`, with an explicit mini-manifest of new untagged records. Save native agent receipts and the actual `{results:[{slug,themes}]}` result in a compatibility journal labeled `runtime:codex-agents`; run existing `apply-tags.js --journal ... --manifest ...`. The manifest completeness gate stays mandatory. Do not modify `DOSSIER_SCHEMA` to fold themes into research.

Run `game-todo.js`, and use `game-fields.js`'s exact research contract through available agents. Save results durably; `game-check.js` must report zero problems before merge. Do not invent speaker location/year to make a quote playable; leave genuinely unconfirmed items pending and explain them. Run game merge and schedule, preserving all locked dates.

## 7. Release

Follow every README shipping gate: sync, release unbuilt reserves, rebuild, scan, check source scope, commit, deterministic rebuild/clean tree, PR, CI, rebase/rebuild against current main, merge, Pages success, live page verification and IndexNow. Confirm the requested number of NEW records/pages, no unintended existing-record edits, and the main checkout clean and equal to origin/main. A merged commit is not proof of live publication.

Report exact new-page and game-entry counts, unresolved pending game fields, audit outcomes and live verification. Keep reusable process changes in their own PR. Keep per-wave research/receipts in scratch files and a concise durable wave report; do not commit downloaded source pages or secrets.
