'use strict';
/*
 * a11y-widget.js — shared display-preferences control for every quotle.info page:
 *   • Theme:  Auto (follows OS) / Light / Dark
 *   • Text size:  Normal 100% / Large 112.5% / Extra large 125% / Largest 140%  (mirrors Mast)
 *
 * The site is token-based + rem-based, so theme is a set of `:root[data-theme="light"]` custom-
 * property overrides (dark is the default `:root`) and text-size overrides the root font-size.
 * Both are persisted per-device in localStorage and applied by an inline <head> script BEFORE
 * first paint, so the choice holds with no flash across page navigations.
 *
 * Exports (injected by tools/template.js and tools/build-index.js):
 *   HEAD_SCRIPT — inline <head> script; resolves + applies saved theme + text-size pre-paint.
 *   THEME_CSS   — <style> for <head>: the light-theme token overrides + light element fixups.
 *   WIDGET      — the floating control (its own <style> + button + panel + script) for end of <body>.
 */

const HEAD_SCRIPT = `    <script>(function(){try{var d=document.documentElement,ls=localStorage;var t=ls.getItem('quotle-theme');if(t!=='light'&&t!=='dark'&&t!=='auto')t='auto';var dark=t==='dark'||(t==='auto'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);d.setAttribute('data-theme',dark?'dark':'light');var s=ls.getItem('quotle-text-size'),m={normal:'100%',large:'112.5%',xl:'125%',xxl:'140%'};if(m[s])d.style.fontSize=m[s];}catch(e){}})();</script>`;

// Light theme: a warm-paper editorial palette. Accent hues are darkened from the dark-theme
// values so text/badges clear WCAG AA on the light backgrounds. Dark remains the default :root.
const THEME_CSS = `    <style>
        :root[data-theme="light"] {
            --bg-deep: #f5f1e8; --bg-surface: #ece5d7; --bg-card: #fffdf8;
            --bg-card-hover: #f8f3ea; --bg-elevated: #efe8d9;
            --text-primary: #23202e; --text-secondary: #4b4658; --text-muted: #6a6577;
            --burgundy: #b23a54; --burgundy-link: #9c2c44; --burgundy-deep: #7a2130;
            --burgundy-glow: rgba(178,58,84,0.09);
            --gold: #8f7218; --gold-dim: rgba(143,114,24,0.12);
            --sage: #2f7048; --sage-dim: rgba(47,112,72,0.13);
            --amber: #965b12; --caution: #4a55a2;
            --border: rgba(35,32,46,0.12); --border-accent: rgba(178,58,84,0.28);
        }
        /* .answer is the only element with a hardcoded dark gradient; retint for light. */
        :root[data-theme="light"] .answer { background: linear-gradient(180deg, #fffdf8, #f8f3ea); border-color: rgba(35,32,46,0.10); box-shadow: 0 16px 44px rgba(35,32,46,0.10); }
        :root[data-theme="light"] body::before { opacity: 0; }
    </style>`;

const WIDGET = `    <!-- ============ DISPLAY PREFERENCES: THEME + TEXT SIZE ============ -->
    <style>
        .a11y-fab { position: fixed; bottom: 20px; right: 20px; z-index: 600; width: 46px; height: 46px; border-radius: 50%; background: var(--bg-card); border: 1px solid var(--border-accent); color: var(--text-primary); font-family: 'Playfair Display', serif; font-weight: 900; cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,0.28); display: grid; place-items: center; line-height: 1; transition: border-color 0.2s, transform 0.2s; }
        .a11y-fab:hover { border-color: var(--burgundy); transform: translateY(-2px); }
        .a11y-fab .a { font-size: 1rem; } .a11y-fab .aa { font-size: 0.68rem; margin-left: 1px; }
        .a11y-fab:focus-visible { outline: 2px solid var(--sage); outline-offset: 3px; }
        .a11y-panel { position: fixed; bottom: 76px; right: 20px; z-index: 600; width: 228px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 15px 16px 13px; box-shadow: 0 12px 44px rgba(0,0,0,0.35); display: none; }
        .a11y-panel.open { display: block; }
        .a11y-panel h3 { font-family: 'DM Sans', sans-serif; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.13em; color: var(--text-muted); margin-bottom: 9px; }
        .a11y-panel h3.mt { margin-top: 15px; }
        .a11y-row { display: flex; gap: 6px; }
        .a11y-row button { flex: 1; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text-secondary); font-family: 'DM Sans', sans-serif; font-weight: 600; font-size: 0.78rem; cursor: pointer; padding: 8px 0; transition: border-color 0.15s, color 0.15s, background 0.15s; }
        .a11y-row button:hover { color: var(--text-primary); border-color: var(--border-accent); }
        .a11y-row button[aria-pressed="true"] { border-color: var(--sage); color: var(--sage); background: var(--sage-dim); }
        .a11y-row button:focus-visible { outline: 2px solid var(--sage); outline-offset: 2px; }
        .a11y-sizes { display: flex; gap: 6px; }
        .a11y-sizes button { flex: 1; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text-secondary); font-family: 'Playfair Display', serif; font-weight: 700; cursor: pointer; padding: 9px 0 7px; line-height: 1; transition: border-color 0.15s, color 0.15s, background 0.15s; }
        .a11y-sizes button:hover { color: var(--text-primary); border-color: var(--border-accent); }
        .a11y-sizes button[aria-pressed="true"] { border-color: var(--sage); color: var(--sage); background: var(--sage-dim); }
        .a11y-sizes button:focus-visible { outline: 2px solid var(--sage); outline-offset: 2px; }
        .a11y-sizes button:nth-child(1) { font-size: 0.82rem; } .a11y-sizes button:nth-child(2) { font-size: 1.02rem; } .a11y-sizes button:nth-child(3) { font-size: 1.22rem; } .a11y-sizes button:nth-child(4) { font-size: 1.46rem; }
        .a11y-note { font-family: 'DM Sans', sans-serif; font-size: 0.66rem; color: var(--text-muted); margin-top: 12px; }
        @media (prefers-reduced-motion: reduce) { .a11y-fab, .a11y-row button, .a11y-sizes button { transition: none; } }
        @media print { .a11y-fab, .a11y-panel { display: none !important; } }
    </style>
    <button class="a11y-fab" id="a11yFab" aria-label="Display settings: theme and text size" aria-expanded="false" aria-controls="a11yPanel" title="Display settings"><span class="a">A</span><span class="aa">A</span></button>
    <div class="a11y-panel" id="a11yPanel" role="dialog" aria-label="Display settings">
        <h3>Theme</h3>
        <div class="a11y-row" id="a11yTheme">
            <button type="button" data-theme-choice="auto" aria-pressed="true" title="Match your device">Auto</button>
            <button type="button" data-theme-choice="light" aria-pressed="false" title="Light theme">Light</button>
            <button type="button" data-theme-choice="dark" aria-pressed="false" title="Dark theme">Dark</button>
        </div>
        <h3 class="mt">Text size</h3>
        <div class="a11y-sizes">
            <button type="button" data-size="normal" aria-pressed="true" aria-label="Normal text size" title="Normal">A</button>
            <button type="button" data-size="large" aria-pressed="false" aria-label="Large text size" title="Large">A</button>
            <button type="button" data-size="xl" aria-pressed="false" aria-label="Extra-large text size" title="Extra large">A</button>
            <button type="button" data-size="xxl" aria-pressed="false" aria-label="Largest text size" title="Largest">A</button>
        </div>
        <p class="a11y-note">Saved on this device.</p>
    </div>
    <script>
        (function(){
            var d = document.documentElement;
            var fab = document.getElementById('a11yFab'), panel = document.getElementById('a11yPanel');
            if (!fab || !panel) return;

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
            function setOpen(o){ panel.classList.toggle('open', o); fab.setAttribute('aria-expanded', o ? 'true' : 'false'); }
            fab.addEventListener('click', function(){ setOpen(!panel.classList.contains('open')); });
            document.addEventListener('click', function(e){ if (panel.classList.contains('open') && !panel.contains(e.target) && !fab.contains(e.target)) setOpen(false); });
            document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && panel.classList.contains('open')) { setOpen(false); fab.focus(); } });
        })();
    </script>`;

module.exports = { HEAD_SCRIPT, THEME_CSS, WIDGET };
