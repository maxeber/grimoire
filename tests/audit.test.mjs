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
import { audit, renderer, root, run, runAsync } from './helpers.mjs';

const work = mkdtempSync(join(tmpdir(), 'grimoire-audit-'));
after(() => rmSync(work, { recursive: true, force: true }));

const decisions = join(root, 'docs', 'decisions', 'publish-eagle-eye.box.json');
const portable = join(root, 'docs', 'decisions', 'portable-skill.box.json');

// A value nobody would type by accident, so finding it in any output is proof
// of a leak and not a coincidence.
const KEY = 'fake-key-3b7e91d0-never-print-me';
// The shape of an OpenRouter key: its prefix, then 64 hex characters.
const OR_KEY = `sk-or-v1-${'5eed'.repeat(16)}`;

// Every child starts with no key and no endpoint. A key in the developer's
// shell must never reach a test that did not ask for one.
function runAudit(args, env = {}) {
  return runAsync(audit, args, {
    env: {
      TYPESAFE_API_KEY: null,
      OPENROUTER_API_KEY: null,
      EAGLE_EYE_AUDIT_ENDPOINT: null,
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
  for (const k of [KEY, OR_KEY]) {
    assert.ok(!r.stdout.includes(k), 'a key reached standard output');
    assert.ok(!r.stderr.includes(k), 'a key reached standard error');
  }
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
    // A user decides here whether to get a key, so this is where they learn
    // that the audit is paid for with it.
    assert.match(r.stderr, /Each request it sends is charged to your key/);
    // The guide names the second route too: its variable, which key wins, that
    // the route is alpha, and that the account decides whether it logs.
    assert.match(r.stderr, /OPENROUTER_API_KEY/);
    assert.match(r.stderr, /both are set, TYPESAFE_API_KEY is used/);
    assert.match(r.stderr, /alpha/);
    assert.match(r.stderr, /logging/);
    // Standard output stays empty, so nothing on it reads as a ranking.
    assert.equal(r.stdout, '');
  } finally {
    await svc.close();
  }
});

// ---- the OpenRouter route (#117) ----

test('with only an OpenRouter key, the run sends OpenRouter\'s request shape, pinned to one upstream, and ranks', async () => {
  const svc = await fake(body => ({ body: { model: 'typesafe/jev-1.13-20260917', answers: flat(body, 0.2), usage: { cost: 0.00002 } } }));
  try {
    const r = await runAudit([portable], { EAGLE_EYE_AUDIT_ENDPOINT: svc.url, OPENROUTER_API_KEY: OR_KEY });
    assert.equal(r.code, 0, r.stderr);
    assertNoKey(r);
    assert.equal(svc.seen.length, 1);
    const [s] = svc.seen;
    assert.equal(s.auth, `Bearer ${OR_KEY}`);
    assert.equal(s.body.model, '~typesafe/jev-latest');
    assert.deepEqual(s.body.provider, { only: ['typesafe'], allow_fallbacks: false });
    assert.equal(Object.keys(s.body.questions).length, 8);
    // The provider's own model string, not rewritten, and no cost.
    assert.match(r.stdout, /^Scored by typesafe\/jev-1\.13-20260917\.$/m);
    assert.match(r.stderr, /^Sent 1 request to OpenRouter, charged to your key\. Answered by typesafe\/jev-1\.13-20260917\.$/m);
    assert.doesNotMatch(r.stdout + r.stderr, /0\.00002|cost/);
  } finally {
    await svc.close();
  }
});

test('with both keys set, TypeSafe is used and OpenRouter\'s key is never sent', async () => {
  const svc = await fake();
  try {
    const r = await runAudit([portable], { EAGLE_EYE_AUDIT_ENDPOINT: svc.url, TYPESAFE_API_KEY: KEY, OPENROUTER_API_KEY: OR_KEY });
    assert.equal(r.code, 0, r.stderr);
    assertNoKey(r);
    assert.equal(svc.seen.length, 1);
    assert.equal(svc.seen[0].auth, `Bearer ${KEY}`);
    assert.equal(svc.seen[0].body.model, 'jev-latest');
    assert.equal(svc.seen[0].body.provider, undefined);
    assert.match(r.stderr, /^Sent 1 request to TypeSafe/m);
  } finally {
    await svc.close();
  }
});

test('an OpenRouter key in TYPESAFE_API_KEY is refused with exit 3 before any request, in every mode', async () => {
  const svc = await fake();
  try {
    for (const env of [{ TYPESAFE_API_KEY: OR_KEY }, { TYPESAFE_API_KEY: OR_KEY, OPENROUTER_API_KEY: OR_KEY }]) {
      const e = { EAGLE_EYE_AUDIT_ENDPOINT: svc.url, ...env };
      for (const args of [[portable], [portable, '--dry-run']]) {
        const r = await runAudit(args, e);
        assert.equal(r.code, 3, `${args.join(' ')}: ${r.stderr}`);
        assert.match(r.stderr, /TYPESAFE_API_KEY holds an OpenRouter key/);
        assert.match(r.stderr, /OPENROUTER_API_KEY/);
        assert.match(r.stderr, /Nothing was sent/);
        assert.equal(r.stdout, '');
        assertNoKey(r);
      }
      // The probe says no, so the skill never offers a run that would be refused.
      const probe = await runAudit(['--probe'], e);
      assert.equal(probe.stdout.trim(), 'no');
      assertNoKey(probe);
    }
    assert.equal(svc.seen.length, 0);
  } finally {
    await svc.close();
  }
});

test('--dry-run and --provider name the provider a run would use, and say when its route is alpha', async () => {
  const svc = await fake();
  try {
    const env = { EAGLE_EYE_AUDIT_ENDPOINT: svc.url, OPENROUTER_API_KEY: OR_KEY };
    const dry = await runAudit([decisions, '--dry-run'], env);
    assert.equal(dry.code, 0, dry.stderr);
    // Both companies the text reaches, named before the user says yes.
    assert.match(dry.stderr, /A real run sends 11 requests to OpenRouter, which passes them on to TypeSafe: 5 argued edges and 6 controls\./);
    assert.match(dry.stderr, /at OpenRouter's price/);
    assert.match(dry.stderr, /alpha/);
    assert.equal(JSON.parse(dry.stdout).model, '~typesafe/jev-latest');
    assertNoKey(dry);

    const cases = [
      [{ OPENROUTER_API_KEY: OR_KEY }, 'OpenRouter'],
      [{ TYPESAFE_API_KEY: KEY, OPENROUTER_API_KEY: OR_KEY }, 'TypeSafe'],
      [{ TYPESAFE_API_KEY: OR_KEY }, 'none'],
      [{}, 'none'],
    ];
    for (const [keys, want] of cases) {
      const r = await runAudit(['--provider'], { EAGLE_EYE_AUDIT_ENDPOINT: svc.url, ...keys });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.stdout.trim(), want);
      assertNoKey(r);
    }
    // The probe keeps its contract: one word, yes or no.
    const probe = await runAudit(['--probe'], env);
    assert.equal(probe.stdout, 'yes\n');
    assert.equal(svc.seen.length, 0);
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
    // The skill's offer repeats this line: a count and who pays, never a
    // price, because a price is the provider's to change. Five argued edges
    // and six controls.
    assert.match(r.stderr, /A real run sends 11 requests to TypeSafe: 5 argued edges and 6 controls\./);
    assert.match(r.stderr, /Each request is charged to your key, at TypeSafe's price\./);
    assert.match(r.stderr, /about [\d,]+ input tokens/);
    assert.doesNotMatch(r.stderr, /[$€£]|\bUSD\b/);

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

    // The run ends by saying what it spent and which version answered.
    assert.match(r.stderr, /^Sent 11 requests to TypeSafe, charged to your key\. Answered by fake\.$/m);

    // The report names the one model that scored every edge and every control.
    assert.match(r.stdout, /^Scored by fake\.$/m);
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
    assert.equal(json.model, 'fake');
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

test('nothing is cached: a second run asks for every edge and every control again, and names the model that answered it', async () => {
  // A cache served one model's answers after the alias had moved on (#106).
  // Every run now asks the service for every edge and every control anew, so
  // a run after the alias moves is scored by the new model alone (#104).
  let model = 'jev-1.13.0';
  const reply = decisionsReply();
  const svc = await fake(body => {
    const r = reply(body);
    r.body.model = model;
    return r;
  });
  try {
    const env = { EAGLE_EYE_AUDIT_ENDPOINT: svc.url, TYPESAFE_API_KEY: KEY };
    const first = await runAudit([decisions], env);
    assert.equal(first.code, 0, first.stderr);
    assert.match(first.stdout, /^Scored by jev-1\.13\.0\.$/m);
    model = 'jev-1.14.0';
    const second = await runAudit([decisions], env);
    assert.equal(second.code, 0, second.stderr);
    assert.equal(svc.seen.length, 22, 'the second run was answered from somewhere other than the service');
    assert.match(second.stdout, /^Scored by jev-1\.14\.0\.$/m);
    assert.doesNotMatch(second.stdout, /jev-1\.13\.0/);
    assert.equal(second.stdout.replace('jev-1.14.0', 'jev-1.13.0'), first.stdout);
    assert.match(second.stderr, /^Sent 11 requests to TypeSafe, charged to your key\. Answered by jev-1\.14\.0\.$/m);
  } finally {
    await svc.close();
  }
});

test('answers from two models in one run are refused with exit 4, and nothing more is sent', async () => {
  // The alias moved mid-run. Ranking would compare one model's edges with
  // another model's controls, so the run stops at the first answer that
  // disagrees. Every later request would be charged for nothing.
  const moved = await fake((body, n) => ({ body: { model: n <= 3 ? 'jev-1.13.0' : 'jev-1.14.0', answers: flat(body, 0.2) } }));
  const sidecar = join(work, 'moved.json');
  try {
    const r = await runAudit([decisions, '--json', sidecar], { EAGLE_EYE_AUDIT_ENDPOINT: moved.url, TYPESAFE_API_KEY: KEY });
    assert.equal(r.code, 4, r.stderr);
    assert.equal(r.stdout, '', 'a ranking was printed');
    assert.throws(() => readFileSync(sidecar), 'a ranking was written');
    assert.equal(moved.seen.length, 4);
    assert.match(r.stderr, /^Refused: .*jev-1\.13\.0.*jev-1\.14\.0.*no ranking is printed\.$/m);
    assert.match(r.stderr, /^Sent 4 requests to TypeSafe, charged to your key\. Answered by jev-1\.13\.0 and jev-1\.14\.0\.$/m);
    assertNoKey(r);
  } finally {
    await moved.close();
  }
});

test('an answer that names no model is refused, because the report could not say what scored it', async () => {
  for (const model of [undefined, '', '   ', 42]) {
    const svc = await fake(body => ({ body: { model, answers: flat(body, 0.2) } }));
    try {
      const r = await runAudit([portable], { EAGLE_EYE_AUDIT_ENDPOINT: svc.url, TYPESAFE_API_KEY: KEY });
      assert.equal(r.code, 4, `${model}: ${r.stderr}`);
      assert.match(r.stderr, /names no model/);
      assert.equal(r.stdout, '');
      assert.match(r.stderr, /^Sent 1 request to TypeSafe, charged to your key\.$/m);
    } finally {
      await svc.close();
    }
  }
});

// ---- --sel: one configuration ----
//
// A configuration of the kept decisions box that does not hold, for three
// edges: two argued conflicts and one sourced requirement. The first argued
// edge is the one the full run flags.
const FAILING = 'eagle-eye: scope-guest, sup-archive, rel-main';
const SOURCED_UNMET = 'Branch protection blocks a merge on a required check, and only CI supplies one.';

// The edges the renderer names for a code, read off its own --sel lines, as
// `<why> [<tier>]`. The audit must treat exactly these as active.
function rendererActive(code) {
  const r = run(renderer, [decisions, '--sel', code]);
  assert.equal(r.code, 0, r.stderr);
  return r.stdout
    .split(/\r?\n/)
    .filter(l => /^ {2}(conflict|not met): /.test(l))
    .map(l => l.replace(/^.* — /, ''))
    .sort();
}

test('--sel scores only the configuration\'s argued edges, against the full run\'s controls, and flags them the same way', async () => {
  const svc = await fake(decisionsReply());
  const sidecar = join(work, 'sel.json');
  const fullSidecar = join(work, 'full.json');
  const before = readFileSync(decisions);
  try {
    const env = { EAGLE_EYE_AUDIT_ENDPOINT: svc.url, TYPESAFE_API_KEY: KEY };
    const r = await runAudit([decisions, '--sel', FAILING, '--json', sidecar], env);
    assert.equal(r.code, 0, r.stderr);
    assertNoKey(r);

    // Two argued edges and the same six controls a full run builds. The
    // sourced edge is never sent.
    assert.equal(svc.seen.length, 8);
    assert.match(r.stderr, /^Sent 8 requests to TypeSafe, charged to your key\./m);
    // A control reuses a sourced `why` with another target, so the test is the
    // pair: that `why` never goes out pointing at its own target.
    const own = s => s.body.state.edge.why === SOURCED_UNMET && s.body.state.edge.target.option === 'A GitHub Action checks every example box on push. Tags on top.';
    assert.equal(svc.seen.filter(own).length, 0, 'the sourced active edge was sent');
    assert.match(r.stdout, /Calibrated: 6 shuffled controls score 0\.60 to 0\.80 on weakly connected/);

    const all = blocks(r.stdout);
    assert.equal(all.length, 2);
    assert.ok(all[0].startsWith('FLAG') && all[0].includes(INSIDE));
    assert.ok(all[1].startsWith('    '));

    // The sourced edge is listed, with the reason it is not scored.
    assert.match(r.stdout, /not scored: sourced — recheck its src/);
    assert.ok(r.stdout.includes(SOURCED_UNMET));

    // The same edges the renderer names for the same code.
    const json = JSON.parse(readFileSync(sidecar, 'utf8'));
    assert.equal(json.sel, FAILING);
    assert.equal(json.holds, false);
    assert.equal(json.controls.length, 6);
    assert.deepEqual(json.edges.map(e => `${e.why} [${e.tier}]`).sort(), rendererActive(FAILING));
    const unscored = json.edges.filter(e => e.scored === false);
    assert.deepEqual(unscored.map(e => `${e.source} ${e.kind} ${e.target}`), ['sec-platform req rel-ci']);
    assert.equal(unscored[0].scores, undefined);

    // Each scored edge carries the flag the full run gives it.
    const full = await runAudit([decisions, '--json', fullSidecar], env);
    assert.equal(full.code, 0, full.stderr);
    const fullJson = JSON.parse(readFileSync(fullSidecar, 'utf8'));
    const fullFlags = new Map(fullJson.edges.map(e => [`${e.source} ${e.kind} ${e.target}`, e.flagged]));
    const scored = json.edges.filter(e => e.scored !== false);
    assert.equal(scored.length, 2);
    for (const e of scored) assert.equal(e.flagged, fullFlags.get(`${e.source} ${e.kind} ${e.target}`), `${e.source} ${e.kind} ${e.target}`);
    assert.equal(json.threshold, fullJson.threshold);

    assert.deepEqual(readFileSync(decisions), before, 'the box file changed');
  } finally {
    await svc.close();
  }
});

test('--sel on a set that holds says so, sends nothing, and exits 0', async () => {
  const svc = await fake();
  const sidecar = join(work, 'holds.json');
  try {
    const r = await runAudit([decisions, '--sel', 'eagle-eye: none', '--json', sidecar], { EAGLE_EYE_AUDIT_ENDPOINT: svc.url, TYPESAFE_API_KEY: KEY });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(svc.seen.length, 0);
    assert.match(r.stdout, /The set holds\. There is nothing to audit, and nothing was sent\./);
    assert.doesNotMatch(r.stderr, /Sent \d/);
    const json = JSON.parse(readFileSync(sidecar, 'utf8'));
    assert.equal(json.sel, 'eagle-eye: none');
    assert.equal(json.holds, true);
    assert.deepEqual(json.edges, []);
  } finally {
    await svc.close();
  }
});

test('--sel on a set that fails only on sourced edges lists them and sends nothing', async () => {
  const svc = await fake();
  try {
    const r = await runAudit([decisions, '--sel', 'eagle-eye: rel-main'], { EAGLE_EYE_AUDIT_ENDPOINT: svc.url, TYPESAFE_API_KEY: KEY });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(svc.seen.length, 0);
    assert.match(r.stdout, /not scored: sourced — recheck its src/);
    assert.ok(r.stdout.includes(SOURCED_UNMET));
    assert.match(r.stdout, /No active edge is argued, so nothing was sent\./);
  } finally {
    await svc.close();
  }
});

test('--sel --dry-run counts the configuration\'s requests and sends nothing', async () => {
  const svc = await fake();
  try {
    const r = await runAudit([decisions, '--sel', FAILING, '--dry-run'], { EAGLE_EYE_AUDIT_ENDPOINT: svc.url, TYPESAFE_API_KEY: KEY });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(svc.seen.length, 0);
    assert.match(r.stderr, /A real run sends 8 requests to TypeSafe: 2 argued edges and 6 controls\./);
    assert.match(r.stderr, /Nothing was sent\./);
    assert.equal(JSON.parse(r.stdout).state.edge.why, INSIDE);

    const holds = await runAudit([decisions, '--sel', 'eagle-eye: none', '--dry-run'], { EAGLE_EYE_AUDIT_ENDPOINT: svc.url });
    assert.equal(holds.code, 0, holds.stderr);
    assert.match(holds.stdout, /The set holds/);
    assert.equal(svc.seen.length, 0);
  } finally {
    await svc.close();
  }
});

test('--sel scores an argued conflict whose mirror is sourced, which the renderer prints once', async () => {
  // The renderer prints a conflict drawn from both ends once. That is display.
  // Each direction is its own edge with its own evidence, so the audit scores
  // the argued one and lists the sourced one, whichever the renderer printed.
  const box = JSON.parse(readFileSync(decisions, 'utf8'));
  box.rel['proof-pages'].rel = [
    ...(box.rel['proof-pages'].rel ?? []),
    ['scope-guest', 'conf', 'Pages serves a repository the author owns.', 'sourced', 'GitHub Pages documentation'],
  ];
  const mirrored = join(work, 'mirrored.json');
  writeFileSync(mirrored, JSON.stringify(box));
  const svc = await fake(decisionsReply());
  const sidecar = join(work, 'mirrored-sel.json');
  try {
    const r = await runAudit([mirrored, '--sel', 'eagle-eye: scope-guest', '--json', sidecar], { EAGLE_EYE_AUDIT_ENDPOINT: svc.url, TYPESAFE_API_KEY: KEY });
    assert.equal(r.code, 0, r.stderr);
    const json = JSON.parse(readFileSync(sidecar, 'utf8'));
    assert.deepEqual(
      json.edges.map(e => `${e.source} ${e.kind} ${e.target} ${e.scored}`).sort(),
      ['proof-pages conf scope-guest false', 'scope-guest conf proof-pages true'],
    );
  } finally {
    await svc.close();
  }
});

test('--sel refuses an unknown id, a missing value, and a following flag with exit 2', async () => {
  const svc = await fake();
  try {
    const env = { EAGLE_EYE_AUDIT_ENDPOINT: svc.url, TYPESAFE_API_KEY: KEY };
    const unknown = await runAudit([decisions, '--sel', 'eagle-eye: no-such-option'], env);
    assert.equal(unknown.code, 2, unknown.stderr);
    assert.match(unknown.stderr, /unknown option "no-such-option"/);
    assert.doesNotMatch(unknown.stderr, /at Object|at Module/);
    // An id a plain object would find on its prototype is still unknown.
    const proto = await runAudit([decisions, '--sel', 'eagle-eye: constructor'], env);
    assert.equal(proto.code, 2, proto.stderr);
    // A second --sel is refused rather than read: the renderer and the audit
    // would otherwise each pick a different one of the two.
    const twice = [decisions, '--sel', 'eagle-eye: none', '--sel', FAILING];
    for (const args of [[decisions, '--sel'], [decisions, '--sel', '--json', join(work, 'x.json')], twice]) {
      const r = await runAudit(args, env);
      assert.equal(r.code, 2, `${args.join(' ')}: ${r.stderr}`);
      assert.match(r.stderr, /^usage:/);
    }
    assert.equal(svc.seen.length, 0);
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
    // A refused run still says what it spent before it stopped.
    assert.match(r.stderr, /^Sent 1 request to TypeSafe, charged to your key\. Answered by fake\.$/m);
    assertNoKey(r);
  } finally {
    await svc.close();
  }
});

test('an answer that is not a Noul probability is refused', async () => {
  const svc = await fake(body => {
    const answers = flat(body, 0.2);
    answers.vague = { type: 'noul', noul: 1.7 };
    return { body: { model: 'fake', answers } };
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
  const once = await fake((body, n) => (n === 1 ? { status: 503, body: 'busy' } : { body: { model: 'fake', answers: flat(body, 0.2) } }));
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
    // The service received both, so the closing line counts both.
    assert.match(r.stderr, /^Sent 2 requests to TypeSafe, charged to your key\.$/m);
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
  // Nothing reached the service, so nothing was charged and nothing is claimed.
  assert.doesNotMatch(r.stderr, /Sent \d/);
  assertNoKey(r);
});

// The skill prose says "the model provider". The one file that names the
// service is the one that calls it, and this holds that line. It is not a
// vocabulary denylist — docs/adr/0001 argues against those — but the other
// half of the paragraph that ADR gained with this tool: code that calls a
// service names it, and prose does not.
test('under skills/, only the audit script names a provider', () => {
  const hits = [];
  const walk = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (!/\.woff2$/.test(e.name) && /typesafe|openrouter|\bjev\b/i.test(readFileSync(p, 'utf8'))) hits.push(p);
    }
  };
  walk(join(root, 'skills'));
  assert.deepEqual(hits, [audit]);
});
