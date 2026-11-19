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
  ok(pub.type === 'present' && hid.type === 'present' && per.type === 'personal', 'types detected from titles (FF = presentation now)');
  const view = tok => h({op: 'sync', token: tok, force: true}).events;
  const m = view(mar.token), b = view(boss.token), a = view(ali.token);
  const find = (list, id) => list.find(e => e.id === id);
  ok(find(m, pub.id).title === 'Present Mr Lim medical card', 'team event visible to teammates');
  const mh = find(m, hid.id);
  ok(mh.busy && !mh.title && !mh.place && !mh.notes && mh.t === 'present', 'private work event: teammate sees only Busy (+type for counts)');
  ok(find(b, hid.id).busy && !find(b, hid.id).title, 'leader also sees only Busy (as chosen)');
  const mp = find(m, per.id);
  ok(mp.busy && !mp.t && !mp.title, 'private personal event reveals only the time');
  ok(find(a, hid.id).title.includes('Encik Zul'), 'owner sees own private details');
  ok(!JSON.stringify(m).includes('0123456789') && !JSON.stringify(b).includes('IC 900101'), 'private text never leaves the server for others');
  // tagged person sees details of a private event
  const joint = h({op: 'save', token: ali.token, event: {title: 'Joint FW Present Ms Tan', start: iso(NOW + 50 * H), end: iso(NOW + 51 * H), vis: 'private', with: [boss.me.id]}}).event;
  ok(find(view(boss.token), joint.id).title === 'Joint FW Present Ms Tan' && find(view(mar.token), joint.id).busy, 'tagged leader sees details, others Busy');
  ok(s.pushes.some(p => p.ids.includes(boss.me.id) && /invited you/.test(p.note.title) && /Accept or reject/.test(p.note.body)), 'invited person gets a pop-up asking to accept');
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
  ok(new Set(h({op: 'sync', token: boss.token, force: true}).msgs.filter(m => m.kind === 'rsvp').map(m => m.from)).size === 4, 'everyone can see the answers');
  ok(CORE.answers(meet.id, s.load('msgs'))[siti.me.id] === 'no', 'newest answer wins when someone changes their mind');
  const before = s.load('msgs').length; h({op: 'rsvp', token: ali.token, id: meet.id, answer: 'yes'});
  ok(s.load('msgs').length === before + 1, 'an answer adds exactly one line (no rewrite of the messages)');
  s.locks = 0; h({op: 'sync', token: ali.token, force: true}); h({op: 'teamtotals', token: ali.token, from: iso(NOW - D), to: iso(NOW + D)});
  ok(s.locks === 0, 'phone refreshes never take the lock (cannot block someone saving)');
  s.locks = 0; h({op: 'rsvp', token: dan.token, id: meet.id, answer: 'yes'}); ok(s.locks === 1, 'saving an answer takes the lock once');
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
  ok(st.A === 6 && st.O === 5 && st.P === 3 && st.F === 1 && st.C === 2, 'A/O/P/F/C: O = 5 presentations set (done or not), P = 3 done: ' + JSON.stringify([st.A, st.O, st.P, st.F, st.C]));
  ok(st.anp === 3600 && st.anpCases === 1, 'ANP never guessed: a close without ANP is a case with no RM');
  ok(st.cancelled === 1 && st.unconfirmed === 1, 'cancelled not counted; past unconfirmed paperwork shown as unconfirmed');
  ok(st.personal === 0, 'personal events never count');
  const r = CORE.ratios(st);
  ok(r.OA === 5 / 6 && r.PO === 3 / 5 && r.FP === 1 / 3 && r.CP === 2 / 3 && r.M === 3600, 'ratios: O/A, P/O, F/P, NOC/P, avg case');
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
  ok(st2.P === 3 && st2.C === 4 && st2.anp === 12600 && st2.anpCases === 3, 'later close: P stays, C adds NOC (2), ANP adds');
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
  // uploading again: the AI may read the same photo slightly differently; same time + similar title = same appointment
  const again = h({op: 'import', token: ali.token, events: [{title: 'FF Jason (Gurney)', type: 'present', start: '2026-11-14T02:00:00.000Z', end: '2026-11-14T03:00:00.000Z', source: 'photo'}, {title: 'Gym', type: 'personal', start: '2026-11-14T02:00:00.000Z', end: '2026-11-14T03:00:00.000Z', source: 'photo'}]});
  ok(again.added === 1 && again.skipped === 1, 'second upload: re-read title at the same time is skipped, a different appointment at that time is still added');
  ok(CORE.similarTitle('签单 Ooi', '签单 Ooi 先生') && CORE.similarTitle('Present Mr Lim medical card', 'present mr lim medical') && !CORE.similarTitle('Present Mr Lim', 'Gym') && !CORE.similarTitle('FU Jason', 'FU Kelvin'), 'similar titles matched, different ones kept apart');
  // import by typing or pasting words
  const tx = join('Text Tester');
  const rt = h({op: 'readtext', token: tx.token, text: 'Esok 10am coffee Ali, call Mr Tan'}).read;
  ok(rt.events.length === 2 && rt.events[0].ok && rt.events[0].start === '10:00' && !rt.events[1].ok && rt.events[1].problems.includes('time unclear'), 'words read: clear appointment ready, one without a time flagged (never guessed)');
  ok(/Esok 10am coffee Ali/.test(s.prompts[s.prompts.length - 1].prompt) && s.prompts[s.prompts.length - 1].bytes === 0 && /never instructions/.test(s.prompts[s.prompts.length - 1].prompt), 'words sent to the AI as quoted data, no photo');
  throws(() => h({op: 'readtext', token: tx.token, text: '  '}), 'empty', 'empty words refused');
  ok(/CGBD/.test(CORE.readPrompt('2026-11-19')) && /DAY first/.test(CORE.readPrompt('2026-11-19')) && /sideways/.test(CORE.readPrompt('2026-11-19')), 'photo reader knows the CGBD weekly diary, day-first dates and sideways photos');
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
  s.pushes.length = 0; let slept = 0; s.sleep = ms => { slept = ms; };
  ok(h({op: 'pushtest', token: ali.token, delay: 15}).sent && slept === 15000 && s.pushes[0].ids[0] === ali.me.id, 'test in 15 s: waits, then pops up on my phone only');
  throws(() => h({op: 'pushtest', token: 'nobody', delay: 15}), 'signed_out', 'delayed test needs sign-in');
  ok(h({op: 'sync', token: ali.token, force: true}).me.devices === 1, 'app knows pop-ups are on');
  h({op: 'signout', token: ali.token, pushToken: 'x'.repeat(40)});
  ok(s.load('devices').length === 0, 'sign out stops pop-ups on that phone');
}



/* ---------- invitations: accept / reject ---------- */
{
  const {s, h, join} = fresh();
  const boss = join('Kah Jian', true), ali = join('Alicia Tan'), mar = join('Marcus Lim'), siti = join('Siti Aisyah'), dan = join('Daniel Ong');
  const ev = h({op: 'save', token: ali.token, event: {title: 'Joint present Mr Tan', start: iso(NOW + 5 * H), end: iso(NOW + 6 * H), with: [mar.me.id, siti.me.id]}}).event;
  ok(s.pushes.some(p => p.ids.includes(mar.me.id) && p.ids.includes(siti.me.id) && /invited you/.test(p.note.title)), 'both invitees get an invitation pop-up');
  s.pushes.length = 0;
  h({op: 'rsvp', token: mar.token, id: ev.id, answer: 'yes'});
  ok(s.pushes.length === 1 && s.pushes[0].ids[0] === ali.me.id && /Marcus Lim accepted/.test(s.pushes[0].note.title), 'accepting tells the owner');
  h({op: 'rsvp', token: siti.token, id: ev.id, answer: 'no'});
  ok(/Siti Aisyah rejected/.test(s.pushes[1].note.title), 'rejecting tells the owner');
  h({op: 'rsvp', token: siti.token, id: ev.id, answer: 'no'});
  ok(s.pushes.length === 2, 'same answer twice does not pop up again');
  throws(() => h({op: 'rsvp', token: dan.token, id: ev.id, answer: 'yes'}), 'not_team_event', 'someone not invited cannot answer');
  const a = CORE.answers(ev.id, s.load('msgs'));
  ok(a[mar.me.id] === 'yes' && a[siti.me.id] === 'no', 'answers stored');
  // comments: owner + accepted/pending invitees, not the one who rejected
  s.pushes.length = 0;
  h({op: 'send', token: mar.token, to: 'ev:' + ev.id, text: 'I bring the BI'});
  ok(s.pushes[0].ids.join() === ali.me.id, 'invitee comments -> owner (rejected Siti left out)');
  h({op: 'send', token: ali.token, to: 'ev:' + ev.id, text: 'Thanks'});
  ok(s.pushes[1].ids.join() === mar.me.id, 'owner replies -> accepted invitee, not the one who rejected');
  // reminder skips the person who rejected
  s.pushes.length = 0; s.setNow(NOW + 5 * H - 20 * 60e3); CORE.tick(s);
  const r = s.pushes.find(p => /Joint present/.test(p.note.title));
  ok(r && r.ids.sort().join() === [ali.me.id, mar.me.id].sort().join(), 'reminder goes to owner + accepted, not to who rejected');
  // she changes her mind
  h({op: 'rsvp', token: siti.token, id: ev.id, answer: 'yes'});
  ok(CORE.answers(ev.id, s.load('msgs'))[siti.me.id] === 'yes', 'can accept after rejecting');
}

/* ---------- partner calendars (husband & wife) ---------- */
{
  const {s, h, join} = fresh();
  const boss = join('Kah Jian', true), rex = join('Rex Tan'), wen = join('Wen Lim'), mar = join('Marcus Lim');
  const priv = h({op: 'save', token: wen.token, event: {title: 'Gynae check-up', start: iso(NOW + 5 * H), end: iso(NOW + 6 * H), vis: 'private'}}).event;
  const view = (tok, id) => h({op: 'sync', token: tok, force: true}).events.find(e => e.id === id);
  ok(view(rex.token, priv.id).busy, 'before linking: Rex sees only Busy');
  h({op: 'partner', token: rex.token, action: 'request', id: wen.me.id});
  ok(view(rex.token, priv.id).busy, 'a request alone shares nothing');
  ok(s.pushes.some(p => p.ids[0] === wen.me.id && /wants to link/.test(p.note.title)), 'partner gets a pop-up asking to link');
  ok(h({op: 'sync', token: wen.token, force: true}).me.partnerAsks.includes(rex.me.id), 'Wen sees the request');
  throws(() => h({op: 'partner', token: mar.token, action: 'accept', id: wen.me.id}), 'no_request', 'cannot accept a request that was not sent to you');
  h({op: 'partner', token: wen.token, action: 'accept', id: rex.me.id});
  ok(view(rex.token, priv.id).title === 'Gynae check-up', 'linked: Rex sees the private event of Wen in full');
  const rexPriv = h({op: 'save', token: rex.token, event: {title: 'Dentist', start: iso(NOW + 7 * H), end: iso(NOW + 8 * H), vis: 'private'}}).event;
  ok(view(wen.token, rexPriv.id).title === 'Dentist', 'and Wen sees the one of Rex');
  ok(view(mar.token, priv.id).busy && view(boss.token, priv.id).busy, 'everyone else (leader too) still sees Busy');
  ok(h({op: 'send', token: rex.token, to: 'ev:' + priv.id, text: 'I drive you'}).msg, 'partner can comment on the private event');
  throws(() => h({op: 'partner', token: mar.token, action: 'request', id: rex.me.id}) && h({op: 'partner', token: rex.token, action: 'accept', id: mar.me.id}), 'already_linked', 'a linked person cannot link to a second partner');
  throws(() => h({op: 'save', token: rex.token, event: {id: priv.id, title: 'x', start: iso(NOW + 5 * H)}}), 'not_yours', 'partner can see but not edit');
  h({op: 'partner', token: wen.token, action: 'unlink'});
  ok(view(rex.token, priv.id).busy && view(wen.token, rexPriv.id).busy, 'unlink: private again for both');
  h({op: 'partner', token: rex.token, action: 'request', id: wen.me.id}); h({op: 'partner', token: wen.token, action: 'request', id: rex.me.id});
  ok(view(rex.token, priv.id).title === 'Gynae check-up', 'both asking each other = linked');
  h({op: 'member', token: boss.token, id: wen.me.id, active: false});
  ok(!s.load('members').find(m => m.id === rex.me.id).partner, 'removing a member unlinks the partner');
}


/* ---------- short names (no surnames) ---------- */
{
  const {s, h, join} = fresh();
  const kj = join('WONG KAH JIAN'), mj = join('LIM MAY JING'), wen = join('Wen Lim');
  ok(CORE.defaultShort('WONG KAH JIAN') === 'KJ' && CORE.defaultShort('LIM MAY JING') === 'MJ' && CORE.defaultShort('Alicia Tan') === 'Alicia', 'suggested short name skips the surname');
  let sy = h({op: 'sync', token: kj.token, force: true});
  ok(sy.me.short === 'KJ' && !sy.me.shortSet && sy.members.find(m => m.id === mj.me.id).short === 'MJ', 'everyone gets a suggested short name');
  h({op: 'profile', token: wen.token, short: 'Wen'});
  sy = h({op: 'sync', token: kj.token, force: true});
  ok(sy.members.find(m => m.id === wen.me.id).short === 'Wen', 'own short name shows to the team');
  throws(() => h({op: 'profile', token: wen.token, short: 'kj'}), 'short_taken', 'two people cannot use the same short name');
  throws(() => h({op: 'profile', token: wen.token, short: '<b>'}), 'bad_short', 'odd characters refused');
  ok(h({op: 'profile', token: kj.token, short: '嘉健'}).short === '嘉健', 'Chinese short names allowed');
}


/* ---------- portraits ---------- */
{
  const {s, h, join} = fresh();
  const kj = join('WONG KAH JIAN', true), mj = join('LIM MAY JING');
  const img = 'A'.repeat(4000);
  const r = h({op: 'photo', token: mj.token, data: img});
  ok(r.photoV && h({op: 'sync', token: kj.token, force: true}).members.find(m => m.id === mj.me.id).photoV === r.photoV, 'photo saved; everyone sees its version');
  ok(!JSON.stringify(h({op: 'sync', token: kj.token, force: true})).includes('AAAAAAAAAA'), 'the picture itself is not in the calendar refresh (kept light)');
  ok(h({op: 'photos', token: kj.token, ids: [mj.me.id]}).photos[mj.me.id].d === img, 'phones download the picture separately');
  throws(() => h({op: 'photo', token: mj.token, data: 'A'.repeat(70000)}), 'photo_too_big', 'oversized photo refused');
  throws(() => h({op: 'photo', token: mj.token, data: '<script>' + 'A'.repeat(300)}), 'bad_photo', 'not a picture refused');
  h({op: 'photo', token: mj.token, data: ''});
  ok(!h({op: 'sync', token: kj.token, force: true}).members.find(m => m.id === mj.me.id).photoV, 'photo can be removed');
}


/* ---------- Release 2: repeats, holidays, to-do, goals, birthdays, PIN reset ---------- */
{
  const {s, h, join} = fresh();
  const kj = join('WONG KAH JIAN', true), mj = join('LIM MAY JING'), wx = join('WONG XIN');
  // repeating events
  const wk = h({op: 'save', token: mj.token, event: {title: 'Gym', type: 'personal', start: '2026-11-02T11:00:00.000Z', end: '2026-11-02T12:00:00.000Z', rep: 'w', repEnd: '2026-11-30'}}).event;
  ok(wk.rep === 'w' && wk.repEnd === '2026-11-30', 'repeat weekly saved with an end date');
  const occ = CORE.occurrences(s.load('events').find(e => e.id === wk.id), Date.parse('2026-11-01T00:00:00+08:00'), Date.parse('2026-12-31T00:00:00+08:00'));
  ok(occ.length === 5 && new Date(occ[4].s).toISOString() === '2026-11-30T11:00:00.000Z', 'weekly: 5 Mondays in Nov, stops at the end date');
  const mo = {start: '2026-01-31T02:00:00.000Z', end: '2026-01-31T03:00:00.000Z', rep: 'm', allDay: 'false'};
  ok(CORE.occurrences(mo, Date.parse('2026-01-01T00:00:00Z'), Date.parse('2026-06-01T00:00:00Z')).length === 3, 'monthly on the 31st skips months without a 31st (Jan, Mar, May)');
  const yr = {start: '2026-03-08', end: '2026-03-08', allDay: 'true', rep: 'y'};
  ok(CORE.occurrences(yr, Date.parse('2027-03-01T00:00:00+08:00'), Date.parse('2027-03-31T00:00:00+08:00')).length === 1, 'yearly birthday shows again next year');
  ok(h({op: 'sync', token: kj.token, from: '2027-02-28T16:00:00.000Z', to: '2027-03-31T16:00:00.000Z', force: true}).events.length === 0, 'nothing yearly yet for next March');
  h({op: 'save', token: mj.token, event: {title: '🎂 Mum birthday', type: 'personal', allDay: true, start: '2026-03-08', end: '2026-03-08', rep: 'y', vis: 'private'}});
  const mar27 = h({op: 'sync', token: mj.token, from: '2027-02-28T16:00:00.000Z', to: '2027-03-31T16:00:00.000Z', force: true}).events;
  ok(mar27.some(e => /Mum birthday/.test(e.title)), 'a yearly event made in 2026 is sent for March 2027');
  ok(CORE.stats([Object.assign({}, wk, {occ: '2026-11-09', out: '', type: 'present'})], 0, 9e15, 9e15)[mj.me.id] === undefined, 'repeat copies never count in activity numbers');
  // reminder for the next weekly occurrence, once each week
  s.pushes.length = 0; s.setNow('2026-11-09T10:35:00.000Z'); CORE.tick(s);
  ok(s.pushes.some(p => /Gym/.test(p.note.title)), 'repeating event reminder for this week’s Gym');
  CORE.tick(s); ok(s.pushes.filter(p => /Gym/.test(p.note.title)).length === 1, 'only once for that week');
  s.setNow('2026-11-16T10:35:00.000Z'); CORE.tick(s); ok(s.pushes.filter(p => /Gym/.test(p.note.title)).length === 2, 'and again next week');
  // holidays
  ok(CORE.holidaysOn('2026-11-08')[0].name === 'Deepavali' && CORE.holidaysOn('2027-02-06')[0].name === 'Chinese New Year', 'Deepavali 2026 and CNY 2027 on the calendar');
  ok(CORE.schoolHoliday('2026-12-10') && !CORE.schoolHoliday('2026-11-17'), 'school holidays (Kumpulan B)');
  // birthday + morning pop-up for the team
  h({op: 'profile', token: mj.token, bday: '11-20'});
  ok(h({op: 'sync', token: kj.token, force: true}).members.find(m => m.id === mj.me.id).bday === '11-20', 'birthday (day + month only) shared with the team');
  throws(() => h({op: 'profile', token: mj.token, bday: '02-30'}), 'bad_date', 'impossible birthday refused');
  s.pushes.length = 0; s.setNow('2026-11-20T00:00:00.000Z'); CORE.morning(s);
  ok(s.pushes.some(p => p.ids[0] === kj.me.id && /MJ’s birthday today/.test(p.note.title + p.note.body)), 'team gets a birthday pop-up in the morning');
  ok(s.pushes.some(p => p.ids[0] === mj.me.id && /Happy birthday/.test(p.note.title + p.note.body)), 'the birthday person gets a happy birthday');
  s.pushes.length = 0; s.setNow('2026-11-07T00:00:00.000Z'); CORE.morning(s);
  ok(s.pushes.some(p => /Tomorrow: Deepavali/.test(p.note.title + p.note.body)), 'holiday reminder the day before');
  s.setNow(null);
  // to-do
  const td = h({op: 'todo', token: mj.token, item: {text: 'Call Mr Lim about claim', q: 1, due: '2026-11-17'}}).todo;
  ok(td.q === '1' && td.due === '2026-11-17', 'to-do saved in quadrant 1');
  h({op: 'todo', token: mj.token, item: {id: td.id, text: td.text, q: 1, done: true}});
  ok(h({op: 'sync', token: mj.token, force: true}).todos[0].done, 'ticked as done');
  ok(!h({op: 'sync', token: kj.token, force: true}).todos.length, 'to-dos are private (leader sees none of MJ’s)');
  throws(() => h({op: 'tododel', token: kj.token, id: td.id}), 'not_found', 'cannot delete someone else’s to-do');
  // goals
  h({op: 'goal', token: mj.token, key: 'M2026-11', anp: 20000});
  ok(h({op: 'sync', token: mj.token, force: true}).goals.find(g => g.key === 'M2026-11').anp === '20000', 'monthly goal saved');
  throws(() => h({op: 'goal', token: mj.token, key: 'X1', anp: 5}), 'bad_request', 'odd goal period refused');
  // PIN reset by a leader
  throws(() => h({op: 'member', token: wx.token, id: mj.me.id, reset: true}), 'leader_only', 'only leaders can reset a PIN');
  const tmp = h({op: 'member', token: kj.token, id: mj.me.id, reset: true}).tempPin;
  ok(/^\d{6}$/.test(tmp), 'leader gets a 6-digit temporary PIN');
  s.resetFails(); throws(() => h({op: 'signin', code: 'test-team', name: 'LIM MAY JING', pin: '1234'}), 'wrong_pin', 'old PIN no longer works');
  s.resetFails(); const back = h({op: 'signin', code: 'test-team', name: 'lim may jing', pin: tmp});
  ok(back.mustChange, 'signing in with the temporary PIN asks for a new one');
  h({op: 'changepin', token: back.token, pin: '2468'}); s.resetFails();
  ok(!h({op: 'signin', code: 'test-team', name: 'LIM MAY JING', pin: '2468'}).mustChange, 'new PIN works, no more prompt');
  ok(h({op: 'sync', token: mj.token, force: true}).me.name === 'LIM MAY JING', 'her other phone stays signed in after the reset');
}


/* ---------- Release 3: calendar subscription, voice booking, celebration themes, other devices ---------- */
{
  const {s, h, join} = fresh(); s.props.APP_URL = 'https://app.example/';
  const kj = join('WONG KAH JIAN', true), al = join('ALICIA TAN', true), mj = join('LIM MAY JING'), wx = join('WONG XIN');
  // subscription feed
  const own = h({op: 'save', token: mj.token, event: {title: 'Present to Mr Lim; family, kids', type: 'present', start: '2027-03-03T07:00:00.000Z', end: '2027-03-03T08:00:00.000Z', vis: 'private', notes: 'Bring BI\nand forms', remind: '30', with: [wx.me.id]}}).event;
  h({op: 'save', token: mj.token, event: {title: '🎂 Mum birthday', type: 'personal', allDay: true, start: '2026-03-08', end: '2026-03-08', rep: 'y', vis: 'private'}});
  h({op: 'save', token: kj.token, event: {title: 'Monday meeting', type: 'meeting', start: '2027-03-02T11:00:00.000Z', end: '2027-03-02T13:00:00.000Z', all: true}});
  h({op: 'save', token: wx.token, event: {title: 'WX own thing', type: 'open', start: '2027-03-04T07:00:00.000Z', end: '2027-03-04T08:00:00.000Z'}});
  const fd = h({op: 'feed', token: mj.token}).feed;
  ok(/^[a-z0-9]{36}$/.test(fd), 'each member gets a long secret subscription link');
  ok(h({op: 'feed', token: mj.token}).feed === fd, 'the same link every time (works on all devices)');
  const icsRaw = CORE.feedIcs(fd, s), ics = icsRaw.replace(/\r\n /g, '');
  ok(/^BEGIN:VCALENDAR\r\n/.test(ics) && /END:VCALENDAR\r\n$/.test(ics), 'feed is a valid calendar file');
  ok(ics.includes('SUMMARY:📊 Present to Mr Lim\\; family\\, kids') && ics.includes('Bring BI\\nand forms'), 'private appointment in full, special characters escaped');
  ok(ics.includes('Open in our Calendar: https://app.example/#/e/' + own.id) && ics.includes('URL:https://app.example/#/e/' + own.id), 'each event links back to the app');
  ok(ics.includes('RRULE:FREQ=YEARLY') && ics.includes('DTSTART;VALUE=DATE:20260308') && ics.includes('DTEND;VALUE=DATE:20260309'), 'yearly all-day birthday repeats in the subscribed calendar');
  ok(/Monday meeting/.test(ics) && ics.includes('Team event'), 'whole-team events are included');
  ok(!/WX own thing/.test(ics), 'other people’s appointments are not in my feed');
  ok(ics.includes('TRIGGER:-PT30M'), 'my reminder comes along');
  ok(icsRaw.split('\r\n').every(l => Buffer.byteLength(l) <= 75), 'long lines folded at 75 bytes');
  const wxf = h({op: 'feed', token: wx.token}).feed;
  ok(CORE.feedIcs(wxf, s).includes('❔ 📊 Present to Mr Lim'), 'an invitation not yet answered shows with ❔');
  h({op: 'rsvp', token: wx.token, id: own.id, answer: 'no'});
  ok(!CORE.feedIcs(wxf, s).includes('Present to Mr Lim'), 'a rejected invitation leaves the feed');
  const fd2 = h({op: 'feed', token: mj.token, reset: true}).feed;
  ok(fd2 !== fd && CORE.feedIcs(fd, s) === '' && CORE.feedIcs(fd2, s).length > 100, 'new link: the old one stops working');
  h({op: 'feed', token: mj.token, off: true}); ok(CORE.feedIcs(fd2, s) === '', 'subscription can be switched off');
  ok(CORE.feedIcs('', s) === '' && CORE.feedIcs('short', s) === '', 'no or short secret gives nothing');
  // voice booking
  const audio = 'A'.repeat(4000);
  s.setNow('2027-03-02T02:00:00.000Z');
  const v = h({op: 'voice', token: mj.token, audio, mime: 'audio/webm;codecs=opus'}).voice;
  ok(v.complete && v.event.date === '2027-03-03' && v.event.start === '15:00' && v.event.type === 'present' && v.event.place === 'Gurney Plaza', 'voice: tomorrow 3pm presentation understood');
  ok(s.prompts[s.prompts.length - 1].quick, 'voice booking uses the quick AI read (answer in seconds)');
  ok(s.heard[0].mime === 'audio/webm' && /VOICE BOOKING/.test(s.prompts[s.prompts.length - 1].prompt) && /Tuesday/.test(s.prompts[s.prompts.length - 1].prompt), 'speech sent to text, then read with today’s weekday');
  const part = CORE.parseVoice(JSON.stringify({title: 'Jumpa Ali', type: 'open', date: '', start: '', people: ['Wong', 'nobody']}), 'jumpa ali', s.load('members'));
  ok(!part.complete && part.missing.join() === 'date,time' && part.event.with.join() === wx.me.id, 'voice: missing date/time reported, teammate found by short name');
  throws(() => h({op: 'voice', token: mj.token, audio, mime: 'video/mp4'}), 'bad_audio', 'odd recording refused');
  throws(() => h({op: 'voice', token: mj.token, audio: 'A'.repeat(4 * 1024 * 1024), mime: 'audio/webm'}), 'bad_audio', 'recording too long refused');
  // voice to-do and voice note: the words are saved as they are, in the box held
  const vt = h({op: 'voicetodo', token: mj.token, audio, mime: 'audio/webm', kind: '', q: '3'}).todo;
  ok(vt.q === '3' && vt.src === 'voice' && /Mr Lim/.test(vt.text) && !vt.kind, 'voice to-do saved in the box that was held, transcript as the text');
  const vn = h({op: 'voicetodo', token: mj.token, audio, mime: 'audio/webm', kind: 'note'}).todo;
  ok(vn.kind === 'note' && /Mr Lim/.test(vn.text) && vn.q === '' && vn.src === 'voice', 'voice note saved as a note');
  throws(() => h({op: 'voicetodo', token: mj.token, audio, mime: 'video/mp4'}), 'bad_audio', 'voice to-do: odd recording refused');
  // edit details and move a to-do to another box; notes keep long text
  const ed = h({op: 'todo', token: mj.token, item: {id: vt.id, text: 'Call Mr Lim', q: '4', notes: 'Ask about the claim form', due: '2027-03-05'}}).todo;
  ok(ed.q === '4' && ed.text === 'Call Mr Lim' && ed.notes === 'Ask about the claim form' && ed.due === '2027-03-05' && ed.src === 'voice', 'to-do edited: text, details, date and box changed');
  const nt = h({op: 'todo', token: mj.token, item: {kind: 'note', text: 'x'.repeat(1200), q: '2', due: '2027-01-01'}}).todo;
  ok(nt.kind === 'note' && nt.text.length === 1200 && nt.q === '' && nt.due === '', 'note keeps long text, has no box or date');
  ok(h({op: 'todo', token: mj.token, item: {id: nt.id, text: 'Short now', kind: ''}}).todo.kind === 'note', 'a note stays a note when edited');
  throws(() => h({op: 'todo', token: kj.token, item: {id: nt.id, text: 'hack'}}), 'not_found', 'nobody else can edit my note');
  s.setNow(null);
  // celebration themes: owner only
  ok(h({op: 'sync', token: kj.token, force: true}).me.owner && !h({op: 'sync', token: al.token, force: true}).me.owner, 'owner = first leader (other leaders are not)');
  s.props.OWNER_NAME = 'alicia tan'; ok(CORE.isOwner(al.me.id ? s.load('members').find(m => m.id === al.me.id) : null, s), 'OWNER_NAME picks the owner'); s.props.OWNER_NAME = '';
  throws(() => h({op: 'themeson', token: al.token, on: true}), 'owner_only', 'other leaders cannot change themes');
  throws(() => h({op: 'themeai', token: mj.token, poster: 'B'.repeat(5000)}), 'owner_only', 'agents cannot use the poster reader');
  const look = h({op: 'themeai', token: kj.token, poster: 'B'.repeat(5000)}).theme;
  ok(look.occasion === 'christmas' && look.colors.primary === '#B91C1C' && look.anim === 'snow' && look.motifs.length === 3, 'AI reads the poster into colours, animation and pictures');
  const th = h({op: 'theme', token: kj.token, theme: Object.assign({}, look, {from: '2026-12-20', to: '2026-12-26'}), poster: 'C'.repeat(120000), music: 'D'.repeat(200000), musicMime: 'audio/mpeg', musicName: 'jingle.mp3'}).theme;
  ok(th.poster && th.music && s.getFile(th.poster).data.length === 120000, 'poster and music saved');
  ok(!h({op: 'sync', token: mj.token, force: true}).themes.length, 'nothing shows while themes are switched off');
  h({op: 'themeson', token: kj.token, on: true});
  s.setNow('2026-12-01T00:00:00.000Z');
  const sy = h({op: 'sync', token: mj.token, force: true});
  ok(sy.themesOn && sy.themes.length === 1 && sy.themes[0].colors.bg === '#FFF5F5' && !('data' in sy.themes[0]), 'everyone gets the coming theme (without the big files)');
  ok(h({op: 'file', token: mj.token, id: th.music}).file.data.length === 200000, 'phones fetch the music once');
  throws(() => h({op: 'file', token: mj.token, id: 'x123'}), 'not_found', 'only theme files can be fetched');
  throws(() => h({op: 'theme', token: kj.token, theme: {occasion: 'cny', from: '2027-02-10', to: '2027-02-01', colors: {bg: '#ffffff', primary: '#cc0000'}}}), 'bad_date', 'end before start refused');
  throws(() => h({op: 'theme', token: kj.token, theme: {occasion: 'cny', from: '2027-02-01', to: '2027-02-10', colors: {bg: 'red', primary: '#cc0000'}}}), 'bad_theme', 'bad colour refused');
  h({op: 'themedel', token: kj.token, id: th.id});
  ok(!s.getFile(th.poster) && !s.getFile(th.music) && !h({op: 'sync', token: mj.token, force: true}).themes.length, 'deleting a theme removes its files');
  s.setNow(null);
  // other devices: everything is on the server; kept chips follow the person
  h({op: 'profile', token: mj.token, merges: wx.me.id + ',' + kj.me.id});
  s.resetFails(); const ipad = h({op: 'signin', code: 'test-team', name: 'LIM MAY JING', pin: '1234', device: 'iPad'});
  const onIpad = h({op: 'sync', token: ipad.token, force: true});
  ok(onIpad.me.merges === wx.me.id + ',' + kj.me.id, 'kept Me + chips appear on a new device');
  h({op: 'todo', token: ipad.token, item: {text: 'From the iPad', q: 2}});
  ok(h({op: 'sync', token: mj.token, force: true}).todos.some(x => x.text === 'From the iPad'), 'to-do added on the iPad shows on the phone');
  throws(() => h({op: 'profile', token: mj.token, merges: '<x>'}), 'bad_request', 'odd kept-chip list refused');
}


/* ---------- best time for a team activity ---------- */
{
  const {s, h, join} = fresh();
  const kj = join('WONG KAH JIAN', true), a = join('ALICIA TAN'), b = join('BEN LIM'), c = join('CARMEN WONG'), quiet = join('QUIET NEWBIE');
  s.setNow('2026-11-02T01:00:00.000Z');   // Mon 2 Nov 2026, 9am Malaysia time
  const at = (d, hh, mins) => ({start: new Date(Date.parse(d + 'T' + hh + ':00+08:00')).toISOString(), end: new Date(Date.parse(d + 'T' + hh + ':00+08:00') + (mins || 120) * 60e3).toISOString()});
  // past 8 weeks: Alicia and Ben always busy on Wednesday 8pm; everyone has some daytime work
  for (let w = 1; w <= 8; w++) {
    const day = new Date(Date.parse('2026-11-04T00:00:00Z') - w * 7 * 864e5).toISOString().slice(0, 10);
    const mon = new Date(Date.parse('2026-11-02T00:00:00Z') - w * 7 * 864e5).toISOString().slice(0, 10);
    for (const p of [a, b]) h({op: 'save', token: p.token, event: Object.assign({title: 'Class', type: 'personal'}, at(day, '20:00'))});
    for (const p of [kj, c]) h({op: 'save', token: p.token, event: Object.assign({title: 'Present client', type: 'present'}, at(mon, '10:00'))});
  }
  // next week: Carmen booked on Thursday 8pm; Ben on leave all Friday
  h({op: 'save', token: c.token, event: Object.assign({title: 'Dinner', type: 'personal', vis: 'private'}, at('2026-11-05', '20:00'))});
  h({op: 'save', token: b.token, event: {title: 'Leave', type: 'personal', allDay: true, start: '2026-11-06', end: '2026-11-06'}});
  throws(() => h({op: 'besttime', token: a.token}), 'leader_only', 'only leaders can look for the best time');
  const r = h({op: 'besttime', token: kj.token, dur: 120, days: 14, when: 'evening'});
  ok(r.of === 4 && r.notCounted.join() === 'QUIET', 'people who barely use the calendar are listed, not counted');
  ok(r.slots.length >= 5 && r.slots.every(x => x.free === 4 || x.expected < r.slots[0].expected + 0.01), 'returns the best slots first');
  ok(!r.slots.some(x => x.day === '2026-11-04' && x.start === '2026-11-04T12:00:00.000Z'), 'Wednesday 8pm is not suggested (2 people are usually busy then)');
  ok(r.slots[0].free === 4 && r.slots[0].expected === 4, 'top slot: everyone free and usually free');
  const thu = h({op: 'besttime', token: kj.token, dur: 120, days: 3, when: 'evening'}).slots.find(x => x.day === '2026-11-05');
  ok(!thu || thu.free === 4 || !thu.busy.includes('CARMEN') || thu.start !== '2026-11-05T12:00:00.000Z', 'a booked private dinner counts as busy');
  const all = h({op: 'besttime', token: kj.token, dur: 60, days: 7, when: 'any'});
  const fri = all.slots.find(x => x.day === '2026-11-06');
  ok(!fri || fri.busy.includes('BEN'), 'all-day leave blocks the whole day');
  ok(r.heat.length === 7 && r.heat[2].cells[4] <= 50 && r.heat[0].cells[4] === 100, 'pattern table: Wednesday night usually busy, Monday night free');
  ok(all.slots.every(x => Date.parse(x.start) >= Date.parse('2026-11-02T02:00:00.000Z')), 'never suggests a time already past or within the hour');
  const rg = h({op: 'besttime', token: kj.token, dur: 120, when: 'evening', from: '2026-11-09', to: '2026-11-13'});
  ok(rg.from === '2026-11-09' && rg.to === '2026-11-13' && rg.byDay.map(x => x.day).join() === '2026-11-09,2026-11-10,2026-11-11,2026-11-12,2026-11-13', 'chosen From–To dates: one best slot for every weekday night');
  ok(rg.slots.every(x => x.day >= '2026-11-09' && x.day <= '2026-11-13'), 'suggestions stay inside the chosen dates');
  const wed = rg.byDay.find(x => x.day === '2026-11-11'); ok(wed.start === '2026-11-11T10:00:00.000Z', 'Wednesday: suggests 6-8pm, before the usual 8pm class');
  throws(() => h({op: 'besttime', token: kj.token, from: '2026-11-20', to: '2026-11-10'}), 'bad_date', 'To before From refused');
  ok(h({op: 'besttime', token: kj.token, from: '2026-10-01', to: '2026-11-05'}).from === '2026-11-02', 'past From starts from today');
  s.setNow(null);
}


/* ---------- voice note saves straight into the calendar ---------- */
{
  const {s, h, join} = fresh();
  const kj = join('WONG KAH JIAN', true), mj = join('LIM MAY JING');
  s.setNow('2027-03-02T02:00:00.000Z');
  const r = h({op: 'voice', token: mj.token, audio: 'A'.repeat(4000), mime: 'audio/mp4', save: true});
  const ev = s.load('events').find(e => e.id === r.event.id);
  ok(ev && ev.ownerId === mj.me.id && ev.source === 'voice' && ev.start === '2027-03-03T07:00:00.000Z' && ev.end === '2027-03-03T08:00:00.000Z', 'voice note saved at once: tomorrow 3pm for an hour');
  ok(/You said: “Esok pukul 3 petang/.test(ev.notes) && !/Not said/.test(ev.notes) && ev.remind === '30', 'what was said is kept in the notes to check later');
  const v2 = CORE.voiceToEvent(CORE.parseVoice(JSON.stringify({title: 'Jumpa Ali', type: 'open'}), 'jumpa ali', s.load('members')), Date.parse('2027-03-02T02:00:00.000Z'));
  ok(v2.allDay && v2.start === '2027-03-02' && /Not said: the date, the time/.test(v2.notes), 'no date or time said: saved today as all-day, marked to check');
  const v3 = CORE.voiceToEvent(CORE.parseVoice(JSON.stringify({title: '', date: '2027-03-05', start: '10:00'}), 'uh 5th 10am', s.load('members')), 0);
  ok(v3.title === '🎤 uh 5th 10am' && v3.start === '2027-03-05T02:00:00.000Z', 'no title said: uses what was heard');
  throws(() => h({op: 'checked', token: kj.token, id: ev.id}), 'not_yours', 'only the owner marks it checked');
  h({op: 'checked', token: mj.token, id: ev.id});
  ok(s.load('events').find(e => e.id === ev.id).source === 'voiceok', 'marked as checked');
  ok(s.load('settings').some(x => /^reads_/.test(x.key)), 'counts towards the daily limit');
  s.setNow(null);
}

/* ---------- join field (陪访) type ---------- */
{
  ok(CORE.TYPES.joinfield && CORE.TYPE_ORDER.indexOf('joinfield') > 0, 'join field is an activity type');
  ok(CORE.detectType('Join field Mr Lim with KJ') === 'joinfield' && CORE.detectType('陪访 Ali') === 'joinfield' && CORE.detectType('JF present Mr Tan') === 'joinfield', 'join field picked from the title (EN / 中文)');
  ok(CORE.detectType('Present Mr Lim medical card') === 'present', 'other titles unchanged');
  const st = CORE.stats([{ownerId: 'x', type: 'joinfield', start: '2026-11-03T02:00:00.000Z', end: '2026-11-03T03:00:00.000Z', out: 'done'}], 0, 9e15, 9e15).x;
  ok(st.joinfield === 1 && st.P === 0, 'a confirmed join field counts as join field (not as a presentation)');
}

/* ---------- presentation = appointment (O); postpone ---------- */
{
  const {s, h, join} = fresh();
  const ali = join('Alicia Tan'), kj = join('Kah Jian', true);
  const mk = (title, hoursAgo, extra) => h({op: 'save', token: ali.token, event: Object.assign({title, start: iso(NOW - hoursAgo * H), end: iso(NOW - hoursAgo * H + 2 * H)}, extra || {})}).event;
  const st = () => CORE.stats(s.load('events'), NOW - 7 * D, NOW + 7 * D, NOW)[ali.me.id];
  const p1 = mk('Present Jason', 30), p2 = mk('Present Mei', 20, {with: [kj.me.id]}), p3 = mk('Present Ravi', -24);
  ok(st().O === 3 && st().P === 0, 'presentations set: O +1 each, P waits for Done');
  h({op: 'outcome', token: ali.token, id: p1.id, out: 'done'});
  h({op: 'outcome', token: ali.token, id: p2.id, out: 'cancel'});
  ok(st().O === 3 && st().P === 1 && st().cancelled === 1, 'done: O and P; did not happen: O only');
  s.pushes.length = 0;
  const moved = h({op: 'postpone', token: ali.token, id: p2.id, date: '2026-11-14', time: '15:00'}).event;
  const row = s.load('events').find(e => e.id === p2.id);
  ok(row.start === '2026-11-14T07:00:00.000Z' && row.end === '2026-11-14T09:00:00.000Z' && row.out === '' && row.remSent === '', 'postponed: new date, same 2 hours, waiting to happen again');
  ok(/^📅 Postponed from /.test(row.notes) && moved.id === p2.id, 'the old date is kept in the notes');
  ok(s.pushes.some(p => p.ids[0] === kj.me.id && /Postponed/.test(p.note.title)), 'invited people get a pop-up');
  ok(st().O === 3, 'still one appointment (O not counted twice)');
  throws(() => h({op: 'postpone', token: ali.token, id: p1.id, date: '2026-11-20', time: '15:00'}), 'already_done', 'a done presentation cannot be postponed');
  throws(() => h({op: 'postpone', token: kj.token, id: p3.id, date: '2026-11-20', time: '15:00'}), 'not_yours', 'only the owner postpones');
  throws(() => h({op: 'postpone', token: ali.token, id: p3.id, date: '2026-11-31', time: '15:00'}), 'bad_date', 'impossible date refused');
}

/* ---------- Open removed: new events become presentations, old Open events still count ---------- */
{
  const {s, h, join} = fresh();
  const ali = join('Alicia Tan');
  ok(CORE.TYPE_ORDER.indexOf('open') < 0, 'Open is not offered any more');
  const e = h({op: 'save', token: ali.token, event: {title: 'Ali', type: 'open', start: iso(NOW - 3 * H), end: iso(NOW - 2 * H)}}).event;
  ok(e.type === 'present', 'an event sent as Open is saved as a presentation');
  ok(CORE.parseRead(JSON.stringify({events: [{date: '2026-11-10', start: '10:00', title: 'Ali', type: 'open', confidence: 0.9}]})).events[0].type === 'present', 'photo import: Open becomes Presentation');
  ok(CORE.parseVoice(JSON.stringify({title: 'Ali', type: 'open'}), 'x', []).event.type === 'present', 'voice: Open becomes Presentation');
  const rows = s.load('events'); rows.push({id: 'old1', ownerId: ali.me.id, title: 'FF Jason (2025)', type: 'open', start: iso(NOW - 5 * H), end: iso(NOW - 4 * H), out: 'done', vis: 'team', with: ''}); s.save('events', rows);
  const st = CORE.stats(s.load('events'), NOW - D, NOW + D, NOW)[ali.me.id];
  ok(st.O === 2 && st.P === 0, 'an old Open event marked Done still counts O (history unchanged)');
}

/* ---------- sample team sanity ---------- */
{
  const s = memStore(); seed(s, NOW);
  const evs = s.load('events');
  ok(evs.length > 500 && s.load('members').length === 10, 'sample team has 10 people and a full calendar');
  const by = CORE.stats(evs, NOW - 30 * D, NOW, NOW);
  ok(Object.keys(by).length >= 9, 'every sample agent has activity');
}

/* the app checks docs/version.json to update itself: it must match APP_VERSION in docs/app.js */
{ const fs = require('fs'), v = JSON.parse(fs.readFileSync(__dirname + '/docs/version.json', 'utf8')).v, m = /APP_VERSION = '([0-9]+)'/.exec(fs.readFileSync(__dirname + '/docs/app.js', 'utf8'));
  ok(m && m[1] === v, 'docs/version.json (' + v + ') matches APP_VERSION (' + (m && m[1]) + ')'); }

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
