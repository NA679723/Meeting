/**
 * Storage for the reading group website (GitHub Pages version):
 * votes, presenter proposals, and the schedule organizers edit on the website.
 *
 * First-time setup:
 *  1. Create a Google Sheet (any name).
 *  2. In the sheet: Extensions → Apps Script. Delete what is there and paste this whole file.
 *  3. Change ORGANIZER_CODE below to a code only organizers know. Save.
 *  4. Deploy → New deployment → type "Web app".
 *     Execute as: Me.  Who has access: Anyone.  → Deploy, then allow access when Google asks.
 *  5. Copy the Web app URL (ends in /exec) into "voteUrl" in data/config.json on GitHub.
 *
 * Updating an existing setup (keeps the same URL):
 *  paste the new code, save, then Deploy → Manage deployments → pencil (Edit)
 *  → Version: "New version" → Deploy.
 *
 * Votes go to the "Responses" tab, sessions to the "Sessions" tab.
 * To remove a test or spam answer, delete its row.
 */

const ORGANIZER_CODE = 'change-me'; // ← change this. Organizers type it on the website to edit the schedule.

function getTab_(name, header) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(header);
    sh.setFrozenRows(1);
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function summary_(answers) {
  return Object.keys(answers).map(function (k) {
    const v = answers[k];
    return k + ': ' + (Array.isArray(v) ? v.join(', ') : String(v));
  }).join(' | ');
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.kind === 'session') return saveSession_(body);

    const form = String(body.survey || '').slice(0, 64);
    const key = String(body.key || '').slice(0, 200);
    const answers = body.answers && typeof body.answers === 'object' ? body.answers : null;
    if (!form || !key || !answers) return json_({ ok: false, error: 'Missing form, key or answers.' });
    const text = JSON.stringify(answers);
    if (text.length > 8000) return json_({ ok: false, error: 'Answer too long.' });
    getTab_('Responses', ['time', 'form', 'key', 'summary', 'answers'])
      .appendRow([new Date().toISOString(), form, key, summary_(answers), text]);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function saveSession_(body) {
  if (!ORGANIZER_CODE || ORGANIZER_CODE === 'change-me') {
    return json_({ ok: false, code: 'no_code_set', error: 'Set ORGANIZER_CODE in the Google script first.' });
  }
  if (String(body.code || '') !== ORGANIZER_CODE) {
    return json_({ ok: false, code: 'bad_code', error: 'Wrong organizer code.' });
  }
  const sh = getTab_('Sessions', ['id', 'updated', 'title', 'session']);
  const id = String(body.action === 'delete' ? body.id : (body.session && body.session.id) || '').slice(0, 64);
  if (!id) return json_({ ok: false, error: 'Missing session id.' });

  let row = -1;
  const last = sh.getLastRow();
  if (last > 1) {
    const ids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === id) { row = i + 2; break; }
    }
  }
  if (body.action === 'delete') {
    if (row > 0) sh.deleteRow(row);
    return json_({ ok: true });
  }
  const text = JSON.stringify(body.session);
  if (text.length > 20000) return json_({ ok: false, error: 'Session too long.' });
  const values = [[id, new Date().toISOString(), String(body.session.title || ''), text]];
  if (row > 0) sh.getRange(row, 1, 1, 4).setValues(values);
  else sh.appendRow(values[0]);
  return json_({ ok: true });
}

function doGet() {
  const rows = [];
  getTab_('Responses', ['time', 'form', 'key', 'summary', 'answers']).getDataRange().getValues().slice(1).forEach(function (r) {
    let answers = null;
    try { answers = JSON.parse(r[4]); } catch (err) { return; }
    rows.push({
      at: r[0] instanceof Date ? r[0].toISOString() : String(r[0]),
      survey: String(r[1]),
      key: String(r[2]),
      answers: answers
    });
  });
  const sessions = [];
  getTab_('Sessions', ['id', 'updated', 'title', 'session']).getDataRange().getValues().slice(1).forEach(function (r) {
    try { sessions.push(JSON.parse(r[3])); } catch (err) { /* skip broken row */ }
  });
  return json_({ ok: true, rows: rows, sessions: sessions });
}
