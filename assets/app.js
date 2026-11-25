/*
 * Reading group site: renders everything from the JSON files in /data.
 * No build step and no dependencies. Edit the data files, push, done.
 */
(function () {
  'use strict';

  const Core = window.RGCore;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const SVGNS = 'http://www.w3.org/2000/svg';
  const IN_ARTIFACT = !!(window.claude && typeof window.claude.use === 'function');
  const VIEWER_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return 'UTC'; } })();

  const S = {
    config: null, sessions: [], papers: [], members: [], surveys: [],
    papersById: {}, membersById: {}, next: null, now: new Date(),
    track: 'all', cal: null, repo: null, feedUrl: null,
    paperFilter: { q: '', status: 'all', tag: '' },
    survey: null, formDirty: false
  };

  // ------------------------------------------------------------------ helpers

  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    applyProps(n, props);
    appendKids(n, kids);
    return n;
  }
  function svgEl(tag, props, ...kids) {
    const n = document.createElementNS(SVGNS, tag);
    applyProps(n, props);
    appendKids(n, kids);
    return n;
  }
  function applyProps(n, props) {
    if (!props) return;
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.setAttribute('class', v);
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
  }
  function fill(n, ...kids) {
    n.replaceChildren();
    appendKids(n, kids);
    return n;
  }
  function appendKids(n, kids) {
    for (const c of kids.flat(Infinity)) {
      if (c == null || c === false || c === '') continue;
      n.append(c.nodeType ? c : String(c));
    }
  }

  const TZ = () => S.config.timezone || 'UTC';

  function fmtDate(d, opts, tz) {
    return new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: tz || TZ() }, opts)).format(d);
  }
  function fmtTime(d, tz) {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz || TZ(), hour: 'numeric', minute: '2-digit' }).format(d);
  }
  function tzName(d, tz) {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz || TZ(), timeZoneName: 'short' })
      .formatToParts(d).find((p) => p.type === 'timeZoneName');
    return part ? part.value : (tz || TZ());
  }
  function timeRange(s, tz) {
    const a = fmtTime(s.startDate, tz);
    const b = fmtTime(s.endDate, tz);
    const ma = a.match(/^(.*?)[\s ](AM|PM)$/);
    const mb = b.match(/^(.*?)[\s ](AM|PM)$/);
    const range = ma && mb && ma[2] === mb[2] ? ma[1] + '–' + b : a + '–' + b;
    return range + ' ' + tzName(s.startDate, tz);
  }
  function dayKey(p) { return p.y + '-' + p.m + '-' + p.d; }
  function relative(d) {
    const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    const diff = d - S.now;
    const mins = Math.round(diff / 60000);
    if (Math.abs(mins) < 60) return rtf.format(mins, 'minute');
    const hrs = Math.round(diff / 3.6e6);
    if (Math.abs(hrs) < 20) return rtf.format(hrs, 'hour');
    const a = Core.tzParts(S.now, TZ());
    const b = Core.tzParts(d, TZ());
    const days = Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 864e5);
    return rtf.format(days, 'day');
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function shortAuthors(a) {
    const list = String(a || '').split(/\s*,\s*|\s+and\s+/).filter(Boolean);
    if (list.length > 3) return list[0] + ' et al.';
    if (list.length <= 1) return list.join('');
    return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
  }
  function initials(name) {
    const parts = String(name || '?').trim().split(/\s+/);
    return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }
  function statusOf(s) {
    if (s.endDate < S.now) return 'past';
    if (s.startDate <= S.now) return 'live';
    return 'upcoming';
  }
  function visualClass(s) {
    if (s === S.next) return 'next';
    return statusOf(s) === 'past' ? 'past' : 'upcoming';
  }
  function trackInfo(id) {
    if (!id || !(S.config.tracks || []).length) return null;
    const tracks = S.config.tracks || [];
    const i = tracks.findIndex((t) => t.id === id);
    const shapes = ['circle', 'square'];
    if (i === -1) return { id, name: id, shape: 'diamond' };
    return Object.assign({ shape: shapes[i] || 'diamond' }, tracks[i]);
  }
  function trackIcon(id) {
    const t = trackInfo(id);
    if (!t || !(S.config.tracks || []).length) return null;
    return el('span', { class: 'track-icon ' + t.shape, 'aria-hidden': 'true' });
  }
  function personName(id) { return (S.membersById[id] || { name: id }).name; }
  function filteredSessions() {
    return S.sessions.filter((s) => S.track === 'all' || s.track === S.track);
  }
  function siteUrl() {
    if (location.protocol === 'file:') return '';
    return location.origin + location.pathname.replace(/index\.html$/, '');
  }
  function icsCtx() {
    return { config: S.config, papersById: S.papersById, membersById: S.membersById, siteUrl: siteUrl() };
  }
  function canDownload() { return !IN_ARTIFACT; }
  function download(filename, text, type) {
    const blob = new Blob([text], { type: type || 'text/calendar;charset=utf-8' });
    const a = el('a', { href: URL.createObjectURL(blob), download: filename });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function setHash(h) {
    if (location.hash === h) return;
    try { history.replaceState(null, '', h); } catch (e) { /* sandboxed frame */ }
  }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

  function detectRepo(cfg) {
    let owner = (cfg.github && cfg.github.owner) || '';
    let repo = (cfg.github && cfg.github.repo) || '';
    const m = location.hostname.match(/^([a-z0-9-]+)\.github\.io$/i);
    if (m) {
      owner = owner || m[1];
      if (!repo) {
        const seg = location.pathname.split('/').filter(Boolean)[0];
        repo = seg && !seg.includes('.') ? seg : m[1] + '.github.io';
      }
    }
    return owner && repo ? { owner, repo, branch: (cfg.github && cfg.github.branch) || 'main' } : null;
  }

  // ------------------------------------------------------------------ loading

  async function loadJSON(name) {
    const res = await fetch('data/' + name + '.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('Could not load data/' + name + '.json (HTTP ' + res.status + ').');
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) {
      throw new Error('data/' + name + '.json has a formatting error: ' + e.message + '. A missing comma or quote is the usual cause.');
    }
  }

  function showError(err) {
    const box = $('#load-error');
    box.hidden = false;
    box.replaceChildren();
    if (location.protocol === 'file:') {
      box.append(
        el('strong', null, 'This page needs a web server to read its data files. '),
        'Run ', el('code', null, 'python3 -m http.server'), ' in the site folder and open ',
        el('code', null, 'http://localhost:8000'), ', or view it on GitHub Pages.'
      );
    } else {
      box.append(el('strong', null, 'Something in the data files needs fixing. '), String(err.message || err));
    }
    $('#next-session').replaceChildren(el('p', { class: 'muted' }, 'The schedule could not be loaded.'));
  }

  async function boot() {
    if (!Core) { showError(new Error('assets/core.js did not load.')); return; }
    try {
      const [config, sessions, papers, members, surveys] =
        await Promise.all(['config', 'sessions', 'papers', 'members', 'surveys'].map(loadJSON));
      S.config = config || {};
      S.basePapers = papers || [];
      S.baseSessions = sessions || [];
      S.remoteSessions = [];
      S.members = members || [];
      S.surveys = surveys || [];
      S.membersById = Object.fromEntries(S.members.map((m) => [m.id, m]));
      rebuildData();
      S.repo = detectRepo(S.config);
      const ref = S.next ? S.next.startDate : S.now;
      const p = Core.tzParts(ref, TZ());
      S.cal = { y: p.y, m: p.m };
    } catch (err) {
      showError(err);
      return;
    }

    const steps = [bindText, setupPdfDialog, renderNext, () => renderRoadmap(true), renderAbout, renderTrackFilter,
      renderCalendar, renderAgenda, setupCalendarActions, renderPaperToolbar, renderPapers,
      renderPeople, renderSurveyTabs, renderFooter, renderEditButtons];
    for (const step of steps) {
      try { step(); } catch (err) { console.error(err); }
    }
    handleHash();
    window.addEventListener('hashchange', handleHash);
    initBackend();
  }

  // ------------------------------------------------------------------ answer storage
  // Answers are kept in one place, depending on where the page runs:
  //  - on claude.ai (artifact): the page's own database
  //  - on GitHub Pages: a Google Sheet, through config.voteUrl (see scripts/vote-backend.gs)
  //  - otherwise: nowhere yet, and the form says so.

  const B = { kind: 'none', status: 'off', rows: null, error: null, db: null, canEdit: false, canWrite: null };

  function hasClaude() { return !!(window.claude && typeof window.claude.use === 'function'); }
  async function waitForClaude(ms) {
    const start = Date.now();
    while (!hasClaude() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 100));
    return hasClaude();
  }

  async function initBackend() {
    let inArtifact = IN_ARTIFACT || hasClaude();
    const knownHost = location.protocol === 'file:' || /(^|\.)github\.io$|^localhost$|^127\.0\.0\.1$/.test(location.hostname);
    if (!inArtifact && !knownHost && !/^https:\/\//.test(S.config.voteUrl || '')) {
      B.kind = 'pending';
      B.status = 'loading';
      onBackendChange(true);
      inArtifact = await waitForClaude(4000);
    }
    if (inArtifact) {
      B.kind = 'artifact';
      B.status = 'loading';
      const timer = setTimeout(() => {
        if (B.status === 'loading') { B.status = 'timeout'; onBackendChange(true); }
      }, 10000);
      try {
        const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
        if (user) {
          try { B.canWrite = await user.can('data.write'); } catch (e) { B.canWrite = null; }
          try { B.canEdit = !!(await user.canEdit()); } catch (e) { B.canEdit = false; }
        }
        if (!db) { clearTimeout(timer); B.status = 'unavailable'; onBackendChange(true); return; }
        B.db = db;
        db.collection('sessions').onSnapshot((snap) => {
          setRemoteSessions(snap.docs.map((d) => Object.assign({ id: d.id }, d.data() || {})));
        }, () => { /* schedule edits unavailable; sessions.json still shows */ });
        db.collection('votes').onSnapshot((snap) => {
          B.rows = snap.docs.map((d) => d.data() || {}).filter(validRow);
          const before = B.status;
          if (!snap.metadata.fromCache) { clearTimeout(timer); B.status = 'ready'; }
          else if (B.status === 'loading') B.status = 'cached';
          onBackendChange(before !== B.status && (before === 'loading' || before === 'timeout'));
        }, (err) => {
          clearTimeout(timer);
          B.status = 'error';
          B.error = err && err.code;
          onBackendChange(true);
        });
      } catch (e) {
        clearTimeout(timer);
        B.status = 'unavailable';
        onBackendChange(true);
      }
      return;
    }
    if (/^https:\/\//.test(S.config.voteUrl || '')) {
      B.kind = 'sheet';
      B.status = 'loading';
      await loadSheet();
      return;
    }
    const wasPending = B.kind === 'pending';
    B.kind = 'none';
    B.status = 'off';
    if (wasPending) onBackendChange(true);
  }

  async function loadSheet() {
    const before = B.status;
    try {
      const url = S.config.voteUrl + (S.config.voteUrl.includes('?') ? '&' : '?') + 't=' + Date.now();
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const body = await res.json();
      B.rows = (body.rows || []).filter(validRow);
      if (Array.isArray(body.sessions)) setRemoteSessions(body.sessions);
      B.status = 'ready';
    } catch (e) {
      B.status = 'error';
      B.error = String(e.message || e);
    }
    onBackendChange(before !== B.status);
  }

  function validRow(r) {
    return !!r && typeof r.survey === 'string' && typeof r.key === 'string' && !!r.answers && typeof r.answers === 'object';
  }

  function onBackendChange(statusChanged) {
    if (statusChanged) {
      try { renderNext(); renderEditButtons(); } catch (e) { console.error(e); }
    }
    if (!S.survey) return;
    if (statusChanged && !S.formDirty) { renderSurveyPanel(); return; }
    const box = $('#survey-panel .results');
    const sv = S.surveys.find((v) => v.id === S.survey);
    if (box && sv) renderResults(sv, box);
  }

  function latestRows(sv) {
    const rows = (B.rows || []).filter((r) => r.survey === sv.id)
      .sort((a, b) => (String(a.at) < String(b.at) ? 1 : -1));
    const seen = new Set();
    return rows.filter((r) => {
      if (seen.has(r.key)) return false;
      seen.add(r.key);
      return true;
    });
  }

  function answerKey(sv, answers) {
    const name = String(answers.name || '').trim().toLowerCase();
    const parts = [name || 'anon-' + Math.random().toString(36).slice(2)];
    for (const k of sv.dedupeBy || []) parts.push(String(answers[k] == null ? '' : answers[k]));
    return parts.join(' | ');
  }

  async function submitAnswers(sv, answers) {
    const row = { survey: sv.id, key: answerKey(sv, answers), at: new Date().toISOString(), answers };
    if (B.kind === 'artifact') {
      await B.db.collection('votes').add(row);
      return;
    }
    if (B.kind === 'sheet') {
      await sheetPost(row);
      B.rows = (B.rows || []).concat([row]);
      onBackendChange(false);
      setTimeout(loadSheet, 2000);
      return;
    }
    throw new Error('not connected');
  }

  function handleHash() {
    const h = decodeURIComponent(location.hash || '');
    if (h.startsWith('#session-')) openSession(h.slice(9), false);
    else if (h.startsWith('#survey-')) selectSurvey(h.slice(8), true);
  }

  // ------------------------------------------------------------------ header / text

  function bindText() {
    const c = S.config;
    for (const n of $$('[data-bind]')) {
      const v = c[n.dataset.bind];
      if (v) n.textContent = v;
      else if (n.dataset.bind !== 'groupName') n.hidden = true;
    }
    if (!c.regularTime) $('.regular').hidden = true;
    if (c.groupName) document.title = c.groupName;
    if (c.labUrl) {
      const a = $('#nav-lab');
      a.href = c.labUrl;
      a.textContent = c.labName || 'Lab';
      a.closest('li').hidden = false;
    }
  }

  // ------------------------------------------------------------------ next session

  function citation(p) {
    const href = p.url || p.pdf;
    const meta = [p.authors ? shortAuthors(p.authors) + (p.year ? ' (' + p.year + ')' : '') : String(p.year || ''), p.venue].filter(Boolean).join('. ');
    return el('li', null,
      href ? el('a', { class: 'citation-title', href, target: '_blank', rel: 'noopener' }, p.title) : el('span', { class: 'citation-title' }, p.title),
      meta ? el('span', { class: 'citation-meta' }, meta) : null
    );
  }

  function whereNode(s) {
    const loc = s.location || S.config.defaultLocation;
    const link = s.meetingLink || S.config.meetingLink;
    if (!loc && !link) return null;
    return el('span', null, loc || '', link ? [loc ? ' (' : '', el('a', { href: link, target: '_blank', rel: 'noopener' }, 'join online'), loc ? ')' : ''] : null);
  }

  function sessionActions(s, primary) {
    const row = el('div', { class: 'button-row' });
    if (statusOf(s) !== 'past') {
      row.append(el('a', {
        class: 'btn' + (primary ? ' btn-primary' : ''), href: Core.googleCalendarLink(s, icsCtx()),
        target: '_blank', rel: 'noopener'
      }, 'Add to Google Calendar'));
      if (canDownload()) row.append(el('button', {
        class: 'btn', type: 'button',
        onclick: () => download('session-' + s.number + '.ics', Core.buildICS([s], icsCtx()))
      }, 'Download .ics'));
    }
    const firstPaper = (s.papers || []).map((id) => S.papersById[id]).find((p) => p && (p.pdf || p.url));
    if (primary && firstPaper) {
      row.append(pdfControl(firstPaper, 'btn', s.papers.length > 1 ? 'Read the first paper' : 'Read the paper'));
    }
    if (s.slides) row.append(el('a', { class: 'btn', href: s.slides, target: '_blank', rel: 'noopener' }, 'Slides'));
    if (s.recording) row.append(el('a', { class: 'btn', href: s.recording, target: '_blank', rel: 'noopener' }, 'Recording'));
    if (s.notes) row.append(el('a', { class: 'btn', href: s.notes, target: '_blank', rel: 'noopener' }, 'Notes'));
    return row.childElementCount ? row : null;
  }

  function renderNext() {
    const box = $('#next-session');
    box.replaceChildren();
    const s = S.next;
    if (!s) {
      const hasTopic = S.surveys.some((v) => v.id === 'vote');
      fill(box,
        el('p', { class: 'next-kicker' }, el('span', null, 'Next session')),
        el('h2', { class: 'next-title' }, 'Nothing scheduled yet'),
        el('p', { class: 'muted' }, 'The next block is being planned. Vote for the topics and meeting times that suit you.'),
        el('div', { class: 'button-row' },
          canEditSchedule() ? el('button', { class: 'btn btn-primary', type: 'button', onclick: () => openEditor('new') }, 'Add a session') : null,
          hasTopic ? el('a', { class: canEditSchedule() ? 'btn' : 'btn btn-primary', href: '#survey-vote' }, 'Vote on topics and times') : null,
          el('a', { class: 'btn', href: '#survey-' + ((S.config.participation || {}).presentSurveyId || 'present') }, 'Volunteer to present'))
      );
      return;
    }
    const live = statusOf(s) === 'live';
    const papers = (s.papers || []).map((id) => S.papersById[id]).filter(Boolean);
    const t = trackInfo(s.track);
    const local = timeRange(s, VIEWER_TZ);
    const group = timeRange(s, TZ());
    const localDay = fmtDate(s.startDate, { weekday: 'short' }, VIEWER_TZ);
    const groupDay = fmtDate(s.startDate, { weekday: 'short' });

    const facts = el('dl', { class: 'facts' },
      el('dt', null, 'Session'), el('dd', null, String(s.number), t ? ', ' + t.name + ' track' : ''),
      (s.presenters || []).length ? [el('dt', null, 'Presenting'), el('dd', null, s.presenters.map(personName).join(', '))] : null,
      whereNode(s) ? [el('dt', null, 'Where'), el('dd', null, whereNode(s))] : null,
      s.prep ? [el('dt', null, 'Prepare'), el('dd', null, s.prep)] : null
    );

    fill(box,
      el('p', { class: 'next-kicker' },
        el('span', null, live ? 'Happening now' : 'Next session'),
        el('strong', null, live ? 'Started ' + relative(s.startDate) : relative(s.startDate))),
      el('p', { class: 'next-when' }, fmtDate(s.startDate, { weekday: 'long', day: 'numeric', month: 'long' })),
      el('p', { class: 'next-time' }, group,
        local !== group ? el('span', { class: 'local' }, ' (your time: ' + (localDay !== groupDay ? localDay + ' ' : '') + local + ')') : null),
      el('h2', { class: 'next-title' }, el('a', { href: '#session-' + s.id, onclick: (e) => { e.preventDefault(); openSession(s.id, true); } }, s.title)),
      papers.length ? el('ul', { class: 'citations' }, papers.map(citation)) : null,
      facts,
      (s.questions || []).length ? el('details', { class: 'next-questions' },
        el('summary', null, 'Discussion questions (' + s.questions.length + ')'),
        el('ul', { class: 'question-list' }, s.questions.map((q) => el('li', null, q)))) : null,
      sessionActions(s, true),
      canEditSchedule() ? el('p', { class: 'edit-link' },
        el('button', { class: 'btn btn-quiet', type: 'button', onclick: () => openEditor(s.id) }, 'Edit this session'),
        el('button', { class: 'btn btn-quiet', type: 'button', onclick: () => openEditor('new') }, 'Add a session')) : null
    );
  }

  // ------------------------------------------------------------------ roadmap DAG

  function renderRoadmap(animate) {
    const canvas = $('#roadmap');
    canvas.replaceChildren();
    const availW = canvas.clientWidth || 640;
    const availH = canvas.clientHeight || 0;
    const from = S.config.roadmapFrom ? Core.parseStart(S.config.roadmapFrom, TZ()) : null;
    const ss = S.sessions.filter((s) => !from || s.startDate >= from);
    $('#roadmap-legend').hidden = false;
    if (!ss.length) {
      canvas.append(el('p', { class: 'muted roadmap-empty' }, 'The roadmap fills in as sessions are scheduled.'));
      $('#roadmap-legend').hidden = true;
      return;
    }
    const byId = new Map(ss.map((s) => [s.id, s]));
    const anyEdges = ss.some((s) => (s.builds_on || []).some((id) => byId.has(id)));
    const parentsOf = (s, i) => anyEdges
      ? (s.builds_on || []).filter((id) => byId.has(id) && id !== s.id)
      : (i > 0 ? [ss[i - 1].id] : []);
    const parents = new Map(ss.map((s, i) => [s.id, parentsOf(s, i)]));

    const depth = new Map();
    const visiting = new Set();
    function depthOf(id) {
      if (depth.has(id)) return depth.get(id);
      if (visiting.has(id)) return 0; // cycle guard
      visiting.add(id);
      const ps = parents.get(id) || [];
      const d = ps.length ? Math.max(...ps.map(depthOf)) + 1 : 0;
      visiting.delete(id);
      depth.set(id, d);
      return d;
    }
    const cols = [];
    for (const s of ss) (cols[depthOf(s.id)] = cols[depthOf(s.id)] || []).push(s);

    const padX = 62;
    const maxRows = Math.max(...cols.map((c) => (c ? c.length : 0)));
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const colW = cols.length > 1 ? clamp((availW - 2 * padX) / (cols.length - 1), 112, 230) : 0;
    const rowH = maxRows > 1 ? clamp((availH - 34 - 70) / (maxRows - 1), 92, 150) : 92;
    const pos = new Map();
    cols.forEach((col, ci) => {
      if (!col) return;
      if (ci > 0) {
        const bary = (s) => {
          const ys = parents.get(s.id).map((id) => pos.get(id)).filter(Boolean).map((p) => p.y);
          return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0;
        };
        col.sort((a, b) => bary(a) - bary(b) || a.startDate - b.startDate);
      }
      col.forEach((s, i) => {
        pos.set(s.id, { x: padX + ci * colW, y: 34 + ((maxRows - col.length) / 2 + i) * rowH });
      });
    });

    const width = padX * 2 + (cols.length - 1) * colW;
    const height = 34 + (maxRows - 1) * rowH + 66;
    const svg = svgEl('svg', {
      viewBox: '0 0 ' + width + ' ' + height, role: 'group',
      'aria-label': 'Reading roadmap with ' + plural(ss.length, 'session')
    });
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));

    const defs = svgEl('defs');
    for (const [id, cls] of [['arrow', 'dag-arrow'], ['arrow-future', 'dag-arrow-future']]) {
      defs.append(svgEl('marker', { id: 'rg-' + id, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' },
        svgEl('path', { d: 'M0 0 L10 5 L0 10 z', class: cls })));
    }
    svg.append(defs);

    const R = 15;
    const edges = svgEl('g', { 'aria-hidden': 'true' });
    ss.forEach((s, i) => {
      for (const pid of parents.get(s.id)) {
        const a = pos.get(pid), b = pos.get(s.id);
        const x1 = a.x + R + 3, y1 = a.y, x2 = b.x - R - 6, y2 = b.y;
        const dx = Math.max(24, (x2 - x1) * 0.5);
        const future = statusOf(s) !== 'past';
        edges.append(svgEl('path', {
          d: 'M' + x1 + ' ' + y1 + ' C' + (x1 + dx) + ' ' + y1 + ' ' + (x2 - dx) + ' ' + y2 + ' ' + x2 + ' ' + y2,
          class: 'dag-edge' + (future ? ' future' : ''),
          'marker-end': 'url(#rg-' + (future ? 'arrow-future' : 'arrow') + ')',
          style: 'animation-delay:' + (i * 45 + 60) + 'ms'
        }));
      }
    });
    svg.append(edges);

    ss.forEach((s, i) => {
      const { x, y } = pos.get(s.id);
      const vc = visualClass(s);
      const t = trackInfo(s.track);
      const shape = t ? t.shape : 'circle';
      const g = svgEl('g', {
        class: 'dag-node ' + vc + (S.track !== 'all' && s.track !== S.track ? ' dim' : ''),
        'data-track': s.track || '', style: 'animation-delay:' + i * 45 + 'ms'
      });
      const label = s.label || (s.title.length > 20 ? s.title.slice(0, 19) + '…' : s.title);
      const a = svgEl('a', {
        href: '#session-' + s.id,
        'aria-label': 'Session ' + s.number + ': ' + s.title + ', ' + fmtDate(s.startDate, { day: 'numeric', month: 'long' }) + (vc === 'next' ? ' (next)' : ''),
        onclick: (e) => { e.preventDefault(); openSession(s.id, true); }
      });
      a.append(svgEl('rect', { class: 'dag-hit', x: x - 62, y: y - 24, width: 124, height: 82 }));
      if (vc === 'next') {
        a.append(shape === 'circle'
          ? svgEl('circle', { class: 'ring', cx: x, cy: y, r: R + 6 })
          : svgEl('rect', { class: 'ring', x: x - R - 6, y: y - R - 6, width: (R + 6) * 2, height: (R + 6) * 2, rx: 8, transform: shape === 'diamond' ? 'rotate(45 ' + x + ' ' + y + ')' : null }));
      }
      a.append(shape === 'circle'
        ? svgEl('circle', { class: 'shape', cx: x, cy: y, r: R })
        : svgEl('rect', { class: 'shape', x: x - R + 1, y: y - R + 1, width: (R - 1) * 2, height: (R - 1) * 2, rx: 4, transform: shape === 'diamond' ? 'rotate(45 ' + x + ' ' + y + ')' : null }));
      a.append(svgEl('text', { class: 'num', x: x, y: y + 0.5 }, String(s.number)));
      a.append(svgEl('text', { class: 'label', x: x, y: y + R + 20 }, label));
      a.append(svgEl('text', { class: 'date', x: x, y: y + R + 36 }, fmtDate(s.startDate, { day: 'numeric', month: 'short' })));
      a.append(svgEl('title', null, 'Session ' + s.number + ': ' + s.title));
      g.append(a);
      svg.append(g);
    });

    canvas.classList.toggle('animate', !!animate);
    canvas.append(svg);
    const hint = $('#roadmap-hint');
    if (hint) hint.hidden = canvas.scrollWidth <= canvas.clientWidth + 2;
    if (animate) {
      const next = pos.get(S.next && S.next.id);
      if (next && canvas.scrollWidth > canvas.clientWidth) {
        canvas.scrollLeft = Math.max(0, next.x - canvas.clientWidth / 2);
      }
      let lastW = availW;
      let timer;
      window.addEventListener('resize', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (Math.abs(canvas.clientWidth - lastW) < 8) return;
          lastW = canvas.clientWidth;
          renderRoadmap(false);
        }, 150);
      });
    }
    renderLegend(ss);
  }

  function legendSvg(kind) {
    const s = svgEl('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' });
    const g = svgEl('g', { class: 'dag-node ' + kind });
    if (kind === 'next') g.append(svgEl('circle', { class: 'ring', cx: 8, cy: 8, r: 7.2 }));
    g.append(svgEl('circle', { class: 'shape', cx: 8, cy: 8, r: kind === 'next' ? 4.6 : 6 }));
    s.append(g);
    return s;
  }

  function renderLegend(ss) {
    const lg = $('#roadmap-legend');
    lg.replaceChildren(
      el('span', { class: 'legend-item' }, legendSvg('past'), 'Discussed'),
      el('span', { class: 'legend-item' }, legendSvg('next'), 'Next'),
      el('span', { class: 'legend-item' }, legendSvg('upcoming'), 'Planned')
    );
    const used = new Set(ss.map((s) => s.track).filter(Boolean));
    for (const id of used) {
      const t = trackInfo(id);
      lg.append(el('span', { class: 'legend-item' }, trackIcon(id), t.name));
    }
  }

  // ------------------------------------------------------------------ about

  function renderAbout() {
    const c = S.config;
    const scope = c.scope || {};
    $('#scope-intro').textContent = scope.intro || '';
    $('#scope-topics').replaceChildren(...(scope.topics || []).map((t) => el('li', null, t)));
    const fmt = Array.isArray(c.format) ? { steps: c.format } : (c.format || {});
    $('#format').replaceChildren(...(fmt.steps || []).map((t) => el('li', null, el('span', null, t))));
    const note = $('#format-note');
    note.textContent = fmt.note || '';
    note.hidden = !fmt.note;
    const part = c.participation || {};
    $('#participation').textContent = part.intro || '';
    $('#tracks').hidden = !(c.tracks || []).length;
    $('#tracks').replaceChildren(...(c.tracks || []).map((t) =>
      el('div', null, trackIcon(t.id), el('dt', null, t.name + ' track'), el('dd', null, t.description || ''))));
    const actions = $('#participate-actions');
    const present = S.surveys.find((v) => v.id === (part.presentSurveyId || 'present'));
    const join = S.surveys.find((v) => v.id === (part.joinSurveyId || 'join'));
    fill(actions,
      present ? el('a', { class: 'btn btn-primary', href: '#survey-' + present.id }, 'Volunteer to present') : null,
      join ? el('a', { class: 'btn', href: '#survey-' + join.id }, 'Join the group') : null,
      c.contactEmail ? el('a', { class: 'btn btn-quiet', href: 'mailto:' + c.contactEmail }, 'Email the organizers') : null
    );
    if (!actions.childElementCount) actions.hidden = true;
  }

  // ------------------------------------------------------------------ schedule

  function renderTrackFilter() {
    const box = $('#track-filter');
    const tracks = S.config.tracks || [];
    if (tracks.length < 2) { box.hidden = true; }
    const opts = [{ id: 'all', name: 'All sessions' }].concat(tracks);
    box.replaceChildren(...opts.map((t) => el('button', {
      type: 'button', 'aria-pressed': String(S.track === t.id),
      onclick: () => {
        S.track = t.id;
        $$('button', box).forEach((b, i) => b.setAttribute('aria-pressed', String(opts[i].id === t.id)));
        renderCalendar();
        renderAgenda();
        $$('#roadmap .dag-node').forEach((g) => g.classList.toggle('dim', t.id !== 'all' && g.dataset.track !== t.id));
      }
    }, t.id === 'all' ? null : trackIcon(t.id), t.id === 'all' ? '' : ' ', t.name)));
    const ref = S.next ? S.next.startDate : S.now;
    let note = 'Times are shown in ' + tzName(ref) + ' (' + TZ().replace(/_/g, ' ') + ').';
    if (tzName(ref, VIEWER_TZ) !== tzName(ref)) note += ' Your device is on ' + tzName(ref, VIEWER_TZ) + '.';
    $('#tz-note').textContent = note;
  }

  function renderCalendar() {
    const box = $('#calendar');
    box.replaceChildren();
    const { y, m } = S.cal;
    const monthName = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
    const shift = (delta) => {
      const d = new Date(Date.UTC(y, m - 1 + delta, 1));
      S.cal = { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
      S.calTouched = true;
      renderCalendar();
      $('#calendar .cal-nav button[data-dir="' + (delta < 0 ? 'prev' : 'next') + '"]').focus();
    };
    const today = Core.tzParts(S.now, TZ());
    box.append(el('div', { class: 'cal-head' },
      el('h3', { class: 'cal-title', 'aria-live': 'polite' }, monthName),
      el('div', { class: 'cal-nav' },
        el('button', { class: 'btn', type: 'button', 'data-dir': 'prev', 'aria-label': 'Previous month', onclick: () => shift(-1) }, '‹'),
        el('button', { class: 'btn', type: 'button', onclick: () => { S.cal = { y: today.y, m: today.m }; renderCalendar(); } }, 'Today'),
        el('button', { class: 'btn', type: 'button', 'data-dir': 'next', 'aria-label': 'Next month', onclick: () => shift(1) }, '›'))));

    const byDay = new Map();
    for (const s of filteredSessions()) {
      const k = dayKey(Core.tzParts(s.startDate, TZ()));
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(s);
    }
    const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const total = Math.ceil((lead + days) / 7) * 7;
    const names = [['Mon', 'Monday'], ['Tue', 'Tuesday'], ['Wed', 'Wednesday'], ['Thu', 'Thursday'], ['Fri', 'Friday'], ['Sat', 'Saturday'], ['Sun', 'Sunday']];
    const table = el('table', { class: 'cal-table' },
      el('caption', { class: 'visually-hidden' }, 'Sessions in ' + monthName),
      el('thead', null, el('tr', null, names.map(([s, l]) => el('th', { scope: 'col' }, el('abbr', { title: l, style: 'text-decoration:none' }, s))))));
    const tbody = el('tbody');
    let row;
    let count = 0;
    for (let i = 0; i < total; i++) {
      if (i % 7 === 0) { row = el('tr'); tbody.append(row); }
      const d = i - lead + 1;
      if (d < 1 || d > days) { row.append(el('td', { class: 'out' })); continue; }
      const key = y + '-' + m + '-' + d;
      const isToday = key === dayKey(today);
      const list = byDay.get(key) || [];
      count += list.length;
      row.append(el('td', { class: isToday ? 'today' : null, 'aria-current': isToday ? 'date' : null },
        el('span', { class: 'cal-day' }, String(d)),
        list.map((s) => el('button', {
          type: 'button', class: 'cal-chip ' + visualClass(s),
          'aria-label': 'Session ' + s.number + ': ' + s.title + ', ' + fmtTime(s.startDate),
          title: s.title + ' (' + fmtTime(s.startDate) + ')',
          onclick: () => openSession(s.id, true)
        }, trackIcon(s.track), el('span', { class: 'chip-label' }, s.label || s.title), el('span', { class: 'chip-num' }, String(s.number))))
      ));
    }
    table.append(tbody);
    box.append(table);
    if (!count) {
      const upcoming = filteredSessions().find((s) => s.startDate > new Date(Date.UTC(y, m, 1)));
      box.append(el('p', { class: 'cal-empty' }, 'No sessions this month.',
        upcoming ? [' ', el('button', {
          class: 'btn btn-quiet', type: 'button',
          onclick: () => { const p = Core.tzParts(upcoming.startDate, TZ()); S.cal = { y: p.y, m: p.m }; renderCalendar(); }
        }, 'Go to the next one')] : null));
    }
  }

  function sessionItem(s) {
    const vc = visualClass(s);
    const t = trackInfo(s.track);
    const papers = (s.papers || []).map((id) => S.papersById[id]).filter(Boolean);
    const presenters = (s.presenters || []).map(personName);
    const live = statusOf(s) === 'live';
    const details = el('details', { class: 'session' + (vc === 'next' ? ' is-next' : ''), id: 'session-' + s.id, open: vc === 'next' });
    details.append(el('summary', null,
      el('span', { class: 'date-block' },
        el('span', { class: 'd' }, fmtDate(s.startDate, { day: 'numeric' })),
        el('span', { class: 'm' }, fmtDate(s.startDate, { month: 'short' }) + (Core.tzParts(s.startDate, TZ()).y !== Core.tzParts(S.now, TZ()).y ? ' ' + Core.tzParts(s.startDate, TZ()).y : ''))),
      el('span', null,
        el('span', { class: 'session-title' }, s.title),
        el('span', { class: 'session-meta' },
          el('span', null, 'Session ' + s.number),
          t ? el('span', { class: 'track' }, trackIcon(s.track), t.name) : null,
          presenters.length ? el('span', null, presenters.join(', ')) : null,
          live ? el('span', { class: 'badge' }, 'Now') : vc === 'next' ? el('span', { class: 'badge' }, 'Next') : null))
    ));
    details.append(el('div', { class: 'session-body' },
      el('dl', { class: 'facts' },
        el('dt', null, 'When'), el('dd', null, fmtDate(s.startDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + ', ' + timeRange(s)),
        whereNode(s) ? [el('dt', null, 'Where'), el('dd', null, whereNode(s))] : null,
        s.prep ? [el('dt', null, 'Prepare'), el('dd', null, s.prep)] : null),
      papers.length ? [el('h4', { class: 'subhead' }, papers.length > 1 ? 'Papers' : 'Paper'), el('ul', { class: 'citations' }, papers.map(citation))] : null,
      (s.questions || []).length ? [el('h4', { class: 'subhead' }, 'For discussion'), el('ul', { class: 'question-list' }, s.questions.map((q) => el('li', null, q)))] : null,
      sessionActions(s, false)
    ));
    return el('li', null, details);
  }

  function renderAgenda() {
    const box = $('#agenda');
    box.replaceChildren();
    const list = filteredSessions();
    const upcoming = list.filter((s) => s.endDate >= S.now);
    const past = list.filter((s) => s.endDate < S.now).reverse();
    box.append(el('div', { class: 'agenda-group' },
      el('h3', { class: 'agenda-heading' }, 'Upcoming'),
      upcoming.length
        ? el('ul', { class: 'agenda-list' }, upcoming.map(sessionItem))
        : el('p', { class: 'muted' }, S.track === 'all' ? 'No upcoming sessions yet.' : 'No upcoming sessions in this track.')));
    if (past.length) {
      box.append(el('details', { class: 'past-toggle', id: 'past-sessions' },
        el('summary', null, 'Past sessions (' + past.length + ')'),
        el('ul', { class: 'agenda-list' }, past.map(sessionItem))));
    }
  }

  function openSession(id, scroll) {
    let node = document.getElementById('session-' + id);
    if (!node && S.track !== 'all' && S.sessions.some((s) => s.id === id)) {
      S.track = 'all';
      renderTrackFilter();
      renderCalendar();
      renderAgenda();
      $$('#roadmap .dag-node').forEach((g) => g.classList.remove('dim'));
      node = document.getElementById('session-' + id);
    }
    if (!node) return;
    const past = node.closest('.past-toggle');
    if (past) past.open = true;
    node.open = true;
    const s = S.sessions.find((x) => x.id === id);
    if (s) {
      const p = Core.tzParts(s.startDate, TZ());
      if (p.y !== S.cal.y || p.m !== S.cal.m) { S.cal = { y: p.y, m: p.m }; renderCalendar(); }
    }
    node.classList.remove('flash');
    void node.offsetWidth;
    node.classList.add('flash');
    if (scroll !== false || location.hash === '#session-' + id) {
      node.scrollIntoView({ block: 'start' });
    }
    const summary = node.querySelector('summary');
    if (summary) summary.focus({ preventScroll: true });
    setHash('#session-' + id);
  }

  async function setupCalendarActions() {
    const box = $('#calendar-actions');
    if (!S.sessions.length) { box.replaceChildren(); return; }
    if (!canDownload()) {
      box.replaceChildren(el('p', { class: 'muted small', style: 'margin:0' }, 'Use "Add to Google Calendar" on any session to save it.'));
      return;
    }
    const dl = el('button', {
      class: 'btn', type: 'button',
      onclick: () => download(slug(S.config.groupName || 'reading-group') + '.ics', Core.buildICS(S.sessions, icsCtx()))
    }, 'Download all (.ics)');
    box.replaceChildren(dl);
    if (location.protocol === 'file:') return;
    try {
      const url = new URL('calendar.ics', location.href);
      const res = await fetch(url.href, { method: 'HEAD', cache: 'no-cache' });
      const type = res.headers.get('content-type') || '';
      if (!res.ok || /html/i.test(type)) return;
      S.feedUrl = url.href;
      const webcal = url.href.replace(/^https?:/, 'webcal:');
      const copy = el('button', {
        class: 'btn btn-quiet', type: 'button',
        onclick: async () => {
          try { await navigator.clipboard.writeText(url.href); copy.textContent = 'Link copied'; }
          catch (e) { window.prompt('Calendar feed URL', url.href); }
          setTimeout(() => { copy.textContent = 'Copy feed link'; }, 2000);
        }
      }, 'Copy feed link');
      box.replaceChildren(
        el('a', { class: 'btn btn-primary', href: 'https://calendar.google.com/calendar/render?cid=' + encodeURIComponent(webcal), target: '_blank', rel: 'noopener' }, 'Subscribe in Google Calendar'),
        el('a', { class: 'btn', href: webcal }, 'Subscribe in Apple or Outlook'),
        dl, copy);
      renderFooter();
    } catch (e) { /* no feed: keep the download button */ }
  }

  // ------------------------------------------------------------------ papers

  function paperStatus(p) {
    const used = S.sessions.filter((s) => (s.papers || []).includes(p.id));
    const up = used.find((s) => s.endDate >= S.now);
    if (up) return { kind: 'scheduled', s: up };
    if (used.length) return { kind: 'discussed', s: used[used.length - 1] };
    return { kind: 'backlog' };
  }

  function renderPaperToolbar() {
    $('#paper-status').hidden = true;
    $('#paper-tag').closest('label').hidden = true;
    const statuses = [['all', 'All'], ['scheduled', 'Scheduled'], ['discussed', 'Discussed'], ['backlog', 'Not yet scheduled']];
    const seg = $('#paper-status');
    seg.replaceChildren(...statuses.map(([id, name]) => el('button', {
      type: 'button', 'aria-pressed': String(S.paperFilter.status === id),
      onclick: () => {
        S.paperFilter.status = id;
        $$('button', seg).forEach((b, i) => b.setAttribute('aria-pressed', String(statuses[i][0] === id)));
        renderPapers();
      }
    }, name)));
    const tags = Array.from(new Set(S.papers.flatMap((p) => p.tags || []))).sort((a, b) => a.localeCompare(b));
    const sel = $('#paper-tag');
    sel.replaceChildren(el('option', { value: '' }, 'All tags'), ...tags.map((t) => el('option', { value: t }, t)));
    sel.onchange = () => { S.paperFilter.tag = sel.value; renderPapers(); };
    let timer;
    $('#paper-search').oninput = (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => { S.paperFilter.q = e.target.value.trim().toLowerCase(); renderPapers(); }, 120);
    };
    const actions = $('#paper-actions');
    fill(actions,
      S.config.sharedFolderUrl ? el('a', { class: 'btn', href: S.config.sharedFolderUrl, target: '_blank', rel: 'noopener' }, 'Open shared folder') : null,
      S.surveys.some((v) => v.id === 'present') ? el('a', { class: 'btn btn-quiet', href: '#survey-present' }, 'Propose a paper to present') : null
    );
  }

  function renderPapers() {
    const f = S.paperFilter;
    const none = !S.papers.length;
    $('.paper-toolbar').hidden = none || S.papers.length < 6;
    $('#paper-count').hidden = none;
    if (none) {
      $('#paper-list').replaceChildren(el('li', { class: 'empty' }, 'No papers have been added yet.'));
      return;
    }
    const order = { scheduled: 0, discussed: 1, backlog: 2 };
    const rows = S.papers.map((p) => ({ p, st: paperStatus(p) }))
      .filter(({ p, st }) => {
        if (f.status !== 'all' && st.kind !== f.status) return false;
        if (f.tag && !(p.tags || []).includes(f.tag)) return false;
        if (f.q) {
          const hay = [p.title, p.authors, p.venue, p.year, (p.tags || []).join(' ')].join(' ').toLowerCase();
          if (!f.q.split(/\s+/).every((w) => hay.includes(w))) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (order[a.st.kind] !== order[b.st.kind]) return order[a.st.kind] - order[b.st.kind];
        if (a.st.kind === 'scheduled') return a.st.s.startDate - b.st.s.startDate;
        if (a.st.kind === 'discussed') return b.st.s.startDate - a.st.s.startDate;
        return (b.p.year || 0) - (a.p.year || 0);
      });

    $('#paper-count').textContent = rows.length === S.papers.length
      ? plural(S.papers.length, 'paper')
      : rows.length + ' of ' + plural(S.papers.length, 'paper');

    const list = $('#paper-list');
    if (!rows.length) {
      list.replaceChildren(el('li', { class: 'empty' }, 'No papers match. Clear the search or pick another filter.'));
      return;
    }
    list.replaceChildren(...rows.map(({ p, st }) => {
      const sessionLink = st.s ? el('a', {
        href: '#session-' + st.s.id, onclick: (e) => { e.preventDefault(); openSession(st.s.id, true); }
      }, 'session ' + st.s.number + ', ' + fmtDate(st.s.startDate, { day: 'numeric', month: 'short' })) : null;
      const status = st.kind === 'scheduled' ? ['Scheduled for ', sessionLink]
        : st.kind === 'discussed' ? ['Discussed in ', sessionLink] : 'Not yet scheduled';
      return el('li', { class: 'paper' },
        el('div', null,
          el('h3', { class: 'paper-title' }, p.url || p.pdf ? el('a', { href: p.url || p.pdf, target: '_blank', rel: 'noopener' }, p.title) : p.title),
          el('p', { class: 'paper-authors' }, p.authors),
          el('p', { class: 'paper-venue' }, [p.venue, p.year].filter(Boolean).join(', ')),
          (p.tags || []).length ? el('ul', { class: 'tag-list', 'aria-label': 'Tags' }, p.tags.map((t) => el('li', null,
            el('button', {
              class: 'tag', type: 'button', title: 'Show papers tagged ' + t,
              onclick: () => { S.paperFilter.tag = t; $('#paper-tag').value = t; renderPapers(); }
            }, t)))) : null),
        el('div', { class: 'paper-side' },
          el('p', { class: 'paper-status ' + st.kind }, status),
          el('div', { class: 'paper-actions' },
            p.pdf ? pdfControl(p, 'btn', p.derived ? 'Open' : 'Read PDF') : null,
            p.url && !p.derived ? el('a', { class: 'btn btn-quiet', href: p.url, target: '_blank', rel: 'noopener' }, 'Paper page') : null)));
    }));
  }

  function isLocalPdf(href) {
    return !!href && !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('//') && location.protocol !== 'file:';
  }
  function pdfControl(p, cls, label) {
    const href = p.pdf || p.url;
    if (isLocalPdf(p.pdf)) return el('button', { class: cls, type: 'button', onclick: () => openPdf(p) }, label);
    return el('a', { class: cls, href, target: '_blank', rel: 'noopener' }, label);
  }
  function openPdf(p) {
    const href = p.pdf || p.url;
    if (!href) return;
    const url = new URL(href, location.href);
    const dlg = $('#pdf-dialog');
    const sameOrigin = url.origin === location.origin && location.protocol !== 'file:';
    if (!sameOrigin || typeof dlg.showModal !== 'function') {
      window.open(url.href, '_blank', 'noopener');
      return;
    }
    $('#pdf-title').textContent = p.title;
    $('#pdf-open').href = url.href;
    $('#pdf-frame').src = url.href;
    dlg.showModal();
  }

  function setupPdfDialog() {
    const dlg = $('#pdf-dialog');
    $('#pdf-close').addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => { $('#pdf-frame').removeAttribute('src'); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  }

  // ------------------------------------------------------------------ people

  function avatar(m) {
    const box = el('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(m.name));
    if (m.github) {
      const img = el('img', { src: 'https://github.com/' + encodeURIComponent(m.github) + '.png?size=128', alt: '', loading: 'lazy' });
      img.onload = () => { box.replaceChildren(img); };
      img.onerror = () => { img.remove(); };
    }
    return box;
  }

  function personCard(m, isOrganizer) {
    const presented = S.sessions.filter((s) => statusOf(s) === 'past' && (s.presenters || []).includes(m.id)).length;
    const upcoming = S.sessions.filter((s) => statusOf(s) !== 'past' && (s.presenters || []).includes(m.id)).length;
    const stats = [];
    if (presented) stats.push('Presented ' + plural(presented, 'session'));
    if (upcoming) stats.push(presented ? upcoming + ' coming up' : plural(upcoming, 'session') + ' coming up');
    const links = [];
    if (m.github) links.push(el('a', { href: 'https://github.com/' + encodeURIComponent(m.github), target: '_blank', rel: 'noopener' }, 'GitHub'));
    if (m.website) links.push(el('a', { href: m.website, target: '_blank', rel: 'noopener' }, 'Website'));
    if (isOrganizer && m.email) links.push(el('a', { href: 'mailto:' + m.email }, 'Email'));
    return el('li', { class: 'person' },
      avatar(m),
      el('div', null,
        el('p', { class: 'person-name' }, m.name),
        m.title ? el('p', { class: 'person-title' }, m.title) : null,
        (m.interests || []).length ? el('p', { class: 'person-interests' }, m.interests.join(', ')) : null,
        stats.length ? el('p', { class: 'person-stats' }, stats.join(', ')) : null,
        links.length ? el('div', { class: 'person-links' }, links) : null));
  }

  function renderPeople() {
    const orgs = S.members.filter((m) => m.role === 'organizer');
    const rest = S.members.filter((m) => m.role !== 'organizer').sort((a, b) => a.name.localeCompare(b.name));
    const blocks = $$('#people .people-block');
    if (!orgs.length && rest.length && blocks.length === 2) {
      blocks[0].hidden = true;
      $('h3', blocks[1]).textContent = 'Members';
      $('p', blocks[1]).textContent = 'Everyone in the reading group.';
    }
    $('#organizers').replaceChildren(...(orgs.length ? orgs.map((m) => personCard(m, true)) : [el('li', { class: 'muted' }, 'Organizers will be listed here.')]));
    $('#participants').replaceChildren(...(rest.length ? rest.map((m) => personCard(m, false)) : [el('li', { class: 'muted' }, 'Participants will be listed here.')]));
    if (S.config.contactEmail) {
      $('#organizer-note').append(' ', el('a', { href: 'mailto:' + S.config.contactEmail }, S.config.contactEmail));
    }
  }

  // ------------------------------------------------------------------ vote and forms

  function surveyClosesDate(sv) { return sv.closes ? Core.parseStart(sv.closes + ' 23:59', TZ()) : null; }
  function surveyClosed(sv) {
    if (sv.status === 'closed') return true;
    const c = surveyClosesDate(sv);
    return !!(c && c < S.now);
  }
  function surveyStatusText(sv) {
    if (surveyClosed(sv)) return 'Closed';
    const c = surveyClosesDate(sv);
    return c ? 'Open until ' + fmtDate(c, { day: 'numeric', month: 'short' }) : 'Open';
  }
  function resolveOptions(q) {
    if (q.type === 'grid') return gridRows(q).flatMap((r) => (q.columns || []).map((c) => r.label + ' ' + c));
    if (Array.isArray(q.options)) return q.options;
    if (typeof q.options === 'string' && q.options.startsWith('sessions')) {
      const which = q.options.split(':')[1] || 'all';
      return S.sessions
        .filter((s) => which === 'all' || (which === 'past' ? statusOf(s) !== 'upcoming' : statusOf(s) !== 'past'))
        .slice().reverse()
        .map((s) => 'Session ' + s.number + ': ' + (s.label || s.title) + ' (' + fmtDate(s.startDate, { day: 'numeric', month: 'short' }) + ')');
    }
    return [];
  }
  function gridRows(q) {
    if (Array.isArray(q.rows)) return q.rows.map((r) => ({ label: String(r), key: null }));
    const spec = q.rows || {};
    const out = [];
    const m1 = String(spec.from || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const m2 = String(spec.to || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m1 || !m2) return out;
    const fmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    const end = Date.UTC(+m2[1], +m2[2] - 1, +m2[3]);
    for (let t = Date.UTC(+m1[1], +m1[2] - 1, +m1[3]); t <= end && out.length < 120; t += 864e5) {
      const d = new Date(t);
      const dow = d.getUTCDay();
      if (spec.weekdays !== false && (dow === 0 || dow === 6)) continue;
      out.push({ label: fmt.format(d), key: d.toISOString().slice(0, 10), monday: dow === 1 });
    }
    return out;
  }
  function todayKey() {
    const p = Core.tzParts(S.now, TZ());
    return p.y + '-' + String(p.m).padStart(2, '0') + '-' + String(p.d).padStart(2, '0');
  }
  function memberNames() { return S.members.map((m) => m.name).filter(Boolean); }
  function rememberName(n) { try { localStorage.setItem('rg-name', n); } catch (e) { /* storage unavailable */ } }
  function recallName() { try { return localStorage.getItem('rg-name') || ''; } catch (e) { return ''; } }

  function renderSurveyTabs() {
    const box = $('#survey-tabs');
    if (!S.surveys.length) {
      box.hidden = true;
      $('#survey-panel').replaceChildren(el('p', { class: 'muted' }, 'No forms yet.'));
      return;
    }
    const openOnes = S.surveys.filter((v) => !surveyClosed(v));
    S.survey = S.survey || (openOnes[0] || S.surveys[0]).id;
    box.replaceChildren(...S.surveys.map((sv) => el('button', {
      type: 'button', role: 'tab', class: 'survey-tab', id: 'tab-' + sv.id,
      'aria-controls': 'survey-panel', 'aria-selected': String(sv.id === S.survey),
      tabindex: sv.id === S.survey ? '0' : '-1',
      onclick: () => selectSurvey(sv.id, false)
    }, el('span', { class: 't' }, sv.title), el('span', { class: 's' }, surveyStatusText(sv)))));
    box.addEventListener('keydown', (e) => {
      const tabs = $$('.survey-tab', box);
      const i = tabs.indexOf(document.activeElement);
      if (i === -1) return;
      let j = null;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') j = (i + 1) % tabs.length;
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
      if (e.key === 'Home') j = 0;
      if (e.key === 'End') j = tabs.length - 1;
      if (j !== null) { e.preventDefault(); tabs[j].focus(); selectSurvey(S.surveys[j].id, false); }
    });
    renderSurveyPanel();
  }

  function selectSurvey(id, scroll) {
    if (!S.surveys.some((v) => v.id === id)) return;
    S.survey = id;
    $$('.survey-tab').forEach((t) => {
      const on = t.id === 'tab-' + id;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    renderSurveyPanel();
    if (scroll) $('#surveys').scrollIntoView({ block: 'start' });
    setHash('#survey-' + id);
  }

  function renderSurveyPanel() {
    const sv = S.surveys.find((v) => v.id === S.survey);
    if (!sv) return;
    const panel = $('#survey-panel');
    panel.setAttribute('aria-labelledby', 'tab-' + sv.id);
    fill(panel,
      el('h3', null, sv.title),
      el('p', { class: 'survey-status' }, surveyStatusText(sv)),
      sv.description ? el('p', { class: 'survey-desc' }, sv.description) : null);
    S.formDirty = false;
    if (sv.externalUrl) {
      panel.append(el('div', { class: 'button-row' },
        el('a', { class: 'btn btn-primary', href: sv.externalUrl, target: '_blank', rel: 'noopener' }, 'Open the form')));
      return;
    }
    if (surveyClosed(sv)) panel.append(el('p', { class: 'muted' }, 'This is closed. Thanks to everyone who answered.'));
    else panel.append(buildForm(sv));
    if (sv.showResults !== false || (B.kind === 'artifact' && B.canEdit)) {
      const res = el('section', { class: 'results', 'aria-label': 'Results' });
      panel.append(res);
      renderResults(sv, res);
    }
  }

  // ---- questions

  function choiceList(sv, q, name, opts) {
    const isMulti = q.type === 'multi';
    const chips = q.style === 'chips';
    return el('div', { class: chips ? 'chips' : 'choices' + (q.columns > 1 ? ' cols-' + Math.min(3, q.columns) : '') },
      opts.map((o) => el('label', { class: chips ? 'chip' : 'choice' },
        el('input', { type: isMulti ? 'checkbox' : 'radio', name, value: o }),
        el('span', null, o))));
  }

  function limitChoices(fs, max) {
    fs.addEventListener('change', () => {
      const boxes = $$('input[type=checkbox]', fs);
      const n = boxes.filter((b) => b.checked).length;
      boxes.forEach((b) => {
        b.disabled = !b.checked && n >= max;
        const wrap = b.closest('.choice, .chip');
        if (wrap) wrap.classList.toggle('disabled', b.disabled);
      });
      const hint = $('.hint', fs);
      if (hint) hint.textContent = n >= max ? 'That\'s ' + max + '. Untick one to change.' : 'Choose up to ' + max + ' (' + n + ' chosen).';
    });
  }

  function buildQuestion(sv, q) {
    const name = sv.id + '__' + q.id;
    const req = q.required ? el('span', { class: 'req' }, 'Required') : null;
    const fid = 'f-' + name;
    switch (q.type) {
      case 'member': {
        const names = memberNames();
        if (!names.length) {
          return el('label', { class: 'q', 'data-q': q.id, for: fid },
            el('span', { class: 'q-label' }, q.label, req),
            el('input', { id: fid, type: 'text', name, autocomplete: 'name' }));
        }
        const other = el('input', { type: 'text', id: fid + '-other', 'aria-label': 'Your name', placeholder: 'Type your name', hidden: true });
        const sel = el('select', { id: fid, name, 'data-member': '1' },
          el('option', { value: '' }, 'Choose your name…'),
          names.map((n) => el('option', { value: n }, n)),
          el('option', { value: '__other' }, 'Someone else'));
        sel.addEventListener('change', () => {
          other.hidden = sel.value !== '__other';
          if (!other.hidden) other.focus();
        });
        return el('div', { class: 'q', 'data-q': q.id },
          el('label', { class: 'q-label', for: fid }, q.label, req), sel, other);
      }
      case 'single':
      case 'multi': {
        const fs = el('fieldset', { class: 'q', 'data-q': q.id },
          el('legend', null, q.label, req),
          q.type === 'multi' && q.max ? el('p', { class: 'hint' }, 'Choose up to ' + q.max + '.') : null,
          choiceList(sv, q, name, resolveOptions(q)));
        if (q.type === 'multi' && q.max) limitChoices(fs, q.max);
        return fs;
      }
      case 'grid': {
        const today = todayKey();
        const rows = gridRows(q);
        const table = el('table', { class: 'slot-grid' },
          el('thead', null, el('tr', null, el('td'), (q.columns || []).map((c) => el('th', { scope: 'col' }, c)))),
          el('tbody', null, rows.map((r, i) => {
            const past = !!(r.key && r.key < today);
            return el('tr', { class: (r.monday && i > 0 ? 'week-start' : '') + (past ? ' past' : '') || null },
              el('th', { scope: 'row' }, r.label),
              (q.columns || []).map((c) => el('td', null,
                el('label', { class: 'slot' },
                  el('input', { type: 'checkbox', name, value: r.label + ' ' + c, 'aria-label': r.label + ' ' + c, disabled: past }),
                  el('span', { 'aria-hidden': 'true' })))));
          })));
        return el('fieldset', { class: 'q', 'data-q': q.id },
          el('legend', null, q.label, req),
          el('p', { class: 'hint' }, q.hint || 'Tap every slot you can make.'),
          el('div', { class: 'slot-wrap' }, table));
      }
      case 'rating': {
        const scale = q.scale || 5;
        const nums = Array.from({ length: scale }, (_, i) => i + 1);
        return el('fieldset', { class: 'q', 'data-q': q.id },
          el('legend', null, q.label, req),
          el('div', { class: 'rating' }, nums.map((n) => el('label', null,
            el('input', { type: 'radio', name, value: String(n), 'aria-label': n + ' of ' + scale + (n === 1 && q.low ? ', ' + q.low : '') + (n === scale && q.high ? ', ' + q.high : '') }),
            el('span', { 'aria-hidden': 'true' }, String(n))))),
          q.low || q.high ? el('div', { class: 'rating-ends', 'aria-hidden': 'true' }, el('span', null, q.low || ''), el('span', null, q.high || '')) : null);
      }
      case 'select':
        return el('label', { class: 'q', 'data-q': q.id, for: fid },
          el('span', { class: 'q-label' }, q.label, req),
          el('select', { id: fid, name }, el('option', { value: '' }, 'Choose…'), resolveOptions(q).map((o) => el('option', { value: o }, o))));
      case 'textarea':
        return el('label', { class: 'q', 'data-q': q.id, for: fid },
          el('span', { class: 'q-label' }, q.label, req),
          el('textarea', { id: fid, name, placeholder: q.placeholder || null, rows: 4 }));
      default:
        return el('label', { class: 'q', 'data-q': q.id, for: fid },
          el('span', { class: 'q-label' }, q.label, req),
          el('input', { id: fid, type: 'text', name, placeholder: q.placeholder || null, autocomplete: 'off' }));
    }
  }

  function fieldsFor(form, sv, q) {
    const name = sv.id + '__' + q.id;
    return $$('[name="' + (window.CSS && CSS.escape ? CSS.escape(name) : name) + '"]', form);
  }

  function collectAnswers(sv, form) {
    const answers = {};
    let firstMissing = null;
    for (const q of sv.questions || []) {
      const fields = fieldsFor(form, sv, q);
      let v;
      if (q.type === 'multi' || q.type === 'grid') v = fields.filter((f) => f.checked).map((f) => f.value);
      else if (q.type === 'single' || q.type === 'rating') {
        const c = fields.find((f) => f.checked);
        v = c ? (q.type === 'rating' ? Number(c.value) : c.value) : '';
      } else if (q.type === 'member' && fields[0] && fields[0].dataset.member) {
        v = fields[0].value === '__other' ? ($('#' + fields[0].id + '-other', form) || {}).value || '' : fields[0].value;
        v = String(v).trim();
      } else {
        v = fields[0] ? fields[0].value.trim() : '';
      }
      const empty = Array.isArray(v) ? v.length === 0 : v === '' || v == null;
      if (q.required && empty && !firstMissing) firstMissing = q;
      answers[q.id] = empty ? (Array.isArray(v) ? [] : '') : v;
    }
    return { answers, firstMissing };
  }

  function prefill(form, sv, answers) {
    for (const q of sv.questions || []) {
      const v = answers[q.id];
      const fields = fieldsFor(form, sv, q);
      if (q.type === 'member') continue;
      for (const f of fields) {
        if (f.type === 'checkbox' || f.type === 'radio') f.checked = [].concat(v == null ? [] : v).map(String).includes(f.value);
        else f.value = v == null ? '' : String(v);
      }
      const fs = form.querySelector('[data-q="' + q.id + '"]');
      if (fs && q.type === 'multi') fs.dispatchEvent(new Event('change'));
    }
  }

  function setMember(form, sv, nameValue) {
    const q = (sv.questions || []).find((x) => x.type === 'member');
    if (!q || !nameValue) return;
    const sel = fieldsFor(form, sv, q)[0];
    if (!sel) return;
    if (sel.dataset.member) {
      const known = memberNames().includes(nameValue);
      sel.value = known ? nameValue : '__other';
      const other = $('#' + sel.id + '-other', form);
      if (other) { other.hidden = known; if (!known) other.value = nameValue; }
    } else {
      sel.value = nameValue;
    }
  }

  function blockedReason() {
    if (B.kind === 'pending') return 'Connecting…';
    if (B.kind === 'none') return 'Answers can\'t be saved yet. Organizers: follow "Connect voting" in the README.';
    if (B.kind === 'artifact') {
      if (B.status === 'loading') return 'Connecting…';
      if (B.status === 'unavailable' || B.status === 'error') return 'Answers can\'t be saved in this view. Open the page on claude.ai while signed in.';
      if (B.status === 'timeout') return 'Saved answers can\'t be reached yet. Check your connection.';
      if (B.canWrite === false) return 'You can see the results but not vote. Ask the page owner for Contributor access.';
    }
    return null;
  }

  function buildForm(sv) {
    const form = el('form', { class: 'survey-form', novalidate: true });
    form.append(...(sv.questions || []).map((q) => buildQuestion(sv, q)));
    const msg = el('div', { 'aria-live': 'polite' });
    const prevNote = el('p', { class: 'prev-note' });
    prevNote.hidden = true;
    const submit = el('button', { class: 'btn btn-primary btn-big', type: 'submit' }, sv.submitLabel || 'Submit');
    const blocked = blockedReason();
    if (blocked) submit.disabled = true;
    form.append(el('div', { class: 'form-foot' },
      prevNote,
      blocked ? el('p', { class: 'form-error' }, blocked) : null,
      el('div', null, submit),
      msg,
      el('p', null, 'Answering again with the same name replaces your earlier answer.')));

    const memberQ = (sv.questions || []).find((q) => q.type === 'member' || q.id === 'name');
    const showPrevious = () => {
      if (!memberQ || (sv.dedupeBy || []).length) return;
      const { answers } = collectAnswers(sv, form);
      const name = String(answers[memberQ.id] || '').trim().toLowerCase();
      const prev = name ? latestRows(sv).find((r) => r.key === name) : null;
      prevNote.hidden = !prev;
      if (prev) {
        prevNote.textContent = 'You answered on ' + fmtDate(new Date(prev.at), { day: 'numeric', month: 'short' }) + '. Your earlier choices are filled in below.';
        prefill(form, sv, prev.answers);
      }
    };
    form.addEventListener('change', (e) => {
      S.formDirty = true;
      if (memberQ && e.target && e.target.name === sv.id + '__' + memberQ.id) {
        if (e.target.value && e.target.value !== '__other') rememberName(e.target.value);
        showPrevious();
      }
    });
    form.addEventListener('input', () => { S.formDirty = true; });

    const saved = recallName();
    if (saved) { setMember(form, sv, saved); showPrevious(); }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (submit.disabled) return;
      const { answers, firstMissing } = collectAnswers(sv, form);
      if (firstMissing) {
        msg.replaceChildren(el('p', { class: 'form-error' }, 'Answer "' + firstMissing.label + '" to continue.'));
        const field = form.querySelector('[data-q="' + firstMissing.id + '"] input, [data-q="' + firstMissing.id + '"] select, [data-q="' + firstMissing.id + '"] textarea');
        if (field) field.focus();
        return;
      }
      submit.disabled = true;
      const label = submit.textContent;
      submit.textContent = 'Saving…';
      try {
        await submitAnswers(sv, answers);
        if (memberQ && answers[memberQ.id]) rememberName(answers[memberQ.id]);
        S.formDirty = false;
        msg.replaceChildren(el('p', { class: 'form-done' }, 'Thanks, ' + (answers.name || 'your answer') + (answers.name ? '. Your answer is saved.' : ' is saved.')));
      } catch (err) {
        const code = err && err.code;
        const text = code === 'invalid_argument' ? 'Your access to this page doesn\'t allow voting. Ask the owner for Contributor access.'
          : code === 'quota_exceeded' ? 'This page has run out of storage for answers. Let the organizers know.'
            : 'Couldn\'t save your answer. Check your connection and try again.';
        msg.replaceChildren(el('p', { class: 'form-error' }, text));
      }
      submit.textContent = label;
      submit.disabled = false;
    });
    return form;
  }

  // ---- results

  function barRow(label, count, denom, maxCount) {
    const pct = denom ? Math.round((count / denom) * 100) : 0;
    const width = maxCount ? (count / maxCount) * 100 : 0;
    return el('li', { class: 'bar-row', title: count + ' of ' + plural(denom, 'response') + ' (' + pct + '%)' },
      el('span', { class: 'bar-label' }, label),
      el('span', { class: 'bar-track', 'aria-hidden': 'true' },
        el('span', { class: 'bar-fill' + (count ? '' : ' zero'), style: 'display:block;width:' + width + '%' })),
      el('span', { class: 'bar-count' }, count + (denom ? ' (' + pct + '%)' : '')));
  }

  function gridResult(q, answered) {
    const counts = new Map();
    for (const v of answered) for (const x of [].concat(v)) counts.set(x, (counts.get(x) || 0) + 1);
    const max = Math.max(0, ...counts.values());
    const best = max ? resolveOptions(q).filter((k) => counts.get(k) === max) : [];
    const n = answered.length;
    const table = el('table', { class: 'slot-grid heat' },
      el('thead', null, el('tr', null, el('td'), (q.columns || []).map((c) => el('th', { scope: 'col' }, c)))),
      el('tbody', null, gridRows(q).map((row, i) => el('tr', { class: row.monday && i > 0 ? 'week-start' : null },
        el('th', { scope: 'row' }, row.label),
        (q.columns || []).map((c) => {
          const k = row.label + ' ' + c;
          const cnt = counts.get(k) || 0;
          const pct = max ? Math.round(12 + 78 * (cnt / max)) : 0;
          const style = cnt ? 'background:color-mix(in srgb, var(--accent) ' + pct + '%, var(--surface));color:' + (pct > 55 ? 'var(--on-accent)' : 'var(--ink)') : '';
          return el('td', null, el('span', {
            class: 'heat-cell' + (cnt && cnt === max ? ' best' : ''), style,
            title: k + ': ' + cnt + ' of ' + plural(n, 'voter')
          }, String(cnt)));
        })))));
    return [
      best.length ? el('p', { class: 'best-line' }, el('strong', null, best.length > 1 ? 'Most popular (tied): ' : 'Most popular: '), best.join(', ') + ' (' + max + ' of ' + n + ')') : null,
      el('div', { class: 'slot-wrap' }, table)
    ];
  }

  function whoAnswered(q, rows) {
    const names = rows.map((r) => String(r.answers[q.id] || '').trim()).filter(Boolean);
    const lower = new Set(names.map((x) => x.toLowerCase()));
    const missing = memberNames().filter((m) => !lower.has(m.toLowerCase()));
    return el('div', { class: 'who' },
      el('p', null, el('strong', null, 'Answered (' + names.length + '): '), names.length ? names.sort((a, b) => a.localeCompare(b)).join(', ') : 'nobody yet'),
      missing.length ? el('p', { class: 'muted' }, el('strong', null, 'Not yet (' + missing.length + '): '), missing.join(', ')) : null);
  }

  function renderResults(sv, box) {
    const editorsOnly = sv.showResults === false;
    const head = el('div', { class: 'results-head' }, el('h4', null, sv.resultsTitle || (editorsOnly ? 'Responses' : 'Results')));
    box.replaceChildren(head);
    if (B.kind === 'none') { box.append(el('p', { class: 'muted small' }, 'Results appear here once voting is switched on.')); return; }
    if (B.kind === 'pending') { box.append(el('p', { class: 'muted small' }, 'Loading results…')); return; }
    if (!B.rows) {
      const text = B.status === 'timeout' ? 'Results can\'t be reached yet. Check your connection.'
        : B.status === 'error' || B.status === 'unavailable' ? (B.kind === 'sheet' ? 'Couldn\'t load results from the Google Sheet. Check the voteUrl in data/config.json.' : 'Results show here when the page is opened on claude.ai while signed in.')
          : 'Loading results…';
      box.append(el('p', { class: 'muted small' }, text));
      return;
    }
    const rows = latestRows(sv);
    head.append(el('span', { class: 'muted small' },
      plural(rows.length, 'answer') + (editorsOnly ? ', shown to editors only' : ''),
      B.kind === 'sheet' ? [' ', el('button', { class: 'btn btn-quiet', type: 'button', onclick: () => { B.status = 'loading'; loadSheet(); } }, 'Refresh')] : (rows.length ? ', updating live' : '')));
    if (B.status === 'timeout' || B.status === 'cached') box.append(el('p', { class: 'muted small' }, 'These may be out of date while the connection catches up.'));
    if (editorsOnly || sv.resultsStyle === 'list') renderResponseList(sv, box, rows);
    else renderSummary(sv, box, rows);
  }

  function renderResponseList(sv, box, rows) {
    if (!rows.length) { box.append(el('p', { class: 'muted' }, sv.emptyText || 'No answers yet.')); return; }
    box.append(el('ul', { class: 'response-list' }, rows.map((r) => el('li', null,
      el('p', { class: 'response-date' }, r.at ? fmtDate(new Date(r.at), { day: 'numeric', month: 'short', year: 'numeric' }) : ''),
      el('dl', { class: 'facts' }, (sv.questions || []).map((q) => {
        const v = r.answers[q.id];
        const text = Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v);
        return text ? [el('dt', null, q.label), el('dd', null, text)] : null;
      }))))));
  }

  function renderSummary(sv, box, rows) {
    if (!rows.length) {
      box.append(el('p', { class: 'muted' }, 'No answers yet. Be the first.'));
      return;
    }
    for (const q of sv.questions || []) {
      const answered = rows.map((r) => r.answers[q.id]).filter((v) => (Array.isArray(v) ? v.length : v !== '' && v != null));
      const block = el('div', { class: 'results-q' }, el('h5', null, q.label));
      if (q.type === 'member' || q.id === 'name') {
        block.replaceChildren(whoAnswered(q, rows));
      } else if (q.type === 'grid') {
        block.append(...gridResult(q, answered).filter(Boolean));
      } else if (q.type === 'single' || q.type === 'multi' || q.type === 'select') {
        const counts = new Map(resolveOptions(q).map((o) => [o, 0]));
        for (const v of answered) for (const x of [].concat(v)) counts.set(x, (counts.get(x) || 0) + 1);
        let entries = Array.from(counts.entries());
        if (q.type === 'select') entries = entries.filter(([, c]) => c > 0);
        if (q.type === 'multi' || q.type === 'select') entries.sort((a, b) => b[1] - a[1]);
        const max = Math.max(1, ...entries.map(([, c]) => c));
        block.append(el('ul', { class: 'bars' }, entries.map(([label, c]) => barRow(label, c, answered.length, max))));
      } else if (q.type === 'rating') {
        const scale = q.scale || 5;
        const nums = answered.map(Number).filter((x) => x >= 1 && x <= scale);
        const mean = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
        const dist = Array.from({ length: scale }, (_, i) => nums.filter((x) => x === i + 1).length);
        const max = Math.max(1, ...dist);
        block.append(
          el('p', { class: 'mean' }, el('strong', null, mean.toFixed(1)), 'average from ' + plural(nums.length, 'rating') + ' (1 to ' + scale + ')'),
          el('ul', { class: 'bars' }, dist.map((c, i) => barRow(String(i + 1) + (i === 0 && q.low ? ' ' + q.low : i === scale - 1 && q.high ? ' ' + q.high : ''), c, nums.length, max))));
      } else {
        if (!answered.length) continue;
        block.append(el('ul', { class: 'text-answers' }, answered.slice(0, 8).map((t) => el('li', null, String(t)))));
      }
      box.append(block);
    }
  }

  // ------------------------------------------------------------------ schedule data and editing
  // Sessions come from data/sessions.json plus sessions saved from the website
  // (the artifact's database, or the Google Sheet). Saved ones win on the same id;
  // a saved {id, deleted: true} hides a session from sessions.json.

  const pad2 = (n) => String(n).padStart(2, '0');
  const httpsOnly = (v) => (typeof v === 'string' && /^https?:\/\//i.test(v) ? v : '');

  function cleanSession(x) {
    if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !x.id) return null;
    if (x.deleted) return { id: x.id, deleted: true };
    const str = (v) => (typeof v === 'string' ? v : '');
    const arr = (v) => (Array.isArray(v) ? v.filter((i) => typeof i === 'string') : []);
    return {
      id: x.id,
      start: str(x.start),
      durationMinutes: Number(x.durationMinutes) || undefined,
      track: str(x.track),
      label: str(x.label),
      title: str(x.title) || 'Untitled session',
      presenters: arr(x.presenters),
      papers: arr(x.papers),
      builds_on: arr(x.builds_on),
      prep: str(x.prep),
      questions: arr(x.questions),
      location: str(x.location),
      meetingLink: httpsOnly(x.meetingLink),
      slides: httpsOnly(x.slides),
      recording: httpsOnly(x.recording),
      reading: Array.isArray(x.reading)
        ? x.reading.filter((r) => r && typeof r.title === 'string' && r.title.trim()).map((r) => ({ title: r.title.trim(), url: httpsOnly(r.url) }))
        : []
    };
  }

  function rebuildData() {
    const map = new Map();
    (S.baseSessions || []).forEach((s, i) => {
      if (!s || typeof s !== 'object') return;
      const id = s.id || 'base-' + (i + 1);
      map.set(id, Object.assign({}, s, { id, _base: true }));
    });
    for (const r of S.remoteSessions || []) {
      if (r.deleted) { map.delete(r.id); continue; }
      const had = map.get(r.id);
      map.set(r.id, Object.assign({}, r, { _base: !!(had && had._base), _remote: true }));
    }
    const papers = (S.basePapers || []).slice();
    const ids = new Set(papers.map((p) => p.id));
    const list = Array.from(map.values()).map((s) => {
      const extra = [];
      for (const r of s.reading || []) {
        const id = 'r-' + slug(r.title).slice(0, 60);
        if (!ids.has(id)) {
          ids.add(id);
          papers.push({ id, title: r.title, authors: '', year: '', venue: '', url: r.url || '', pdf: r.url || '', tags: [], derived: true });
        }
        extra.push(id);
      }
      return Object.assign({}, s, { papers: Array.from(new Set([].concat(s.papers || [], extra))) });
    });
    S.papers = papers;
    S.papersById = Object.fromEntries(papers.map((p) => [p.id, p]));
    S.sessions = Core.prepareSessions(list, S.config);
    S.next = S.sessions.find((s) => s.endDate >= S.now) || null;
  }

  function setRemoteSessions(list) {
    const clean = (list || []).map(cleanSession).filter(Boolean);
    const sig = JSON.stringify(clean);
    if (sig === S.remoteSig) return;
    S.remoteSig = sig;
    S.remoteSessions = clean;
    rebuildData();
    rerenderSchedule();
  }

  function rerenderSchedule() {
    if (S.next && !S.calTouched) {
      const p = Core.tzParts(S.next.startDate, TZ());
      S.cal = { y: p.y, m: p.m };
    }
    for (const f of [renderNext, () => renderRoadmap(false), renderCalendar, renderAgenda, setupCalendarActions, renderPapers, renderPeople, renderEditButtons]) {
      try { f(); } catch (e) { console.error(e); }
    }
    const d = $('#schedule-editor');
    if (d && d.open && !S.editId) renderEditor();
  }

  function canEditSchedule() {
    if (B.kind === 'sheet') return true;
    return B.kind === 'artifact' && !!B.db && B.canEdit;
  }

  function renderEditButtons() {
    const head = $('#schedule .section-head');
    if (!head) return;
    let slot = $('#schedule-edit');
    if (!slot) {
      slot = el('div', { id: 'schedule-edit', class: 'section-actions' });
      head.insertBefore(slot, $('#calendar-actions'));
    }
    fill(slot, canEditSchedule()
      ? el('button', { class: 'btn btn-primary', type: 'button', onclick: () => openEditor(null) }, 'Edit schedule')
      : null);
  }

  // ---- saving

  async function sheetPost(payload) {
    const opts = { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) };
    let res;
    try {
      res = await fetch(S.config.voteUrl, opts);
    } catch (e) {
      if (!(e instanceof TypeError)) throw e;
      // Some browsers block reading Google's reply; send it without reading the reply.
      await fetch(S.config.voteUrl, Object.assign({}, opts, { mode: 'no-cors' }));
      return { ok: true, unverified: true };
    }
    const out = await res.json().catch(() => null);
    if (out && out.ok === false) {
      const err = new Error(out.error || 'The sheet refused the change.');
      err.code = out.code;
      throw err;
    }
    return out || { ok: true, unverified: true };
  }

  function organizerCode() {
    if (S.orgCode != null) return S.orgCode;
    try { return localStorage.getItem('rg-code') || ''; } catch (e) { return ''; }
  }

  async function saveSession(sess) {
    if (B.kind === 'artifact') {
      await B.db.collection('sessions').doc(sess.id).set(sess);
      return;
    }
    if (B.kind === 'sheet') {
      await sheetPost({ kind: 'session', action: 'save', code: organizerCode(), session: sess });
      setRemoteSessions((S.remoteSessions || []).filter((x) => x.id !== sess.id).concat([sess]));
      setTimeout(loadSheet, 2000);
      return;
    }
    throw new Error('not connected');
  }

  async function removeSession(s) {
    if (s._base) return saveSession({ id: s.id, deleted: true });
    if (B.kind === 'artifact') {
      await B.db.collection('sessions').doc(s.id).delete();
      return;
    }
    if (B.kind === 'sheet') {
      await sheetPost({ kind: 'session', action: 'delete', code: organizerCode(), id: s.id });
      setRemoteSessions((S.remoteSessions || []).filter((x) => x.id !== s.id));
      setTimeout(loadSheet, 2000);
      return;
    }
    throw new Error('not connected');
  }

  function editError(err) {
    const c = err && err.code;
    if (c === 'bad_code') return 'That organizer code isn\'t right.';
    if (c === 'no_code_set') return 'Set ORGANIZER_CODE in your Google script first. The README explains how.';
    if (c === 'invalid_argument') return 'Only the page owner and editors can change the schedule.';
    if (/Missing form/i.test((err && err.message) || '')) return 'Your Google script is the old version. Update it (see the README) to edit the schedule here.';
    return 'Couldn\'t save. Check your connection and try again.';
  }

  // ---- editor dialog

  function editorDialog() {
    let d = $('#schedule-editor');
    if (!d) {
      d = el('dialog', { class: 'editor-dialog', id: 'schedule-editor', 'aria-labelledby': 'editor-title' });
      d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
      document.body.append(d);
    }
    return d;
  }

  function openEditor(id) {
    S.editId = id;
    S.editorMsg = null;
    const d = editorDialog();
    renderEditor();
    if (!d.open) d.showModal();
  }

  function renderEditor(message) {
    if (message !== undefined) S.editorMsg = message;
    message = S.editorMsg;
    const d = editorDialog();
    const editing = S.editId && S.editId !== 'new' ? S.sessions.find((s) => s.id === S.editId) || null : null;
    const showForm = S.editId === 'new' || !!editing;
    const msg = el('div', { class: 'editor-msg', 'aria-live': 'polite' },
      message ? el('p', { class: 'form-done' }, message) : null);
    fill(d,
      el('div', { class: 'editor-bar' },
        el('h2', { id: 'editor-title' }, showForm ? (editing ? 'Edit session' : 'Add a session') : 'Schedule'),
        el('button', { class: 'btn btn-quiet', type: 'button', onclick: () => d.close() }, 'Close')),
      el('div', { class: 'editor-body' },
        B.kind === 'sheet' ? codeField() : null,
        msg,
        showForm ? sessionForm(editing, msg) : sessionList(msg)));
  }

  function codeField() {
    const input = el('input', { type: 'password', id: 'org-code', autocomplete: 'off' });
    input.value = organizerCode();
    input.addEventListener('input', () => {
      S.orgCode = input.value;
      try { localStorage.setItem('rg-code', input.value); } catch (e) { /* storage unavailable */ }
    });
    return el('label', { class: 'q code-field', for: 'org-code' },
      el('span', { class: 'q-label' }, 'Organizer code'),
      input,
      el('span', { class: 'hint' }, 'The code you set in the Google script. This browser remembers it.'));
  }

  function sessionList(msg) {
    const list = S.sessions.slice();
    return [
      el('div', { class: 'button-row', style: 'margin:0 0 18px' },
        el('button', { class: 'btn btn-primary btn-big', type: 'button', onclick: () => { S.editId = 'new'; renderEditor(null); } }, 'Add a session')),
      list.length
        ? el('ul', { class: 'editor-list' }, list.map((s) => el('li', { class: statusOf(s) === 'past' ? 'is-past' : null },
          el('span', { class: 'editor-when' }, fmtDate(s.startDate, { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + fmtTime(s.startDate)),
          el('span', { class: 'editor-what' }, s.title),
          el('span', { class: 'editor-actions' },
            el('button', { class: 'btn', type: 'button', onclick: () => { S.editId = s.id; renderEditor(null); } }, 'Edit'),
            deleteButton(s, msg)))))
        : el('p', { class: 'muted' }, 'No sessions yet. Add the first one.')
    ];
  }

  function deleteButton(s, msg) {
    const btn = el('button', { class: 'btn btn-quiet danger', type: 'button' }, 'Delete');
    let armed = false;
    let timer;
    btn.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        btn.textContent = 'Tap again to delete';
        timer = setTimeout(() => { armed = false; btn.textContent = 'Delete'; }, 3000);
        return;
      }
      clearTimeout(timer);
      btn.disabled = true;
      btn.textContent = 'Deleting…';
      try {
        await removeSession(s);
        S.editId = null;
        renderEditor('Deleted "' + s.title + '".');
      } catch (err) {
        armed = false;
        btn.disabled = false;
        btn.textContent = 'Delete';
        msg.replaceChildren(el('p', { class: 'form-error' }, editError(err)));
      }
    });
    return btn;
  }

  function label12(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return ((h + 11) % 12 + 1) + (m ? ':' + pad2(m) : '') + (h < 12 ? ' AM' : ' PM');
  }

  function sessionForm(s, msg) {
    const tz = TZ();
    const times = S.config.sessionTimes || [];
    let date = '';
    let time = times[0] || '16:00';
    if (s) {
      const p = Core.tzParts(s.startDate, tz);
      date = p.y + '-' + pad2(p.m) + '-' + pad2(p.d);
      time = pad2(p.h) + ':' + pad2(p.mi);
    }
    const len = s ? Math.round((s.endDate - s.startDate) / 60000) : (S.config.defaultDurationMinutes || 60);

    const fDate = el('input', { type: 'date', id: 'ed-date', required: true });
    fDate.value = date;
    const fTime = el('input', { type: 'time', id: 'ed-time', step: 300 });
    fTime.value = time;
    const quick = el('div', { class: 'quick' });
    const markQuick = () => $$('button', quick).forEach((b) => b.classList.toggle('on', b.dataset.t === fTime.value));
    quick.append(...times.map((t) => el('button', {
      type: 'button', class: 'btn', 'data-t': t,
      onclick: () => { fTime.value = t; markQuick(); }
    }, label12(t))));
    fTime.addEventListener('input', markQuick);
    markQuick();
    const fLen = el('select', { id: 'ed-len' }, [30, 45, 60, 90, 120].map((n) => el('option', { value: String(n) }, n + ' min')));
    fLen.value = String([30, 45, 60, 90, 120].includes(len) ? len : 60);

    const fTitle = el('input', { type: 'text', id: 'ed-title', placeholder: 'For example: Causal abstraction', autocomplete: 'off' });
    fTitle.value = s ? s.title : '';
    const topics = ((S.config.scope || {}).topics || []);
    const topicChips = el('div', { class: 'quick' }, topics.map((t) => el('button', {
      type: 'button', class: 'btn',
      onclick: () => { fTitle.value = t; fTitle.focus(); }
    }, t)));

    const chosen = new Set(s ? s.presenters || [] : []);
    const presenterChips = el('div', { class: 'chips' }, S.members.map((m) => el('label', { class: 'chip' },
      el('input', { type: 'checkbox', name: 'ed-presenter', value: m.id, checked: chosen.has(m.id) || chosen.has(m.name) }),
      el('span', null, m.name))));

    const readingBox = el('div', { class: 'reading-list' });
    const addReading = (r) => {
      const t = el('input', { type: 'text', placeholder: 'Paper title', 'aria-label': 'Paper title', class: 'rd-title' });
      const u = el('input', { type: 'url', placeholder: 'Link (arXiv, PDF…)', 'aria-label': 'Paper link', class: 'rd-url' });
      t.value = (r && r.title) || '';
      u.value = (r && r.url) || '';
      readingBox.append(el('div', { class: 'reading-row' }, t, u));
    };
    const existingReading = s ? (s.reading && s.reading.length ? s.reading
      : (s.papers || []).map((id) => S.papersById[id]).filter((p) => p && !p.derived).map((p) => ({ title: p.title, url: p.url || p.pdf || '' }))) : [];
    (existingReading.length ? existingReading : [null]).forEach(addReading);

    const fPrep = el('textarea', { id: 'ed-prep', rows: 3, placeholder: 'For example: read sections 1–3' });
    fPrep.value = s ? s.prep || '' : '';
    const fLoc = el('input', { type: 'text', id: 'ed-loc', placeholder: S.config.defaultLocation || 'Room or "Online"' });
    fLoc.value = s ? s.location || '' : '';
    const fLink = el('input', { type: 'url', id: 'ed-link', placeholder: 'https://…' });
    fLink.value = s ? s.meetingLink || '' : '';
    const fSlides = el('input', { type: 'url', id: 'ed-slides', placeholder: 'https://…' });
    fSlides.value = s ? s.slides || '' : '';
    const fRec = el('input', { type: 'url', id: 'ed-rec', placeholder: 'https://…' });
    fRec.value = s ? s.recording || '' : '';

    const save = el('button', { class: 'btn btn-primary btn-big', type: 'submit' }, 'Save session');
    const form = el('form', { class: 'survey-form editor-form', novalidate: true },
      el('div', { class: 'ed-row' },
        el('label', { class: 'q', for: 'ed-date' }, el('span', { class: 'q-label' }, 'Date', el('span', { class: 'req' }, 'Required')), fDate),
        el('label', { class: 'q', for: 'ed-time' }, el('span', { class: 'q-label' }, 'Start time (GST)'), fTime),
        el('label', { class: 'q', for: 'ed-len' }, el('span', { class: 'q-label' }, 'Length'), fLen)),
      times.length ? quick : null,
      el('div', { class: 'q' },
        el('label', { class: 'q-label', for: 'ed-title' }, 'Topic', el('span', { class: 'req' }, 'Required')),
        fTitle,
        topics.length ? [el('p', { class: 'hint', style: 'margin:8px 0 0' }, 'Or tap one:'), topicChips] : null),
      S.members.length ? el('fieldset', { class: 'q' }, el('legend', null, 'Presenter'), presenterChips) : null,
      el('div', { class: 'q' },
        el('span', { class: 'q-label' }, 'Reading'),
        readingBox,
        el('button', { class: 'btn btn-quiet', type: 'button', onclick: () => addReading(null) }, 'Add another paper')),
      el('label', { class: 'q', for: 'ed-prep' }, el('span', { class: 'q-label' }, 'What to prepare'), fPrep),
      el('details', { class: 'more-options' },
        el('summary', null, 'More options'),
        el('div', { class: 'survey-form', style: 'margin-top:14px' },
          el('label', { class: 'q', for: 'ed-loc' }, el('span', { class: 'q-label' }, 'Place'), fLoc),
          el('label', { class: 'q', for: 'ed-link' }, el('span', { class: 'q-label' }, 'Online meeting link'), fLink),
          el('label', { class: 'q', for: 'ed-slides' }, el('span', { class: 'q-label' }, 'Slides link (after the session)'), fSlides),
          el('label', { class: 'q', for: 'ed-rec' }, el('span', { class: 'q-label' }, 'Recording link (after the session)'), fRec))),
      el('div', { class: 'button-row' },
        save,
        el('button', { class: 'btn', type: 'button', onclick: () => { S.editId = null; renderEditor(null); } }, 'Cancel')));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!fDate.value) { msg.replaceChildren(el('p', { class: 'form-error' }, 'Choose a date.')); fDate.focus(); return; }
      if (!fTitle.value.trim()) { msg.replaceChildren(el('p', { class: 'form-error' }, 'Write or pick a topic.')); fTitle.focus(); return; }
      const reading = $$('.reading-row', readingBox).map((row) => ({
        title: $('.rd-title', row).value.trim(),
        url: httpsOnly($('.rd-url', row).value.trim())
      })).filter((r) => r.title);
      const sess = {
        id: s ? s.id : 's' + Date.now().toString(36),
        start: fDate.value + ' ' + (fTime.value || time),
        durationMinutes: Number(fLen.value) || 60,
        title: fTitle.value.trim(),
        label: s && s.label ? s.label : '',
        presenters: $$('input[name=ed-presenter]', form).filter((i) => i.checked).map((i) => i.value),
        reading,
        papers: [],
        prep: fPrep.value.trim(),
        location: fLoc.value.trim(),
        meetingLink: httpsOnly(fLink.value.trim()),
        slides: httpsOnly(fSlides.value.trim()),
        recording: httpsOnly(fRec.value.trim()),
        questions: s ? s.questions || [] : [],
        builds_on: s ? s.builds_on || [] : []
      };
      save.disabled = true;
      save.textContent = 'Saving…';
      try {
        await saveSession(sess);
        S.editId = null;
        renderEditor('Saved "' + sess.title + '".');
      } catch (err) {
        save.disabled = false;
        save.textContent = 'Save session';
        msg.replaceChildren(el('p', { class: 'form-error' }, editError(err)));
      }
    });
    return form;
  }

  // ------------------------------------------------------------------ footer

  function renderFooter() {
    const c = S.config;
    const links = [];
    if (c.labUrl) links.push(el('a', { href: c.labUrl, target: '_blank', rel: 'noopener' }, c.labName || 'Lab'));
    if (S.repo) {
      links.push(el('a', { href: 'https://github.com/' + S.repo.owner + '/' + S.repo.repo, target: '_blank', rel: 'noopener' }, 'GitHub repository'));
      links.push(el('a', { href: 'https://github.com/' + S.repo.owner + '/' + S.repo.repo + '/edit/' + S.repo.branch + '/data/sessions.json', target: '_blank', rel: 'noopener' }, 'Edit the schedule'));
    }
    if (S.feedUrl) links.push(el('a', { href: S.feedUrl }, 'Calendar feed'));
    if (c.contactEmail) links.push(el('a', { href: 'mailto:' + c.contactEmail }, 'Contact'));
    links.push(el('a', { href: '#top' }, 'Back to top'));
    if (c.sampleNote) $('#sample-note').textContent = c.sampleNote;
    $('#footer-links').replaceChildren(...links.map((a) => el('li', null, a)));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
