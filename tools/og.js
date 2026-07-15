'use strict';
/*
 * og.js — the ONE social-card image URL + its meta block, shared by every generator.
 *
 * Same reasoning as tokens.js: the og:image tag is hand-rolled in six separate head blocks
 * (template.js, build-index.js, build-authors.js ×2, build-themes.js ×2, build-check.js,
 * build-static.js). Pointing them all at one constant means the URL can't rot in five places
 * when only one gets updated — which is exactly how every page came to declare an /og/{slug}.png
 * that was never generated.
 *
 * The image itself is a STATIC committed asset at /og/default.png, generated once by
 * tools/og-card.js (see that file for how to regenerate). It is deliberately not per-quote:
 * per-quote cards need a rasteriser dependency, which the no-build-tools constraint rules out.
 *
 * og:image must be an ABSOLUTE url — relative paths are not resolved by most crawlers
 * (Slack, Facebook, LinkedIn), and a bare path is treated as a missing image.
 */
const ORIGIN = 'https://quotle.info';

const OG_IMAGE = `${ORIGIN}/og/default.png`;

// Declaring width/height lets crawlers lay the card out before the image finishes downloading —
// without them Twitter/X and Slack sometimes fall back to the small summary card.
const OG_IMAGE_TAGS = `    <meta property="og:image" content="${OG_IMAGE}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="Quotle.info — Real quote? Cleared to use? Verified provenance and reuse rights.">
    <meta name="twitter:card" content="summary_large_image">`;

module.exports = { OG_IMAGE, OG_IMAGE_TAGS };
