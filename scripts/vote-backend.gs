/**
 * Private storage for the reading group website (GitHub Pages version).
 * Keeps members, the schedule, votes, proposals and chat in this Google Sheet,
 * and gives them only to people who send the group code or the organizer code.
 *
 * Setup (or update; the web address stays the same when you update):
 *  1. In your Google Sheet: Extensions → Apps Script. Delete what is there and paste this whole file.
 *  2. Change GROUP_CODE and ORGANIZER_CODE below. Save.
 *  3. First time: Deploy → New deployment → Web app. Execute as: Me. Who has access: Anyone. → Deploy.
 *     Updating:   Deploy → Manage deployments → pencil (Edit) → Version: New version → Deploy.
 *  4. The Web app URL (ends in /exec) goes into "voteUrl" in data/config.json on GitHub.
 *
 * "Who has access: Anyone" only lets the website reach this script. Nothing is handed out
 * without one of the two codes below, and this sheet itself stays private to you.
 *
 * Tabs: Members (one name per row), Sessions, Responses (votes and proposals), Chat, Files, Settings.
 * You can edit or delete rows here directly too. Shared files go into a Drive folder called
 * "Reading group shared files"; each file can be opened by people who have its link.
 * When you deploy, Google asks for permission to use Drive: that is for the shared files.
 */

const GROUP_CODE = 'change-me-group';  // ← members type this to open the site
const ORGANIZER_CODE = 'change-me';    // ← organizers type this to open the site and edit it

const TABS = {
  Members: ['name'],
  Sessions: ['id', 'updated', 'title', 'session'],
  Responses: ['time', 'form', 'key', 'summary', 'answers'],
  Chat: ['id', 'time', 'name', 'text', 'edited'],
  Files: ['id', 'time', 'name', 'filename', 'url', 'size', 'note', 'driveId'],
  Settings: ['key', 'value']
};

function tab_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(TABS[name]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function rows_(name) {
  const sh = tab_(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, TABS[name].length).getValues();
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function iso_(v) { return v instanceof Date ? v.toISOString() : String(v); }

function role_(code) {
  code = String(code || '');
  if (code && code === ORGANIZER_CODE) return 'organizer';
  if (code && code === GROUP_CODE) return 'member';
  return '';
}

function doGet() {
  return json_({ ok: false, code: 'locked', error: 'Open the website and enter the group code.' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (GROUP_CODE === 'change-me-group' || ORGANIZER_CODE === 'change-me' || !GROUP_CODE || !ORGANIZER_CODE) {
      return json_({ ok: false, code: 'no_code_set', error: 'Set GROUP_CODE and ORGANIZER_CODE in the Google script first.' });
    }
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const role = role_(body.code);
    if (!role) return json_({ ok: false, code: 'bad_code', error: 'Wrong code.' });
    const organizerOnly = ['session', 'members', 'response', 'chat-delete', 'settings', 'file-delete'];
    if (organizerOnly.indexOf(body.kind) !== -1 && role !== 'organizer') {
      return json_({ ok: false, code: 'bad_code', error: 'Only organizers can do this.' });
    }
    switch (body.kind) {
      case 'load': return load_(role);
      case 'answer': return answer_(body);
      case 'chat': return chat_(body);
      case 'chat-delete': return deleteById_('Chat', String(body.id || ''));
      case 'chat-edit': return chatEdit_(body);
      case 'settings': return settings_(body);
      case 'file': return file_(body);
      case 'file-delete': return fileDelete_(body);
      case 'session': return session_(body);
      case 'members': return members_(body);
      case 'response': return deleteResponse_(body);
      default: return json_({ ok: false, error: 'Unknown request.' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function load_(role) {
  const members = rows_('Members').map(function (r) { return String(r[0]).trim(); }).filter(String);
  const sessions = [];
  rows_('Sessions').forEach(function (r) { try { sessions.push(JSON.parse(r[3])); } catch (err) { /* skip */ } });
  const rows = [];
  rows_('Responses').forEach(function (r) {
    let answers = null;
    try { answers = JSON.parse(r[4]); } catch (err) { return; }
    rows.push({ at: iso_(r[0]), survey: String(r[1]), key: String(r[2]), answers: answers });
  });
  const chat = rows_('Chat').slice(-300).map(function (r) {
    return { id: String(r[0]), at: iso_(r[1]), name: String(r[2]), text: String(r[3]), edited: r[4] ? iso_(r[4]) : '' };
  });
  const files = rows_('Files').map(function (r) {
    return { id: String(r[0]), at: iso_(r[1]), name: String(r[2]), filename: String(r[3]), url: String(r[4]), size: Number(r[5]) || 0, note: String(r[6]) };
  });
  const settings = {};
  rows_('Settings').forEach(function (r) { try { settings[String(r[0])] = JSON.parse(r[1]); } catch (err) { /* skip */ } });
  return json_({ ok: true, role: role, members: members, sessions: sessions, rows: rows, chat: chat, files: files, settings: settings });
}

function answer_(body) {
  const form = String(body.survey || '').slice(0, 64);
  const key = String(body.key || '').slice(0, 200);
  const answers = body.answers && typeof body.answers === 'object' ? body.answers : null;
  if (!form || !key || !answers) return json_({ ok: false, error: 'Missing form, key or answers.' });
  const text = JSON.stringify(answers);
  if (text.length > 8000) return json_({ ok: false, error: 'Answer too long.' });
  const summary = Object.keys(answers).map(function (k) {
    const v = answers[k];
    return k + ': ' + (Array.isArray(v) ? v.join(', ') : String(v));
  }).join(' | ');
  tab_('Responses').appendRow([new Date().toISOString(), form, key, summary, text]);
  return json_({ ok: true });
}

function chat_(body) {
  const name = String(body.name || '').trim().slice(0, 80);
  const text = String(body.text || '').trim().slice(0, 1000);
  if (!name || !text) return json_({ ok: false, error: 'Missing name or message.' });
  const id = Utilities.getUuid();
  // A leading apostrophe stops the sheet treating "=..." as a formula.
  tab_('Chat').appendRow([id, new Date().toISOString(), "'" + name, "'" + text]);
  return json_({ ok: true, id: id });
}

function session_(body) {
  const id = String(body.action === 'delete' ? body.id : (body.session && body.session.id) || '').slice(0, 64);
  if (!id) return json_({ ok: false, error: 'Missing session id.' });
  if (body.action === 'delete') return deleteById_('Sessions', id);
  const text = JSON.stringify(body.session);
  if (text.length > 20000) return json_({ ok: false, error: 'Session too long.' });
  const sh = tab_('Sessions');
  const values = [[id, new Date().toISOString(), String(body.session.title || ''), text]];
  const row = findRow_('Sessions', id);
  if (row > 0) sh.getRange(row, 1, 1, 4).setValues(values);
  else sh.appendRow(values[0]);
  return json_({ ok: true });
}

function members_(body) {
  const names = (Array.isArray(body.names) ? body.names : [])
    .map(function (n) { return String(n).trim().slice(0, 80); })
    .filter(String).slice(0, 200);
  const sh = tab_('Members');
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 1).clearContent();
  if (names.length) sh.getRange(2, 1, names.length, 1).setValues(names.map(function (n) { return ["'" + n]; }));
  return json_({ ok: true });
}

function deleteResponse_(body) {
  const form = String(body.survey || '');
  const key = String(body.key || '');
  if (!form || !key) return json_({ ok: false, error: 'Missing form or key.' });
  const sh = tab_('Responses');
  const data = rows_('Responses');
  let removed = 0;
  for (let i = data.length - 1; i >= 0; i--) {
    if (String(data[i][1]) === form && String(data[i][2]) === key) { sh.deleteRow(i + 2); removed++; }
  }
  return json_({ ok: true, removed: removed });
}

function findRow_(name, id) {
  const data = rows_(name);
  for (let i = 0; i < data.length; i++) if (String(data[i][0]) === id) return i + 2;
  return -1;
}

function deleteById_(name, id) {
  if (!id) return json_({ ok: false, error: 'Missing id.' });
  const row = findRow_(name, id);
  if (row > 0) tab_(name).deleteRow(row);
  return json_({ ok: true });
}

function chatEdit_(body) {
  const id = String(body.id || '');
  const text = String(body.text || '').trim().slice(0, 1000);
  if (!id || !text) return json_({ ok: false, error: 'Missing message.' });
  const row = findRow_('Chat', id);
  if (row < 0) return json_({ ok: false, error: 'Message not found.' });
  tab_('Chat').getRange(row, 4, 1, 2).setValues([["'" + text, new Date().toISOString()]]);
  return json_({ ok: true });
}

function settings_(body) {
  const key = String(body.key || '').slice(0, 40);
  if (!key) return json_({ ok: false, error: 'Missing setting name.' });
  const text = JSON.stringify(body.value == null ? null : body.value);
  if (text.length > 20000) return json_({ ok: false, error: 'Setting too long.' });
  const row = findRow_('Settings', key);
  if (row > 0) tab_('Settings').getRange(row, 1, 1, 2).setValues([[key, text]]);
  else tab_('Settings').appendRow([key, text]);
  return json_({ ok: true });
}

function folder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (err) { /* folder deleted: make a new one */ } }
  const folder = DriveApp.createFolder('Reading group shared files');
  props.setProperty('FOLDER_ID', folder.getId());
  return folder;
}

function file_(body) {
  const name = String(body.name || '').trim().slice(0, 80);
  const filename = String(body.filename || 'file').replace(/[\\/]/g, '_').slice(0, 150);
  const data = String(body.data || '');
  if (!name || !data) return json_({ ok: false, error: 'Missing name or file.' });
  if (data.length > 14000000) return json_({ ok: false, error: 'File too large (10 MB at most).' });
  const blob = Utilities.newBlob(Utilities.base64Decode(data), String(body.mime || 'application/octet-stream'), filename);
  const file = folder_().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const id = Utilities.getUuid();
  const url = file.getUrl();
  tab_('Files').appendRow([id, new Date().toISOString(), "'" + name, "'" + filename, url, blob.getBytes().length, "'" + String(body.note || '').slice(0, 300), file.getId()]);
  return json_({ ok: true, id: id, url: url });
}

function fileDelete_(body) {
  const id = String(body.id || '');
  const row = findRow_('Files', id);
  if (row < 0) return json_({ ok: true });
  const driveId = String(tab_('Files').getRange(row, 8).getValue());
  try { DriveApp.getFileById(driveId).setTrashed(true); } catch (err) { /* already gone */ }
  tab_('Files').deleteRow(row);
  return json_({ ok: true });
}
