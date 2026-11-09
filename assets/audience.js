/* Native canvas exports; no images leave this device and no rasterizer dependency is needed. */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.QuotleAudience = api; api.boot(); }
})(typeof window === 'undefined' ? null : window, function (win) {
  'use strict';
  var EVENTS = ['card-preview', 'card-download', 'card-share', 'card-link-copy', 'card-arrival', 'challenge-start', 'challenge-complete', 'challenge-share', 'challenge-score-download', 'challenge-arrival', 'challenge-return-7d'];
  function track(name) {
    if (!win || !/^(www\.)?quotle\.info$/.test(win.location.hostname) || EVENTS.indexOf(name) < 0) return;
    if (win.navigator.doNotTrack === '1' || win.doNotTrack === '1') return;
    try { if (win.goatcounter && win.goatcounter.count) win.goatcounter.count({ path: name, title: name.replace(/-/g, ' '), event: true }); } catch (_) {}
  }
  // Break even an unspaced URL/token; never silently clip the source or an uncertainty qualifier.
  function wrap(ctx, text, width) {
    var lines = [], line = '';
    String(text || '').split(/\n/).forEach(function (paragraph) {
      paragraph.split(/\s+/).filter(Boolean).forEach(function (word) {
        if (line && ctx.measureText(line + ' ' + word).width > width) { lines.push(line); line = ''; }
        var part = '';
        Array.from(word).forEach(function (ch) {
          if (part && ctx.measureText(part + ch).width > width) { if (line) { lines.push(line); line = ''; } lines.push(part); part = ''; }
          part += ch;
        });
        line = line ? line + ' ' + part : part;
      });
      if (line) lines.push(line);
      line = '';
    });
    return lines;
  }
  function layout(ctx, data) {
    var sections = [
      { text: data.claim, label: 'THE CLAIM', size: 43, line: 57, color: '#e8e0f0', font: 'Georgia' },
      { text: data.answer, label: 'WHAT THE SOURCES SAY', size: 32, line: 44, color: '#e8e0f0', font: 'Georgia' },
    ];
    if (data.comparison) sections.push({ text: data.comparison, label: 'SOURCE COMPARISON', size: 29, line: 40, color: '#ffd369', font: 'Georgia' });
    sections.push({ text: data.citation, label: 'SOURCE', size: 24, line: 33, color: '#a8b0c0', font: 'Arial' });
    sections.push({ text: data.rights, label: 'USAGE NOTE', size: 21, line: 29, color: '#a8b0c0', font: 'Arial' });
    sections.push({ text: data.url, label: 'READ THE EVIDENCE', size: 22, line: 30, color: '#e08096', font: 'Arial' });
    var y = 238;
    ctx.font = 'bold 36px Arial';
    var verdictLines = wrap(ctx, data.verdict, 920);
    sections.forEach(function (s) {
      ctx.font = s.size + 'px ' + s.font;
      s.lines = wrap(ctx, s.text, 920);
      s.y = y; y += 38 + s.lines.length * s.line + 42;
    });
    var height = Math.max(1350, y + 92);
    if (height > 7800) throw new Error('This quote needs more space than one image. Use Copy quote or Share instead.');
    return { height: height, verdictLines: verdictLines, sections: sections };
  }
  function drawCard(canvas, data) {
    var ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Image export is unavailable in this browser. You can still share the link.');
    var plan = layout(ctx, data);
    canvas.width = 1080; canvas.height = plan.height;
    ctx.fillStyle = '#0f0f1e'; ctx.fillRect(0, 0, 1080, canvas.height);
    ctx.fillStyle = '#d4627a'; ctx.fillRect(0, 0, 1080, 12);
    ctx.textBaseline = 'top'; ctx.fillStyle = '#a8b0c0'; ctx.font = 'bold 24px Arial'; ctx.fillText('QUOTLE.INFO  /  QUOTE CHECK', 80, 58);
    ctx.fillStyle = data.rating >= 4 ? '#7eb38b' : data.rating === 3 ? '#ffd369' : '#d4627a';
    ctx.font = 'bold 36px Arial'; plan.verdictLines.forEach(function (l, i) { ctx.fillText(l, 80, 115 + i * 43); });
    plan.sections.forEach(function (s) {
      ctx.fillStyle = '#a8b0c0'; ctx.font = 'bold 19px Arial'; ctx.fillText(s.label, 80, s.y);
      ctx.fillStyle = s.color; ctx.font = s.size + 'px ' + s.font;
      s.lines.forEach(function (l, i) { ctx.fillText(l, 80, s.y + 38 + i * s.line); });
    });
    ctx.fillStyle = '#a8b0c0'; ctx.font = '20px Arial'; ctx.fillText('Checked ' + data.checked + '  ·  Evidence before attribution.', 80, canvas.height - 60);
    return canvas;
  }
  function toBlob(canvas) {
    return new Promise(function (resolve, reject) { canvas.toBlob(function (b) { if (b) resolve(b); else reject(new Error('The image could not be created. Please share the link instead.')); }, 'image/png'); });
  }
  function shareUrl(url, via) { var u = new URL(url); u.searchParams.set('via', via); return u.toString(); }
  async function copy(text) { if (!win.navigator.clipboard) throw new Error('Copy is unavailable. Select and copy the page address instead.'); await win.navigator.clipboard.writeText(text); }
  function make(tag, text, cls) { var el = win.document.createElement(tag); if (text) el.textContent = text; if (cls) el.className = cls; return el; }
  async function openCard(data, trigger) {
    var doc = win.document, status = doc.getElementById('toast');
    trigger.disabled = true;
    try {
      var blob = await toBlob(drawCard(doc.createElement('canvas'), data));
      var objectUrl = URL.createObjectURL(blob), fileName = 'quotle-' + data.slug + '.png';
      var file = typeof win.File === 'function' ? new win.File([blob], fileName, { type: 'image/png' }) : null;
      var dialog = make('dialog', '', 'card-dialog'); dialog.setAttribute('aria-labelledby', 'card-dialog-title');
      var header = make('div', '', 'card-dialog-header'), title = make('h2', 'Share the evidence'); title.id = 'card-dialog-title';
      var close = make('button', 'Close', 'aud-btn card-dialog-close'); close.type = 'button'; header.append(title, close);
      var intro = make('p', 'The verdict, source and uncertainty travel with the quote.'), img = make('img'); img.src = objectUrl; img.alt = data.verdict + '. ' + data.claim + ' ' + data.answer;
      var actions = make('div', '', 'aud-actions'), download = make('a', 'Download PNG', 'aud-btn aud-btn-primary'); download.href = objectUrl; download.download = fileName;
      download.addEventListener('click', function () { track('card-download'); }); actions.append(download);
      var message = make('p', '', 'challenge-status'); message.setAttribute('role', 'status');
      var canShare = false;
      try { canShare = !!(file && win.navigator.canShare && win.navigator.canShare({ files: [file] })); } catch (_) {}
      if (canShare) {
        var share = make('button', 'Share image', 'aud-btn'); share.type = 'button'; actions.append(share);
        share.addEventListener('click', async function () {
          try { await win.navigator.share({ files: [file], title: 'Quotle.info quote check', text: data.verdict + ': ' + data.claim + '\n' + shareUrl(data.url, 'quote-card') }); track('card-share'); }
          catch (e) { if (e.name !== 'AbortError') message.textContent = 'Sharing is unavailable. Download the image or copy its link.'; }
        });
      }
      var link = make('button', 'Copy link', 'aud-btn'); link.type = 'button'; actions.append(link);
      link.addEventListener('click', async function () { try { await copy(shareUrl(data.url, 'quote-card')); message.textContent = 'Link copied.'; track('card-link-copy'); } catch (e) { message.textContent = e.message; } });
      dialog.append(header, intro, img, actions, message); doc.body.append(dialog);
      var transcript = make('details'), summary = make('summary', 'Read card text');
      transcript.append(summary, make('p', data.claim), make('p', data.verdict + '. ' + data.answer));
      if (data.comparison) transcript.append(make('p', 'Source comparison: ' + data.comparison));
      transcript.append(make('p', 'Source: ' + data.citation), make('p', 'Usage note: ' + data.rights));
      dialog.append(transcript);
      close.addEventListener('click', function () { dialog.close(); });
      dialog.addEventListener('close', function () { URL.revokeObjectURL(objectUrl); dialog.remove(); trigger.focus(); }, { once: true });
      dialog.showModal(); track('card-preview');
    } catch (e) {
      if (status) { status.textContent = e.message; status.classList.add('show'); setTimeout(function () { status.classList.remove('show'); }, 6000); }
    } finally { trigger.disabled = false; }
  }
  function boot() {
    var doc = win.document, button = doc.getElementById('cardBtn'), data = doc.getElementById('quote-card-data');
    if (button && data && typeof HTMLDialogElement !== 'undefined') {
      try { var payload = JSON.parse(data.textContent); button.hidden = false; button.addEventListener('click', function () { openCard(payload, button); }); } catch (_) {}
    }
    var via = new URL(win.location.href).searchParams.get('via');
    if (via === 'quote-card' || via === 'challenge') win.addEventListener('load', function () { track(via === 'quote-card' ? 'card-arrival' : 'challenge-arrival'); }, { once: true });
  }
  return { boot: boot, track: track, wrap: wrap, layout: layout, drawCard: drawCard, toBlob: toBlob, copy: copy, shareUrl: shareUrl };
});
