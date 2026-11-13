// Local test server (port 5200): serves docs/ and runs the REAL server rules (docs/core.js) in memory at /gas,
// seeded with a SAMPLE team (made-up agents and made-up clients). Nothing leaves this PC; the AI is a stand-in.
// Team code "test-team", leader code "test-leader-code", every sample member's PIN is 1234.
// Reminder jobs run every 30 s here (every 5 min on Google). Pop-ups are printed in this window instead of sent.
const http = require('http'), fs = require('fs'), path = require('path');
const CORE = require('../docs/core.js'), memStore = require('./memstore.js');
const ROOT = path.join(__dirname, '..'), DOCS = path.join(ROOT, 'docs'), FIX = path.join(ROOT, 'test', 'fixtures');
const PORT = +process.env.PORT || 5200;

function seed(store, nowMs) {
  let r = 11; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647, pick = a => a[Math.floor(rnd() * a.length)];
  const iso = t => new Date(t).toISOString();
  const team = [
    ['Kah Jian', 'leader', '#E8505B'], ['Alicia Tan', 'leader', '#2E86DE'], ['Marcus Lim', 'agent', '#10AC84'], ['Siti Aisyah', 'agent', '#F39C12'],
    ['Daniel Ong', 'agent', '#8E44AD'], ['Jia Wen', 'agent', '#16A085'], ['Kelvin Goh', 'agent', '#D35400'], ['Priya Nair', 'agent', '#E84393'],
    ['Hafiz Rahman', 'agent', '#0984E3'], ['Mei Ling', 'agent', '#6C5CE7']
  ];
  const members = team.map(([name, role, color], i) => ({id: 'm' + i, name, pin: store.hash('rcal|1234|' + name.toLowerCase()), role, color, created: iso(nowMs - 300 * 864e5), active: 'true'}));
  // how busy / how diligent each sample agent is (some confirm everything, one forgets)
  const busy = [0.7, 1.0, 1.3, 1.1, 0.8, 1.2, 0.5, 1.0, 0.9, 0.6], diligent = [1, 0.95, 0.97, 0.9, 0.75, 0.95, 0.4, 0.9, 0.85, 0.9];
  const clients = ['Mr Lim', 'Ms Tan', 'Wei Jie', 'Mei Yee', 'Encik Zul', 'Bee Leng', 'Jun Kit', 'Puan Nurul', 'Arjun', 'Shu Ting', 'Hui Min', 'Mr Khoo', 'Farah', 'Chee Keong', 'Li Ying', 'Ravi', 'Amir', 'Xin Yi', 'Boon Hock', 'Aina', 'Dr Teoh', 'Mr & Mrs Yeoh'];
  const needs = ['medical card', 'family protection', 'CI plan', 'savings plan', 'retirement', 'education fund', 'ILP review'];
  const T = {
    approach: () => pick(['Approach: USM booth', 'Approach: coffee with new friends', 'Cold call list', 'Approach: Queensbay roadshow', 'Approach: gym friends', 'Approach: referrals from ' + pick(clients)]),
    open: () => pick(['FF ', 'Fact-find ', 'Coffee + fact-find ', '1st meet ']) + pick(clients),
    present: () => 'Present ' + pick(clients) + ' (' + pick(needs) + ')',
    followup: () => 'FU ' + pick(clients) + ' ' + pick(needs),
    close: () => 'Closing ' + pick(clients) + ' ' + pick(needs),
    recruit: () => pick(['Interview intern ', 'Career talk with ', 'Recruit coffee ']) + pick(['Jason', 'Hui Xin', 'Aiman', 'Kavitha', 'Ethan', 'Wen Qi']),
    service: () => pick(['Claim help ', 'Nominee change ', 'Servicing ', 'Renewal check ']) + pick(clients),
    crm: () => pick(['Birthday gift ', 'CRM makan with ', 'Festive visit ']) + pick(clients),
    paperwork: () => pick(['Paperwork: submit cases', 'ePartner key-in', 'Admin + forms']),
    personal: () => pick(['Gym', 'Family dinner', 'Daughter swimming class', 'Badminton', 'Doctor appointment', 'Parents visit', 'Movie night'])
  };
  const typeBag = ['approach', 'approach', 'approach', 'open', 'open', 'open', 'present', 'present', 'present', 'followup', 'followup', 'close', 'recruit', 'service', 'crm', 'paperwork', 'personal', 'personal', 'personal'];
  const events = [], msgs = []; let id = 0;
  const dayStart = d => { const x = new Date(nowMs + 8 * 3600e3); x.setUTCHours(0, 0, 0, 0); return x.getTime() - 8 * 3600e3 + d * 864e5; };   // midnight MYT
  const add = (o) => { const e = Object.assign({id: 'e' + (++id), place: '', notes: '', vis: 'team', with: '', remind: '30', count: '', out: '', anp: '', source: 'manual', remSent: '', created: iso(nowMs - 40 * 864e5), updated: iso(nowMs - 40 * 864e5)}, o); events.push(e); return e; };
  for (let d = -42; d <= 24; d++) {
    const ds = dayStart(d), dow = new Date(ds + 8 * 3600e3).getUTCDay();
    // team rhythm: Monday 8pm meeting, Wednesday 10am training (owned by Kah Jian, everyone tagged)
    if (dow === 1) add({ownerId: 'm0', title: 'REDEFINE Monday team meeting', type: 'meeting', start: iso(ds + 20 * 3600e3), end: iso(ds + 21.5 * 3600e3), allDay: 'false', place: 'SG Farlim', all: 'true', out: d < 0 ? 'done' : ''});
    if (dow === 3) add({ownerId: 'm0', title: 'Wednesday training: objection handling', type: 'meeting', start: iso(ds + 10 * 3600e3), end: iso(ds + 12 * 3600e3), allDay: 'false', place: 'SG Farlim', all: 'true', out: d < 0 ? 'done' : ''});
    members.forEach((m, i) => {
      const n = Math.round((dow === 0 ? 0.8 : dow === 6 ? 1.6 : 2.6) * busy[i] * (0.5 + rnd()));
      const used = {};
      for (let k = 0; k < n; k++) {
        let h = 9 + Math.floor(rnd() * 12); while (used[h] || used[h + 1]) h = 9 + Math.floor(rnd() * 13); used[h] = 1;
        const type = pick(typeBag), half = rnd() < 0.4 ? 0.5 : 0, len = type === 'paperwork' || type === 'approach' ? 2 : 1 + (rnd() < 0.3 ? 0.5 : 0);
        const e = {ownerId: m.id, title: T[type](), type, start: iso(ds + (h + half) * 3600e3), end: iso(ds + (h + half + len) * 3600e3), allDay: 'false'};
        if (type === 'personal') e.vis = 'private';
        else if (rnd() < 0.18) e.vis = 'private';   // some agents hide client meetings: team sees "Busy"
        if (type === 'approach') e.count = String(2 + Math.floor(rnd() * 7));
        if (type === 'present' || type === 'close') e.place = pick(['Starbucks Gurney', 'Client office', 'Queensbay Mall', 'SG Farlim', 'Client home, Air Itam', 'Old Town Bayan Lepas']);
        if (rnd() < 0.12 && i > 1) e.with = 'm' + (rnd() < 0.5 ? 0 : 1);   // joint field work with a leader
        const past = ds + (h + half + len) * 3600e3 < nowMs;
        if (past && type !== 'personal') {
          if (rnd() < diligent[i]) {
            if (rnd() < 0.06) e.out = 'cancel';
            else if (CORE.PROSPECT[type] && rnd() < ({open: 0, present: 0.2, followup: 0.22, close: 0.45})[type]) { e.out = 'closed'; const n = rnd() < 0.2 ? 2 : 1, cs = []; for (let c = 0; c < n; c++) cs.push({plan: pick(['Medical plan', 'Critical illness plan', 'Family protection plan', 'Savings plan', 'Investment-linked plan']) + ' (sample)', anp: rnd() < 0.92 ? Math.round((1200 + rnd() * 6000) / 100) * 100 : '', mode: pick(['M', 'M', 'M', 'Q', 'HY', 'Y'])}); e.cases = JSON.stringify(cs); e.noc = String(n); const k = cs.filter(c => c.anp !== ''); e.anp = k.length ? String(k.reduce((t, c) => t + c.anp, 0)) : ''; }
            else e.out = 'done';
          }
        }
        if (past) e.remSent = 'past';
        add(e);
      }
    });
  }
  // a couple of all-day items
  add({ownerId: 'm3', title: 'Hari Raya open house (clients)', type: 'crm', start: CORE.myt(dayStart(9)).slice(0, 10), end: CORE.myt(dayStart(9)).slice(0, 10), allDay: 'true', remind: ''});
  add({ownerId: 'm1', title: 'Annual leave', type: 'personal', vis: 'private', start: CORE.myt(dayStart(12)).slice(0, 10), end: CORE.myt(dayStart(13)).slice(0, 10), allDay: 'true', remind: ''});
  const say = (from, to, text, hoursAgo, kind) => msgs.push({id: 'g' + (++id), to, from, kind: kind || 'text', text, created: iso(nowMs - hoursAgo * 3600e3)});
  // comments on the last Monday team meeting (whole-team event: everyone gets these)
  const meet = events.filter(e => e.all === 'true' && /Monday/.test(e.title) && Date.parse(e.end) < nowMs).slice(-1)[0];
  if (meet) { say('m0', 'ev:' + meet.id, 'Great energy last night! This week: everyone 3 presentations minimum. No magic, just basic 💪', 60); say('m3', 'ev:' + meet.id, 'Who wants to do Queensbay roadshow together on Saturday?', 40); say('m8', 'ev:' + meet.id, 'Me! 10am?', 39); say('m7', 'ev:' + meet.id, 'Count me in 🙋‍♀️', 38); }
  // comments + cheers on Marcus's closed presentation (individual event: only Marcus and the commenters)
  const pastPresent = events.filter(e => e.type === 'present' && e.ownerId === 'm2' && e.out === 'closed' && e.vis === 'team').slice(-1)[0];
  if (pastPresent) { msgs.push({id: 'g' + (++id), to: 'ev:' + pastPresent.id, from: 'm0', kind: 'cheer', text: '👏', created: pastPresent.end}); say('m0', 'ev:' + pastPresent.id, 'Well done Marcus! Share how you handled the price objection on Monday', 4); say('m5', 'ev:' + pastPresent.id, 'Congrats bro 👏👏', 3); say('m2', 'ev:' + pastPresent.id, 'Thanks boss! Will share 🙏', 2); }
  msgs.sort((a, b) => a.created < b.created ? -1 : 1);
  store.save('members', members); store.save('events', events); store.save('msgs', msgs);
}

const store = memStore();
seed(store, Date.now());
store.version(true);
module.exports = {seed};

if (require.main === module) {
  setInterval(() => { const n = store.pushes.length; CORE.tick(store); store.pushes.slice(n).forEach(p => console.log('POP-UP to', p.ids.join(','), '|', p.note.title, '|', p.note.body)); }, 30e3);
  const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.ics': 'text/calendar'};
  const SAVE_OK = {'icon-192.png': path.join(DOCS, 'icons'), 'icon-512.png': path.join(DOCS, 'icons'), 'apple-touch-icon.png': path.join(DOCS, 'icons'), 'badge-72.png': path.join(DOCS, 'icons'), 'team-mark.png': path.join(DOCS, 'icons')};
  http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (url === '/gas' && req.method === 'POST') {
      let b = ''; req.on('data', c => b += c);
      req.on('end', () => {
        const n = store.pushes.length; let out, q = {};
        try { q = JSON.parse(b); out = CORE.handle(q, store); } catch (e) { out = e.appCode ? {error: e.appCode} : (console.error(e), {error: 'server_error'}); }
        if (q.op !== 'sync') console.log(q.op, out.error || 'ok');
        store.pushes.slice(n).forEach(p => console.log('POP-UP to', p.ids.join(','), '|', p.note.title, '|', p.note.body));
        setTimeout(() => { res.writeHead(200, {'Content-Type': 'application/json'}); res.end(JSON.stringify(out)); }, q.op === 'read' ? 1500 : 120);
      });
      return;
    }
    if (url === '/__save' && req.method === 'POST') {   // icon maker writes its PNGs here (local only)
      const name = new URL(req.url, 'http://x').searchParams.get('name'), dir = SAVE_OK[name];
      if (!dir) { res.writeHead(400); return res.end(); }
      const chunks = []; req.on('data', c => chunks.push(c));
      req.on('end', () => { fs.writeFileSync(path.join(dir, name), Buffer.from(Buffer.concat(chunks).toString(), 'base64')); console.log('saved', name); res.end('ok'); });
      return;
    }
    if (url === '/config.js') { res.writeHead(200, {'Content-Type': 'text/javascript'}); return res.end("self.RCAL_CONFIG={api:location.origin+'/gas',appUrl:location.origin+'/',sample:'SAMPLE TEAM · made-up people'};"); }
    let file;
    if (url.startsWith('/tools/')) file = path.join(__dirname, path.basename(url));
    else if (url.startsWith('/fixtures/')) file = path.join(FIX, path.basename(url));
    else file = path.join(DOCS, url.replace(/^\/+/, '') || 'index.html');
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store'});
    fs.createReadStream(file).pipe(res);
  }).listen(PORT, '127.0.0.1', () => console.log('REDEFINE Calendar test server: http://localhost:' + PORT + '  (team code test-team, leader code test-leader-code, PIN 1234)'));
}
