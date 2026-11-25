/*
 * Shared helpers for the browser page and scripts/build-ics.mjs.
 * - Session times are written as wall-clock times in the group's time zone
 *   ("2026-12-02 16:00"), or as full ISO strings with an offset.
 * - buildICS() produces an iCalendar feed that Google Calendar, Outlook and
 *   Apple Calendar can subscribe to.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RGCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function tzParts(date, timeZone) {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const p = {};
    for (const { type, value } of f.formatToParts(date)) p[type] = value;
    return { y: +p.year, m: +p.month, d: +p.day, h: (+p.hour) % 24, mi: +p.minute, s: +p.second };
  }

  function tzOffsetMs(ts, timeZone) {
    const t = Math.floor(ts / 1000) * 1000;
    const p = tzParts(new Date(t), timeZone);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - t;
  }

  /** Parse "YYYY-MM-DD HH:MM" in `timeZone`, or an ISO string with Z / ±hh:mm. */
  function parseStart(str, timeZone) {
    const s = String(str || '').trim();
    if (/(Z|[+-]\d{2}:?\d{2})$/i.test(s) && s.includes('T')) return new Date(s);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!m) return new Date(NaN);
    const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    const off1 = tzOffsetMs(guess, timeZone);
    let ts = guess - off1;
    const off2 = tzOffsetMs(ts, timeZone);
    if (off2 !== off1) ts = guess - off2;
    return new Date(ts);
  }

  /** Normalise raw sessions: sort by time, number them, compute start/end. */
  function prepareSessions(raw, config) {
    const tz = config.timezone || 'UTC';
    const dur = config.defaultDurationMinutes || 90;
    return (raw || [])
      .map((s, i) => {
        const start = parseStart(s.start, tz);
        const end = new Date(start.getTime() + (s.durationMinutes || dur) * 60000);
        return Object.assign({}, s, { id: s.id || 's' + (i + 1), startDate: start, endDate: end });
      })
      .filter((s) => !isNaN(s.startDate))
      .sort((a, b) => a.startDate - b.startDate)
      .map((s, i) => Object.assign(s, { number: s.number || i + 1 }));
  }

  // ---- iCalendar -----------------------------------------------------------

  function icsDate(d) {
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }

  function icsEscape(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/\r?\n/g, '\\n')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;');
  }

  function fold(line) {
    // RFC 5545: lines should be <= 75 octets; continuation lines start with a space.
    const enc = new TextEncoder();
    const out = [];
    let cur = '';
    let bytes = 0;
    for (const ch of line) {
      const b = enc.encode(ch).length;
      if (bytes + b > 74) {
        out.push(cur);
        cur = ' ';
        bytes = 1;
      }
      cur += ch;
      bytes += b;
    }
    out.push(cur);
    return out.join('\r\n');
  }

  function sessionDescription(s, ctx) {
    const lines = [];
    const papers = (s.papers || []).map((id) => ctx.papersById[id]).filter(Boolean);
    if (papers.length) {
      lines.push('Reading:');
      for (const p of papers) lines.push('- ' + p.title + ' (' + p.authors + ', ' + p.year + ')' + (p.url ? ' ' + p.url : ''));
    }
    const presenters = (s.presenters || []).map((id) => (ctx.membersById[id] || { name: id }).name);
    if (presenters.length) lines.push('', 'Presenting: ' + presenters.join(', '));
    if (s.prep) lines.push('', 'Prep: ' + s.prep);
    const link = s.meetingLink || ctx.config.meetingLink;
    if (link) lines.push('', 'Join: ' + link);
    if (ctx.siteUrl) lines.push('', ctx.siteUrl + '#session-' + s.id);
    return lines.join('\n');
  }

  function buildICS(sessions, ctx) {
    const cfg = ctx.config;
    const now = icsDate(new Date());
    const host = (ctx.siteUrl && ctx.siteUrl.replace(/^https?:\/\//, '').split('/')[0]) || 'reading-group.local';
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//' + icsEscape(cfg.groupName || 'Reading Group') + '//Site//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:' + icsEscape(cfg.groupName || 'Reading group'),
      'X-WR-TIMEZONE:' + (cfg.timezone || 'UTC'),
      'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
      'X-PUBLISHED-TTL:PT6H'
    ];
    for (const s of sessions) {
      const loc = s.location || cfg.defaultLocation || '';
      lines.push(
        'BEGIN:VEVENT',
        'UID:' + s.id + '@' + host,
        'DTSTAMP:' + now,
        'DTSTART:' + icsDate(s.startDate),
        'DTEND:' + icsDate(s.endDate),
        'SUMMARY:' + icsEscape('Session ' + s.number + ': ' + s.title),
        'DESCRIPTION:' + icsEscape(sessionDescription(s, ctx))
      );
      if (loc) lines.push('LOCATION:' + icsEscape(loc));
      if (ctx.siteUrl) lines.push('URL:' + ctx.siteUrl + '#session-' + s.id);
      lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
  }

  function googleCalendarLink(s, ctx) {
    const cfg = ctx.config;
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: 'Session ' + s.number + ': ' + s.title,
      dates: icsDate(s.startDate) + '/' + icsDate(s.endDate),
      details: sessionDescription(s, ctx),
      location: s.location || cfg.defaultLocation || ''
    });
    return 'https://calendar.google.com/calendar/render?' + params.toString();
  }

  return { tzParts, parseStart, prepareSessions, buildICS, googleCalendarLink, icsDate };
});
