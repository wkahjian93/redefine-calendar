// In-memory stand-in for the Google server's store, used by test.js and the local preview server.
// The AI is NOT called: it returns a hand-written reply (test/fixtures/sample-read.json) unless opts.ai is given.
// Pop-ups are not sent; they are recorded in store.pushes so tests (and the preview's "phone" banner) can see them.
const crypto = require('crypto'), fs = require('fs'), path = require('path');
module.exports = function memStore(opts = {}) {
  const tables = {}, files = {}, props = Object.assign({TEAM_CODE: 'test-team', LEADER_CODE: 'test-leader-code'}, opts.props || {});
  let ver = 1, fails = 0, clock = null;
  const store = {
    tables, props, prompts: [], pushes: [],
    load: t => JSON.parse(JSON.stringify(tables[t] || [])),
    save: (t, rows) => { tables[t] = JSON.parse(JSON.stringify(rows)); },
    append: (t, row) => { (tables[t] = tables[t] || []).push(JSON.parse(JSON.stringify(row))); },
    locks: 0,
    withLock: fn => { store.locks++; return fn(); },
    prop: k => props[k] || '',
    fails: add => { if (add) fails += add; return fails; },
    resetFails: () => { fails = 0; },
    now: () => clock ? new Date(clock) : new Date(),
    setNow: d => { clock = d ? new Date(d).getTime() : null; },
    random: opts.random || Math.random,
    // REDEFINE Login stand-ins: tests set opts.central / opts.findPhone to decide the answers.
    centralCheck: opts.central || (() => ({ok: false, error: 'offline'})),
    centralFindPhone: opts.findPhone || (() => null),
    hash: t => crypto.createHash('sha256').update(t, 'utf8').digest('hex'),
    version: bump => (bump ? ++ver : ver),
    push: (ids, note) => { if (ids && ids.length) store.pushes.push({ids: ids.slice(), note, at: Date.now()}); },
    files,
    putFile: (id, mime, data) => { files[id] = {mime, data}; },
    getFile: id => files[id] ? Object.assign({}, files[id]) : null,
    delFile: id => { delete files[id]; },
    heard: [],
    transcribe: (b64, mime, hint) => { store.heard.push({bytes: b64.length, mime}); return opts.transcribe ? opts.transcribe(b64, mime) : 'Esok pukul 3 petang present medical plan to Mr Lim (sample) at Gurney Plaza'; },
    ai: (prompt, b64, opt) => {
      b64 = b64 || '';
      store.prompts.push({prompt, bytes: b64.length, quick: !!(opt && opt.quick)});
      if (opts.ai) return opts.ai(prompt, b64);
      if (/^VOICE BOOKING/.test(prompt) && /\(ask\)/.test(prompt)) {   // stand-in for ask-back: one clear appointment, one unclear Friday
        const today = /Today is (\d{4}-\d{2}-\d{2})/.exec(prompt)[1], plus = n => new Date(Date.parse(today + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
        if (/FOLLOW-UP\./.test(prompt)) {
          const ans = (/The agent answered: "([^"]*)"/.exec(prompt) || [])[1] || '';
          if (/not sure/i.test(ans)) return JSON.stringify({events: [{title: 'Present Ms Ng (sample)', type: 'present', date: '', start: '20:00', sure: false, question: 'Which date then?', options: ['Fri', 'Sat']}]});
          return JSON.stringify({events: [{title: 'Present Ms Ng (sample)', type: 'present', date: plus(8), start: '20:00', end: '', place: 'Queensbay', people: [], sure: true, question: '', options: []}]});
        }
        store.voiceReads = (store.voiceReads || 0) + 1;
        return JSON.stringify({events: [
          {title: 'Coffee with Ali (sample)', type: 'approach', date: plus(1), start: '10:00', sure: true, question: '', options: []},
          {title: 'Present Ms Ng (sample)', type: 'present', date: plus(1), start: '20:00', place: 'Queensbay', sure: false, question: 'Which Friday?', options: ['This Fri', 'Next Fri']}
        ], clean: 'stand-in', unclear: ''});
      }
      if (/^VOICE BOOKING/.test(prompt)) {   // stand-in: tomorrow 15:00 presentation
        const today = /Today is (\d{4}-\d{2}-\d{2})/.exec(prompt)[1], tm = new Date(Date.parse(today + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);
        return JSON.stringify({title: 'Present medical plan to Mr Lim (sample)', type: 'present', date: tm, start: '15:00', end: '', allDay: false, place: 'Gurney Plaza', notes: '', people: [], repeat: '', clean: 'Tomorrow 3pm present medical plan to Mr Lim at Gurney Plaza', unclear: ''});
      }
      if (/^READ TEXT/.test(prompt)) {   // stand-in: one clear appointment tomorrow, one with no time
        const today = /Today is \w+ (\d{4}-\d{2}-\d{2})/.exec(prompt)[1], tm = new Date(Date.parse(today + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);
        return JSON.stringify({source: 'other', events: [{date: tm, start: '10:00', end: '11:00', allDay: false, title: 'Coffee with Ali (sample)', type: 'approach', count: 1, confidence: 0.95, unclear: ''}, {date: tm, start: '', end: '', allDay: false, title: 'Call Mr Tan (sample)', type: 'followup', count: 1, confidence: 0.6, unclear: 'no time said'}], notes: ''});
      }
      if (/^THEME FROM POSTER/.test(prompt)) return JSON.stringify({occasion: 'christmas', title: 'Christmas (sample)', colors: {bg: '#FFF5F5', surface: '#FFFFFF', primary: '#B91C1C', accent: '#15803D', text: '#1F2937'}, anim: 'snow', motifs: ['🎅', '🦌', '⛄'], notes: 'Stand-in: red and white poster with Santa.'});
      const f = path.join(__dirname, '..', 'test', 'fixtures', 'sample-read.json');
      if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
      return JSON.stringify({source: 'other', events: [], notes: 'Test server: no AI here (stand-in reply).'});
    }
  };
  return store;
};
