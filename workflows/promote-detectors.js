export const meta = {
  name: 'promote-detectors',
  description: 'Take the detectorProposals a fix wave returned and drive each to a decision without a human in the middle: measure it across the corpus, derive whether it is a record/backfill/generator defect from field coverage, then have three independent skeptics judge a sample of its hits. Majority-refuted is rejected. Returns per-proposal verdicts plus the exact command to admit the survivors.',
  phases: [
    { title: 'Measure', detail: 'run the gate CLI over the whole corpus, one agent per proposal' },
    { title: 'Judge', detail: 'three skeptics per surviving proposal, defaulting to reject' },
  ],
}

// WHY THIS EXISTS. tools/propose-detector.js measures a proposal and prints a sample "to hand-check
// before adding". That hand-check was the last human step in an otherwise closed loop, and it is
// also the step a human does WORST: the person running it wrote or reviewed the fix that produced
// the proposal, so they are checking their own pattern. It was skipped in practice — a candidate
// measured at 0.4% was called ACCEPT and turned out to be 0/3 on inspection.
//
// A skeptic panel is strictly better here, and it is safe to automate for one specific reason: a
// detector IS NOT USER-FACING. A wrong one costs a wasted audit, not a wrong page. Compare fix.js,
// which edits published records and should keep its guardrails. The gate exists only to stop the
// flag queue becoming an inbox nobody reads.
//
// The skeptics are told to default to REJECT and are shown the hits WITHOUT the proposal's own
// rationale, so they judge the records rather than the argument.

const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['isRealDefect', 'reasoning'],
  properties: {
    isRealDefect: { type: 'boolean' },   // true = these records are genuinely wrong
    reasoning: { type: 'string' },
    legitimateShape: { type: 'string' }, // if false: what the flagged shape actually is, and why it is correct
  },
}

const MEASURE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['id', 'hits', 'ratePct', 'kind', 'verdictWord', 'sample'],
  properties: {
    id: { type: 'string' },
    hits: { type: 'number' },
    ratePct: { type: 'number' },
    kind: { type: 'string' },            // as DERIVED by the CLI, which may differ from the proposal
    verdictWord: { type: 'string' },
    sample: { type: 'array', items: { type: 'string' } }, // "slug — why it was flagged"
    error: { type: 'string' },
  },
}

const cfg = typeof args === 'string' ? JSON.parse(args) : (args || {})
const REPO = cfg.repo || '/Users/davidstewart/Developer/quotle-info'
const proposals = cfg.proposals || []

const measurePrompt = (p) => `Measure ONE proposed layer-1 detector for quotle.info against the whole corpus. You are not judging it — you are running the committed tool and reporting exactly what it says.

Write this candidate to /tmp/cand-${p.id}.js (a CommonJS module, exactly this shape):

module.exports = {
  id: ${JSON.stringify(p.id)},
  severity: ${JSON.stringify(p.severity || 'medium')},
  title: ${JSON.stringify(p.rationale || p.id)},
  ${p.field ? `field: ${JSON.stringify(p.field)},` : ''}
  test: ${p.test}
};

Then run, from ${REPO}:
  node tools/propose-detector.js /tmp/cand-${p.id}.js --show

Report: hits, ratePct, the DERIVED kind (the tool prints "kind DERIVED as X" when the proposal names a field — report the tool's answer, not the proposal's), the verdict word, and up to 10 sample lines as "slug — reason". If the tool errors or the candidate will not load, put the message in \`error\` and set hits 0.

Do NOT edit tools/detectors.js. Do NOT pass --accept. Measuring only.`

const skepticPrompt = (p, m, n) => `You are skeptic ${n} of 3, re-checking whether a proposed quality rule for quotle.info has found REAL defects or has merely matched a shape that is legitimate.

quotle.info documents misattributed quotes. Records live in ${REPO}/data/quotes/{slug}.json.

THE RULE FLAGS THESE RECORDS:
${m.sample.slice(0, 10).map((s) => `  · ${s}`).join('\n')}

Read at least 4 of those records yourself (${REPO}/data/quotes/<slug>.json) and decide: is each one genuinely WRONG, or is the flagged shape the correct way to express what that record means?

DEFAULT TO isRealDefect=false. Reject unless you can point at specific records that are actually defective. Three things have been rejected here before, all of which looked reasonable written down:
 · a rule matching "no primary source" in a fact-check row — that is the editorial CONTENT of a misattribution site, not an error in it
 · a rule matching records that name one person as both the false credit and the true author — that is the legitimate "right person, wrong words" shape
 · a rule matching excerpts presented as verbatim quotation with a note calling the popular line a paraphrase — the excerpt quotes the SOURCE and the note explains the relationship; both correct

If you conclude it is not a real defect, say in \`legitimateShape\` what the pattern actually is and why it is correct. You are not being asked to be agreeable — a rule that fires on normal records turns the review queue into an inbox nobody reads.`

phase('Measure')
const measured = (await parallel(proposals.map((p) => () =>
  agent(measurePrompt(p), { label: `measure:${p.id.slice(0, 20)}`, phase: 'Measure', schema: MEASURE_SCHEMA, effort: 'low' })
    .then((m) => (m ? { proposal: p, m } : null))
))).filter(Boolean)

// Nothing to judge when the CLI already refused it, or when it fires on nothing — a 0-hit tripwire
// needs no skeptic, since there is nothing for one to look at.
const needJudging = measured.filter((x) => x.m.hits > 0 && !/REJECT|NOT A DETECTOR/i.test(x.m.verdictWord))
const autoPass = measured.filter((x) => x.m.hits === 0 && !/REJECT|NOT A DETECTOR/i.test(x.m.verdictWord))
const cliRefused = measured.filter((x) => /REJECT|NOT A DETECTOR/i.test(x.m.verdictWord))
log(`measured ${measured.length}: ${needJudging.length} to judge · ${autoPass.length} zero-hit tripwire(s) · ${cliRefused.length} refused by the CLI`)

phase('Judge')
const judged = await parallel(needJudging.map((x) => () =>
  parallel([1, 2, 3].map((n) => () =>
    agent(skepticPrompt(x.proposal, x.m, n), { label: `skeptic${n}:${x.proposal.id.slice(0, 16)}`, phase: 'Judge', schema: VERDICT_SCHEMA, effort: 'high' })
  )).then((vs) => {
    const ok = vs.filter(Boolean)
    const real = ok.filter((v) => v.isRealDefect).length
    return { id: x.proposal.id, ...x.m, skeptics: ok.length, votedReal: real, accepted: real >= 2, verdicts: ok }
  })
))

const accepted = [
  ...judged.filter((j) => j.accepted),
  ...autoPass.map((x) => ({ id: x.proposal.id, ...x.m, skeptics: 0, votedReal: 0, accepted: true, note: 'zero-hit tripwire — no skeptic needed' })),
]
const rejected = [
  ...judged.filter((j) => !j.accepted),
  ...cliRefused.map((x) => ({ id: x.proposal.id, ...x.m, accepted: false, note: 'refused by the measurement gate' })),
]

log(`accepted ${accepted.length} · rejected ${rejected.length}`)

return {
  accepted, rejected,
  // Admission is left as ONE serial command per survivor rather than done here on purpose: agents
  // run in parallel and tools/detectors.js is a single shared file, so concurrent appends would
  // race — the same reason fix.js agents are forbidden from editing the generator. This is
  // mechanical, not a judgement: run them in order, then `node tools/scan.js`.
  admit: accepted.map((a) => `node tools/propose-detector.js /tmp/cand-${a.id}.js --accept`),
  next: accepted.length ? 'run the admit commands in order, then: node tools/scan.js' : 'nothing to admit',
}
