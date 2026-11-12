// Checks the shared rules (docs/core.js) against an in-memory server. Run: node test.js
const CORE = require('./docs/core.js'), memStore = require('./tools/memstore.js'), {seed} = require('./tools/serve.js');
let pass = 0, fail = 0;
function ok(cond, name) { if (cond) pass++; else { fail++; console.log('FAIL: ' + name); } }
function throws(fn, code, name) { try { fn(); fail++; console.log('FAIL (no error): ' + name); } catch (e) { ok(e.appCode === code, name + ' -> ' + e.appCode); } }
const NOW = Date.parse('2026-11-12T02:00:00Z');   // Thu 12 Nov 2026, 10:00 Malaysia time
const iso = t => new Date(t).toISOString(), H = 3600e3, D = 864e5;

function fresh() {
  const s = memStore(); s.setNow(NOW);
  const h = q => CORE.handle(q, s);
  const join = (name, leader) => { s.resetFails(); return h({op: 'signin', code: leader ? 'test-leader-code' : 'test-team', name, pin: '1234', create: true}); };
  return {s, h, join};
}

/* ---------- sign-in: stays signed in like WhatsApp ---------- */
{
  const {s, h, join} = fresh();
  const boss = join('Kah Jian', true), ali = join('Alicia Tan');
  ok(boss.me.leader && !ali.me.leader, 'leader code makes a leader, team code an agent');
  ok(ali.token.length === 40, 'device key is 40 characters');
  ok(!s.load('sessions').some(x => x.token === ali.token), 'only the hash of the device key is stored');
  throws(() => h({op: 'signin', code: 'test-team', name: 'Alicia Tan', pin: '9999'}), 'wrong_pin', 'wrong PIN refused');
  throws(() => h({op: 'signin', code: 'nope', name: 'X', pin: '1234'}), 'wrong_code', 'wrong team code refused');
  throws(() => h({op: 'signin', code: 'test-team', name: 'New Person', pin: '1234'}), 'new_name', 'new name asks before creating');
  s.resetFails();
  // still signed in 2 years later, after the team code changes
  s.setNow(NOW + 730 * D); s.props.TEAM_CODE = 'changed-code';
  ok(h({op: 'sync', token: ali.token}).me.name === 'Alicia Tan', 'still signed in after 2 years and a team-code change');
  // a failed sign-in elsewhere does not touch existing phones
  for (let i = 0; i < 9; i++) { try { h({op: 'signin', code: 'bad', name: 'x', pin: '1234'}); } catch (e) {} }
  ok(h({op: 'sync', token: ali.token}).me.name === 'Alicia Tan', 'many wrong tries on other phones never sign this phone out');
  // two phones, sign out on one only
  s.resetFails(); s.props.TEAM_CODE = 'test-team';
  const ali2 = h({op: 'signin', code: 'test-team', name: 'alicia  tan', pin: '1234'});
  h({op: 'signout', token: ali2.token});
  throws(() => h({op: 'sync', token: ali2.token}), 'signed_out', 'signed-out phone is out');
  ok(h({op: 'sync', token: ali.token}).me.name === 'Alicia Tan', 'other phone stays signed in');
  // leader removes -> out everywhere
  h({op: 'member', token: boss.token, id: ali.me.id, active: false});
  throws(() => h({op: 'sync', token: ali.token}), 'signed_out', 'removed member is signed out');
  throws(() => h({op: 'member', token: (join('Marcus Lim')).token, id: boss.me.id, active: false}), 'leader_only', 'agents cannot remove members');
  ok(s.load('sessions').every(x => x.lastSeen), 'sessions keep last-seen');
}

/* ---------- privacy ---------- */
{
  const {s, h, join} = fresh();
  const boss = join('Kah Jian', true), ali = join('Alicia Tan'), mar = join('Marcus Lim');
  const st = iso(NOW + 26 * H), en = iso(NOW + 27 * H);
  const pub = h({op: 'save', token: ali.token, event: {title: 'Present Mr Lim medical card', start: st, end: en, place: 'Gurney'}}).event;
  const hid = h({op: 'save', token: ali.token, event: {title: 'FF Encik Zul 0123456789', start: iso(NOW + 28 * H), end: iso(NOW + 29 * H), vis: 'private', place: 'his house', notes: 'IC 900101'}}).event;
  const per = h({op: 'save', token: ali.token, event: {title: 'Gym', start: iso(NOW + 30 * H), end: iso(NOW + 31 * H), vis: 'private'}}).event;
  ok(pub.type === 'present' && hid.type === 'open' && per.type === 'personal', 'types detected from titles');
  const view = tok => h({op: 'sync', token: tok, force: true}).events;
  const m = view(mar.token), b = view(boss.token), a = view(ali.token);
  const find = (list, id) => list.find(e => e.id === id);
  ok(find(m, pub.id).title === 'Present Mr Lim medical card', 'team event visible to teammates');
  const mh = find(m, hid.id);
  ok(mh.busy && !mh.title && !mh.place && !mh.notes && mh.t === 'open', 'private work event: teammate sees only Busy (+type for counts)');
  ok(find(b, hid.id).busy && !find(b, hid.id).title, 'leader also sees only Busy (as chosen)');
  const mp = find(m, per.id);
  ok(mp.busy && !mp.t && !mp.title, 'private personal event reveals only the time');
  ok(find(a, hid.id).title.includes('Encik Zul'), 'owner sees own private details');
  ok(!JSON.stringify(m).includes('0123456789') && !JSON.stringify(b).includes('IC 900101'), 'private text never leaves the server for others');
  // tagged person sees details of a private event
  const joint = h({op: 'save', token: ali.token, event: {title: 'Joint FW Present Ms Tan', start: iso(NOW + 50 * H), end: iso(NOW + 51 * H), vis: 'private', with: [boss.me.id]}}).event;
  ok(find(view(boss.token), joint.id).title === 'Joint FW Present Ms Tan' && find(view(mar.token), joint.id).busy, 'tagged leader sees details, others Busy');
  ok(s.pushes.some(p => p.ids.includes(boss.me.id) && /added you/.test(p.note.title)), 'tagged person gets a pop-up');
  // comments on private events are hidden from others
  h({op: 'send', token: ali.token, to: 'ev:' + hid.id, text: 'note to self'});
  ok(!h({op: 'sync', token: mar.token, force: true}).msgs.some(x => x.text === 'note to self'), 'comments on a private event stay private');
  throws(() => h({op: 'send', token: mar.token, to: 'ev:' + hid.id, text: 'hi'}), 'not_found', 'cannot comment on someone\'s private event');
  // only owner edits / deletes
  throws(() => h({op: 'save', token: mar.token, event: {id: pub.id, title: 'x', start: st, end: en}}), 'not_yours', 'others cannot edit');
  throws(() => h({op: 'del', token: boss.token, id: pub.id}), 'not_yours', 'leader cannot delete agent events');
  // chat is gone: only comments on events
  throws(() => h({op: 'send', token: mar.token, to: boss.me.id, text: 'hi'}), 'bad_request', 'no direct messages any more');
  throws(() => h({op: 'send', token: mar.token, to: 'team', text: 'hi'}), 'bad_request', 'no team chat any more');
}

/* ---------- who gets a comment pop-up ---------- */
{
  const {s, h, join} = fresh();
  const boss = join('Kah Jian', true), ali = join('Alicia Tan'), mar = join('Marcus Lim'), siti = join('Siti Aisyah'), dan = join('Daniel Ong');
  const last = () => s.pushes[s.pushes.length - 1], ids = () => last().ids.slice().sort().join(',');
  const ev = h({op: 'save', token: ali.token, event: {title: 'Present Mr Lim', start: iso(NOW + 5 * H), end: iso(NOW + 6 * H)}}).event;
  s.pushes.length = 0;
  h({op: 'send', token: mar.token, to: 'ev:' + ev.id, text: 'All the best!'});
  ok(ids() === ali.me.id && /Marcus Lim 💬 Present Mr Lim/.test(last().note.title), 'teammate comments on my event -> only I get the pop-up');
  h({op: 'send', token: boss.token, to: 'ev:' + ev.id, text: 'Bring the BI'});
  ok(ids() === ali.me.id, 'second commenter -> still only the owner (Marcus not told)');
  h({op: 'send', token: ali.token, to: 'ev:' + ev.id, text: 'Thanks both!'});
  ok(ids() === [boss.me.id, mar.me.id].sort().join(','), 'owner replies -> only the people who commented');
  ok(!last().ids.includes(siti.me.id) && !last().ids.includes(dan.me.id), 'everyone else gets nothing');
  const n = s.pushes.length; h({op: 'send', token: ali.token, to: 'ev:' + h({op: 'save', token: ali.token, event: {title: 'FU Jason', start: iso(NOW + 9 * H), end: iso(NOW + 10 * H)}}).event.id, text: 'note'});
  ok(s.pushes.length === n, 'owner comment with no commenters yet -> no pop-up at all');
  // tagged person counts as part of the event
  const joint = h({op: 'save', token: ali.token, event: {title: 'Joint FW Ms Tan', start: iso(NOW + 7 * H), end: iso(NOW + 8 * H), with: [boss.me.id]}}).event;
  h({op: 'send', token: siti.token, to: 'ev:' + joint.id, text: 'Go go!'});
  ok(ids() === [ali.me.id, boss.me.id].sort().join(','), 'event with a tagged leader -> owner + tagged leader');
  // whole-team event: everyone
  s.pushes.length = 0;
  const meet = h({op: 'save', token: boss.token, event: {title: 'Monday team meeting', start: iso(NOW + 30 * H), end: iso(NOW + 31 * H), all: true}}).event;
  ok(meet.all && last().ids.length === 4 && /Team event/.test(last().note.title) && /Going\?/.test(last().note.body), 'new whole-team event: everyone gets a pop-up asking Going?');
  h({op: 'send', token: dan.token, to: 'ev:' + meet.id, text: 'Can I bring a recruit?'});
  ok(ids() === [boss.me.id, ali.me.id, mar.me.id, siti.me.id].sort().join(','), 'comment on whole-team event -> every member except the writer');
  const pv = h({op: 'save', token: boss.token, event: {title: 'Private all?', start: iso(NOW + 30 * H), end: iso(NOW + 31 * H), all: true, vis: 'private'}}).event;
  ok(!pv.all, 'a private event can never be whole-team');
  ok(CORE.commentTargets({ownerId: 'a', with: ['b'], vis: 'team'}, [{from: 'c', kind: 'text'}, {from: 'd', kind: 'cheer'}], 'a', [{id: 'a'}, {id: 'b'}, {id: 'c'}, {id: 'd'}]).sort().join() === 'b,c', 'phone uses the same rule (cheerers are not commenters)');
  // attendance: Going / Can't go / no reply
  h({op: 'rsvp', token: ali.token, id: meet.id, answer: 'yes'});
  h({op: 'rsvp', token: mar.token, id: meet.id, answer: 'no'});
  h({op: 'rsvp', token: siti.token, id: meet.id, answer: 'yes'});
  h({op: 'rsvp', token: siti.token, id: meet.id, answer: 'no'});   // changed her mind: only the last answer counts
  let at = CORE.attendance(s.load('events').find(e => e.id === meet.id), s.load('msgs'), s.load('members'));
  ok(at.yes.join() === ali.me.id && at.no.sort().join() === [mar.me.id, siti.me.id].sort().join() && at.none.length === 2, 'attendance: 1 going, 2 can\'t, 2 no reply');
  h({op: 'rsvp', token: mar.token, id: meet.id, answer: ''});
  at = CORE.attendance(s.load('events').find(e => e.id === meet.id), s.load('msgs'), s.load('members'));
  ok(at.none.includes(mar.me.id), 'clearing an answer puts you back to no reply');
  const pushesBefore = s.pushes.length;
  h({op: 'rsvp', token: dan.token, id: meet.id, answer: 'yes'});
  ok(s.pushes.length === pushesBefore, 'answering does not pop up on anyone\'s phone');
  ok(h({op: 'sync', token: boss.token, force: true}).msgs.filter(m => m.kind === 'rsvp').length === 3, 'everyone can see the answers');
  throws(() => h({op: 'rsvp', token: ali.token, id: joint.id, answer: 'yes'}), 'not_team_event', 'attendance only on whole-team events');
  const comm = h({op: 'send', token: boss.token, to: 'ev:' + meet.id, text: 'See you all'});
  ok(!last().ids.includes(boss.me.id) && last().ids.length === 4, 'answers are not treated as comments (comment rule unchanged)');
  // 1 hour before: pop-up to everyone with the attendance count
  s.pushes.length = 0; s.setNow(NOW + 30 * H - 61 * 60e3); CORE.tick(s);
  ok(!s.pushes.some(p => /Monday team meeting/.test(p.note.title)), 'no team reminder 61 min before');
  s.setNow(NOW + 30 * H - 59 * 60e3); CORE.tick(s);
  const rp = s.pushes.find(p => /Monday team meeting/.test(p.note.title));
  ok(rp && rp.ids.length === 5 && /In 59 min/.test(rp.note.body) && /✅ 2 going, ❌ 1 can't, ⏳ 2 no reply/.test(rp.note.body), 'whole-team event: everyone gets a pop-up 1 hour before, with the count');
  CORE.tick(s); ok(s.pushes.filter(p => /Monday team meeting/.test(p.note.title)).length === 1, 'team reminder sent once');
  s.setNow(NOW + 32 * H);
  throws(() => h({op: 'rsvp', token: ali.token, id: meet.id, answer: 'no'}), 'ended', 'cannot answer after the event ended');
}

/* ---------- outcomes + counting (MAE) ---------- */
{
  const {s, h, join} = fresh();
  const ali = join('Alicia Tan'), mar = join('Marcus Lim'), boss = join('Kah Jian', true);
  const mk = (title, hoursAgo, extra) => h({op: 'save', token: ali.token, event: Object.assign({title, start: iso(NOW - hoursAgo * H), end: iso(NOW - hoursAgo * H + H)}, extra || {})}).event;
  const ap = mk('Approach USM booth', 50, {count: 6}), op1 = mk('FF Jason', 40), op2 = mk('FF Mei', 30), pr = mk('Present Jason CI plan', 20), fu = mk('FU Jason', 10), pr2 = mk('Present Mei', 5, {vis: 'private'}), pw = mk('Paperwork submit', 3), gym = mk('Gym', 2);
  const future = h({op: 'save', token: ali.token, event: {title: 'Present Ravi', start: iso(NOW + 5 * H), end: iso(NOW + 6 * H)}}).event;
  throws(() => h({op: 'outcome', token: ali.token, id: future.id, out: 'done'}), 'not_yet', 'cannot confirm a future event');
  throws(() => h({op: 'outcome', token: mar.token, id: pr.id, out: 'done'}), 'not_yours', 'cannot confirm someone else\'s event');
  throws(() => h({op: 'outcome', token: ali.token, id: ap.id, out: 'closed'}), 'cannot_close', 'an approach cannot be "closed"');
  h({op: 'outcome', token: ali.token, id: ap.id, out: 'done'});
  h({op: 'outcome', token: ali.token, id: op1.id, out: 'done'});
  h({op: 'outcome', token: ali.token, id: op2.id, out: 'cancel'});
  h({op: 'outcome', token: ali.token, id: pr.id, out: 'closed', cases: [{plan: 'GMS', anp: 1198, mode: 'M'}, {plan: 'GMS', anp: 1507.65, mode: 'Y'}, {plan: 'SPWP', anp: 3000.004, mode: 'M'}]});
  ok(s.load('events').find(e => e.id === pr.id).anp === '5705.65', 'ANP keeps sen (1,198 + 1,507.65 + 3,000 = 5,705.65)');
  h({op: 'outcome', token: ali.token, id: pr.id, out: 'done'});
  h({op: 'outcome', token: ali.token, id: fu.id, out: 'closed', anp: '3600'});
  h({op: 'outcome', token: ali.token, id: pr2.id, out: 'closed', anp: ''});
  ok(s.pushes.filter(p => /closed a case/.test(p.note.title)).length === 2 && !s.load('msgs').length, 'closing pops up a 🎉 to the team (no chat message)');
  throws(() => h({op: 'outcome', token: ali.token, id: pr.id, out: 'closed', anp: '-5'}), 'bad_anp', 'negative ANP refused');
  const st = CORE.stats(s.load('events'), NOW - 7 * D, NOW + 7 * D, NOW)[ali.me.id];
  ok(st.A === 6 && st.O === 1 && st.P === 2 && st.F === 1 && st.C === 2, 'A/O/P/F/C counted only from confirmed events: ' + JSON.stringify([st.A, st.O, st.P, st.F, st.C]));
  ok(st.anp === 3600 && st.anpCases === 1, 'ANP never guessed: a close without ANP is a case with no RM');
  ok(st.cancelled === 1 && st.unconfirmed === 1, 'cancelled not counted; past unconfirmed paperwork shown as unconfirmed');
  ok(st.personal === 0, 'personal events never count');
  const r = CORE.ratios(st);
  ok(r.OA === 1 / 6 && r.PO === 2 && r.FP === 0.5 && r.CP === 1 && r.M === 3600, 'ratios: O/A, P/O, F/P, NOC/P, avg case');
  ok(CORE.ratios(CORE.addStats([])).CP === null, 'no presentations -> ratio shown as – (not 0%)');
  // teammates get counts but not ANP; leader gets ANP
  const mv = h({op: 'sync', token: mar.token, force: true}).events, bv = h({op: 'sync', token: boss.token, force: true}).events;
  ok(mv.some(e => e.id === fu.id && e.anp === 3600), 'agents now see teammates\' ANP (team board ANP column)');
  ok(bv.some(e => e.id === fu.id && e.anp === 3600), 'leader receives ANP');
  ok(CORE.stats(mv, NOW - 7 * D, NOW + 7 * D, NOW)[ali.me.id].C === 2, 'teammates still see the case count (incl. hidden events)');
  ok(CORE.stats(bv, NOW - 7 * D, NOW + 7 * D, NOW)[ali.me.id].anp === 3600, 'leader stats include ANP');
  // present marked Done today, client signs next week: come back and tick Closed with NOC + ANP
  h({op: 'outcome', token: ali.token, id: pr.id, out: 'closed', noc: 2, anp: '9000'});
  const st2 = CORE.stats(s.load('events'), NOW - 7 * D, NOW + 7 * D, NOW)[ali.me.id];
  ok(st2.P === 2 && st2.C === 4 && st2.anp === 12600 && st2.anpCases === 3, 'later close: P stays, C adds NOC (2), ANP adds');
  ok(CORE.ratios(st2).M === 4200, 'avg case size = ANP / NOC (12,600 / 3)');
  ok(s.pushes.some(p => /closed 2 cases/.test(p.note.title)), 'team pop-up says how many cases');
  throws(() => h({op: 'outcome', token: ali.token, id: pr.id, out: 'closed', noc: 0}), 'bad_noc', 'NOC 0 refused');
  throws(() => h({op: 'outcome', token: ali.token, id: pr.id, out: 'closed', noc: 99}), 'bad_noc', 'NOC 99 refused');
  ok(h({op: 'sync', token: mar.token, force: true}).events.find(e => e.id === pr.id).noc === 2, 'teammates see the NOC count (not the ANP)');
  const tt = h({op: 'teamtotals', token: mar.token, from: iso(NOW - 7 * D), to: iso(NOW + 7 * D)});
  ok(tt.anp === 12600 && tt.noc === 4 && Object.keys(tt).filter(k => k !== 'ok').length === 3, 'agent gets the team ANP total only (one sum, no per-agent figures)');
  // one line per policy: plan name, ANP, payment mode
  throws(() => h({op: 'outcome', token: ali.token, id: pr.id, out: 'closed', cases: [{plan: '', anp: 3600, mode: 'M'}]}), 'plan_needed', 'plan name required');
  throws(() => h({op: 'outcome', token: ali.token, id: pr.id, out: 'closed', cases: [{plan: 'Plan A', anp: 3600, mode: 'W'}]}), 'mode_needed', 'payment mode must be M/Q/HY/Y');
  throws(() => h({op: 'outcome', token: ali.token, id: pr.id, out: 'closed', cases: []}), 'cases_needed', 'at least one case');
  h({op: 'outcome', token: ali.token, id: pr.id, out: 'closed', cases: [{plan: 'Medical plan X', anp: 3600, mode: 'm'}, {plan: 'CI plan Y', anp: '', mode: 'Y'}, {plan: 'Savings plan Z', anp: 6000, mode: 'HY'}]});
  const pe = s.load('events').find(e => e.id === pr.id);
  ok(pe.noc === '3' && pe.anp === '9600' && JSON.parse(pe.cases)[0].mode === 'M', 'NOC = 3 lines, total ANP = 9,600 (blank ANP not guessed)');
  const st3 = CORE.stats(s.load('events'), NOW - 7 * D, NOW + 7 * D, NOW)[ali.me.id];
  ok(st3.C === 5 && st3.anp === 13200 && st3.anpCases === 3, 'case without ANP counts in NOC but not in avg case size');
  const mview = h({op: 'sync', token: mar.token, force: true}).events.find(e => e.id === pr.id), bview = h({op: 'sync', token: boss.token, force: true}).events.find(e => e.id === pr.id);
  ok(mview.noc === 3 && mview.cases.length === 3 && mview.anp === 9600, 'teammates see the case lines (plan, ANP, mode) for the close case list');
  ok(Object.keys(mview.cases[0]).sort().join() === 'anp,mode,plan', 'case lines carry only plan, ANP, mode (no client details)');
  ok(bview.cases.length === 3 && bview.cases[2].plan === 'Savings plan Z', 'leader sees the plan names, modes and ANP');
  ok(CORE.stats([bview], NOW - 7 * D, NOW + 7 * D, NOW)[ali.me.id].anp === 9600, 'leader stats use the per-case ANP');
  h({op: 'outcome', token: ali.token, id: pr.id, out: 'done'});
  ok(s.load('events').find(e => e.id === pr.id).noc === '' && !s.load('events').find(e => e.id === pr.id).cases, 'back to Done clears NOC and cases');
  h({op: 'outcome', token: ali.token, id: fu.id, out: ''});
  ok(CORE.stats(s.load('events'), NOW - 7 * D, NOW + 7 * D, NOW)[ali.me.id].C === 1, 'undo removes the count');
}

/* ---------- reminders ---------- */
{
  const {s, h, join} = fresh();
  const ali = join('Alicia Tan'), boss = join('Kah Jian', true);
  const e = h({op: 'save', token: ali.token, event: {title: 'Present Ravi', start: iso(NOW + 40 * 60e3), end: iso(NOW + 100 * 60e3), remind: '30', with: [boss.me.id]}}).event;
  s.pushes.length = 0;
  CORE.tick(s); ok(s.pushes.length === 0, 'no reminder 40 min before when set to 30');
  s.setNow(NOW + 11 * 60e3); CORE.tick(s);
  ok(s.pushes.length === 1 && s.pushes[0].ids.includes(ali.me.id) && s.pushes[0].ids.includes(boss.me.id) && /In 29 min/.test(s.pushes[0].note.body), 'reminder pops up 30 min before, to owner + tagged');
  CORE.tick(s); ok(s.pushes.length === 1, 'reminder sent only once');
  h({op: 'save', token: ali.token, event: {id: e.id, title: 'Present Ravi', start: iso(NOW + 3 * H), end: iso(NOW + 4 * H), remind: '30', with: [boss.me.id]}});
  s.setNow(NOW + 2.6 * H); CORE.tick(s); ok(s.pushes.length === 2, 'moving the event re-arms the reminder');
  s.setNow(Date.parse('2026-11-13T00:00:00Z')); s.pushes.length = 0;
  h({op: 'save', token: ali.token, event: {title: 'FF Jason', start: '2026-11-13T03:00:00Z', end: '2026-11-13T04:00:00Z'}});
  s.pushes.length = 0; CORE.morning(s);
  ok(s.pushes.some(p => p.ids[0] === ali.me.id && /Today: 1 event/.test(p.note.title)), '8am digest lists today');
  s.setNow(Date.parse('2026-11-13T13:00:00Z')); s.pushes.length = 0; CORE.evening(s);
  ok(s.pushes.some(p => p.ids[0] === ali.me.id && /Confirm 2/.test(p.note.title) && /1 from today/.test(p.note.body)), '9pm nudge (today + yesterday unconfirmed) to confirm today\'s activity');
}

/* ---------- import ---------- */
{
  const {s, h, join} = fresh();
  const ali = join('Alicia Tan');
  const r = CORE.parseRead(JSON.stringify({events: [
    {date: '2026-11-14', start: '10:00', end: '11:00', title: 'FF Jason', type: 'open', confidence: 0.9},
    {date: '', start: '14:00', title: 'Sign case Rosnah', type: 'close', confidence: 0.5, unclear: 'date smudged'},
    {date: '2026-11-15', start: '', title: 'Approach booth', type: 'approach', confidence: 0.8, count: 6},
    {date: '2026-02-30', start: '25:00', title: 'Bad date', confidence: 0.9},
    {date: '2026-11-16', start: '3.30', title: '讲解 Mr Ooi', confidence: 0.9}
  ]}));
  ok(r.events[0].ok && !r.events[1].ok && r.events[1].problems.includes('date unclear'), 'unclear date -> not ticked, flagged');
  ok(!r.events[2].ok && r.events[2].problems.includes('time unclear') && r.events[2].count === 6, 'missing time flagged, never guessed');
  ok(r.events[3].date === '' && r.events[3].start === '', 'impossible date / time rejected');
  ok(r.events[4].type === 'present' && r.events[4].start === '03:30', 'Chinese title detected as presentation');
  throws(() => CORE.parseRead('not json'), 'ai_unreadable', 'messy AI reply refused, not guessed');
  const list = [{title: 'FF Jason', type: 'open', start: '2026-11-14T02:00:00.000Z', end: '2026-11-14T03:00:00.000Z', source: 'photo'}, {title: 'ff  jason', type: 'open', start: '2026-11-14T02:00:00.000Z', end: '2026-11-14T03:00:00.000Z'}, {title: '', start: 'x'}];
  const j = h({op: 'import', token: ali.token, events: list});
  ok(j.added === 1 && j.skipped === 1 && j.bad === 1, 'import skips duplicates and unusable rows');
  ok(h({op: 'import', token: ali.token, events: list.slice(0, 1)}).added === 0, 're-importing the same photo adds nothing');
  // .ics (Google Calendar export)
  const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART:20261114T020000Z', 'DTEND:20261114T030000Z', 'SUMMARY:Present Mr Tan\\, CI', 'LOCATION:Gurney', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTART;TZID=Asia/Kuala_Lumpur:20261115T200000', 'DTEND;TZID=Asia/Kuala_Lumpur:20261115T210000', 'SUMMARY:Team meeting', 'RRULE:FREQ=WEEKLY', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261120', 'DTEND;VALUE=DATE:20261122', 'SUMMARY:Langkawi trip', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTART:20200101T020000Z', 'SUMMARY:Old', 'END:VEVENT', 'BEGIN:VEVENT', 'DTSTART:20261116T020000Z', 'SUMMARY:Cancelled thing', 'STATUS:CANCELLED', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const p = CORE.parseICS(ics, NOW - 30 * D, NOW + 366 * D);
  ok(p.events.length === 3 && p.outside === 1, '.ics: old and cancelled events left out');
  ok(p.events[0].title === 'Present Mr Tan, CI' && p.events[0].type === 'present' && p.events[0].place === 'Gurney', '.ics: title, place, type');
  ok(p.events[1].start === '2026-11-15T12:00:00.000Z' && p.events[1].repeats, '.ics: Malaysia local time converted, repeating flagged');
  ok(p.events[2].allDay && p.events[2].start === '2026-11-20' && p.events[2].end === '2026-11-21', '.ics: all-day range (end exclusive)');
  throws(() => h({op: 'read', token: ali.token, image: 'short'}), 'bad_photo', 'bad photo refused');
  s.props.DAILY_READS = '1';
  const img = 'A'.repeat(200);
  ok(h({op: 'read', token: ali.token, image: img}).read.events.length > 0, 'photo read returns rows (stand-in AI)');
  throws(() => h({op: 'read', token: ali.token, image: img}), 'daily_limit', 'daily photo limit');
  ok(/Today is 2026-11-12/.test(s.prompts[0].prompt), 'AI is told today\'s date (for the year)');
}

/* ---------- validation, sync, chat ---------- */
{
  const {s, h, join} = fresh();
  const ali = join('Alicia Tan'), mar = join('Marcus Lim');
  throws(() => h({op: 'save', token: ali.token, event: {title: '', start: iso(NOW)}}), 'title_needed', 'title required');
  throws(() => h({op: 'save', token: ali.token, event: {title: 'x', start: 'tomorrow'}}), 'date_needed', 'date required, never guessed');
  throws(() => h({op: 'save', token: ali.token, event: {title: 'x', start: iso(NOW), end: iso(NOW + 20 * D)}}), 'too_long', '20-day timed event refused');
  const e = h({op: 'save', token: ali.token, event: {title: '<script>alert(1)</script> FU', start: iso(NOW), end: iso(NOW - H), with: ['nobody', mar.me.id, mar.me.id]}}).event;
  ok(Date.parse(e.end) - Date.parse(e.start) === H, 'end before start -> 1 hour');
  ok(e.with.length === 1, 'unknown / repeated tagged people dropped');
  const v = h({op: 'sync', token: ali.token}).ver;
  ok(h({op: 'sync', token: ali.token, ver: v}).same, 'no changes -> tiny reply (saves data)');
  h({op: 'send', token: mar.token, to: 'ev:' + e.id, text: 'hello'});
  ok(!h({op: 'sync', token: ali.token, ver: v}).same, 'any change -> full reply');
  h({op: 'send', token: mar.token, to: 'ev:' + e.id, kind: 'cheer'});
  ok(s.pushes.some(p => p.ids[0] === ali.me.id && /cheered/.test(p.note.title)), 'cheer notifies the owner');
  ok(h({op: 'send', token: mar.token, to: 'ev:' + e.id, kind: 'cheer'}).uncheered, 'second tap un-cheers');
  const m = h({op: 'send', token: mar.token, to: 'ev:' + e.id, text: 'hi'}).msg;
  throws(() => h({op: 'delmsg', token: ali.token, id: m.id}), 'not_yours', 'cannot delete someone else\'s comment');
  ok(h({op: 'delmsg', token: mar.token, id: m.id}).deleted === m.id, 'can delete own comment');
  h({op: 'pushreg', token: ali.token, pushToken: 'x'.repeat(40)}); h({op: 'pushreg', token: ali.token, pushToken: 'x'.repeat(40)});
  ok(s.load('devices').length === 1, 'same phone registered once');
  ok(h({op: 'sync', token: ali.token, force: true}).me.devices === 1, 'app knows pop-ups are on');
  h({op: 'signout', token: ali.token, pushToken: 'x'.repeat(40)});
  ok(s.load('devices').length === 0, 'sign out stops pop-ups on that phone');
}

/* ---------- sample team sanity ---------- */
{
  const s = memStore(); seed(s, NOW);
  const evs = s.load('events');
  ok(evs.length > 500 && s.load('members').length === 10, 'sample team has 10 people and a full calendar');
  const by = CORE.stats(evs, NOW - 30 * D, NOW, NOW);
  ok(Object.keys(by).length >= 9, 'every sample agent has activity');
}

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
