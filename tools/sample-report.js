// Writes samples/ : the leader's WhatsApp report + CSV for "this month" from the SAMPLE team, using the app's own counting rules.
const fs = require('fs'), path = require('path'), CORE = require('../docs/core.js'), memStore = require('./memstore.js'), {seed} = require('./serve.js');
const now = Date.now(), s = memStore(); seed(s, now);
const t = new Date(now + 8 * 3600e3), from = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1) - 8 * 3600e3, to = Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1) - 8 * 3600e3;
const label = t.toLocaleString('en', {month: 'long', timeZone: 'UTC'}) + ' ' + t.getUTCFullYear();
const by = CORE.stats(s.load('events'), from, to, now), rm = n => 'RM' + Math.round(n).toLocaleString('en-MY'), pct = x => x == null ? '–' : Math.round(x * 100) + '%';
const rows = s.load('members').map(m => ({m, s: by[m.id] || CORE.addStats([])})).sort((a, b) => b.s.anp - a.s.anp || b.s.P - a.s.P);
const tot = CORE.addStats(rows.map(r => r.s)), tq = CORE.ratios(tot), act = x => x.A + x.O + x.P + x.F + x.recruit;
const lines = ['*REDEFINE activity · ' + label + ' (to date)*', '*Team total: ' + act(tot) + ' activities · NOC ' + tot.C + ' · ANP ' + rm(tot.anp) + '*', 'A ' + tot.A + ' · O ' + tot.O + ' · P ' + tot.P + ' · F ' + tot.F + ' · R ' + tot.recruit, 'Closing ' + pct(tq.CP) + ' · Avg case ' + (tq.M == null ? '–' : rm(tq.M)), ''];
rows.forEach((r, i) => { const x = r.s; lines.push((i + 1) + '. ' + r.m.name + ': A' + x.A + ' O' + x.O + ' P' + x.P + ' F' + x.F + ' R' + x.recruit + ' = ' + act(x) + ' · NOC ' + x.C + (x.anp ? ' · ' + rm(x.anp) : '') + (x.unconfirmed ? ' · ⚠️' + x.unconfirmed + ' unconfirmed' : '')); });
lines.push('', 'Confirmed activities only. Keep your calendar updated 💪');
const head = ['Agent', 'Approach', 'Open', 'Present', 'Follow-up', 'Recruit', 'Total activities', 'NOC', 'ANP', 'Avg case', 'O/A', 'P/O', 'F/P', 'NOC/P', 'Meeting', 'Service', 'CRM', 'Paperwork', 'Not confirmed'];
const csv = [head.join(',')].concat(rows.concat([{m: {name: 'TEAM TOTAL'}, s: tot}]).map(r => { const x = r.s, q = CORE.ratios(x); return [r.m.name, x.A, x.O, x.P, x.F, x.recruit, act(x), x.C, x.anp, q.M == null ? '' : Math.round(q.M), pct(q.OA), pct(q.PO), pct(q.FP), pct(q.CP), x.meeting, x.service, x.crm, x.paperwork, x.unconfirmed].join(','); }));
const dir = path.join(__dirname, '..', 'samples'); fs.mkdirSync(dir, {recursive: true});
fs.writeFileSync(path.join(dir, 'Leader WhatsApp report - SAMPLE.txt'), 'SAMPLE TEAM - made-up people\n\n' + lines.join('\n') + '\n');
fs.writeFileSync(path.join(dir, 'Leader activity - SAMPLE.csv'), '\ufeff' + csv.join('\n') + '\n');
console.log(lines.join('\n'));
