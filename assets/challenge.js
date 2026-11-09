(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.QuotleChallenge = api; api.boot(); }
})(typeof window === 'undefined' ? null : window, function (win) {
  'use strict';
  var LABELS = { supported: 'Supported', misquoted: 'Misquoted or misattributed', unconfirmed: 'Not confirmed' };
  var STORAGE_KEY = 'quotle-challenge-v1';
  function dayInNewYork(date) {
    var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    function p(type) { return parts.find(function (x) { return x.type === type; }).value; }
    return p('year') + '-' + p('month') + '-' + p('day');
  }
  function validDay(day) { return /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day + 'T12:00:00Z')) && new Date(day + 'T12:00:00Z').toISOString().slice(0, 10) === day; }
  function requestedDay(hash, today, starts) {
    var match = /^#v1\/(\d{4}-\d{2}-\d{2})$/.exec(hash || '');
    return match && validDay(match[1]) && match[1] >= starts && match[1] <= today ? match[1] : today;
  }
  function hash(text) { var n = 2166136261; for (var i = 0; i < text.length; i++) { n ^= text.charCodeAt(i); n = Math.imul(n, 16777619); } return n >>> 0; }
  function selectQuestions(pool, day, version) {
    var sorted = pool.slice().sort(function (a, b) { return hash(version + ':' + day + ':' + a.slug) - hash(version + ':' + day + ':' + b.slug) || a.slug.localeCompare(b.slug); });
    var selected = [];
    sorted.forEach(function (q) { if (selected.length < 3 && !selected.some(function (s) { return s.authorKey === q.authorKey; })) selected.push(q); });
    if (selected.length !== 3) throw new Error('Not enough distinct authors for this challenge.');
    // Avoid a dull all-one-answer set, without always giving away one of each answer.
    if (selected.every(function (q) { return q.answer === selected[0].answer; })) {
      var replacement = sorted.find(function (q) { return q.answer !== selected[0].answer && q.authorKey !== selected[0].authorKey && q.authorKey !== selected[1].authorKey; });
      if (replacement) selected[2] = replacement;
    }
    return selected;
  }
  function cleanEntry(value) {
    if (!value || !Array.isArray(value.answers) || value.answers.length > 3 || !value.answers.every(function (a) { return Object.prototype.hasOwnProperty.call(LABELS, a); })) return { answers: [] };
    return { answers: value.answers.slice(), completed: value.completed === true && value.answers.length === 3, returnCounted: value.returnCounted === true };
  }
  function score(questions, answers) { return questions.reduce(function (n, q, i) { return n + (q.answer === answers[i] ? 1 : 0); }, 0); }
  function shareText(day, questions, answers) { return 'Real or misquoted? · ' + day + '\n' + score(questions, answers) + '/3\n' + questions.map(function (q, i) { return q.answer === answers[i] ? '🟩' : '🟪'; }).join('') + '\nThree claims. Can you spot them?'; }
  function boot() {
    var doc = win.document, payload = doc.getElementById('challenge-data'), mount = doc.getElementById('challenge-root');
    if (!payload || !mount) return;
    var A = win.QuotleAudience, data, questions;
    try { data = JSON.parse(payload.textContent); questions = selectQuestions(data.questions, requestedDay(win.location.hash, dayInNewYork(new Date()), data.starts), data.version); }
    catch (_) { mount.textContent = 'The challenge could not load. You can still explore the researched quotes from the menu.'; return; }
    var today = dayInNewYork(new Date()), day = requestedDay(win.location.hash, today, data.starts), history = {};
    try { history = JSON.parse(win.localStorage.getItem(STORAGE_KEY)) || {}; if (typeof history !== 'object' || Array.isArray(history)) history = {}; } catch (_) {}
    Object.keys(history).forEach(function (k) { if (!validDay(k) || Math.abs(Date.parse(today) - Date.parse(k)) > 30 * 86400000) delete history[k]; });
    var entry = cleanEntry(history[day]), index = Math.min(entry.answers.length, 2), showResult = entry.answers.length === 3;
    function save() { history[day] = entry; try { win.localStorage.setItem(STORAGE_KEY, JSON.stringify(history)); } catch (_) {} }
    function el(tag, text, cls) { var e = doc.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; }
    function button(text, action, cls) { var b = el('button', text, cls || 'aud-btn'); b.type = 'button'; b.addEventListener('click', action); return b; }
    function focus(e) { e.tabIndex = -1; e.focus(); }
    function status(text) { doc.getElementById('challenge-status').textContent = text; }
    function completion() {
      if (entry.answers.length !== 3 || entry.completed) return;
      entry.completed = true; save(); A.track('challenge-complete');
    }
    function sourceLink(q) { var a = el('a', 'Read the sources →'); a.href = q.url; a.target = '_blank'; a.rel = 'noopener'; return a; }
    function render(announce) {
      mount.replaceChildren();
      if (showResult) { renderResult(announce); return; }
      var q = questions[index], chosen = entry.answers[index], panel = el('section', '', 'challenge-panel'); panel.setAttribute('aria-labelledby', 'challenge-question-heading');
      var kicker = el('p', day + ' · Question ' + (index + 1) + ' of 3', 'challenge-kicker');
      var title = el('h2', 'What do the sources say?'); title.id = 'challenge-question-heading';
      var claim = el('p', q.claim, 'challenge-claim'), choices = el('div', '', 'challenge-options'); choices.setAttribute('role', 'group'); choices.setAttribute('aria-label', 'Choose an attribution verdict');
      Object.keys(LABELS).forEach(function (key) {
        var b = button(LABELS[key], function () {
          if (entry.answers[index] !== undefined) return;
          if (!entry.answers.length) A.track('challenge-start');
          entry.answers.push(key); save(); completion(); render(true);
        }, 'challenge-option');
        b.disabled = chosen !== undefined;
        if (chosen !== undefined && key === q.answer) { b.dataset.correct = 'true'; b.append(el('small', chosen === key ? 'Your answer · Supported by the research' : 'Answer from the research')); }
        if (chosen === key && key !== q.answer) { b.dataset.wrong = 'true'; b.append(el('small', 'Your answer')); }
        choices.append(b);
      });
      panel.append(kicker, title, claim, choices);
      if (chosen !== undefined) {
        var reveal = el('div', '', 'challenge-reveal'), result = el('h3', (chosen === q.answer ? 'You spotted it. ' : 'The evidence says: ') + LABELS[q.answer]); result.id = 'challenge-answer';
        reveal.append(result, el('p', q.explanation), sourceLink(q));
        reveal.append(el('div', '', 'aud-actions')); reveal.lastChild.append(button(index === 2 ? 'See my result' : 'Next claim →', function () { if (index === 2) showResult = true; else index++; render(true); }, 'aud-btn aud-btn-primary'));
        panel.append(reveal);
      }
      mount.append(panel);
      if (announce) focus(chosen !== undefined ? doc.getElementById('challenge-answer') : title);
    }
    function renderResult(announce) {
      var panel = el('section', '', 'challenge-panel'), title = el('h2', 'You checked the claims.');
      panel.append(el('p', day + ' · Daily challenge', 'challenge-kicker'), title, el('p', score(questions, entry.answers) + '/3', 'challenge-score'));
      var blocks = el('p', questions.map(function (q, i) { return q.answer === entry.answers[i] ? '🟩' : '🟪'; }).join(''), 'challenge-blocks'); blocks.setAttribute('aria-label', questions.map(function (q, i) { return 'Question ' + (i + 1) + ': ' + (q.answer === entry.answers[i] ? 'correct' : 'incorrect'); }).join('. ')); panel.append(blocks);
      panel.append(el('p', 'Share your score. Keep the answers a surprise.'));
      var actions = el('div', '', 'aud-actions'), url = A.shareUrl('https://quotle.info/challenge/#' + data.version + '/' + day, 'challenge');
      actions.append(button('Share my result', async function () {
        var text = shareText(day, questions, entry.answers);
        try { if (win.navigator.share) { await win.navigator.share({ title: 'Real or misquoted?', text: text, url: url }); } else { await A.copy(text + '\n' + url); status('Score and challenge link copied.'); } A.track('challenge-share'); }
        catch (e) { if (e.name !== 'AbortError') status('Sharing is unavailable. Try Copy result instead.'); }
      }, 'aud-btn aud-btn-primary'));
      actions.append(button('Copy result', async function () { try { await A.copy(shareText(day, questions, entry.answers) + '\n' + url); status('Score and challenge link copied.'); A.track('challenge-share'); } catch (e) { status(e.message); } }));
      var download = button('Download score card', async function () {
        download.disabled = true;
        try {
          var c = doc.createElement('canvas'); c.width = 1080; c.height = 1080; var ctx = c.getContext('2d');
          ctx.fillStyle = '#0f0f1e'; ctx.fillRect(0, 0, 1080, 1080); ctx.fillStyle = '#d4627a'; ctx.fillRect(0, 0, 1080, 12);
          ctx.fillStyle = '#a8b0c0'; ctx.font = 'bold 28px Arial'; ctx.fillText('QUOTLE.INFO  /  THE DAILY CHALLENGE', 80, 100);
          ctx.fillStyle = '#e8e0f0'; ctx.font = 'bold 66px Georgia'; ctx.fillText('Real or misquoted?', 80, 235);
          ctx.fillStyle = '#ffd369'; ctx.font = 'bold 180px Georgia'; ctx.fillText(score(questions, entry.answers) + '/3', 80, 475);
          questions.forEach(function (q, i) { ctx.fillStyle = q.answer === entry.answers[i] ? '#7eb38b' : '#764ba2'; ctx.fillRect(85 + i * 120, 720, 85, 85); });
          ctx.fillStyle = '#a8b0c0'; ctx.font = '28px Arial'; ctx.fillText(day + ' · Three claims. Can you spot them?', 80, 870);
          ctx.fillText('quotle.info/challenge/#' + data.version + '/' + day, 80, 970);
          var blob = await A.toBlob(c), objectUrl = URL.createObjectURL(blob), a = el('a'); a.href = objectUrl; a.download = 'quotle-challenge-' + day + '.png'; doc.body.append(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 30000); A.track('challenge-score-download');
        } catch (_) { status('Image download is unavailable. You can still copy or share your result.'); } finally { download.disabled = false; }
      }); actions.append(download); panel.append(actions); mount.append(panel);
      questions.forEach(function (q, i) { var review = el('section', '', 'challenge-review'); review.append(el('h3', (i + 1) + '. ' + LABELS[q.answer]), el('p', q.claim), el('p', q.explanation), sourceLink(q)); mount.append(review); });
      var play = el('a', 'Guess an author in today’s Quotle →', 'aud-btn'); play.href = 'https://gameshelf.co/quotle/'; mount.append(play);
      if (announce) focus(title);
    }
    var sevenAgo = new Date(Date.parse(today + 'T12:00:00Z') - 7 * 86400000).toISOString().slice(0, 10);
    if (day === today && cleanEntry(history[sevenAgo]).answers.length === 3 && !entry.returnCounted) { entry.returnCounted = true; save(); win.addEventListener('load', function () { A.track('challenge-return-7d'); }, { once: true }); }
    render(false);
    // Moving between two shared dated fragments on the same page does not trigger navigation.
    // Reload that fragment so the date, saved choices and selected questions stay in sync.
    win.addEventListener('hashchange', function () { win.location.reload(); });
    win.setInterval(function () { if (dayInNewYork(new Date()) !== today) doc.getElementById('challenge-new-day').hidden = false; }, 60000);
  }
  return { boot: boot, dayInNewYork: dayInNewYork, validDay: validDay, requestedDay: requestedDay, selectQuestions: selectQuestions, cleanEntry: cleanEntry, score: score, shareText: shareText };
});
