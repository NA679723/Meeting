/**
 * Vote storage for the reading group website (GitHub Pages version).
 *
 * Setup, once:
 *  1. Create a Google Sheet (any name).
 *  2. In the sheet: Extensions → Apps Script. Delete what is there and paste this whole file. Save.
 *  3. Deploy → New deployment → type "Web app".
 *     Execute as: Me.  Who has access: Anyone.  → Deploy, then allow access when Google asks.
 *  4. Copy the Web app URL (ends in /exec) into "voteUrl" in data/config.json on GitHub.
 *
 * Every answer becomes a row in the "Responses" tab. The website reads them back to show results.
 * To remove a test or spam answer, delete its row.
 */

const SHEET_NAME = 'Responses';
const HEADER = ['time', 'form', 'key', 'summary', 'answers'];

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADER);
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
    const form = String(body.survey || '').slice(0, 64);
    const key = String(body.key || '').slice(0, 200);
    const answers = body.answers && typeof body.answers === 'object' ? body.answers : null;
    if (!form || !key || !answers) return json_({ ok: false, error: 'Missing form, key or answers.' });
    const text = JSON.stringify(answers);
    if (text.length > 8000) return json_({ ok: false, error: 'Answer too long.' });
    getSheet_().appendRow([new Date().toISOString(), form, key, summary_(answers), text]);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  const values = getSheet_().getDataRange().getValues().slice(1);
  const rows = [];
  values.forEach(function (r) {
    let answers = null;
    try { answers = JSON.parse(r[4]); } catch (err) { return; }
    rows.push({
      at: r[0] instanceof Date ? r[0].toISOString() : String(r[0]),
      survey: String(r[1]),
      key: String(r[2]),
      answers: answers
    });
  });
  return json_({ ok: true, rows: rows });
}
