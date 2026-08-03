'use strict';
/*
 * a11y-widget.js — shared display-preferences control for every quotle.info page.
 *   • Theme:  Auto (follows OS) / Light / Dark
 *   • Text size:  Normal 100% / Large 112.5% / Extra large 125% / Largest 140%  (mirrors Mast)
 *
 * Per the Game Shelf convention, this is NOT a floating control — it lives in the header. A compact
 * "Aa" button in the topnav opens a dropdown panel anchored beneath it (the content-site trim of the
 * games' hamburger → Menu → "🎨 Display" section). The site is token-based + rem-based, so theme is a
 * set of `:root[data-theme="light"]` custom-property overrides (dark is the default `:root`, defined in
 * tokens.js) and text-size overrides the root font-size. Both persist per-device in localStorage and
 * are applied by an inline <head> script BEFORE first paint, so the choice holds with no flash.
 *
 * Exports (injected by tools/template.js and tools/build-index.js):
 *   HEAD_SCRIPT — inline <head> script; resolves + applies saved theme + text-size pre-paint.
 *   THEME_CSS   — <style> for <head>: light-theme token overrides + the header-control styles.
 *   CONTROL     — the button + panel markup; placed INSIDE the topnav (needs the nav for positioning).
 *   SCRIPT      — the <script> that wires the control; placed at end of <body>.
 */

const HEAD_SCRIPT = `    <script>(function(){try{var d=document.documentElement,ls=localStorage;var THEMES={light:1,dark:1,auto:1},SIZES={normal:1,large:1,xl:1,xxl:1};var u=new URL(location.href),q=u.searchParams,qth=q.get('qth'),qts=q.get('qts');if(qth||qts){if(THEMES[qth])ls.setItem('quotle-theme',qth);if(SIZES[qts])ls.setItem('quotle-text-size',qts);q.delete('qth');q.delete('qts');var qs=q.toString();history.replaceState(null,'',u.pathname+(qs?'?'+qs:'')+u.hash);}var t=ls.getItem('quotle-theme');if(t!=='light'&&t!=='dark'&&t!=='auto')t='auto';var dark=t==='dark'||(t==='auto'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);d.setAttribute('data-theme',dark?'dark':'light');var s=ls.getItem('quotle-text-size'),m={normal:'100%',large:'112.5%',xl:'125%',xxl:'140%'};if(m[s])d.style.fontSize=m[s];}catch(e){}})();</script>`;

// Light theme: a warm-paper editorial palette. Accent hues are darkened from the dark-theme
// values so text/badges clear WCAG AA on the light backgrounds. Dark remains the default :root
// (defined in tokens.js). This block also carries the header-control (.disp) styles so both
// generators pick them up from one place.
const THEME_CSS = `    <style>
        :root[data-theme="light"] {
            --bg-deep: #f5f1e8; --cream: #fffdf8; --bg-card: #fffdf8;
            --bg-card-hover: #f8f3ea; --bg-elevated: #efe8d9;
            --ink: #23202e; --slate: #4b4658; --text-muted: #6a6577;
            --burgundy: #b23a54; --burgundy-link: #9c2c44; --burgundy-deep: #7a2130;
            --burgundy-glow: rgba(178,58,84,0.09);
            --gold: #755f13; --gold-dim: rgba(143,114,24,0.12);
            --sage: #2f7048; --sage-dim: rgba(47,112,72,0.13);
            --amber: #965b12; --caution: #4a55a2;
            --border: rgba(35,32,46,0.12); --border-accent: rgba(178,58,84,0.28);
        }
        /* .answer is the only element with a hardcoded dark gradient; retint for light. */
        :root[data-theme="light"] .answer { background: linear-gradient(180deg, #fffdf8, #f8f3ea); border-color: rgba(35,32,46,0.10); box-shadow: 0 16px 44px rgba(35,32,46,0.10); }
        :root[data-theme="light"] body::before { opacity: 0; }

        /* ---- Header display control (theme + text size) ---- */
        .nav-actions { display: flex; align-items: center; gap: 10px; }
        .disp { position: relative; }
        .disp-btn { font-family: 'DM Sans', sans-serif; font-weight: 700; letter-spacing: 0.01em; color: var(--slate); background: transparent; border: 1px solid var(--border-accent); border-radius: 999px; padding: 6px 12px; cursor: pointer; line-height: 1; display: inline-flex; align-items: baseline; transition: border-color 0.2s, color 0.2s; }
        .disp-btn .a1 { font-size: 0.82rem; } .disp-btn .a2 { font-size: 1.04rem; }
        .disp-btn:hover, .disp-btn[aria-expanded="true"] { color: var(--ink); border-color: var(--burgundy); }
        .disp-btn:focus-visible { outline: 2px solid var(--sage); outline-offset: 2px; }
        .disp-panel { position: absolute; top: calc(100% + 10px); right: 0; z-index: 600; width: 232px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 15px 16px 13px; box-shadow: 0 14px 44px rgba(0,0,0,0.4); display: none; }
        .disp-panel.open { display: block; }
        .disp-panel .dph { font-family: 'DM Sans', sans-serif; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.13em; color: var(--text-muted); margin-bottom: 9px; }
        .disp-panel .dph.mt { margin-top: 15px; }
        .disp-row { display: flex; gap: 6px; }
        .disp-row button { flex: 1; background: var(--cream); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--slate); font-family: 'DM Sans', sans-serif; font-weight: 600; font-size: 0.78rem; cursor: pointer; padding: 8px 0; transition: border-color 0.15s, color 0.15s, background 0.15s; }
        .disp-row button:hover { color: var(--ink); border-color: var(--border-accent); }
        .disp-row button[aria-pressed="true"] { border-color: var(--sage); color: var(--sage); background: var(--sage-dim); }
        .disp-row button:focus-visible { outline: 2px solid var(--sage); outline-offset: 2px; }
        .disp-sizes { display: flex; gap: 6px; }
        .disp-sizes button { flex: 1; background: var(--cream); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--slate); font-family: 'Playfair Display', serif; font-weight: 700; cursor: pointer; padding: 9px 0 7px; line-height: 1; transition: border-color 0.15s, color 0.15s, background 0.15s; }
        .disp-sizes button:hover { color: var(--ink); border-color: var(--border-accent); }
        .disp-sizes button[aria-pressed="true"] { border-color: var(--sage); color: var(--sage); background: var(--sage-dim); }
        .disp-sizes button:focus-visible { outline: 2px solid var(--sage); outline-offset: 2px; }
        .disp-sizes button:nth-child(1) { font-size: 0.82rem; } .disp-sizes button:nth-child(2) { font-size: 1.02rem; } .disp-sizes button:nth-child(3) { font-size: 1.22rem; } .disp-sizes button:nth-child(4) { font-size: 1.46rem; }
        .disp-note { font-family: 'DM Sans', sans-serif; font-size: 0.66rem; color: var(--text-muted); margin-top: 12px; }
        @media (prefers-reduced-motion: reduce) { .disp-btn, .disp-row button, .disp-sizes button { transition: none; } }
        /* Print: the site resolves to dark by default, which would print as near-invisible ink on
           white paper. Force a legible light palette (darkened accents) regardless of screen theme. */
        @media print {
            :root, :root[data-theme="dark"], :root[data-theme="light"] {
                --bg-deep: #fff; --cream: #fff; --bg-card: #fff; --bg-card-hover: #fff; --bg-elevated: #fff;
                --ink: #000; --slate: #222; --text-muted: #444;
                --burgundy: #8a1f33; --burgundy-link: #8a1f33; --burgundy-deep: #6d1626;
                --gold: #6b560f; --sage: #245c39; --amber: #7a4a0e; --caution: #2f3a86;
                --border: rgba(0,0,0,0.25); --border-accent: rgba(0,0,0,0.25);
            }
            body::before { display: none !important; }
            .disp { display: none !important; }
        }
    </style>`;

// The button + panel. Rendered INSIDE the .nav-actions wrapper in the topnav so the panel can
// anchor beneath the button (position: absolute against the .disp relative parent).
const CONTROL = `<div class="disp">
                <button class="disp-btn" id="dispBtn" type="button" aria-label="Display settings: theme and text size" aria-haspopup="dialog" aria-expanded="false" aria-controls="dispPanel"><span class="a1">A</span><span class="a2">a</span></button>
                <div class="disp-panel" id="dispPanel" role="dialog" aria-label="Display settings">
                    <p class="dph" id="dispThemeLbl">Theme</p>
                    <div class="disp-row" id="dispTheme" role="group" aria-labelledby="dispThemeLbl">
                        <button type="button" data-theme-choice="auto" aria-pressed="true" title="Match your device">Auto</button>
                        <button type="button" data-theme-choice="light" aria-pressed="false" title="Light theme">Light</button>
                        <button type="button" data-theme-choice="dark" aria-pressed="false" title="Dark theme">Dark</button>
                    </div>
                    <p class="dph mt" id="dispSizeLbl">Text size</p>
                    <div class="disp-sizes" role="group" aria-labelledby="dispSizeLbl">
                        <button type="button" data-size="normal" aria-pressed="true" aria-label="Normal text size" title="Normal">A</button>
                        <button type="button" data-size="large" aria-pressed="false" aria-label="Large text size" title="Large">A</button>
                        <button type="button" data-size="xl" aria-pressed="false" aria-label="Extra-large text size" title="Extra large">A</button>
                        <button type="button" data-size="xxl" aria-pressed="false" aria-label="Largest text size" title="Largest">A</button>
                    </div>
                    <p class="disp-note">Saved on this device.</p>
                </div>
            </div>`;

const SCRIPT = `    <script>
        (function(){
            var d = document.documentElement;
            var btn = document.getElementById('dispBtn'), panel = document.getElementById('dispPanel');
            if (!btn || !panel) return;

            // ---- Theme (Auto / Light / Dark) ----
            var THEME_KEY = 'quotle-theme';
            var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
            var themeBtns = Array.prototype.slice.call(panel.querySelectorAll('[data-theme-choice]'));
            function currentTheme(){ try { var t = localStorage.getItem(THEME_KEY); return (t === 'light' || t === 'dark' || t === 'auto') ? t : 'auto'; } catch (e) { return 'auto'; } }
            function resolved(mode){ if (mode === 'dark') return 'dark'; if (mode === 'light') return 'light'; return (mq && mq.matches) ? 'dark' : 'light'; }
            function applyTheme(mode, save){
                d.setAttribute('data-theme', resolved(mode));
                themeBtns.forEach(function(b){ b.setAttribute('aria-pressed', b.getAttribute('data-theme-choice') === mode ? 'true' : 'false'); });
                if (save) { try { localStorage.setItem(THEME_KEY, mode); } catch (e) {} }
            }
            applyTheme(currentTheme(), false);
            themeBtns.forEach(function(b){ b.addEventListener('click', function(){ applyTheme(b.getAttribute('data-theme-choice'), true); }); });
            if (mq && mq.addEventListener) mq.addEventListener('change', function(){ if (currentTheme() === 'auto') applyTheme('auto', false); });

            // ---- Text size ----
            var SIZE_KEY = 'quotle-text-size';
            var SIZE_MAP = { normal: '100%', large: '112.5%', xl: '125%', xxl: '140%' };
            var sizeBtns = Array.prototype.slice.call(panel.querySelectorAll('[data-size]'));
            function currentSize(){ try { var s = localStorage.getItem(SIZE_KEY); return SIZE_MAP[s] ? s : 'normal'; } catch (e) { return 'normal'; } }
            function applySize(size, save){
                d.style.fontSize = SIZE_MAP[size] || '100%';
                sizeBtns.forEach(function(b){ b.setAttribute('aria-pressed', b.getAttribute('data-size') === size ? 'true' : 'false'); });
                if (save) { try { localStorage.setItem(SIZE_KEY, size); } catch (e) {} }
            }
            applySize(currentSize(), false);
            sizeBtns.forEach(function(b){ b.addEventListener('click', function(){ applySize(b.getAttribute('data-size'), true); }); });

            // ---- Panel open/close ----
            function setOpen(o){ panel.classList.toggle('open', o); btn.setAttribute('aria-expanded', o ? 'true' : 'false'); }
            btn.addEventListener('click', function(e){ e.stopPropagation(); setOpen(!panel.classList.contains('open')); });
            document.addEventListener('click', function(e){ if (panel.classList.contains('open') && !panel.contains(e.target) && !btn.contains(e.target)) setOpen(false); });
            document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && panel.classList.contains('open')) { setOpen(false); btn.focus(); } });
        })();
    </script>
    <!-- Privacy-friendly, cookieless analytics (GoatCounter) — injected site-wide via SCRIPT -->
    <script data-goatcounter="https://quotle.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>`;


// PREF_SYNC — carry the reader's theme + text size ACROSS ORIGINS.
//
// quotle.info and quotle.runmast.com (the blog) are separate origins, so they
// have separate localStorage — and separate registrable domains, so a shared
// cookie is not possible either. Without this, choosing Light or a larger "Aa"
// on one property silently reverts to the default on the other, mid-journey.
//
// So the preference rides on the link: any click through to the sibling origin
// gains ?qth=<theme>&qts=<size>, and HEAD_SCRIPT on the far side adopts it
// before first paint, then strips the params via replaceState so they never
// linger in the address bar or get shared/bookmarked.
//
// Scoped deliberately to the two known origins. Preferences are not leaked to
// gameshelf.co or any outbound link — those are somebody else's pages.
//
// Capture-phase click, rewriting href just before navigation: it needs no
// knowledge of which links exist, so it keeps working when the nav changes.
const PREF_SYNC = `    <script>
        (function(){
            var SIBLINGS = { 'https://quotle.info': 1, 'https://quotle.runmast.com': 1 };
            document.addEventListener('click', function(e){
                var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
                if (!a) return;
                var url;
                try { url = new URL(a.href, location.href); } catch (err) { return; }
                if (url.origin === location.origin || !SIBLINGS[url.origin]) return;
                try {
                    var t = localStorage.getItem('quotle-theme');
                    var s = localStorage.getItem('quotle-text-size');
                    if (t) url.searchParams.set('qth', t);
                    if (s) url.searchParams.set('qts', s);
                    a.href = url.toString();
                } catch (err) {}
            }, true);
        })();
    </script>`;

module.exports = { HEAD_SCRIPT, THEME_CSS, CONTROL, SCRIPT, PREF_SYNC };
