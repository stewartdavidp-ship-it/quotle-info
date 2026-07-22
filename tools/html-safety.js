'use strict';
/*
 * html-safety.js — the gate on agent-authored HTML.
 *
 * WHY THIS EXISTS
 * About ten record fields are injected into pages RAW, not escaped — author.bio, answer.sourceLine,
 * misattribution.intro/truthLine, context.pull, breadcrumbSection.href and friends. That is
 * deliberate: those fields carry inline <em>/<strong>/<a> and would be unreadable escaped.
 *
 * But records are written by LLM agents FROM FETCHED WEB PAGES. A page can contain text crafted to
 * be copied into a field, so the path "attacker's web page → agent → record → every rendered page"
 * is a real stored-XSS route, and nothing was checking it. The corpus was clean when this was
 * added (0 payloads across 1,068 quotes + 27 songs); this keeps it that way.
 *
 * The allowlist is derived from what the corpus ACTUALLY uses, not from a generic template:
 *   tags   em(10199) a(7994) strong(3540) br(321) cite(19) span(12) i(2)
 *   hrefs  https(7895) http(93)
 * plus a few obvious siblings (p/li/ul/ol/b) so ordinary prose is not rejected on a technicality.
 *
 * Used by tools/validate-records.js and tools/validate-songs.js — one implementation, so the two
 * validators can never disagree about what is safe.
 */

const ALLOWED_TAGS = new Set(['a', 'em', 'strong', 'i', 'b', 'br', 'cite', 'span', 'p', 'li', 'ul', 'ol', 'sup', 'sub']);
// Attributes permitted on any allowed tag. Deliberately tiny.
//   class  IS allowed — records legitimately use class="title"/"muted"/"dim", which the page CSS
//          defines. It cannot execute, and the blast radius is a styling collision.
//   style  is NOT — an inline style attribute in agent-authored content is an avoidable surface
//          (positioning/overlay tricks), and it is presentation living in a content record. The
//          5 instances that existed were moved to .muted/.dim classes in template.js.
//   id     is NOT — it can collide with the page's own anchors and script hooks.
//   on*    is NEVER — handled explicitly below, before the allowlist is even consulted.
const ALLOWED_ATTRS = new Set(['href', 'target', 'rel', 'title', 'lang', 'class']);
const ALLOWED_SCHEMES = ['https:', 'http:', 'mailto:'];

const TAG = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
const ATTR = /([a-zA-Z-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g;

/**
 * Scan one string for unsafe HTML. Returns an array of human-readable problems.
 */
function scanString(str) {
  const problems = [];
  if (typeof str !== 'string' || str.indexOf('<') === -1) {
    // still check for a scheme smuggled into a bare href-ish field (breadcrumbSection.href etc.)
    if (typeof str === 'string' && /^\s*(javascript|data|vbscript):/i.test(str)) {
      problems.push(`unsafe URL scheme in a bare value: ${str.slice(0, 60)}`);
    }
    return problems;
  }

  let m;
  const re = new RegExp(TAG.source, 'g');
  while ((m = re.exec(str))) {
    const tag = m[1].toLowerCase();
    const attrs = m[2] || '';
    if (!ALLOWED_TAGS.has(tag)) {
      problems.push(`disallowed tag <${tag}> (allowed: ${[...ALLOWED_TAGS].join(', ')})`);
      continue;
    }
    let a;
    const ra = new RegExp(ATTR.source, 'g');
    while ((a = ra.exec(attrs))) {
      const name = a[1].toLowerCase();
      const value = a[2].replace(/^["']|["']$/g, '');
      if (/^on/i.test(name)) { problems.push(`event handler ${name}= on <${tag}> — never allowed`); continue; }
      if (!ALLOWED_ATTRS.has(name)) { problems.push(`disallowed attribute ${name}= on <${tag}>`); continue; }
      if (name === 'href') {
        const v = value.trim();
        const isRelative = v.startsWith('/') || v.startsWith('#');
        const schemeOk = ALLOWED_SCHEMES.some((s) => v.toLowerCase().startsWith(s));
        if (!isRelative && !schemeOk) {
          problems.push(`href scheme not allowed: "${v.slice(0, 60)}" (allowed: ${ALLOWED_SCHEMES.join(' ')} or a root-relative /path)`);
        }
      }
    }
  }
  return problems;
}

/**
 * Walk a parsed record and scan every string, reporting the field path with each problem so a
 * failure is actionable from the message alone.
 */
function scanRecord(node, path = '', out = []) {
  if (typeof node === 'string') {
    for (const p of scanString(node)) out.push(`${path || '(root)'}: ${p}`);
  } else if (Array.isArray(node)) {
    node.forEach((v, i) => scanRecord(v, `${path}[${i}]`, out));
  } else if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) scanRecord(node[k], path ? `${path}.${k}` : k, out);
  }
  return out;
}

module.exports = { scanRecord, scanString, ALLOWED_TAGS, ALLOWED_ATTRS, ALLOWED_SCHEMES };
