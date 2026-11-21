// Cross-app check: REAL REDEFINE Prospecting rules <-> REAL REDEFINE Calendar rules, both in memory, nothing sent anywhere.
// Run from this folder: node tools/cross-prospecting-test.js   (needs ../REDEFINE Referrals Tracker next to this folder)
const path = require('path');
const CAL = require('../docs/core.js'), calStore = require('./memstore.js');
const PRO = require(path.join(__dirname, '..', '..', 'REDEFINE Referrals Tracker', 'docs', 'core.js')), proStore = require(path.join(__dirname, '..', '..', 'REDEFINE Referrals Tracker', 'tools', 'memstore.js'));
let pass = 0, failN = 0;
const ok = (c, m) => { if (c) pass++; else { failN++; console.log('FAIL: ' + m); } };
const PHOTO = 'A'.repeat(400);

const ps = proStore({now: () => Date.parse('2026-11-21T02:00:00Z')}), cs = calStore({now: () => Date.parse('2026-11-21T02:00:00Z')});
const pro = q => PRO.handle(q, ps), cal = q => CAL.handle(q, cs);
cs.fetchJson = (url, body) => { try { return PRO.handle(body, ps); } catch (e) { return {error: e.appCode || 'server_error'}; } };   // Calendar server -> Prospecting server

// one agent in both apps (names need not match: the link code ties them)
const A = {code: 'test-team', name: 'Alicia Tan', pin: '1234'};
pro(Object.assign({op: 'signin', create: true}, A));
const calTok = cal(Object.assign({op: 'signin', create: true}, {code: cs.props.TEAM_CODE || 'test-team', name: 'Alicia T', pin: '1234'})).token;
const C = {token: calTok};
const post = pro(Object.assign({op: 'post', photo: PHOTO, covered: true, rows: [{name: 'Lee Wei'}, {name: 'Ng Mei'}, {name: 'Tan Ah'}]}, A));
const [r1, r2, r3] = ps.tables.refs.filter(r => r.postId === post.post.id);

// connect: Prospecting gives a code, Calendar saves it
const code = pro(Object.assign({op: 'linkCode', app: 'calendar'}, A)).code;
const lk = cal(Object.assign({op: 'prlink', code}, C));
ok(lk.linked && lk.agent === 'Alicia Tan', 'Calendar connected to Prospecting (' + JSON.stringify(lk) + ')');
ok(cal(Object.assign({op: 'sync'}, C)).me.prLinked === true, 'Calendar app knows it is connected');
const mine = () => cs.tables.events.filter(e => /^pr:/.test(e.source));

// 1) called -> Approach, done
pro(Object.assign({op: 'step', refId: r1.id, step: 'call'}, A));
pro(Object.assign({op: 'step', refId: r2.id, step: 'noappt'}, A));   // called, no appointment
cal(Object.assign({op: 'prpull'}, C));
let ev = mine();
ok(ev.length === 2 && ev.every(e => e.type === 'approach' && e.out === 'done' && e.count === '1' && e.vis === 'private'), '2 calls -> 2 private Approach events, done');
ok(ev.some(e => /Call Lee Wei \(referral\)/.test(e.title)) && ev.some(e => /Ng Mei/.test(e.title)), 'titles name the lead');

// 2) set appointment -> appointment event (counts O), done later (counts P)
cs.setNow('2026-11-21T03:00:00Z'); ps.setNow('2026-11-21T03:00:00Z');
pro(Object.assign({op: 'step', refId: r1.id, step: 'plan', when: '2026-11-23T15:00'}, A));
cal(Object.assign({op: 'prpull'}, C));
const appt = () => cs.tables.events.find(e => e.source === 'pr:' + r1.id + ':appt');
ok(appt() && appt().type === 'present' && appt().start === '2026-11-23T07:00:00.000Z' && appt().out === '', 'appointment Mon 23 Nov 3pm in Calendar, not done yet');
const st1 = CAL.stats(cs.tables.events.map(e => Object.assign({}, e)), Date.parse('2026-11-01T00:00:00+08:00'), Date.parse('2026-12-01T00:00:00+08:00'), cs.now().getTime());
const me1 = Object.values(st1)[0];
ok(me1.A === 2 && me1.O === 1 && me1.P === 0, 'team board: A=2, O=1, P=0 (' + JSON.stringify({A: me1.A, O: me1.O, P: me1.P}) + ')');
ps.setNow('2026-11-23T09:00:00Z'); cs.setNow('2026-11-23T09:00:00Z');
pro(Object.assign({op: 'step', refId: r1.id, step: 'appt'}, A));
cal(Object.assign({op: 'prpull'}, C));
ok(appt().out === 'done', 'appointment done in Prospecting -> Done in Calendar');
const me2 = Object.values(CAL.stats(cs.tables.events.map(e => Object.assign({}, e)), Date.parse('2026-11-01T00:00:00+08:00'), Date.parse('2026-12-01T00:00:00+08:00'), cs.now().getTime()))[0];
ok(me2.P === 1, 'team board now P=1');

// 3) every-5-minute collect works without the app being open
pro(Object.assign({op: 'step', refId: r3.id, step: 'call'}, A));
const tick = CAL.prCollectAll(cs);
ok(tick.members === 1 && tick.changed === 1 && mine().length === 4, 'server 5-minute collect adds the new call (' + JSON.stringify(tick) + ')');
ok(CAL.prCollectAll(cs).changed === 0, 'nothing new = nothing changed (no duplicates)');

// 4) undo in Prospecting removes it in Calendar; an event closed in Calendar is left alone
pro(Object.assign({op: 'step', refId: r3.id, step: 'call', done: false}, A));
CAL.prCollectAll(cs);
ok(!cs.tables.events.some(e => e.source === 'pr:' + r3.id + ':call'), 'undo call -> event removed');
const ap = appt(); ap.out = 'closed'; ap.cases = JSON.stringify([{plan: 'X', anp: 1200, mode: 'M'}]);
cs.save('events', cs.tables.events);
ps.setNow('2026-11-23T10:00:00Z'); pro(Object.assign({op: 'step', refId: r1.id, step: 'appt', done: false}, A));
CAL.prCollectAll(cs);
ok(appt() && appt().out === 'closed', 'event the agent already closed (💰) in Calendar is never changed');

// 5) agent edits the event in Calendar: stays linked (no duplicate)
const callEv = cs.tables.events.find(e => e.source === 'pr:' + r1.id + ':call');
cal(Object.assign({op: 'save', event: {id: callEv.id, title: '📞 Call Lee Wei (referral) - good chat', type: 'approach', start: callEv.start, end: callEv.end, vis: 'private'}}, C));
ok(cs.tables.events.find(e => e.id === callEv.id).source === 'pr:' + r1.id + ':call', 'edited event stays linked');
CAL.prCollectAll(cs);
ok(cs.tables.events.filter(e => e.source === 'pr:' + r1.id + ':call').length === 1, 'still one call event after the next collect');

// 6) disconnect / bad code
pro(Object.assign({op: 'linkCode', app: 'calendar'}, A));   // a new code: the old one stops working
CAL.prCollectAll(cs);
ok(cs.tables.members.find(m => m.name === 'Alicia T').prCode === '', 'old code rejected -> Calendar forgets it (agent reconnects)');
ok(cal(Object.assign({op: 'prpull'}, C)).linked === false, 'app sees it is not connected any more');

// ---------- REDEFINE On Field (real rules) ----------
const FU = require(path.join(__dirname, '..', '..', 'Policy Summary Power Tools', 'docs', 'followup.js'));
const B = {code: 'test-team', name: 'Ben Ong', pin: '1111'};
ps.setNow('2026-11-24T02:00:00Z');
pro(Object.assign({op: 'signin', create: true}, B));
const pb = pro(Object.assign({op: 'post', source: 'roadshow', location: 'Gurney Plaza', photo: PHOTO, selfie: PHOTO, covered: true, rows: [{name: 'Siti Aminah'}, {name: 'Raj Kumar'}]}, B));
const [s1, s2] = ps.tables.refs.filter(r => r.postId === pb.post.id);
const ofCode = pro(Object.assign({op: 'linkCode', app: 'onfield'}, B)).code;
const cases = [{id: 'old', client: {name: 'Raj Kumar'}, kind: 'prospect', meetings: [], policies: []}];   // Raj already on the farm
pro(Object.assign({op: 'step', refId: s1.id, step: 'plan', when: '2026-11-26T10:30'}, B));            // called + appointment set
pro(Object.assign({op: 'step', refId: s2.id, step: 'noappt'}, B));                                     // called, no appointment
let f1 = pro({op: 'feed', code: ofCode}), r1o = FU.applyProspecting(cases, f1.items);
const siti = cases.find(c => c.client.name === 'Siti Aminah'), raj = cases.find(c => c.id === 'old');
ok(r1o.created === 1 && siti && siti.kind === 'prospect', 'new prospect Siti created on the farm');
ok(raj.meetings.length === 1 && /no appointment/.test(raj.meetings[0].summary) && raj.meetings[0].visit === false, 'existing Raj gets a call quick log (not a 三访 visit)');
const sm = siti.meetings[0];
ok(sm.type === 'approach' && sm.tags[0] === 'O' && sm.followUpDate === '2026-11-26' && /10:30/.test(sm.nextStep), 'Siti: Approach tagged O, follow-up on the appointment day 26 Nov 10:30');
ok(FU.applyProspecting(cases, f1.items).changed === 0, 'collecting again adds nothing (no duplicates)');
ps.setNow('2026-11-26T04:00:00Z');
pro(Object.assign({op: 'step', refId: s1.id, step: 'appt'}, B));
const f2 = pro({op: 'feed', code: ofCode, since: f1.now}); FU.applyProspecting(cases, f2.items);
const visit = siti.meetings.find(m => m.type === 'fact_find');
ok(visit && visit.visit === true && visit.date === '2026-11-26' && visit.time === '10:30', 'appointment done -> Open visit on 26 Nov 10:30 (counts for 三访)');
ok(FU.meetingsOn(cases, '2026-11-26').length === 1, '三访 count for that day = 1');
ps.setNow('2026-11-26T05:00:00Z');
pro(Object.assign({op: 'step', refId: s1.id, step: 'appt', done: false}, B));
const f3 = pro({op: 'feed', code: ofCode, since: f2.now}); FU.applyProspecting(cases, f3.items);
ok(!siti.meetings.some(m => m.type === 'fact_find') && siti.removed.meetings.length === 1, 'undo in Prospecting removes the visit (and other devices will not bring it back)');
ps.setNow('2026-11-26T06:00:00Z');
pro(Object.assign({op: 'step', refId: s1.id, step: 'appt'}, B));
const f4 = pro({op: 'feed', code: ofCode, since: f3.now}); FU.applyProspecting(cases, f4.items);
ok(siti.meetings.some(m => m.type === 'fact_find'), 'done again -> visit comes back as a fresh entry');

console.log(pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
