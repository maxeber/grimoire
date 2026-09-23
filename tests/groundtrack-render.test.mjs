// The groundtrack renderer, at the seam a reader and an agent actually use:
// its command line. `scripts/check.mjs` already proves a flightpath file
// renders without throwing. It cannot prove the page is right, and it cannot
// prove a crafted file fails to inject script. These tests do both.
//
// Nothing here commits a fixture. Both root scripts walk the whole tree for
// every artifact suffix the registry names, so a valid fixture on disk would
// be published to the public site and a broken one would fail the check. Every
// fixture is derived from the shipped example and written to a temporary
// directory.
//
// The validator is the format, so this file is also what binds
// references/flightpath-file.md to the code. A rule stated there and not
// tested here is a rule nothing holds.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync, linkSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { groundtrack, examples, exampleFlightpath, layeredFlightpath, run, errorPastTwoSites } from './helpers.mjs';

const work = mkdtempSync(join(tmpdir(), 'grimoire-groundtrack-'));
after(() => rmSync(work, { recursive: true, force: true }));

const base = () => JSON.parse(readFileSync(exampleFlightpath, 'utf8'));

/** Write a derived program to the scratch directory and return its path. */
let n = 0;
function derive(mutate) {
  const prog = base();
  mutate(prog);
  const p = join(work, `case-${n++}.flightpath.json`);
  writeFileSync(p, JSON.stringify(prog, null, 2));
  return p;
}

const check = file => run(groundtrack, [file, '--check']);

// The small example states one change and one graph, and every mutator below
// reaches into that graph's runs. Named so the reshape reads as one thing
// rather than as a hundred index changes.
const only = prog => prog.graphs[0];
const runs = prog => prog.graphs[0].presets;

/**
 * Give a derived program a second entry point, sharing the one node map.
 *
 * A change with two entry points is what the container exists for, and the
 * small example has one. The second graph's run takes the first graph's name
 * on purpose: uniqueness is per graph.
 */
function addSecondGraph(prog) {
  prog.nodes.applyPanel = {
    name: 'applyPanel',
    role: 'handler',
    loc: 'src/panel.ts:1',
    params: [],
    channels: { success: 'void', error: [], requirements: [] },
    steps: [
      { op: 'call', target: 'lookupName', args: { id: 'id' } },
      { op: 'return', expr: 'undefined' },
    ],
    touches: ['src/panel.ts'],
    enteredBy: [],
  };
  prog.graphs.push({
    id: 'panel-apply',
    title: 'apply the panel',
    blurb: 'The second entry point of the same change. It reaches lookupName, which the first graph reaches too.',
    entry: 'applyPanel',
    presets: [
      {
        name: 'a known user',
        blurb: 'The same run name as the first graph, which is legal: uniqueness is per graph.',
        input: {},
        trace: {
          provenance: 'authored',
          steps: [
            { k: 'call', at: 0, to: 'lookupName', next: 1 },
            { k: 'effect', at: 0, kind: 'db.get', desc: 'read the name row', next: 1, result: { displayName: 'Ada' } },
            { k: 'if', at: 1, next: 2 },
            { k: 'return', at: 2, value: 'Ada' },
            { k: 'return', at: 1 },
            { k: 'done' },
          ],
        },
      },
    ],
  });
  return prog;
}

/* -- the acceptance set --------------------------------------------------- */

test('every shipped worked example validates', () => {
  const shipped = readdirSync(examples).filter(f => f.endsWith('.flightpath.json'));
  assert.ok(shipped.length >= 2, 'the skill ships worked examples');
  for (const f of shipped) {
    const r = check(join(examples, f));
    assert.equal(r.code, 0, `${f} did not validate:\n${r.stderr}`);
  }
});

test('the two structural checks change the verdict on no shipped example', () => {
  // The pair earns its place by costing nothing elsewhere. This is the half
  // worth pinning: the check that refuses a green-and-wrong file must not
  // start refusing files that were green and right.
  for (const f of readdirSync(examples).filter(x => x.endsWith('.flightpath.json'))) {
    const r = check(join(examples, f));
    assert.doesNotMatch(r.stderr, /is uncaught, but/);
    assert.doesNotMatch(r.stderr, /emptied the frame stack/);
  }
});

/* -- what a refusal says -------------------------------------------------- */

test('a refusal in a walk names the path, then the graph, the run and the move', () => {
  // Every refusal carries a path into the document, so a tool locates the
  // fault without parsing prose. A walk refusal spells the same place out in
  // words after it, because counting into two arrays is work a person should
  // not have to do.
  // A tag cannot be uncaught while a frame it is passing through declares a
  // handler for it. In "no such user" the callee throws NoSuchUser, the callee
  // unwinds, and greet's call step catches it. Claim the error reached the top
  // instead, and the file contradicts itself: greet is still suspended at that
  // guarded call.
  const file = derive(prog => {
    const w = runs(prog)[1].trace.steps;
    const at = w.findIndex(m => m.k === 'catch');
    w.splice(at, w.length - at, { k: 'uncaught', tag: 'NoSuchUser', message: 'no row', cause: 'fail' });
  });
  const r = check(file);
  assert.equal(r.code, 1, r.stdout);
  assert.match(
    r.stderr,
    /case-\d+\.flightpath\.json: graphs\[0\]\.presets\[1\]\.trace\.steps\[\d+\]: graph "greet", run "no such user", move \d+: "NoSuchUser" is uncaught, but greet\[1\] declares onError for it/,
  );
});

test('a refusal in the file shape names a path into the document, and no run', () => {
  // A top-level unknown key is refused before a walk is read, so there is no
  // graph, no run and no move to name. A refusal that named one anyway would
  // be naming something that does not exist.
  const file = derive(prog => {
    prog.presests = [];
  });
  const r = check(file);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /: file: unknown key "presests"/);
  assert.doesNotMatch(r.stderr, /graph "|run "|move \d+/);
});

test('two graphs may share a run name, and a refusal names the second graph', () => {
  // Uniqueness is per graph, so "a known user" can exist on each sheet. The
  // two runs are then told apart by the graph, which is why the graph is in
  // the words and not only in the path.
  const clean = derive(addSecondGraph);
  assert.equal(check(clean).code, 0, check(clean).stderr);

  const file = derive(prog => {
    addSecondGraph(prog);
    prog.graphs[1].presets[0].trace.steps[0].to = 'greet'; // the step targets lookupName
  });
  const r = check(file);
  assert.equal(r.code, 1);
  assert.match(
    r.stderr.split('\n')[0],
    /graphs\[1\]\.presets\[0\]\.trace\.steps\[0\]: graph "panel-apply", run "a known user", move 0: call to "greet", but step 0 targets "lookupName"/,
  );
  // The first graph's identically named run is untouched, so nothing points at
  // it. Only the graph tells the two apart.
  assert.doesNotMatch(r.stderr, /graph "greet"/);
});

test('a refusal names the move that emptied the frame stack, not the first to notice', () => {
  // One measured run went 34 errors, then 36, then 36, then 36, and finished
  // blaming the checker — when the whole fault was one spurious unwind, a
  // single move earlier than the refusal pointed.
  const file = derive(prog => {
    const walk = runs(prog)[0].trace.steps;
    const i = walk.findIndex(m => m.k === 'return');
    walk.splice(i, 0, { k: 'propagate' }, { k: 'propagate' });
  });
  const r = check(file);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /emptied the frame stack, and move \d+ \(\w+\) then ran with none open/);
  const named = Number(/move (\d+): \w+ emptied the frame stack/.exec(r.stderr)[1]);
  const noticed = Number(/emptied the frame stack, and move (\d+)/.exec(r.stderr)[1]);
  assert.ok(named < noticed, 'the refusal blames the earlier move');
});

/* -- one refusal per rule ------------------------------------------------- */

const cases = [
  ['a missing core field', p => delete p.blurb, /file: missing required key "blurb"/],
  ['a graph missing a core field', p => delete only(p).entry, /graphs\[0\]: missing required key "entry"/],
  ['an unknown key one letter from a real one', p => { p.nodes.greet.channles = {}; }, /nodes\.greet: unknown key "channles"/],
  ['an unknown key on a step', p => { p.nodes.greet.steps[0].notes = 'x'; }, /steps\[0\] \(comment\): unknown key "notes"/],
  ['an unknown key on a move', p => { runs(p)[0].trace.steps[0].att = 0; }, /trace\.steps\[0\] \(comment\): unknown key "att"/],
  // Found while walking, so it names the graph, the run and the move like
  // every other walk refusal. It reports through the shape helper, and once
  // printed a path and went quiet about which run it was in.
  ['an unknown key inside a raised', p => {
    for (const m of runs(p)[2].trace.steps) if (m.raised) m.raised.extra = 'not a field';
  }, /trace\.steps\[\d+\]\.raised: graph "greet", run "[^"]+", move \d+: unknown key "extra"/],
  ["a graph whose entry is not in the node map", p => { only(p).entry = 'nowhere'; }, /graphs\[0\]\.entry: "nowhere" is not a node/],
  // The node map comes from JSON.parse, so it answers five names the author
  // never wrote. Read as `!prog.nodes[id]`, every "is not a node" refusal
  // stopped firing for them, and the fault reached the walk pass as a stack
  // trace instead.
  ['a graph entering at a node named after a prototype member', p => { only(p).entry = 'constructor'; }, /graphs\[0\]\.entry: "constructor" is not a node/],
  ['a call targeting a node named after a prototype member', p => { p.nodes.greet.steps[1].target = 'toString'; }, /target "toString" is not a node/],
  ['a layer entering at a node named after a prototype member', p => { p.layers.tests.entry = 'valueOf'; }, /layers\.tests\.entry: "valueOf" is not a node/],
  // The shape document says run names are unique per graph. `--text <run>`
  // resolves by name and takes the first match, so a repeated name leaves the
  // second run unreachable while still printed in the runs-not-shown list.
  ['two runs in one graph sharing a name', p => { runs(p)[1].name = runs(p)[0].name; }, /graphs\[0\]\.presets\[1\]\.name: "a known user" is already the name of a run in graph "greet"/],
  ['a graph id that is not plain', p => { only(p).id = 'first paint'; }, /graphs\[0\]\.id: "first paint" is not a plain letters-digits-and-hyphens id/],
  ['two graphs with one id', p => { p.graphs.push({ ...only(p) }); }, /graphs\[1\]\.id: "greet" is already the id of another graph/],
  ['an empty graphs list', p => { p.graphs = []; }, /graphs: state at least one graph/],
  ['a node id that is not plain', p => { p.nodes['greet!'] = p.nodes.greet; }, /nodes\.greet!: a node id must be plain letters, digits and hyphens/],
  ['a call to a node that is not there', p => { p.nodes.greet.steps[1].target = 'missing'; }, /target "missing" is not a node/],
  ['a goto naming no label', p => { p.nodes.greet.steps[4].to = 'nowhere'; }, /to "nowhere" is not a label in greet/],
  ['a throw cause outside the two', p => { p.nodes.lookupName.steps[3].cause = 'panic'; }, /cause "panic" is not one of fail, die/],
  ['a provenance outside the two', p => { runs(p)[0].trace.provenance = 'guessed'; }, /provenance: "guessed" is not authored or captured/],
  ['a layer naming a node that is not there', p => { p.layers.tests.nodes.absent = { requirements: ['x'] }; }, /layers\.tests\.nodes\.absent: is not a node/],
  ['an empty files list', p => { p.files = []; }, /files: state the changed files, or leave the key out/],
  ['an empty layer map', p => { p.layers = {}; }, /layers: state at least one layer, or leave the key out/],
  ['a move kind that names no op', p => { runs(p)[0].trace.steps[0].k = 'raise'; }, /k "raise" is not a move kind/],
  ['a move whose kind is not the step it ran', p => { runs(p)[0].trace.steps[0].k = 'var'; }, /a "var" move ran step 0, which is a "comment"/],
  ['an at that is not where the cursor sits', p => { runs(p)[0].trace.steps[0].at = 1; }, /ran step 1, but the cursor sits at 0/],
  ['a next the step cannot reach', p => { runs(p)[0].trace.steps[0].next = 5; }, /no edge from 0 \(comment\) to 5/],
  ['a call whose target is not the step target', p => { runs(p)[0].trace.steps[1].to = 'greet'; }, /call to "greet", but step 1 targets "lookupName"/],
  ['an effect carrying next and raised at once', p => {
    const m = runs(p)[0].trace.steps.find(x => x.k === 'effect');
    m.raised = { tag: 'X', message: 'y', cause: 'die' };
  }, /an effect carries next or raised, never both/],
  ['a catch its step does not declare', p => {
    const m = runs(p)[1].trace.steps.find(x => x.k === 'catch');
    m.goto = 'named';
    m.next = 3;
  }, /its onError does not name "named"/],
  ['a nodes map that is a list', p => { p.nodes = []; }, /nodes: expected an object keyed by node id/],
  ['a propagate with no error travelling', p => {
    const w = runs(p)[0].trace.steps;
    w.splice(2, 0, { k: 'propagate' });
  }, /propagate with no error travelling/],
  ['an uncaught nothing raised', p => {
    const w = runs(p)[0].trace.steps;
    w.splice(w.length - 1, 1, { k: 'uncaught', tag: 'Invented', message: 'nothing raised this', cause: 'die' });
  }, /"Invented" reached the top uncaught, and no move before it raised anything/],
  ['an uncaught naming a tag other than the one travelling', p => {
    const w = runs(p)[2].trace.steps;
    w[w.length - 1].tag = 'SomethingElse';
  }, /"SomethingElse" reached the top, but the error travelling is "SendFailed"/],
  ['a catch that catches nothing', p => {
    const w = runs(p)[0].trace.steps;
    w.splice(2, 0, { k: 'catch', at: 1, goto: 'plain', next: 5 });
  }, /catch at 1 catches nothing — no move before it raised/],
  ['a catch whose goto is declared for another tag', p => {
    p.nodes.greet.steps[1].onError.push({ tag: 'Other', goto: 'named' });
    const w = runs(p)[1].trace.steps;
    const m = w.find(x => x.k === 'catch');
    m.goto = 'named';
    m.next = 3;
  }, /which greet declares for "Other", and the error travelling is "NoSuchUser"/],
  ['a return that discards a travelling error', p => {
    // "no such user": the callee throws, its frame propagates, and the caller
    // catches. Drop the catch and let the caller return instead, and the trace
    // has thrown an error away with no catch and no top.
    const w = runs(p)[1].trace.steps;
    const at = w.findIndex(x => x.k === 'catch');
    w.splice(at, 1);
  }, /ran while "NoSuchUser" was still travelling \(raised at move \d+\)/],
  ['a done that arrives while an error is travelling', p => {
    const w = runs(p)[2].trace.steps;
    w.splice(w.length - 1, 1, { k: 'done' });
  }, /done arrived while "SendFailed" was still travelling/],
  ['a trace that ends while an error is still travelling', p => {
    // The last move propagates the last frame. No frame is open, so the
    // frames-still-open rule is content, and the error has nowhere left to go.
    only(p).presets = [runs(p)[2]];
    const w = runs(p)[0].trace.steps;
    w.splice(w.length - 1, 1, { k: 'propagate' });
  }, /the trace ended while "SendFailed" was still travelling/],
  ['a trace that ends with a frame open', p => {
    // Drop the entry frame's return and the done that followed it.
    const w = runs(p)[0].trace.steps;
    w.splice(w.length - 2, 2);
  }, /the trace ended with 1 frame\(s\) still open/],
  ['a done that arrives with a frame still open', p => {
    const w = runs(p)[0].trace.steps;
    w.splice(w.length - 2, 1);
  }, /done arrived with 1 frame\(s\) still open/],
];

for (const [what, mutate, expected] of cases) {
  test(`refuses ${what}`, () => {
    const r = check(derive(mutate));
    assert.equal(r.code, 1, `expected a refusal, got:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, expected);
  });
}

/* -- a fail is in the contract, a die never is ---------------------------- */

const throwAsDie = prog => {
  prog.nodes.lookupName.steps[3].cause = 'die';
  for (const r of runs(prog)) for (const m of r.trace.steps) if (m.k === 'throw') m.cause = 'die';
};

test('a node that throws a fail names the tag in its error list', () => {
  const file = derive(prog => { prog.nodes.lookupName.channels.error = []; });
  const r = check(file);
  assert.equal(r.code, 1, r.stdout);
  assert.match(r.stderr, /nodes\.lookupName\.steps\[3\]: throws "NoSuchUser" as a fail, and lookupName's error list does not name it/);
});

test('a node that throws a die does not name the tag in its error list', () => {
  const file = derive(throwAsDie);
  const r = check(file);
  assert.equal(r.code, 1, r.stdout);
  assert.match(r.stderr, /nodes\.lookupName\.steps\[3\]: throws "NoSuchUser" as a die, and lookupName's error list names it — a die is never in the list/);
});

test('a fail that leaves a node uncaught is in that node\'s error list', () => {
  // SendFailed is raised by an effect, not thrown by a step, so only the trace
  // can say it leaves greet.
  const file = derive(prog => { prog.nodes.greet.channels.error = ['NoSuchUser']; });
  const r = check(file);
  assert.equal(r.code, 1, r.stdout);
  assert.match(r.stderr, /presets\[2\]\.trace\.steps\[9\]: graph "greet", run "the post fails", move 9: "SendFailed" is a fail and leaves greet, but greet's error list does not name it/);
});

test('a die that leaves a node is not in that node\'s error list', () => {
  const file = derive(prog => {
    for (const m of runs(prog)[2].trace.steps) {
      if (m.raised) m.raised.cause = 'die';
      if (m.k === 'uncaught') m.cause = 'die';
    }
  });
  const r = check(file);
  assert.equal(r.code, 1, r.stdout);
  assert.match(r.stderr, /move 9: "SendFailed" is a die and leaves greet, but greet's error list names it — a die is never in the list/);
});

test('a fail that leaves a node by propagate is in that node\'s error list', () => {
  // "a known user": the db.get effect inside lookupName raises instead of
  // returning. A propagate pops the lookupName frame before the uncaught at
  // the top pops greet's — so this exercises the leaves() call on propagate,
  // not the one on uncaught that the other tests above already cover.
  const file = derive(prog => {
    const w = runs(prog)[0].trace.steps;
    w[2] = { k: 'effect', at: 0, kind: 'db.get', desc: 'read the name row', raised: { tag: 'StoreDown', message: 'store down', cause: 'fail' } };
    w.splice(3, w.length - 3, { k: 'propagate' }, { k: 'uncaught', tag: 'StoreDown', message: 'store down', cause: 'fail' });
    prog.nodes.greet.channels.error.push('StoreDown');
  });
  const r = check(file);
  assert.equal(r.code, 1, r.stdout);
  assert.match(r.stderr, /move 3: "StoreDown" is a fail and leaves lookupName, but lookupName's error list does not name it/);
});

test('catching a die is legal, and worth seeing', () => {
  const file = derive(prog => {
    throwAsDie(prog);
    prog.nodes.lookupName.channels.error = [];
    prog.nodes.greet.channels.error = ['SendFailed'];
  });
  const r = check(file);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /greet\[1\] catches "NoSuchUser", which the file throws as a die/);
});

/* -- a move restates its step's cause, or the cause travelling ------------ */

test('a throw move whose cause does not match its step\'s cause is refused', () => {
  // "no such user": lookupName.steps[3] throws NoSuchUser as a fail, and the
  // throw move at move 4 repeats that cause. Misstate it there.
  const file = derive(prog => {
    const w = runs(prog)[1].trace.steps;
    const at = w.findIndex(m => m.k === 'throw');
    w[at].cause = 'die';
  });
  const r = check(file);
  assert.equal(r.code, 1, r.stdout);
  assert.match(
    r.stderr,
    /graphs\[0\]\.presets\[1\]\.trace\.steps\[\d+\]: graph "greet", run "no such user", move \d+: throw cause "die" does not match step cause "fail"/,
  );
});

test('an uncaught move whose cause does not match the error travelling is refused', () => {
  // "the post fails": the effect's raised.cause is "fail". Leave it, and
  // misstate the cause on the uncaught move that carries the same tag.
  const file = derive(prog => {
    const w = runs(prog)[2].trace.steps;
    w[w.length - 1].cause = 'die';
  });
  const r = check(file);
  assert.equal(r.code, 1, r.stdout);
  assert.match(
    r.stderr,
    /graphs\[0\]\.presets\[2\]\.trace\.steps\[\d+\]: graph "greet", run "the post fails", move \d+: "SendFailed" reached the top as a die, but the error travelling is a fail/,
  );
});

test('the old one-graph shape is refused, and the message names graphs', () => {
  // A file states one change, not one graph. Accepting both shapes would be
  // two ways to say one thing, so a stale file fails loudly rather than
  // rendering half of what it means.
  const file = derive(prog => {
    prog.entry = prog.graphs[0].entry;
    prog.presets = prog.graphs[0].presets;
    delete prog.graphs;
  });
  const r = check(file);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /file: this is the old one-graph shape/);
  assert.match(r.stderr, /"graphs"/);
  // One refusal, not a cascade: the fix is one reshape, and three lines
  // describing the symptom help nobody.
  assert.match(r.stderr, /: 1 refusal\(s\)/);
});

test('a file carrying only a top-level presets is refused the same way', () => {
  const file = derive(prog => {
    prog.presets = prog.graphs[0].presets;
  });
  const r = check(file);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /this is the old one-graph shape/);
});

test('an absent optional field is not refused, and the empty one is', () => {
  // Leave a field out rather than write it empty. "files": [] claims a change
  // that touched nothing, which is a different statement from saying nothing
  // about changed files.
  const absent = derive(prog => {
    delete prog.files;
    delete prog.layers;
    delete prog.sheet;
  });
  assert.equal(check(absent).code, 0);
  assert.equal(check(derive(p => { p.files = []; })).code, 1);
});

/* -- findings are not refusals -------------------------------------------- */

test('a finding prints on standard output and the exit code stays zero', () => {
  const r = check(layeredFlightpath);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /several nodes edit /);
  assert.match(r.stdout, /no node accounts for /);
});

/* -- text out of the file is never safe as an object key -------------------
 *
 * Every fixture below uses the bare name as the whole value, and that is the
 * whole trick: `src/constructor` and `constructor.ts` are ordinary keys and
 * reproduce nothing. Only the exact prototype member does, so a fixture that
 * decorates it passes while testing nothing.
 */

test('a node id named after a prototype member is a finding, not a stack trace', () => {
  // `raisedInWalks` is keyed by node id, and `tagsOf` reads it as
  // `raisedInWalks[id] || []`. On a plain object that read returns a function
  // for a node called `constructor`, the fallback never fires, and `new Set`
  // is handed something it cannot iterate — a stack trace where a finding
  // belongs.
  const file = derive(prog => {
    prog.nodes.constructor = JSON.parse(JSON.stringify(prog.nodes.lookupName));
    prog.nodes.constructor.name = 'constructor';
    prog.nodes.constructor.touches = ['src/greet.ts'];
  });
  const r = check(file);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.doesNotMatch(r.stderr, /TypeError|Cannot read|at Object|not iterable/);
  // And the finding it was supposed to produce is there.
  assert.match(r.stdout, /several nodes edit src\/greet\.ts/);
});

test('a goto to a label named after a prototype member is refused where the fault is', () => {
  // The one that matters more than the crash. `labelsOf` builds the label
  // table, and the caller refuses a jump when `L[s.to] === undefined`. On a
  // plain object that test is false for `constructor`, so the refusal never
  // fires and the fault surfaces two moves later as a walk that cannot make
  // its own edge — the author is told their walk is wrong when their node is.
  const at = p => { p.nodes.greet.steps[4].to = 'constructor'; };
  const r = check(derive(at));
  assert.equal(r.code, 1);
  assert.match(r.stderr, /to "constructor" is not a label in greet/);
  // Not the downstream symptom, and not twice.
  assert.doesNotMatch(r.stderr, /no edge from/);

  // The same mistake spelled anything else already read this way, and still
  // does. This is the comparison that shows the two had diverged.
  const plain = check(derive(p => { p.nodes.greet.steps[4].to = 'nowhere'; }));
  assert.match(plain.stderr, /to "nowhere" is not a label in greet/);
  // Normalised for the tag and for the fixture's own name, which differ by
  // construction and are not what is under test.
  const shape = (s, tag) => s.replace(tag, 'X').replace(/case-\d+/g, 'case-N');
  assert.equal(
    shape(r.stderr, /"constructor"/g),
    shape(plain.stderr, /"nowhere"/g),
    'the two spellings of one mistake are refused identically',
  );
});

test('a call to a node that does not exist is refused, even named after a prototype member', () => {
  // The map that matters most is the one this code does not build: `JSON.parse`
  // hands back a plain object, so `prog.nodes.constructor` answers with a
  // function for a node the file never declared and `if (!prog.nodes[target])`
  // silently stops guarding.
  //
  // The failure is not a crash. Put the call on a step no walk runs, and the
  // file validates clean and exits zero — a validator accepting a file that
  // contradicts its own graph, which is the one thing it exists to prevent.
  const file = derive(prog => {
    prog.nodes.lookupName.steps.push({ op: 'call', target: 'constructor', label: 'ghost' });
  });
  const r = check(file);
  assert.equal(r.code, 1, `a call to a node that is not there must be refused:\n${r.stdout}`);
  assert.match(r.stderr, /target "constructor" is not a node/);
});

test('a walk calling a node that does not exist is refused for the right reason', () => {
  // Reached through a walk the same fault surfaced as three walk refusals
  // saying the move disagreed with its step — pointing at the walks, when what
  // is wrong is that the step targets a node the file has not got.
  const file = derive(prog => {
    prog.nodes.greet.steps[1].target = 'constructor';
  });
  const r = check(file);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /target "constructor" is not a node/);
});

test("a node no graph's entry reaches is a finding, and the file still validates", () => {
  // Legal, and worth seeing: a node the author wrote and has not connected yet
  // is a work in progress, not a contradiction. Refusing it would refuse a
  // file that says exactly what its author meant.
  const file = derive(prog => {
    prog.nodes.orphan = { ...JSON.parse(JSON.stringify(prog.nodes.lookupName)), name: 'orphan' };
  });
  const r = check(file);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /no graph's entry reaches orphan, so no sheet draws it/);
});

test('the unaccounted-files finding reads every node of the change', () => {
  // A file another graph covers is not reported. Per graph this finding was
  // true of one sheet and silent about the rest, so a reader holding two files
  // got two answers that did not add up.
  const file = derive(prog => {
    prog.files.push({ path: 'src/panel.ts', change: 'new', why: 'the second entry point', adds: 40, dels: 0 });
    addSecondGraph(prog);
  });
  const r = check(file);
  assert.equal(r.code, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /no node accounts for src\/panel\.ts/);
  assert.doesNotMatch(r.stdout, /no graph's entry reaches/);
});

test('an E tag nothing beneath the node can produce is a finding', () => {
  const file = derive(prog => {
    prog.nodes.greet.channels.error.push('NeverRaised');
  });
  const r = check(file);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /greet declares error tag "NeverRaised", and nothing beneath it produces that tag/);
});

/* -- the text output ------------------------------------------------------ */

// The shipped pull-request example states two graphs, so every reading of it
// names one. The first-paint sheet is the one these were written against.
const firstPaint = ['--graph', 'first-paint'];

test('the text prints one row per call site and lists the runs it did not print', () => {
  const r = run(groundtrack, [layeredFlightpath, '--text', ...firstPaint]);
  assert.equal(r.code, 0);
  // bindSheet is called twice from buildShelf, so it appears twice, and the
  // two rows carry different end marks.
  const rows = r.stdout.split('\n').filter(l => /->\s+bindSheet/.test(l));
  assert.equal(rows.length, 2);
  assert.match(r.stdout, /other runs in this file:/);
  assert.match(r.stdout, /"no 2D context" — /);
});

test('the text suggests the longest walk', () => {
  const prog = JSON.parse(readFileSync(layeredFlightpath, 'utf8'));
  const longest = runs(prog).reduce((a, b) => (b.trace.steps.length > a.trace.steps.length ? b : a));
  const r = run(groundtrack, [layeredFlightpath, '--text', ...firstPaint]);
  assert.match(r.stdout, new RegExp(`run "${longest.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
});

test('the run the reader names is the run that prints', () => {
  const r = run(groundtrack, [layeredFlightpath, '--text', '?tune= flat', ...firstPaint]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /run "\?tune= flat"/);
});

test('a run the file has not got is refused by name', () => {
  const r = run(groundtrack, [layeredFlightpath, '--text', 'no such run', ...firstPaint]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /no run called "no such run"/);
});

test('two graphs of one change may each have a run of that name', () => {
  // Uniqueness is per graph, and the two sheets of the shipped example are
  // where that stops being a rule on paper.
  const prog = JSON.parse(readFileSync(layeredFlightpath, 'utf8'));
  const name = prog.graphs[0].presets[0].name;
  prog.graphs[1].presets[0].name = name;
  const p = join(work, `shared-run-${n++}.flightpath.json`);
  writeFileSync(p, JSON.stringify(prog, null, 2));
  assert.equal(check(p).code, 0, check(p).stderr);
  // And naming it resolves within the graph the reader chose.
  const r = run(groundtrack, [p, '--text', name, '--graph', 'panel-apply']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^applySettings/m);
});

test('a several-graph file without --graph lists the graphs and stops', () => {
  // Nothing ranks the graphs and nothing suggests one. A change with two entry
  // points has two starting points and no reason to prefer either, so the
  // command says what there is and lets the reader choose.
  const file = derive(addSecondGraph);
  const r = run(groundtrack, [file, '--text']);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /^greet {2}greet a user$/m);
  assert.match(r.stdout, /^panel-apply {2}apply the panel$/m);
  assert.match(r.stderr, /this file states 2 graphs\. Name one with --graph <id>/);
  assert.doesNotMatch(r.stdout, /\[handler\]/, 'no tree was printed');
});

test('--graph names the graph that prints', () => {
  const file = derive(addSecondGraph);
  const r = run(groundtrack, [file, '--text', '--graph', 'panel-apply']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^applyPanel {2}\[handler\]/m);
  assert.doesNotMatch(r.stdout, /^greet {2}\[/m, 'the first graph is not on this sheet');
});

test('a graph the file has not got is refused by name', () => {
  const file = derive(addSecondGraph);
  const r = run(groundtrack, [file, '--text', '--graph', 'no-such-graph']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /no graph called "no-such-graph"\. This file has: "greet", "panel-apply"/);
});

test('a one-graph file needs no --graph, and takes one', () => {
  const bare = run(groundtrack, [exampleFlightpath, '--text']);
  const named = run(groundtrack, [exampleFlightpath, '--text', '--graph', 'greet']);
  assert.equal(bare.code, 0);
  assert.equal(named.code, 0, named.stderr);
  assert.equal(bare.stdout, named.stdout);
});

test('--graph with no value, or followed by a flag, lands at the usage line', () => {
  for (const args of [[exampleFlightpath, '--graph'], [exampleFlightpath, '--graph', '--check']]) {
    const r = run(groundtrack, args);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /^usage: node render\.mjs/m);
  }
});

test('--graph is refused where nothing would read it, rather than ignored', () => {
  // Accepted and discarded, --graph hands back a page for a graph the reader
  // did not ask for, with exit 0 and nothing said. --check reads every graph
  // of the change, and the page carries all of them and offers a picker, so
  // neither has a graph to select.
  const file = derive(addSecondGraph);
  const out = join(work, `unread-${n++}.html`);
  for (const args of [
    [file, '--graph', 'panel-apply', '--check'],
    [file, '--graph', 'panel-apply', '--out', out],
  ]) {
    const r = run(groundtrack, args);
    assert.equal(r.code, 2, `expected a refusal, got:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /--graph names the one graph a reading is of, and only --text is one/);
    // And it says why in the one case a reader might reasonably expect it to
    // work: the page has a picker, so a sheet to open on is a thing this flag
    // does not do rather than a thing it silently ignored.
    assert.match(r.stderr, /does not open on a named sheet/);
  }
  assert.ok(!existsSync(out), 'no page was written for a graph nothing would draw');
});

test('the end marks differ between runs, so choosing one changes what is read', () => {
  const a = run(groundtrack, [layeredFlightpath, '--text', 'default page', ...firstPaint]).stdout;
  const b = run(groundtrack, [layeredFlightpath, '--text', 'the sheet 404s', ...firstPaint]).stdout;
  assert.notEqual(a, b);
});

test('a repeated node is marked and stopped rather than expanded forever', () => {
  // The shipped examples hold no cycle, so this one is derived: greet calls
  // lookupName, and lookupName is given a call back to greet. The call goes on
  // the end of the node so no step index moves and every shipped walk still
  // fits.
  const file = derive(prog => {
    prog.nodes.lookupName.steps.push({ op: 'call', target: 'greet', label: 'again' });
  });
  const r = run(groundtrack, [file, '--text']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /seen above — stopped/);
  // And it terminates: the file validates too.
  assert.equal(check(file).code, 0);
});

test('the text prints the failure kind beside every E tag', () => {
  // The kind is what tells a blip from a crash, and it is the one thing the
  // skill calls the point of the drawing. Before this it reached the reader
  // only when the run they happened to pick hit that failure.
  const r = run(groundtrack, [exampleFlightpath, '--text']);
  assert.equal(r.code, 0, r.stderr);
  // greet declares NoSuchUser and SendFailed; lookupName declares NoSuchUser.
  assert.equal((r.stdout.match(/NoSuchUser fail/g) || []).length, 2);
  assert.equal((r.stdout.match(/SendFailed fail/g) || []).length, 1);
});

test('a tag the file gives no kind for prints bare', () => {
  // The page invents nothing. An E channel may name a tag no throw step and no
  // walk accounts for — the check reports it as a finding, and the row still
  // has to print it.
  const file = derive(prog => {
    prog.nodes.greet.channels.error.push('Ghost');
  });
  const r = run(groundtrack, [file, '--text']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Ghost(?! (fail|die))/);
});

test('a tag named after a property of every object prints, rather than crashing the renderer', () => {
  // A failure tag is a stranger's text and nothing constrains it. Looking a
  // kind up in a plain object answers "constructor" with a function, and the
  // row then asks the function for its kinds. The tag has no kind, so it
  // prints bare, exactly like any other tag the file says nothing about.
  const file = derive(prog => {
    prog.nodes.greet.channels.error.push('constructor', 'toString');
  });
  const r = run(groundtrack, [file, '--text']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /constructor(?! (fail|die))/);
  assert.equal(check(file).code, 0);
});

test('a tag raised with two kinds prints both, fail before die', () => {
  // A tag that fails in one node and is a defect in another is two facts about
  // the file. failureKinds reads the whole file for them, and a throw step
  // counts even when no walk in this file exercises it — so a die for
  // SendFailed is added to lookupName, which does not name the tag in its own
  // error list. (A die can never leave greet's own frame: greet's error list
  // names SendFailed, because the shipped "the post fails" run raises it as a
  // fail there, and a fail and a die for one tag cannot both be true of one
  // node.)
  const file = derive(prog => {
    prog.nodes.lookupName.steps.push({ op: 'throw', tag: 'SendFailed', message: 'a defect, not a fail', cause: 'die' });
  });
  assert.equal(check(file).code, 0, check(file).stderr);
  const r = run(groundtrack, [file, '--text']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /SendFailed fail die/);
});

test('the text says where the walks came from, above everything', () => {
  const r = run(groundtrack, [exampleFlightpath, '--text']);
  assert.match(r.stdout.split('\n')[0], /written by hand\. They are claims about the program, not recordings of it\./);
});

/** The text's rows, one block of lines per row, split at each row's head. */
const textRows = stdout =>
  stdout.split('\n').reduce((rows, line) => {
    if (/^ *(-> )?\S+ {2}\[/.test(line)) rows.push([line]);
    else if (rows.length) rows[rows.length - 1].push(line);
    return rows;
  }, []);
const errorLines = stdout => textRows(stdout).map(b => (b.find(l => l.includes('error path:')) || '').trim());

/** Where each row stands when StoreDown reaches the top: greet, loadProfile,
 *  the lookup by id, the lookup by alias. */
const storeDownPath = ['error path: propagated', 'error path: propagated', '', 'error path: thrown StoreDown'];

test('the text marks where each row stood on an error that is still live at the end', () => {
  // --text folds to the end of the walk, so the error it can show is one that
  // reached the top. A limit, stated: a catch never shows here. A return ends
  // the error the catch took, and a walk cannot end with its entry frame open,
  // so no valid walk ends on a caught error.
  const file = derive(errorPastTwoSites);
  assert.equal(check(file).code, 0, 'the derived file is a legal program');
  const r = run(groundtrack, [file, '--text', 'the store is down']);
  assert.equal(r.code, 0, r.stderr);
  // greet is still open when the error reaches the top, so it propagated too.
  assert.deepEqual(errorLines(r.stdout), storeDownPath);
  // The row that threw is the lookup by alias. The lookup by id is the same
  // node from another call site, and it took no part.
  const rows = textRows(r.stdout);
  assert.ok(rows[3].some(l => l.includes('by alias')));
  assert.ok(rows[2].some(l => l.includes('by id')));
});

test('a walk that leaves the propagates out marks the same frames as one that writes them', () => {
  // The move that reaches the top propagates every frame still open, so a
  // propagate per crossed frame is optional. Drop both from the three-frame
  // run: the file is still legal, and the text reads exactly as it did.
  const file = derive(prog => {
    errorPastTwoSites(prog);
    const trace = runs(prog).find(p => p.name === 'the store is down').trace;
    trace.steps = trace.steps.filter(m => m.k !== 'propagate');
  });
  assert.equal(check(file).code, 0, check(file).stderr);
  const r = run(groundtrack, [file, '--text', 'the store is down']);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(errorLines(r.stdout), storeDownPath);
});

test('the text marks nothing when the walk ends with no error live', () => {
  const file = derive(errorPastTwoSites);
  const r = run(groundtrack, [file, '--text', 'the alias is missing']);
  assert.equal(r.code, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /error path:/);
});

test('the text marks the entry that raised, and no row for the top', () => {
  const r = run(groundtrack, [exampleFlightpath, '--text', 'the post fails']);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(errorLines(r.stdout), ['error path: thrown SendFailed', '']);
});

test('the text names the contract in words, not letters', () => {
  const r = run(groundtrack, [exampleFlightpath, '--text']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /success a greeting line {3}error NoSuchUser fail · SendFailed fail {3}requirements the name store/);
  assert.doesNotMatch(r.stdout, /(^| {3})[AER] /m);
  assert.match(r.stdout, /requirements under tests: /);
});

/* -- the page as a string ------------------------------------------------- */

const pageOf = file => {
  const out = join(work, `page-${n++}.html`);
  const r = run(groundtrack, [file, '--out', out]);
  assert.equal(r.code, 0, r.stderr);
  return readFileSync(out, 'utf8');
};

test('the page embeds the file', () => {
  const html = pageOf(exampleFlightpath);
  assert.match(html, /"id":"example-greet"/);
});

test('the page prints the failure kind beside the tag, and what the node does with it', () => {
  // A limit, stated: the page draws its rows in the browser, so no assertion
  // here can read a rendered row. What it can read is that the page carries
  // the one derivation the module exports and the closed vocabulary it prints
  // — the alternative, a kind table baked into the page by the renderer, would
  // be a second copy of a fact the module already computes.
  const html = pageOf(exampleFlightpath);
  // The page derives the table for itself. A table the renderer had computed
  // and baked in would be a second copy of a fact the module already holds.
  assert.match(html, /G\.failureKinds\(/);
  assert.doesNotMatch(html, /"failureKinds":/);
  // The tree row and the contract tab both read it, and neither writes it.
  assert.match(html, /row\.kinds/);
  assert.match(html, /G\.tagFate\(/);
  // The kind is a mark with a class of its own, not author text.
  assert.match(html, /class="ekind"/);
  // And the contract tab can say all three things about a tag.
  for (const word of ['throws', 'catches', 'passes up from beneath']) {
    assert.ok(html.includes(word), `the contract tab can say "${word}"`);
  }
});

test('the page tree marks the error path from the row, with a word and a rule for each position', () => {
  // A limit, stated, and the same one the failure-kind test states: the page
  // draws its rows in the browser, so this reads the markup and the rules the
  // page ships, not a drawn row. What it can hold is that the tree reads the
  // one derivation the module exports, and that every position has a signal
  // that is not a hue — the site scheme folds caution to ink.
  const html = pageOf(exampleFlightpath);
  const tree = between(html, 'function drawTree(', '/* -- the rail');
  assert.match(tree, /row\.path/, 'the tree reads the row, not the error path');
  assert.match(tree, /G\.ERROR_POSITION\[row\.path\]/, 'the page sorts words into positions by the module s one table');

  // THE HARD REQUIREMENT, and the reason this assertion is shaped the way it
  // is. #79: "Each of the three positions needs a non-colour signal ... that
  // carries it in one ink." A stripe is a hue and proves nothing on paper, in
  // the site scheme, or for a colour-blind reader. So the stripe is asserted
  // separately below, and what is checked HERE is that the three positions
  // stay apart with every colour removed.
  const marks = between(html, 'const PATH_MARK', '};');
  const glyphs = [...marks.matchAll(/glyph: '([^']+)'/g)].map(m => m[1]);
  assert.equal(glyphs.length, 4, 'a glyph per fold word, the top included');
  assert.equal(new Set(glyphs).size, 4, 'and no two of them are the same mark');
  // The word too, which is the channel that needs no legend. It is one of the
  // fold's own four, so a reader never has to learn a key.
  assert.match(tree, /class="tr-pl[^"]*">' \+ row\.path/, 'the position is written out as its own word');
  // Neither channel is a hue: the glyph is a character and the word is text,
  // and both sit in the row's own ink flow until a role paints them.
  assert.match(tree, /class="tr-gl/, 'the glyph is drawn before the name');
  assert.match(html, /\.gt-chip\b[^{]*\{[^}]*border:/, 'the chip is a hairline border, not a fill');
  assert.match(tree, /tr-err-tag/, 'the tag stays beside the row that threw');

  // The stripe is the third channel and the only one that IS a hue.
  for (const cls of ['tr--thrown', 'tr--onpath', 'tr--caught']) {
    assert.match(html, new RegExp(`\\.${cls}\\b[^{]*\\{[^}]*box-shadow`), `${cls} carries the path stripe`);
  }
  // Thrown takes a fourth signal the other two do not, in ink rather than hue,
  // because it is the position a reader looks for first.
  assert.match(html, /\.tr--thrown\b[^{]*\{[^}]*border-bottom:[^;]*var\(--av-ink\)/, 'the throw is ruled under, in ink');
  // The glyph and the word each take their OWN caught modifier. One shared
  // modifier string reads fine in the deck theme, where both roles resolve to
  // a colour, and paints the caught word redline in the site theme, where the
  // path is redline and caught is ink. That was the bug; this is the guard.
  for (const cls of ['tr-gl--caught', 'tr-pl--caught']) {
    assert.match(tree, new RegExp(cls), `the markup sets ${cls}`);
    assert.match(html, new RegExp(`\\.${cls}\\b[^{]*\\{[^}]*var\\(--av-path-caught\\)`), `${cls} asks for the caught role`);
  }
  assert.match(html, /\.gt-chip\b[^{]*\{[^}]*border:/, 'the chip is a hairline border, not a fill');
  assert.match(tree, /tr-err-tag/, 'the tag stays beside the row that threw');
  // The drawing is not this change: its box still reads the path by node.
  const box = between(html, 'function nodeBox(', '/* -- the tree');
  assert.doesNotMatch(box, /row\.error\b|\.error\.how|tr-err|tr-gl/);
});

test('the tree separates the running frame from the frames waiting under it', () => {
  const html = pageOf(exampleFlightpath);
  const tree = between(html, 'function drawTree(', '/* -- the rail');
  assert.match(tree, /row\.state === 'running'/, 'the running frame and the waiting ones part');
  assert.match(tree, /tr--waiting/, 'and the waiting ones have their own class');
  assert.match(html, /\.tr--waiting\b[^{]*\{[^}]*--av-state-rule/, 'waiting takes the system state rule');
  assert.match(html, /\.tr--active\b[^{]*\{[^}]*var\(--av-ink\)/, 'the running frame keeps full ink');
});

test('the sheet asks for the walk-sheet roles, never the raw mark colours', () => {
  // The design system names --av-path and --av-path-caught so each theme can
  // answer in its own colour. Reaching for --av-caution here would get amber
  // in the deck theme and plain ink in the site theme, where the path is
  // redline — the one place the mark is needed most.
  const html = pageOf(exampleFlightpath);
  for (const sel of ['.nd--error', '.fx--fail .fx-dot', '.caut', '.epath-gl']) {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(html, new RegExp(`${esc}\\s*(,[^{]*)?\\{[^}]*var\\(--av-path\\)`), `${sel} asks for the path role`);
  }
  const tree = between(html, 'function siteClass(', 'function drawSource(');
  assert.match(tree, /av-code-site--path/, 'the listing marks a failed site with the role');
  assert.match(tree, /av-code-site--caught/, 'the listing marks a returned site with the role');
});

test('the page prints the programming words, and none of the old ones', () => {
  const html = pageOf(exampleFlightpath);
  for (const word of ['>running<', '>waiting<', '>arguments<', "'propagated'", "'not called'", "'returned'", "'threw'"]) {
    assert.ok(html.includes(word), `the page carries ${word}`);
  }
  for (const word of ['on stack', 'not reached', 'passed through', "'landed'", "'failed'", 'nothing has raised', '>inputs<', 'A — returns', 'E — breaks', 'R — needs']) {
    assert.ok(!html.includes(word), `the page no longer carries ${word}`);
  }
});

/** The page's own head markup, which is where the controls are.
 *
 *  Sliced rather than searched whole, because the page carries the shared
 *  module inlined and the module carries the picker's markup as a string. A
 *  page that draws no picker still contains the source of the function that
 *  would have drawn one, so the whole page cannot answer "is there a control
 *  here" — only the markup can. */
const between = (html, from, to) => {
  const at = html.indexOf(from);
  return html.slice(at, html.indexOf(to, at));
};
const headOf = html => between(html, '<div class="head">', '<div class="plan');

test('a one-graph file draws no sheet control', () => {
  // A control that does nothing is worse than no control, so a file with one
  // graph is not offered one.
  const head = headOf(pageOf(exampleFlightpath));
  assert.doesNotMatch(head, /id="sheet"/);
  assert.doesNotMatch(head, /data-graph=/);
});

test('a several-graph file draws one sheet control per graph', () => {
  const head = headOf(pageOf(derive(addSecondGraph)));
  assert.match(head, /<select id="sheet"/);
  const options = head.slice(head.indexOf('<select id="sheet"'), head.indexOf('</select>'));
  assert.equal((options.match(/<option /g) || []).length, 2);
  // By title, and each carrying its graph's validated id.
  assert.ok(options.includes('apply the panel'));
  assert.match(options, /data-graph="panel-apply"/);
});

test('the shipped pull-request example draws one sheet control per graph', () => {
  // The acceptance set, not a derived fixture: the ticket names this example
  // because a picker that only ever meets a two-node greet has not met a real
  // change with a shared node map.
  const prog = JSON.parse(readFileSync(layeredFlightpath, 'utf8'));
  assert.equal(prog.graphs.length, 2, 'the shipped example states two graphs');
  const head = headOf(pageOf(layeredFlightpath));
  const options = head.slice(head.indexOf('<select id="sheet"'), head.indexOf('</select>'));
  assert.equal((options.match(/<option /g) || []).length, 2);
  for (const g of prog.graphs) {
    assert.ok(options.includes(g.title), `the picker lists "${g.title}"`);
    assert.ok(options.includes(`data-graph="${g.id}"`), `and carries the id ${g.id}`);
  }
});

test('the sheet picker sits in the head, left of the run picker', () => {
  // The locked spec's tempo table: a sheet changes slower than a run and
  // changes everything beneath it, so it reads first.
  const head = headOf(pageOf(derive(addSecondGraph)));
  assert.ok(head.includes('id="sheet"'), 'the picker is in the head');
  assert.ok(head.indexOf('id="sheet"') < head.indexOf('id="run"'), 'and before the run picker');
});

test('the head is two rows: the lockup above, everything that drives the walk below', () => {
  // A run picker wide enough to read a run's blurb does not share a row with
  // the title, and the sheet picker made that row one control longer. So the
  // first row is identity and the second is controls, in the order a reader
  // chooses them: the sheet, the run on it, then the moves of that run.
  const head = headOf(pageOf(derive(addSecondGraph)));
  const rows = head.split('<div class="head-row">').slice(1);
  assert.equal(rows.length, 2);
  assert.ok(rows[0].includes('id="title"'), 'the lockup is on the first row');
  for (const id of ['sheet', 'run', 'play', 'stepnow']) {
    assert.ok(!rows[0].includes(`id="${id}"`), `${id} is not on the first row`);
    assert.ok(rows[1].includes(`id="${id}"`), `${id} is on the second`);
  }
  const order = ['id="sheet"', 'id="run"', 'class="btn-group"'].map(s => rows[1].indexOf(s));
  assert.deepEqual(order.slice().sort((a, b) => a - b), order, 'sheet, then run, then the step controls');
});

test('a one-graph file still gets the second row, with the run picker on it', () => {
  const head = headOf(pageOf(exampleFlightpath));
  const rows = head.split('<div class="head-row">').slice(1);
  assert.equal(rows.length, 2);
  assert.ok(rows[1].includes('id="run"') && rows[1].includes('id="play"'));
  assert.doesNotMatch(rows[1], /id="sheet"/);
});

test('a graph title reaches the page as text', () => {
  const head = headOf(pageOf(derive(prog => {
    addSecondGraph(prog);
    prog.graphs[1].title = 'panel & <script>alert("x")</script>';
  })));
  assert.ok(!head.includes('panel & <script>alert'), 'not as markup');
  // The escape turns the ampersand and the opening bracket, which is all it
  // takes: a `>` with no `<` opens nothing.
  assert.match(head, /panel &amp; &lt;script>alert/);
});

test('the page seeds a sheet from the module rather than keeping its own copy', () => {
  // A limit, stated, and the same one the failure-kind test states. What a
  // sheet remembers is the module's — `sheetState`, and the fold tests hold
  // that two sheets get two of them and that moving one leaves the other. That
  // a reader who leaves a sheet and returns finds it as they left it is a
  // property of the running page, and nothing here runs one: no DOM, by
  // design. It was driven by hand in a browser instead.
  //
  // What this can hold is the seam: the page calls the module's constructor,
  // so there is one definition of what a sheet remembers and not two. Nothing
  // else about the page's spelling is pinned — the accessor test below says
  // why pinning a spelling is the wrong trade.
  const template = readFileSync(join(groundtrack, '..', '..', 'assets', 'template.html'), 'utf8');
  const body = template.slice(template.indexOf('function start()'));
  assert.match(body, /G\.sheetState\(/);
});

test('the page draws a wire and a recursion count by the module\'s rules, not its own', () => {
  // The same limit as the test above: nothing here runs the page. Which wire
  // is live, which one a move animates and what count a node shows are held in
  // the fold tests, against the module. What this holds is that the page asks
  // the module, so a mutual pair cannot animate both its wires on the page
  // while the module says one — and that stepping back hands the module the
  // move's direction, which is the half the page used to drop.
  const template = readFileSync(join(groundtrack, '..', '..', 'assets', 'template.html'), 'utf8');
  const body = template.slice(template.indexOf('function start()'));
  assert.match(body, /G\.wireLive\(/);
  assert.match(body, /G\.wireFlow\(/);
  assert.match(body, /G\.countMark\(/);
  assert.match(body, /S\.redraw = G\.back\(S\.states, S\.at\)\.redraw/);
  // No second copy of the old rule, which matched a move in both directions.
  assert.doesNotMatch(body, /S\.redraw\.from === e\.to/);
});

test('the page reads its graph through an accessor, not off the file root', () => {
  // The prefactor the sheets ticket needs: which graph is on the sheet is one
  // place to change, not fifteen reads scattered through the template. The
  // property is that nothing under start() reaches for a graph's fields on the
  // file root — which is what the next ticket relies on, and what a refactor
  // must not undo. The accessor's own spelling is not pinned; pinning it would
  // fail a rename that changed no behaviour.
  const template = readFileSync(join(groundtrack, '..', '..', 'assets', 'template.html'), 'utf8');
  const body = template.slice(template.indexOf('function start()'));
  assert.doesNotMatch(body, /PROG\.presets/);
  assert.doesNotMatch(body, /PROG\.entry/);
});

/** The plan pane's markup, and the rail head's, sliced out of the page for the
 *  reason headOf gives: only the markup can say where a control is. */
const planOf = html => between(html, '<div class="plan"', '<div class="side"');
const railHeadOf = html => between(html, '<div class="side-head"', '<div class="blk"');

test('no tool sits on the plan pane: the drawing and the tree own all of it', () => {
  // A block laid over the pane cost the drawing a pan to clear a node, and
  // cost the tree — which has no pan — rows it could never show. Laid in flow
  // above the tree it left a band of empty space instead. So no tool lives on
  // the pane at all, and neither view has a corner to hide under.
  //
  // A limit, stated: this reads the markup the page ships. The layer buttons
  // are built at run time, into #layerGrp, and the test below holds that
  // #layerGrp is in the rail head.
  const plan = planOf(pageOf(layeredFlightpath));
  assert.match(plan, /id="canvas"/);
  assert.match(plan, /id="tree"/);
  assert.doesNotMatch(plan, /<(button|select|input|label)\b/, 'no control on the pane');
});

test("the tools are the rail head's rows: zoom, layer, view, then the holds", () => {
  // One table of the controls that change how the sheet is read, with the
  // holds as its last row. A row per tool, keyed down the left.
  const head = railHeadOf(pageOf(layeredFlightpath));
  const keys = [...head.matchAll(/class="grp-k[^"]*"[^>]*>([^<]+)</g)].map(m => m[1]);
  assert.deepEqual(keys, ['zoom', 'layer', 'view', 'hold']);
  const ids = ['zoomOut', 'zoomFit', 'zoomIn', 'scaleNow', 'layerGrp', 'viewPlan', 'viewTree', 'holdEffect', 'holdError'];
  const at = ids.map(id => head.indexOf(`id="${id}"`));
  ids.forEach((id, i) => assert.ok(at[i] >= 0, `${id} is in the rail head`));
  assert.deepEqual(at.slice().sort((a, b) => a - b), at, 'in reading order');
});

test('a help note is never wider than the window less its margins', () => {
  // The module keeps a note inside the window only if the note fits in it.
  // The fold tests hold the placement; this holds the width it relies on,
  // which is the stylesheet's to cap before the page measures the note.
  const html = pageOf(exampleFlightpath);
  const rule = html.match(/\.tip \{([^}]*)\}/);
  assert.ok(rule, 'the page styles its help note');
  assert.match(rule[1], /max-width:\s*min\([^;]*100vw/, 'capped by the window, not by its text alone');
});

test('the page contains no dynamic code evaluation', () => {
  const html = pageOf(layeredFlightpath);
  assert.doesNotMatch(html, /\bnew Function\s*\(/);
  assert.doesNotMatch(html, /[^.\w]eval\s*\(/);
  assert.doesNotMatch(html, /setTimeout\s*\(\s*["'`]/);
});

test('the emitted page holds zero external references', () => {
  // The inverse of the incumbent's assertion, which pins its external link
  // count at exactly one. Here the count is zero, and this test is what keeps
  // a convenience link from creeping back.
  //
  // The SVG namespace is not a reference: no browser fetches it. Everything
  // that would go on the wire is listed here.
  const html = pageOf(layeredFlightpath);
  assert.doesNotMatch(html, /<link\b/i);
  assert.doesNotMatch(html, /\bsrc\s*=\s*["']https?:/i);
  assert.doesNotMatch(html, /\bhref\s*=\s*["']https?:/i);
  assert.doesNotMatch(html, /url\(\s*["']?https?:/i);
  assert.doesNotMatch(html, /@import/i);
  assert.doesNotMatch(html, /\bfetch\s*\(/);
  assert.doesNotMatch(html, /XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon/);
  // The faces are here instead, inlined: two subsets for each of three
  // weights, each under the unicode-range IBM declares for it.
  //
  // The brace matters. The vendored design-system bundle carries a header
  // explaining, in prose, that a stylesheet cannot embed a binary and that
  // @font-face rules are the consumer's job — so a bare /@font-face/ counts
  // that prose as if it were CSS. Rules have a brace; sentences do not.
  assert.equal((html.match(/@font-face\{/g) || []).length, 6);
  assert.equal((html.match(/src:url\(data:font\/woff2;base64,/g) || []).length, 6);
  assert.equal((html.match(/unicode-range:/g) || []).length, 6);
});

// The bytes that shipped, hashed. Taken from the files fetched from IBM's own
// repository when they were vendored.
//
// What this pins is drift here, not IBM's canonical release: it turns "somebody
// swapped in a hand-cut subset" or "somebody edited the licence" into a test
// failure, which is the failure mode assets/FONTS.md is written against. A name
// and a file signature cannot see edited bytes.
const VENDORED = {
  'IBMPlexMono-Medium-Latin1.woff2': '41201b658a328b9d00368215c2f1102770f80b15952ab82631e4006255e6365d',
  'IBMPlexMono-Medium-Pi.woff2': '92bd18415e8c43a2569f615e4e84a94b1b1c4e0377ba9d8f4d894bbf6ffcc39d',
  'IBMPlexMono-Regular-Latin1.woff2': 'e8993d946649b9d01abb1ed06d574b19d8ea3e66b5c3948602db335c44c18e56',
  'IBMPlexMono-Regular-Pi.woff2': 'b8002770aa636f544ba43e124da6a227301769754f295eae26e16475b469c767',
  'IBMPlexMono-SemiBold-Latin1.woff2': 'b7acd05041ab65f3b7039e218ddd893065e11a07e85ea85019473152a51b6b7d',
  'IBMPlexMono-SemiBold-Pi.woff2': '1637166246d386507b1351d59ddda93b732f781d06c0a6574e486104a00897b1',
  'OFL.txt': '7e6b2818edbd8f6a01ae80641cc8f16a51080d08fb4e532be3a0b6f74adb07da',
};

test("the shipped faces are IBM's own, unmodified", () => {
  // The licence names "Plex" as a Reserved Font Name, and a face we had cut
  // down ourselves would be a Modified Version that may not use it. So the
  // assets are IBM's published subsets, and this test is what notices if
  // somebody swaps in a hand-made one. See assets/FONTS.md.
  //
  // BOTH skills, not just this one. eagle-eye vendored its own copy rather
  // than reaching across the tree, for the reason FONTS.md gives: a skill
  // lands in a different directory under every install route. A second copy
  // is a second thing that can drift, so it is hashed against the same list.
  // The first thing that went wrong with it was line endings, caught by the
  // OFL check below one commit after the copy was made.
  const dirs = [
    join(groundtrack, '..', '..', 'assets'),
    join(groundtrack, '..', '..', '..', 'eagle-eye', 'assets'),
  ];

  for (const assets of dirs) {
    const faces = readdirSync(assets).filter(f => f.endsWith('.woff2')).sort();
    assert.deepEqual(faces, Object.keys(VENDORED).filter(f => f.endsWith('.woff2')).sort(), assets);

    for (const [name, want] of Object.entries(VENDORED)) {
      const bytes = readFileSync(join(assets, name));
      const got = createHash('sha256').update(bytes).digest('hex');
      assert.equal(got, want, `${join(assets, name)} is not the file that was vendored`);
    }
    for (const f of faces) {
      assert.equal(readFileSync(join(assets, f)).subarray(0, 4).toString('latin1'), 'wOF2', `${f} is not a woff2`);
    }

    // The licence travels with them, and it is IBM's copy rather than the blank
    // template: their copyright line is the first thing in it.
    const ofl = readFileSync(join(assets, 'OFL.txt'), 'utf8');
    assert.match(ofl.split('\n')[0], /Copyright .* IBM Corp\. with Reserved Font Name "Plex"/);
    assert.match(ofl, /SIL OPEN FONT LICENSE Version 1\.1/);
    // IBM ship it with CRLF, and .gitattributes keeps it that way — one rule
    // per path, so a new copy needs a new rule. A normalised copy is no longer
    // the file IBM publishes, and the hash above would catch it; this says
    // which of the two went wrong.
    assert.ok(ofl.includes('\r\n'), `${assets}: the licence lost its original line endings`);
  }

  // The bundle is the same class of file as the faces — vendored, do-not-edit,
  // and now in two places — so it gets the same guard, minus the fixed hash.
  // A hash would have to be bumped by hand on every design system release,
  // which is a step somebody skips; equality between the copies is the failure
  // that actually happens, and it happened once already inside this branch. The
  // header line is checked too, because an empty file is also "identical".
  const bundles = dirs.map(d => readFileSync(join(d, 'aviation.bundle.css')));
  assert.ok(bundles[0].equals(bundles[1]), 'the two vendored bundles have drifted apart');
  assert.match(bundles[0].toString('utf8').slice(0, 200), /AVIATION — BUNDLE/);
});

test('author text reaches the page as text, in every field the page shows', () => {
  // One field left out of this fixture is one field with no coverage, which is
  // how the incumbent shipped a row name that reached the page as markup.
  const POISON = '<img src=x onerror=alert(1)> & "quoted" </script><script>alert(2)</script>';
  const file = derive(prog => {
    prog.title = `T ${POISON}`;
    prog.blurb = `B ${POISON}`;
    only(prog).title = `GT ${POISON}`; // a graph's title — the sheet picker's label
    only(prog).blurb = `GB ${POISON}`;
    prog.nodes.greet.loc = POISON; // a node's location — a path or a URL
    prog.nodes.greet.name = `N ${POISON}`;
    prog.nodes.greet.role = `R ${POISON}`;
    prog.nodes.greet.channels.success = POISON;
    prog.nodes.greet.channels.requirements = [POISON];
    prog.nodes.greet.steps[0].comment = POISON;
    prog.nodes.greet.steps[3].expr = POISON; // an expression
    prog.nodes.greet.steps[1].aside = POISON; // a step remark
    prog.nodes.greet.steps[6].desc = POISON; // an effect description
    prog.nodes.lookupName.steps[3].message = POISON; // an error message
    runs(prog)[0].blurb = `RB ${POISON}`;
    runs(prog)[0].input[POISON] = 'a run input name is author-keyed too';
    runs(prog)[0].input.user = POISON; // a run input
    prog.layers.tests.nodes.lookupName = { requirements: [POISON] }; // a layer token
    prog.layers[`layer ${POISON}`] = { nodes: {} }; // and a layer name
    // A path with a separator in it, because the files tab splits on the
    // separator and prints each segment: poison the directory and the leaf.
    // The tab's own escape is pinned in tests/groundtrack-fold.test.mjs, which
    // is the only place that can see it; what this pins is the payload, which
    // is the half a page as a string can show.
    prog.files[0].path = `${POISON}/${POISON}`;
    prog.nodes.greet.touches = [`${POISON}/${POISON}`];
    prog.files[0].why = POISON; // and its reason, which trails the leaf
    prog.env.poison = POISON; // an ambient value
  });
  const r = check(file);
  assert.equal(r.code, 0, r.stderr);
  const html = pageOf(file);

  // The script block cannot be closed from inside the embedded file. Only the
  // closing sequence matters: a bare "<script" inside a script block is text,
  // and the escape leaves it alone on purpose.
  //
  // Three closers, not two. The third is the scheme script in <head>, which
  // reads prefers-color-scheme before first paint and carries no author text
  // at all. Raise this number only for another block the page ships itself;
  // a closer that arrives from the flightpath file is the bug this counts.
  assert.equal((html.match(/<\/script>/g) || []).length, 3, 'the page has exactly the three closers it ships');
  assert.match(html, /<\\\/script>/, 'the payload carries the closing tag escaped');

  // Every poisoned string reaches the markup escaped, and the raw tag appears
  // nowhere outside the JSON payload the page parses as data.
  const payloadStart = html.indexOf('const PROG =');
  const payloadEnd = html.indexOf('\n', payloadStart);
  const markup = html.slice(0, payloadStart) + html.slice(payloadEnd);
  assert.doesNotMatch(markup, /<img src=x onerror/);
});

test('the files tab names its groups and says what its marks mean', () => {
  // Only the fixed text is here. The tab itself is written into the cutaway
  // with `innerHTML` when a reader clicks it, so no page carries it as a
  // string — tests/groundtrack-fold.test.mjs holds it, against the same
  // function the tab calls.
  const html = pageOf(layeredFlightpath);
  assert.match(html, /every file in the change/);
  assert.match(html, /new, modified, deleted or forbidden/, 'the tab says what the change kinds are');
});

test('the escape is pinned at its width, both what it does and what it does not', () => {
  // The narrow escape is safe only while the attribute rule holds, so a silent
  // widening hides the fact that the pairing moved. SECURITY.md carries why.
  const html = pageOf(exampleFlightpath);
  assert.match(html, /const esc = s => String\(s \?\? ''\)\.replace\(\/&\/g, '&amp;'\)\.replace\(\/<\/g, '&lt;'\);/);
});

test('no escaped author text reaches an HTML attribute', () => {
  // This is a limit, not a proof, and the security policy says so: proving the
  // whole claim needs a parse of the rendered page, and nothing here parses
  // one. What this test holds is the one shape a reviewer would otherwise have
  // to spot by eye.
  //
  // Every author string on the page goes through `esc`, and `esc` deliberately
  // leaves the double quote alone. So an `esc(...)` inside an attribute value
  // is exactly the construct that breaks the pairing. There is none, and this
  // test is what has to change first if somebody adds one.
  //
  // Both files. The shared module builds the files tab's markup and is where
  // `esc` is defined, so a new attribute interpolation there is the same
  // change to the security policy as one in the template.
  const sources = [
    readFileSync(join(groundtrack, '..', '..', 'assets', 'template.html'), 'utf8'),
    readFileSync(join(groundtrack, '..', 'groundtrack.js'), 'utf8'),
  ];
  for (const src of sources) {
    for (const m of src.matchAll(/="/g)) {
      const end = src.indexOf('"', m.index + 2);
      const value = src.slice(m.index + 2, end === -1 ? src.length : end);
      assert.ok(!value.includes('esc('), `an attribute value interpolates escaped author text: ${value}`);
    }
  }
});

/* -- the argument parser -------------------------------------------------- */

test('a flag missing its value lands at the usage line', () => {
  const r = run(groundtrack, [exampleFlightpath, '--out']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /^usage: node render\.mjs/m);
});

test('a flag followed by another flag lands at the usage line', () => {
  const r = run(groundtrack, [exampleFlightpath, '--out', '--check']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /^usage: node render\.mjs/m);
});

test('a repeated value selects the file the reader named', () => {
  // Each argument is judged at its own index. Looked up by value, a repeated
  // value makes the guard read the wrong neighbour.
  const out = join(work, 'repeat.html');
  const r = run(groundtrack, ['--out', out, exampleFlightpath, out]);
  assert.equal(r.code, 2, 'two positional arguments is a usage error, not a silent pick');
  assert.match(r.stderr, /^usage: node render\.mjs/m);
});

test('no positional file at all lands at the usage line', () => {
  const r = run(groundtrack, ['--check']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /^usage: node render\.mjs/m);
});

test('a default render writes nothing and says so', () => {
  const before = readdirSync(examples).sort();
  const r = run(groundtrack, [exampleFlightpath]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /name the page to write with --out/);
  assert.deepEqual(readdirSync(examples).sort(), before, 'nothing landed beside the input');
  assert.ok(!existsSync(exampleFlightpath.replace(/\.flightpath\.json$/, '.html')));
});

test('valid JSON that is not a flightpath file is refused, not crashed on', () => {
  // `null`, a number and a list all parse. Reading a field off one threw a
  // stack trace where a refusal belongs.
  for (const body of ['null', '42', '[]', '"a string"']) {
    const p = join(work, `notaprogram-${n++}.flightpath.json`);
    writeFileSync(p, body);
    const r = run(groundtrack, [p, '--check']);
    assert.equal(r.code, 1, `${body} should be refused, not accepted`);
    assert.match(r.stderr, /file: expected an object — this is valid JSON and is not a flightpath file/);
    assert.doesNotMatch(r.stderr, /at Object|TypeError|Cannot read/);
  }
});

test('--out naming the input file is refused, and the input survives', () => {
  const p = join(work, 'self.flightpath.json');
  const before = readFileSync(exampleFlightpath, 'utf8');
  writeFileSync(p, before);
  const r = run(groundtrack, [p, '--out', p]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--out names the file being rendered/);
  assert.equal(readFileSync(p, 'utf8'), before, 'the program was not replaced by its own page');
});

test('--out naming a second name for the input file is refused too', t => {
  // Two names can be one file. Comparing the text of the paths does not see a
  // link, so the identity is read off the filesystem as well.
  const src = join(work, 'linked.flightpath.json');
  const alias = join(work, 'alias.html');
  const before = readFileSync(exampleFlightpath, 'utf8');
  writeFileSync(src, before);
  try {
    linkSync(src, alias);
  } catch (e) {
    // A hard link needs the two names on one volume, and some environments
    // refuse it outright. Say which, rather than pass in silence.
    t.skip(`this filesystem would not make a hard link: ${e.code}`);
    return;
  }
  const r = run(groundtrack, [src, '--out', alias]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--out names the file being rendered/);
  assert.equal(readFileSync(src, 'utf8'), before, 'the program was not replaced through its other name');
});

test('a file that is not JSON is refused before anything else', () => {
  const p = join(work, 'broken.flightpath.json');
  writeFileSync(p, '{ not json');
  const r = run(groundtrack, [p, '--check']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /cannot read /);
});

/* -- run through a linked skill directory ---------------------------------- */

// A harness commonly installs a skill as a symbolic link into another skills
// directory and reports the link as the skill's base directory. The renderer
// once ran only when the path node was given matched its own realpath, so
// through a link it did nothing and exited 0 — and a silent --check reads as a
// file with no refusals.
test('the renderer run through a linked skill directory answers as it does through the real one', t => {
  const link = join(work, 'linked-groundtrack');
  try {
    // 'junction' is honoured on Windows, where it needs no admin rights, and
    // ignored elsewhere, where this is an ordinary directory symlink.
    symlinkSync(join(groundtrack, '..', '..'), link, 'junction');
  } catch (e) {
    t.skip(`this filesystem would not make a directory link: ${e.code}`);
    return;
  }
  const linked = join(link, 'scripts', 'render.mjs');
  const refusedFile = derive(prog => {
    for (const node of Object.values(prog.nodes)) delete node.touches;
  });

  // Each real-path run is pinned to a known outcome as well, so two silent
  // runs cannot agree their way to a pass.
  for (const { file, code, stderr } of [
    { file: refusedFile, code: 1, stderr: /touches/ },
    { file: exampleFlightpath, code: 0, stderr: /^ok: / },
  ]) {
    const real = check(file);
    assert.equal(real.code, code, `exit code through the real path, for ${file}`);
    assert.match(real.stderr, stderr, `stderr through the real path, for ${file}`);
    const viaLink = run(linked, [file, '--check']);
    assert.equal(viaLink.code, real.code, `exit code through the link, for ${file}`);
    assert.equal(viaLink.stdout, real.stdout, `stdout through the link, for ${file}`);
    assert.equal(viaLink.stderr, real.stderr, `stderr through the link, for ${file}`);
  }
});

