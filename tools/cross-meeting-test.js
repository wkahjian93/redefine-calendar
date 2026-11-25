// Cross-app check: REAL REDEFINE Meeting App rules <-> REAL REDEFINE Calendar rules, both in memory, nothing sent anywhere.
// Run from this folder: node tools/cross-meeting-test.js   (needs ../90Days Kick Start next to this folder)
const path = require('path');
const CAL = require('../docs/core.js'), calStore = require('./memstore.js');
const MS_DIR = path.join(__dirname, '..', '..', '90Days Kick Start', 'docs');
Object.assign(global, require(path.join(MS_DIR, 'syllabus.js')));
global.KS = require(path.join(MS_DIR, 'logic.js'));
const MS = require(path.join(MS_DIR, 'core.js'));
global.CORE = MS; require(path.join(MS_DIR, 'minutes.js'));   // mini mini plugs into the Meeting App rules
let pass = 0, failN = 0;
const ok = (c, m) => { if (c) pass++; else { failN++; console.log('FAIL: ' + m); } };

// Meeting App in memory
let msNow = new Date('2026-11-25T02:00:00Z'), seq = 7;
const db = {agents: [], progress: [], activity: [], settings: [{key: 'leaderName', value: 'Kah Jian'}, {key: 'appUrl', value: 'https://example.test/meeting/'}], log: [], syllabus: [], appts: []};
const msStore = {
  load: t => JSON.parse(JSON.stringify(db[t] || [])), save: (t, r) => { db[t] = JSON.parse(JSON.stringify(r)); },
  withLock: fn => fn(), prop: k => k === 'LEADER_CODE' ? 'leader-secret-123' : '', fails: () => 0, now: () => msNow,
  random: () => ((seq = (seq * 9301 + 49297) % 233280) / 233280), hash: v => require('crypto').createHash('sha256').update(v).digest('hex'),
  putFile: () => ({id: 'x', url: ''}), getFile: () => null, trashFile: () => {}, mail: () => {}
};
const ms = q => MS.handle(q, msStore), L = 'leader-secret-123';

// Calendar in memory, calling the Meeting App server
const cs = calStore({now: () => Date.parse('2026-11-25T02:00:00Z')});
cs.setNow('2026-11-25T02:00:00Z');
const cal = q => CAL.handle(q, cs);
cs.fetchJson = (url, body) => { try { return MS.handle(body, msStore); } catch (e) { return {error: e.appCode || 'server_error'}; } };
const person = name => ({token: cal({op: 'signin', create: true, code: 'test-team', name, pin: '1234'}).token});
const GMc = person('Wong Kah Jian'), AGc = person('Yi Ting (cal)'), INc = person('Senior Sam (cal)'), OTc = person('Other person');
const idOf = tok => cal(Object.assign({op: 'sync'}, tok)).me.id;
const evOf = tok => { const id = idOf(tok); return (cs.tables.events || []).filter(e => e.ownerId === id && /^ms:/.test(e.source)); };

// Meeting App people: introducer Sam, trainee Yi Ting (introduced by Sam)
const sam = ms({op: 'addAgent', code: L, name: 'Senior Sam', kind: 'introducer'}).agent;
const yt = ms({op: 'addAgent', code: sam.code, name: 'Yi Ting', start: '2026-11-04'}).agent;

// everyone connects once (the link each one opens in the Meeting App)
const codeFrom = url => decodeURIComponent(/code=([^&]+)/.exec(url)[1]);
const lg = cal(Object.assign({op: 'mslink', code: codeFrom(ms({op: 'calCode', code: L}).url)}, GMc));
ok(lg.linked && lg.name === 'Kah Jian', 'GM calendar connected (' + JSON.stringify(lg) + ')');
cal(Object.assign({op: 'mslink', code: codeFrom(ms({op: 'calCode', code: yt.code}).url)}, AGc));
cal(Object.assign({op: 'mslink', code: codeFrom(ms({op: 'calCode', code: sam.code}).url)}, INc));
ok(cal(Object.assign({op: 'sync'}, AGc)).me.msLinked === true, 'calendar app knows it is connected');
ok(evOf(GMc).length === 0 && evOf(AGc).length === 0, 'nothing yet: no appointments');

// 1) the agent sets Week 4 with a time -> GM, agent and introducer all get it on the next collect
ms({op: 'appt', code: yt.code, wk: 4, date: '2026-11-27', time: '20:00', note: 'SG FARLIM'});
const r = CAL.msCollectAll(cs);
ok(r.members === 3 && r.changed === 3, 'one collect updates 3 connected people (' + JSON.stringify(r) + ')');
const g = evOf(GMc)[0], a = evOf(AGc)[0], s = evOf(INc)[0];
ok(g && a && s, 'GM, agent and introducer each have the event');
ok(a.title === '🎓 Kick Start Week 4 with Kah Jian' && g.title === '🎓 Yi Ting · Kick Start Week 4', 'titles: "' + a.title + '" / "' + g.title + '"');
ok(a.type === 'meeting' && a.vis === 'private' && a.start === '2026-11-27T12:00:00.000Z' && a.end === '2026-11-27T13:00:00.000Z' && a.remind === '30', 'Fri 27 Nov 8pm MYT, 1 hour, Meeting / training, private, reminder 30 min');
ok(/SG FARLIM/.test(a.notes) && /set by Yi Ting/.test(a.notes) && /example\.test\/meeting/.test(a.notes), 'notes carry the note, who set it and the app link');
ok(evOf(OTc).length === 0, 'someone not connected gets nothing');
ok(cs.pushes.some(p => p.ids.includes(idOf(GMc)) && /New Kick Start appointment/.test(p.note.title)), 'pop-up: new Kick Start appointment');
const st = CAL.stats(cs.tables.events.map(e => Object.assign({}, e)), Date.parse('2026-11-01T00:00:00+08:00'), Date.parse('2026-12-01T00:00:00+08:00'), cs.now().getTime());
ok(Object.values(st).every(x => !x.A && !x.O && !x.P), 'does not count in A/O/P');

// 2) the GM moves it to Saturday, no time -> all-day, same event updated (not a second one)
ms({op: 'appt', code: L, agentId: yt.id, wk: 4, date: '2026-11-28'});
cal(Object.assign({op: 'mspull'}, AGc));
ok(evOf(AGc).length === 1 && evOf(AGc)[0].allDay === 'true' && evOf(AGc)[0].start === '2026-11-28' && evOf(AGc)[0].id === a.id, 'moved: same event, now all-day Sat 28 Nov');
ok(/set by Leader/.test(evOf(AGc)[0].notes), 'shows the GM set it');
CAL.msCollectAll(cs);
ok(evOf(GMc)[0].start === '2026-11-28' && evOf(INc)[0].start === '2026-11-28', 'GM and introducer moved too');

// 3) a second week, then the first is cleared -> only the cleared one goes
ms({op: 'appt', code: yt.code, wk: 5, date: '2026-12-03', time: '10:30'});
CAL.msCollectAll(cs);
ok(evOf(AGc).length === 2, 'two weeks booked');
ms({op: 'appt', code: yt.code, wk: 4, clear: true});
CAL.msCollectAll(cs);
ok(evOf(AGc).length === 1 && /Week 5/.test(evOf(AGc)[0].title) && evOf(GMc).length === 1, 'cleared Week 4 is taken off everyone; Week 5 stays');

// 4) past events stay when they drop out of the feed
cs.setNow('2027-01-10T02:00:00Z'); msNow = new Date('2027-01-10T02:00:00Z');
CAL.msCollectAll(cs);
ok(evOf(AGc).length === 1, 'past appointment kept as history');
cs.setNow('2026-11-25T02:00:00Z'); msNow = new Date('2026-11-25T02:00:00Z');

// 5) a cancelled event here is left alone
const w5 = cs.tables.events.find(e => e.ownerId === idOf(AGc) && /Week 5/.test(e.title)); w5.out = 'cancel';
ms({op: 'appt', code: yt.code, wk: 5, date: '2026-12-04', time: '10:30'});
CAL.msCollectAll(cs);
ok(cs.tables.events.find(e => e.id === w5.id).start === '2026-12-03T02:30:00.000Z', 'cancelled here: not moved back in');

// 6) new link in the Meeting App -> old calendar connection drops itself and its future events
ms({op: 'calCode', code: yt.code, reset: true});
CAL.msCollectAll(cs);
ok(cal(Object.assign({op: 'sync'}, AGc)).me.msLinked === false, 'old link stops: calendar disconnected');
ok(evOf(GMc).length === 1, 'GM still connected');

// 7) disconnect from the calendar side takes off what is ahead
cal(Object.assign({op: 'msunlink'}, INc));
ok(evOf(INc).length === 0 && cal(Object.assign({op: 'sync'}, INc)).me.msLinked === false, 'disconnect: introducer\'s future Kick Start events removed');

// 7b) mini mini: the next meeting from approved minutes goes to the GM and the people in the meeting
Object.assign(msStore, {getFile: () => ({b64: 'QUFBQQ=='}), transcribe: () => ({text: '下次开会下个星期一晚上八点。'}), chat: () => ({title: '周会', summary: ['a'], people: [], next_meeting: {date: '2026-11-30', time: '20:00', note: ''}})});
const mt = ms({op: 'mtStart', code: L, title: 'Monday meeting', consent: true, people: [{id: yt.id}]}).meeting;
ms({op: 'mtPart', code: L, id: mt.id, n: 0, mime: 'audio/webm', secs: 60, b64: 'QUFBQQ=='});
ms({op: 'mtFinish', code: L, id: mt.id, parts: 1, secs: 60});
ms({op: 'mtProcess', code: L, id: mt.id});
const sm = ms({op: 'mtGet', code: L, id: mt.id}).summary;
ms({op: 'mtApprove', code: L, id: mt.id, summary: sm, confirm: true, skipUnmatched: true, setNext: true, nextTitle: 'Monday team meeting'});
cal(Object.assign({op: 'mslink', code: codeFrom(ms({op: 'calCode', code: yt.code}).url)}, AGc));   // Yi Ting reconnects (her link was reset above)
CAL.msCollectAll(cs);
const nm = evOf(AGc).find(e => /Monday team meeting/.test(e.title)), gm = evOf(GMc).find(e => /Monday team meeting/.test(e.title));
ok(nm && gm && nm.title === '🗓 Monday team meeting' && nm.start === '2026-11-30T12:00:00.000Z', 'next meeting from mini mini minutes: in the agent and GM calendars (' + (nm && nm.title) + ')');
ok(!evOf(INc).some(e => /Monday team meeting/.test(e.title)), 'not for someone outside that meeting');

// 8) bad codes are refused
let bad = '';
try { cal(Object.assign({op: 'mslink', code: 'MAAAAAAAAAAAAAAA'}, OTc)); } catch (e) { bad = e.appCode; }
ok(bad === 'ms_bad_code', 'wrong code refused (' + bad + ')');

console.log(pass + ' passed, ' + failN + ' failed');
if (failN) process.exit(1);
