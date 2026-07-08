'use strict';
/*
 * a11y-widget.js — shared accessibility text-size control for every quotle.info page.
 *
 * Mirrors Mast's Settings → Accessibility "Text size" control (4 levels, scales the whole
 * page by overriding the root font-size; the site's CSS is rem-based so everything scales),
 * adapted for a multi-page static content site: an always-available floating "A" button that
 * opens a 4-option picker, persisted per-device in localStorage.
 *
 *   HEAD_SCRIPT — inline <head> script: applies the saved size BEFORE first paint so the choice
 *                 holds with no flash when navigating between pages.
 *   WIDGET      — the floating control (its own <style> + button + panel + script) for end of <body>.
 *
 * Levels match Mast: normal 100% · large 112.5% · xl 125% · xxl 140%.
 */

const HEAD_SCRIPT = `    <script>(function(){try{var s=localStorage.getItem('quotle-text-size'),m={normal:'100%',large:'112.5%',xl:'125%',xxl:'140%'};if(m[s])document.documentElement.style.fontSize=m[s];}catch(e){}})();</script>`;

const WIDGET = `    <!-- ============ ACCESSIBILITY: TEXT SIZE ============ -->
    <style>
        .a11y-fab { position: fixed; bottom: 20px; right: 20px; z-index: 600; width: 46px; height: 46px; border-radius: 50%; background: var(--bg-card); border: 1px solid var(--border-accent); color: var(--text-primary); font-family: 'Playfair Display', serif; font-weight: 900; cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,0.35); display: grid; place-items: center; line-height: 1; transition: border-color 0.2s, transform 0.2s; }
        .a11y-fab:hover { border-color: var(--burgundy); transform: translateY(-2px); }
        .a11y-fab .a { font-size: 1rem; } .a11y-fab .aa { font-size: 0.68rem; margin-left: 1px; }
        .a11y-fab:focus-visible { outline: 2px solid var(--sage); outline-offset: 3px; }
        .a11y-panel { position: fixed; bottom: 76px; right: 20px; z-index: 600; width: 214px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 14px 16px 13px; box-shadow: 0 12px 44px rgba(0,0,0,0.45); display: none; }
        .a11y-panel.open { display: block; }
        .a11y-panel h3 { font-family: 'DM Sans', sans-serif; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.13em; color: var(--text-muted); margin-bottom: 11px; }
        .a11y-sizes { display: flex; gap: 7px; }
        .a11y-sizes button { flex: 1; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text-secondary); font-family: 'Playfair Display', serif; font-weight: 700; cursor: pointer; padding: 9px 0 7px; line-height: 1; transition: border-color 0.15s, color 0.15s, background 0.15s; }
        .a11y-sizes button:hover { color: var(--text-primary); border-color: var(--border-accent); }
        .a11y-sizes button[aria-pressed="true"] { border-color: var(--sage); color: var(--sage); background: var(--sage-dim); }
        .a11y-sizes button:focus-visible { outline: 2px solid var(--sage); outline-offset: 2px; }
        .a11y-sizes button:nth-child(1) { font-size: 0.82rem; } .a11y-sizes button:nth-child(2) { font-size: 1.02rem; } .a11y-sizes button:nth-child(3) { font-size: 1.22rem; } .a11y-sizes button:nth-child(4) { font-size: 1.46rem; }
        .a11y-note { font-family: 'DM Sans', sans-serif; font-size: 0.66rem; color: var(--text-muted); margin-top: 11px; }
        @media (prefers-reduced-motion: reduce) { .a11y-fab, .a11y-sizes button { transition: none; } }
        @media print { .a11y-fab, .a11y-panel { display: none !important; } }
    </style>
    <button class="a11y-fab" id="a11yFab" aria-label="Change text size" aria-expanded="false" aria-controls="a11yPanel" title="Text size"><span class="a">A</span><span class="aa">A</span></button>
    <div class="a11y-panel" id="a11yPanel" role="dialog" aria-label="Text size">
        <h3>Text size</h3>
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
            var MAP = { normal: '100%', large: '112.5%', xl: '125%', xxl: '140%' };
            var KEY = 'quotle-text-size';
            var fab = document.getElementById('a11yFab');
            var panel = document.getElementById('a11yPanel');
            if (!fab || !panel) return;
            var btns = Array.prototype.slice.call(panel.querySelectorAll('[data-size]'));
            function current(){ try { var s = localStorage.getItem(KEY); return MAP[s] ? s : 'normal'; } catch (e) { return 'normal'; } }
            function apply(size, save){
                document.documentElement.style.fontSize = MAP[size] || '100%';
                btns.forEach(function(b){ b.setAttribute('aria-pressed', b.getAttribute('data-size') === size ? 'true' : 'false'); });
                if (save) { try { localStorage.setItem(KEY, size); } catch (e) {} }
            }
            function setOpen(o){ panel.classList.toggle('open', o); fab.setAttribute('aria-expanded', o ? 'true' : 'false'); }
            apply(current(), false);
            fab.addEventListener('click', function(){ setOpen(!panel.classList.contains('open')); });
            btns.forEach(function(b){ b.addEventListener('click', function(){ apply(b.getAttribute('data-size'), true); }); });
            document.addEventListener('click', function(e){ if (panel.classList.contains('open') && !panel.contains(e.target) && !fab.contains(e.target)) setOpen(false); });
            document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && panel.classList.contains('open')) { setOpen(false); fab.focus(); } });
        })();
    </script>`;

module.exports = { HEAD_SCRIPT, WIDGET };
