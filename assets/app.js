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
    survey: null, issuesPromise: null, formDirty: false,
    store: { db: null, uid: null, canWrite: null, canEdit: false, docs: null, status: IN_ARTIFACT ? 'loading' : 'off', error: null }
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
    if (!id) return null;
    const tracks = S.config.tracks || [];
    const i = tracks.findIndex((t) => t.id === id);
    const shapes = ['circle', 'square'];
    if (i === -1) return { id, name: id, shape: 'diamond' };
    return Object.assign({ shape: shapes[i] || 'diamond' }, tracks[i]);
  }
  function trackIcon(id) {
    const t = trackInfo(id);
    return el('span', { class: 'track-icon ' + (t ? t.shape : 'circle'), 'aria-hidden': 'true' });
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
      S.papers = papers || [];
      S.members = members || [];
      S.surveys = surveys || [];
      S.papersById = Object.fromEntries(S.papers.map((p) => [p.id, p]));
      S.membersById = Object.fromEntries(S.members.map((m) => [m.id, m]));
      S.sessions = Core.prepareSessions(sessions, S.config);
      S.next = S.sessions.find((s) => s.endDate >= S.now) || null;
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
      renderPeople, renderSurveyTabs, renderFooter];
    for (const step of steps) {
      try { step(); } catch (err) { console.error(err); }
    }
    handleHash();
    window.addEventListener('hashchange', handleHash);
    initStore();
  }

  // ------------------------------------------------------------------ artifact storage (claude.ai)

  async function initStore() {
    if (!IN_ARTIFACT) return;
    const st = S.store;
    const timer = setTimeout(() => {
      if (st.status === 'loading') { st.status = 'timeout'; onStoreChange(true); }
    }, 10000);
    try {
      const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
      st.db = db;
      if (user) {
        try { st.uid = await user.id(); } catch (e) { st.uid = null; }
        try { st.canWrite = await user.can('data.write'); } catch (e) { st.canWrite = null; }
        try { st.canEdit = !!(await user.canEdit()); } catch (e) { st.canEdit = false; }
      }
      if (!db) { clearTimeout(timer); st.status = 'unavailable'; onStoreChange(true); return; }
      db.collection('responses').onSnapshot((snap) => {
        st.docs = snap.docs.map((d) => ({ id: d.id, data: d.data() || {} }));
        const before = st.status;
        if (!snap.metadata.fromCache) { clearTimeout(timer); st.status = 'ready'; }
        else if (st.status === 'loading') st.status = 'cached';
        onStoreChange(before !== st.status && (before === 'loading' || before === 'timeout'));
      }, (err) => {
        clearTimeout(timer);
        st.status = 'error';
        st.error = err && err.code;
        onStoreChange(true);
      });
    } catch (e) {
      clearTimeout(timer);
      st.status = 'unavailable';
      onStoreChange(true);
    }
  }

  function onStoreChange(statusChanged) {
    if (!S.survey) return;
    if (statusChanged && !S.formDirty) { renderSurveyPanel(); return; }
    const box = $('#survey-panel .results');
    const sv = S.surveys.find((v) => v.id === S.survey);
    if (box && sv) renderResults(sv, box, false);
  }

  function storeRows(sv) {
    const rows = [];
    for (const d of S.store.docs || []) {
      const entries = d.data && d.data.surveys && d.data.surveys[sv.id];
      if (!entries || typeof entries !== 'object') continue;
      for (const k of Object.keys(entries)) {
        const e = entries[k];
        if (e && typeof e === 'object' && e.answers && typeof e.answers === 'object') {
          rows.push({ user: d.id, key: k, at: String(e.at || ''), answers: e.answers });
        }
      }
    }
    return rows.sort((a, b) => (a.at < b.at ? 1 : -1));
  }

  function myPrevious(sv) {
    if (!S.store.uid) return null;
    const mine = storeRows(sv).filter((r) => r.user === S.store.uid);
    return mine.length ? mine[0] : null;
  }

  async function saveToStore(sv, answers) {
    const st = S.store;
    const key = (sv.dedupeBy || []).map((k) => String(answers[k] == null ? '' : answers[k])).join(' | ') || '_';
    const entry = { answers, at: new Date().toISOString() };
    const ref = st.db.collection('responses').doc(st.uid);
    const snap = await ref.get();
    const body = { surveys: { [sv.id]: { [key]: entry } } };
    if (snap.exists) await ref.update(body);
    else await ref.set(body);
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
    return el('li', null,
      el('a', { class: 'citation-title', href: p.url || p.pdf || '#', target: '_blank', rel: 'noopener' }, p.title),
      el('span', { class: 'citation-meta' }, shortAuthors(p.authors) + ' (' + p.year + ')' + (p.venue ? '. ' + p.venue : ''))
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
      const hasTopic = S.surveys.some((v) => v.id === 'next-topic');
      fill(box,
        el('p', { class: 'next-kicker' }, el('span', null, 'Next session')),
        el('h2', { class: 'next-title' }, 'Nothing scheduled yet'),
        el('p', { class: 'muted' }, 'The next block is being planned. Vote on topics or offer to present something.'),
        el('div', { class: 'button-row' },
          hasTopic ? el('a', { class: 'btn btn-primary', href: '#survey-next-topic' }, 'Vote on topics') : null,
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
      sessionActions(s, true)
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
      S.surveys.some((v) => v.id === 'next-topic') ? el('a', { class: 'btn btn-quiet', href: '#survey-next-topic' }, 'Suggest a paper') : null
    );
  }

  function renderPapers() {
    const f = S.paperFilter;
    const none = !S.papers.length;
    $('.paper-toolbar').hidden = none;
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
          el('h3', { class: 'paper-title' }, el('a', { href: p.url || p.pdf || '#', target: '_blank', rel: 'noopener' }, p.title)),
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
            p.pdf ? pdfControl(p, 'btn', 'Read PDF') : null,
            p.url ? el('a', { class: 'btn btn-quiet', href: p.url, target: '_blank', rel: 'noopener' }, 'Paper page') : null)));
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
    $('#organizers').replaceChildren(...(orgs.length ? orgs.map((m) => personCard(m, true)) : [el('li', { class: 'muted' }, 'Organizers will be listed here.')]));
    $('#participants').replaceChildren(...(rest.length ? rest.map((m) => personCard(m, false)) : [el('li', { class: 'muted' }, 'Participants will be listed here.')]));
    if (S.config.contactEmail) {
      $('#organizer-note').append(' ', el('a', { href: 'mailto:' + S.config.contactEmail }, S.config.contactEmail));
    }
  }

  // ------------------------------------------------------------------ surveys

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

  function renderSurveyTabs() {
    const box = $('#survey-tabs');
    if (!S.surveys.length) {
      box.hidden = true;
      $('#survey-panel').replaceChildren(el('p', { class: 'muted' }, 'No surveys yet. Add one to data/surveys.json.'));
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
    const panel = $('#survey-panel');
    panel.setAttribute('aria-labelledby', 'tab-' + sv.id);
    fill(panel,
      el('h3', null, sv.title),
      el('p', { class: 'survey-status' }, surveyStatusText(sv)),
      sv.description ? el('p', { class: 'survey-desc' }, sv.description) : null
    );
    if (sv.externalUrl) {
      panel.append(el('div', { class: 'button-row' },
        el('a', { class: 'btn btn-primary', href: sv.externalUrl, target: '_blank', rel: 'noopener' }, 'Open the form')));
      return;
    }
    S.formDirty = false;
    if (surveyClosed(sv)) {
      panel.append(el('p', { class: 'muted' }, 'This survey is closed. Thanks to everyone who answered.'));
    } else {
      panel.append(IN_ARTIFACT ? buildStoreForm(sv) : buildForm(sv));
    }
    if (sv.showResults !== false || (IN_ARTIFACT && S.store.canEdit)) {
      const res = el('section', { class: 'results', 'aria-label': 'Results' });
      panel.append(res);
      renderResults(sv, res, false);
    }
  }

  function buildQuestion(sv, q) {
    const name = sv.id + '__' + q.id;
    const req = q.required ? el('span', { class: 'req' }, 'Required') : null;
    const opts = resolveOptions(q);
    const fid = 'f-' + name;
    switch (q.type) {
      case 'single':
      case 'multi': {
        const isMulti = q.type === 'multi';
        const fs = el('fieldset', { class: 'q', 'data-q': q.id },
          el('legend', null, q.label, req),
          isMulti && q.max ? el('p', { class: 'hint' }, 'Choose up to ' + q.max + '.') : null,
          el('div', { class: 'choices' + (q.columns > 1 ? ' cols-' + Math.min(3, q.columns) : '') },
            opts.map((o) => el('label', { class: 'choice' },
              el('input', { type: isMulti ? 'checkbox' : 'radio', name, value: o }), el('span', null, o)))));
        if (isMulti && q.max) {
          fs.addEventListener('change', () => {
            const boxes = $$('input', fs);
            const n = boxes.filter((b) => b.checked).length;
            boxes.forEach((b) => {
              b.disabled = !b.checked && n >= q.max;
              b.closest('.choice').classList.toggle('disabled', b.disabled);
            });
          });
        }
        return fs;
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
          el('select', { id: fid, name }, el('option', { value: '' }, 'Choose…'), opts.map((o) => el('option', { value: o }, o))));
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

  function collectAnswers(sv, form) {
    const answers = {};
    let firstMissing = null;
    for (const q of sv.questions || []) {
      const name = sv.id + '__' + q.id;
      const sel = '[name="' + (window.CSS && CSS.escape ? CSS.escape(name) : name) + '"]';
      let v;
      if (q.type === 'multi') v = $$(sel + ':checked', form).map((i) => i.value);
      else if (q.type === 'single' || q.type === 'rating') {
        const c = $(sel + ':checked', form);
        v = c ? (q.type === 'rating' ? Number(c.value) : c.value) : '';
      } else {
        const f = $(sel, form);
        v = f ? f.value.trim() : '';
      }
      const empty = Array.isArray(v) ? v.length === 0 : v === '' || v == null;
      if (q.required && empty && !firstMissing) firstMissing = q;
      answers[q.id] = empty ? (Array.isArray(v) ? [] : '') : v;
    }
    return { answers, firstMissing };
  }

  function formatAnswer(q, v) {
    if (Array.isArray(v)) return v.length ? v.map((x) => '- ' + x).join('\n') : '_No response_';
    if (v === '' || v == null) return '_No response_';
    if (q.type === 'rating') return v + ' / ' + (q.scale || 5);
    return String(v);
  }

  function issueUrl(sv, answers) {
    let body = '**' + sv.title + '**\n\n';
    for (const q of sv.questions || []) body += '### ' + q.label + '\n\n' + formatAnswer(q, answers[q.id]) + '\n\n';
    const data = JSON.stringify({ survey: sv.id, v: 1, answers }).replace(/-->/g, '--\\u003e');
    body += '<!-- survey-data\n' + data + '\n-->\n';
    const nameQ = (sv.questions || []).find((q) => q.id === 'name');
    const title = '[survey:' + sv.id + '] ' + sv.title + (nameQ && answers.name ? ': ' + answers.name : '');
    const params = new URLSearchParams({ title, body, labels: 'survey' });
    return 'https://github.com/' + S.repo.owner + '/' + S.repo.repo + '/issues/new?' + params.toString();
  }

  function buildForm(sv) {
    const form = el('form', { class: 'survey-form', novalidate: true });
    form.append(...(sv.questions || []).map((q) => buildQuestion(sv, q)));
    const msg = el('div', { 'aria-live': 'polite' });
    const submit = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Continue on GitHub');
    const foot = el('div', { class: 'form-foot' },
      el('p', null, 'This opens a prefilled GitHub issue in a new tab. Submit it there to finish. Answers are public and linked to your GitHub account, so you need to be signed in to GitHub.'),
      msg,
      el('div', null, submit));
    if (!S.repo) {
      submit.disabled = true;
      foot.insertBefore(el('p', null, 'Answers will be collected once this site is published on GitHub Pages, or once github.owner and github.repo are set in data/config.json.'), msg);
    }
    form.append(foot);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!S.repo) return;
      const { answers, firstMissing } = collectAnswers(sv, form);
      if (firstMissing) {
        msg.replaceChildren(el('p', { class: 'form-error' }, 'Answer "' + firstMissing.label + '" to continue.'));
        const field = form.querySelector('[data-q="' + firstMissing.id + '"] input, [data-q="' + firstMissing.id + '"] select, [data-q="' + firstMissing.id + '"] textarea');
        if (field) field.focus();
        return;
      }
      const url = issueUrl(sv, answers);
      const w = window.open(url, '_blank', 'noopener');
      msg.replaceChildren(el('p', { class: 'form-done' },
        'Your answers are ready on GitHub. Submit the issue there to record them. ',
        w ? null : el('a', { href: url, target: '_blank', rel: 'noopener' }, 'Open it here if a new tab did not appear.')));
    });
    return form;
  }

  function prefill(form, sv, answers) {
    for (const q of sv.questions || []) {
      const v = answers[q.id];
      if (v == null || v === '') continue;
      const name = sv.id + '__' + q.id;
      const fields = $$('[name="' + (window.CSS && CSS.escape ? CSS.escape(name) : name) + '"]', form);
      for (const f of fields) {
        if (f.type === 'checkbox' || f.type === 'radio') f.checked = [].concat(v).map(String).includes(f.value);
        else f.value = String(v);
      }
      const fs = form.querySelector('[data-q="' + q.id + '"]');
      if (fs && q.type === 'multi') fs.dispatchEvent(new Event('change'));
    }
  }

  function buildStoreForm(sv) {
    const st = S.store;
    const form = el('form', { class: 'survey-form', novalidate: true });
    form.append(...(sv.questions || []).map((q) => buildQuestion(sv, q)));
    const msg = el('div', { 'aria-live': 'polite' });
    const prev = st.status === 'ready' || st.status === 'cached' ? myPrevious(sv) : null;
    const submit = el('button', { class: 'btn btn-primary', type: 'submit' }, prev ? 'Update my answers' : 'Submit answers');
    let note = 'Answers are saved with this page. Everyone who can open it sees the results.';
    let blocked = null;
    if (st.status === 'loading') blocked = 'Connecting to saved answers…';
    else if (st.status === 'unavailable' || st.status === 'error' || !st.uid) blocked = 'Answers can\'t be saved in this view. Open the page on claude.ai while signed in.';
    else if (st.status === 'timeout') blocked = 'Saved answers can\'t be reached yet. Check your connection.';
    else if (st.canWrite === false) blocked = 'You can see the results but not answer. Ask the page owner for Contributor access.';
    if (prev && !blocked) {
      note = 'You answered on ' + fmtDate(new Date(prev.at), { day: 'numeric', month: 'short' }) + '. Submitting again replaces that answer. ' + note;
      prefill(form, sv, prev.answers);
    }
    const foot = el('div', { class: 'form-foot' }, el('p', null, note), blocked ? el('p', { class: 'form-error' }, blocked) : null, msg, el('div', null, submit));
    if (blocked) submit.disabled = true;
    form.append(foot);
    form.addEventListener('input', () => { S.formDirty = true; });
    form.addEventListener('change', () => { S.formDirty = true; });
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
      submit.textContent = 'Saving…';
      try {
        await saveToStore(sv, answers);
        S.formDirty = false;
        msg.replaceChildren(el('p', { class: 'form-done' }, 'Saved. Thanks for answering.'));
        submit.textContent = 'Update my answers';
      } catch (err) {
        const code = err && err.code;
        const text = code === 'invalid_argument' ? 'Your access to this page doesn\'t allow answering. Ask the owner for Contributor access.'
          : code === 'quota_exceeded' ? 'This page has run out of storage for answers. Let the organizers know.'
            : 'Couldn\'t save your answers. Try again in a moment.';
        msg.replaceChildren(el('p', { class: 'form-error' }, text));
        submit.textContent = 'Submit answers';
      }
      submit.disabled = false;
    });
    return form;
  }

  async function loadIssues(force) {
    if (S.issuesPromise && !force) return S.issuesPromise;
    const { owner, repo } = S.repo;
    S.issuesPromise = (async () => {
      const all = [];
      for (let page = 1; page <= 5; page++) {
        const res = await fetch('https://api.github.com/repos/' + owner + '/' + repo + '/issues?state=all&per_page=100&page=' + page,
          { headers: { Accept: 'application/vnd.github+json' } });
        if (res.status === 403 || res.status === 429) throw new Error('rate');
        if (res.status === 404) throw new Error('notfound');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const batch = await res.json();
        all.push(...batch);
        if (batch.length < 100) break;
      }
      return all;
    })();
    S.issuesPromise.catch(() => { S.issuesPromise = null; });
    return S.issuesPromise;
  }

  function responsesFor(sv, issues) {
    const prefix = '[survey:' + sv.id + ']';
    const rows = [];
    for (const i of issues) {
      if (i.pull_request || !String(i.title || '').startsWith(prefix)) continue;
      if (i.state === 'closed' && i.state_reason === 'not_planned') continue;
      const m = String(i.body || '').match(/<!--\s*survey-data\s*([\s\S]*?)-->/);
      if (!m) continue;
      let data;
      try { data = JSON.parse(m[1]); } catch (e) { continue; }
      if (!data || data.survey !== sv.id || typeof data.answers !== 'object') continue;
      rows.push({ user: (i.user && i.user.login) || '?', at: i.created_at, answers: data.answers });
    }
    rows.sort((a, b) => (a.at < b.at ? 1 : -1));
    const seen = new Set();
    return rows.filter((r) => {
      const key = [r.user].concat((sv.dedupeBy || []).map((k) => r.answers[k])).join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function barRow(label, count, denom, maxCount) {
    const pct = denom ? Math.round((count / denom) * 100) : 0;
    const width = maxCount ? (count / maxCount) * 100 : 0;
    return el('li', { class: 'bar-row', title: count + ' of ' + plural(denom, 'response') + ' (' + pct + '%)' },
      el('span', { class: 'bar-label' }, label),
      el('span', { class: 'bar-track', 'aria-hidden': 'true' },
        el('span', { class: 'bar-fill' + (count ? '' : ' zero'), style: 'display:block;width:' + width + '%' })),
      el('span', { class: 'bar-count' }, count + (denom ? ' (' + pct + '%)' : '')));
  }

  async function renderResults(sv, box, force) {
    if (IN_ARTIFACT) return renderStoreResults(sv, box);
    const head = el('div', { class: 'results-head' }, el('h4', null, 'Results'));
    box.replaceChildren(head);
    if (!S.repo) {
      box.append(el('p', { class: 'muted small' }, 'Results appear here once the site is connected to a GitHub repository.'));
      return;
    }
    const status = el('p', { class: 'muted small' }, 'Loading responses from GitHub…');
    box.append(status);
    let rows;
    try {
      rows = responsesFor(sv, await loadIssues(force));
    } catch (err) {
      const msg = err.message === 'rate'
        ? 'GitHub allows 60 anonymous requests an hour per network, and that limit has been reached. Try again later.'
        : err.message === 'notfound'
          ? 'Could not find ' + S.repo.owner + '/' + S.repo.repo + '. Results need a public repository with issues turned on.'
          : 'Could not load responses (' + err.message + ').';
      status.textContent = msg;
      return;
    }
    if (S.survey !== sv.id || !box.isConnected) return;
    const allLink = 'https://github.com/' + S.repo.owner + '/' + S.repo.repo + '/issues?q=' + encodeURIComponent('is:issue in:title "[survey:' + sv.id + ']"');
    head.append(el('span', { class: 'muted small' },
      plural(rows.length, 'response') + (rows.length ? ', latest per person' : ''), ' ',
      el('button', { class: 'btn btn-quiet', type: 'button', onclick: () => renderResults(sv, box, true) }, 'Refresh')));
    status.remove();
    renderSummary(sv, box, rows);
    box.append(el('p', { class: 'small', style: 'margin-top:18px' }, el('a', { href: allLink, target: '_blank', rel: 'noopener' }, 'See every response on GitHub')));
  }

  function renderStoreResults(sv, box) {
    const st = S.store;
    const editorsOnly = sv.showResults === false;
    const head = el('div', { class: 'results-head' }, el('h4', null, editorsOnly ? 'Responses' : 'Results'));
    box.replaceChildren(head);
    if (st.status === 'loading' && !st.docs) { box.append(el('p', { class: 'muted small' }, 'Loading responses…')); return; }
    if (st.status === 'unavailable' || (st.status === 'error' && !st.docs)) {
      box.append(el('p', { class: 'muted small' }, 'Results show here when the page is opened on claude.ai while signed in.'));
      return;
    }
    if (st.status === 'timeout' && !st.docs) { box.append(el('p', { class: 'muted small' }, 'Responses can\'t be reached yet. Check your connection.')); return; }
    const all = storeRows(sv);
    const seen = new Set();
    const rows = all.filter((r) => { const k = r.user + '|' + r.key; if (seen.has(k)) return false; seen.add(k); return true; });
    head.append(el('span', { class: 'muted small' }, plural(rows.length, 'response') + (editorsOnly ? ', shown to editors only' : rows.length ? ', updating live' : '')));
    if (st.status === 'timeout' || st.status === 'cached') box.append(el('p', { class: 'muted small' }, 'These may be out of date while the connection catches up.'));
    if (editorsOnly) renderResponseList(sv, box, rows);
    else renderSummary(sv, box, rows);
  }

  function renderResponseList(sv, box, rows) {
    if (!rows.length) { box.append(el('p', { class: 'muted' }, 'No responses yet.')); return; }
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
      box.append(el('p', { class: 'muted' }, 'No responses yet.'));
      return;
    }
    for (const q of sv.questions || []) {
      const answered = rows.map((r) => r.answers[q.id]).filter((v) => (Array.isArray(v) ? v.length : v !== '' && v != null));
      const block = el('div', { class: 'results-q' }, el('h5', null, q.label));
      if (q.type === 'single' || q.type === 'multi' || q.type === 'select') {
        const counts = new Map(resolveOptions(q).map((o) => [o, 0]));
        for (const v of answered) for (const x of [].concat(v)) counts.set(x, (counts.get(x) || 0) + 1);
        let entries = Array.from(counts.entries());
        if (q.type === 'select') entries = entries.filter(([, c]) => c > 0);
        if (q.type === 'multi' || q.type === 'select') entries.sort((a, b) => b[1] - a[1]);
        const max = Math.max(1, ...entries.map(([, c]) => c));
        block.append(el('ul', { class: 'bars' }, entries.map(([label, c]) => barRow(label, c, answered.length, max))));
      } else if (q.type === 'rating') {
        const scale = q.scale || 5;
        const nums = answered.map(Number).filter((n) => n >= 1 && n <= scale);
        const mean = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
        const dist = Array.from({ length: scale }, (_, i) => nums.filter((n) => n === i + 1).length);
        const max = Math.max(1, ...dist);
        block.append(
          el('p', { class: 'mean' }, el('strong', null, mean.toFixed(1)), 'average from ' + plural(nums.length, 'rating') + ' (1 to ' + scale + ')'),
          el('ul', { class: 'bars' }, dist.map((c, i) => barRow(String(i + 1) + (i === 0 && q.low ? ' ' + q.low : i === scale - 1 && q.high ? ' ' + q.high : ''), c, nums.length, max))));
      } else {
        if (!answered.length) continue;
        block.append(el('ul', { class: 'text-answers' }, answered.slice(0, 5).map((t) => el('li', null, String(t)))));
        if (answered.length > 5) block.append(el('p', { class: 'muted small' }, plural(answered.length - 5, 'more answer') + ' on GitHub.'));
      }
      box.append(block);
    }
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
