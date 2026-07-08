'use strict';
/*
 * tokens.js — the single source of truth for quotle.info's design tokens.
 *
 * Injected verbatim into BOTH tools/template.js (detail pages) and tools/build-index.js
 * (homepage + browse) so the palette can never drift between the two generators again.
 *
 * The brand layer — --burgundy / --gold / --sage / --ink / --slate / --cream — is byte-for-byte
 * the Quotle GAME's dark-theme tokens (gameshelf/quotle/index.html), so the game and this
 * companion site read as one product. --amber / --caution / --purple and the --bg-* reading-depth
 * surfaces are quotle.info extensions the game doesn't need (3-state confidence + a longer page).
 * The light-theme overrides for these tokens live in a11y-widget.js (THEME_CSS).
 */
const ROOT_CSS = `        :root {
            /* Reading-depth surfaces — quotle.info extension (the game needs only --cream) */
            --bg-deep: #0f0f1e; --cream: #1a1a2e; --bg-card: #252538;
            --bg-card-hover: #2d2d45; --bg-elevated: #30304a;
            /* Text — --ink / --slate are the Quotle game's dark tokens, exact */
            --ink: #e8e0f0; --slate: #a8b0c0; --text-muted: #9aa2b2;
            /* Brand accents — shared byte-for-byte with the Quotle game */
            --burgundy: #d4627a;          /* brand + misattribution accent (large/decorative) */
            --burgundy-link: #e08096;     /* lifted tone for small inline burgundy links (AA on cards) */
            --burgundy-deep: #8B2635; --burgundy-glow: rgba(212, 98, 122, 0.15);
            --gold: #ffd369;              /* authentic-voice accent: author name + pull-quote */
            --gold-dim: rgba(255, 211, 105, 0.12);
            --sage: #7eb38b;              /* verified / trust / source actions */
            --sage-dim: rgba(126, 179, 139, 0.12);
            /* Confidence-state + decorative extensions (quotle.info only) */
            --amber: #e0a24e;             /* confidence: attributed / likely */
            --caution: #9aa3d6;           /* confidence: disputed (AA headroom vs body grey + burgundy) */
            --purple: #764ba2;            /* author-avatar gradient tail */
            --border: rgba(255,255,255,0.06); --border-accent: rgba(212, 98, 122, 0.25);
            --radius-sm: 8px; --radius-md: 14px; --radius-lg: 22px; --radius-xl: 32px;
        }`;

module.exports = { ROOT_CSS };
