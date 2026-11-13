// In-memory stand-in for the Google server's store, used by test.js and the local preview server.
// The AI is NOT called: it returns a hand-written reply (test/fixtures/sample-read.json) unless opts.ai is given.
// Pop-ups are not sent; they are recorded in store.pushes so tests (and the preview's "phone" banner) can see them.
const crypto = require('crypto'), fs = require('fs'), path = require('path');
module.exports = function memStore(opts = {}) {
  const tables = {}, props = Object.assign({TEAM_CODE: 'test-team', LEADER_CODE: 'test-leader-code'}, opts.props || {});
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
    hash: t => crypto.createHash('sha256').update(t, 'utf8').digest('hex'),
    version: bump => (bump ? ++ver : ver),
    push: (ids, note) => { if (ids && ids.length) store.pushes.push({ids: ids.slice(), note, at: Date.now()}); },
    ai: (prompt, b64) => {
      store.prompts.push({prompt, bytes: b64.length});
      if (opts.ai) return opts.ai(prompt, b64);
      const f = path.join(__dirname, '..', 'test', 'fixtures', 'sample-read.json');
      if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
      return JSON.stringify({source: 'other', events: [], notes: 'Test server: no AI here (stand-in reply).'});
    }
  };
  return store;
};
