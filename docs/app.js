/* REDEFINE Calendar - phone app. Screens: Calendar (month / team day / list), event + comments, editor, confirm, comments feed, stats, me, import.
   All times are Malaysia time. Talks to the team server with small JSON posts (see core.js for the rules). */
(function () {
  'use strict';
  var C = CORE, CFG = self.RCAL_CONFIG || {};
  var $app = document.getElementById('app');
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var APP_VERSION = '41';
  var H8 = 8 * 3600e3, DAY = 864e5, SELLING = {approach: 1, open: 1, present: 1, followup: 1, close: 1, joinfield: 1, recruit: 1};

  /* ---------- storage (each phone) ---------- */
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem('rcal.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('rcal.' + k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem('rcal.' + k); } catch (e) {} }
  };
  var S = {
    token: LS.get('token', ''), data: LS.get('cache', null), ver: 0, range: null,
    view: LS.get('view', 'month'), filter: LS.get('filter', 'all'),
    cursor: null, sel: null, dayView: null, stats: {}, statsPeriod: LS.get('statsPeriod', 'month'),
    lastRead: LS.get('lastRead', {}), reminded: LS.get('reminded', {}), importRows: null, busy: false, online: true
  };

  /* ---------- helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }
  function pad(n) { return ('0' + n).slice(-2); }
  function P(ms) { var d = new Date(ms + H8); return {y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), w: d.getUTCDay(), h: d.getUTCHours(), mi: d.getUTCMinutes()}; }
  function dayKey(ms) { return new Date(ms + H8).toISOString().slice(0, 10); }
  function keyMs(k) { return Date.parse(k + 'T00:00:00+08:00'); }
  function addDays(k, n) { return dayKey(keyMs(k) + n * DAY + 3600e3); }
  function hm(ms) { var p = P(ms); return ((p.h % 12) || 12) + (p.mi ? ':' + pad(p.mi) : '') + (p.h < 12 ? 'am' : 'pm'); }
  function hm24(ms) { var p = P(ms); return pad(p.h) + ':' + pad(p.mi); }
  function dayLabel(k, long) { var p = P(keyMs(k)); var t = dayKey(Date.now()); var pre = k === t ? 'Today · ' : k === addDays(t, 1) ? 'Tomorrow · ' : k === addDays(t, -1) ? 'Yesterday · ' : ''; return pre + DOW[p.w] + ', ' + p.d + ' ' + (long ? MONTH[p.m] : MON[p.m]); }
  function ago(iso) {
    var s = (Date.now() - Date.parse(iso)) / 1000; if (s < 60) return 'now'; if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h'; var k = dayKey(Date.parse(iso)); return k === addDays(dayKey(Date.now()), -1) ? 'Yesterday' : P(Date.parse(iso)).d + ' ' + MON[P(Date.parse(iso)).m];
  }
  function money(n) { return (Math.round(n * 100) / 100).toLocaleString('en-MY', {maximumFractionDigits: 2}); }   // 23,705.65 / 93,400
  function rm(n) { return 'RM' + money(n); }
  function pct(x) { return x == null ? '–' : Math.round(x * 100) + '%'; }
  var tCache = new WeakMap();
  function times(e) { var t = tCache.get(e); if (!t || t[2] !== e.start || t[3] !== e.end) { t = [C.startMs(e), C.endMs(e), e.start, e.end]; tCache.set(e, t); } return t; }
  function sMs(e) { return times(e)[0]; }
  function eMs(e) { return times(e)[1]; }
  function members() { return (S.data && S.data.members) || []; }
  var memIdx = {list: null, map: {}};
  function mem(id) { var l = members(); if (memIdx.list !== l) { memIdx = {list: l, map: {}}; l.forEach(function (m) { memIdx.map[m.id] = m; }); } return memIdx.map[id] || {id: id, name: 'Former member', color: '#999'}; }
  function me() { return (S.data && S.data.me) || {}; }
  function isLeader() { return !!me().leader; }
  function shortName(m) { return (m && (m.short || C.defaultShort(m.name))) || '?'; }
  function initials(n) { return String(n || '?').split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase(); }
  /* 成功宝典 Color System: green = sales (prospecting, fact-find, presentation, follow-up, closing);
     yellow = client building & admin (service, CRM, paperwork); orange = recruiting; blue = meeting / learning;
     red = personal. Team events stay black with the logo; other people's private events stay grey "Busy". */
  var GROUP = {approach: 'g', open: 'g', present: 'g', followup: 'g', close: 'g', joinfield: 'g', service: 'y', crm: 'y', paperwork: 'y', recruit: 'o', meeting: 'b', personal: 'r'};
  var GROUP_COLOR = {g: '#22A049', y: '#F2C200', o: '#F08A24', b: '#3B82F6', r: '#E5484D'};
  function evGroup(e) { return GROUP[e.type || e.t] || 'b'; }
  function evColor(e) { if (e.bday) return '#EC4899'; if (e.busy) return '#9CA3AF'; if (e.all) return '#000000'; return GROUP_COLOR[evGroup(e)]; }
  function evStyle(e) { return '--c:' + evColor(e) + (!e.busy && !e.all && evGroup(e) === 'y' ? ';--fg:#1F2937' : ''); }
  function legend() { return '<div class="legend"><span><b class="ph-dot">8</b>Public holiday</span><span><i class="sch-dot"></i>School holiday</span><span><i style="background:#EC4899"></i>Birthday</span><span><i style="background:#22A049"></i>Sales</span><span><i style="background:#F2C200"></i>Client & admin</span><span><i style="background:#F08A24"></i>Recruit</span><span><i style="background:#3B82F6"></i>Meeting / learning</span><span><i style="background:#E5484D"></i>Personal</span></div>'; }
  /* portraits: downloaded only when a member's photo version changes, kept on the phone */
  var photoCache = LS.get('photos', {});
  function photoOf(m) { var p = m && m.photoV && photoCache[m.id]; return p && p.v === m.photoV ? p.d : ''; }
  function loadPhotos() {
    var need = members().filter(function (m) { return m.photoV && (!photoCache[m.id] || photoCache[m.id].v !== m.photoV); }).map(function (m) { return m.id; });
    if (!need.length) return;
    api('photos', {ids: need}).then(function (j) { Object.keys(j.photos || {}).forEach(function (id) { photoCache[id] = j.photos[id]; }); try { LS.set('photos', photoCache); } catch (x) {} render(); }, function () {});
  }
  function avatar(m, size) {
    var ph = photoOf(m); if (ph) return '<img class="av' + (size ? ' av-' + size : '') + ' photo" src="data:image/jpeg;base64,' + ph + '" alt="' + esc(shortName(m)) + '">'; var sh = shortName(m), t = sh.length <= 3 ? sh.toUpperCase() : initials(sh); return '<span class="av' + (size ? ' av-' + size : '') + '" style="background:' + esc(m.color || '#999') + '">' + esc(t) + '</span>'; }
  function T(type) { return C.TYPES[type] || {label: 'Event', emoji: '📌', work: 0}; }
  function evTitle(e) { return e.busy ? 'Busy' : (T(e.type).emoji + ' ' + e.title); }
  function evTime(e) { if (e.allDay) return 'All day'; return hm(sMs(e)) + ' – ' + hm(eMs(e)); }
  var ansCache = {ver: -1, map: {}};
  function ansOf(e) {   // {memberId: 'yes'|'no'} for this event (invitations + team-event attendance)
    if (ansCache.ver !== S.ver || ansCache.data !== S.data) { ansCache = {ver: S.ver, data: S.data, map: {}}; ((S.data && S.data.msgs) || []).forEach(function (m) { if (m.kind === 'rsvp') { var k = m.to.slice(3); (ansCache.map[k] = ansCache.map[k] || {})[m.from] = m.text; } }); }
    return ansCache.map[e.base || e.id] || {};
  }
  function invited(e, id) { return !e.all && e.ownerId !== id && (e.with || []).indexOf(id) >= 0; }
  function pendingFor(e, id) { return invited(e, id) && !ansOf(e)[id]; }
  /* light colour: an invitation not answered yet, or a team event this person has not said Going to (the creator counts as going) */
  function faded(e, id) { return pendingFor(e, id) || (!!e.all && e.ownerId !== id && ansOf(e)[id] !== 'yes'); }
  function involves(e, id) { return e.ownerId === id || ((e.with || []).indexOf(id) >= 0 && ansOf(e)[id] !== 'no') || !!e.all; }
  function myInvites() { var my = me().id; return events().filter(function (e) { return pendingFor(e, my) && eMs(e) > Date.now() && e.out !== 'cancel'; }).sort(function (a, b) { return sMs(a) - sMs(b); }); }
  function isWork(e) { var t = e.type || e.t; return !!(C.TYPES[t] && C.TYPES[t].work); }
  function needsConfirm(e) { return !e.occ && !e.bday && e.ownerId === me().id && !e.busy && isWork(e) && !e.out && eMs(e) <= Date.now(); }
  function rawEvents() { return (S.data && S.data.events) || []; }
  /* Repeating events are expanded into their dates; team birthdays (Me → My birthday) appear for everyone. Cached per data version. */
  var expCache = {k: null, src: null, v: []};
  function events() {
    var src = rawEvents(), ms = members(), k = S.ver + '|' + mutSeq + '|' + src.length + '|' + (S.range ? S.range.from + S.range.to : '') + '|' + ms.map(function (m) { return m.bday || ''; }).join(',');
    if (expCache.src === src && expCache.k === k) return expCache.v;
    var A = S.range ? Date.parse(S.range.from) : Date.now() - 60 * DAY, B = S.range ? Date.parse(S.range.to) : Date.now() + 120 * DAY, out = [];
    src.forEach(function (e) {
      if (!e.rep) { out.push(e); return; }
      C.occurrences(e, A, B).forEach(function (o) {
        if (o.n === 0) { out.push(e); return; }
        var c = Object.assign({}, e, {id: e.id + '~' + dayKey(o.s), base: e.id, occ: dayKey(o.s), out: '', anp: 0, noc: 0, cases: []});
        if (e.allDay) { c.start = dayKey(o.s); c.end = dayKey(o.e - 1); } else { c.start = new Date(o.s).toISOString(); c.end = new Date(o.e).toISOString(); }
        out.push(c);
      });
    });
    var y0 = P(A).y, y1 = P(B).y;
    ms.forEach(function (m) {
      if (!m.bday || m.active === false) return;
      for (var y = y0; y <= y1; y++) { var kk = y + '-' + m.bday; if (keyMs(kk) >= A - DAY && keyMs(kk) < B) out.push({id: 'bd-' + m.id + '-' + y, ownerId: m.id, title: '🎂 ' + shortName(m) + '’s birthday', type: 'personal', allDay: true, start: kk, end: kk, vis: 'team', with: [], out: '', bday: true}); }
    });
    expCache = {k: k, src: src, v: out};
    return out;
  }
  var fCache = {k: null, v: null};
  function filtered() {
    var key = S.filter + '|' + S.ver + '|' + mutSeq + '|' + (S.data && S.data.events && S.data.events.length);
    if (fCache.k === key && fCache.d === S.data && fCache.e === (S.data && S.data.events)) return fCache.v;
    fCache = {k: key, d: S.data, e: S.data && S.data.events, v: filteredRaw()};
    return fCache.v;
  }
  function filteredRaw() {
    var f = S.filter, id = me().id;
    var pair = f.indexOf('me+') === 0 ? f.slice(3) : '';   // merged view: me + one teammate (e.g. husband & wife)
    return events().filter(function (e) { return f === 'all' || (f === 'me' ? involves(e, id) : pair ? involves(e, id) || involves(e, pair) : involves(e, f)); });
  }
  var dayIdx = new WeakMap();
  function onDay(list, k) {
    var idx = dayIdx.get(list);
    if (!idx) {
      idx = {};
      list.forEach(function (e) {
        var s = sMs(e), en = eMs(e), kk = dayKey(s), last = dayKey(Math.max(s, en - 1));
        for (var i = 0; i < 62; i++) { (idx[kk] = idx[kk] || []).push(e); if (kk >= last) break; kk = addDays(kk, 1); }
      });
      dayIdx.set(list, idx);
    }
    return (idx[k] || []).slice().sort(function (x, y) { return (y.allDay ? 1 : 0) - (x.allDay ? 1 : 0) || sMs(x) - sMs(y); });
  }
  function toast(msg, kind) {
    var t = document.createElement('div'); t.className = 'toast' + (kind ? ' ' + kind : ''); t.textContent = msg;
    document.getElementById('toasts').appendChild(t); setTimeout(function () { t.classList.add('out'); }, 2800); setTimeout(function () { t.remove(); }, 3300);
  }
  var ERR = {
    not_an_appointment: 'That didn’t sound like an appointment. Say what, which day and what time.',
    bad_audio: 'That recording couldn’t be used. Try again (up to 60 seconds).', nothing_heard: 'Nothing was heard. Hold the phone closer and try again.', owner_only: 'Only the owner can change celebration themes.', bad_theme: 'Please pick the colours again.', bad_music: 'Use an MP3 or M4A file up to 5 MB.',
    wrong_code: 'That team code is not right.', wrong_pin: 'Wrong PIN for that name.', pin_4_digits: 'PIN must be 4–6 digits.', name_needed: 'Please type your name.',
    too_many_tries: 'Too many wrong tries. Wait 15 minutes.', removed: 'Your leader removed this account.', signed_out: 'Please sign in again.',
    server_not_set_up: 'The team server is not set up yet.', title_needed: 'Please add a title.', date_needed: 'Please pick a date and time.',
    not_yours: 'Only the owner can change this.', not_found: 'That was deleted.', not_yet: 'This has not happened yet.', bad_anp: 'ANP looks wrong.',
    daily_limit: 'Daily photo limit reached. Try again tomorrow.', bad_photo: 'That photo could not be read. Try a smaller or clearer one.',
    ai_unreadable: 'The AI reply was messy. Please try that photo again.', no_api_key: 'Photo reading is not set up on the server yet.',
    no_credit: 'The AI account has no credit left. Tell your leader.', rate_limited: 'AI is busy. Try again in a minute.', ai_unavailable: 'AI is not available right now.',
    bad_api_key: 'The AI key on the server is wrong.', too_long: 'An event can be at most 14 days.', leader_only: 'Only leaders can do that.',
    network: 'No connection. Check your internet.', busy: 'The server is busy right now. Please try again in a moment.', too_many: 'Too many events at once (max 300).', cannot_close: 'Only open / present / follow-up / closing can be closed.', bad_noc: 'NOC must be 1 to 50 cases.', plan_needed: 'Please type the plan name for each case.', mode_needed: 'Please pick M / Q / HY / Y for each case.', cases_needed: 'Add at least one case.', not_team_event: 'Attendance is only for whole-team events.', ended: 'This event has ended.', cancelled: 'This event was cancelled.', already_linked: 'One of you is already linked to someone else.', no_request: 'That request is no longer there.', not_linked: 'You are not linked.', short_taken: 'Someone already uses that short name. Try another.', bad_short: 'Use letters and numbers only.'
  };
  function errText(e) { return ERR[e && e.code] || ERR[e && e.message] || 'Something went wrong (' + ((e && (e.code || e.message)) || 'error') + ')'; }

  /* ---------- server ---------- */
  function api(op, body) {
    if (!CFG.api) return Promise.reject({code: 'server_not_set_up'});
    var q = Object.assign({op: op, token: S.token}, body || {});
    return fetch(CFG.api, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'}, body: JSON.stringify(q)})
      .then(function (r) { return r.json(); }, function () { S.online = false; throw {code: 'network'}; })
      .then(function (j) {
        S.online = true;
        if (j.error) { if ((j.error === 'signed_out' || j.error === 'removed') && op !== 'signin') signOutLocal(j.error); throw {code: j.error}; }
        return j;
      });
  }
  function rangeFor() {
    var c = S.cursor, a = Date.UTC(c.y, c.m - 1, 1) - H8 - 7 * DAY, b = Date.UTC(c.y, c.m + 2, 1) - H8 + 7 * DAY;
    var t = Date.now(); a = Math.min(a, t - 40 * DAY); b = Math.max(b, t + 90 * DAY);
    return {from: new Date(a).toISOString(), to: new Date(b).toISOString()};
  }
  var syncing = null, pendingOps = 0, mutSeq = 0;
  function sync(force) {
    if (!S.token) return Promise.resolve();
    if (syncing) return syncing;
    var r = rangeFor(), same = S.range && S.range.from === r.from && S.range.to === r.to, seq = mutSeq;
    syncing = api('sync', {from: r.from, to: r.to, ver: same && !force ? S.ver : 0}).then(function (j) {
      syncing = null;
      if (seq !== mutSeq || pendingOps) { S.ver = 0; if (!pendingOps) setTimeout(function () { quietSync(true); }, 0); return false; }   // stale: a change happened meanwhile
      if (j.same) return false;
      var old = S.data; S.data = j; S.ver = j.ver; S.range = r; S.stats = {};
      LS.set('cache', j);
      if (!LS.get('since', '')) LS.set('since', j.now);
      notifyNew(old, j);
      setTimeout(loadPhotos, 0);
      if (j.me.mustChange) setTimeout(askNewPin, 300);
      if (pushOn() && j.me.devices === 0 && !S.repairTried) { S.repairTried = true; repairPush(false); }   // server lost this phone: reconnect quietly
      render();
      return true;
    }, function (e) { syncing = null; if (e.code === 'network') render(); throw e; });
    return syncing;
  }
  function quietSync(force) { return sync(force).catch(function () {}); }

  /* ---------- instant changes: update the screen first, save in the background ----------
     If the server refuses or there is no signal, the change is undone and a message explains why. */
  function optimistic(apply, op, body, ok, after) {
    var backup = JSON.stringify(S.data);
    if (apply) { try { apply(S.data); } catch (x) {} }
    mutSeq++; pendingOps++; ansCache.ver = -2; S.stats = {}; LS.set('cache', S.data); render();
    return apiRetry(op, body, 0).then(function (j) {
      pendingOps--; if (ok) toast(ok, 'good'); if (after) { try { after(j); } catch (x) {} render(); }
      quietSync(true); return j;
    }, function (e) {
      pendingOps--; mutSeq++; S.data = JSON.parse(backup); ansCache.ver = -2; S.stats = {}; render();
      toast('Not saved: ' + errText(e), 'bad'); quietSync(true); throw e;
    });
  }
  function apiRetry(op, body, n) {
    return api(op, body).catch(function (e) {
      if (e && e.code === 'busy' && n < 3) return new Promise(function (ok) { setTimeout(ok, 1200 * (n + 1) + Math.random() * 800); }).then(function () { return apiRetry(op, body, n + 1); });
      throw e;
    });
  }
  function applyFor(op, q) {
    var my = me().id, now = new Date().toISOString(), tmp = 'tmp' + Math.random().toString(36).slice(2);
    var ev = function (d) { return (d.events || []).filter(function (x) { return x.id === q.id; })[0]; };
    if (op === 'outcome') return function (d) {
      var e = ev(d); if (!e) return; e.out = q.out || '';
      if (q.out === 'closed') {
        var cs = (q.cases || []).map(function (c) { return {plan: c.plan, anp: c.anp === '' || c.anp == null ? '' : Math.round(+c.anp * 100) / 100, mode: String(c.mode || '').toUpperCase()}; });
        if (cs.length) { e.cases = cs; e.noc = cs.length; e.anp = cs.reduce(function (t, c) { return t + (+c.anp || 0); }, 0); } else { e.noc = +q.noc || 1; e.anp = +q.anp || 0; e.cases = []; }
      } else { e.cases = []; e.noc = 0; e.anp = 0; }
      if (q.count != null && e.type === 'approach') e.count = +q.count;
    };
    if (op === 'rsvp') return function (d) {
      d.msgs = d.msgs.filter(function (m) { return !(m.to === 'ev:' + q.id && m.from === my && m.kind === 'rsvp'); });
      if (q.answer) d.msgs.push({id: tmp, to: 'ev:' + q.id, from: my, kind: 'rsvp', text: q.answer, created: now});
    };
    if (op === 'send') return function (d) {
      if (q.kind === 'cheer') {
        var had = d.msgs.some(function (m) { return m.to === q.to && m.from === my && m.kind === 'cheer'; });
        d.msgs = d.msgs.filter(function (m) { return !(m.to === q.to && m.from === my && m.kind === 'cheer'); });
        if (!had) d.msgs.push({id: tmp, to: q.to, from: my, kind: 'cheer', text: '👏', created: now});
      } else d.msgs.push({id: tmp, to: q.to, from: my, kind: 'text', text: q.text, created: now});
    };
    if (op === 'delmsg') return function (d) { d.msgs = d.msgs.filter(function (m) { return m.id !== q.id; }); };
    if (op === 'profile' && q.bday != null) return function (d) { d.me.bday = q.bday; d.members.forEach(function (m) { if (m.id === my) m.bday = q.bday; }); };
    if (op === 'profile') return function (d) { [d.me].concat(d.members.filter(function (m) { return m.id === my; })).forEach(function (m) { if (q.color) m.color = q.color; if (q.short) { m.short = q.short; d.me.shortSet = true; } }); };
    if (op === 'todo') return function (d) { var it = q.item; d.todos = d.todos || []; var ex = d.todos.filter(function (x) { return x.id === it.id; })[0]; if (ex) { ex.text = it.text; ex.q = String(it.q); ex.due = it.due || ''; ex.done = it.done ? (ex.done || now) : ''; } else d.todos.push({id: it.id || tmp, text: it.text, q: String(it.q), due: it.due || '', done: '', created: now}); };
    if (op === 'checked') return function (d) { (d.events || []).forEach(function (x) { if (x.id === q.id) x.source = 'voiceok'; }); };
    if (op === 'tododel') return function (d) { d.todos = (d.todos || []).filter(function (x) { return x.id !== q.id; }); };
    if (op === 'goal') return function (d) { d.goals = (d.goals || []).filter(function (g) { return g.key !== q.key; }); if (q.anp !== '') d.goals.push({key: q.key, anp: String(q.anp)}); };
    if (op === 'del') return function (d) { d.events = d.events.filter(function (x) { return x.id !== q.id; }); };
    return null;
  }

  /* ---------- WhatsApp-style banners, sound, reminders ---------- */
  var audio = null;
  function ding() {
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      var t = audio.currentTime;[880, 1320].forEach(function (f, i) {
        var o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = f; o.type = 'sine';
        g.gain.setValueAtTime(0.0001, t + i * 0.12); g.gain.exponentialRampToValueAtTime(0.18, t + i * 0.12 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.3);
        o.connect(g); g.connect(audio.destination); o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.35);
      });
      if (navigator.vibrate) navigator.vibrate(80);
    } catch (e) {}
  }
  var bannerTimer = null;
  function banner(who, title, body, url) {
    var el = document.getElementById('banner');
    el.innerHTML = '<div class="bn">' + (who ? avatar(who) : '<span class="av" style="background:#14213D">🔔</span>') + '<div class="bn-t"><b>' + esc(title) + '</b><span>' + esc(body) + '</span></div></div>';
    el.className = 'show'; el.onclick = function () { el.className = ''; if (url) location.hash = url; };
    var y0 = null; el.ontouchstart = function (t) { y0 = t.touches[0].clientY; };
    el.ontouchmove = function (t) { if (y0 != null && y0 - t.touches[0].clientY > 25) { el.className = ''; y0 = null; } };
    clearTimeout(bannerTimer); bannerTimer = setTimeout(function () { el.className = ''; }, 5500);
    ding();
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted' && !pushOn()) {
      navigator.serviceWorker && navigator.serviceWorker.ready.then(function (reg) { reg.showNotification(title, {body: body, icon: 'icons/icon-192.png', tag: url || 'rcal', data: {rcal: 1, url: url}}); }).catch(function () {});
    }
  }
  function evById(id, data) { return ((data || S.data).events || []).filter(function (x) { return x.id === id; })[0]; }
  /* Is this comment / cheer meant for me? Same rule as the server's pop-ups (core.js commentTargets). */
  function forMe(m, data) {
    data = data || S.data; var my = data.me.id; if (m.from === my || m.kind === 'rsvp') return false;
    var e = evById(m.to.slice(3), data); if (!e || e.busy) return false;
    if (m.kind === 'cheer') return e.ownerId === my;
    var earlier = data.msgs.filter(function (x) { return x.to === m.to && x.created < m.created; });
    return C.commentTargets(e, earlier, m.from, data.members).indexOf(my) >= 0;
  }
  function notifyNew(old, now) {
    if (!old || !old.msgs || old.me.id !== now.me.id) return;
    var seen = {}; old.msgs.forEach(function (m) { seen[m.id] = 1; });
    var fresh = now.msgs.filter(function (m) { return !seen[m.id] && Date.now() - Date.parse(m.created) < 15 * 60e3 && forMe(m, now); });
    // someone just closed: 🎉 to everyone (the pop-up when the app is closed comes from the server)
    var was = {}; old.events.forEach(function (e) { was[e.id] = e.out; });
    var wins = now.events.filter(function (e) { return e.out === 'closed' && was[e.id] !== undefined && was[e.id] !== 'closed' && e.ownerId !== now.me.id; });
    if (wins.length) { var w = wins[0], wm = mem(w.ownerId); banner(wm, '🎉 ' + wm.name + ' closed ' + (w.noc > 1 ? w.noc + ' cases' : 'a case') + '!', 'Tap to cheer them on 👏', '#/e/' + w.id); }
    var last = fresh[fresh.length - 1]; if (!last) return;
    var url = '#/e/' + last.to.slice(3) + '/c'; if (location.hash.indexOf('#/e/' + last.to.slice(3)) === 0) { markRead(); return; }
    var e = evById(last.to.slice(3), now), who = mem(last.from);
    banner(who, (last.kind === 'cheer' ? who.name + ' cheered 👏' : who.name + ' 💬 ' + (e ? e.title : '')) + (fresh.length > 1 ? ' (+' + (fresh.length - 1) + ')' : ''), last.kind === 'cheer' ? 'on ' + (e ? e.title : 'your event') : last.text, url);
  }
  // In-app reminders while the app is open (pop-ups when closed come from the server through Firebase)
  function checkReminders() {
    if (!S.data) return;
    var now = Date.now(), my = me().id, changed = false;
    events().forEach(function (e) {
      if (e.busy || e.allDay || e.out === 'cancel' || !involves(e, my) || S.reminded[e.id]) return;
      var lead = e.all ? C.TEAM_REMIND : e.ownerId === my && e.remind !== '' && e.remind != null ? +e.remind : 15, st = sMs(e);
      if (!e.all && e.ownerId === my && e.remind === '') return;
      if (now >= st - lead * 60e3 && now < st + 5 * 60e3) {
        S.reminded[e.id] = 1; changed = true;
        banner(mem(e.ownerId), '⏰ ' + e.title, (st > now ? 'In ' + Math.max(1, Math.round((st - now) / 60e3)) + ' min' : 'Starting now') + ' · ' + hm(st) + (e.place ? ' · ' + e.place : ''), '#/e/' + e.id);
      }
    });
    if (changed) { var keep = {}; Object.keys(S.reminded).slice(-300).forEach(function (k) { keep[k] = 1; }); S.reminded = keep; LS.set('reminded', keep); }
  }

  /* ---------- unread comments ---------- */
  function markRead() { S.lastRead.feed = new Date().toISOString(); LS.set('lastRead', S.lastRead); }
  function feedItems() { return S.data ? (S.data.msgs || []).filter(function (m) { return forMe(m); }).sort(function (a, b) { return a.created < b.created ? 1 : -1; }) : []; }
  function unreadAll() { var since = S.lastRead.feed || LS.get('since', '') || ''; return feedItems().filter(function (m) { return m.created > since; }).length; }
  function toConfirm() { return events().filter(function (e) { return needsConfirm(e) && Date.now() - eMs(e) < 45 * DAY; }).sort(function (a, b) { return sMs(a) - sMs(b); }); }

  /* ---------- push (Firebase) ---------- */
  function pushOn() { return !!(CFG.firebase && LS.get('pushToken', '') && 'Notification' in window && Notification.permission === 'granted'); }
  function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function standalone() { return window.navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches); }
  function loadScript(src) { return new Promise(function (ok, bad) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = bad; document.head.appendChild(s); }); }
  var fbReady = null;
  function firebaseMessaging() {
    if (!fbReady) fbReady = loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js')
      .then(function () { return loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js'); })
      .then(function () {
        if (!firebase.apps.length) firebase.initializeApp(CFG.firebase);
        var m = firebase.messaging();
        return m;
      });
    return fbReady;
  }
  function enablePush() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      if (isIOS() && !standalone()) return modal(installHelp(true));
      return toast('This browser cannot show notifications. Try Chrome or Safari.', 'bad');
    }
    if (isIOS() && !standalone()) return modal(installHelp(true));
    return Notification.requestPermission().then(function (p) {
      if (p !== 'granted') { toast('Notifications are blocked. Allow them in your phone settings for this app.', 'bad'); render(); return; }
      if (!CFG.firebase) { toast('Banners work while the app is open. Pop-ups when closed are not set up yet.'); render(); return; }
      return navigator.serviceWorker.ready.then(function (reg) {
        return firebaseMessaging().then(function (m) { return m.getToken({vapidKey: CFG.vapidKey, serviceWorkerRegistration: reg}); });
      }).then(function (t) {
        if (!t) throw {code: 'no_token'};
        return api('pushreg', {pushToken: t}).then(function () { LS.set('pushToken', t); toast('Pop-ups are on for this phone 🔔', 'good'); return api('pushtest'); });
      }).then(function () { quietSync(true); }, function (e) { toast('Could not turn on pop-ups: ' + errText(e), 'bad'); });
    });
  }
  /* Make a brand-new registration: drop the old one (it may have been cancelled by Apple / Google) and ask again. */
  var repairing = false;
  function repairPush(loud) {
    if (repairing || !CFG.firebase || !('Notification' in window) || Notification.permission !== 'granted') { if (loud) enablePush(); return Promise.resolve(); }
    repairing = true;
    if (loud) toast('Reconnecting pop-ups…');
    return navigator.serviceWorker.ready.then(function (reg) {
      return firebaseMessaging().then(function (m) {
        return m.deleteToken().catch(function () {}).then(function () { return reg.pushManager.getSubscription(); })
          .then(function (sub) { return sub ? sub.unsubscribe().catch(function () {}) : null; })
          .then(function () { return m.getToken({vapidKey: CFG.vapidKey, serviceWorkerRegistration: reg}); });
      });
    }).then(function (t) {
      if (!t) throw {code: 'no_token'};
      return api('pushreg', {pushToken: t}).then(function () { LS.set('pushToken', t); });
    }).then(function () {
      repairing = false; if (loud) toast('Pop-ups reconnected 🔔 Try the 15-second test.', 'good'); return quietSync(true);
    }, function (e) { repairing = false; if (loud) toast('Could not reconnect: ' + errText(e), 'bad'); });
  }
  function refreshPush() {   // tokens can change; re-register quietly on each start
    if (!CFG.firebase || !LS.get('pushToken', '') || !('Notification' in window) || Notification.permission !== 'granted') return;
    navigator.serviceWorker.ready.then(function (reg) {
      return firebaseMessaging().then(function (m) { return m.getToken({vapidKey: CFG.vapidKey, serviceWorkerRegistration: reg}); });
    }).then(function (t) { if (t && t !== LS.get('pushToken', '')) return api('pushreg', {pushToken: t}).then(function () { LS.set('pushToken', t); }); }).catch(function () {});
  }

  // A pop-up arrived while the app is on screen: show the in-app banner (iPhone already shows its own notification).
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', function (ev) {
    var m = ev.data && ev.data.rcalPush; if (!m) return;
    if (!isIOS()) banner(null, m.title, m.body, m.url);
    quietSync(true);
  });

  /* ---------- modal ---------- */
  function modal(html, onMount) {
    var root = document.getElementById('modal-root');
    root.innerHTML = '<div class="scrim" data-act="close-modal"></div><div class="sheet" role="dialog" aria-modal="true">' + html + '</div>';
    root.className = 'open'; document.body.classList.add('locked');
    if (onMount) onMount(root.querySelector('.sheet'));
  }
  function closeModal() { var r = document.getElementById('modal-root'); r.className = ''; r.innerHTML = ''; document.body.classList.remove('locked'); }
  function confirmBox(title, text, yes, danger) {
    return new Promise(function (ok) {
      modal('<h3>' + esc(title) + '</h3><p class="muted">' + esc(text) + '</p><div class="row end"><button class="btn ghost" data-x="no">Cancel</button><button class="btn ' + (danger ? 'danger' : 'primary') + '" data-x="yes">' + esc(yes) + '</button></div>', function (sh) {
        sh.querySelector('[data-x=no]').onclick = function () { closeModal(); ok(false); };
        sh.querySelector('[data-x=yes]').onclick = function () { closeModal(); ok(true); };
      });
    });
  }

  /* ---------- sign in ---------- */
  function signInScreen() {
    return '<div class="signin">' +
      '<div class="logo"><img class="signin-logo" src="icons/redefine-logo.png" alt="REDEFINE"></div><h1>Calendar</h1>' +
      '<p class="muted">One calendar for the whole team. See who is busy, keep private things private, and let the app count your activities.</p>' +
      (CFG.sample ? '<p class="sample-note">Test copy: team code <b>test-team</b> (leader: <b>test-leader-code</b>), any sample name e.g. <b>Kah Jian</b>, PIN <b>1234</b>.</p>' : '') +
      '<form id="signin" autocomplete="off"><label>Team code<input name="code" required autocapitalize="off" placeholder="from your leader"></label>' +
      '<label>Your name<input name="name" required maxlength="40" placeholder="e.g. Alicia Tan"></label>' +
      '<label>PIN (4–6 digits)<input name="pin" required inputmode="numeric" pattern="\\d{4,6}" maxlength="6" type="password"></label>' +
      '<button class="btn primary big" type="submit">Sign in</button></form>' +
      '<p class="tiny muted">First time? Type your name and choose a PIN. You stay signed in on this phone, like WhatsApp.</p><p class="tiny muted"><b>Forgot your PIN or the exact name you used?</b> Ask a leader: they can see your name and give you a temporary PIN in Me → Manage members. Your calendar and data stay safe.</p></div>';
  }
  function doSignIn(form, create) {
    var f = new FormData(form), body = {code: f.get('code'), name: f.get('name'), pin: f.get('pin'), device: navigator.userAgent.slice(0, 60), create: !!create};
    var btn = form.querySelector('button'); btn.disabled = true; btn.textContent = 'Signing in…';
    // keep a pre-filled New event link from another REDEFINE app (e.g. 90Days Kick Start) through sign-in
    var after = /^#\/new(\?|$)/.test(location.hash) ? location.hash : '#/';
    api('signin', body).then(function (j) {
      S.token = j.token; LS.set('token', j.token); LS.set('since', new Date().toISOString());
      toast(j.created ? 'Welcome to REDEFINE Calendar, ' + j.me.name + '!' : 'Welcome back, ' + j.me.name, 'good');
      return sync(true);
    }).then(function () { location.hash = after; render(); askNewPin(); }, function (e) {
      btn.disabled = false; btn.textContent = 'Sign in';
      if (e.code === 'new_name') return confirmBox('New member?', 'No one called "' + body.name + '" yet. Create a new member with this name and PIN?', 'Create').then(function (y) { if (y) doSignIn(form, true); });
      toast(errText(e), 'bad');
    });
  }
  document.addEventListener('change', function (ev) {
    var el = ev.target, w = el && el.dataset && el.dataset.act; if (!w) return;
    if (w === 'music') { LS.set('music', el.checked); if (el.checked) musicStart(); else musicStop(); }
    if (w === 'btdate' && S.btOpt) { if (!el.value) return; S.btOpt[el.dataset.k] = el.value; if (S.btOpt.to < S.btOpt.from) S.btOpt.to = S.btOpt.from; return render(); }
    if (w === 'fx') { LS.set('fx', el.checked); themeKey = ''; celebrate(); }
  });
  document.addEventListener('input', function (ev) {
    var el = ev.target; if (!el || !el.dataset || el.dataset.act !== 'musicvol') return;
    var v = +el.value; LS.set('musicVol', v); if (MUS.audio) MUS.audio.volume = v; if (MUS.master && MUS.ctx) MUS.master.gain.setTargetAtTime(v, MUS.ctx.currentTime, 0.2);
  });
  function askNewPin(force) {
    if (!force && !(S.data && S.data.me && S.data.me.mustChange)) return;
    if (S.pinAsked && !force) return; S.pinAsked = !force;
    modal('<h3>🔑 Choose your ' + (force ? 'new ' : 'own ') + 'PIN</h3>' + (force ? '' : '<p class="muted">You signed in with a temporary PIN. Pick your own now (4–6 digits).</p>') + '<label>New PIN<input id="np1" type="password" inputmode="numeric" maxlength="6"></label><label>Type it again<input id="np2" type="password" inputmode="numeric" maxlength="6"></label><div class="row end">' + (force ? '<button class="btn ghost" data-act="close-modal">Cancel</button>' : '') + '<button class="btn primary" id="npok">Save PIN</button></div>', function (sh) {
      sh.querySelector('#npok').onclick = function () {
        var p1 = sh.querySelector('#np1').value, p2 = sh.querySelector('#np2').value;
        if (!/^\d{4,6}$/.test(p1)) return toast('PIN must be 4–6 digits.', 'bad'); if (p1 !== p2) return toast('The two PINs are different.', 'bad');
        api('changepin', {pin: p1}).then(function () { closeModal(); if (S.data) S.data.me.mustChange = false; toast('PIN saved 🔑', 'good'); }, function (e) { toast(errText(e), 'bad'); });
      };
    });
  }
  /* Guided tour: highlights each part with a short note. Skip any time. */
  var TOUR = [
    ['#/', '.seg', '📅 Views', 'Month, Agenda (whole month as a list), Team day (who is free) and List. They stay at the top while you scroll.'],
    ['#/', '.chips', '👥 Whose calendar', 'Everyone, only Me, or Me + someone (e.g. your partner). 📌 keeps a Me + chip, × closes it.'],
    ['#/', '.grid, .ag', '👆 Days', 'Tap a day to choose it (scroll inside to see all). Tap it again to open that day. Swipe sideways to change month.'],
    ['#/', '.fab', '➕ Add', 'Add an appointment. Type the title: the app picks the type and colour. You can repeat it weekly / monthly / yearly. Or hold 🎤, speak, let go: it’s saved for you.'],
    ['#/', '.team-bar', '📣 Team events', 'Black with the REDEFINE logo. Answer Going / Can’t go here; everyone gets a reminder 1 hour before.'],
    ['#/', '.legend', '🎨 Colours', 'Green sales, yellow client & admin, orange recruit, blue meeting, red personal. Holidays and birthdays are marked too.'],
    ['#/', '.tabs a[href="#/todo"]', '✅ To-do', 'Your to-do list in 4 boxes: urgent & important first.'],
    ['#/', '.tabs a[href="#/stats"]', '📈 Activity', 'Your numbers, your goals (what you need each week), the monthly report and the team board.'],
    ['#/', '.tabs a[href="#/me"]', '👤 Me', 'Your photo, short name, birthday, important people, notifications, partner calendar and this tour.']
  ];
  function tour(i) {
    i = i || 0; var root = document.getElementById('tour');
    if (!root) { root = document.createElement('div'); root.id = 'tour'; document.body.appendChild(root); }
    if (i >= TOUR.length) { root.remove(); toast('That’s it! Tap 📖 in Me any time to see it again.', 'good'); return; }
    var st = TOUR[i];
    if (location.hash !== st[0] && !(st[0] === '#/' && (location.hash === '' || location.hash === '#/'))) location.hash = st[0];
    setTimeout(function () {
      var el = null; st[1].split(', ').some(function (sel) { el = document.querySelector(sel); return el; });
      if (!el) return tour(i + 1);
      el.scrollIntoView({block: 'center'});
      setTimeout(function () {
        var r = el.getBoundingClientRect(), below = r.top < window.innerHeight / 2;
        root.innerHTML = '<div class="tour-hole" style="left:' + (r.left - 6) + 'px;top:' + (r.top - 6) + 'px;width:' + (r.width + 12) + 'px;height:' + (r.height + 12) + 'px"></div>' +
          '<div class="tour-tip" style="' + (below ? 'top:' + Math.min(window.innerHeight - 220, r.bottom + 14) : 'bottom:' + Math.min(window.innerHeight - 220, window.innerHeight - r.top + 14)) + 'px"><small>' + (i + 1) + ' / ' + TOUR.length + '</small><b>' + st[2] + '</b><p>' + st[3] + '</p><div class="row between"><button class="link" data-tour="skip">Skip tour</button><div>' + (i ? '<button class="btn ghost tiny" data-tour="back">Back</button> ' : '') + '<button class="btn primary tiny" data-tour="next">' + (i === TOUR.length - 1 ? 'Finish' : 'Next') + '</button></div></div></div>';
        root.onclick = function (ev) { var b = ev.target.closest('[data-tour]'); if (!b) return; var w = b.dataset.tour; if (w === 'skip') return root.remove(); tour(w === 'back' ? i - 1 : i + 1); };
      }, 250);
    }, 250);
  }
  /* ================= Calendar subscription (Apple / Google Calendar widget) ================= */
  function feedUrl(tok) { return CFG.api + (CFG.api.indexOf('?') >= 0 ? '&' : '?') + 'feed=' + tok; }
  function subCard() {
    var tok = S.feedTok, h = '<div class="card sub"><h4>📅 Calendar subscription</h4><p class="tiny muted">See your appointments in Apple Calendar or Google Calendar (and their Home Screen widgets). Keep adding and changing them here; the other calendar copies them when it refreshes.</p>';
    if (!tok) return h + '<button class="btn primary" data-act="feedget">' + (tok === '' ? 'Turn on' : 'Show my calendar link') + '</button></div>';
    var url = feedUrl(tok), web = url.replace(/^https?:/, 'webcal:');
    return h + '<p class="warn-t tiny">🔒 This link shows ALL your appointments, private ones too. Don’t share it.</p>' +
      '<div class="row wrap"><a class="btn primary" href="' + esc(web) + '">🍎 Add to iPhone / iPad / Mac Calendar</a><button class="btn" data-act="feedcopy">📋 Copy link (Google Calendar)</button></div>' +
      '<input class="feed-in" readonly value="' + esc(url) + '" onclick="this.select()">' +
      '<details class="howto"><summary>How to set it up</summary>' +
      '<p><b>iPhone / iPad:</b> tap <b>🍎 Add to … Calendar</b> → <b>Subscribe</b> → Add. (Or Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar → paste the link.) To refresh more often: Settings → Calendar → Accounts → Fetch New Data.</p>' +
      '<p><b>Android / Google Calendar:</b> on a computer open calendar.google.com → <b>Other calendars +</b> → <b>From URL</b> → paste the link → Add calendar. Then in the Google Calendar app → Settings → tap the new calendar → turn on <b>Sync</b>. Google refreshes on its own schedule, usually every few hours, sometimes up to a day.</p>' +
      '<p><b>TimeTree:</b> as far as we know TimeTree can’t subscribe to a calendar link, so use Apple or Google Calendar for the widget.</p>' +
      '<p><b>Widget + app icon:</b> long-press your Home Screen → <b>+</b> (iPhone) or <b>Widgets</b> (Android) → choose the Calendar / Google Calendar widget. Then add this app to your Home Screen (Safari: Share → Add to Home Screen; Chrome: ⋮ → Add to Home screen) and drag its icon next to the widget. A website can’t place icons or widgets for you.</p>' +
      '<p><b>Changes:</b> make them here. Changing an appointment inside Apple / Google Calendar does not change this app. Each appointment’s notes has an <b>Open in our Calendar</b> link back to it (you may be asked to sign in; it may open in the browser instead of the app).</p></details>' +
      '<div class="row"><button class="link" data-act="feedreset">🔄 New link (old one stops working)</button><button class="link danger" data-act="feedoff">Turn off</button></div></div>';
  }

  /* ================= Music (off by default) and celebration animations — per device ================= */
  function soundCard() {
    var on = LS.get('music', false), vol = LS.get('musicVol', 0.4), fx = LS.get('fx', true), t = activeTheme();
    return '<div class="card"><h4>🎵 Music & animations <small class="muted">(this device)</small></h4>' +
      '<label class="switch"><input type="checkbox" data-act="music"' + (on ? ' checked' : '') + '> Background music (light & cheerful 轻快)' + (t && t.music ? ' (now: ' + esc(t.musicName || 'celebration song') + ')' : '') + '</label>' +
      '<label>Volume<input type="range" min="0" max="1" step="0.05" value="' + vol + '" data-act="musicvol"></label>' +
      '<label class="switch"><input type="checkbox" data-act="fx"' + (fx ? ' checked' : '') + '> Celebration animations</label></div>';
  }
  var MUS = {on: false, ctx: null, master: null, timers: [], audio: null, src: ''};
  function musicVol() { return Math.max(0, Math.min(1, +LS.get('musicVol', 0.4))); }
  function musicStart() {
    if (MUS.on || !LS.get('music', false) || document.hidden) return;
    MUS.on = true;
    var t = activeTheme();
    if (t && t.music) { MUS.src = t.music; mediaUrl(t.music).then(function (u) { if (!MUS.on || MUS.src !== t.music || !u) return u ? 0 : genStart(); MUS.audio = new Audio(u); MUS.audio.loop = true; MUS.audio.volume = musicVol(); MUS.audio.play().catch(function () { MUS.on = false; }); }); return; }
    MUS.src = 'gen'; genStart();
  }
  function musicStop() {
    MUS.on = false; MUS.src = '';
    MUS.timers.forEach(clearTimeout); MUS.timers = [];
    if (MUS.audio) { MUS.audio.pause(); MUS.audio = null; }
    if (MUS.ctx) { var c = MUS.ctx; try { MUS.master.gain.setTargetAtTime(0, c.currentTime, 0.3); } catch (e) {} setTimeout(function () { c.close().catch(function () {}); }, 1500); MUS.ctx = null; }
  }
  /* Generated light, cheerful music (轻快): 112 BPM, C – G – Am – F, bouncy bass, offbeat chord stabs, soft drums
     and a plucked melody that changes every 8 bars. Made on the device; nothing is downloaded. */
  function genStart() {
    var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    var c = new AC(), master = c.createGain(), comp = c.createDynamicsCompressor(), dl = c.createDelay(), fb = c.createGain(), wet = c.createGain(), mel = c.createGain();
    master.gain.value = 0; master.gain.setTargetAtTime(musicVol(), c.currentTime, 0.8);
    dl.delayTime.value = 60 / 112 * 0.75; fb.gain.value = 0.25; wet.gain.value = 0.22;
    mel.connect(master); mel.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(master);
    master.connect(comp); comp.connect(c.destination);
    MUS.ctx = c; MUS.master = master;
    var STEP = 60 / 112 / 4, CH = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]], SCALE = [0, 2, 4, 7, 9, 12, 14, 16];
    var hz = function (n) { return 440 * Math.pow(2, (n - 69) / 12); };
    var noise = c.createBuffer(1, c.sampleRate * 0.3, c.sampleRate), nd = noise.getChannelData(0); for (var i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    var osc = function (n, at, len, peak, type, dest, attack) {
      var o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = hz(n);
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(peak, at + (attack || 0.006)); g.gain.exponentialRampToValueAtTime(0.0001, at + len);
      o.connect(g); g.connect(dest || master); o.start(at); o.stop(at + len + 0.05);
    };
    var hit = function (at, len, peak, type, freq) {
      var s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s.buffer = noise; f.type = type; f.frequency.value = freq;
      g.gain.setValueAtTime(peak, at); g.gain.exponentialRampToValueAtTime(0.0001, at + len); s.connect(f); f.connect(g); g.connect(master); s.start(at); s.stop(at + len + 0.02);
    };
    var kick = function (at) { var o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(120, at); o.frequency.exponentialRampToValueAtTime(45, at + 0.15); g.gain.setValueAtTime(0.35, at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.22); o.connect(g); g.connect(master); o.start(at); o.stop(at + 0.25); };
    var RHY = [[1,0,1,0, 0,0,1,0, 1,0,0,1, 0,0,1,0], [1,0,0,1, 0,0,1,0, 0,0,1,0, 1,0,0,0], [1,0,1,1, 0,0,1,0, 1,0,1,0, 0,0,0,0], [0,0,1,0, 1,0,1,0, 0,1,0,1, 0,0,1,0]];
    var melody = [];
    var newMelody = function () {   // 8 bars: A A' B A'' built from two short rhythms and a stepwise walk on the pentatonic scale
      var ra = RHY[Math.floor(Math.random() * 4)], rb = RHY[Math.floor(Math.random() * 4)], pos = 2 + Math.floor(Math.random() * 3), bars = [];
      var bar = function (rh, ch) { return rh.map(function (on, s) { if (!on) return null; pos = Math.max(0, Math.min(SCALE.length - 1, pos + [-1, -1, 0, 1, 1, 2, -2][Math.floor(Math.random() * 7)])); var n = 72 + SCALE[pos]; if (s % 8 === 0) { var best = ch.map(function (x) { return x + 12; }).concat(ch.map(function (x) { return x + 24; })).sort(function (x, y) { return Math.abs(x - n) - Math.abs(y - n); })[0]; n = best; } return n; }); };
      for (var b = 0; b < 8; b++) bars.push(bar(b === 4 || b === 5 ? rb : ra, CH[b % 4]));
      melody = bars;
    };
    newMelody();
    var step = 0, next = c.currentTime + 0.1;
    var tick = function () {
      if (!MUS.on || MUS.ctx !== c) return;
      while (next < c.currentTime + 0.25) {
        var s = step % 16, barN = Math.floor(step / 16) % 8, ch = CH[barN % 4], at = next;
        if (step % 128 === 0 && step) newMelody();
        if (s === 0 || s === 8) kick(at);
        if (s === 4 || s === 12) hit(at, 0.12, 0.09, 'bandpass', 1800);
        if (s % 2 === 0) hit(at, 0.04, s % 4 === 2 ? 0.05 : 0.025, 'highpass', 8000);
        if (s === 0 || s === 6 || s === 8 || s === 14) osc((s === 6 || s === 14 ? ch[2] : ch[0]) - 24, at, 0.28, 0.22, 'triangle');
        if (s === 2 || s === 6 || s === 10 || s === 14) ch.forEach(function (n) { osc(n, at, 0.16, 0.035, 'triangle'); });
        var m = melody[barN][s]; if (m) { osc(m, at, 0.32, 0.09, 'triangle', mel); osc(m + 12, at, 0.18, 0.02, 'sine', mel); }
        step++; next += STEP;
      }
      MUS.timers[0] = setTimeout(tick, 60);
    };
    tick();
  }
  // browsers only allow sound after a tap: start on the first tap when music is switched on
  document.addEventListener('pointerdown', function (ev) { if (ev.target.closest && ev.target.closest('.fab.mic')) return; if (LS.get('music', false) && !MUS.on && !HOLD) musicStart(); }, {passive: true});
  document.addEventListener('visibilitychange', function () { if (document.hidden) musicStop(); });

  /* files (posters, music) are fetched once and kept on the device */
  var mediaMem = {};
  function mediaUrl(id) {
    if (!id) return Promise.resolve('');
    if (mediaMem[id]) return Promise.resolve(mediaMem[id]);
    var key = location.origin + '/__media/' + id, cacheP = window.caches ? caches.open('rcal-media').catch(function () { return null; }) : Promise.resolve(null);
    return cacheP.then(function (cache) {
      return (cache ? cache.match(key) : Promise.resolve(null)).then(function (hit) {
        if (hit) return hit.blob();
        return api('file', {id: id}).then(function (j) {
          var bin = atob(j.file.data), arr = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          var blob = new Blob([arr], {type: j.file.mime});
          if (cache) cache.put(key, new Response(blob)).catch(function () {});
          return blob;
        });
      });
    }).then(function (blob) { return (mediaMem[id] = URL.createObjectURL(blob)); }, function () { return ''; });
  }

  /* ================= Celebration themes ================= */
  var OCC = {cny: ['🧧', 'Chinese New Year'], raya: ['🌙', 'Hari Raya'], deepavali: ['🪔', 'Deepavali'], christmas: ['🎄', 'Christmas'], newyear: ['🎆', 'New Year'], thaipusam: ['🙏', 'Thaipusam'], wesak: ['🪷', 'Wesak Day'], qingming: ['🕯️', '清明节 Qingming'], valentine: ['💝', 'Valentine’s Day'], womens: ['🌷', '三八妇女节 Women’s Day'], mothers: ['💐', 'Mother’s Day'], fathers: ['👔', 'Father’s Day'], merdeka: ['🇲🇾', 'Merdeka'], malaysiaday: ['🇲🇾', 'Malaysia Day'], birthday: ['🎂', 'Team birthdays (every birthday)'], school: ['🏫', 'School holiday'], holiday: ['🎉', 'Public holiday'], other: ['🎉', 'Other celebration']};
  var ANIM = [['snow', '❄️ Snow'], ['balloons', '🎈 Balloons'], ['lion', '🦁 Lion dance + firecrackers'], ['fireworks', '🎆 Fireworks'], ['hearts', '💕 Hearts'], ['petals', '🌸 Flowers'], ['lanterns', '🏮 Lanterns / lamps'], ['confetti', '🎊 Confetti'], ['stars', '✨ Sparkles'], ['motifs', '🖼️ Poster pictures'], ['', 'No animation']];
  function activeTheme() {
    if (S.previewTheme) return S.previewTheme;
    var th = (S.data && S.data.themes) || []; if (!th.length) return null;
    var t = dayKey(Date.now()), md = t.slice(5), bd = members().filter(function (m) { return m.active !== false && m.bday === md; });
    var b = th.filter(function (x) { return x.occasion === 'birthday' && x.on; })[0];
    if (bd.length && b) return Object.assign({}, b, {who: bd});
    return th.filter(function (x) { return x.occasion !== 'birthday' && x.on && x.from <= t && t <= x.to; })[0] || null;
  }
  function rgb(h) { h = String(h || '#000000').replace('#', ''); return [0, 2, 4].map(function (i) { return parseInt(h.substr(i, 2), 16) || 0; }); }
  function hexOf(c) { return '#' + c.map(function (v) { return ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2); }).join(''); }
  function lum(h) { return rgb(h).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce(function (s, v, i) { return s + v * [0.2126, 0.7152, 0.0722][i]; }, 0); }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function mix(a, b, w) { var x = rgb(a), y = rgb(b); return hexOf(x.map(function (v, i) { return v * (1 - w) + y[i] * w; })); }
  function readable(text, bg) { if (contrast(text, bg) >= 4.5) return text; return contrast('#111827', bg) >= contrast('#FFFFFF', bg) ? '#111827' : '#FFFFFF'; }
  function darkEnough(c) { var n = 0; while (contrast('#FFFFFF', c) < 3.2 && n++ < 12) c = mix(c, '#000000', 0.12); return c; }
  var themeKey = '', THEME_VARS = ['--bg', '--card', '--text', '--muted', '--line', '--soft', '--coral', '--navy', '--poster'];
  function celebrate() {
    var t = activeTheme(), fxOn = LS.get('fx', true) && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    var key = t ? t.id + '|' + t.updated + '|' + (t.preview ? 'p' : '') + '|' + fxOn : 'none|' + fxOn;
    if (key === themeKey) return; var hadMusic = MUS.on, wasSrc = MUS.src; themeKey = key;
    var root = document.documentElement;
    THEME_VARS.forEach(function (v) { root.style.removeProperty(v); }); root.removeAttribute('data-celebrate'); fxStop();
    if (t) {
      var c = t.colors || {}, bg = c.bg || '#FFFFFF', card = c.surface || '#FFFFFF', text = readable(readable(c.text || '#111827', bg), card), prim = darkEnough(c.primary || '#E5484D');
      root.style.setProperty('--bg', bg); root.style.setProperty('--card', card); root.style.setProperty('--text', text);
      root.style.setProperty('--muted', readable(mix(text, card, 0.35), card)); root.style.setProperty('--line', mix(card, text, 0.14)); root.style.setProperty('--soft', mix(card, text, 0.07));
      root.style.setProperty('--coral', prim); root.style.setProperty('--navy', darkEnough(mix(prim, '#000000', 0.15)));
      root.setAttribute('data-celebrate', t.occasion || 'other');
      if (t.poster) mediaUrl(t.poster).then(function (u) { if (u && themeKey === key) root.style.setProperty('--poster', 'url("' + u + '")'); });
      if (fxOn && t.anim) fxStart(t.anim, t.motifs || [], c);
    }
    if (hadMusic && wasSrc !== ((t && t.music) || 'gen')) { musicStop(); musicStart(); }
  }
  function celebrateBar() {
    var t = activeTheme(); if (!t) return '';
    var o = OCC[t.occasion] || OCC.other, txt = t.who ? '🎂 Happy birthday, ' + t.who.map(shortName).join(' & ') + '!' : o[0] + ' ' + esc(t.title || o[1]);
    return '<button class="celebrate-bar" data-act="poster">' + txt + (t.preview ? ' <small>(preview)</small>' : '') + '</button>';
  }

  /* ---------- animations: a light layer on top, sparse, paused when the app is hidden ---------- */
  var FX = {cv: null, raf: 0, parts: [], kind: '', motifs: [], colors: {}, last: 0, t0: 0};
  var FX_SET = {snow: ['❄️'], balloons: ['🎈', '🎈', '🎉', '🎁'], hearts: ['💕', '💖', '❤️'], petals: ['🌸', '🌼', '🌺'], lanterns: ['🏮', '🪔', '✨'], stars: ['✨', '⭐'], lion: ['🧨', '🧧', '🏮']};
  function fxStart(kind, motifs, colors) {
    FX.kind = kind; FX.motifs = motifs || []; FX.colors = colors || {}; FX.parts = []; FX.t0 = Date.now();
    var cv = FX.cv || document.createElement('canvas'); cv.id = 'fx'; FX.cv = cv; if (!cv.parentNode) document.body.appendChild(cv);
    fxSize(); if (!FX.raf) FX.raf = requestAnimationFrame(fxLoop);
  }
  function fxStop() { if (FX.raf) cancelAnimationFrame(FX.raf); FX.raf = 0; FX.kind = ''; if (FX.cv && FX.cv.parentNode) FX.cv.parentNode.removeChild(FX.cv); }
  function fxSize() { if (!FX.cv) return; var r = Math.min(2, window.devicePixelRatio || 1); FX.cv.width = innerWidth * r; FX.cv.height = innerHeight * r; FX.cv.style.width = innerWidth + 'px'; FX.cv.style.height = innerHeight + 'px'; FX.r = r; }
  window.addEventListener('resize', fxSize);
  function fxEmoji() { var set = FX_SET[FX.kind] || []; if (FX.motifs.length && (FX.kind === 'motifs' || Math.random() < 0.3 || !set.length)) return FX.motifs[Math.floor(Math.random() * FX.motifs.length)]; return set[Math.floor(Math.random() * set.length)] || '✨'; }
  function fxSpawn(W, H) {
    var k = FX.kind, up = k === 'balloons' || k === 'hearts' || k === 'lanterns';
    if (k === 'fireworks') { var col = [FX.colors.primary, FX.colors.accent, '#FFD54A', '#FF5C8A', '#5CC8FF'].filter(Boolean), cx = W * (0.15 + Math.random() * 0.7), cy = H * (0.12 + Math.random() * 0.35), c0 = col[Math.floor(Math.random() * col.length)];
      for (var i = 0; i < 26; i++) { var an = i / 26 * Math.PI * 2, sp = 1.2 + Math.random() * 1.6; FX.parts.push({dot: 1, x: cx, y: cy, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, g: 0.025, life: 70 + Math.random() * 30, age: 0, c: c0, s: 2.4}); } return; }
    if (k === 'confetti') { var cc = [FX.colors.primary, FX.colors.accent, '#FFD54A', '#4ADE80', '#60A5FA'].filter(Boolean); FX.parts.push({rect: 1, x: Math.random() * W, y: -10, vx: (Math.random() - 0.5) * 0.6, vy: 0.8 + Math.random() * 0.9, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.15, c: cc[Math.floor(Math.random() * cc.length)], life: 1e9, age: 0}); return; }
    if (k === 'stars') { FX.parts.push({e: fxEmoji(), x: Math.random() * W, y: Math.random() * H * 0.85, vx: 0, vy: 0, life: 90, age: 0, s: 14 + Math.random() * 10, tw: 1}); return; }
    if (k === 'lion' && Math.random() < 0.5 && !FX.parts.some(function (p) { return p.lion; })) { FX.parts.push({e: '🦁', lion: 1, x: -60, y: H - 150, vx: 1.1, vy: 0, life: 1e9, age: 0, s: 46}); return; }
    if (k === 'lion' && Math.random() < 0.3) { var bx = W * Math.random(), by = H * (0.2 + Math.random() * 0.4); for (var j = 0; j < 14; j++) { var a2 = Math.random() * Math.PI * 2, s2 = 0.6 + Math.random() * 1.6; FX.parts.push({dot: 1, x: bx, y: by, vx: Math.cos(a2) * s2, vy: Math.sin(a2) * s2, g: 0.03, life: 45, age: 0, c: Math.random() < 0.5 ? '#E5484D' : '#F2C200', s: 2}); } return; }
    FX.parts.push({e: fxEmoji(), x: Math.random() * W, y: up ? H + 30 : -30, vx: 0, vy: up ? -(0.45 + Math.random() * 0.5) : 0.4 + Math.random() * 0.6, sway: Math.random() * 6, life: 1e9, age: 0, s: 16 + Math.random() * 12});
  }
  function fxLoop(ts) {
    FX.raf = requestAnimationFrame(fxLoop);
    if (document.hidden || !FX.cv || ts - FX.last < 33) return; FX.last = ts;
    var cx = FX.cv.getContext('2d'), r = FX.r || 1, W = innerWidth, H = innerHeight, max = W < 600 ? 12 : 22;
    var bursts = FX.kind === 'fireworks', live = FX.parts.filter(function (p) { return !p.dot; }).length;
    if (bursts ? Math.random() < 0.025 : (live < max && Math.random() < 0.08)) fxSpawn(W, H);
    if (FX.kind === 'lion' && Math.random() < 0.02) fxSpawn(W, H);
    cx.setTransform(r, 0, 0, r, 0, 0); cx.clearRect(0, 0, W, H); cx.textAlign = 'center'; cx.textBaseline = 'middle';
    FX.parts = FX.parts.filter(function (p) {
      p.age++; p.x += p.vx + (p.sway ? Math.sin((p.age + p.sway * 20) / 40) * 0.4 : 0); p.y += p.vy; if (p.g) p.vy += p.g;
      if (p.age > p.life || p.y > H + 40 || p.y < -60 || p.x > W + 80) return false;
      var fade = p.dot ? 1 - p.age / p.life : p.tw ? Math.sin(p.age / p.life * Math.PI) : 1;
      cx.globalAlpha = 0.85 * Math.max(0, fade);
      if (p.dot) { cx.fillStyle = p.c; cx.beginPath(); cx.arc(p.x, p.y, p.s, 0, 6.3); cx.fill(); }
      else if (p.rect) { p.rot += p.vr; cx.save(); cx.translate(p.x, p.y); cx.rotate(p.rot); cx.fillStyle = p.c; cx.fillRect(-4, -2.5, 8, 5); cx.restore(); }
      else { cx.font = p.s + 'px serif'; cx.fillText(p.e, p.x, p.lion ? p.y + Math.sin(p.age / 6) * 6 : p.y); }
      return true;
    });
    cx.globalAlpha = 1;
  }

  /* ---------- owner: manage themes ---------- */
  function loadThemes() { if (S.themeBusy) return; S.themeBusy = 1; api('themes').then(function (j) { S.themeBusy = 0; S.themeList = j; render(); }, function (e) { S.themeBusy = 0; S.themeList = {themes: [], themesOn: false, err: errText(e)}; render(); }); }
  function themesScreen() {
    var head = topbar('Celebration themes', {back: '#/me'}) + '<main>';
    if (!me().owner) return head + '<p class="empty">Only the owner can manage celebration themes.</p></main>' + tabs('me');
    var L = S.themeList; if (!L) { loadThemes(); return head + '<p class="empty">Loading…</p></main>' + tabs('me'); }
    var today = dayKey(Date.now());
    return head + '<div class="card"><div class="row between"><div><h4>' + (L.themesOn ? '🎉 Themes are ON' : '⏸️ Themes are OFF') + '</h4><p class="tiny muted">' + (L.themesOn ? 'Everyone’s app changes on the dates below.' : 'Everyone sees the normal look. Switch on to use the themes below.') + '</p></div><button class="btn ' + (L.themesOn ? '' : 'primary') + '" data-act="themes-on" data-v="' + (L.themesOn ? '0' : '1') + '">' + (L.themesOn ? 'Switch off' : 'Switch on') + '</button></div></div>' +
      '<button class="btn primary big" data-act="theme-new">＋ New theme from a poster</button>' +
      (L.themes.length ? L.themes.slice().sort(function (x, y) { return String(x.from).localeCompare(String(y.from)); }).map(function (t) {
        var o = OCC[t.occasion] || OCC.other, c = t.colors || {}, now = t.occasion !== 'birthday' && t.from <= today && today <= t.to;
        return '<div class="card theme-row"><div class="swatch">' + ['bg', 'surface', 'primary', 'accent', 'text'].map(function (k) { return '<i style="background:' + esc(c[k] || '#fff') + '"></i>'; }).join('') + '</div><div class="grow"><b>' + o[0] + ' ' + esc(t.title) + '</b>' + (now ? ' <span class="pill on">now</span>' : '') + (t.on ? '' : ' <span class="pill">off</span>') +
          '<p class="tiny muted">' + (t.occasion === 'birthday' ? 'On every team member’s birthday' : esc(dayLabel(t.from)) + ' – ' + esc(dayLabel(t.to))) + ' · ' + (t.anim ? (ANIM.filter(function (x) { return x[0] === t.anim; })[0] || ['', ''])[1] : 'no animation') + (t.poster ? ' · 🖼️ poster' : '') + (t.music ? ' · 🎵 ' + esc(t.musicName || 'music') : '') + '</p>' +
          '<div class="row"><button class="btn tiny" data-act="theme-edit" data-id="' + t.id + '">Edit</button><button class="btn tiny ghost" data-act="theme-preview" data-id="' + t.id + '">👀 Preview</button><button class="link danger" data-act="theme-del" data-id="' + t.id + '">Delete</button></div></div></div>';
      }).join('') : '<p class="empty">No themes yet. Start with a poster: the AI picks the colours, pictures and animation.</p>') +
      '<p class="tiny muted center">Posters are shown faintly behind the calendar; words stay on solid cards so they can be read. Music plays only on phones where the person switched music on (Me → Music).</p></main>' + tabs('me');
  }
  function suggestDates(occ) {
    var today = dayKey(Date.now()), y = +today.slice(0, 4);
    var fixed = {christmas: ['12-18', '12-26'], newyear: ['12-30', '01-01'], valentine: ['02-12', '02-14'], womens: ['03-07', '03-08'], merdeka: ['08-28', '08-31'], malaysiaday: ['09-14', '09-16']};
    if (fixed[occ]) { for (var yy = y; yy <= y + 1; yy++) { var f0 = yy + '-' + fixed[occ][0], t0 = (occ === 'newyear' ? yy + 1 : yy) + '-' + fixed[occ][1]; if (t0 >= today) return [f0, t0]; } }
    var RX = {cny: [/^Chinese New Year$/, -3, 14], raya: [/^Hari Raya Aidilfitri/, -2, 7], deepavali: [/^Deepavali/, -2, 1], thaipusam: [/^Thaipusam$/, -1, 0], wesak: [/^Wesak/, -1, 0], qingming: [/Qingming/, -2, 0], mothers: [/Mother/, -2, 0], fathers: [/Father/, -2, 0]}[occ];
    if (!RX) return ['', ''];
    var k = Object.keys(C.HOLIDAYS).sort().filter(function (d2) { return d2 >= addDays(today, -RX[2]) && C.HOLIDAYS[d2].some(function (h) { return RX[0].test(h[0]); }); })[0];
    return k ? [addDays(k, RX[1]), addDays(k, RX[2])] : ['', ''];
  }
  function imgToJpeg(file, max, q) {
    return new Promise(function (ok, bad) {
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () { var s = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * s); c.height = Math.round(im.height * s); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url); var qq = q, d2 = c.toDataURL('image/jpeg', qq).split(',')[1]; while (d2.length > 850000 && qq > 0.4) { qq -= 0.1; d2 = c.toDataURL('image/jpeg', qq).split(',')[1]; } ok(d2); };
      im.onerror = function () { URL.revokeObjectURL(url); bad(); }; im.src = url;
    });
  }
  function fileB64(file) { return new Promise(function (ok, bad) { var r = new FileReader(); r.onload = function () { ok(String(r.result).split(',')[1]); }; r.onerror = bad; r.readAsDataURL(file); }); }
  function themeEditor(t) {
    t = t || {occasion: 'christmas', title: '', colors: {bg: '#FFF7F5', surface: '#FFFFFF', primary: '#B91C1C', accent: '#15803D', text: '#1F2937'}, anim: 'snow', motifs: [], on: true};
    var sd = t.from ? [t.from, t.to] : suggestDates(t.occasion), TF = S.tf = {poster: '', music: '', musicMime: '', musicName: '', removeMusic: false};
    var c = t.colors || {}, colorIn = function (k, l) { return '<label class="ci">' + l + '<input type="color" name="c_' + k + '" value="' + esc(c[k] || '#ffffff') + '"></label>'; };
    modal('<form id="themeform"><div class="row between"><h3>' + (t.id ? 'Edit theme' : 'New theme') + '</h3><button type="button" class="icon-btn" data-act="close-modal" aria-label="Close">✕</button></div>' +
      '<label>1. Poster (from your designer / WhatsApp)<input type="file" name="poster" accept="image/*"></label><div class="poster-prev" id="pprev">' + (t.poster ? '<p class="tiny muted">Current poster kept unless you choose a new one.</p>' : '') + '</div>' +
      '<button type="button" class="btn" id="aibtn" disabled>✨ Read the poster with AI</button><p class="tiny muted" id="ainote"></p>' +
      '<div class="two"><label>Occasion<select name="occasion">' + Object.keys(OCC).map(function (k) { return '<option value="' + k + '"' + (t.occasion === k ? ' selected' : '') + '>' + OCC[k][0] + ' ' + OCC[k][1] + '</option>'; }).join('') + '</select></label><label>Name<input name="title" maxlength="60" value="' + esc(t.title || '') + '" placeholder="e.g. Christmas 2026"></label></div>' +
      '<div class="two dates"><label>From<input type="date" name="from" value="' + esc(sd[0] || '') + '"></label><label>To<input type="date" name="to" value="' + esc(sd[1] || '') + '"></label></div>' +
      '<p class="tiny muted">Colours (the app keeps words readable even if a colour is too light or dark)</p><div class="colors">' + colorIn('bg', 'Background') + colorIn('surface', 'Cards') + colorIn('primary', 'Header & buttons') + colorIn('accent', 'Highlights') + colorIn('text', 'Words') + '</div>' +
      '<div class="two"><label>Animation<select name="anim">' + ANIM.map(function (x) { return '<option value="' + x[0] + '"' + ((t.anim || '') === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></label><label>Poster pictures (emoji)<input name="motifs" maxlength="40" value="' + esc((t.motifs || []).join(' ')) + '" placeholder="🎅 🦌 ⛄"></label></div>' +
      '<label>Background music (optional, MP3 / M4A up to 5 MB)<input type="file" name="music" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,.mp3,.m4a"></label>' + (t.music ? '<label class="switch"><input type="checkbox" name="rmmusic"> Remove “' + esc(t.musicName || 'music') + '”</label>' : '') +
      '<label class="switch"><input type="checkbox" name="on"' + (t.on !== false ? ' checked' : '') + '> Use this theme</label>' +
      '<div class="row end"><button type="button" class="btn ghost" id="tprev">👀 Preview</button><button class="btn primary">Save</button></div></form>', function (sh) {
      var f = sh.querySelector('#themeform'), ai = sh.querySelector('#aibtn');
      var paintDates = function () { sh.querySelector('.dates').hidden = f.occasion.value === 'birthday'; };
      paintDates();
      f.occasion.onchange = function () { paintDates(); var s2 = suggestDates(f.occasion.value); if (s2[0]) { f.from.value = s2[0]; f.to.value = s2[1]; } };
      f.poster.onchange = function () {
        var file = f.poster.files[0]; if (!file) return;
        imgToJpeg(file, 1080, 0.78).then(function (b) { TF.poster = b; sh.querySelector('#pprev').innerHTML = '<img src="data:image/jpeg;base64,' + b + '" alt="Poster">'; ai.disabled = false; }, function () { toast('That picture could not be opened.', 'bad'); });
      };
      ai.onclick = function () {
        ai.disabled = true; ai.textContent = '✨ Reading the poster… (10–30 s)';
        api('themeai', {poster: TF.poster}).then(function (j) {
          var x = j.theme; f.occasion.value = x.occasion; paintDates(); var s3 = suggestDates(x.occasion); if (s3[0] && !f.from.value) { f.from.value = s3[0]; f.to.value = s3[1]; }
          if (x.title) f.title.value = x.title; ['bg', 'surface', 'primary', 'accent', 'text'].forEach(function (k) { if (x.colors[k]) f['c_' + k].value = x.colors[k].toLowerCase(); });
          f.anim.value = x.anim; f.motifs.value = (x.motifs || []).join(' '); sh.querySelector('#ainote').textContent = x.notes ? '🤖 ' + x.notes : 'Done. Check the colours, then Preview.';
          ai.textContent = '✨ Read again'; ai.disabled = false;
        }, function (e) { ai.textContent = '✨ Read the poster with AI'; ai.disabled = false; toast(errText(e), 'bad'); });
      };
      f.music.onchange = function () {
        var file = f.music.files[0]; if (!file) return;
        var mime = file.type || (/\.m4a$/i.test(file.name) ? 'audio/x-m4a' : /\.mp3$/i.test(file.name) ? 'audio/mpeg' : '');
        if (!/^audio\/(mpeg|mp4|x-m4a|aac)$/.test(mime)) { f.music.value = ''; return toast('Use an MP3 or M4A file.', 'bad'); }
        if (file.size > 5 * 1024 * 1024) { f.music.value = ''; return toast('Music must be 5 MB or smaller.', 'bad'); }
        fileB64(file).then(function (b) { TF.music = b; TF.musicMime = mime; TF.musicName = file.name.slice(0, 60); });
      };
      var collect = function () {
        return {id: t.id, occasion: f.occasion.value, title: f.title.value.trim() || OCC[f.occasion.value][1], from: f.from.value, to: f.to.value, anim: f.anim.value, motifs: f.motifs.value.trim().split(/\s+/).filter(Boolean),
          colors: {bg: f.c_bg.value, surface: f.c_surface.value, primary: f.c_primary.value, accent: f.c_accent.value, text: f.c_text.value}, on: f.on.checked};
      };
      sh.querySelector('#tprev').onclick = function () {
        var x = collect(); S.previewTheme = Object.assign({}, x, {id: 'preview', updated: String(Date.now()), preview: true, poster: '', music: ''});
        if (TF.poster) { mediaMem.preview = 'data:image/jpeg;base64,' + TF.poster; S.previewTheme.poster = 'preview'; } else if (t.poster) S.previewTheme.poster = t.poster;
        celebrate(); toast('Preview on this device only. Close the form to keep looking; Save to apply for everyone.', 'good');
      };
      f.onsubmit = function (ev) {
        ev.preventDefault(); var x = collect();
        if (x.occasion !== 'birthday' && !(x.from && x.to && x.from <= x.to)) return toast('Pick the From and To dates.', 'bad');
        var body = {theme: x}; if (TF.poster) body.poster = TF.poster; if (TF.music) { body.music = TF.music; body.musicMime = TF.musicMime; body.musicName = TF.musicName; } if (f.rmmusic && f.rmmusic.checked) body.removeMusic = true;
        var btn = f.querySelector('button.primary'); btn.disabled = true; btn.textContent = TF.music ? 'Saving… (music takes a while)' : 'Saving…';
        api('theme', body).then(function () { closeModal(); S.previewTheme = null; S.themeList = null; toast('🎉 Theme saved', 'good'); quietSync(true); render(); }, function (e) { btn.disabled = false; btn.textContent = 'Save'; toast(errText(e), 'bad'); });
      };
    });
  }

  /* ================= Voice booking: hold 🎤 and speak, let go to save (like a WhatsApp voice note) =================
     Nothing to wait for: the recording goes to a queue on the phone and is saved into the calendar in the background
     (kept and retried if the internet drops). The agent checks the entry later (🎤 to check). */
  var HOLD = null, VQ = LS.get('voiceQ', []), vqBusy = false;
  function holdUI(h) {
    var el = document.getElementById('recbar'); if (!el) { el = document.createElement('div'); el.id = 'recbar'; document.body.appendChild(el); }
    if (!h) { el.className = ''; document.querySelectorAll('.fab.mic').forEach(function (b) { b.classList.remove('rec'); }); return; }
    var sec = h.tStart ? Math.floor((Date.now() - h.tStart) / 1000) : 0;
    el.className = 'on' + (h.slide ? ' cancel' : '');
    el.innerHTML = h.slide ? '🗑️ Let go to cancel' : '<i class="recdot"></i><b>0:' + ('0' + Math.min(59, sec)).slice(-2) + '</b><span>' + (h.rec ? '‹ slide left to cancel' : 'Getting the microphone…') + '</span>';
    if (h.btn) h.btn.classList.add('rec');
  }
  function micDown(ev) {
    var btn = ev.target.closest && ev.target.closest('.fab.mic'); if (!btn || HOLD) return;
    ev.preventDefault();
    try { btn.setPointerCapture(ev.pointerId); } catch (x) {}
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) return toast('Voice recording isn’t supported here. Update your phone or use Chrome / Safari.', 'bad');
    var h = HOLD = {x0: ev.clientX, t0: Date.now(), btn: btn, up: false, cancel: false, slide: false, music: MUS.on};
    if (MUS.on) musicStop();   // background music off while recording, back on after
    holdUI(h);
    navigator.mediaDevices.getUserMedia({audio: true}).then(function (stream) {
      if (h.up) {   // let go before the microphone was ready (e.g. the first-time "allow microphone" question)
        stream.getTracks().forEach(function (t) { t.stop(); });
        if (Date.now() - h.t0 > 1500) toast('🎤 Microphone ready. Now hold 🎤, speak, then let go.', 'good');
        return;
      }
      var mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].filter(function (m) { return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m); })[0] || '';
      var rec = new MediaRecorder(stream, mime ? {mimeType: mime, audioBitsPerSecond: 32000} : undefined), chunks = [];
      h.rec = rec; h.tStart = Date.now();
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); }); clearInterval(h.tm);
        if (h.cancel) return toast('Cancelled', '');
        if (Date.now() - h.tStart < 900) return toast('Hold the 🎤 button while you speak, then let go.', 'bad');
        queueVoice(new Blob(chunks, {type: String(rec.mimeType || mime || 'audio/webm').split(';')[0]}));
      };
      rec.start(500);
      try { navigator.vibrate && navigator.vibrate(15); } catch (x) {}
      h.tm = setInterval(function () { if (HOLD !== h) return; holdUI(h); if (Date.now() - h.tStart >= 60e3) micUp(); }, 250);
      holdUI(h);
    }, function () { if (HOLD === h) HOLD = null; holdUI(null); toast('Microphone not allowed. Allow the microphone for this app in your phone settings to use voice.', 'bad'); });
  }
  function micMove(ev) { if (!HOLD) return; var s = ev.clientX - HOLD.x0 < -70; if (s !== HOLD.slide) { HOLD.slide = s; holdUI(HOLD); } }
  function micUp(ev, cancel) {
    var h = HOLD; if (!h) return; HOLD = null; h.up = true; h.cancel = !!cancel || h.slide; holdUI(null);
    if (h.music) setTimeout(function () { if (!HOLD) musicStart(); }, 800);
    if (S.renderLater) { S.renderLater = false; setTimeout(render, 0); }
    if (h.rec && h.rec.state !== 'inactive') h.rec.stop();
    else if (!h.rec && Date.now() - h.t0 < 600) toast('Hold the 🎤 button while you speak, then let go.', '');
  }
  document.addEventListener('pointerdown', micDown);
  document.addEventListener('pointermove', micMove);
  document.addEventListener('pointerup', function (ev) { micUp(ev); });
  document.addEventListener('pointercancel', function (ev) { micUp(ev, true); });
  document.addEventListener('contextmenu', function (ev) { if (ev.target.closest && ev.target.closest('.fab.mic')) ev.preventDefault(); });
  function saveVQ() { try { localStorage.setItem('rcal.voiceQ', JSON.stringify(VQ)); } catch (x) { /* too big for this phone's storage: it still goes out from memory */ } }
  function queueVoice(blob) {
    fileB64(blob).then(function (b64) {
      VQ.push({id: 'v' + Date.now(), audio: b64, mime: blob.type || 'audio/webm', tries: 0, next: 0}); VQ = VQ.slice(-5); saveVQ();
      toast('🎤 Got it! Adding to your calendar.', 'good');
      runVoiceQ();
    });
  }
  var VOICE_DROP = {bad_audio: 1, nothing_heard: 1, not_an_appointment: 1, ai_unreadable: 1, daily_limit: 1, no_api_key: 1, bad_api_key: 1, no_credit: 1, signed_out: 1, removed: 1};
  function runVoiceQ() {
    if (vqBusy || !VQ.length || !S.token || !navigator.onLine) return;
    var it = VQ[0]; if (it.next > Date.now()) return;
    vqBusy = true;
    api('voice', {audio: it.audio, mime: it.mime, save: true}).then(function (j) {
      vqBusy = false; VQ = VQ.filter(function (x) { return x.id !== it.id; }); saveVQ();
      var e = j.event || {}, v = j.voice || {}, when = e.allDay ? dayLabel(String(e.start).slice(0, 10)) + ' (all day)' : dayLabel(dayKey(Date.parse(e.start))) + ' ' + hm(Date.parse(e.start));
      toast('✅ Added: ' + (e.title || 'appointment') + ' · ' + when + (v.missing && v.missing.length ? ' · please check' : ''), 'good');
      quietSync(true); runVoiceQ();
    }, function (err) {
      vqBusy = false; var code = err && (err.code || err.message);
      if (VOICE_DROP[code] || ++it.tries >= 6) { VQ = VQ.filter(function (x) { return x.id !== it.id; }); saveVQ(); toast('🎤 Not added: ' + errText(err), 'bad'); return runVoiceQ(); }
      it.next = Date.now() + Math.min(300e3, 15e3 * Math.pow(2, it.tries - 1)); saveVQ();   // network or busy: try again shortly
    });
  }
  window.addEventListener('online', runVoiceQ);
  /* entries made by voice that the agent has not checked yet */
  function voiceToCheck() { var my = me().id; return rawEvents().filter(function (e) { return e.ownerId === my && e.source === 'voice'; }).sort(function (x, y) { return sMs(x) - sMs(y); }); }
  function voiceCheckScreen() {
    var list = voiceToCheck();
    return topbar('🎤 Voice entries to check', {back: '#/'}) + '<main><p class="tiny muted">Saved from your voice notes. Check each one when you have time: tap ✓ Correct, or ✏️ Edit to fix it.</p>' +
      (list.length ? list.map(function (e) {
        var said = (String(e.notes || '').match(/🎤 You said: “([^”]*)”/) || [])[1] || '', miss = /Not said: ([^.]*)/.exec(e.notes || '');
        return '<div class="card vchk"><a href="#/e/' + e.id + '"><b>' + esc(evTitle(e)) + '</b><br><span class="muted">' + esc(dayLabel(dayKey(sMs(e)), true)) + ' · ' + esc(evTime(e)) + (e.place ? ' · 📍 ' + esc(e.place) : '') + '</span></a>' +
          (said ? '<p class="tiny">🎤 “' + esc(said) + '”</p>' : '') + (miss ? '<p class="tiny warn-t">⚠️ Not said: ' + esc(miss[1]) + '</p>' : '') +
          '<div class="row"><button class="btn primary tiny" data-act="vcheck" data-id="' + e.id + '">✓ Correct</button><button class="btn tiny" data-act="edit" data-id="' + e.id + '">✏️ Edit</button><button class="link danger" data-act="vdel" data-id="' + e.id + '">Delete</button></div></div>';
      }).join('') : '<p class="empty">All checked 👍</p>') + '</main>' + tabs('cal');
  }

  function signOutLocal(reason) {
    S.token = ''; S.data = null; LS.del('token'); LS.del('cache'); LS.del('pushToken');
    if (reason) toast(errText({code: reason}), 'bad');
    render();
  }

  /* ---------- layout ---------- */
  function logoSvg(s) { return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#14213D"/><rect x="12" y="16" width="40" height="36" rx="6" fill="#fff"/><rect x="12" y="16" width="40" height="10" rx="5" fill="#E8505B"/><rect x="12" y="22" width="40" height="4" fill="#E8505B"/><circle cx="23" cy="36" r="4" fill="#2E86DE"/><circle cx="32" cy="36" r="4" fill="#10AC84"/><circle cx="41" cy="36" r="4" fill="#F39C12"/><circle cx="23" cy="45" r="4" fill="#8E44AD"/><circle cx="32" cy="45" r="4" fill="#E8505B"/></svg>'; }
  function tabs(active) {
    var u = unreadAll(), c = toConfirm().length + myInvites().length;
    var t = [['cal', '#/', '📅', 'Calendar', c], ['feed', '#/feed', '🔔', 'Comments', u], ['todo', '#/todo', '✅', 'To-do', todoDue()], ['stats', '#/stats', '📈', 'Activity', 0], ['me', '#/me', '👤', 'Me', 0]];
    return '<nav class="tabs">' + t.map(function (x) { return '<a href="' + x[1] + '" class="' + (active === x[0] ? 'on' : '') + '"><span class="ti">' + x[2] + (x[4] ? '<i class="badge">' + (x[4] > 99 ? '99+' : x[4]) + '</i>' : '') + '</span>' + x[3] + '</a>'; }).join('') + '</nav>';
  }
  function topbar(title, opts) {
    opts = opts || {};
    return '<header class="top">' + (opts.back ? '<a class="back" href="' + opts.back + '" aria-label="Back">‹</a>' : '<span class="brand"><img class="brand-logo" src="icons/team-mark.png" alt="REDEFINE"></span>') +
      '<h2>' + title + '</h2>' + (opts.right || '') + '</header>' +
      (CFG.sample ? '<div class="sample">' + esc(CFG.sample) + '</div>' : '') +
      (!S.online ? '<div class="offline">No signal. Showing the last saved copy.</div>' : '');
  }

  /* ---------- calendar ---------- */
  function filterChips() {
    var my = me().id, list = members().filter(function (m) { return m.active !== false; });
    var p = me().partner, merged = S.filter.indexOf('me+') === 0 ? S.filter.slice(3) : '';
    // merged chips: partner (always), kept ones (📌, remove with ×), and the one just picked (📌 keep or × close)
    var kept = keptMerges().filter(function (id) { return id !== p && members().some(function (m) { return m.id === id && m.active !== false; }); });
    // chip icons are faces (photo, or initials in the person's colour until they upload one)
    var face = function (m) { return avatar(m, 'chip'); }, pair = function (m) { return '<span class="cpair">' + face(me()) + face(m) + '</span>'; };
    var extra = []; if (p && mem(p).active !== false) extra.push(['me+' + p, '💑 Me + ' + shortName(mem(p)), pair(mem(p))]);
    kept.forEach(function (id) { extra.push(['me+' + id, 'Me + ' + shortName(mem(id)), pair(mem(id)), 'kept', id]); });
    if (merged && merged !== p && kept.indexOf(merged) < 0) extra.push([S.filter, 'Me + ' + shortName(mem(merged)), pair(mem(merged)), 'temp', merged]);
    extra.push(['pick', 'Me + …', '<span class="cpair">' + face(me()) + '<span class="av av-chip cplus">+</span></span>']);
    var chips = [['all', 'Everyone', '<span class="av av-chip cteam"><img src="icons/team-mark.png" alt=""></span>'], ['me', 'Me', face(me())]].concat(extra, list.filter(function (m) { return m.id !== my; }).map(function (m) { return [m.id, shortName(m), face(m)]; }));
    return '<div class="chips">' + chips.map(function (c) {
      var tools = c[3] === 'temp' ? '<span class="ctool" data-act="merge-keep" data-id="' + c[4] + '" title="Keep this chip">📌</span><span class="ctool" data-act="merge-x" data-id="' + c[4] + '" title="Close">×</span>'
        : c[3] === 'kept' ? '<span class="ctool" data-act="merge-x" data-id="' + c[4] + '" title="Remove">×</span>' : '';
      return '<button class="chip' + (S.filter === c[0] ? ' on' : '') + (tools ? ' has-tools' : '') + '" data-act="filter" data-id="' + c[0] + '">' + c[2] + esc(c[1]) + tools + '</button>';
    }).join('') + '</div>';
  }
  function pickMerge() {
    var list = members().filter(function (m) { return m.id !== me().id && m.active !== false; });
    modal('<h3>Merge my calendar with…</h3><p class="tiny muted">Shows your events and theirs together. Their private events still show as Busy unless you are linked partners (Me → Partner calendar).</p><div class="withpick">' +
      list.map(function (m) { return '<button class="wp" data-act="merge" data-id="' + m.id + '">' + avatar(m, 'xs') + esc(m.name) + '</button>'; }).join('') + '</div><div class="row end"><button class="btn ghost" data-act="close-modal">Cancel</button></div>');
  }
  /* important people: yearly all-day birthdays / anniversaries in my own calendar */
  function peopleCard() {
    var mine = rawEvents().filter(function (e) { return e.ownerId === me().id && e.rep === 'y' && /^(🎂|💍)/.test(e.title || ''); }).sort(function (x, y) { return String(x.start).slice(5).localeCompare(String(y.start).slice(5)); });
    return '<div class="card"><h4>🎂 Important people</h4><p class="tiny muted">Birthdays and anniversaries of family or clients. They repeat every year and remind you that morning.</p>' +
      (mine.length ? mine.map(function (e) { return '<div class="td"><span class="tt">' + esc(e.title) + '<small>' + esc(dayLabel(String(e.start).slice(0, 10)).replace(/^.*?, /, '')) + (e.vis === 'private' ? ' · 🔒' : '') + '</small></span><button class="link danger" data-act="person-del" data-id="' + e.id + '">✕</button></div>'; }).join('') : '') +
      '<form id="personadd" class="person-add"><input name="n" maxlength="60" placeholder="Name, e.g. Mum / Mr Lim" required><div class="two"><label>What<select name="k"><option value="b">🎂 Birthday</option><option value="a">💍 Anniversary</option></select></label><label>Date<input name="d" type="date" required></label></div><div class="two"><label>Who<select name="w"><option value="personal">Family / friend</option><option value="crm">Client</option></select></label><label>Who can see<select name="v"><option value="private">🔒 Only me</option><option value="team">👥 Team</option></select></label></div><button class="btn primary">+ Add</button></form></div>';
  }
  function partnerCard() {
    var m = me(), asks = (m.partnerAsks || []).filter(function (id) { return mem(id).active !== false; }), body;
    if (m.partner) body = '<p>💑 Linked with ' + avatar(mem(m.partner), 'sm') + ' <b>' + esc(mem(m.partner).name) + '</b>. You see each other\'s private events; the team still sees Busy.</p><div class="row"><button class="btn ghost" data-act="filter" data-id="me+' + m.partner + '" onclick="location.hash=\'#/\'">View Me + ' + esc(shortName(mem(m.partner))) + '</button><button class="btn danger ghost" data-act="partner" data-do="unlink">Unlink</button></div>';
    else {
      body = asks.map(function (id) { return '<div class="ask">' + avatar(mem(id), 'sm') + ' <b>' + esc(mem(id).name) + '</b> wants to link calendars with you.<div class="row"><button class="btn primary" data-act="partner" data-do="accept" data-id="' + id + '">Accept</button><button class="btn ghost" data-act="partner" data-do="decline" data-id="' + id + '">Decline</button></div></div>'; }).join('');
      if (m.partnerReq) body += '<p class="muted">Waiting for <b>' + esc(mem(m.partnerReq).name) + '</b> to accept.</p><button class="btn ghost" data-act="partner" data-do="cancel">Cancel request</button>';
      else body += '<p class="tiny muted">For husband & wife (or partners) who keep one calendar: once both agree, you see each other\'s private events and get a "Me + partner" view.</p><div class="row"><select id="ptn"><option value="">Choose your partner…</option>' + members().filter(function (x) { return x.id !== m.id && x.active !== false && !x.partner; }).map(function (x) { return '<option value="' + x.id + '">' + esc(x.name) + '</option>'; }).join('') + '</select><button class="btn primary" data-act="partner" data-do="request">Send request</button></div>';
    }
    return '<div class="card"><h4>Partner calendar</h4>' + body + '</div>';
  }
  /* Agenda: the whole month as a compact list, one row per day (big date + weekday, then coloured time + title) */
  var WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function hmLong(ms) { var p = P(ms); return ((p.h % 12) || 12) + ':' + pad(p.mi) + (p.h < 12 ? ' AM' : ' PM'); }
  function agendaView() {
    var c = S.cursor, days = new Date(Date.UTC(c.y, c.m + 1, 0)).getUTCDate(), today = dayKey(Date.now()), list = filtered(), my = me().id, html = '<div class="ag">';
    for (var n = 1; n <= days; n++) {
      var k = c.y + '-' + pad(c.m + 1) + '-' + pad(n), p = P(keyMs(k)), evs = onDay(list, k).sort(function (x, y) { return (y.allDay ? 1 : 0) - (x.allDay ? 1 : 0) || sMs(x) - sMs(y); });
      html += '<div class="ag-day' + (k === today ? ' today' : '') + (p.w === 0 ? ' sun' : '') + '" id="ag-' + k + '"><button class="ag-date" data-act="ag-new" data-k="' + k + '" aria-label="Add on ' + k + '"><b>' + n + '</b><small>' + WEEKDAY[p.w] + '</small>' + (lunarLabel(k) ? '<em class="lun">' + lunarLabel(k) + '</em>' : '') + '</button><div class="ag-evs">' + holHtml(k, 'ag-hol') +
        evs.map(function (e) {
          var o = mem(e.ownerId), startsToday = dayKey(sMs(e)) === k;
          var t = e.allDay || !startsToday ? 'All-day' : hmLong(sMs(e));
          return '<a class="ag-ev' + (faded(e, my) ? ' pend' : '') + (e.out === 'cancel' ? ' x' : '') + (e.all ? ' team' : '') + (e.busy ? ' busy' : '') + '" href="#/e/' + e.id + '"><span class="ag-t" style="color:' + (evColor(e) === '#F2C200' ? '#A87D00' : evColor(e)) + '">' + t + '</span><span class="ag-ti">' + (S.filter === 'all' || S.filter.indexOf('me+') === 0 ? avatar(o, 'xxs') : '') + (e.all ? '<img class="tlogo" src="icons/team-mark.png" alt="">' : '') + esc(e.busy ? 'Busy · ' + shortName(o) : e.title) + '</span></a>';
        }).join('') + '</div></div>';
    }
    return html + '</div>';
  }
  function scrollToToday() {
    var r = document.getElementById('ag-' + dayKey(Date.now())), h = document.querySelector('.calhead');
    if (r) document.body.scrollTop = r.getBoundingClientRect().top + document.body.scrollTop - (h ? h.offsetHeight : 0) - 4;
  }
  function viewSwitch() {
    return '<div class="seg">' + [['month', 'Month'], ['agenda', 'Agenda'], ['day', 'Team day'], ['list', 'List']].map(function (v) { return '<button class="' + (S.view === v[0] ? 'on' : '') + '" data-act="view" data-v="' + v[0] + '">' + v[1] + '</button>'; }).join('') + '</div>';
  }
  function keptMerges() { var m = S.data && S.data.me && S.data.me.merges; if (typeof m === 'string' && (m || LS.get('mergesSynced', false))) return m ? m.split(',') : []; return LS.get('merges', []); }
  function setKept(list) { list = list.slice(-6); LS.set('merges', list); LS.set('mergesSynced', true); if (S.data && S.data.me) S.data.me.merges = list.join(','); api('profile', {merges: list.join(',')}).catch(function () {}); }
  /* whose calendar is showing (beside the month title): team logo, my face, both faces, or that person's face */
  function whoseFaces() {
    var f = S.filter || 'all', face = function (m) { return avatar(m, 'nav'); }, who, html;
    if (f === 'all') { who = 'Everyone'; html = '<span class="av av-nav cteam"><img src="icons/team-mark.png" alt=""></span>'; }
    else if (f === 'me') { who = 'Me'; html = face(me()); }
    else if (f.indexOf('me+') === 0) { who = 'Me + ' + shortName(mem(f.slice(3))); html = '<span class="cpair">' + face(me()) + face(mem(f.slice(3))) + '</span>'; }
    else { who = shortName(mem(f)); html = face(mem(f)); }
    return '<span class="whose" title="Showing: ' + esc(who) + '" aria-label="Showing ' + esc(who) + '’s calendar">' + html + '</span>';
  }
  function calendarScreen() {
    var c = S.cursor, today = dayKey(Date.now()), confirm = toConfirm();
    var head = S.view === 'day'
      ? '<div class="monthnav"><button class="nav" data-act="day" data-d="-1" aria-label="Previous day">‹</button><b>' + esc(dayLabel(S.dayView)) + '</b><button class="nav" data-act="day" data-d="1" aria-label="Next day">›</button><button class="btn tiny ghost" data-act="today">Today</button></div>'
      : '<div class="monthnav"><button class="nav" data-act="month" data-d="-1" aria-label="Previous month">‹</button><b class="mtitle">' + whoseFaces() + '<span>' + MONTH[c.m] + ' ' + c.y + '</span></b><button class="nav" data-act="month" data-d="1" aria-label="Next month">›</button><button class="btn tiny ghost" data-act="today">Today</button></div>';
    var body = S.view === 'day' ? (isLeader() ? '<a class="btn primary big bt-link" href="#/besttime">🔎 Best date for a team activity</a>' : '') + teamDay() : S.view === 'list' ? listView() : S.view === 'agenda' ? agendaView() : monthGrid() + '<p class="tiny muted hint">Tap a day to choose it (scroll inside to see all). Tap it again to open that day’s events.</p>';
    var nowP = P(Date.now()), yLeft = Math.round((Date.UTC(nowP.y, 11, 31) - Date.UTC(nowP.y, nowP.m, nowP.d)) / DAY), mLeft = new Date(Date.UTC(nowP.y, nowP.m + 1, 0)).getUTCDate() - nowP.d;
    var countdown = '<div class="countdown">⏳ <b>' + yLeft + '</b> days left in ' + nowP.y + ' · <b>' + mLeft + '</b> days left in ' + MONTH[nowP.m] + '</div>';
    return '<div class="calhead">' + topbar('REDEFINE Calendar', {right: '<a class="icon-btn" href="#/import" aria-label="Import calendar">⤓</a>'}) +
      '<div class="calhead-in">' + viewSwitch() + (S.view === 'day' ? '' : filterChips()) + head + countdown + '</div></div>' +
      '<main class="cal" id="calmain">' + celebrateBar() + (!me().photoV ? '<a class="confirm-bar photo-bar" href="#/me">📷 Add your photo so the team knows it’s you <span>›</span></a>' : '') +
      (upcomingTeam().length ? '<a class="confirm-bar team-bar" href="#/teamevents"><img class="tlogo" src="icons/team-mark.png" alt=""> Upcoming team events <b>(' + upcomingTeam().length + ')</b>' + (teamToAnswer() ? ' · <b class="ans">' + teamToAnswer() + ' to answer</b>' : '') + ' <span>›</span></a>' : '') +
      (myInvites().length ? '<a class="confirm-bar invite" href="#/invites">📩 <b>' + myInvites().length + '</b> invitation' + (myInvites().length > 1 ? 's' : '') + ' waiting for your answer <span>›</span></a>' : '') +
      (voiceToCheck().length ? '<a class="confirm-bar voicebar" href="#/voicecheck">🎤 <b>' + voiceToCheck().length + '</b> voice entr' + (voiceToCheck().length > 1 ? 'ies' : 'y') + ' to check <span>›</span></a>' : '') +
      (confirm.length ? '<a class="confirm-bar" href="#/confirm">✅ <b>' + confirm.length + '</b> activit' + (confirm.length > 1 ? 'ies' : 'y') + ' to confirm so your numbers count <span>›</span></a>' : '') +
      body + (S.view !== 'day' ? legend() : '') + '</main><button class="fab mic" aria-label="Hold to record an appointment">🎤</button><button class="fab" data-act="new" aria-label="Add event">+</button>' + tabs('cal');
  }
  /* CNY day (first day of the lunar year) and the length of the 12th lunar month before it (2025-2029 have no 年三十) */
  var CNY = {2026: ['2026-02-17', 29], 2027: ['2027-02-06', 29], 2028: ['2028-01-26', 29], 2029: ['2029-02-13', 29], 2030: ['2030-02-03', 30]};
  var LUNAR1 = ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十', '十一', '十二', '十三', '十四', '十五 元宵'];
  function lunarLabel(k) {
    var c = CNY[+k.slice(0, 4)]; if (!c) return '';
    var diff = Math.round((keyMs(k) - keyMs(c[0])) / DAY);
    if (diff >= 0 && diff < 15) return LUNAR1[diff];
    if (diff === -1) return '除夕';
    if (diff === -2) return c[1] === 30 ? '年廿九' : '年廿八';
    if (diff === -3 && c[1] === 30) return '年廿八';
    return '';
  }
  function holHtml(k, cls) {
    var hs = C.holidaysOn(k), sc = C.schoolHoliday(k);
    return hs.map(function (h) { return '<span class="' + cls + (h.kind === 'ph' ? ' ph' : '') + '">' + h.icon + ' ' + esc(h.name) + '</span>'; }).join('') + (sc && cls !== 'hol' ? '<span class="' + cls + ' sch">🏫 School holiday</span>' : '');
  }
  function monthGrid() {
    var c = S.cursor, first = Date.UTC(c.y, c.m, 1), dow = (new Date(first).getUTCDay() + 6) % 7, start = dayKey(first - H8 - dow * DAY + 3600e3), today = dayKey(Date.now());
    var list = filtered(), html = '<div class="grid"><div class="gh">' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(function (d) { return '<span>' + d + '</span>'; }).join('') + '</div>';
    for (var w = 0; w < 6; w++) {
      var rowStart = addDays(start, w * 7); if (w >= 4 && P(keyMs(rowStart)).m !== c.m) break;
      html += '<div class="gw">';
      for (var d = 0; d < 7; d++) {
        var k = addDays(start, w * 7 + d), p = P(keyMs(k)), evs = onDay(list, k).sort(function (x, y) { return (y.all ? 1 : 0) - (x.all ? 1 : 0); });   // team events always visible first
        var lun = lunarLabel(k), showOwner = S.filter === 'all' || S.filter.indexOf('me+') === 0, hs = C.holidaysOn(k), isPh = hs.some(function (h) { return h.kind === 'ph'; });
        html += '<div role="button" tabindex="0" class="gd' + (C.schoolHoliday(k) ? ' school' : '') + (p.m !== c.m ? ' dim' : '') + (k === today ? ' today' : '') + (k === S.sel ? ' sel' : '') + (evs.length > 3 ? ' many' : '') + '" data-act="sel" data-k="' + k + '"><span class="dn' + (isPh ? ' ph' : '') + '">' + p.d + (lun ? '<em class="lun">' + lun + '</em>' : '') + '</span>' + (hs.length ? '<span class="hol' + (isPh ? ' ph' : '') + '">' + hs[0].icon + ' ' + esc(hs[0].name) + '</span>' : '') + '<div class="gd-evs">' +
          evs.map(function (e) { var o = mem(e.ownerId); return '<span class="bar' + (e.busy ? ' busy' : '') + (faded(e, me().id) ? ' pend' : '') + (e.out === 'cancel' ? ' x' : '') + (e.all ? ' team' : '') + '" style="' + evStyle(e) + '">' + (showOwner ? avatar(o, 'xxs') : '') + (e.all ? '<img class="tlogo" src="icons/team-mark.png" alt="">' : '') + esc(e.busy ? 'Busy' : e.title) + '</span>'; }).join('') +
          '</div>' + (evs.length > 3 ? '<span class="more">+' + (evs.length - 3) + '</span>' : '') + '</div>';
      }
      html += '</div>';
    }
    return html + '</div>';
  }
  function evRow(e, showDay) {
    var o = mem(e.ownerId), cls = 'ev' + (e.busy ? ' busy' : '') + (e.out === 'cancel' ? ' x' : '') + (faded(e, me().id) ? ' pend' : '');
    var tag = e.busy ? '<span class="pill grey">🔒 Private</span>' : (pendingFor(e, me().id) ? '<span class="pill warn">📩 Invited: tap to answer</span>' : '') + (e.vis === 'private' ? '<span class="pill grey">🔒 Only me</span>' : '') + (e.all ? '<span class="pill navy">👥 ✅' + attendOf(e).yes.length + ' ❌' + attendOf(e).no.length + ' ⏳' + attendOf(e).none.length + '</span>' + (!myAnswer(e) && eMs(e) > Date.now() ? '<span class="pill warn">Going?</span>' : '') : '') + (e.out === 'closed' ? '<span class="pill gold">💰 Closed' + (e.noc > 1 ? ' ×' + e.noc : '') + '</span>' : e.out === 'done' ? '<span class="pill green">✓ Done</span>' : e.out === 'cancel' ? '<span class="pill grey">Didn\'t happen</span>' : needsConfirm(e) ? '<span class="pill warn">Confirm?</span>' : '');
    var w = (e.with || []).length ? '<span class="with">' + (e.with || []).slice(0, 4).map(function (id) { return avatar(mem(id), 'xs'); }).join('') + ((e.with || []).length > 4 ? '<small>+' + ((e.with || []).length - 4) + '</small>' : '') + '</span>' : '';
    if (e.all) cls += ' team';
    return '<a class="' + cls + '" href="#/e/' + e.id + '" style="' + evStyle(e) + '"><span class="et">' + (showDay ? esc(dayLabel(dayKey(sMs(e)))) + '<br>' : '') + esc(evTime(e)) + '</span>' +
      '<span class="eb"><b>' + (e.all ? '<img class="tlogo" src="icons/team-mark.png" alt="">' + esc(e.title) : esc(evTitle(e))) + '</b><small>' + avatar(o, 'xs') + ' ' + esc(o.name) + (e.place && !e.busy ? ' · ' + esc(e.place) : '') + '</small>' + tag + '</span>' + w + '</a>';
  }
  function openDay(k) {
    var evs = onDay(filtered(), k), lun = lunarLabel(k);
    modal('<div class="row between"><h3>' + esc(dayLabel(k, true)) + (lun ? ' · <span class="lun-t">' + lun + '</span>' : '') + '</h3><button type="button" class="icon-btn" data-act="close-modal" aria-label="Close">✕</button></div>' +
      '<div class="day-hols">' + holHtml(k, 'ag-hol') + '</div>' + (evs.length ? evs.map(function (e) { return evRow(e); }).join('') : '<p class="empty">Nothing yet.</p>') +
      '<button class="btn primary big" data-act="ag-new" data-k="' + k + '">+ Add event on this day</button>');
  }
  function dayAgenda(k) {
    var evs = onDay(filtered(), k);
    return '<section class="agenda"><h3>' + esc(dayLabel(k, true)) + '</h3>' + (evs.length ? evs.map(function (e) { return evRow(e); }).join('') : '<p class="empty">Nothing yet. Tap + to add.</p>') + '</section>';
  }
  function listView() {
    var t = dayKey(Date.now()), list = filtered(), html = '';
    for (var i = 0; i < 21; i++) {
      var k = addDays(t, i), evs = onDay(list, k); if (!evs.length) continue;
      html += '<section class="agenda"><h3>' + esc(dayLabel(k, true)) + '</h3>' + evs.map(function (e) { return evRow(e); }).join('') + '</section>';
    }
    return html || '<p class="empty">Nothing in the next 3 weeks.</p>';
  }
  function rsvpMark(e, id) { var at = attendOf(e); return at.yes.indexOf(id) >= 0 ? '✅' : at.no.indexOf(id) >= 0 ? '❌' : '⏳'; }
  /* Team day: one row per person, 7am–11pm. This is the "when is he free?" answer. */
  function teamDay() {
    var k = S.dayView, a = keyMs(k), H0 = 7, H1 = 23, span = (H1 - H0) * 3600e3, now = Date.now(), my = me().id;
    var list = onDay(events(), k), ms = members().filter(function (m) { return m.active !== false; });
    ms.sort(function (x, y) { return (x.id === my ? -1 : y.id === my ? 1 : 0) || x.name.localeCompare(y.name); });
    var isToday = k === dayKey(now), freeNow = [], busyNow = [];
    var rows = ms.map(function (m) {
      var mine = list.filter(function (e) { return involves(e, m.id) && e.out !== 'cancel'; });
      if (isToday) (mine.some(function (e) { return !e.allDay && sMs(e) <= now && eMs(e) > now; }) ? busyNow : freeNow).push(m);
      var allDay = mine.filter(function (e) { return e.allDay; });
      var blocks = mine.filter(function (e) { return !e.allDay; }).map(function (e) {
        var s = Math.max(sMs(e), a + H0 * 3600e3), en = Math.min(eMs(e), a + H1 * 3600e3); if (en <= s) return '';
        var l = (s - a - H0 * 3600e3) / span * 100, w = Math.max(1.6, (en - s) / span * 100), o = mem(e.ownerId);
        return '<a class="blk' + (e.busy ? ' busy' : '') + (faded(e, m.id) ? ' pend' : '') + (e.all ? ' team' : '') + '" href="#/e/' + e.id + '" style="left:' + l + '%;width:' + w + '%;' + evStyle(e) + '" title="' + esc(evTime(e) + ' ' + evTitle(e)) + '">' + (invited(e, m.id) ? (ansOf(e)[m.id] === 'yes' ? '✅' : '⏳') : '') + (e.all ? rsvpMark(e, m.id) + '<img class="tlogo" src="icons/team-mark.png" alt="">' : '') + esc(e.busy ? 'Busy' : (e.all ? '' : T(e.type).emoji + ' ') + e.title) + '</a>';
      }).join('');
      var strips = allDay.slice(0, 2).map(function (e, i) {
        var o = mem(e.ownerId);
        return '<a class="adstrip' + (e.busy ? ' busy' : '') + (e.all ? ' team' : '') + (faded(e, m.id) ? ' pend' : '') + '" href="#/e/' + e.id + '" style="top:' + (2 + i * 15) + 'px;' + evStyle(e) + '">' + (invited(e, m.id) ? (ansOf(e)[m.id] === 'yes' ? '✅' : '⏳') : '') + (e.all ? rsvpMark(e, m.id) + '<img class="tlogo" src="icons/team-mark.png" alt="">' : '') + esc(e.busy ? 'Busy (all day)' : 'All day · ' + e.title) + '</a>';
      }).join('') + (allDay.length > 2 ? '<span class="admore">+' + (allDay.length - 2) + '</span>' : '');
      var ad = Math.min(2, allDay.length);
      return '<div class="tr' + (ad ? ' ad' + ad : '') + '"><div class="tn">' + avatar(m, 'xs') + '<span>' + esc(m.id === my ? 'Me' : shortName(m)) + '</span></div><div class="tl">' + strips + blocks + '</div></div>';
    }).join('');
    var hours = ''; for (var h = H0; h < H1; h += 2) hours += '<span style="left:' + ((h - H0) / (H1 - H0) * 100) + '%">' + ((h % 12) || 12) + (h < 12 ? 'a' : 'p') + '</span>';
    var nowLine = isToday && now > a + H0 * 3600e3 && now < a + H1 * 3600e3 ? '<i class="now" style="left:calc(var(--nw) + (100% - var(--nw)) * ' + ((now - a - H0 * 3600e3) / span).toFixed(4) + ')"></i>' : '';
    return '<div class="day-hols">' + holHtml(k, 'ag-hol') + '</div>' + (isToday ? '<p class="freenow"><b>Free now:</b> ' + (freeNow.length ? freeNow.map(function (m) { return esc(m.id === my ? 'Me' : shortName(m)); }).join(', ') : 'nobody') + ' <span class="muted">· busy: ' + busyNow.length + '</span></p>' : '') +
      '<div class="team"><div class="tr th"><div class="tn"></div><div class="tl hours">' + hours + '</div></div><div class="rows">' + rows + nowLine + '</div></div>' +
      '<p class="tiny muted">Grey = private (busy, no details). Tap a block to see it. Blank = free.</p>';
  }

  /* ---------- event detail ---------- */
  function birthdayScreen(id) {
    var mid = id.split('-')[1], m = mem(mid), parts = id.split('-'), when = parts[2] + '-' + m.bday;
    return topbar('Birthday', {back: '#/'}) + '<main><div class="card bday-card">' + avatar(m, 'xl') + '<h2>🎂 ' + esc(shortName(m)) + '’s birthday</h2><p>' + esc(dayLabel(when, true)) + '</p><p class="muted">Send your wishes! 🎉</p></div></main>' + tabs('cal');
  }
  function eventScreen(id) {
    if (/^bd-/.test(id)) return birthdayScreen(id);
    var e = events().filter(function (x) { return x.id === id; })[0];
    if (e && e.base) e = Object.assign({}, e, {id: e.base});   // a repeat: everything below acts on the real event
    if (!e) return topbar('Event', {back: '#/'}) + '<main><p class="empty">This event is not in the dates loaded, or it was deleted.</p></main>' + tabs('cal');
    var o = mem(e.ownerId), mine = e.ownerId === me().id, repNote = e.rep ? '<p class="tiny muted">🔁 Repeats ' + ({w: 'every week', m: 'every month', y: 'every year'})[e.rep] + (e.repEnd ? ' until ' + esc(dayLabel(e.repEnd)) : '') + '. Editing changes every repeat.' + (e.occ ? ' Done / Closed can only be marked on the first one.' : '') + '</p>' : '';
    if (e.busy) return topbar('Busy', {back: '#/'}) + '<main><div class="card evhead" style="' + evStyle(e) + '"><h2>🔒 Busy</h2><p>' + esc(dayLabel(dayKey(sMs(e)), true)) + '<br>' + esc(evTime(e)) + '</p><p>' + avatar(o, 'sm') + ' ' + esc(o.name) + '</p><p class="muted">This is private. Only ' + esc(shortName(o)) + ' can see the details.</p></div></main>' + tabs('cal');
    var thread = (S.data.msgs || []).filter(function (m) { return m.to === 'ev:' + e.id; });
    var cheers = thread.filter(function (m) { return m.kind === 'cheer'; }), comments = thread.filter(function (m) { return m.kind !== 'cheer' && m.kind !== 'rsvp'; });
    var iCheered = cheers.some(function (m) { return m.from === me().id; });
    var out = '';
    if (mine && !e.occ && isWork(e) && sMs(e) <= Date.now()) {
      out = '<div class="card"><h4>What happened?</h4><div class="outs">' +
        '<button class="out' + (e.out === 'done' ? ' on' : '') + '" data-act="out" data-id="' + e.id + '" data-v="done">✓ Done</button>' +
        (C.PROSPECT[e.type] ? '<button class="out gold' + (e.out === 'closed' ? ' on' : '') + '" data-act="out" data-id="' + e.id + '" data-v="closed">💰 Closed</button>' : '') +
        '<button class="out grey' + (e.out === 'cancel' ? ' on' : '') + '" data-act="out" data-id="' + e.id + '" data-v="cancel">✕ Didn\'t happen</button></div>' +
        (e.out === 'closed' ? caseList(e) + '<p class="muted">NOC: <b>' + (e.noc || 1) + ' case' + ((e.noc || 1) > 1 ? 's' : '') + '</b> · Total ANP: <b>' + (e.anp ? rm(e.anp) : 'not entered') + '</b> <button class="link" data-act="out" data-id="' + e.id + '" data-v="closed">edit</button></p>' : (C.PROSPECT[e.type] ? '<p class="tiny muted">Not sure yet? Tap ✓ Done now. If the client signs later, come back and tap 💰 Closed.</p>' : '')) +
        (e.type === 'approach' && (e.out === 'done') ? '<p class="muted">New friends approached: <b>' + (e.count || 1) + '</b> <button class="link" data-act="out" data-id="' + e.id + '" data-v="done">edit</button></p>' : '') +
        (e.out ? '<button class="link" data-act="out" data-id="' + e.id + '" data-v="">Undo</button>' : '') + '</div>';
    } else if (!mine && e.out) {
      out = (e.out === 'closed' ? caseList(e) : '') + '<p class="result">' + (e.out === 'closed' ? '💰 Closed ' + (e.noc || 1) + ' case' + ((e.noc || 1) > 1 ? 's' : '') + (e.anp ? ' · ANP ' + rm(e.anp) : '') : e.out === 'done' ? '✓ Done' : 'Didn\'t happen') + '</p>';
    }
    return topbar(esc(T(e.type).label), {back: '#/', right: mine ? '<button class="edit-top" data-act="edit" data-id="' + e.id + '">✏️ Edit</button>' : ''}) +
      '<main><div class="card evhead' + (e.all ? ' team' : '') + '" style="' + evStyle(e) + '"><h2>' + (e.all ? '<img class="tlogo" src="icons/team-mark.png" alt="">' + esc(e.title) : esc(T(e.type).emoji + ' ' + e.title)) + '</h2>' +
      '<p>' + esc(dayLabel(dayKey(sMs(e)), true)) + (e.allDay && e.end !== e.start ? ' → ' + esc(dayLabel(String(e.end).slice(0, 10), true)) : '') + '<br>' + esc(evTime(e)) + '</p>' +
      (e.place ? '<p>📍 ' + esc(e.place) + '</p>' : '') +
      '<p>' + avatar(o, 'sm') + ' ' + esc(o.name) + ((e.with || []).length ? ' <span class="muted">with</span> ' + e.with.map(function (id) { return avatar(mem(id), 'sm') + ' ' + esc(shortName(mem(id))); }).join(' ') : '') + '</p>' +
      (e.notes ? '<p class="notes">' + esc(e.notes) + '</p>' : '') +
      (mine && e.source === 'voice' ? '<div class="card vnote">🎤 Added from your voice note. Is it right?<div class="row"><button class="btn primary tiny" data-act="vcheck" data-id="' + e.id + '">✓ Correct</button><button class="btn tiny" data-act="edit" data-id="' + e.id + '">✏️ Edit</button></div></div>' : '') + repNote + '<p class="muted tiny">' + (e.all ? '👥 Whole-team event: on everyone\'s calendar.' : e.vis === 'private' ? '🔒 Only ' + (mine ? 'you' : shortName(o)) + (e.with.length ? ' and the people tagged' : '') + ' can see this. Others see "Busy".' + (isWork(e) ? ' It still counts in the activity numbers.' : '') : '👥 The whole team can see this.') + (e.type === 'approach' ? ' · ' + (e.count || 1) + ' new friend(s)' : '') + '</p></div>' +
      out + (e.all ? attendCard(e) : (e.with || []).length ? inviteCard(e) : '') +
      '<div class="cheers"><button class="cheer' + (iCheered ? ' on' : '') + '" data-act="cheer" data-id="' + e.id + '">👏 ' + (cheers.length || 'Cheer') + '</button><span class="muted tiny">' + esc(cheers.map(function (m) { return shortName(mem(m.from)); }).join(', ')) + '</span>' +
      '</div>' +
      '<section class="comments"><h4>Comments</h4><div data-live="comments">' + commentList(comments) + '</div>' +
      '<form class="composer" data-act="comment" data-id="' + e.id + '"><input name="t" maxlength="1000" placeholder="Write a comment…" autocomplete="off"><button class="btn primary">Send</button></form>' +
      '<p class="tiny muted">🔔 ' + esc(whoHears(e, comments)) + '</p></section></main>' + tabs('cal');
  }
  /* invitation: the invited person accepts / rejects; everyone on the event sees who answered */
  function inviteCard(e) {
    var a = ansOf(e), my = me().id, mineInv = invited(e, my), open = eMs(e) > Date.now() && e.out !== 'cancel';
    var who = function (id) { var s = a[id] === 'yes' ? '✅' : a[id] === 'no' ? '❌' : '⏳'; return '<span class="who">' + s + ' ' + avatar(mem(id), 'xs') + esc(id === my ? 'Me' : shortName(mem(id))) + '</span>'; };
    var head = '';
    if (mineInv && open) head = a[my] === 'yes' ? '<p class="ok-t">✅ You accepted.</p><button class="link" data-act="invite" data-id="' + e.id + '" data-v="no">Can\'t make it after all? Reject</button>'
      : a[my] === 'no' ? '<p class="muted">❌ You rejected this. It is hidden from your calendar.</p><button class="link" data-act="invite" data-id="' + e.id + '" data-v="yes">Accept after all</button>'
      : '<p><b>' + esc(shortName(mem(e.ownerId))) + '</b> invited you.</p><div class="outs"><button class="out" data-act="invite" data-id="' + e.id + '" data-v="yes">✅ Accept</button><button class="out grey" data-act="invite" data-id="' + e.id + '" data-v="no">❌ Reject</button></div>';
    return '<div class="card attend"><h4>Invited</h4>' + head + '<div class="alist">' + (e.with || []).map(who).join('') + '</div><p class="tiny muted">✅ accepted · ⏳ not answered yet · ❌ rejected. Everyone still on the event can comment and gets comment pop-ups.</p></div>';
  }
  function upcomingTeam() { var now = Date.now(); return events().filter(function (e) { return e.all && eMs(e) > now && e.out !== 'cancel'; }).sort(function (x, y) { return sMs(x) - sMs(y); }); }
  function teamToAnswer() { var my = me().id; return upcomingTeam().filter(function (e) { return e.ownerId !== my && !ansOf(e)[my]; }).length; }
  /* ---------- Best time for a team activity (leaders): who is free, from everyone's calendars + their usual weekly pattern ---------- */
  var BT_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function bestTimeScreen() {
    var head = topbar('Best time for the team', {back: '#/teamevents'}) + '<main class="besttime">';
    if (!isLeader()) return head + '<p class="empty">For leaders.</p></main>' + tabs('cal');
    var t0 = dayKey(Date.now()), o = S.btOpt || (S.btOpt = {dur: 120, when: 'evening', from: t0, to: addDays(t0, 27)}), key = o.dur + '|' + o.when + '|' + o.from + '|' + o.to;
    var seg = function (name, list) { return '<div class="seg small">' + list.map(function (x) { return '<button class="' + (String(o[name]) === String(x[0]) ? 'on' : '') + '" data-act="btopt" data-k="' + name + '" data-v="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>'; };
    var html = head + '<div class="card"><p class="tiny muted">How long</p>' + seg('dur', [[60, '1 h'], [90, '1.5 h'], [120, '2 h'], [180, '3 h']]) +
      '<p class="tiny muted">When</p>' + seg('when', [['evening', 'Weekday nights'], ['weekend', 'Weekends'], ['day', 'Daytime'], ['any', 'Any time']]) +
      '<p class="tiny muted">Dates</p><div class="two"><label>From<input type="date" data-act="btdate" data-k="from" min="' + t0 + '" value="' + o.from + '"></label><label>To<input type="date" data-act="btdate" data-k="to" min="' + o.from + '" value="' + o.to + '"></label></div>' +
      '<div class="row wrap quick">' + [[13, '2 weeks'], [27, '4 weeks'], [55, '8 weeks']].map(function (q) { return '<button class="btn tiny ghost" data-act="btquick" data-n="' + q[0] + '">Next ' + q[1] + '</button>'; }).join('') + '</div></div>';
    var r = S.bt && S.bt.key === key && Date.now() - S.bt.at < 120e3 ? S.bt.v : null;
    if (!r) {
      if (!S.btBusy) { S.btBusy = 1; api('besttime', {dur: o.dur, when: o.when, from: o.from, to: o.to}).then(function (j) { S.btBusy = 0; S.bt = {key: key, at: Date.now(), v: j}; render(); }, function (e) { S.btBusy = 0; toast(errText(e), 'bad'); }); }
      return html + '<p class="empty">Checking everyone’s calendar…</p></main>' + tabs('cal');
    }
    if (!r.of) return html + '<p class="empty">Not enough calendar data yet: people need at least 5 appointments in the last 8 weeks to be counted.</p></main>' + tabs('cal');
    var ranks = r.byDay.slice().sort(function (x, y) { return y.expected - x.expected || y.free - x.free; }).slice(0, 3).map(function (x) { return x.day; });
    html += '<h4 class="sub">Every day: ' + esc(dayLabel(r.from)) + ' – ' + esc(dayLabel(r.to)) + '</h4><div class="card days">' + (r.byDay.length ? r.byDay.map(function (x) {
      var pc = Math.round(x.free / r.of * 100), top = ranks.indexOf(x.day) >= 0, st = Date.parse(x.start);
      return '<button class="bday-row' + (top ? ' top3' : '') + '" data-act="btset" data-s="' + x.start + '" data-e="' + x.end + '"><span class="d">' + (top ? '⭐ ' : '') + esc(dayLabel(x.day)) + (x.hol.length ? '<small class="hol-t">' + esc(x.hol[0]) + '</small>' : '') + '</span><span class="t">' + hm(st) + '</span>' +
        '<span class="bar"><i style="width:' + pc + '%;background:' + (pc >= 80 ? '#22A049' : pc >= 60 ? '#F2C200' : '#E5484D') + '"></i></span><b>' + x.free + '/' + r.of + '</b></button>';
    }).join('') : '<p class="empty small">No time fits on these dates. Try another time of day.</p>') + '<p class="tiny muted">Best time of each day and how many are free. ⭐ = top 3 dates. Tap a day to set the team activity.</p></div>';
    html += '<h4 class="sub">Best times in detail</h4>' + (r.slots.length ? r.slots.map(function (x, i) {
      var st = Date.parse(x.start), pc = Math.round(x.free / r.of * 100);
      return '<div class="card bt' + (i === 0 ? ' best' : '') + '"><div class="row between"><div><b>' + (i === 0 ? '⭐ ' : '') + esc(dayLabel(x.day, true)) + '</b><br><span class="bt-time">' + hm(st) + ' – ' + hm(Date.parse(x.end)) + '</span>' + (x.hol.length ? '<br><small class="hol-t">' + esc(x.hol.join(' · ')) + '</small>' : '') + '</div>' +
        '<div class="bt-count"><b>' + x.free + '</b>/' + r.of + '<small>free</small></div></div>' +
        '<div class="gbar"><i style="width:' + pc + '%"></i></div>' +
        '<p class="tiny">' + (x.busy.length ? '📅 Booked: ' + esc(x.busy.join(', ')) : '✅ Nobody has anything booked') + (x.usual.length ? '<br>🕑 Usually busy then: ' + esc(x.usual.join(', ')) : '') + '</p>' +
        '<button class="btn primary" data-act="btset" data-s="' + x.start + '" data-e="' + x.end + '">📣 Set team activity here</button></div>';
    }).join('') : '<p class="empty">No free slot found. Try another time of day or a longer look-ahead.</p>');
    html += '<h4 class="sub">Usual free time (last 8 weeks)</h4><div class="card"><table class="heat"><thead><tr><th></th>' + r.blocks.map(function (b) { return '<th>' + esc(b.replace(' ', '<br>')).replace('&lt;br&gt;', '<br>') + '</th>'; }).join('') + '</tr></thead><tbody>' +
      r.heat.map(function (row) { return '<tr><th>' + BT_DAY[row.wd] + '</th>' + row.cells.map(function (v) { return '<td style="background:rgba(34,160,73,' + (v == null ? 0 : (v / 100 * 0.85).toFixed(2)) + ');color:' + (v >= 60 ? '#fff' : 'inherit') + '">' + (v == null ? '' : v + '%') + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table><p class="tiny muted">Greener = more people are usually free then.</p></div>' +
      '<p class="tiny muted">Counts ' + r.of + ' people, using their appointments in the coming weeks (private ones count as busy, details stay hidden) and their usual weekly pattern. ' + (r.notCounted.length ? 'Not counted because they hardly use the calendar yet: ' + esc(r.notCounted.join(', ')) + '.' : '') + '</p></main>';
    return html + tabs('cal');
  }
  function teamEventsScreen() {
    var list = upcomingTeam(), my = me().id;
    return topbar('Team events', {back: '#/'}) + '<main>' + (isLeader() ? '<a class="btn primary big" href="#/besttime">🔎 Find the time most people are free</a>' : '') + '<p class="tiny muted">Every upcoming whole-team event, next 3 months. Tap Going or Can\'t go any time; tap your answer again to clear it.</p>' + (list.length ? list.map(function (e) {
      var at = attendOf(e), mine = myAnswer(e), own = e.ownerId === my;
      return '<div class="card tev"><a class="tev-head" href="#/e/' + e.id + '"><img class="tlogo" src="icons/team-mark.png" alt=""><b>' + esc(e.title) + '</b><small>' + esc(dayLabel(dayKey(sMs(e)), true)) + ' · ' + esc(evTime(e)) + (e.place ? ' · 📍 ' + esc(e.place) : '') + '</small><small>by ' + esc(shortName(mem(e.ownerId))) + ' · ✅ ' + at.yes.length + ' going · ❌ ' + at.no.length + ' can\'t · ⏳ ' + at.none.length + ' no reply</small></a>' +
        '<div class="outs"><button class="out' + (mine === 'yes' ? ' on' : '') + '" data-act="rsvp" data-id="' + e.id + '" data-v="' + (mine === 'yes' ? '' : 'yes') + '">✅ Going</button><button class="out grey' + (mine === 'no' ? ' on' : '') + '" data-act="rsvp" data-id="' + e.id + '" data-v="' + (mine === 'no' ? '' : 'no') + '">❌ Can\'t go</button></div>' +
        (!mine && !own ? '<p class="tiny warn-t">You haven\'t answered yet.</p>' : own && !mine ? '<p class="tiny muted">You created this one.</p>' : '') + '<p>' + '<div class="row wrap wa-row"><button class="btn wa primary" data-act="wa-send" data-id="' + e.id + '">🟢 Send to WhatsApp</button><button class="btn wa" data-act="wa-team" data-id="' + e.id + '">📋 Copy</button></div>' + '</p></div>';
    }).join('') : '<p class="empty">No upcoming team events.</p>') + '</main>' + tabs('cal');
  }
  /* ---------- To-do: Urgent & important / Urgent, not important / Important, not urgent / Not urgent, not important ---------- */
  var QUAD = [['1', '🔴', 'Urgent & important', 'Do it now'], ['2', '🟠', 'Urgent, not important', 'Quick / delegate'], ['3', '🔵', 'Important, not urgent', 'Plan a time'], ['4', '⚪', 'Not urgent, not important', 'Later or drop']];
  function todos() { return (S.data && S.data.todos) || []; }
  function todoDue() { var t = dayKey(Date.now()); return todos().filter(function (x) { return !x.done && x.due && x.due <= t; }).length; }
  function todoScreen() {
    var tab = S.todoTab || 'today', t = dayKey(Date.now()), list = todos().filter(function (x) {
      if (tab === 'all') return S.showDone || !x.done;
      return x.done ? x.done.slice(0, 10) === new Date(Date.now()).toISOString().slice(0, 10) || dayKey(Date.parse(x.done)) === t : (!x.due || x.due <= t);
    });
    var addQ = S.todoQ || '1';
    var html = topbar('To-do') + '<main class="todo"><div class="seg"><button class="' + (tab === 'today' ? 'on' : '') + '" data-act="todotab" data-v="today">Today</button><button class="' + (tab === 'all' ? 'on' : '') + '" data-act="todotab" data-v="all">All time</button></div>' +
      '<form class="todo-add" id="todoadd"><input name="t" maxlength="300" placeholder="Add a to-do…" autocomplete="off"><div class="qpick">' + QUAD.map(function (q) { return '<button type="button" class="qb' + (addQ === q[0] ? ' on' : '') + '" data-act="todoq" data-q="' + q[0] + '">' + q[1] + ' ' + q[2] + '</button>'; }).join('') + '</div>' +
      '<div class="row"><label class="switch"><input type="checkbox" name="today"' + (tab === 'today' ? ' checked' : '') + '> For today</label><input type="date" name="due" class="due-in"><button class="btn primary">Add</button></div></form>' +
      '<div class="quads">' + QUAD.map(function (q) {
        var items = list.filter(function (x) { return x.q === q[0]; }).sort(function (x, y) { return (x.done ? 1 : 0) - (y.done ? 1 : 0) || String(x.due || '9').localeCompare(String(y.due || '9')); });
        return '<section class="quad q' + q[0] + '"><h4>' + q[1] + ' ' + q[2] + '<small>' + q[3] + '</small></h4>' + (items.length ? items.map(function (x) {
          var late = !x.done && x.due && x.due < t;
          return '<div class="td' + (x.done ? ' done' : '') + '"><button class="tick-btn" data-act="todotick" data-id="' + x.id + '" aria-label="Done">' + (x.done ? '✅' : '⬜') + '</button><span class="tt">' + esc(x.text) + (x.due ? '<small class="' + (late ? 'late' : '') + '">' + (x.due === t ? 'Today' : esc(dayLabel(x.due))) + '</small>' : '') + '</span><button class="link danger" data-act="tododel" data-id="' + x.id + '" aria-label="Delete">✕</button></div>';
        }).join('') : '<p class="empty small">Nothing here.</p>') + '</section>';
      }).join('') + '</div>' + (tab === 'all' ? '<p class="center"><button class="link" data-act="todoshowdone">' + (S.showDone ? 'Hide' : 'Show') + ' finished ones</button></p>' : '') + '</main>';
    return html + tabs('todo');
  }
  function invitesScreen() {
    var list = myInvites();
    return topbar('Invitations', {back: '#/'}) + '<main>' + (list.length ? list.map(function (e) {
      var o = mem(e.ownerId);
      return '<div class="card cf" style="' + evStyle(e) + '"><a href="#/e/' + e.id + '"><b>' + esc(T(e.type).emoji + ' ' + e.title) + '</b><small class="muted">' + esc(dayLabel(dayKey(sMs(e)))) + ' · ' + esc(evTime(e)) + (e.place ? ' · ' + esc(e.place) : '') + '<br>from ' + esc(o.name) + '</small></a><div class="outs"><button class="out" data-act="invite" data-id="' + e.id + '" data-v="yes">✅ Accept</button><button class="out grey" data-act="invite" data-id="' + e.id + '" data-v="no">❌ Reject</button></div></div>';
    }).join('') : '<p class="empty">No invitations waiting. 👍</p>') + '</main>' + tabs('cal');
  }
  /* whole-team event: Going / Can't go / No reply, with names */
  function attendOf(e) { var a = ansOf(e), o = {yes: [], no: [], none: []}; members().forEach(function (m) { if (m.active === false) return; o[a[m.id] === 'yes' ? 'yes' : a[m.id] === 'no' ? 'no' : 'none'].push(m.id); }); return o; }
  function myAnswer(e) { var at = attendOf(e), my = me().id; return at.yes.indexOf(my) >= 0 ? 'yes' : at.no.indexOf(my) >= 0 ? 'no' : ''; }
  /* WhatsApp message with the event details and who is going (short names, no client details) */
  function teamShareText(e) {
    var at = attendOf(e), nm = function (ids) { return ids.map(function (id) { return shortName(mem(id)); }).join(', ') || '-'; };
    var link = (CFG.appUrl || (location.origin + location.pathname)) + '#/e/' + e.id;
    return ['📣 *REDEFINE team event*', '*' + e.title + '*', '📅 ' + dayLabel(dayKey(sMs(e)), true) + ' · ' + evTime(e)]
      .concat(e.place ? ['📍 ' + e.place] : []).concat(e.notes ? ['', e.notes] : [])
      .concat(['', '✅ Going (' + at.yes.length + '): ' + nm(at.yes), '❌ Can\'t go (' + at.no.length + '): ' + nm(at.no), '⏳ No reply (' + at.none.length + '): ' + nm(at.none), '', 'Answer in REDEFINE Calendar 👉 ' + link]).join('\n');
  }
  /* Open WhatsApp with the message typed in; the person picks the group and taps send (WhatsApp does not let apps post by themselves). */
  function waSend(text) { var u = 'https://wa.me/?text=' + encodeURIComponent(text); var w = window.open(u, '_blank'); if (!w) location.href = u; }
  function askWhatsApp(e) {
    modal('<h3>📣 Tell the team on WhatsApp?</h3><p class="muted">Send the event to your team group so everyone sees it and answers Going / Can’t go.</p><pre class="closelist">' + esc(teamShareText(e)) + '</pre>' +
      '<div class="row end wrap"><button class="btn ghost" data-act="close-modal">Not now</button><button class="btn" data-act="wa-team" data-id="' + e.id + '">📋 Copy</button><button class="btn wa primary" data-act="wa-send" data-id="' + e.id + '">🟢 Send to WhatsApp</button></div>');
  }
  /* Copy the message so it can be pasted straight into the WhatsApp group (works on iPhone, Android and PC). */
  function copyText(text) {
    var done = function () { toast('📋 Copied! Open your WhatsApp group and paste.', 'good'); };
    var fallback = function () {
      var t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t);
      t.select(); t.setSelectionRange(0, text.length); var ok = false; try { ok = document.execCommand('copy'); } catch (x) {} t.remove();
      if (ok) return done();
      modal('<h3>Copy this message</h3><p class="tiny muted">Press and hold → Select all → Copy, then paste in WhatsApp.</p><textarea rows="12" style="width:100%">' + esc(text) + '</textarea><div class="row end"><button class="btn" data-act="close-modal">Done</button></div>');
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  }
  function attendCard(e) {
    var at = attendOf(e), mine = myAnswer(e), open = eMs(e) > Date.now() && e.out !== 'cancel';
    var names = function (ids) { return ids.length ? ids.map(function (id) { return '<span class="who">' + avatar(mem(id), 'xs') + esc(id === me().id ? 'Me' : shortName(mem(id))) + '</span>'; }).join('') : '<span class="muted tiny">nobody</span>'; };
    return '<div class="card attend"><h4>Attendance</h4>' +
      (open ? '<div class="outs"><button class="out' + (mine === 'yes' ? ' on' : '') + '" data-act="rsvp" data-id="' + e.id + '" data-v="' + (mine === 'yes' ? '' : 'yes') + '">✅ Going</button><button class="out grey' + (mine === 'no' ? ' on' : '') + '" data-act="rsvp" data-id="' + e.id + '" data-v="' + (mine === 'no' ? '' : 'no') + '">❌ Can\'t go</button></div>' + (!mine ? '<p class="tiny warn-t">You haven\'t answered yet.</p>' : '') : '') +
      '<div class="alist"><b>✅ Going (' + at.yes.length + ')</b>' + names(at.yes) + '</div>' +
      '<div class="alist"><b>❌ Can\'t go (' + at.no.length + ')</b>' + names(at.no) + '</div>' +
      '<div class="alist"><b>⏳ No reply (' + at.none.length + ')</b>' + names(at.none) + '</div>' +
      '<p class="tiny muted">🔔 Everyone gets a pop-up 1 hour before.</p>' + '<div class="row wrap wa-row"><button class="btn wa primary" data-act="wa-send" data-id="' + e.id + '">🟢 Send to WhatsApp</button><button class="btn wa" data-act="wa-team" data-id="' + e.id + '">📋 Copy</button></div>' + '</div>';
  }
  /* tells the writer exactly who will get the pop-up */
  function whoHears(e, comments) {
    var ids = C.commentTargets(e, comments, me().id, members());
    if (e.all) return 'Everyone in REDEFINE gets a pop-up for comments here.';
    if (!ids.length) return 'Nobody else gets a pop-up yet (no one has commented).';
    return 'Only ' + ids.map(function (id) { return shortName(mem(id)); }).join(', ') + ' will get a pop-up.';
  }
  function caseList(e) {
    if (!e.cases || !e.cases.length) return '';
    return '<table class="cases"><thead><tr><th class="l">Plan</th><th>Mode</th><th>ANP</th></tr></thead><tbody>' + e.cases.map(function (c) { return '<tr><td class="l">' + esc(c.plan) + '</td><td>' + esc(c.mode) + '</td><td>' + (c.anp === '' ? '<span class="warn-t">–</span>' : rm(c.anp)) + '</td></tr>'; }).join('') + '</tbody></table>';
  }
  function commentList(list) {
    return list.length ? list.map(function (m) { var w = mem(m.from); return '<div class="cmt' + (m.from === me().id ? ' mine' : '') + '" data-mid="' + m.id + '">' + avatar(w, 'sm') + '<div><b>' + esc(w.name) + '</b> <small class="muted">' + ago(m.created) + '</small><p>' + esc(m.text) + '</p></div></div>'; }).join('') : '<p class="empty small">No comments yet.</p>';
  }

  /* ---------- editor ---------- */
  function editor(e, pre) {
    var isNew = !e, now = Date.now(), k = S.sel || dayKey(now);
    if (isNew) {
      pre = pre || {};
      if (/^\d{4}-\d{2}-\d{2}$/.test(pre.date || '')) k = pre.date;
      var startH = k === dayKey(now) ? Math.min(21, P(now).h + 1) : 10, startM = 0;
      var tm = /^(\d{1,2}):(\d{2})$/.exec(pre.time || ''); if (tm && +tm[1] < 24 && +tm[2] < 60) { startH = +tm[1]; startM = +tm[2]; }
      var st0 = keyMs(k) + (startH * 60 + startM) * 60e3;
      e = {all: false, title: String(pre.title || '').slice(0, 120), type: '', start: new Date(st0).toISOString(), end: new Date(st0 + 3600e3).toISOString(), allDay: false, place: '', notes: String(pre.notes || '').slice(0, 1500), vis: 'team', with: [], remind: '30', count: 1};
    }
    if (isNew && pre && pre.ev) Object.assign(e, pre.ev);
    var picked = !isNew;
    var html = '<form id="ed" class="editor"><div class="row between"><h3>' + (isNew ? 'New event' : 'Edit event') + '</h3><button type="button" class="icon-btn" data-act="close-modal" aria-label="Close">✕</button></div>' +
      '<input name="title" class="title-in" maxlength="120" placeholder="What? e.g. Present Mr Lim medical card" value="' + esc(e.title) + '" required>' +
      '<p class="detect tiny muted" id="detect"></p>' +
      '<div class="types">' + C.TYPE_ORDER.map(function (t) { return '<button type="button" class="tp' + (e.type === t ? ' on' : '') + '" data-t="' + t + '">' + T(t).emoji + ' ' + esc(T(t).label.replace(/ \(.*\)/, '')) + '</button>'; }).join('') + '</div>' +
      '<div class="count-row" ' + (e.type === 'approach' ? '' : 'hidden') + '><label>How many new friends?<input name="count" type="number" min="1" max="999" value="' + (e.count || 1) + '"></label></div>' +
      '<label class="switch"><input type="checkbox" name="allDay"' + (e.allDay ? ' checked' : '') + '> All day</label>' +
      '<div class="two dt"><label class="big-l"><span>📅 Date</span><input class="big-in" name="date" type="date" value="' + dayKey(sMs(e)) + '" required></label>' +
      '<label class="t-only big-l"><span>🕐 Time start</span><input class="big-in" name="st" type="time" value="' + (e.allDay ? '10:00' : hm24(sMs(e))) + '"></label><label class="t-only big-l"><span>🕐 Time end</span><input class="big-in" name="et" type="time" value="' + (e.allDay ? '11:00' : hm24(eMs(e))) + '"></label>' +
      '<label class="d-only big-l"><span>📅 Until</span><input class="big-in" name="date2" type="date" value="' + (e.allDay ? String(e.end || e.start).slice(0, 10) : dayKey(sMs(e))) + '"></label></div>' +
      '<label>Where<input name="place" maxlength="120" value="' + esc(e.place) + '" placeholder="optional"></label>' +
      '<label>Notes<textarea name="notes" maxlength="1500" rows="2" placeholder="optional. Use client initials, not full details">' + esc(e.notes) + '</textarea></label>' +
      '<div class="lbl">Who can see it?</div><div class="vis"><button type="button" class="vb' + (e.vis !== 'private' ? ' on' : '') + '" data-v="team">👥 Team</button><button type="button" class="vb' + (e.vis === 'private' ? ' on' : '') + '" data-v="private">🔒 Only me</button></div>' +
      '<p class="tiny muted" id="vis-help"></p>' +
      '<label class="switch" id="all-row"><input type="checkbox" name="all"' + (e.all ? ' checked' : '') + '> 👥 Everyone\'s in it (team meeting, training, roadshow)</label><p class="tiny muted" id="all-help">Shows on every member\'s calendar. Everyone answers Going / Can\'t go, gets a pop-up for comments, and a reminder 1 hour before.</p>' +
      '<div class="lbl" id="inv-lbl">Invite (optional): they accept or reject</div><div class="withpick">' + members().filter(function (m) { return m.id !== me().id && m.active !== false; }).map(function (m) { return '<button type="button" class="wp' + ((e.with || []).indexOf(m.id) >= 0 ? ' on' : '') + '" data-id="' + m.id + '">' + avatar(m, 'xs') + esc(shortName(m)) + '</button>'; }).join('') + '</div>' +
      '<div class="two"><label>🔁 Repeat<select name="rep">' + [['', 'Does not repeat'], ['w', 'Every week'], ['m', 'Every month'], ['y', 'Every year']].map(function (r) { return '<option value="' + r[0] + '"' + ((e.rep || '') === r[0] ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('') + '</select></label>' +
      '<label class="rep-only">Until (optional)<input name="repEnd" type="date" value="' + esc(e.repEnd || '') + '"></label></div>' +
      '<label>Remind me<select name="remind">' + [['', 'No reminder'], ['0', 'At start'], ['10', '10 min before'], ['30', '30 min before'], ['60', '1 hour before'], ['120', '2 hours before'], ['1440', '1 day before']].map(function (r) { return '<option value="' + r[0] + '"' + (String(e.remind) === r[0] ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('') + '</select></label>' +
      '<div class="row end sticky-actions">' + (!isNew ? '<button type="button" class="btn danger ghost" data-x="del">Delete</button>' : '') + '<button class="btn primary big" type="submit">' + (isNew ? 'Add to calendar' : 'Save') + '</button></div></form>';
    modal(html, function (sh) {
      var f = sh.querySelector('#ed'), type = e.type, vis = e.vis === 'private' ? 'private' : 'team', visPicked = !isNew, withIds = (e.with || []).slice();
      function paint() {
        sh.querySelectorAll('.tp').forEach(function (b) { b.classList.toggle('on', b.dataset.t === type); });
        sh.querySelectorAll('.vb').forEach(function (b) { b.classList.toggle('on', b.dataset.v === vis); });
        sh.querySelector('.count-row').hidden = type !== 'approach';
        sh.querySelector('.rep-only').hidden = !f.rep.value;
        sh.querySelector('#all-row').hidden = sh.querySelector('#all-help').hidden = vis === 'private';
        var everyone = vis !== 'private' && f.all.checked;   // whole-team event: everybody is in it, so every name shows selected
        sh.querySelectorAll('.wp').forEach(function (b) { b.classList.toggle('on', everyone || withIds.indexOf(b.dataset.id) >= 0); b.disabled = everyone; });
        sh.querySelector('#inv-lbl').textContent = everyone ? 'Everyone is invited (all names selected)' : 'Invite (optional): they accept or reject';
        var ad = f.allDay.checked; sh.querySelectorAll('.t-only').forEach(function (x) { x.hidden = ad; }); sh.querySelectorAll('.d-only').forEach(function (x) { x.hidden = !ad; });
        sh.querySelector('#vis-help').textContent = vis === 'private' ? (type && T(type).work ? 'Team sees a grey "Busy" block. It still counts in your activity numbers (no details shown).' : 'Team sees a grey "Busy" block only.') + (me().partner ? ' Your linked partner ' + shortName(mem(me().partner)) + ' sees the details.' : '') : 'Everyone in REDEFINE can see the title, time and place.';
      }
      f.title.addEventListener('input', function () {
        var d = C.detectType(f.title.value);
        if (!picked && d) { type = d; if (!visPicked) vis = d === 'personal' ? 'private' : 'team'; }
        sh.querySelector('#detect').textContent = d && !picked ? 'Detected: ' + T(d).emoji + ' ' + T(d).label + ' (tap another type to change)' : '';
        paint();
      });
      sh.querySelectorAll('.tp').forEach(function (b) { b.onclick = function () { type = b.dataset.t; picked = true; if (!visPicked) vis = type === 'personal' ? 'private' : 'team'; sh.querySelector('#detect').textContent = ''; paint(); }; });
      sh.querySelectorAll('.vb').forEach(function (b) { b.onclick = function () { vis = b.dataset.v; visPicked = true; paint(); }; });
      sh.querySelectorAll('.wp').forEach(function (b) { b.onclick = function () { var i = withIds.indexOf(b.dataset.id); if (i >= 0) withIds.splice(i, 1); else withIds.push(b.dataset.id); b.classList.toggle('on'); }; });
      f.allDay.onchange = paint; f.all.onchange = paint; f.rep.onchange = paint;
      f.st.addEventListener('change', function () { var s = f.st.value.split(':'), en = f.et.value.split(':'); if (f.et.value <= f.st.value) f.et.value = pad(Math.min(23, +s[0] + 1)) + ':' + s[1]; });
      paint(); if (isNew) setTimeout(function () { f.title.focus(); if (f.title.value) f.title.dispatchEvent(new Event('input')); }, 50);   // a pre-filled title still picks its type
      var del = sh.querySelector('[data-x=del]');
      if (del) del.onclick = function () {
        confirmBox('Delete this event?', '"' + e.title + '" and its comments will be removed for everyone. This cannot be undone.', 'Delete', true).then(function (y) {
          if (!y) return editor(e);
          location.hash = '#/'; send('del', {id: e.id}, 'Deleted');
        });
      };
      f.onsubmit = function (ev) {
        ev.preventDefault();
        if (!type) { type = C.detectType(f.title.value) || ''; if (!type) { toast('Pick what kind of activity this is.', 'bad'); sh.querySelector('.types').classList.add('shake'); return; } }
        var ad = f.allDay.checked, d = f.date.value;
        if (!d) return toast('Please pick a date.', 'bad');
        var ev2 = {id: e.id, title: f.title.value, type: type, allDay: ad, place: f.place.value, notes: f.notes.value, vis: vis, all: vis !== 'private' && f.all.checked, with: withIds, remind: f.remind.value, count: f.count.value, source: e.source === 'voice' ? 'voiceok' : (e.source || 'manual'), rep: f.rep.value, repEnd: f.rep.value ? f.repEnd.value : ''};
        if (ad) { ev2.start = d; ev2.end = f.date2.value && f.date2.value >= d ? f.date2.value : d; }
        else {
          if (!f.st.value) return toast('Please pick a start time.', 'bad');
          ev2.start = new Date(d + 'T' + f.st.value + ':00+08:00').toISOString();
          var en = f.et.value ? Date.parse(d + 'T' + f.et.value + ':00+08:00') : 0; if (!en || en <= Date.parse(ev2.start)) en = Date.parse(ev2.start) + 3600e3;
          ev2.end = new Date(en).toISOString();
        }
        var tmpId = isNew ? 'tmp' + Date.now() : e.id;
        var view = {id: tmpId, ownerId: isNew ? me().id : e.ownerId, title: ev2.title.trim(), type: type, start: ev2.start, end: ev2.end, allDay: ad, place: ev2.place, notes: ev2.notes, vis: vis, all: !!ev2.all, with: withIds.slice(), remind: ev2.remind, count: type === 'approach' ? (+ev2.count || 1) : 0, out: isNew ? '' : e.out, anp: isNew ? 0 : e.anp, noc: isNew ? 0 : e.noc, cases: isNew ? [] : (e.cases || []), source: ev2.source, rep: ev2.rep, repEnd: ev2.repEnd};
        closeModal(); S.sel = dayKey(sMs(view));
        if (!isNew) location.hash = '#/e/' + e.id;
        optimistic(function (d) { if (isNew) d.events.push(view); else d.events = d.events.map(function (x) { return x.id === e.id ? Object.assign({}, x, view) : x; }); }, 'save', {event: ev2}, isNew ? 'Added 📅' : 'Saved',
          function (j) { S.data.events = S.data.events.map(function (x) { return x.id === tmpId ? j.event : x; }); if (location.hash === '#/e/' + tmpId) location.hash = '#/e/' + j.event.id; if (isNew && j.event && j.event.all) askWhatsApp(j.event); })
          .catch(function () { editor(Object.assign({}, view, {id: isNew ? undefined : e.id})); });
      };
    });
  }

  /* ---------- confirming what happened ---------- */
  function setOutcome(id, v) {
    var e = events().filter(function (x) { return x.id === id; })[0]; if (!e) return;
    if (v === 'closed') {
      var rows = (e.cases && e.cases.length ? e.cases : [{plan: '', anp: e.anp || '', mode: ''}]).map(function (c) { return {plan: c.plan, anp: c.anp, mode: c.mode}; });
      return modal('<h3>💰 Closed! Well done</h3><p class="muted">' + esc(e.title) + '</p><div id="cases"></div><button type="button" class="btn ghost" data-x="add">+ Add another case</button>' +
        '<p class="sumline" id="casesum"></p><p class="tiny muted">One line per policy. ANP = yearly premium (e.g. RM300 monthly = RM3,600 ANP). Leave ANP blank if not sure yet; the case still counts. Plan name exactly as on the proposal.</p>' +
        '<div class="row end"><button class="btn ghost" data-x="no">Cancel</button><button class="btn primary" data-x="ok">Save</button></div>', function (sh) {
        var box = sh.querySelector('#cases');
        function draw() {
          box.innerHTML = rows.map(function (c, i) {
            return '<div class="case" data-i="' + i + '"><div class="row between"><b>Case ' + (i + 1) + '</b>' + (rows.length > 1 ? '<button type="button" class="link danger" data-del="' + i + '">Remove</button>' : '') + '</div>' +
              '<label>Plan name<input data-k="plan" maxlength="60" value="' + esc(c.plan) + '" placeholder="as on the proposal"></label>' +
              '<label>ANP (RM / year)<input data-k="anp" type="number" inputmode="decimal" step="0.01" min="0" max="5000000" value="' + esc(c.anp) + '" placeholder="e.g. 3600"></label>' +
              '<div class="lbl">Payment mode</div><div class="modes">' + ['M', 'Q', 'HY', 'Y'].map(function (m) { return '<button type="button" class="md' + (c.mode === m ? ' on' : '') + '" data-mode="' + m + '">' + m + '<small>' + C.MODES[m] + '</small></button>'; }).join('') + '</div></div>';
          }).join('');
          sum();
        }
        function sum() { var t = 0, n = 0; rows.forEach(function (c) { if (c.anp !== '' && +c.anp > 0) { t += +c.anp; n++; } }); sh.querySelector('#casesum').innerHTML = 'NOC <b>' + rows.length + '</b> · Total ANP <b>' + rm(t) + '</b>' + (n < rows.length ? ' <span class="warn-t">(' + (rows.length - n) + ' without ANP)</span>' : ''); }
        box.addEventListener('input', function (ev) { var k = ev.target.dataset.k; if (!k) return; rows[+ev.target.closest('.case').dataset.i][k] = ev.target.value; sum(); });
        box.addEventListener('click', function (ev) {
          var md = ev.target.closest('[data-mode]'), del = ev.target.closest('[data-del]');
          if (md) { rows[+md.closest('.case').dataset.i].mode = md.dataset.mode; draw(); }
          if (del) { rows.splice(+del.dataset.del, 1); draw(); }
        });
        sh.querySelector('[data-x=add]').onclick = function () { if (rows.length >= 50) return; rows.push({plan: '', anp: '', mode: rows[rows.length - 1].mode || ''}); draw(); var p = box.querySelectorAll('[data-k=plan]'); p[p.length - 1].focus(); };
        sh.querySelector('[data-x=no]').onclick = closeModal;
        draw(); setTimeout(function () { var p = box.querySelector('[data-k=plan]'); if (p && !p.value) p.focus(); }, 50);
        sh.querySelector('[data-x=ok]').onclick = function () {
          for (var i = 0; i < rows.length; i++) {
            var c = rows[i];
            if (!String(c.plan).trim()) return toast('Case ' + (i + 1) + ': ' + ERR.plan_needed, 'bad');
            if (!c.mode) return toast('Case ' + (i + 1) + ': ' + ERR.mode_needed, 'bad');
            if (c.anp !== '' && !(+c.anp >= 0 && +c.anp <= 5e6)) return toast('Case ' + (i + 1) + ': ' + ERR.bad_anp, 'bad');
            if (+c.anp > 200000 && !window.confirm('Case ' + (i + 1) + ' ANP ' + rm(+c.anp) + '? That is a big case. Save it?')) return;
          }
          closeModal(); send('outcome', {id: id, out: 'closed', cases: rows}, '💰 Closed ' + rows.length + ' case' + (rows.length > 1 ? 's' : '') + '! Team has been told 🎉');
        };
      });
    }
    if (v === 'done' && e.type === 'approach') {
      return modal('<h3>👋 Approach done</h3><label>How many new friends did you approach?<input id="cnt" type="number" min="1" max="999" value="' + (e.count || 1) + '"></label><div class="row end"><button class="btn ghost" data-x="no">Cancel</button><button class="btn primary" data-x="ok">Save</button></div>', function (sh) {
        sh.querySelector('[data-x=no]').onclick = closeModal;
        sh.querySelector('[data-x=ok]').onclick = function () { var n = Math.floor(+sh.querySelector('#cnt').value); if (!(n >= 1)) return toast('At least 1.', 'bad'); closeModal(); send('outcome', {id: id, out: 'done', count: n}, '✓ Counted'); };
      });
    }
    send('outcome', {id: id, out: v}, v === 'done' ? '✓ Counted' : v === 'cancel' ? 'Marked as didn\'t happen' : 'Undone');
  }
  function send(op, body, ok) { return optimistic(applyFor(op, body), op, body, ok).catch(function () {}); }
  function confirmScreen() {
    var list = toConfirm();
    return topbar('Confirm activities', {back: '#/'}) + '<main><p class="muted">Your numbers only count what you confirm. Nothing is guessed. One tap each.</p>' +
      (list.length ? list.map(function (e) {
        return '<div class="card cf" style="' + evStyle(e) + '"><div><b>' + esc(T(e.type).emoji + ' ' + e.title) + '</b><small class="muted">' + esc(dayLabel(dayKey(sMs(e)))) + ' · ' + esc(evTime(e)) + '</small></div><div class="outs">' +
          '<button class="out" data-act="out" data-id="' + e.id + '" data-v="done">✓ Done</button>' + (C.PROSPECT[e.type] ? '<button class="out gold" data-act="out" data-id="' + e.id + '" data-v="closed">💰 Closed</button>' : '') +
          '<button class="out grey" data-act="out" data-id="' + e.id + '" data-v="cancel">✕ Didn\'t happen</button></div></div>';
      }).join('') : '<p class="empty">All confirmed. 💪</p>') + '</main>' + tabs('cal');
  }

  /* ---------- comments feed (replaces chat) ---------- */
  function feedScreen() {
    var list = feedItems().slice(0, 80), since = S.lastRead.feed || LS.get('since', '') || '';
    var html = topbar('Comments') + '<main class="chatlist"><p class="tiny muted">Comments and cheers meant for you: on your events, on events you commented on, and on whole-team events.</p>' +
      (list.length ? list.map(function (m) {
        var e = evById(m.to.slice(3)), w = mem(m.from);
        return '<a class="thread' + (m.created > since ? ' new' : '') + '" href="#/e/' + e.id + '">' + avatar(w, 'md') + '<span class="tb"><b>' + esc(shortName(w)) + (m.kind === 'cheer' ? ' cheered 👏' : '') + ' · ' + esc(T(e.type).emoji + ' ' + e.title) + '</b><small>' + (m.kind === 'cheer' ? esc(dayLabel(dayKey(sMs(e))) + ' · ' + evTime(e)) : esc(m.text)) + '</small></span><span class="tm">' + ago(m.created) + (m.created > since ? '<i class="dot"></i>' : '') + '</span></a>';
      }).join('') : '<p class="empty">No comments yet. Open any event to cheer 👏 or comment.</p>') + '</main>';
    markRead();
    return html + tabs('feed');
  }

  /* ---------- activity / stats ---------- */
  function periodRange(p) {
    var t = dayKey(Date.now()), w = (P(keyMs(t)).w + 6) % 7, mon = addDays(t, -w), x = P(keyMs(t));
    if (p === 'week') return {from: keyMs(mon), to: keyMs(addDays(mon, 7)), label: 'This week'};
    if (p === 'lastweek') return {from: keyMs(addDays(mon, -7)), to: keyMs(mon), label: 'Last week'};
    if (p === 'lastmonth') return {from: Date.UTC(x.y, x.m - 1, 1) - H8, to: Date.UTC(x.y, x.m, 1) - H8, label: MONTH[(x.m + 11) % 12]};
    return {from: Date.UTC(x.y, x.m, 1) - H8, to: Date.UTC(x.y, x.m + 1, 1) - H8, label: MONTH[x.m]};
  }
  function statsData(p) {
    var r = periodRange(p);
    if (S.range && Date.parse(S.range.from) <= r.from && Date.parse(S.range.to) >= r.to) return {r: r, events: events()};
    if (S.stats[p]) return {r: r, events: S.stats[p]};
    api('sync', {from: new Date(r.from).toISOString(), to: new Date(r.to).toISOString(), force: true}).then(function (j) { S.stats[p] = j.events; render(); }, function (e) { toast(errText(e), 'bad'); });
    return {r: r, events: null};
  }
  function statsScreen() {
    var p = S.statsPeriod, d = statsData(p), my = me().id, lead = isLeader();
    var seg = '<div class="seg">' + [['week', 'This week'], ['lastweek', 'Last week'], ['month', 'This month'], ['lastmonth', 'Last month']].map(function (x) { return '<button class="' + (p === x[0] ? 'on' : '') + '" data-act="period" data-p="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>';
    if (!d.events) return topbar('Activity') + '<main>' + seg + '<p class="empty">Loading…</p></main>' + tabs('stats');
    var by = C.stats(d.events, d.r.from, d.r.to, Date.now()), mine = by[my] || C.addStats([]), r = C.ratios(mine);
    var funnel = [['A', 'Approach', mine.A], ['O', 'Open', mine.O], ['P', 'Present', mine.P], ['F', 'Follow-up', mine.F], ['C', 'Close', mine.C]], top = Math.max.apply(null, funnel.map(function (f) { return f[2]; }).concat([1]));
    var html = topbar('Activity') + '<main class="stats">' + seg + goalsCard() +
      '<div class="card"><h4>My ' + esc(/^(This|Last) /.test(d.r.label) ? d.r.label.toLowerCase() : d.r.label) + '</h4><div class="funnel">' + funnel.map(function (f) { return '<div class="fr"><span class="fl"><b>' + f[0] + '</b> ' + f[1] + '</span><span class="fb"><i style="width:' + (f[2] / top * 100) + '%"></i></span><b class="fv">' + f[2] + '</b></div>'; }).join('') + '</div>' +
      '<div class="kpis">' + kpi('O/A', pct(r.OA), 'prospecting') + kpi('P/O', pct(r.PO), 'presentation') + kpi('F/P', pct(r.FP), 'follow-up') + kpi('NOC/P', pct(r.CP), 'closing') + '</div>' + ratioNote(r) +
      '<div class="mae"><div><small>Market</small><b>' + (r.M == null ? '–' : rm(r.M)) + '</b><span>avg case size</span></div><div><small>Activity</small><b>' + mine.P + '</b><span>presentations</span></div><div><small>Efficiency</small><b>' + pct(r.E) + '</b><span>closing ratio</span></div></div>' +
      '<p class="anp">ANP <b>' + rm(mine.anp) + '</b> from ' + mine.C + ' case' + (mine.C === 1 ? '' : 's') + (mine.C > mine.anpCases ? ' <span class="warn-t">(' + (mine.C - mine.anpCases) + ' without ANP yet)</span>' : '') + '</p>' +
      '<p class="others">🤝 Join field ' + (mine.joinfield || 0) + ' · 🌱 Recruit ' + mine.recruit + ' · 👥 Meetings ' + mine.meeting + ' · 🛠️ Service ' + mine.service + ' · 🎁 CRM ' + mine.crm + ' · 📝 Paperwork ' + mine.paperwork + '</p>' +
      (mine.unconfirmed ? '<a class="confirm-bar" href="#/confirm">⚠️ ' + mine.unconfirmed + ' past activit' + (mine.unconfirmed > 1 ? 'ies are' : 'y is') + ' not confirmed, so not counted <span>›</span></a>' : '') + '</div>';
    var ms = members().filter(function (m) { return m.active !== false; });
    var rows = ms.map(function (m) { return {m: m, s: by[m.id] || C.addStats([])}; });
    rows.sort(function (a, b) { return (b.s.anp - a.s.anp) || (b.s.P + b.s.C * 2 + b.s.O + b.s.F) - (a.s.P + a.s.C * 2 + a.s.O + a.s.F) || b.s.A - a.s.A; });
    var tot = C.addStats(rows.map(function (x) { return x.s; }));
    var tq = C.ratios(tot);
    html += '<div class="card"><h4>Team board · ' + esc(d.r.label) + '</h4>' +
      '<div class="teamtot">' + kpi('Activities', actTotal(tot), 'A+O+P+F+R') + kpi('NOC', tot.C, 'cases closed') + kpi('ANP', rm(tot.anp), 'closed') + kpi('Avg case', tq.M == null ? '–' : rm(tq.M), 'ANP ÷ NOC') + '</div>' +
      '<p class="tiny muted">Confirmed activities only. ' + (lead ? 'You are a leader: you also see every agent ratios.' : 'Ratios of each agent stay private (leaders only).') + '</p><div class="tablewrap"><table class="board"><thead><tr><th>#</th><th class="l">Agent</th><th>A</th><th>O</th><th>P</th><th>F</th><th>R</th><th class="sum">Total</th><th>NOC</th><th>ANP</th>' +
      (lead ? '<th>Avg case</th><th>NOC/P</th><th>O/A</th><th>P/O</th><th>F/P</th><th>Not conf.</th><th>Last seen</th>' : '') + '</tr></thead><tbody>' +
      rows.map(function (x, i) {
        var s = x.s, q = C.ratios(s), you = x.m.id === my;
        return '<tr class="' + (you ? 'you' : '') + '"><td>' + (i + 1) + '</td><td class="l">' + avatar(x.m, 'xs') + ' ' + esc(you ? 'Me' : shortName(x.m)) + '</td><td>' + s.A + '</td><td>' + s.O + '</td><td>' + s.P + '</td><td>' + s.F + '</td><td>' + s.recruit + '</td><td class="sum">' + actTotal(s) + '</td><td>' + s.C + '</td><td class="anpc">' + (s.anp ? money(s.anp) : '–') + '</td>' +
          (lead ? '<td>' + (q.M == null ? '–' : rm(q.M)) + '</td><td>' + pct(q.CP) + '</td><td>' + pct(q.OA) + '</td><td>' + pct(q.PO) + '</td><td>' + pct(q.FP) + '</td><td class="' + (s.unconfirmed > 3 ? 'warn-t' : '') + '">' + s.unconfirmed + '</td><td class="tiny">' + (x.m.seen ? ago(x.m.seen) : 'never') + '</td>' : '') + '</tr>';
      }).join('');
    html += '<tr class="tot"><td></td><td class="l">Team total</td><td>' + tot.A + '</td><td>' + tot.O + '</td><td>' + tot.P + '</td><td>' + tot.F + '</td><td>' + tot.recruit + '</td><td class="sum">' + actTotal(tot) + '</td><td>' + tot.C + '</td><td class="anpc">' + money(tot.anp) + '</td>' + (lead ? '<td>' + (tq.M == null ? '–' : rm(tq.M)) + '</td><td>' + pct(tq.CP) + '</td><td>' + pct(tq.OA) + '</td><td>' + pct(tq.PO) + '</td><td>' + pct(tq.FP) + '</td><td>' + tot.unconfirmed + '</td><td></td>' : '') + '</tr>';
    html += '</tbody></table></div>' + (lead ? '<button class="btn wa" data-act="report">📋 Copy for WhatsApp</button>' : '') + '</div>';
    var cl = closeList(d.events, d.r);
    html += '<div class="card"><div class="row between"><h4>Close case list</h4>' + '</div>' +
      (cl.lines.length ? '<pre class="closelist">' + esc(cl.text) + '</pre><button class="btn wa" data-act="copy-close">📋 Copy for WhatsApp</button>' : '<p class="empty small">No closed cases yet in ' + esc(d.r.label.toLowerCase()) + '.</p>') + '</div>';
    if (lead) {
      var quiet = rows.filter(function (x) { return x.m.role !== 'leader' && !d.events.some(function (e) { return e.ownerId === x.m.id && SELLING[e.type || e.t] && (e.out === 'done' || e.out === 'closed') && Date.now() - sMs(e) < 5 * DAY; }); });
      html += '<div class="card"><h4>Needs a check-in</h4><p class="tiny muted">No confirmed approach, open, present, follow-up, close or recruitment in the last 5 days.</p>' + (quiet.length ? quiet.map(function (x) { return '<div class="thread small">' + avatar(x.m, 'sm') + '<span class="tb"><b>' + esc(x.m.name) + '</b><small>' + x.s.unconfirmed + ' not confirmed</small></span></div>'; }).join('') : '<p class="empty small">Everyone is active 👍</p>') +
        '<div class="row"><button class="btn ghost" data-act="csv">⬇ Download CSV (Excel)</button></div></div>';
    }
    return html + '</main>' + tabs('stats');
  }
  function ratioNote(r) {
    var odd = []; if (r.OA > 1) odd.push('more opens than approaches'); if (r.PO > 1) odd.push('more presentations than opens'); if (r.CP > 1) odd.push('more closes than presentations');
    return odd.length ? '<p class="tiny warn-t">Over 100%: ' + odd.join(', ') + ' logged. Add each approach / open / presentation to the calendar so the ratios are true.</p>' : '';
  }
  /* agents: the team ANP sum comes from the server (individual ANP never reaches agents' phones) */
  function teamAnp(p, r) {
    var k = p + '|' + S.ver; S.teamTot = S.teamTot || {};
    if (S.teamTot[k]) return S.teamTot[k];
    if (!S.teamTot[k + '_ask']) { S.teamTot[k + '_ask'] = 1; api('teamtotals', {from: new Date(r.from).toISOString(), to: new Date(r.to).toISOString()}).then(function (j) { S.teamTot[k] = j; render(); }, function () {}); }
    return null;
  }
  /* Close case list, ready for WhatsApp:  "1. 1/11 Rex GMS 1198/M" ... "Total ANP: 23,705.65"
     One line per policy, in date order. Name = the agent's first name. ANP not entered yet shows as "ANP?". */
  function closeList(evs, r) {
    var list = evs.filter(function (e) { return e.out === 'closed' && sMs(e) >= r.from && sMs(e) < r.to && members().some(function (m) { return m.id === e.ownerId && m.active !== false; }); })
      .sort(function (x, y) { return sMs(x) - sMs(y); }), lines = [], total = 0;
    list.forEach(function (e) {
      var p = P(sMs(e)), who = shortName(mem(e.ownerId)), cs = e.cases && e.cases.length ? e.cases : [{plan: '(plan not entered)', anp: e.anp || '', mode: '?'}];
      if (!(e.cases && e.cases.length) && (e.noc || 1) > 1) for (var k = 1; k < e.noc; k++) cs.push({plan: '(plan not entered)', anp: '', mode: '?'});
      cs.forEach(function (c) {
        var has = c.anp !== '' && c.anp != null && +c.anp > 0; if (has) total += +c.anp;
        lines.push((lines.length + 1) + '. ' + p.d + '/' + (p.m + 1) + ' ' + who + ' ' + c.plan + ' ' + (has ? String(Math.round(+c.anp * 100) / 100) : 'ANP?') + '/' + (c.mode || '?'));
      });
    });
    var head = /^(This|Last) /.test(r.label) ? r.label.toUpperCase() : r.label.toUpperCase();
    return {lines: lines, text: '🔥' + head + ' CLOSE CASE LIST🔥\n\n' + lines.join('\n') + '\n\n\nTotal ANP: ' + money(total)};
  }
  function actTotal(s) { return s.A + s.O + s.P + s.F + s.recruit; }   // selling activities; NOC (results) shown separately
  /* ---------- goals: required weekly activity from my own ratios (last 90 days), or the team’s if I have too little history ---------- */
  function loadProgress(month) {
    var k = month || '';
    if (S.prog && S.prog.k === k && Date.now() - S.prog.at < 60e3) return S.prog.v;
    if (!S.progBusy) { S.progBusy = 1; api('progress', month ? {month: month} : {}).then(function (j) { S.progBusy = 0; S.prog = {k: k, at: Date.now(), v: j}; render(); }, function () { S.progBusy = 0; }); }
    return S.prog && S.prog.k === k ? S.prog.v : null;
  }
  function goalOf(key) { var g = ((S.data && S.data.goals) || []).filter(function (x) { return x.key === key; })[0]; return g ? +g.anp : 0; }
  function ratioBase(pr) {
    var m = pr.r90.me, t = pr.r90.team, okMe = m.P >= 5 && m.C >= 2 && m.anpCases >= 2;
    var s = okMe ? m : t;
    return {who: okMe ? 'your last 90 days' : 'the team’s last 90 days (you need a bit more history)', avg: s.anpCases ? s.anp / s.anpCases : null, CP: s.P ? s.C / s.P : null, PO: s.O ? s.P / s.O : null, OA: s.A ? s.O / s.A : null};
  }
  function needWeekly(remain, weeks, rb) {
    if (remain <= 0) return null;
    var out = {}, cases = rb.avg ? Math.ceil(remain / rb.avg) : null;
    if (cases == null) return {msg: 'Not enough closed cases with ANP yet to work this out.'};
    out.C = cases; out.P = rb.CP ? Math.ceil(cases / rb.CP) : null; out.O = out.P != null && rb.PO ? Math.ceil(out.P / rb.PO) : null; out.A = out.O != null && rb.OA ? Math.ceil(out.O / rb.OA) : null;
    var wk = {}; Object.keys(out).forEach(function (k2) { wk[k2] = out[k2] == null ? null : Math.ceil(out[k2] / weeks); });
    return {total: out, week: wk};
  }
  function goalsCard() {
    var pr = loadProgress(''); if (!pr) return '<div class="card goals"><h4>🎯 My goals</h4><p class="muted">Loading…</p></div>';
    var sel = S.goalP || 0, p = pr.periods[sel], goal = goalOf(p.key), got = p.s.anp, rb = ratioBase(pr);
    var weeks = Math.max(1, Math.ceil((p.to - Date.now()) / (7 * DAY))), need = goal ? needWeekly(goal - got, weeks, rb) : null, pc = goal ? Math.min(100, Math.round(got / goal * 100)) : 0;
    var h = '<div class="card goals"><div class="row between"><h4>🎯 My goals</h4><a class="btn tiny ghost" href="#/report">📄 Monthly report</a></div><div class="seg small">' + pr.periods.map(function (x, i) { return '<button class="' + (i === sel ? 'on' : '') + '" data-act="goalp" data-i="' + i + '">' + ({month: 'Month', quarter: 'Quarter', 'half-year': 'Half-year', year: 'Year'})[x.label] + '</button>'; }).join('') + '</div>' +
      '<div class="row"><label class="grow">ANP goal this ' + p.label + ' (RM)<input id="goalin" type="number" inputmode="numeric" min="0" step="100" value="' + (goal || '') + '" placeholder="e.g. 30000"></label><button class="btn primary" data-act="goalsave" data-key="' + p.key + '">Save</button></div>';
    if (!goal) return h + '<p class="tiny muted">Set a goal and the app works out how many approaches, opens, presentations and closes you need each week.</p></div>';
    h += '<div class="gbar"><i style="width:' + pc + '%"></i></div><p><b>' + rm(got) + '</b> of ' + rm(goal) + ' (' + pc + '%) · ' + weeks + ' week' + (weeks > 1 ? 's' : '') + ' left</p>';
    if (got >= goal) return h + '<p class="ok-t">🎉 Goal reached! Raise the bar?</p></div>';
    if (need && need.msg) return h + '<p class="muted">' + need.msg + '</p></div>';
    var cell = function (lbl, k2) { return '<div class="kpi"><small>' + lbl + '</small><b>' + (need.week[k2] == null ? '–' : need.week[k2]) + '</b><span>per week</span></div>'; };
    return h + '<h4 class="sub">You need each week</h4><div class="kpis">' + cell('A', 'A') + cell('O', 'O') + cell('P', 'P') + cell('C', 'C') + '</div><p class="tiny muted">Remaining ' + rm(goal - got) + ' ÷ avg case ' + (rb.avg ? rm(rb.avg) : '–') + ' = ' + need.total.C + ' cases → ' + (need.total.P == null ? '–' : need.total.P) + ' presentations → ' + (need.total.O == null ? '–' : need.total.O) + ' opens → ' + (need.total.A == null ? '–' : need.total.A) + ' approaches, using ' + rb.who + '.</p></div>';
  }
  /* ---------- monthly report with a coach’s note (rules, not AI) ---------- */
  function coachNote(ms, team, goal) {
    var out = [], r = C.ratios(ms), tr = C.ratios(team);
    if (goal) { var pc = Math.round(ms.anp / goal * 100); out.push(pc >= 100 ? '🎉 Goal reached: ' + rm(ms.anp) + ' of ' + rm(goal) + '. Set a bigger one for next month.' : pc >= 70 ? '💪 Close: ' + pc + '% of your goal. One or two more closes would do it.' : '📈 ' + pc + '% of your goal. The funnel below shows where to push.'); }
    else out.push('🎯 No goal set for this month. Set one in Activity → My goals so the app can plan your week.');
    if (!ms.A) out.push('👋 No new approaches logged. Everything starts here: aim for a few new friends every week.');
    if (ms.P < team.P) out.push('📊 Presentations: ' + ms.P + ' (team average ' + team.P.toFixed(1) + '). More presentations = more closes.');
    else if (ms.P) out.push('📊 Strong presentation activity: ' + ms.P + ' (team average ' + team.P.toFixed(1) + ').');
    var gaps = [['OA', 'Turn more approaches into appointments: ask for the meeting on the spot.'], ['PO', 'Turn more fact-finds into presentations: book the presentation before you leave.'], ['CP', 'Your closing ratio is below the team: follow up within 48 hours and ask for the decision.']]
      .map(function (g) { return {g: g, gap: r[g[0]] != null && tr[g[0]] != null ? tr[g[0]] - r[g[0]] : 0}; }).sort(function (x, y) { return y.gap - x.gap; });
    if (gaps[0].gap > 0.05) out.push('🔍 ' + gaps[0].g[1]);
    if (ms.unconfirmed) out.push('✅ ' + ms.unconfirmed + (ms.unconfirmed > 1 ? ' activities were' : ' activity was') + ' not confirmed, so ' + (ms.unconfirmed > 1 ? 'they' : 'it') + ' did not count. Confirm them after each meeting.');
    return out;
  }
  function reportScreen(month) {
    var now = P(Date.now()), def = new Date(Date.UTC(now.y, now.m - 1, 1)).toISOString().slice(0, 7), mk = /^\d{4}-\d{2}$/.test(month || '') ? month : def, pr = loadProgress(mk);
    var y = +mk.slice(0, 4), m = +mk.slice(5) - 1, prev = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 7), next = new Date(Date.UTC(y, m + 1, 1)).toISOString().slice(0, 7);
    var head = topbar('Monthly report', {back: '#/stats'}) + '<main class="stats"><div class="monthnav"><a class="nav" href="#/report/' + prev + '">‹</a><b>' + MONTH[m] + ' ' + y + '</b><a class="nav" href="#/report/' + next + '">›</a></div>';
    if (!pr || !pr.month) return head + '<p class="empty">Loading…</p></main>' + tabs('stats');
    var ms = pr.month.me, t = pr.month.teamAvg, goal = goalOf('M' + mk), row = function (lbl, k2) { return '<tr><td class="l">' + lbl + '</td><td><b>' + ms[k2] + '</b></td><td>' + (+t[k2]).toFixed(1) + '</td></tr>'; };
    return head + '<div class="card"><h4>My numbers</h4><table class="board"><thead><tr><th class="l"></th><th>Me</th><th>Team avg</th></tr></thead><tbody>' + row('👋 Approach', 'A') + row('☕ Open', 'O') + row('📊 Present', 'P') + row('🔁 Follow-up', 'F') + row('✍️ NOC', 'C') +
      '<tr><td class="l">💰 ANP</td><td><b>' + rm(ms.anp) + '</b></td><td>' + rm(t.anp) + '</td></tr>' + (goal ? '<tr><td class="l">🎯 Goal</td><td><b>' + rm(goal) + '</b></td><td></td></tr>' : '') + '</tbody></table></div>' +
      '<div class="card coach"><h4>📝 Coach’s note</h4>' + coachNote(ms, t, goal).map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('') + '</div></main>' + tabs('stats');
  }
  function kpi(k, v, l) { return '<div class="kpi"><small>' + k + '</small><b>' + v + '</b><span>' + l + '</span></div>'; }
  function reportRows() {
    var d = statsData(S.statsPeriod); if (!d.events) return null;
    var by = C.stats(d.events, d.r.from, d.r.to, Date.now());
    return {d: d, rows: members().filter(function (m) { return m.active !== false; }).map(function (m) { return {m: m, s: by[m.id] || C.addStats([])}; }).sort(function (a, b) { return b.s.anp - a.s.anp || b.s.P - a.s.P; })};
  }
  function copyReport() {
    var x = reportRows(); if (!x) return;
    var tot = C.addStats(x.rows.map(function (r) { return r.s; })), tq = C.ratios(tot);
    var line = function (s) { return 'A' + s.A + ' O' + s.O + ' P' + s.P + ' F' + s.F + ' R' + s.recruit + ' = ' + actTotal(s) + ' · NOC ' + s.C + ' · ' + (s.anp ? rm(s.anp) : 'RM0'); };
    var rows = x.rows.slice().sort(function (p, q) { return actTotal(q.s) - actTotal(p.s) || q.s.anp - p.s.anp; });
    var lines = ['📊 *REDEFINE Team Board · ' + x.d.r.label + '*', 'Activities ' + actTotal(tot) + ' · NOC ' + tot.C + ' · ANP ' + rm(tot.anp) + ' · Avg case ' + (tq.M == null ? '–' : rm(tq.M)), ''];
    rows.forEach(function (r, n) { lines.push((n + 1) + '. ' + shortName(r.m) + ': ' + line(r.s) + (r.s.unconfirmed ? ' · ⚠️' + r.s.unconfirmed + ' unconfirmed' : '')); });
    lines.push('', '*Team total: ' + line(tot) + '*', '', 'A approach · O open · P present · F follow-up · R recruit', 'Confirmed activities only. Keep your calendar updated 💪');
    copyText(lines.join('\n'));
  }
  function downloadCsv() {
    var x = reportRows(); if (!x) return;
    var head = ['Agent', 'Approach', 'Open', 'Present', 'Follow-up', 'Recruit', 'Total activities', 'NOC', 'ANP', 'Avg case', 'O/A', 'P/O', 'F/P', 'NOC/P', 'Meeting', 'Service', 'CRM', 'Paperwork', 'Not confirmed'];
    var all = {m: {name: 'TEAM TOTAL'}, s: C.addStats(x.rows.map(function (r) { return r.s; }))};
    var lines = [head.join(',')].concat(x.rows.concat([all]).map(function (r) { var s = r.s, q = C.ratios(s); return ['"' + r.m.name.replace(/"/g, '""') + '"', s.A, s.O, s.P, s.F, s.recruit, actTotal(s), s.C, s.anp, q.M == null ? '' : Math.round(q.M), pct(q.OA), pct(q.PO), pct(q.FP), pct(q.CP), s.meeting, s.service, s.crm, s.paperwork, s.unconfirmed].join(','); }));
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], {type: 'text/csv'})); a.download = 'REDEFINE activity ' + x.d.r.label + '.csv'; a.click();
  }

  /* ---------- me ---------- */
  function installHelp(forPush) {
    return '<h3>' + (forPush ? 'One step first' : 'Put the app on your home screen') + '</h3>' +
      (forPush ? '<p class="muted">iPhone only allows pop-ups for apps on the home screen (iOS 16.4 or newer).</p>' : '') +
      '<ol class="steps"><li><b>iPhone (Safari):</b> tap Share <span class="kbd">⬆︎</span> → <b>Add to Home Screen</b> → Add. Then open REDEFINE Cal from the home screen.</li>' +
      '<li><b>Android (Chrome):</b> tap ⋮ → <b>Add to Home screen</b> / <b>Install app</b>.</li></ol>' +
      '<div class="row end"><button class="btn primary" data-act="close-modal">OK</button></div>';
  }
  function meScreen() {
    var m = me(), perm = 'Notification' in window ? Notification.permission : 'unsupported';
    var push = pushOn() ? (me().devices ? '<p class="ok-t">🔔 Pop-ups are ON for this phone, even when the app is closed.</p>' : '<p class="warn-t">⚠️ The server lost this phone\'s pop-up registration. Tap Reconnect.</p>') + '<div class="row"><button class="btn primary" data-act="pushfix">Reconnect pop-ups</button><button class="btn ghost" data-act="pushtest">Send me a test</button><button class="btn ghost" data-act="pushtest15">Test in 15 s (lock phone)</button><button class="btn ghost" data-act="pushoff">Turn off</button></div>'
      : perm === 'granted' && !CFG.firebase ? '<p class="muted">Banners and sound work while the app is open. Pop-ups when closed will work once your leader finishes the Firebase setup.</p>'
      : perm === 'denied' ? '<p class="warn-t">Notifications are blocked for this app. Turn them on in your phone Settings → Notifications.</p>'
      : '<p class="muted">Get a WhatsApp-style pop-up for comments on your events, cheers, team wins and event reminders.</p><button class="btn primary" data-act="push">🔔 Turn on notifications</button>';
    return topbar('Me') + '<main class="me"><div class="card who">' + avatar(m, 'lg') + '<div><h3>' + esc(m.name) + '</h3><p class="muted">' + (m.leader ? '⭐ Leader' : 'Agent') + ' · REDEFINE</p></div></div>' +
      '<div class="card"><h4>My short name</h4><p class="tiny muted">What the team sees on chips, Team day, attendance and the close case list. Avoid surnames, e.g. KJ, MJ, Rex.</p><div class="row"><input id="shortin" maxlength="12" value="' + esc(me().short || '') + '" placeholder="e.g. KJ" style="flex:1;min-width:120px"><button class="btn primary" data-act="short">Save</button></div>' + (!me().shortSet ? '<p class="tiny warn-t">Suggested from your name. Change it if you like, then tap Save.</p>' : '') + '</div>' +
      '<div class="card who-photo"><h4>My photo</h4>' + avatar(m, 'xl') + '<p class="tiny muted">Your face shows on the calendar, Team day and the board so everyone knows it’s you.</p><label class="btn primary file">📷 ' + (m.photoV ? 'Change photo' : 'Upload my photo') + '<input type="file" accept="image/*" data-act="pick-photo" hidden></label></div>' +
      '<div class="card"><h4>Notifications</h4>' + push + '</div>' +
      '<div class="card"><h4>🎂 My birthday</h4><p class="tiny muted">The team sees it on the calendar and gets a reminder on the day. Only the day and month are shared.</p><div class="row"><input id="bdayin" type="date" value="' + (m.bday ? '2000-' + m.bday : '') + '" style="flex:1;min-width:150px"><button class="btn primary" data-act="bdaysave">Save</button>' + (m.bday ? '<button class="btn ghost" data-act="bdayclear">Remove</button>' : '') + '</div></div>' +
      peopleCard() +
      partnerCard() +
      '<div class="card"><h4>Move my calendar here</h4><p class="muted">Google Calendar, TimeTree, iPhone, or a paper diary: snap photos or screenshots and the AI copies them in. You check every row first.</p><a class="btn primary" href="#/import">⤓ Import calendar</a></div>' +
      (!standalone() ? '<div class="card"><h4>Install</h4><p class="muted">Add REDEFINE Calendar to your home screen so it opens like an app.</p><button class="btn ghost" data-act="install">How?</button></div>' : '') +
      (m.leader ? '<div class="card"><h4>Leader</h4><a class="btn ghost" href="#/members">👥 Manage members</a></div>' : '') +
      '<div class="card"><h4>How counting works</h4><p class="tiny muted">Each event has a type (👋 Approach, ☕ Open, 📊 Present, 🔁 Follow-up, ✍️ Closing, 🌱 Recruit, 👥 Meeting, 🛠️ Service, 🎁 CRM, 📝 Paperwork, 🏠 Personal). The app guesses it from the title. After the event, tap ✓ Done, 💰 Closed (with ANP) or ✕ Didn\'t happen. Only confirmed events count. O/A = prospecting, P/O = presentation, F/P = follow-up, NOC/P = closing ratio. Personal events never count.</p></div>' +
      subCard() + soundCard() + (m.owner ? '<div class="card"><h4>🎉 Celebration themes</h4><p class="tiny muted">Only you (the owner) see this. Upload a festival poster: the app takes its colours and pictures for the whole team.</p><a class="btn primary" href="#/themes">Manage themes</a></div>' : '') +
      '<div class="card"><h4>Help & security</h4><div class="row"><button class="btn primary" data-act="tour">📖 Take the tour</button><button class="btn ghost" data-act="pinchange">🔑 Change my PIN</button></div></div>' +
      '<p class="center tiny muted">App version ' + APP_VERSION + ' · ' + (isIOS() ? 'iPhone' : 'Android / other') + (standalone() ? ' · home-screen app' : ' · browser') + ' · notifications: ' + ('Notification' in window ? Notification.permission : 'not supported') + ' · server has ' + (me().devices || 0) + ' phone(s) for you</p>' +
      '<p class="center"><button class="link danger" data-act="signout">Sign out of this phone</button></p></main>' + tabs('me');
  }
  function membersScreen() {
    if (!isLeader()) return topbar('Members', {back: '#/me'}) + '<main><p class="empty">Leaders only.</p></main>';
    return topbar('Members', {back: '#/me'}) + '<main><p class="muted">Members join by signing in with the team code. Removing someone signs them out everywhere; their events stay.</p>' +
      members().map(function (m) {
        var you = m.id === me().id;
        return '<div class="card mrow' + (m.active === false ? ' off' : '') + '">' + avatar(m, 'sm') + '<div class="grow"><b>' + esc(m.name) + '</b><small class="muted">' + (m.role === 'leader' ? '⭐ Leader' : 'Agent') + (m.active === false ? ' · removed' : '') + ' · last seen ' + (m.seen ? ago(m.seen) : 'never') + '</small></div>' +
          (you ? '<small class="muted">you</small>' : '<div class="mbtns">' + (m.active === false ? '<button class="btn tiny ghost" data-act="mem" data-id="' + m.id + '" data-do="back">Bring back</button>'
            : '<button class="btn tiny ghost" data-act="mem" data-id="' + m.id + '" data-do="' + (m.role === 'leader' ? 'agent' : 'leader') + '">' + (m.role === 'leader' ? 'Make agent' : 'Make leader') + '</button><button class="btn tiny danger ghost" data-act="mem" data-id="' + m.id + '" data-do="remove">Remove</button><button class="btn tiny ghost" data-act="mem" data-id="' + m.id + '" data-do="reset">🔑 Reset PIN</button>') + '</div>') + '</div>';
      }).join('') + '</main>';
  }

  /* ---------- import: photos / screenshots / .ics ---------- */
  function importScreen() {
    var rows = S.importRows;
    if (rows) return importReview();
    return topbar('Import calendar', {back: '#/me'}) + '<main class="import"><p class="muted">Bring your existing appointments in. Nothing is added until you check the list and tap Add.</p>' +
      '<div class="card"><h4>📷 Photos or screenshots</h4><p class="tiny muted">Google Calendar, TimeTree, iPhone Calendar, Samsung, WhatsApp, or a handwritten diary. Up to 10 at a time. Week or day view reads best; zoom in on busy months.</p>' +
      '<label class="btn primary big file">Choose photos<input type="file" accept="image/*" multiple data-act="pick-photos" hidden></label>' +
      '<label class="btn ghost file">Take a photo<input type="file" accept="image/*" capture="environment" data-act="pick-photos" hidden></label></div>' +
      '<div class="card"><h4>📄 Calendar file (.ics)</h4><p class="tiny muted">Exact copy, no AI needed. Google Calendar on a computer: Settings → Import & export → Export, unzip, pick the .ics. Imports events from 30 days ago to 1 year ahead.</p>' +
      '<label class="btn ghost file">Choose .ics file<input type="file" accept=".ics,text/calendar" data-act="pick-ics" hidden></label></div>' +
      '<p class="tiny muted">Photos are read by AI on REDEFINE\'s server and not stored. Tip: blur or crop out client phone numbers / IC first.</p></main>';
  }
  /* portrait: centre square, 192 px JPEG (about 10 KB) */
  function uploadPhoto(file) {
    var img = new Image(), url = URL.createObjectURL(file);
    img.onload = function () {
      var s = Math.min(img.width, img.height), c = document.createElement('canvas'); c.width = c.height = 192;
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 192, 192);
      URL.revokeObjectURL(url);
      var q = 0.82, data = c.toDataURL('image/jpeg', q).split(',')[1]; while (data.length > 55000 && q > 0.4) { q -= 0.1; data = c.toDataURL('image/jpeg', q).split(',')[1]; }
      var my = me().id, v = new Date().toISOString();
      photoCache[my] = {v: v, d: data};
      optimistic(function (dd) { dd.me.photoV = v; dd.members.forEach(function (x) { if (x.id === my) x.photoV = v; }); }, 'photo', {data: data}, 'Photo saved 📷', function (j) { photoCache[my] = {v: j.photoV, d: data}; S.data.me.photoV = j.photoV; S.data.members.forEach(function (x) { if (x.id === my) x.photoV = j.photoV; }); try { LS.set('photos', photoCache); } catch (x) {} });
    };
    img.onerror = function () { URL.revokeObjectURL(url); toast('That picture could not be read.', 'bad'); };
    img.src = url;
  }
  function shrink(file) {
    return new Promise(function (ok, bad) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var max = 2000, s = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
      };
      img.onerror = function () { URL.revokeObjectURL(url); bad({code: 'bad_photo'}); };
      img.src = url;
    });
  }
  function existingKeys() { var k = {}, my = me().id; events().forEach(function (e) { if (e.ownerId === my && !e.busy) k[String(e.title).toLowerCase().replace(/\s+/g, ' ') + '|' + (e.allDay ? String(e.start).slice(0, 10) : new Date(sMs(e)).toISOString())] = 1; }); return k; }
  function readPhotos(files) {
    files = Array.prototype.slice.call(files, 0, 10); if (!files.length) return;
    var rows = [], notes = [], i = 0;
    var prog = function (t) { modal('<h3>Reading your calendar…</h3><p class="muted">' + esc(t) + '</p><div class="spinner"></div><p class="tiny muted">About 10–30 seconds per photo.</p>'); };
    function next() {
      if (i >= files.length) { closeModal(); return finish(); }
      var f = files[i++]; prog('Photo ' + i + ' of ' + files.length);
      return shrink(f).then(function (b64) { return api('read', {image: b64}); }).then(function (j) {
        j.read.events.forEach(function (r) { r.photo = i; rows.push(r); }); if (j.read.notes) notes.push('Photo ' + i + ': ' + j.read.notes);
        return next();
      }, function (e) { notes.push('Photo ' + i + ': ' + errText(e)); return next(); });
    }
    function finish() {
      var have = existingKeys();
      S.importRows = rows.map(function (r) {
        var x = {title: r.title, type: r.type, typeGuessed: r.typeGuessed, date: r.date, st: r.start, et: r.end, allDay: r.allDay, count: r.count, problems: r.problems.slice(), photo: r.photo, vis: r.type === 'personal' ? 'private' : 'team', on: r.ok, source: 'photo'};
        if (x.date && dup(x, have)) { x.on = false; x.problems.unshift('already in your calendar'); }
        return x;
      });
      S.importNotes = notes; S.importFrom = 'photos';
      if (!rows.length) toast(notes.length ? notes[0] : 'No events found in those photos.', 'bad');
      render();
    }
    next();
  }
  function dup(x, have) {
    var start = x.allDay ? x.date : x.st ? new Date(x.date + 'T' + x.st + ':00+08:00').toISOString() : '';
    return start && have[String(x.title).toLowerCase().replace(/\s+/g, ' ') + '|' + start];
  }
  function readIcs(file) {
    var fr = new FileReader();
    fr.onload = function () {
      var now = Date.now(), r = C.parseICS(fr.result, now - 30 * DAY, now + 366 * DAY), have = existingKeys();
      if (!r.events.length) return toast('No events in that date range in this file.', 'bad');
      S.importRows = r.events.map(function (e) {
        var x = {title: e.title, type: e.type, typeGuessed: e.typeGuessed, allDay: e.allDay, date: e.allDay ? e.start : dayKey(sMs(e)), st: e.allDay ? '' : hm24(sMs(e)), et: e.allDay ? '' : hm24(eMs(e)), date2: e.allDay ? e.end : '', place: e.place, count: 1, problems: [], vis: e.type === 'personal' ? 'private' : 'team', on: true, source: 'ics'};
        if (e.repeats) x.problems.push('repeating: only the first one is copied');
        if (dup(x, have)) { x.on = false; x.problems.unshift('already in your calendar'); }
        return x;
      });
      S.importNotes = [r.outside ? r.outside + ' events outside 30 days ago – 1 year ahead were left out.' : ''].filter(Boolean); S.importFrom = 'file';
      render();
    };
    fr.readAsText(file);
  }
  function importReview() {
    var rows = S.importRows, on = rows.filter(function (r) { return r.on; }).length, priv = rows.filter(function (r) { return r.on && r.vis === 'private'; }).length;
    return topbar('Check & add', {back: '#/import', right: '<button class="icon-btn" data-act="imp-cancel" aria-label="Cancel">✕</button>'}) + '<main class="import">' +
      '<p class="muted">Found <b>' + rows.length + '</b> event' + (rows.length === 1 ? '' : 's') + '. Rows in red need you: fix the date / time, then tick. Unclear rows are never added by themselves.</p>' +
      (S.importNotes && S.importNotes.length ? '<div class="note">' + S.importNotes.map(esc).join('<br>') + '</div>' : '') +
      '<div class="row"><button class="btn tiny ghost" data-act="imp-all" data-v="private">🔒 All only me</button><button class="btn tiny ghost" data-act="imp-all" data-v="team">👥 All team</button></div>' +
      rows.map(function (r, i) {
        var bad = !r.date || (!r.allDay && !r.st);
        return '<div class="imp' + (bad ? ' bad' : '') + (r.on ? ' on' : '') + '" data-i="' + i + '">' +
          '<label class="tick"><input type="checkbox" data-imp="on"' + (r.on ? ' checked' : '') + '></label><div class="grow">' +
          '<input class="it" data-imp="title" value="' + esc(r.title) + '" maxlength="120">' +
          '<div class="irow"><input type="date" data-imp="date" value="' + esc(r.date) + '">' + (r.allDay ? '<span class="pill grey">All day</span>' : '<input type="time" data-imp="st" value="' + esc(r.st) + '"><input type="time" data-imp="et" value="' + esc(r.et) + '">') + '<button class="link tiny" data-act="imp-allday">' + (r.allDay ? 'set time' : 'all day') + '</button></div>' +
          '<div class="irow"><select data-imp="type">' + C.TYPE_ORDER.map(function (t) { return '<option value="' + t + '"' + (r.type === t ? ' selected' : '') + '>' + T(t).emoji + ' ' + T(t).label + '</option>'; }).join('') + '</select>' +
          '<button class="vis-t" data-act="imp-vis">' + (r.vis === 'private' ? '🔒 Only me' : '👥 Team') + '</button></div>' +
          (r.problems.length || r.typeGuessed ? '<small class="probs">' + esc(r.problems.concat(r.typeGuessed && r.problems.indexOf('type?') < 0 ? ['type guessed'] : []).join(' · ')) + (r.photo ? ' · photo ' + r.photo : '') + '</small>' : (r.photo ? '<small class="muted tiny">photo ' + r.photo + '</small>' : '')) +
          '</div></div>';
      }).join('') +
      '<div class="sticky-actions"><button class="btn primary big" data-act="imp-go"' + (on ? '' : ' disabled') + '>Add ' + on + ' event' + (on === 1 ? '' : 's') + (priv ? ' (' + priv + ' private)' : '') + '</button></div></main>';
  }
  function importGo() {
    var list = [], blocked = 0;
    S.importRows.forEach(function (r) {
      if (!r.on) return;
      if (!r.date || (!r.allDay && !r.st) || !r.title.trim()) { blocked++; return; }
      var e = {title: r.title, type: r.type, allDay: r.allDay, vis: r.vis, count: r.count, place: r.place || '', source: r.source, remind: r.allDay ? '' : '30'};
      if (r.allDay) { e.start = r.date; e.end = r.date2 && r.date2 >= r.date ? r.date2 : r.date; }
      else { e.start = new Date(r.date + 'T' + r.st + ':00+08:00').toISOString(); var en = r.et ? Date.parse(r.date + 'T' + r.et + ':00+08:00') : 0; e.end = new Date(en > Date.parse(e.start) ? en : Date.parse(e.start) + 3600e3).toISOString(); }
      list.push(e);
    });
    if (blocked) return toast(blocked + ' ticked row' + (blocked > 1 ? 's need' : ' needs') + ' a date and time first.', 'bad');
    var priv = list.filter(function (e) { return e.vis === 'private'; }).length;
    confirmBox('Add ' + list.length + ' events?', (list.length - priv) + ' visible to the team, ' + priv + ' only you (team sees "Busy"). Duplicates are skipped.', 'Add').then(function (y) {
      if (!y) return;
      api('import', {events: list}).then(function (j) {
        S.importRows = null; toast('Added ' + j.added + (j.skipped ? ', ' + j.skipped + ' already there' : '') + (j.bad ? ', ' + j.bad + ' unusable' : ''), 'good');
        location.hash = '#/'; return sync(true);
      }, function (e) { toast(errText(e), 'bad'); });
    });
  }

  /* ---------- router + render ---------- */
  function route() { return (location.hash || '#/').slice(1); }
  var lastRoute = '';
  function render() {
    if (HOLD) { S.renderLater = true; return; }   // never swap the screen while someone is holding 🎤 (their finger would lose the button)
    if (!S.token) { $app.innerHTML = signInScreen(); return; }
    if (!S.data) { $app.innerHTML = topbar('REDEFINE Calendar') + '<main><p class="empty">Loading your team…</p></main>'; return; }
    celebrate();
    var r = route(), parts = r.split('/').filter(Boolean), html;
    var active = document.activeElement, typing = active && /INPUT|TEXTAREA|SELECT/.test(active.tagName) && $app.contains(active);
    if (typing && active.closest('#todoadd')) {   // quick to-do entry: refresh the boxes, keep the cursor and what is typed
      var keepT = active.value, keepN = active.name;
      setTimeout(function () { var el = document.querySelector('#todoadd [name="' + keepN + '"]'); if (el && el.type !== 'checkbox') { el.value = keepT; el.focus(); } }, 0);
    } else if (typing && r === lastRoute) {   // don't wipe what someone is typing: only refresh the live lists
      var live = $app.querySelector('[data-live]');
      if (live && live.dataset.live === 'comments') live.innerHTML = commentList((S.data.msgs || []).filter(function (m) { return m.to === 'ev:' + parts[1] && m.kind !== 'cheer' && m.kind !== 'rsvp'; }));
      return;
    }
    /* link from another REDEFINE app (e.g. On Field follow-up): #/new?t=title&d=YYYY-MM-DD&s=HH:MM&n=notes opens a pre-filled New event; nothing is saved until the agent taps Add */
    if (/^new(\?|$)/.test(parts[0] || '')) {
      var qs = new URLSearchParams(r.split('?')[1] || '');
      history.replaceState(null, '', location.pathname + location.search + '#/');
      lastRoute = '/'; $app.innerHTML = calendarScreen();
      setTimeout(function () { editor(null, {title: qs.get('t'), date: qs.get('d'), time: qs.get('s'), notes: qs.get('n')}); }, 30);
      return;
    }
    if (parts[0] === 'e' && parts[1]) html = eventScreen(parts[1]);
    else if (parts[0] === 'feed' || parts[0] === 'chat') html = feedScreen();
    else if (parts[0] === 'stats') html = statsScreen();
    else if (parts[0] === 'me') html = meScreen();
    else if (parts[0] === 'members') html = membersScreen();
    else if (parts[0] === 'import') html = importScreen();
    else if (parts[0] === 'confirm') html = confirmScreen();
    else if (parts[0] === 'invites') html = invitesScreen();
    else if (parts[0] === 'teamevents') html = teamEventsScreen();
    else if (parts[0] === 'todo') html = todoScreen();
    else if (parts[0] === 'voicecheck') html = voiceCheckScreen();
    else if (parts[0] === 'besttime') html = bestTimeScreen();
    else if (parts[0] === 'themes') html = themesScreen();
    else if (parts[0] === 'report') html = reportScreen(parts[1]);
    else html = calendarScreen();
    var y = r === lastRoute ? document.body.scrollTop : 0;   // the page itself never scrolls; the body does (keeps the bottom bar still)
    $app.innerHTML = html; lastRoute = r;
    document.body.scrollTop = y;
    if (!parts[0] && S.view === 'agenda' && y === 0) setTimeout(scrollToToday, 30);
    if (parts[0] === 'e' && parts[2] === 'c' && y === 0) { var cm = $app.querySelector('.comments'); if (cm) setTimeout(function () { cm.scrollIntoView({block: 'start'}); }, 30); }
  }

  /* ---------- taps ---------- */
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-act]'); if (!b || b.tagName === 'FORM' || b.tagName === 'INPUT') return;
    var a = b.dataset.act, today = dayKey(Date.now());
    if (a === 'close-modal') return closeModal();
    if (a === 'btquick') { var tq = dayKey(Date.now()); S.btOpt.from = tq; S.btOpt.to = addDays(tq, +b.dataset.n); return render(); }
    if (a === 'btopt') { S.btOpt[b.dataset.k] = b.dataset.k === 'when' ? b.dataset.v : +b.dataset.v; return render(); }
    if (a === 'btset') { var bs = b.dataset.s, be = b.dataset.e; return editor(null, {date: dayKey(Date.parse(bs)), time: hm24(Date.parse(bs)), ev: {all: true, type: 'meeting', start: bs, end: be}}); }
    if (a === 'vcheck') return send('checked', {id: b.dataset.id}, '✓ Checked');
    if (a === 'vdel') return confirmBox('Delete this entry?', 'It is removed from your calendar.', 'Delete', true).then(function (y) { if (y) send('del', {id: b.dataset.id}, 'Deleted'); });
    if (a === 'feedget' || a === 'feedreset' || a === 'feedoff') {
      var go = function () { api('feed', a === 'feedreset' ? {reset: true} : a === 'feedoff' ? {off: true} : {}).then(function (j) { S.feedTok = j.feed; render(); if (a === 'feedreset') toast('New link made. Subscribe again with it on your other calendars.', 'good'); }, function (e) { toast(errText(e), 'bad'); }); };
      if (a === 'feedget') return go();
      return confirmBox(a === 'feedreset' ? 'Make a new link?' : 'Turn off the subscription?', a === 'feedreset' ? 'The old link stops working. Calendars that use it will stop updating until you subscribe with the new one.' : 'Apple / Google Calendar will stop getting your appointments.', a === 'feedreset' ? 'New link' : 'Turn off', a === 'feedoff').then(function (y) { if (y) go(); });
    }
    if (a === 'feedcopy') { var fu = feedUrl(S.feedTok); return (navigator.clipboard ? navigator.clipboard.writeText(fu) : Promise.reject()).then(function () { toast('Link copied 📋', 'good'); }, function () { toast('Press and hold the link box to copy it.', 'bad'); }); }
    if (a === 'poster') { var pt = activeTheme(); if (!pt || !pt.poster) return; return mediaUrl(pt.poster).then(function (u) { if (u) modal('<img class="poster-full" src="' + u + '" alt="Poster"><div class="row end"><button class="btn primary" data-act="close-modal">Close</button></div>'); }); }
    if (a === 'themes-on') return api('themeson', {on: b.dataset.v === '1'}).then(function (j) { S.themeList.themesOn = j.themesOn; quietSync(true); render(); toast(j.themesOn ? '🎉 Themes on for everyone' : 'Back to the normal look', 'good'); }, function (e) { toast(errText(e), 'bad'); });
    if (a === 'theme-new') return themeEditor(null);
    if (a === 'theme-edit') return themeEditor(S.themeList.themes.filter(function (t) { return t.id === b.dataset.id; })[0]);
    if (a === 'theme-preview') { if (S.previewTheme && S.previewTheme.id === b.dataset.id) { S.previewTheme = null; celebrate(); return render(); } var tp = S.themeList.themes.filter(function (t) { return t.id === b.dataset.id; })[0]; S.previewTheme = Object.assign({}, tp, {preview: true, who: tp.occasion === 'birthday' ? [me()] : null}); celebrate(); render(); return toast('Preview on this device. Tap 👀 Preview again to stop.', 'good'); }
    if (a === 'theme-del') return confirmBox('Delete this theme?', 'Its poster and music are deleted too.', 'Delete', true).then(function (y) { if (y) api('themedel', {id: b.dataset.id}).then(function () { S.themeList = null; quietSync(true); render(); }, function (e) { toast(errText(e), 'bad'); }); });
    if (a === 'tour') { location.hash = '#/'; return setTimeout(function () { tour(0); }, 200); }
    if (a === 'pinchange') return askNewPin(true);
    if (a === 'todotab') { S.todoTab = b.dataset.v; return render(); }
    if (a === 'todoq') { S.todoQ = b.dataset.q; var keep = (document.querySelector('#todoadd [name=t]') || {}).value; render(); var ti = document.querySelector('#todoadd [name=t]'); if (ti) { ti.value = keep || ''; ti.focus(); } return; }
    if (a === 'todoshowdone') { S.showDone = !S.showDone; return render(); }
    if (a === 'todotick') { var tx = todos().filter(function (x) { return x.id === b.dataset.id; })[0]; if (!tx) return; return send('todo', {item: {id: tx.id, text: tx.text, q: tx.q, due: tx.due, done: !tx.done}}, tx.done ? '' : '✅ Done!'); }
    if (a === 'tododel') return send('tododel', {id: b.dataset.id});
    if (a === 'goalp') { S.goalP = +b.dataset.i; return render(); }
    if (a === 'goalsave') { var gv = (document.getElementById('goalin') || {}).value || ''; if (gv !== '' && !(+gv >= 0)) return toast('Type the ANP goal in RM.', 'bad'); S.prog = null; return send('goal', {key: b.dataset.key, anp: gv === '' ? '' : Math.round(+gv)}, gv === '' ? 'Goal removed' : '🎯 Goal saved'); }
    if (a === 'bdaysave') { var bv = (document.getElementById('bdayin') || {}).value || ''; if (!bv) return toast('Pick your birthday first.', 'bad'); return send('profile', {bday: bv.slice(5)}, '🎂 Birthday saved'); }
    if (a === 'bdayclear') return send('profile', {bday: ''}, 'Removed');
    if (a === 'person-del') return confirmBox('Remove this?', 'It will no longer repeat every year.', 'Remove', true).then(function (y) { if (y) send('del', {id: b.dataset.id}, 'Removed'); });
    if (a === 'filter' && b.dataset.id === 'pick') return pickMerge();
    if (a === 'filter') { S.filter = b.dataset.id; LS.set('filter', S.filter); return render(); }
    if (a === 'merge-keep') { var mk = keptMerges(); if (mk.indexOf(b.dataset.id) < 0) mk.push(b.dataset.id); setKept(mk); toast('Kept. It stays on your chips.', 'good'); return render(); }
    if (a === 'merge-x') { setKept(keptMerges().filter(function (x) { return x !== b.dataset.id; })); if (S.filter === 'me+' + b.dataset.id) { S.filter = 'me'; LS.set('filter', 'me'); } return render(); }
    if (a === 'merge') { closeModal(); S.filter = 'me+' + b.dataset.id; LS.set('filter', S.filter); return render(); }
    if (a === 'partner') {
      var pa = b.dataset.do, pid = b.dataset.id || (document.getElementById('ptn') || {}).value;
      if (pa === 'request' && !pid) return toast('Pick your partner first.', 'bad');
      var pmsg = {request: 'Send a link request to ' + mem(pid).name + '? Once they accept, you both see each other\'s private events.', accept: 'Link calendars with ' + mem(pid).name + '? You will both see each other\'s private events.', unlink: 'Unlink from ' + mem(me().partner).name + '? Your private events become private again for both of you.'}[pa];
      var go = function () { return send('partner', {action: pa, id: pid}, {request: 'Request sent 💌', accept: 'Linked 💑', decline: 'Declined', cancel: 'Request cancelled', unlink: 'Unlinked'}[pa]); };
      return pmsg ? confirmBox('Partner calendar', pmsg, pa === 'unlink' ? 'Unlink' : 'Yes', pa === 'unlink').then(function (y) { if (y) go(); }) : go();
    }
    if (a === 'view') { S.view = b.dataset.v; LS.set('view', S.view); if (S.view === 'agenda') setTimeout(scrollToToday, 30); if (S.view === 'day' && !S.dayView) S.dayView = S.sel || today; return render(); }
    if (a === 'sel' && S.view === 'month' && S.sel === b.dataset.k) return openDay(b.dataset.k);
    if (a === 'sel') { S.sel = b.dataset.k; var p = P(keyMs(S.sel)); if (p.m !== S.cursor.m) { S.cursor = {y: p.y, m: p.m}; quietSync(); } return render(); }
    if (a === 'month') { var c = S.cursor, m = c.m + +b.dataset.d; S.cursor = {y: c.y + Math.floor(m / 12), m: (m + 12) % 12}; S.sel = dayKey(Date.UTC(S.cursor.y, S.cursor.m, 1) - H8 + 3600e3); render(); return quietSync(); }
    if (a === 'day') { S.dayView = addDays(S.dayView, +b.dataset.d); S.sel = S.dayView; var q = P(keyMs(S.dayView)); if (q.m !== S.cursor.m) { S.cursor = {y: q.y, m: q.m}; quietSync(); } return render(); }
    if (a === 'today') { var t = P(Date.now()); S.cursor = {y: t.y, m: t.m}; S.sel = today; S.dayView = today; render(); return quietSync(); }
    if (a === 'new') return editor(null);
    if (a === 'ag-new') { closeModal(); S.sel = b.dataset.k; return editor(null); }
    if ((a === 'edit' || a === 'out' || a === 'cheer' || a === 'invite' || a === 'rsvp') && /^tmp/.test(b.dataset.id || '')) return toast('Still saving… one moment.');
    if (a === 'edit') { var eid = String(b.dataset.id || '').split('~')[0]; return editor(rawEvents().filter(function (e) { return e.id === eid; })[0]); }
    if (a === 'out') return setOutcome(b.dataset.id, b.dataset.v);
    if (a === 'cheer') return send('send', {to: 'ev:' + b.dataset.id, kind: 'cheer'});
    if (a === 'invite') {
      var iv = b.dataset.v, go = function () { return send('rsvp', {id: b.dataset.id, answer: iv}, iv === 'yes' ? '✅ Accepted. It is on your calendar.' : 'Rejected. Removed from your calendar.'); };
      return iv === 'no' ? confirmBox('Reject this invitation?', 'It will disappear from your calendar and the owner will be told. You can still accept later from the event link.', 'Reject', true).then(function (y) { if (y) go(); }) : go();
    }
    if (a === 'wa-send') { closeModal(); var ws = events().filter(function (x) { return x.id === b.dataset.id; })[0]; if (ws) waSend(teamShareText(ws)); return; }
    if (a === 'wa-team') { var we = events().filter(function (x) { return x.id === b.dataset.id; })[0]; if (we) copyText(teamShareText(we)); return; }
    if (a === 'rsvp') return send('rsvp', {id: b.dataset.id, answer: b.dataset.v}, b.dataset.v === 'yes' ? '✅ See you there!' : b.dataset.v === 'no' ? 'Noted: can\'t go' : 'Answer cleared');
    if (a === 'period') { S.statsPeriod = b.dataset.p; LS.set('statsPeriod', S.statsPeriod); return render(); }
    if (a === 'report') return copyReport();
    if (a === 'csv') return downloadCsv();
    if (a === 'copy-close') { var dd = statsData(S.statsPeriod); if (!dd.events) return; return copyText(closeList(dd.events, dd.r).text); }
    if (a === 'push') return enablePush();
    if (a === 'pushfix') return repairPush(true).then(render);
    if (a === 'pushtest15') { toast('Lock your phone now. A pop-up should arrive in about 15 seconds.'); return api('pushtest', {delay: 15}).catch(function () {}); }
    if (a === 'pushtest') return api('pushtest').then(function () { toast('Sent. It should pop up in a few seconds.'); }, function (e) { toast(errText(e), 'bad'); });
    if (a === 'pushoff') return api('pushoff', {pushToken: LS.get('pushToken', '')}).then(function () { LS.del('pushToken'); toast('Pop-ups off for this phone'); render(); });
    if (a === 'install') return modal(installHelp(false));
    if (a === 'color') return send('profile', {color: b.dataset.c});
    if (a === 'short') { var sv = (document.getElementById('shortin') || {}).value || ''; if (!sv.trim()) return toast('Type a short name first.', 'bad'); return send('profile', {short: sv.trim()}, 'Saved: the team now sees you as ' + sv.trim()); }
    if (a === 'signout') return confirmBox('Sign out?', 'You will need the team code, your name and PIN to sign in again on this phone.', 'Sign out', true).then(function (y) { if (y) api('signout', {pushToken: LS.get('pushToken', '')}).catch(function () {}).then(function () { signOutLocal(); }); });
    if (a === 'mem' && b.dataset.do === 'reset') {
      var rw = mem(b.dataset.id);
      return confirmBox('Reset PIN?', 'Give ' + rw.name + ' a temporary PIN? They choose a new one when they sign in. Phones already signed in stay signed in.', 'Reset').then(function (y) {
        if (!y) return; api('member', {id: rw.id, reset: true}).then(function (j) { modal('<h3>🔑 Temporary PIN</h3><p>Tell <b>' + esc(rw.name) + '</b>:</p><p class="bigpin">' + j.tempPin + '</p><p class="tiny muted">Name to type: <b>' + esc(rw.name) + '</b>. They will choose a new PIN right after signing in. This PIN is shown only once.</p><div class="row end"><button class="btn primary" data-act="close-modal">Done</button></div>'); }, function (e) { toast(errText(e), 'bad'); });
      });
    }
    if (a === 'mem') {
      var who = mem(b.dataset.id), d = b.dataset.do;
      var txt = d === 'remove' ? 'Remove ' + who.name + '? They are signed out on every phone. Their events stay.' : d === 'back' ? 'Let ' + who.name + ' sign in again?' : 'Make ' + who.name + ' ' + (d === 'leader' ? 'a leader? Leaders see ANP and ratios of everyone.' : 'an agent?');
      return confirmBox('Please confirm', txt, d === 'remove' ? 'Remove' : 'Yes', d === 'remove').then(function (y) { if (y) send('member', d === 'remove' ? {id: who.id, active: false} : d === 'back' ? {id: who.id, active: true} : {id: who.id, role: d}, 'Done'); });
    }
    if (a === 'imp-cancel') { S.importRows = null; location.hash = '#/import'; return render(); }
    if (a === 'imp-all') { S.importRows.forEach(function (r) { r.vis = b.dataset.v; }); return render(); }
    if (a === 'imp-go') return importGo();
    var row = b.closest('.imp');
    if (row) {
      var r = S.importRows[+row.dataset.i];
      if (a === 'imp-vis') { r.vis = r.vis === 'private' ? 'team' : 'private'; return render(); }
      if (a === 'imp-allday') { r.allDay = !r.allDay; return render(); }
    }
    if (b.dataset.mid) return;
  });
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.dataset.act === 'pick-photo') { if (t.files[0]) uploadPhoto(t.files[0]); t.value = ''; return; }
    if (t.dataset.act === 'pick-photos') { readPhotos(t.files); t.value = ''; return; }
    if (t.dataset.act === 'pick-ics') { if (t.files[0]) readIcs(t.files[0]); t.value = ''; return; }
    var row = t.closest && t.closest('.imp');
    if (row && t.dataset.imp) {
      var r = S.importRows[+row.dataset.i], k = t.dataset.imp;
      if (k === 'on') r.on = t.checked; else r[k] = t.value;
      if (k === 'title') { var d = C.detectType(t.value); if (d && r.typeGuessed) r.type = d; }
      if (k === 'type') r.typeGuessed = false;
      var fixed = r.date && (r.allDay || r.st);
      if (fixed) r.problems = r.problems.filter(function (p) { return p !== 'date unclear' && p !== 'time unclear'; });
      render();
    }
  });
  document.addEventListener('submit', function (ev) {
    var f = ev.target;
    if (f.id === 'signin') { ev.preventDefault(); return doSignIn(f); }
    if (f.id === 'todoadd') {
      ev.preventDefault(); var txt = f.t.value.trim(); if (!txt) return;
      var due = f.today.checked ? dayKey(Date.now()) : (f.due.value || '');
      f.t.value = ''; return send('todo', {item: {text: txt, q: S.todoQ || '1', due: due}});
    }
    if (f.id === 'personadd') {
      ev.preventDefault(); var nm = f.n.value.trim(), dd = f.d.value; if (!nm || !dd) return toast('Name and date please.', 'bad');
      var bd = f.k.value === 'b', ttl = (bd ? '🎂 ' : '💍 ') + nm + (bd ? '’s birthday' : '’s anniversary');
      return send('save', {event: {title: ttl, type: f.w.value, allDay: true, start: dd, end: dd, rep: 'y', vis: f.v.value, remind: '', source: 'manual'}}, (bd ? '🎂' : '💍') + ' Added: repeats every year');
    }
    if (f.dataset.act === 'comment') {
      ev.preventDefault();
      var text = f.t.value.trim(); if (!text) return;
      var to = 'ev:' + f.dataset.id;
      f.t.value = ''; f.t.focus();
      optimistic(applyFor('send', {to: to, text: text}), 'send', {to: to, text: text}).catch(function () { var inp = document.querySelector('form.composer input[name=t]'); if (inp && !inp.value) inp.value = text; });
    }
  });
  // tap and hold your own comment to delete it
  var holdTimer = null;
  document.addEventListener('touchstart', function (ev) { var m = ev.target.closest && ev.target.closest('.cmt.mine'); if (!m) return; holdTimer = setTimeout(function () { delMsg(m.dataset.mid); }, 650); }, {passive: true});
  ['touchend', 'touchmove'].forEach(function (n) { document.addEventListener(n, function () { clearTimeout(holdTimer); }, {passive: true}); });
  document.addEventListener('contextmenu', function (ev) { var m = ev.target.closest && ev.target.closest('.cmt.mine'); if (m) { ev.preventDefault(); delMsg(m.dataset.mid); } });
  function delMsg(id) { confirmBox('Delete this comment?', 'It will be removed for everyone.', 'Delete', true).then(function (y) { if (y) send('delmsg', {id: id}); }); }

  var sw0 = null;
  document.addEventListener('touchstart', function (ev) { if (!ev.target.closest || !ev.target.closest('#calmain') || ev.touches.length > 1 || ev.target.closest('.gd.sel .gd-evs, .team, .chips')) { sw0 = null; return; } sw0 = {x: ev.touches[0].clientX, y: ev.touches[0].clientY, t: Date.now()}; }, {passive: true});
  document.addEventListener('touchend', function (ev) {
    if (!sw0) return; var t = ev.changedTouches[0], dx = t.clientX - sw0.x, dy = t.clientY - sw0.y, dt = Date.now() - sw0.t; sw0 = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5 || dt > 800 || route().replace(/^[/]+/, '')) return;
    var step = dx < 0 ? 1 : -1;   // swipe left = next month (or day), swipe right = previous
    if (S.view === 'day') { S.dayView = addDays(S.dayView, step); S.sel = S.dayView; var q2 = P(keyMs(S.dayView)); if (q2.m !== S.cursor.m) { S.cursor = {y: q2.y, m: q2.m}; quietSync(); } return render(); }
    if (S.view === 'list') return;
    var c2 = S.cursor, m2 = c2.m + step; S.cursor = {y: c2.y + Math.floor(m2 / 12), m: (m2 + 12) % 12}; S.sel = dayKey(Date.UTC(S.cursor.y, S.cursor.m, 1) - H8 + 3600e3); render(); window.scrollTo(0, 0); quietSync();
  }, {passive: true});
  window.addEventListener('hashchange', function () { closeModal(); render(); });
  /* Phones keep home-screen apps paused in memory, so an update would only arrive after swiping the app away.
     Instead: whenever the app comes back on screen, check for a newer version and reload (never mid-typing / with a form open). */
  function checkUpdate() {
    fetch('version.json?t=' + Date.now(), {cache: 'no-store'}).then(function (r) { return r.json(); }).then(function (j) {
      var v = String(j.v || '');
      if (!v || v === APP_VERSION || LS.get('reloadedFor', '') === v) return;
      var busy = document.getElementById('modal-root').className || (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName));
      if (busy) return;
      LS.set('reloadedFor', v); location.reload();
    }).catch(function () {});
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { quietSync(); checkUpdate(); } });
  window.addEventListener('pageshow', function (e) { if (e.persisted) { quietSync(); checkUpdate(); } });
  window.addEventListener('online', function () { quietSync(); });

  /* ---------- start ---------- */
  var t0 = P(Date.now()); S.cursor = {y: t0.y, m: t0.m}; S.sel = dayKey(Date.now()); S.dayView = S.sel;
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(function () {});
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
  render();
  if (S.token) { quietSync(true); refreshPush(); }
  setTimeout(checkUpdate, 3000);
  // keep fresh: every 6 s on an event, every 20 s elsewhere; nothing while hidden
  var lastPoll = 0;
  setInterval(function () {
    if (!S.token || document.hidden) return;
    var fast = /^#\/e\//.test(location.hash), now = Date.now();
    if (now - lastPoll >= (fast ? 6e3 : 20e3)) { lastPoll = now; quietSync(); }
    checkReminders(); runVoiceQ();
  }, 3000);
  window.RCAL = {S: S, sync: sync, render: render, MUS: MUS};   // for testing in the browser console
})();
