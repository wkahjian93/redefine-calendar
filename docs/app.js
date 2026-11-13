/* REDEFINE Calendar - phone app. Screens: Calendar (month / team day / list), event + comments, editor, confirm, comments feed, stats, me, import.
   All times are Malaysia time. Talks to the team server with small JSON posts (see core.js for the rules). */
(function () {
  'use strict';
  var C = CORE, CFG = self.RCAL_CONFIG || {};
  var $app = document.getElementById('app');
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var APP_VERSION = '19';
  var H8 = 8 * 3600e3, DAY = 864e5, SELLING = {approach: 1, open: 1, present: 1, followup: 1, close: 1, recruit: 1};

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
  function avatar(m, size) { var sh = shortName(m), t = sh.length <= 3 ? sh.toUpperCase() : initials(sh); return '<span class="av' + (size ? ' av-' + size : '') + '" style="background:' + esc(m.color || '#999') + '">' + esc(t) + '</span>'; }
  function T(type) { return C.TYPES[type] || {label: 'Event', emoji: '📌', work: 0}; }
  function evTitle(e) { return e.busy ? 'Busy' : (T(e.type).emoji + ' ' + e.title); }
  function evTime(e) { if (e.allDay) return 'All day'; return hm(sMs(e)) + ' – ' + hm(eMs(e)); }
  var ansCache = {ver: -1, map: {}};
  function ansOf(e) {   // {memberId: 'yes'|'no'} for this event (invitations + team-event attendance)
    if (ansCache.ver !== S.ver || ansCache.data !== S.data) { ansCache = {ver: S.ver, data: S.data, map: {}}; ((S.data && S.data.msgs) || []).forEach(function (m) { if (m.kind === 'rsvp') { var k = m.to.slice(3); (ansCache.map[k] = ansCache.map[k] || {})[m.from] = m.text; } }); }
    return ansCache.map[e.id] || {};
  }
  function invited(e, id) { return !e.all && e.ownerId !== id && (e.with || []).indexOf(id) >= 0; }
  function pendingFor(e, id) { return invited(e, id) && !ansOf(e)[id]; }
  /* light colour: an invitation not answered yet, or a team event this person has not said Going to (the creator counts as going) */
  function faded(e, id) { return pendingFor(e, id) || (!!e.all && e.ownerId !== id && ansOf(e)[id] !== 'yes'); }
  function involves(e, id) { return e.ownerId === id || ((e.with || []).indexOf(id) >= 0 && ansOf(e)[id] !== 'no') || !!e.all; }
  function myInvites() { var my = me().id; return events().filter(function (e) { return pendingFor(e, my) && eMs(e) > Date.now() && e.out !== 'cancel'; }).sort(function (a, b) { return sMs(a) - sMs(b); }); }
  function isWork(e) { var t = e.type || e.t; return !!(C.TYPES[t] && C.TYPES[t].work); }
  function needsConfirm(e) { return e.ownerId === me().id && !e.busy && isWork(e) && !e.out && eMs(e) <= Date.now(); }
  function events() { return (S.data && S.data.events) || []; }
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
    if (op === 'profile') return function (d) { [d.me].concat(d.members.filter(function (m) { return m.id === my; })).forEach(function (m) { if (q.color) m.color = q.color; if (q.short) { m.short = q.short; d.me.shortSet = true; } }); };
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
      '<div class="logo">' + logoSvg(64) + '</div><h1>REDEFINE Calendar</h1>' +
      '<p class="muted">One calendar for the whole team. See who is busy, keep private things private, and let the app count your activities.</p>' +
      (CFG.sample ? '<p class="sample-note">Test copy: team code <b>test-team</b> (leader: <b>test-leader-code</b>), any sample name e.g. <b>Kah Jian</b>, PIN <b>1234</b>.</p>' : '') +
      '<form id="signin" autocomplete="off"><label>Team code<input name="code" required autocapitalize="off" placeholder="from your leader"></label>' +
      '<label>Your name<input name="name" required maxlength="40" placeholder="e.g. Alicia Tan"></label>' +
      '<label>PIN (4–6 digits)<input name="pin" required inputmode="numeric" pattern="\\d{4,6}" maxlength="6" type="password"></label>' +
      '<button class="btn primary big" type="submit">Sign in</button></form>' +
      '<p class="tiny muted">First time? Type your name and choose a PIN. You stay signed in on this phone, like WhatsApp.</p></div>';
  }
  function doSignIn(form, create) {
    var f = new FormData(form), body = {code: f.get('code'), name: f.get('name'), pin: f.get('pin'), device: navigator.userAgent.slice(0, 60), create: !!create};
    var btn = form.querySelector('button'); btn.disabled = true; btn.textContent = 'Signing in…';
    api('signin', body).then(function (j) {
      S.token = j.token; LS.set('token', j.token); LS.set('since', new Date().toISOString());
      toast(j.created ? 'Welcome to REDEFINE Calendar, ' + j.me.name + '!' : 'Welcome back, ' + j.me.name, 'good');
      return sync(true);
    }).then(function () { location.hash = '#/'; render(); }, function (e) {
      btn.disabled = false; btn.textContent = 'Sign in';
      if (e.code === 'new_name') return confirmBox('New member?', 'No one called "' + body.name + '" yet. Create a new member with this name and PIN?', 'Create').then(function (y) { if (y) doSignIn(form, true); });
      toast(errText(e), 'bad');
    });
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
    var t = [['cal', '#/', '📅', 'Calendar', c], ['feed', '#/feed', '🔔', 'Comments', u], ['stats', '#/stats', '📈', 'Activity', 0], ['me', '#/me', '👤', 'Me', 0]];
    return '<nav class="tabs">' + t.map(function (x) { return '<a href="' + x[1] + '" class="' + (active === x[0] ? 'on' : '') + '"><span class="ti">' + x[2] + (x[4] ? '<i class="badge">' + (x[4] > 99 ? '99+' : x[4]) + '</i>' : '') + '</span>' + x[3] + '</a>'; }).join('') + '</nav>';
  }
  function topbar(title, opts) {
    opts = opts || {};
    return '<header class="top">' + (opts.back ? '<a class="back" href="' + opts.back + '" aria-label="Back">‹</a>' : '<span class="brand">' + logoSvg(26) + '</span>') +
      '<h2>' + title + '</h2>' + (opts.right || '') + '</header>' +
      (CFG.sample ? '<div class="sample">' + esc(CFG.sample) + '</div>' : '') +
      (!S.online ? '<div class="offline">No signal. Showing the last saved copy.</div>' : '');
  }

  /* ---------- calendar ---------- */
  function filterChips() {
    var my = me().id, list = members().filter(function (m) { return m.active !== false; });
    var p = me().partner, merged = S.filter.indexOf('me+') === 0 ? S.filter.slice(3) : '';
    // merged chips: partner (always), kept ones (📌, remove with ×), and the one just picked (📌 keep or × close)
    var kept = LS.get('merges', []).filter(function (id) { return id !== p && members().some(function (m) { return m.id === id && m.active !== false; }); });
    var extra = []; if (p && mem(p).active !== false) extra.push(['me+' + p, '💑 Me + ' + shortName(mem(p)), mem(p).color]);
    kept.forEach(function (id) { extra.push(['me+' + id, 'Me + ' + shortName(mem(id)), mem(id).color, 'kept', id]); });
    if (merged && merged !== p && kept.indexOf(merged) < 0) extra.push([S.filter, 'Me + ' + shortName(mem(merged)), mem(merged).color, 'temp', merged]);
    extra.push(['pick', 'Me + …', '#9CA3AF']);
    var chips = [['all', 'Everyone', '#14213D'], ['me', 'Me', me().color]].concat(extra, list.filter(function (m) { return m.id !== my; }).map(function (m) { return [m.id, shortName(m), m.color]; }));
    return '<div class="chips">' + chips.map(function (c) {
      var tools = c[3] === 'temp' ? '<span class="ctool" data-act="merge-keep" data-id="' + c[4] + '" title="Keep this chip">📌</span><span class="ctool" data-act="merge-x" data-id="' + c[4] + '" title="Close">×</span>'
        : c[3] === 'kept' ? '<span class="ctool" data-act="merge-x" data-id="' + c[4] + '" title="Remove">×</span>' : '';
      return '<button class="chip' + (S.filter === c[0] ? ' on' : '') + (tools ? ' has-tools' : '') + '" data-act="filter" data-id="' + c[0] + '"><i style="background:' + esc(c[2]) + '"></i>' + esc(c[1]) + tools + '</button>';
    }).join('') + '</div>';
  }
  function pickMerge() {
    var list = members().filter(function (m) { return m.id !== me().id && m.active !== false; });
    modal('<h3>Merge my calendar with…</h3><p class="tiny muted">Shows your events and theirs together. Their private events still show as Busy unless you are linked partners (Me → Partner calendar).</p><div class="withpick">' +
      list.map(function (m) { return '<button class="wp" data-act="merge" data-id="' + m.id + '">' + avatar(m, 'xs') + esc(m.name) + '</button>'; }).join('') + '</div><div class="row end"><button class="btn ghost" data-act="close-modal">Cancel</button></div>');
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
  function viewSwitch() {
    return '<div class="seg">' + [['month', 'Month'], ['day', 'Team day'], ['list', 'List']].map(function (v) { return '<button class="' + (S.view === v[0] ? 'on' : '') + '" data-act="view" data-v="' + v[0] + '">' + v[1] + '</button>'; }).join('') + '</div>';
  }
  function calendarScreen() {
    var c = S.cursor, today = dayKey(Date.now()), confirm = toConfirm();
    var head = S.view === 'day'
      ? '<div class="monthnav"><button class="nav" data-act="day" data-d="-1" aria-label="Previous day">‹</button><b>' + esc(dayLabel(S.dayView)) + '</b><button class="nav" data-act="day" data-d="1" aria-label="Next day">›</button><button class="btn tiny ghost" data-act="today">Today</button></div>'
      : '<div class="monthnav"><button class="nav" data-act="month" data-d="-1" aria-label="Previous month">‹</button><b>' + MONTH[c.m] + ' ' + c.y + '</b><button class="nav" data-act="month" data-d="1" aria-label="Next month">›</button><button class="btn tiny ghost" data-act="today">Today</button></div>';
    var body = S.view === 'day' ? teamDay() : S.view === 'list' ? listView() : monthGrid() + dayAgenda(S.sel);
    return topbar('REDEFINE Calendar', {right: '<a class="icon-btn" href="#/import" aria-label="Import calendar">⤓</a>'}) +
      '<main class="cal">' + viewSwitch() + (S.view === 'day' ? '' : filterChips()) +
      (upcomingTeam().length ? '<a class="confirm-bar team-bar" href="#/teamevents"><img class="tlogo" src="icons/team-mark.png" alt=""> Upcoming team events <b>(' + upcomingTeam().length + ')</b>' + (teamToAnswer() ? ' · <b class="ans">' + teamToAnswer() + ' to answer</b>' : '') + ' <span>›</span></a>' : '') +
      (myInvites().length ? '<a class="confirm-bar invite" href="#/invites">📩 <b>' + myInvites().length + '</b> invitation' + (myInvites().length > 1 ? 's' : '') + ' waiting for your answer <span>›</span></a>' : '') +
      (confirm.length ? '<a class="confirm-bar" href="#/confirm">✅ <b>' + confirm.length + '</b> activit' + (confirm.length > 1 ? 'ies' : 'y') + ' to confirm so your numbers count <span>›</span></a>' : '') +
      head + body + '</main><button class="fab" data-act="new" aria-label="Add event">+</button>' + tabs('cal');
  }
  function monthGrid() {
    var c = S.cursor, first = Date.UTC(c.y, c.m, 1), dow = (new Date(first).getUTCDay() + 6) % 7, start = dayKey(first - H8 - dow * DAY + 3600e3), today = dayKey(Date.now());
    var list = filtered(), html = '<div class="grid"><div class="gh">' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(function (d) { return '<span>' + d + '</span>'; }).join('') + '</div>';
    for (var w = 0; w < 6; w++) {
      var rowStart = addDays(start, w * 7); if (w >= 4 && P(keyMs(rowStart)).m !== c.m) break;
      html += '<div class="gw">';
      for (var d = 0; d < 7; d++) {
        var k = addDays(start, w * 7 + d), p = P(keyMs(k)), evs = onDay(list, k).sort(function (x, y) { return (y.all ? 1 : 0) - (x.all ? 1 : 0); });   // team events always visible first
        html += '<button class="gd' + (p.m !== c.m ? ' dim' : '') + (k === today ? ' today' : '') + (k === S.sel ? ' sel' : '') + '" data-act="sel" data-k="' + k + '"><span class="dn">' + p.d + '</span>' +
          evs.slice(0, 3).map(function (e) { var o = mem(e.ownerId); return '<span class="bar' + (e.busy ? ' busy' : '') + (faded(e, me().id) ? ' pend' : '') + (e.out === 'cancel' ? ' x' : '') + (e.all ? ' team' : '') + '" style="--c:' + esc(o.color) + '">' + (e.all ? '<img class="tlogo" src="icons/team-mark.png" alt="">' : '') + esc(e.busy ? 'Busy' : e.title) + '</span>'; }).join('') +
          (evs.length > 3 ? '<span class="more">+' + (evs.length - 3) + '</span>' : '') + '</button>';
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
    return '<a class="' + cls + '" href="#/e/' + e.id + '" style="--c:' + esc(o.color) + '"><span class="et">' + (showDay ? esc(dayLabel(dayKey(sMs(e)))) + '<br>' : '') + esc(evTime(e)) + '</span>' +
      '<span class="eb"><b>' + (e.all ? '<img class="tlogo" src="icons/team-mark.png" alt="">' + esc(e.title) : esc(evTitle(e))) + '</b><small>' + avatar(o, 'xs') + ' ' + esc(o.name) + (e.place && !e.busy ? ' · ' + esc(e.place) : '') + '</small>' + tag + '</span>' + w + '</a>';
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
        return '<a class="blk' + (e.busy ? ' busy' : '') + (faded(e, m.id) ? ' pend' : '') + (e.all ? ' team' : '') + '" href="#/e/' + e.id + '" style="left:' + l + '%;width:' + w + '%;--c:' + esc(o.color) + '" title="' + esc(evTime(e) + ' ' + evTitle(e)) + '">' + (invited(e, m.id) ? (ansOf(e)[m.id] === 'yes' ? '✅' : '⏳') : '') + (e.all ? rsvpMark(e, m.id) + '<img class="tlogo" src="icons/team-mark.png" alt="">' : '') + esc(e.busy ? 'Busy' : (e.all ? '' : T(e.type).emoji + ' ') + e.title) + '</a>';
      }).join('');
      var strips = allDay.slice(0, 2).map(function (e, i) {
        var o = mem(e.ownerId);
        return '<a class="adstrip' + (e.busy ? ' busy' : '') + (e.all ? ' team' : '') + (faded(e, m.id) ? ' pend' : '') + '" href="#/e/' + e.id + '" style="top:' + (2 + i * 15) + 'px;--c:' + esc(o.color) + '">' + (invited(e, m.id) ? (ansOf(e)[m.id] === 'yes' ? '✅' : '⏳') : '') + (e.all ? rsvpMark(e, m.id) + '<img class="tlogo" src="icons/team-mark.png" alt="">' : '') + esc(e.busy ? 'Busy (all day)' : 'All day · ' + e.title) + '</a>';
      }).join('') + (allDay.length > 2 ? '<span class="admore">+' + (allDay.length - 2) + '</span>' : '');
      var ad = Math.min(2, allDay.length);
      return '<div class="tr' + (ad ? ' ad' + ad : '') + '"><div class="tn">' + avatar(m, 'xs') + '<span>' + esc(m.id === my ? 'Me' : shortName(m)) + '</span></div><div class="tl">' + strips + blocks + '</div></div>';
    }).join('');
    var hours = ''; for (var h = H0; h < H1; h += 2) hours += '<span style="left:' + ((h - H0) / (H1 - H0) * 100) + '%">' + ((h % 12) || 12) + (h < 12 ? 'a' : 'p') + '</span>';
    var nowLine = isToday && now > a + H0 * 3600e3 && now < a + H1 * 3600e3 ? '<i class="now" style="left:calc(var(--nw) + (100% - var(--nw)) * ' + ((now - a - H0 * 3600e3) / span).toFixed(4) + ')"></i>' : '';
    return (isToday ? '<p class="freenow"><b>Free now:</b> ' + (freeNow.length ? freeNow.map(function (m) { return esc(m.id === my ? 'Me' : shortName(m)); }).join(', ') : 'nobody') + ' <span class="muted">· busy: ' + busyNow.length + '</span></p>' : '') +
      '<div class="team"><div class="tr th"><div class="tn"></div><div class="tl hours">' + hours + '</div></div><div class="rows">' + rows + nowLine + '</div></div>' +
      '<p class="tiny muted">Grey = private (busy, no details). Tap a block to see it. Blank = free.</p>';
  }

  /* ---------- event detail ---------- */
  function eventScreen(id) {
    var e = events().filter(function (x) { return x.id === id; })[0];
    if (!e) return topbar('Event', {back: '#/'}) + '<main><p class="empty">This event is not in the dates loaded, or it was deleted.</p></main>' + tabs('cal');
    var o = mem(e.ownerId), mine = e.ownerId === me().id;
    if (e.busy) return topbar('Busy', {back: '#/'}) + '<main><div class="card evhead" style="--c:' + esc(o.color) + '"><h2>🔒 Busy</h2><p>' + esc(dayLabel(dayKey(sMs(e)), true)) + '<br>' + esc(evTime(e)) + '</p><p>' + avatar(o, 'sm') + ' ' + esc(o.name) + '</p><p class="muted">This is private. Only ' + esc(shortName(o)) + ' can see the details.</p></div></main>' + tabs('cal');
    var thread = (S.data.msgs || []).filter(function (m) { return m.to === 'ev:' + e.id; });
    var cheers = thread.filter(function (m) { return m.kind === 'cheer'; }), comments = thread.filter(function (m) { return m.kind !== 'cheer' && m.kind !== 'rsvp'; });
    var iCheered = cheers.some(function (m) { return m.from === me().id; });
    var out = '';
    if (mine && isWork(e) && sMs(e) <= Date.now()) {
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
    return topbar(esc(T(e.type).label), {back: '#/', right: mine ? '<button class="icon-btn" data-act="edit" data-id="' + e.id + '" aria-label="Edit">✎</button>' : ''}) +
      '<main><div class="card evhead' + (e.all ? ' team' : '') + '" style="--c:' + esc(o.color) + '"><h2>' + (e.all ? '<img class="tlogo" src="icons/team-mark.png" alt="">' + esc(e.title) : esc(T(e.type).emoji + ' ' + e.title)) + '</h2>' +
      '<p>' + esc(dayLabel(dayKey(sMs(e)), true)) + (e.allDay && e.end !== e.start ? ' → ' + esc(dayLabel(String(e.end).slice(0, 10), true)) : '') + '<br>' + esc(evTime(e)) + '</p>' +
      (e.place ? '<p>📍 ' + esc(e.place) + '</p>' : '') +
      '<p>' + avatar(o, 'sm') + ' ' + esc(o.name) + ((e.with || []).length ? ' <span class="muted">with</span> ' + e.with.map(function (id) { return avatar(mem(id), 'sm') + ' ' + esc(shortName(mem(id))); }).join(' ') : '') + '</p>' +
      (e.notes ? '<p class="notes">' + esc(e.notes) + '</p>' : '') +
      '<p class="muted tiny">' + (e.all ? '👥 Whole-team event: on everyone\'s calendar.' : e.vis === 'private' ? '🔒 Only ' + (mine ? 'you' : shortName(o)) + (e.with.length ? ' and the people tagged' : '') + ' can see this. Others see "Busy".' + (isWork(e) ? ' It still counts in the activity numbers.' : '') : '👥 The whole team can see this.') + (e.type === 'approach' ? ' · ' + (e.count || 1) + ' new friend(s)' : '') + '</p></div>' +
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
  function teamEventsScreen() {
    var list = upcomingTeam(), my = me().id;
    return topbar('Team events', {back: '#/'}) + '<main><p class="tiny muted">Every upcoming whole-team event, next 3 months. Tap Going or Can\'t go any time; tap your answer again to clear it.</p>' + (list.length ? list.map(function (e) {
      var at = attendOf(e), mine = myAnswer(e), own = e.ownerId === my;
      return '<div class="card tev"><a class="tev-head" href="#/e/' + e.id + '"><img class="tlogo" src="icons/team-mark.png" alt=""><b>' + esc(e.title) + '</b><small>' + esc(dayLabel(dayKey(sMs(e)), true)) + ' · ' + esc(evTime(e)) + (e.place ? ' · 📍 ' + esc(e.place) : '') + '</small><small>by ' + esc(shortName(mem(e.ownerId))) + ' · ✅ ' + at.yes.length + ' going · ❌ ' + at.no.length + ' can\'t · ⏳ ' + at.none.length + ' no reply</small></a>' +
        '<div class="outs"><button class="out' + (mine === 'yes' ? ' on' : '') + '" data-act="rsvp" data-id="' + e.id + '" data-v="' + (mine === 'yes' ? '' : 'yes') + '">✅ Going</button><button class="out grey' + (mine === 'no' ? ' on' : '') + '" data-act="rsvp" data-id="' + e.id + '" data-v="' + (mine === 'no' ? '' : 'no') + '">❌ Can\'t go</button></div>' +
        (!mine && !own ? '<p class="tiny warn-t">You haven\'t answered yet.</p>' : own && !mine ? '<p class="tiny muted">You created this one.</p>' : '') + '</div>';
    }).join('') : '<p class="empty">No upcoming team events.</p>') + '</main>' + tabs('cal');
  }
  function invitesScreen() {
    var list = myInvites();
    return topbar('Invitations', {back: '#/'}) + '<main>' + (list.length ? list.map(function (e) {
      var o = mem(e.ownerId);
      return '<div class="card cf" style="--c:' + esc(o.color) + '"><a href="#/e/' + e.id + '"><b>' + esc(T(e.type).emoji + ' ' + e.title) + '</b><small class="muted">' + esc(dayLabel(dayKey(sMs(e)))) + ' · ' + esc(evTime(e)) + (e.place ? ' · ' + esc(e.place) : '') + '<br>from ' + esc(o.name) + '</small></a><div class="outs"><button class="out" data-act="invite" data-id="' + e.id + '" data-v="yes">✅ Accept</button><button class="out grey" data-act="invite" data-id="' + e.id + '" data-v="no">❌ Reject</button></div></div>';
    }).join('') : '<p class="empty">No invitations waiting. 👍</p>') + '</main>' + tabs('cal');
  }
  /* whole-team event: Going / Can't go / No reply, with names */
  function attendOf(e) { var a = ansOf(e), o = {yes: [], no: [], none: []}; members().forEach(function (m) { if (m.active === false) return; o[a[m.id] === 'yes' ? 'yes' : a[m.id] === 'no' ? 'no' : 'none'].push(m.id); }); return o; }
  function myAnswer(e) { var at = attendOf(e), my = me().id; return at.yes.indexOf(my) >= 0 ? 'yes' : at.no.indexOf(my) >= 0 ? 'no' : ''; }
  function attendCard(e) {
    var at = attendOf(e), mine = myAnswer(e), open = eMs(e) > Date.now() && e.out !== 'cancel';
    var names = function (ids) { return ids.length ? ids.map(function (id) { return '<span class="who">' + avatar(mem(id), 'xs') + esc(id === me().id ? 'Me' : shortName(mem(id))) + '</span>'; }).join('') : '<span class="muted tiny">nobody</span>'; };
    return '<div class="card attend"><h4>Attendance</h4>' +
      (open ? '<div class="outs"><button class="out' + (mine === 'yes' ? ' on' : '') + '" data-act="rsvp" data-id="' + e.id + '" data-v="' + (mine === 'yes' ? '' : 'yes') + '">✅ Going</button><button class="out grey' + (mine === 'no' ? ' on' : '') + '" data-act="rsvp" data-id="' + e.id + '" data-v="' + (mine === 'no' ? '' : 'no') + '">❌ Can\'t go</button></div>' + (!mine ? '<p class="tiny warn-t">You haven\'t answered yet.</p>' : '') : '') +
      '<div class="alist"><b>✅ Going (' + at.yes.length + ')</b>' + names(at.yes) + '</div>' +
      '<div class="alist"><b>❌ Can\'t go (' + at.no.length + ')</b>' + names(at.no) + '</div>' +
      '<div class="alist"><b>⏳ No reply (' + at.none.length + ')</b>' + names(at.none) + '</div>' +
      '<p class="tiny muted">🔔 Everyone gets a pop-up 1 hour before.</p></div>';
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
  function editor(e) {
    var isNew = !e, now = Date.now(), k = S.sel || dayKey(now);
    if (isNew) {
      var startH = k === dayKey(now) ? Math.min(21, P(now).h + 1) : 10;
      e = {all: false, title: '', type: '', start: new Date(keyMs(k) + startH * 3600e3).toISOString(), end: new Date(keyMs(k) + (startH + 1) * 3600e3).toISOString(), allDay: false, place: '', notes: '', vis: 'team', with: [], remind: '30', count: 1};
    }
    var picked = !isNew;
    var html = '<form id="ed" class="editor"><div class="row between"><h3>' + (isNew ? 'New event' : 'Edit event') + '</h3><button type="button" class="icon-btn" data-act="close-modal" aria-label="Close">✕</button></div>' +
      '<input name="title" class="title-in" maxlength="120" placeholder="What? e.g. Present Mr Lim medical card" value="' + esc(e.title) + '" required>' +
      '<p class="detect tiny muted" id="detect"></p>' +
      '<div class="types">' + C.TYPE_ORDER.map(function (t) { return '<button type="button" class="tp' + (e.type === t ? ' on' : '') + '" data-t="' + t + '">' + T(t).emoji + ' ' + esc(T(t).label.replace(/ \(.*\)/, '')) + '</button>'; }).join('') + '</div>' +
      '<div class="count-row" ' + (e.type === 'approach' ? '' : 'hidden') + '><label>How many new friends?<input name="count" type="number" min="1" max="999" value="' + (e.count || 1) + '"></label></div>' +
      '<label class="switch"><input type="checkbox" name="allDay"' + (e.allDay ? ' checked' : '') + '> All day</label>' +
      '<div class="two"><label>Date<input name="date" type="date" value="' + dayKey(sMs(e)) + '" required></label>' +
      '<label class="t-only">Start<input name="st" type="time" value="' + (e.allDay ? '10:00' : hm24(sMs(e))) + '"></label><label class="t-only">End<input name="et" type="time" value="' + (e.allDay ? '11:00' : hm24(eMs(e))) + '"></label>' +
      '<label class="d-only">Until<input name="date2" type="date" value="' + (e.allDay ? String(e.end || e.start).slice(0, 10) : dayKey(sMs(e))) + '"></label></div>' +
      '<label>Where<input name="place" maxlength="120" value="' + esc(e.place) + '" placeholder="optional"></label>' +
      '<label>Notes<textarea name="notes" maxlength="1500" rows="2" placeholder="optional. Use client initials, not full details">' + esc(e.notes) + '</textarea></label>' +
      '<div class="lbl">Who can see it?</div><div class="vis"><button type="button" class="vb' + (e.vis !== 'private' ? ' on' : '') + '" data-v="team">👥 Team</button><button type="button" class="vb' + (e.vis === 'private' ? ' on' : '') + '" data-v="private">🔒 Only me</button></div>' +
      '<p class="tiny muted" id="vis-help"></p>' +
      '<label class="switch" id="all-row"><input type="checkbox" name="all"' + (e.all ? ' checked' : '') + '> 👥 Everyone\'s in it (team meeting, training, roadshow)</label><p class="tiny muted" id="all-help">Shows on every member\'s calendar. Everyone answers Going / Can\'t go, gets a pop-up for comments, and a reminder 1 hour before.</p>' +
      '<div class="lbl" id="inv-lbl">Invite (optional): they accept or reject</div><div class="withpick">' + members().filter(function (m) { return m.id !== me().id && m.active !== false; }).map(function (m) { return '<button type="button" class="wp' + ((e.with || []).indexOf(m.id) >= 0 ? ' on' : '') + '" data-id="' + m.id + '">' + avatar(m, 'xs') + esc(shortName(m)) + '</button>'; }).join('') + '</div>' +
      '<label>Remind me<select name="remind">' + [['', 'No reminder'], ['0', 'At start'], ['10', '10 min before'], ['30', '30 min before'], ['60', '1 hour before'], ['120', '2 hours before'], ['1440', '1 day before']].map(function (r) { return '<option value="' + r[0] + '"' + (String(e.remind) === r[0] ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('') + '</select></label>' +
      '<div class="row end sticky-actions">' + (!isNew ? '<button type="button" class="btn danger ghost" data-x="del">Delete</button>' : '') + '<button class="btn primary big" type="submit">' + (isNew ? 'Add to calendar' : 'Save') + '</button></div></form>';
    modal(html, function (sh) {
      var f = sh.querySelector('#ed'), type = e.type, vis = e.vis === 'private' ? 'private' : 'team', visPicked = !isNew, withIds = (e.with || []).slice();
      function paint() {
        sh.querySelectorAll('.tp').forEach(function (b) { b.classList.toggle('on', b.dataset.t === type); });
        sh.querySelectorAll('.vb').forEach(function (b) { b.classList.toggle('on', b.dataset.v === vis); });
        sh.querySelector('.count-row').hidden = type !== 'approach';
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
      f.allDay.onchange = paint; f.all.onchange = paint;
      f.st.addEventListener('change', function () { var s = f.st.value.split(':'), en = f.et.value.split(':'); if (f.et.value <= f.st.value) f.et.value = pad(Math.min(23, +s[0] + 1)) + ':' + s[1]; });
      paint(); if (isNew) setTimeout(function () { f.title.focus(); }, 50);
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
        var ev2 = {id: e.id, title: f.title.value, type: type, allDay: ad, place: f.place.value, notes: f.notes.value, vis: vis, all: vis !== 'private' && f.all.checked, with: withIds, remind: f.remind.value, count: f.count.value, source: e.source || 'manual'};
        if (ad) { ev2.start = d; ev2.end = f.date2.value && f.date2.value >= d ? f.date2.value : d; }
        else {
          if (!f.st.value) return toast('Please pick a start time.', 'bad');
          ev2.start = new Date(d + 'T' + f.st.value + ':00+08:00').toISOString();
          var en = f.et.value ? Date.parse(d + 'T' + f.et.value + ':00+08:00') : 0; if (!en || en <= Date.parse(ev2.start)) en = Date.parse(ev2.start) + 3600e3;
          ev2.end = new Date(en).toISOString();
        }
        var tmpId = isNew ? 'tmp' + Date.now() : e.id;
        var view = {id: tmpId, ownerId: isNew ? me().id : e.ownerId, title: ev2.title.trim(), type: type, start: ev2.start, end: ev2.end, allDay: ad, place: ev2.place, notes: ev2.notes, vis: vis, all: !!ev2.all, with: withIds.slice(), remind: ev2.remind, count: type === 'approach' ? (+ev2.count || 1) : 0, out: isNew ? '' : e.out, anp: isNew ? 0 : e.anp, noc: isNew ? 0 : e.noc, cases: isNew ? [] : (e.cases || []), source: ev2.source};
        closeModal(); S.sel = dayKey(sMs(view));
        if (!isNew) location.hash = '#/e/' + e.id;
        optimistic(function (d) { if (isNew) d.events.push(view); else d.events = d.events.map(function (x) { return x.id === e.id ? Object.assign({}, x, view) : x; }); }, 'save', {event: ev2}, isNew ? 'Added 📅' : 'Saved',
          function (j) { S.data.events = S.data.events.map(function (x) { return x.id === tmpId ? j.event : x; }); if (location.hash === '#/e/' + tmpId) location.hash = '#/e/' + j.event.id; })
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
        return '<div class="card cf" style="--c:' + esc(me().color) + '"><div><b>' + esc(T(e.type).emoji + ' ' + e.title) + '</b><small class="muted">' + esc(dayLabel(dayKey(sMs(e)))) + ' · ' + esc(evTime(e)) + '</small></div><div class="outs">' +
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
    var html = topbar('Activity') + '<main class="stats">' + seg +
      '<div class="card"><h4>My ' + esc(/^(This|Last) /.test(d.r.label) ? d.r.label.toLowerCase() : d.r.label) + '</h4><div class="funnel">' + funnel.map(function (f) { return '<div class="fr"><span class="fl"><b>' + f[0] + '</b> ' + f[1] + '</span><span class="fb"><i style="width:' + (f[2] / top * 100) + '%"></i></span><b class="fv">' + f[2] + '</b></div>'; }).join('') + '</div>' +
      '<div class="kpis">' + kpi('O/A', pct(r.OA), 'prospecting') + kpi('P/O', pct(r.PO), 'presentation') + kpi('F/P', pct(r.FP), 'follow-up') + kpi('NOC/P', pct(r.CP), 'closing') + '</div>' + ratioNote(r) +
      '<div class="mae"><div><small>Market</small><b>' + (r.M == null ? '–' : rm(r.M)) + '</b><span>avg case size</span></div><div><small>Activity</small><b>' + mine.P + '</b><span>presentations</span></div><div><small>Efficiency</small><b>' + pct(r.E) + '</b><span>closing ratio</span></div></div>' +
      '<p class="anp">ANP <b>' + rm(mine.anp) + '</b> from ' + mine.C + ' case' + (mine.C === 1 ? '' : 's') + (mine.C > mine.anpCases ? ' <span class="warn-t">(' + (mine.C - mine.anpCases) + ' without ANP yet)</span>' : '') + '</p>' +
      '<p class="others">🌱 Recruit ' + mine.recruit + ' · 👥 Meetings ' + mine.meeting + ' · 🛠️ Service ' + mine.service + ' · 🎁 CRM ' + mine.crm + ' · 📝 Paperwork ' + mine.paperwork + '</p>' +
      (mine.unconfirmed ? '<a class="confirm-bar" href="#/confirm">⚠️ ' + mine.unconfirmed + ' past activit' + (mine.unconfirmed > 1 ? 'ies are' : 'y is') + ' not confirmed, so not counted <span>›</span></a>' : '') + '</div>';
    var ms = members().filter(function (m) { return m.active !== false; });
    var rows = ms.map(function (m) { return {m: m, s: by[m.id] || C.addStats([])}; });
    rows.sort(function (a, b) { return (b.s.P + b.s.C * 2 + b.s.O + b.s.F) - (a.s.P + a.s.C * 2 + a.s.O + a.s.F) || b.s.A - a.s.A; });
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
    html += '</tbody></table></div></div>';
    var cl = closeList(d.events, d.r);
    html += '<div class="card"><div class="row between"><h4>Close case list</h4>' + (cl.lines.length ? '<button class="btn tiny primary" data-act="copy-close">📋 Copy</button>' : '') + '</div>' +
      (cl.lines.length ? '<pre class="closelist">' + esc(cl.text) + '</pre>' : '<p class="empty small">No closed cases yet in ' + esc(d.r.label.toLowerCase()) + '.</p>') + '</div>';
    if (lead) {
      var quiet = rows.filter(function (x) { return x.m.role !== 'leader' && !d.events.some(function (e) { return e.ownerId === x.m.id && SELLING[e.type || e.t] && (e.out === 'done' || e.out === 'closed') && Date.now() - sMs(e) < 5 * DAY; }); });
      html += '<div class="card"><h4>Needs a check-in</h4><p class="tiny muted">No confirmed approach, open, present, follow-up, close or recruitment in the last 5 days.</p>' + (quiet.length ? quiet.map(function (x) { return '<div class="thread small">' + avatar(x.m, 'sm') + '<span class="tb"><b>' + esc(x.m.name) + '</b><small>' + x.s.unconfirmed + ' not confirmed</small></span></div>'; }).join('') : '<p class="empty small">Everyone is active 👍</p>') +
        '<div class="row"><button class="btn primary" data-act="report">📋 Copy WhatsApp report</button><button class="btn ghost" data-act="csv">⬇ CSV</button></div></div>';
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
  function kpi(k, v, l) { return '<div class="kpi"><small>' + k + '</small><b>' + v + '</b><span>' + l + '</span></div>'; }
  function reportRows() {
    var d = statsData(S.statsPeriod); if (!d.events) return null;
    var by = C.stats(d.events, d.r.from, d.r.to, Date.now());
    return {d: d, rows: members().filter(function (m) { return m.active !== false; }).map(function (m) { return {m: m, s: by[m.id] || C.addStats([])}; }).sort(function (a, b) { return b.s.anp - a.s.anp || b.s.P - a.s.P; })};
  }
  function copyReport() {
    var x = reportRows(); if (!x) return;
    var tot = C.addStats(x.rows.map(function (r) { return r.s; })), tq = C.ratios(tot);
    var lines = ['*REDEFINE activity · ' + x.d.r.label + '*', '*Team total: ' + actTotal(tot) + ' activities · NOC ' + tot.C + ' · ANP ' + rm(tot.anp) + '*', 'A ' + tot.A + ' · O ' + tot.O + ' · P ' + tot.P + ' · F ' + tot.F + ' · R ' + tot.recruit, 'Closing ' + pct(tq.CP) + ' · Avg case ' + (tq.M == null ? '–' : rm(tq.M)), ''];
    x.rows.forEach(function (r, i) { var s = r.s; lines.push((i + 1) + '. ' + r.m.name + ': A' + s.A + ' O' + s.O + ' P' + s.P + ' F' + s.F + ' R' + s.recruit + ' = ' + actTotal(s) + ' · NOC ' + s.C + (s.anp ? ' · ' + rm(s.anp) : '') + (s.unconfirmed ? ' · ⚠️' + s.unconfirmed + ' unconfirmed' : '')); });
    lines.push('', 'Confirmed activities only. Keep your calendar updated 💪');
    var text = lines.join('\n');
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { toast('Report copied. Paste it in WhatsApp.', 'good'); }, function () { modal('<h3>Copy this</h3><textarea rows="12" style="width:100%">' + esc(text) + '</textarea><div class="row end"><button class="btn" data-act="close-modal">Done</button></div>'); });
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
      '<div class="card"><h4>My colour</h4><div class="colors">' + C.COLORS.map(function (c) { return '<button class="col' + (c === m.color ? ' on' : '') + '" style="background:' + c + '" data-act="color" data-c="' + c + '" aria-label="colour ' + c + '"></button>'; }).join('') + '</div></div>' +
      '<div class="card"><h4>Notifications</h4>' + push + '</div>' +
      partnerCard() +
      '<div class="card"><h4>Move my calendar here</h4><p class="muted">Google Calendar, TimeTree, iPhone, or a paper diary: snap photos or screenshots and the AI copies them in. You check every row first.</p><a class="btn primary" href="#/import">⤓ Import calendar</a></div>' +
      (!standalone() ? '<div class="card"><h4>Install</h4><p class="muted">Add REDEFINE Calendar to your home screen so it opens like an app.</p><button class="btn ghost" data-act="install">How?</button></div>' : '') +
      (m.leader ? '<div class="card"><h4>Leader</h4><a class="btn ghost" href="#/members">👥 Manage members</a></div>' : '') +
      '<div class="card"><h4>How counting works</h4><p class="tiny muted">Each event has a type (👋 Approach, ☕ Open, 📊 Present, 🔁 Follow-up, ✍️ Closing, 🌱 Recruit, 👥 Meeting, 🛠️ Service, 🎁 CRM, 📝 Paperwork, 🏠 Personal). The app guesses it from the title. After the event, tap ✓ Done, 💰 Closed (with ANP) or ✕ Didn\'t happen. Only confirmed events count. O/A = prospecting, P/O = presentation, F/P = follow-up, NOC/P = closing ratio. Personal events never count.</p></div>' +
      '<p class="center tiny muted">App version ' + APP_VERSION + ' · ' + (isIOS() ? 'iPhone' : 'Android / other') + (standalone() ? ' · home-screen app' : ' · browser') + ' · notifications: ' + ('Notification' in window ? Notification.permission : 'not supported') + ' · server has ' + (me().devices || 0) + ' phone(s) for you</p>' +
      '<p class="center"><button class="link danger" data-act="signout">Sign out of this phone</button></p></main>' + tabs('me');
  }
  function membersScreen() {
    if (!isLeader()) return topbar('Members', {back: '#/me'}) + '<main><p class="empty">Leaders only.</p></main>';
    return topbar('Members', {back: '#/me'}) + '<main><p class="muted">Members join by signing in with the team code. Removing someone signs them out everywhere; their events stay.</p>' +
      members().map(function (m) {
        var you = m.id === me().id;
        return '<div class="card mrow' + (m.active === false ? ' off' : '') + '">' + avatar(m, 'sm') + '<div class="grow"><b>' + esc(m.name) + '</b><small class="muted">' + (m.role === 'leader' ? '⭐ Leader' : 'Agent') + (m.active === false ? ' · removed' : '') + ' · last seen ' + (m.seen ? ago(m.seen) : 'never') + '</small></div>' +
          (you ? '<small class="muted">you</small>' : m.active === false ? '<button class="btn tiny ghost" data-act="mem" data-id="' + m.id + '" data-do="back">Bring back</button>'
            : '<button class="btn tiny ghost" data-act="mem" data-id="' + m.id + '" data-do="' + (m.role === 'leader' ? 'agent' : 'leader') + '">' + (m.role === 'leader' ? 'Make agent' : 'Make leader') + '</button><button class="btn tiny danger ghost" data-act="mem" data-id="' + m.id + '" data-do="remove">Remove</button>') + '</div>';
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
    if (!S.token) { $app.innerHTML = signInScreen(); return; }
    if (!S.data) { $app.innerHTML = topbar('REDEFINE Calendar') + '<main><p class="empty">Loading your team…</p></main>'; return; }
    var r = route(), parts = r.split('/').filter(Boolean), html;
    var active = document.activeElement, typing = active && /INPUT|TEXTAREA|SELECT/.test(active.tagName) && $app.contains(active);
    if (typing && r === lastRoute) {   // don't wipe what someone is typing: only refresh the live lists
      var live = $app.querySelector('[data-live]');
      if (live && live.dataset.live === 'comments') live.innerHTML = commentList((S.data.msgs || []).filter(function (m) { return m.to === 'ev:' + parts[1] && m.kind !== 'cheer' && m.kind !== 'rsvp'; }));
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
    else html = calendarScreen();
    var y = r === lastRoute ? window.scrollY : 0;
    $app.innerHTML = html; lastRoute = r;
    window.scrollTo(0, y);
    if (parts[0] === 'e' && parts[2] === 'c' && y === 0) { var cm = $app.querySelector('.comments'); if (cm) setTimeout(function () { cm.scrollIntoView({block: 'start'}); }, 30); }
  }

  /* ---------- taps ---------- */
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-act]'); if (!b || b.tagName === 'FORM' || b.tagName === 'INPUT') return;
    var a = b.dataset.act, today = dayKey(Date.now());
    if (a === 'close-modal') return closeModal();
    if (a === 'filter' && b.dataset.id === 'pick') return pickMerge();
    if (a === 'filter') { S.filter = b.dataset.id; LS.set('filter', S.filter); return render(); }
    if (a === 'merge-keep') { var mk = LS.get('merges', []); if (mk.indexOf(b.dataset.id) < 0) mk.push(b.dataset.id); LS.set('merges', mk.slice(-6)); toast('Kept. It stays on your chips.', 'good'); return render(); }
    if (a === 'merge-x') { LS.set('merges', LS.get('merges', []).filter(function (x) { return x !== b.dataset.id; })); if (S.filter === 'me+' + b.dataset.id) { S.filter = 'me'; LS.set('filter', 'me'); } return render(); }
    if (a === 'merge') { closeModal(); S.filter = 'me+' + b.dataset.id; LS.set('filter', S.filter); return render(); }
    if (a === 'partner') {
      var pa = b.dataset.do, pid = b.dataset.id || (document.getElementById('ptn') || {}).value;
      if (pa === 'request' && !pid) return toast('Pick your partner first.', 'bad');
      var pmsg = {request: 'Send a link request to ' + mem(pid).name + '? Once they accept, you both see each other\'s private events.', accept: 'Link calendars with ' + mem(pid).name + '? You will both see each other\'s private events.', unlink: 'Unlink from ' + mem(me().partner).name + '? Your private events become private again for both of you.'}[pa];
      var go = function () { return send('partner', {action: pa, id: pid}, {request: 'Request sent 💌', accept: 'Linked 💑', decline: 'Declined', cancel: 'Request cancelled', unlink: 'Unlinked'}[pa]); };
      return pmsg ? confirmBox('Partner calendar', pmsg, pa === 'unlink' ? 'Unlink' : 'Yes', pa === 'unlink').then(function (y) { if (y) go(); }) : go();
    }
    if (a === 'view') { S.view = b.dataset.v; LS.set('view', S.view); if (S.view === 'day' && !S.dayView) S.dayView = S.sel || today; return render(); }
    if (a === 'sel') { S.sel = b.dataset.k; var p = P(keyMs(S.sel)); if (p.m !== S.cursor.m) { S.cursor = {y: p.y, m: p.m}; quietSync(); } return render(); }
    if (a === 'month') { var c = S.cursor, m = c.m + +b.dataset.d; S.cursor = {y: c.y + Math.floor(m / 12), m: (m + 12) % 12}; S.sel = dayKey(Date.UTC(S.cursor.y, S.cursor.m, 1) - H8 + 3600e3); render(); return quietSync(); }
    if (a === 'day') { S.dayView = addDays(S.dayView, +b.dataset.d); S.sel = S.dayView; var q = P(keyMs(S.dayView)); if (q.m !== S.cursor.m) { S.cursor = {y: q.y, m: q.m}; quietSync(); } return render(); }
    if (a === 'today') { var t = P(Date.now()); S.cursor = {y: t.y, m: t.m}; S.sel = today; S.dayView = today; render(); return quietSync(); }
    if (a === 'new') return editor(null);
    if ((a === 'edit' || a === 'out' || a === 'cheer' || a === 'invite' || a === 'rsvp') && /^tmp/.test(b.dataset.id || '')) return toast('Still saving… one moment.');
    if (a === 'edit') return editor(events().filter(function (e) { return e.id === b.dataset.id; })[0]);
    if (a === 'out') return setOutcome(b.dataset.id, b.dataset.v);
    if (a === 'cheer') return send('send', {to: 'ev:' + b.dataset.id, kind: 'cheer'});
    if (a === 'invite') {
      var iv = b.dataset.v, go = function () { return send('rsvp', {id: b.dataset.id, answer: iv}, iv === 'yes' ? '✅ Accepted. It is on your calendar.' : 'Rejected. Removed from your calendar.'); };
      return iv === 'no' ? confirmBox('Reject this invitation?', 'It will disappear from your calendar and the owner will be told. You can still accept later from the event link.', 'Reject', true).then(function (y) { if (y) go(); }) : go();
    }
    if (a === 'rsvp') return send('rsvp', {id: b.dataset.id, answer: b.dataset.v}, b.dataset.v === 'yes' ? '✅ See you there!' : b.dataset.v === 'no' ? 'Noted: can\'t go' : 'Answer cleared');
    if (a === 'period') { S.statsPeriod = b.dataset.p; LS.set('statsPeriod', S.statsPeriod); return render(); }
    if (a === 'report') return copyReport();
    if (a === 'csv') return downloadCsv();
    if (a === 'copy-close') { var dd = statsData(S.statsPeriod); if (!dd.events) return; var txt = closeList(dd.events, dd.r).text; return (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { toast('Close case list copied. Paste it in WhatsApp.', 'good'); }, function () { modal('<h3>Copy this</h3><textarea rows="12" style="width:100%">' + esc(txt) + '</textarea><div class="row end"><button class="btn" data-act="close-modal">Done</button></div>'); }); }
    if (a === 'push') return enablePush();
    if (a === 'pushfix') return repairPush(true).then(render);
    if (a === 'pushtest15') { toast('Lock your phone now. A pop-up should arrive in about 15 seconds.'); return api('pushtest', {delay: 15}).catch(function () {}); }
    if (a === 'pushtest') return api('pushtest').then(function () { toast('Sent. It should pop up in a few seconds.'); }, function (e) { toast(errText(e), 'bad'); });
    if (a === 'pushoff') return api('pushoff', {pushToken: LS.get('pushToken', '')}).then(function () { LS.del('pushToken'); toast('Pop-ups off for this phone'); render(); });
    if (a === 'install') return modal(installHelp(false));
    if (a === 'color') return send('profile', {color: b.dataset.c});
    if (a === 'short') { var sv = (document.getElementById('shortin') || {}).value || ''; if (!sv.trim()) return toast('Type a short name first.', 'bad'); return send('profile', {short: sv.trim()}, 'Saved: the team now sees you as ' + sv.trim()); }
    if (a === 'signout') return confirmBox('Sign out?', 'You will need the team code, your name and PIN to sign in again on this phone.', 'Sign out', true).then(function (y) { if (y) api('signout', {pushToken: LS.get('pushToken', '')}).catch(function () {}).then(function () { signOutLocal(); }); });
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
    checkReminders();
  }, 3000);
  window.RCAL = {S: S, sync: sync, render: render};   // for testing in the browser console
})();
