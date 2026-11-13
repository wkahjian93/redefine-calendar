/* ---------- Google Apps Script part ----------
   Script properties (Project Settings > Script properties):
     TEAM_CODE              required, 6+ characters: members sign in with it
     LEADER_CODE            required, 10+ characters: leaders sign in with it
     OPENAI_API_KEY         required for photo import (sent with store:false; photos are never kept)
     FCM_SERVICE_ACCOUNT    for phone pop-ups when the app is closed: the whole Firebase service-account JSON
     MODEL                  optional (default gpt-6.1-terra)
     DAILY_READS            optional, photo readings per member per day (default 40)
     APP_URL                optional, the app's public link (used to open the right screen from a pop-up)
   Data: private Google Sheet "REDEFINE Calendar Data", created by setup(), which also installs the timed jobs. */

function reply(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function doGet() { return reply({ok: true, app: 'REDEFINE Calendar'}); }

function doPost(e) {
  try {
    var out = CORE.handle(JSON.parse(e.postData.contents), GAS);
    GAS.flushPush();   // pop-ups go out after the data is saved and the lock is released
    return reply(out);
  } catch (err) {
    if (err.appCode) return reply({error: err.appCode});
    console.error('server error: ' + (err && err.stack));
    return reply({error: 'server_error'});
  }
}

var GAS = (function () {
  var P = PropertiesService.getScriptProperties();
  var cache = {}, outbox = [], headOk = {};

  function book() {
    var id = P.getProperty('SHEET_ID');
    if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
    var b = SpreadsheetApp.create('REDEFINE Calendar Data');
    P.setProperty('SHEET_ID', b.getId());
    return b;
  }
  function tab(name) {
    var b = book(), s = b.getSheetByName(name), cols = CORE.TABLES[name];
    if (!s) {
      s = b.insertSheet(name);
      s.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
      s.setFrozenRows(1);
      s.getRange(1, 1, s.getMaxRows(), cols.length).setNumberFormat('@');
      var first = b.getSheetByName('Sheet1');
      if (first && b.getSheets().length > 1) b.deleteSheet(first);
    } else if (!headOk[name]) {
      if (s.getLastColumn() < cols.length || s.getRange(1, cols.length).getValue() !== cols[cols.length - 1]) s.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');   // new columns added in an update
    }
    headOk[name] = 1;
    return s;
  }
  function load(name) {
    if (cache[name]) return JSON.parse(JSON.stringify(cache[name]));
    var cols = CORE.TABLES[name], s = tab(name), n = s.getLastRow() - 1, rows = [];
    if (n > 0) s.getRange(2, 1, n, cols.length).getValues().forEach(function (r) {
      if (r.every(function (v) { return v === '' || v === null; })) return;
      var o = {}; cols.forEach(function (c, i) { o[c] = r[i] instanceof Date ? r[i].toISOString() : (r[i] === null ? '' : String(r[i])); }); rows.push(o);
    });
    cache[name] = rows;
    return JSON.parse(JSON.stringify(rows));
  }
  function toVals(cols, rows) { return rows.map(function (o) { return cols.map(function (c) { var v = o[c]; return v === undefined || v === null ? '' : String(v); }); }); }
  /* Writes only the rows that changed since this table was read (one event saved = one row written, not the whole sheet).
     Deletions or a table not read in this request fall back to rewriting the table. */
  function save(name, rows) {
    var cols = CORE.TABLES[name], s = tab(name), vals = toVals(cols, rows), before = cache[name], SEP = '\u0001';
    if (before && vals.length >= before.length) {
      var oldVals = toVals(cols, before), st = -1;
      for (var i = 0; i <= vals.length; i++) {
        var changed = i < vals.length && !(i < oldVals.length && oldVals[i].join(SEP) === vals[i].join(SEP));
        if (changed && st < 0) st = i;
        if (!changed && st >= 0) { s.getRange(st + 2, 1, i - st, cols.length).setNumberFormat('@').setValues(vals.slice(st, i)); st = -1; }
      }
    } else {
      var old = s.getLastRow() - 1;
      if (vals.length) s.getRange(2, 1, vals.length, cols.length).setNumberFormat('@').setValues(vals);
      if (old > vals.length) s.getRange(vals.length + 2, 1, old - vals.length, cols.length).clearContent();
    }
    cache[name] = JSON.parse(JSON.stringify(rows));
  }
  function ai(prompt, b64) {
    var key = P.getProperty('OPENAI_API_KEY'); if (!key) { var e = new Error('no_api_key'); e.appCode = 'no_api_key'; throw e; }
    var res = UrlFetchApp.fetch('https://api.openai.com/v1/responses', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: {Authorization: 'Bearer ' + key},
      payload: JSON.stringify({
        model: P.getProperty('MODEL') || 'gpt-6.1-terra', store: false, max_output_tokens: 16000,
        reasoning: {effort: 'medium'}, text: {format: {type: 'json_object'}},
        input: [{role: 'user', content: [{type: 'input_text', text: prompt}, {type: 'input_image', image_url: 'data:image/jpeg;base64,' + b64, detail: 'high'}]}]
      })
    });
    var status = res.getResponseCode(), code = '';
    if (status === 401) code = 'bad_api_key'; else if (status === 429) code = /insufficient_quota/.test(res.getContentText()) ? 'no_credit' : 'rate_limited';
    else if (status !== 200) { console.error('openai status ' + status); code = 'ai_unavailable'; }
    if (code) { var er = new Error(code); er.appCode = code; throw er; }
    var msg = JSON.parse(res.getContentText()), text = '';
    (msg.output || []).forEach(function (it) { if (it.type === 'message') (it.content || []).forEach(function (c) { if (c.type === 'output_text') text += c.text; }); });
    return text;
  }

  /* Firebase Cloud Messaging (HTTP v1). The service account signs a short-lived token; it is cached for 50 minutes. */
  function fcmAccess(sa) {
    var c = CacheService.getScriptCache(), t = c.get('fcm_at'); if (t) return t;
    var b64 = function (s) { return Utilities.base64EncodeWebSafe(s).replace(/=+$/, ''); };
    var now = Math.floor(Date.now() / 1000);
    var head = b64(JSON.stringify({alg: 'RS256', typ: 'JWT'})), claim = b64(JSON.stringify({iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600}));
    var sig = b64(Utilities.computeRsaSha256Signature(head + '.' + claim, sa.private_key));
    var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {method: 'post', muteHttpExceptions: true, payload: {grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + claim + '.' + sig}});
    if (res.getResponseCode() !== 200) { console.error('fcm auth ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 300)); return ''; }
    t = JSON.parse(res.getContentText()).access_token; c.put('fcm_at', t, 3000);
    return t;
  }
  function flushPush() {
    if (!outbox.length) return;
    var list = outbox; outbox = [];
    var raw = P.getProperty('FCM_SERVICE_ACCOUNT'); if (!raw) return;
    try {
      var sa = JSON.parse(raw), at = fcmAccess(sa); if (!at) return;
      var devices = load('devices'), base = P.getProperty('APP_URL') || '', reqs = [], tokens = [];
      list.forEach(function (n) {
        devices.forEach(function (d) {
          if (n.ids.indexOf(d.memberId) < 0) return;
          tokens.push(d.token);
          reqs.push({url: 'https://fcm.googleapis.com/v1/projects/' + sa.project_id + '/messages:send', method: 'post', contentType: 'application/json', muteHttpExceptions: true,
            headers: {Authorization: 'Bearer ' + at},
            payload: JSON.stringify({message: {token: d.token,
              data: {title: n.note.title, body: n.note.body || '', url: n.note.url || '#/', tag: n.note.tag || ''},
              webpush: {headers: {Urgency: 'high', TTL: '86400'},
                notification: {title: n.note.title, body: n.note.body || '', icon: base + 'icons/icon-192.png', badge: base + 'icons/badge-72.png', tag: n.note.tag || undefined, renotify: !!n.note.tag},
                fcm_options: base ? {link: base + (n.note.url || '#/')} : undefined}}})});
        });
      });
      if (!reqs.length) { console.log('pop-up "' + list[0].note.title + '": no registered phone for ' + list.map(function (n) { return n.ids.join(','); }).join(' | ')); return; }
      var dead = [], ok = 0;
      for (var i = 0; i < reqs.length; i += 50) UrlFetchApp.fetchAll(reqs.slice(i, i + 50)).forEach(function (r, k) {
        var code = r.getResponseCode();
        var body = r.getContentText();
        if (code === 200) ok++;
        else if (code === 404 || code === 410 || /UNREGISTERED/.test(body)) { dead.push(tokens[i + k]); console.warn('phone no longer registered (removed): fcm ' + code + ' ' + body.slice(0, 200)); }
        else console.warn('fcm ' + code + ' ' + body.slice(0, 300));   // e.g. INVALID_ARGUMENT: keep the phone, log the reason
      });
      console.log('pop-ups: ' + ok + ' of ' + reqs.length + ' accepted by Firebase');
      if (dead.length) withLock(function () { save('devices', load('devices').filter(function (d) { return dead.indexOf(d.token) < 0; })); });   // phone uninstalled / signed out
    } catch (e) { console.error('push failed: ' + (e && e.stack)); }
  }
  function withLock(fn) { var l = LockService.getScriptLock(); l.waitLock(20000); try { cache = {}; return fn(); } finally { l.releaseLock(); } }

  return {
    load: load, save: save, withLock: withLock, ai: ai, flushPush: flushPush,
    push: function (ids, note) { if (ids && ids.length) outbox.push({ids: ids, note: note}); },
    prop: function (k) { return P.getProperty(k) || ''; },
    fails: function (add) { var c = CacheService.getScriptCache(), n = +(c.get('fails') || 0); if (add) { c.put('fails', String(n + add), 900); Utilities.sleep(800); } return n; },
    now: function () { return new Date(); },
    sleep: function (ms) { Utilities.sleep(ms); },
    random: Math.random,
    hash: function (t) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, t, Utilities.Charset.UTF_8).map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join(''); },
    version: function (bump) { var v = +(P.getProperty('VER') || 1); if (bump) { v++; P.setProperty('VER', String(v)); } return v; }
  };
})();

/* Timed jobs, installed by setup(). */
function reminderTick() { GAS.withLock(function () { CORE.tick(GAS); }); GAS.flushPush(); }
function morningDigest() { GAS.withLock(function () { CORE.morning(GAS); }); GAS.flushPush(); }
function eveningConfirm() { GAS.withLock(function () { CORE.evening(GAS); }); GAS.flushPush(); }

/* Run once from the editor: creates the Sheet, asks for permissions, installs the reminder jobs. */
function setup() {
  Object.keys(CORE.TABLES).forEach(function (t) { GAS.load(t); });
  UrlFetchApp.fetch('https://api.openai.com/v1/models', {muteHttpExceptions: true});
  var want = {reminderTick: 1, morningDigest: 1, eveningConfirm: 1};
  ScriptApp.getProjectTriggers().forEach(function (t) { if (want[t.getHandlerFunction()]) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('reminderTick').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('morningDigest').timeBased().atHour(8).everyDays(1).inTimezone('Asia/Kuala_Lumpur').create();
  ScriptApp.newTrigger('eveningConfirm').timeBased().atHour(21).everyDays(1).inTimezone('Asia/Kuala_Lumpur').create();
  var P = PropertiesService.getScriptProperties();
  console.log('Ready. Data sheet: ' + SpreadsheetApp.openById(P.getProperty('SHEET_ID')).getUrl());
  if ((P.getProperty('TEAM_CODE') || '').length < 6) console.warn('Add TEAM_CODE (6+ characters) in Script properties.');
  if ((P.getProperty('LEADER_CODE') || '').length < 10) console.warn('Add LEADER_CODE (10+ characters) in Script properties.');
  if (!P.getProperty('OPENAI_API_KEY')) console.warn('Add OPENAI_API_KEY in Script properties (photo import).');
  if (!P.getProperty('FCM_SERVICE_ACCOUNT')) console.warn('Add FCM_SERVICE_ACCOUNT in Script properties (phone pop-ups when the app is closed).');
  else { try { var sa = JSON.parse(P.getProperty('FCM_SERVICE_ACCOUNT')); console.log('Firebase project: ' + sa.project_id); } catch (e) { console.warn('FCM_SERVICE_ACCOUNT is not valid JSON - paste the whole file.'); } }
}
