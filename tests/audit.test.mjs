// The edge audit, at the seam an agent uses: the command line, and what the
// service on the other end of it sees.
//
// **This suite never reaches the network.** Every run that could send points
// the endpoint at a fake bound to 127.0.0.1 in this process, and the key the
// developer may have set is cleared from every child's environment unless a
// test hands it a fake one. The fake counts requests, so "sends nothing" is a
// number here rather than a hope.
//
// Nothing here commits a fixture. The boxes are the two kept decision records
// and the example the skill ships, read in place. The tests compare their
// bytes before and after, because the audit must never write a box.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { audit, root, runAsync } from './helpers.mjs';

const work = mkdtempSync(join(tmpdir(), 'grimoire-audit-'));
after(() => rmSync(work, { recursive: true, force: true }));

const decisions = join(root, 'docs', 'decisions', 'publish-eagle-eye.box.json');
const portable = join(root, 'docs', 'decisions', 'portable-skill.box.json');

// A value nobody would type by accident, so finding it in any output is proof
// of a leak and not a coincidence.
const KEY = 'fake-key-3b7e91d0-never-print-me';

let caches = 0;
const freshCache = () => mkdtempSync(join(work, `cache-${caches++}-`));

// Every child starts with no key, no endpoint and no cache of its own. A key
// in the developer's shell must never reach a test that did not ask for one.
function runAudit(args, env = {}) {
  return runAsync(audit, args, {
    env: {
      TYPESAFE_API_KEY: null,
      EAGLE_EYE_AUDIT_ENDPOINT: null,
      EAGLE_EYE_AUDIT_CACHE: freshCache(),
      ...env,
    },
  });
}

/**
 * A loopback stand-in for the service. `reply(body, n)` returns what the n-th
 * request gets: `{ status, body }`, where a string body is sent as it stands.
 * The default answers every question it was asked with a flat 0.2.
 */
async function fake(reply = body => ({ body: { model: 'fake', answers: flat(body, 0.2) } })) {
  const seen = [];
  const server = createServer((req, res) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', d => (data += d));
    req.on('end', () => {
      const body = JSON.parse(data);
      seen.push({ body, auth: req.headers.authorization });
      const r = reply(body, seen.length);
      res.writeHead(r.status ?? 200, { 'content-type': 'application/json' });
      res.end(typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/v1/systemone`,
    seen,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

function flat(body, p) {
  return Object.fromEntries(Object.keys(body.questions).map(q => [q, { type: 'noul', noul: p }]));
}

function assertNoKey(r) {
  assert.ok(!r.stdout.includes(KEY), 'the key reached standard output');
  assert.ok(!r.stderr.includes(KEY), 'the key reached standard error');
}

test('with no key it sends nothing, exits 3, and names the variable it looked for', async () => {
  const svc = await fake();
  try {
    const r = await runAudit([decisions], { EAGLE_EYE_AUDIT_ENDPOINT: svc.url });
    assert.equal(r.code, 3, r.stderr);
    assert.equal(svc.seen.length, 0);
    assert.match(r.stderr, /TYPESAFE_API_KEY/);
    assert.match(r.stderr, /Nothing was sent/);
    // The absent-key message is the setup guide, because it is the one place
    // under skills/ allowed to name the provider and the variable. It names
    // both places a key persists across sessions, says a project .env is not
    // read, and tells the user to keep the key out of the chat.
    assert.match(r.stderr, /docs\.typesafe\.ai/);
    assert.match(r.stderr, /settings/);
    assert.match(r.stderr, /shell profile/);
    assert.match(r.stderr, /\.env is not read/);
    assert.match(r.stderr, /Never paste the key into a chat/);
    // Standard output stays empty, so nothing on it reads as a ranking.
    assert.equal(r.stdout, '');
  } finally {
    await svc.close();
  }
});

test('--probe says yes or no, never the value, and opens no connection', async () => {
  const svc = await fake();
  try {
    const without = await runAudit(['--probe'], { EAGLE_EYE_AUDIT_ENDPOINT: svc.url });
    assert.equal(without.code, 0, without.stderr);
    assert.equal(without.stdout.trim(), 'no');

    const withKey = await runAudit(['--probe'], { EAGLE_EYE_AUDIT_ENDPOINT: svc.url, TYPESAFE_API_KEY: KEY });
    assert.equal(withKey.code, 0, withKey.stderr);
    assert.equal(withKey.stdout.trim(), 'yes');
    assertNoKey(withKey);

    // A box path beside the flag changes nothing: the probe still reads no box
    // and still sends nothing.
    const beside = await runAudit([decisions, '--probe'], { EAGLE_EYE_AUDIT_ENDPOINT: svc.url, TYPESAFE_API_KEY: KEY });
    assert.equal(beside.stdout.trim(), 'yes');

    assert.equal(svc.seen.length, 0);
  } finally {
    await svc.close();
  }
});

test('an endpoint override that is not loopback is refused before the key is read', async () => {
  for (const url of ['https://example.com/v1/systemone', 'http://10.0.0.1/x', 'http://127.0.0.1.example.com/x', 'http://localhost:9/x', 'not a url']) {
    // No key is set. Were the key read first, this would exit 3 and say so.
    const r = await runAudit([decisions], { EAGLE_EYE_AUDIT_ENDPOINT: url });
    assert.equal(r.code, 5, `${url}: ${r.stderr}`);
    assert.match(r.stderr, /loopback/);
    assert.doesNotMatch(r.stderr, /TYPESAFE_API_KEY/);
  }
  // The probe reads the environment too, so it is refused the same way.
  const probe = await runAudit(['--probe'], { EAGLE_EYE_AUDIT_ENDPOINT: 'https://example.com/', TYPESAFE_API_KEY: KEY });
  assert.equal(probe.code, 5);
  assertNoKey(probe);
});

test('--dry-run prints one request body with the rich state, and sends nothing', async () => {
  const svc = await fake();
  try {
    const r = await runAudit([decisions, '--dry-run'], { EAGLE_EYE_AUDIT_ENDPOINT: svc.url, TYPESAFE_API_KEY: KEY });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(svc.seen.length, 0);
    assertNoKey(r);

    // The size, on standard error so standard output stays one parseable body.
    // The skill's offer states this count rather than a price, because a
    // price is the provider's to change. Five argued edges and six controls,
    // none cached yet.
    assert.match(r.stderr, /A real run sends 11 requests: 5 argued edges and 6 controls, none cached\./);
    assert.match(r.stderr, /about [\d,]+ input tokens/);

    const body = JSON.parse(r.stdout);
    assert.equal(body.model, 'jev-latest');
    assert.equal(Object.keys(body.questions).length, 8);
    for (const q of Object.values(body.questions)) assert.equal(q.type, 'noul');

    // The first argued edge in the decisions box: publishing in somebody
    // else's marketplace rules out promising answers on issues. Written out
    // from the file by hand, not recomputed the way the tool does it. The
    // source option carries no notes, so the state carries none for it.
    assert.match(body.state.box.problem, /^The skill works on one machine/);
    const { edge } = body.state;
    assert.equal(edge.why, 'The author does not own the tracker, so the author cannot promise an answer.');
    assert.match(edge.claim, /^conflict/);
    assert.deepEqual(edge.source, {
      option: 'Add the skill to a marketplace that somebody else owns. Publish no repo.',
      row: 'What the repo holds',
      question: 'Does the repo carry one skill, three skills, or a marketplace?',
      why: 'The later answer. Put the skill in an existing marketplace and publish no repo of your own.',
      src: 'assistant proposal, /eagle-eye session 2026-08-26',
    });
    assert.deepEqual(edge.target, {
      option: 'Issues welcome. The author reads pull requests case by case.',
      row: 'Support posture',
      question: 'What does the author promise a reader who has a problem?',
      why: 'A middle posture. Readers report problems, and the author keeps control of the text.',
      notes: ['A skill is prose. A patch to prose is harder to review than a patch to code.'],
      src: 'assistant proposal, /eagle-eye session 2026-08-26',
    });
  } finally {
    await svc.close();
  }
});

// Answers for the kept decisions box, keyed off what the request carries. A
// request whose `why` belongs to a sourced edge but whose target is not that
// edge's target is a shuffled control, and scores high on weakly connected.
// One argued edge is made to score inside the controls' range, and one just
// under it. Everything else scores low.
const INSIDE = 'Under this option the author publishes no repository, so there is no repository to serve Pages from.';
const UNDER = 'The host repo sets the version scheme.';
function decisionsReply() {
  const box = JSON.parse(readFileSync(decisions, 'utf8'));
  const labels = new Map(box.dims.flatMap(d => d.opts.map(o => [o.id, o.label])));
  const sourced = new Map();
  for (const entry of Object.values(box.rel)) {
    for (const [target, , why, tier] of entry.rel ?? []) {
      if (tier === 'sourced') sourced.set(why, labels.get(target));
    }
  }
  return body => {
    const { why, target } = body.state.edge;
    let weak = 0.2;
    if (sourced.has(why) && sourced.get(why) !== target.option) weak = 0.6 + 0.1 * (why.length % 3);
    else if (why === INSIDE) weak = 0.65;
    else if (why === UNDER) weak = 0.55;
    const answers = flat(body, 0.1);
    answers['weakly connected'].noul = weak;
    return { body: { model: 'fake', answers, usage: { input_tokens: 1, output_tokens: 1 } } };
  };
}

const blocks = stdout => stdout.split(/\r?\n\r?\n/).filter(b => /^(FLAG| {4}) {2}\S/.test(b));

test('the kept decisions box ranks, calibrates on six shuffled controls, and flags the edge inside their range', async () => {
  const svc = await fake(decisionsReply());
  const before = readFileSync(decisions);
  const sidecar = join(work, 'ranking.json');
  try {
    const r = await runAudit([decisions, '--json', sidecar], { EAGLE_EYE_AUDIT_ENDPOINT: svc.url, TYPESAFE_API_KEY: KEY });
    assert.equal(r.code, 0, r.stderr);
    assertNoKey(r);

    // Five argued edges and six controls, one request each, each carrying the
    // key as a bearer token.
    assert.equal(svc.seen.length, 11);
    for (const s of svc.seen) assert.equal(s.auth, `Bearer ${KEY}`);

    assert.match(r.stdout, /Calibrated: 6 shuffled controls score 0\.60 to 0\.80 on weakly connected/);
    assert.match(r.stdout, /The floor is 4 controls\./);
    assert.match(r.stdout, /It is not a verdict/);

    const all = blocks(r.stdout);
    assert.equal(all.length, 5);
    const flagged = all.filter(b => b.startsWith('FLAG'));
    assert.equal(flagged.length, 1);
    assert.equal(flagged[0], all[0], 'the flagged edge ranks first');
    assert.match(flagged[0], /What the repo holds: Somebody else's repo rules out What the README shows first: Live page/);
    assert.match(flagged[0], /weakly connected 0\.65/);
    assert.match(flagged[0], /top: weakly connected 0\.65/);
    assert.ok(flagged[0].includes(`why: ${INSIDE}`));
    // Just under the lowest control is ranked second and not flagged.
    assert.ok(all[1].startsWith('    ') && all[1].includes(UNDER));

    const json = JSON.parse(readFileSync(sidecar, 'utf8'));
    assert.equal(json.calibrated, true);
    assert.equal(json.floor, 4);
    assert.equal(json.edges.length, 5);
    assert.equal(json.controls.length, 6);
    assert.deepEqual(
      json.edges.filter(e => e.flagged).map(e => `${e.source} ${e.kind} ${e.target}`),
      ['scope-guest conf proof-pages'],
    );

    assert.deepEqual(readFileSync(decisions), before, 'the box file changed');
  } finally {
    await svc.close();
  }
});

test('a box with no sourced edge gets an uncalibrated ranking, and says so in one line', async () => {
  const svc = await fake();
  try {
    const r = await runAudit([portable], { EAGLE_EYE_AUDIT_ENDPOINT: svc.url, TYPESAFE_API_KEY: KEY });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(svc.seen.length, 1);
    const lines = r.stdout.split(/\r?\n/).filter(l => l.startsWith('Uncalibrated:'));
    assert.deepEqual(lines, ['Uncalibrated: 0 shuffled controls from 0 sourced or measured edges, and the floor is 4. No edge is flagged.']);
    const all = blocks(r.stdout);
    assert.equal(all.length, 1);
    assert.ok(all.every(b => !b.startsWith('FLAG')));
  } finally {
    await svc.close();
  }
});

test('a second run against a warm cache sends nothing, and the cache holds answers only', async () => {
  const svc = await fake(decisionsReply());
  const cache = freshCache();
  try {
    const env = { EAGLE_EYE_AUDIT_ENDPOINT: svc.url, TYPESAFE_API_KEY: KEY, EAGLE_EYE_AUDIT_CACHE: cache };
    const first = await runAudit([decisions], env);
    assert.equal(first.code, 0, first.stderr);
    assert.equal(svc.seen.length, 11);
    const second = await runAudit([decisions], env);
    assert.equal(second.code, 0, second.stderr);
    assert.equal(svc.seen.length, 11, 'the second run asked again');
    assert.equal(second.stdout, first.stdout);

    const files = readdirSync(cache);
    assert.equal(files.length, 11);
    for (const f of files) {
      const text = readFileSync(join(cache, f), 'utf8');
      assert.ok(!text.includes(KEY), `${f} holds the key`);
      assert.deepEqual(Object.keys(JSON.parse(text)), ['answers'], `${f} holds more than answers`);
    }
  } finally {
    await svc.close();
  }
});

test('a cache that cannot be written costs a request next time, and nothing else', async () => {
  // Point the cache at a file, so creating the directory fails. The requests
  // have already gone out by then, so the run must still print its ranking
  // rather than die with exit 1, which means an unreadable box.
  const notADir = join(work, 'cache-is-a-file');
  writeFileSync(notADir, 'not a directory');
  const svc = await fake();
  try {
    const r = await runAudit([portable], { EAGLE_EYE_AUDIT_ENDPOINT: svc.url, TYPESAFE_API_KEY: KEY, EAGLE_EYE_AUDIT_CACHE: notADir });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(svc.seen.length, 1);
    assert.match(r.stdout, /^Uncalibrated:/m);
  } finally {
    await svc.close();
  }
});

test('a response without answers is refused with a message, never guessed at', async () => {
  const svc = await fake(() => ({ body: { model: 'fake', usage: { input_tokens: 1, output_tokens: 1 } } }));
  try {
    const r = await runAudit([decisions], { EAGLE_EYE_AUDIT_ENDPOINT: svc.url, TYPESAFE_API_KEY: KEY });
    assert.equal(r.code, 4);
    assert.match(r.stderr, /no answers field/);
    assert.equal(r.stdout, '');
    assert.equal(svc.seen.length, 1);
    assertNoKey(r);
  } finally {
    await svc.close();
  }
});

test('an answer that is not a Noul probability is refused', async () => {
  const svc = await fake(body => {
    const answers = flat(body, 0.2);
    answers.vague = { type: 'noul', noul: 1.7 };
    return { body: { answers } };
  });
  try {
    const r = await runAudit([decisions], { EAGLE_EYE_AUDIT_ENDPOINT: svc.url, TYPESAFE_API_KEY: KEY });
    assert.equal(r.code, 4);
    assert.match(r.stderr, /"vague"/);
  } finally {
    await svc.close();
  }
});

test('a first 5xx is retried once, and a second one fails', async () => {
  const once = await fake((body, n) => (n === 1 ? { status: 503, body: 'busy' } : { body: { answers: flat(body, 0.2) } }));
  try {
    const r = await runAudit([portable], { EAGLE_EYE_AUDIT_ENDPOINT: once.url, TYPESAFE_API_KEY: KEY });
    assert.equal(r.code, 0, r.stderr);
    // One edge, asked twice.
    assert.equal(once.seen.length, 2);
  } finally {
    await once.close();
  }

  const always = await fake(() => ({ status: 529, body: 'overloaded' }));
  try {
    const r = await runAudit([portable], { EAGLE_EYE_AUDIT_ENDPOINT: always.url, TYPESAFE_API_KEY: KEY });
    assert.equal(r.code, 4);
    assert.match(r.stderr, /HTTP 529 twice/);
    assert.equal(always.seen.length, 2);
    assertNoKey(r);
  } finally {
    await always.close();
  }
});

test('a 4xx is not retried', async () => {
  const svc = await fake(() => ({ status: 401, body: '{"error":"bad key"}' }));
  try {
    const r = await runAudit([portable], { EAGLE_EYE_AUDIT_ENDPOINT: svc.url, TYPESAFE_API_KEY: KEY });
    assert.equal(r.code, 4);
    assert.match(r.stderr, /HTTP 401\. The key was refused\./);
    assert.equal(svc.seen.length, 1);
    assertNoKey(r);
  } finally {
    await svc.close();
  }
});

test('an unreachable service is retried once, then fails', async () => {
  // Bind a port, then close it, so nothing is listening there.
  const svc = await fake();
  await svc.close();
  const r = await runAudit([portable], { EAGLE_EYE_AUDIT_ENDPOINT: svc.url, TYPESAFE_API_KEY: KEY });
  assert.equal(r.code, 4);
  assert.match(r.stderr, /could not be reached twice/);
  assertNoKey(r);
});

// The skill prose says "the model provider". The one file that names the
// service is the one that calls it, and this holds that line. It is not a
// vocabulary denylist — docs/adr/0001 argues against those — but the other
// half of the paragraph that ADR gained with this tool: code that calls a
// service names it, and prose does not.
test('under skills/, only the audit script names the provider', () => {
  const hits = [];
  const walk = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (!/\.woff2$/.test(e.name) && /typesafe|\bjev\b/i.test(readFileSync(p, 'utf8'))) hits.push(p);
    }
  };
  walk(join(root, 'skills'));
  assert.deepEqual(hits, [audit]);
});
