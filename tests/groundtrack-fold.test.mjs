// The one module the page and the renderer both run, reached directly.
//
// This is the seam that makes the walk fold testable at all. The repository
// takes no dependency, so there is no headless browser and there never will
// be: the fold has to be reachable from Node with no DOM. The module lives
// apart from the markup that calls it for exactly that reason, and
// render.mjs inlines it into the page so the page and this test run the same
// function.
//
// The files tab is the one piece of markup the module builds itself, because
// the tab is written into the page at click time and no rendered page carries
// it as a string. Its markup is at the end of this file for that reason.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  root, examples, exampleFlightpath, layeredFlightpath,
  errorPastTwoSites, repeatedSubtree, selfRecursive, callGraph,
} from './helpers.mjs';

const require = createRequire(import.meta.url);
const G = require(join(root, 'skills', 'groundtrack', 'scripts', 'groundtrack.js'));

// A file states a change and lists its graphs. Everything below reads one
// graph, so everything below reads a view: the change's node map with one
// graph's entry and runs on it. That is the shape the fold, the tree and the
// page all take, and it is why none of the tests under it had to change when
// the container did.
const view = (path, i = 0) => G.graphView(JSON.parse(readFileSync(path, 'utf8')), i);
const greet = view(exampleFlightpath);
const layered = view(layeredFlightpath);
const runNamed = (prog, name) => prog.presets.find(p => p.name === name);

/* -- the escape ----------------------------------------------------------- */

test('esc turns a tag into text', () => {
  assert.equal(G.esc('<script>alert(1)</script>'), '&lt;script>alert(1)&lt;/script>');
});

test('esc escapes the ampersand before the angle bracket', () => {
  // Order is the whole trick. Escape < first and "&lt;" becomes "&amp;lt;",
  // which the browser renders as the text "&lt;" instead of a bracket.
  assert.equal(G.esc('&lt;script>'), '&amp;lt;script>');
});

test('esc leaves the double quote alone', () => {
  // Not an oversight and not a licence. This is the exact fact that makes "no
  // author text reaches an HTML attribute" load-bearing. Widen this and the
  // pairing has moved, which is a change to the security policy.
  assert.equal(G.esc('a "quoted" location'), 'a "quoted" location');
});

test('esc renders a missing value as the empty string, not "undefined"', () => {
  assert.equal(G.esc(undefined), '');
  assert.equal(G.esc(null), '');
});

/* -- the id pattern ------------------------------------------------------- */

test('the id pattern admits letters, digits and hyphens, and nothing else', () => {
  for (const ok of ['greet', 'bindSheet', 'bind-sheet', 't301', 'A1']) assert.ok(G.ID.test(ok), ok);
  for (const no of ['', '-lead', 'has space', 'quote"', 'brack<et', 'under_score']) {
    assert.ok(!G.ID.test(no), no);
  }
});

/* -- nothing out of the file is safe as a key ----------------------------- */

test('the id pattern is no defence against a prototype member', () => {
  // The pattern is about HTML attributes and says nothing about object keys.
  // Read as a guarantee of key safety — which is the reading that produced
  // this bug — it admits five of them.
  for (const name of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf']) {
    assert.ok(G.ID.test(name), `${name} is a legal id`);
  }
  assert.ok(!G.ID.test('__proto__'), 'only __proto__ fails, and only over the underscore');
});

test('bare tables answer an unset prototype member with undefined', () => {
  const t = G.bare();
  for (const name of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf']) {
    assert.equal(t[name], undefined, name);
  }
  // The property under test, stated as the two reads that actually break:
  // a `|| fallback` that must fire, and an `=== undefined` guard that must.
  assert.deepEqual(t.constructor || ['fallback'], ['fallback']);
  assert.equal(t.toString === undefined, true);
});

test('hardenKeys makes a parsed file answer only for keys the author wrote', () => {
  // JSON.parse builds the node map, not this module, and it builds a plain
  // object. So the map the whole validator asks "is this a node?" answers yes
  // for five names nobody declared.
  const parsed = JSON.parse('{"nodes":{"greet":{}},"env":{"a":1}}');
  assert.equal(typeof parsed.nodes.constructor, 'function', 'the parsed map inherits');

  const hard = G.hardenKeys(parsed);
  for (const name of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf']) {
    assert.equal(hard.nodes[name], undefined, `nodes.${name}`);
    assert.equal(hard.env[name], undefined, `env.${name}`);
  }
  // What the author did write is untouched.
  assert.deepEqual(Object.keys(hard.nodes), ['greet']);
  assert.equal(hard.env.a, 1);
  // And it copies rather than mutates, so a caller's parsed object is its own.
  assert.equal(typeof parsed.nodes.constructor, 'function');
});

test('hardenKeys reaches the layers, a layer\'s nodes, and a run\'s input', () => {
  const parsed = JSON.parse(
    '{"nodes":{"a":{}},"layers":{"tests":{"nodes":{"a":{"requirements":["x"]}}}},"presets":[{"input":{"user":1}}]}',
  );
  const hard = G.hardenKeys(parsed);
  assert.equal(hard.layers.constructor, undefined);
  assert.equal(hard.layers.tests.nodes.constructor, undefined);
  assert.equal(hard.presets[0].input.constructor, undefined);
  // The author's own keys survive at every level.
  assert.deepEqual(hard.layers.tests.nodes.a.requirements, ['x']);
  assert.equal(hard.presets[0].input.user, 1);
});

test('hardenKeys leaves a file that is not an object alone', () => {
  for (const v of [null, 42, 'a string', []]) assert.deepEqual(G.hardenKeys(v), v);
});

test('a label named after a prototype member is not a label until a step carries it', () => {
  // labelsOf feeds the jump check, which asks `L[s.to] === undefined`. On a
  // plain object that is false for a label nobody declared, so the refusal
  // that names the fault never fires.
  const node = { steps: [{ op: 'comment', comment: 'x' }] };
  assert.equal(G.labelsOf(node).constructor, undefined);
  // And a step that does carry it still resolves.
  const labelled = { steps: [{ op: 'comment', comment: 'x', label: 'constructor' }] };
  assert.equal(G.labelsOf(labelled).constructor, 0);
});

test('the drawing places a node named after a prototype member', () => {
  // Two of layout's tables are keyed by node id and read before every id is
  // written. `pos[c]` reports an unplaced node as placed, and `asks[k]`
  // answers with `Object.prototype.constructor` — a function, which is then
  // asked to `push`. The whole drawing throws, so no page renders at all.
  //
  // The shape that reaches it: the node named `constructor` must have a
  // callee in the row being placed, which needs a second caller giving that
  // callee its depth. greet calls both, and constructor calls lookupName.
  const prog = JSON.parse(JSON.stringify(greet));
  prog.nodes.constructor = JSON.parse(JSON.stringify(prog.nodes.lookupName));
  prog.nodes.greet.steps.push({ op: 'call', target: 'constructor', label: 'ctor' });
  prog.nodes.constructor.steps.push({ op: 'call', target: 'lookupName', label: 'back' });

  const out = G.layout(prog);
  assert.ok(out.order.includes('constructor'), 'it is in the draw order');
  for (const id of out.order) {
    assert.ok(Number.isFinite(out.pos[id].x), `${id} has a real x, not NaN`);
    assert.ok(Number.isFinite(out.pos[id].y), `${id} has a real y`);
  }
});

/* -- one change, several graphs ------------------------------------------- */

test('a view carries the change\'s node map with one graph\'s entry and runs', () => {
  // The node map belongs to the change, so a symbol two graphs reach is
  // defined once. What a view swaps is the entry and the runs, which is the
  // whole of what a graph is.
  const prog = JSON.parse(readFileSync(exampleFlightpath, 'utf8'));
  const v = G.graphView(prog, 0);
  assert.equal(v.entry, prog.graphs[0].entry);
  assert.deepEqual(v.presets, prog.graphs[0].presets);
  assert.deepEqual(Object.keys(v.nodes), Object.keys(prog.nodes));
  assert.equal(v.graph.id, prog.graphs[0].id);
});

test('a view with no index is the first graph', () => {
  const prog = JSON.parse(readFileSync(exampleFlightpath, 'utf8'));
  assert.equal(G.graphView(prog).entry, G.graphView(prog, 0).entry);
});

test('what a graph draws is what its entry reaches through call edges', () => {
  assert.deepEqual([...G.reachable(greet, 'greet')].sort(), ['greet', 'lookupName']);
  // Enter at the callee and the caller is not in the drawing: a call edge runs
  // one way.
  assert.deepEqual([...G.reachable(greet, 'lookupName')], ['lookupName']);
});

test('a node two entries reach is in both drawings, and defined once', () => {
  const prog = JSON.parse(readFileSync(layeredFlightpath, 'utf8'));
  const first = G.reachable(prog, 'buildShelf');
  const second = G.reachable(prog, 'bindSheet');
  assert.ok(first.has('bindSheet') && second.has('bindSheet'));
  assert.equal(Object.keys(prog.nodes).filter(id => id === 'bindSheet').length, 1);
});

test('reachability terminates on a cycle', () => {
  const prog = JSON.parse(JSON.stringify(greet));
  prog.nodes.lookupName.steps.push({ op: 'call', target: 'greet', label: 'again' });
  assert.deepEqual([...G.reachable(prog, 'greet')].sort(), ['greet', 'lookupName']);
});

/* -- sheets ---------------------------------------------------------------
 *
 * A sheet is one graph drawn. Three things settle together what is on one:
 * what the drawing places, what the files tab calls the other nodes, and what
 * ink the page gives a node the entry cannot reach. They answer *the nodes the
 * entry reaches, and nothing else*, so the third has nothing left to say.
 */

// A change with two entries and one shared node, derived rather than shipped
// so these hold whatever the examples do.
const twoGraphs = () => {
  const prog = JSON.parse(JSON.stringify(JSON.parse(readFileSync(exampleFlightpath, 'utf8'))));
  prog.nodes.shout = JSON.parse(JSON.stringify(prog.nodes.greet));
  prog.nodes.shout.name = 'shout';
  prog.nodes.shout.touches = ['src/shout.ts'];
  prog.graphs.push({
    id: 'shout',
    title: 'shouting',
    blurb: 'The other entry point, which reaches the shared lookup.',
    entry: 'shout',
    presets: JSON.parse(JSON.stringify(prog.graphs[0].presets)),
  });
  return prog;
};

test('the drawing places the nodes the entry reaches, and no others', () => {
  const prog = twoGraphs();
  const first = G.layout(G.graphView(prog, 0));
  const second = G.layout(G.graphView(prog, 1));
  assert.ok(!first.order.includes('shout'), 'the other entry is not on this sheet');
  assert.ok(!second.order.includes('greet'), 'nor this one on the other');
  // The shared node is on both, and defined once.
  assert.ok(first.order.includes('lookupName') && second.order.includes('lookupName'));
  assert.equal(Object.keys(prog.nodes).filter(id => id === 'lookupName').length, 1);
});

test('the shipped two-graph example shares its node map rather than repeating it', () => {
  // The acceptance set, not a derived fixture. A shared node map that has only
  // ever met a two-node greet has not met a real change.
  const prog = JSON.parse(readFileSync(layeredFlightpath, 'utf8'));
  assert.equal(prog.graphs.length, 2);
  const [first, second] = prog.graphs.map(g => G.reachable(prog, g.entry));
  const shared = [...first].filter(id => second.has(id));
  assert.ok(shared.length >= 2, `the two entries reach ${shared.length} node(s) in common`);
  for (const id of shared) {
    assert.equal(Object.keys(prog.nodes).filter(k => k === id).length, 1, `${id} is defined once`);
  }
  // And each sheet draws its own reach, so neither sheet is the whole change.
  for (const set of [first, second]) assert.ok(set.size < Object.keys(prog.nodes).length);
});

test('a one-graph file draws every node it has, so its drawing is unmoved', () => {
  // The three shipped examples report no unreached node, so narrowing the
  // drawing to the reachable set moves nothing on any of them. Held on the
  // small one because a moved box would be a change nobody asked for.
  assert.deepEqual(G.layout(greet).order.slice().sort(), Object.keys(greet.nodes).sort());
});

test('the other nodes on this sheet are the sheet\'s, not the change\'s', () => {
  const prog = twoGraphs();
  const first = G.filesOf(G.graphView(prog, 0), 'greet');
  // shout is on the other sheet, so the file only it touches is not this
  // sheet's — the group the tab labels "other nodes on this sheet".
  assert.ok(!first.others.includes('src/shout.ts'));
  const second = G.filesOf(G.graphView(prog, 1), 'shout');
  assert.ok(!second.others.includes('src/shout.ts'), 'nor is the open node its own other');
});

test('the tab\'s three groups cover every file the change states', () => {
  // The property that makes them cover, and the reason all three are the
  // sheet's. Narrow the second without the third and a file only the other
  // sheet touches falls out of all three, under no label that says so.
  //
  // Cover, not partition: `lookupName` is given a path `greet` also touches, so
  // the first two groups overlap on the sheet the open node shares it with.
  // Every shipped example does this on nearly every node, so a fixture of
  // distinct paths would test the tab nobody has.
  const prog = twoGraphs();
  prog.nodes.lookupName.touches = ['src/name-store.ts', 'src/greet.ts'];
  prog.files = [
    { path: 'src/greet.ts', change: 'edit', why: 'the first entry', adds: 1, dels: 0 },
    { path: 'src/shout.ts', change: 'edit', why: 'the other entry', adds: 1, dels: 0 },
    { path: 'docs/none.md', change: 'edit', why: 'no node at all', adds: 1, dels: 0 },
  ];
  const stated = prog.files.map(x => x.path);
  for (const [i, id] of [[0, 'greet'], [1, 'shout']]) {
    const f = G.filesOf(G.graphView(prog, i), id);
    const all = [...f.mine, ...f.others, ...f.unaccounted];
    // Restricted to what the change states, because the first two groups read
    // `touches` and a node may touch a path the change does not list — the tab
    // prints one of those as an edit of no stated size rather than not at all.
    const covered = new Set(all.filter(p => stated.includes(p)));
    assert.deepEqual([...covered].sort(), stated.slice().sort(), `sheet ${i} covers them all`);
    // The third group is the disjoint one: it is what no node here touches, so
    // nothing in it can also be in a group read from `touches`.
    assert.deepEqual(f.unaccounted.filter(p => f.mine.includes(p) || f.others.includes(p)), [],
      `sheet ${i}'s third group holds nothing the first two do`);
  }
  // And the overlap the first two are allowed: the open node changes it, the
  // neighbour changes it, and the tab says both rather than picking a winner.
  const first = G.filesOf(G.graphView(prog, 0), 'greet');
  assert.ok(first.mine.includes('src/greet.ts') && first.others.includes('src/greet.ts'));
});

test('the tab asks about this sheet and the check asks about the change', () => {
  // Story 28 wants the tab's third group labelled as this sheet's; story 29
  // wants the check's finding taken across every graph. Two questions, so two
  // answers, and the same function gives both.
  const prog = twoGraphs();
  prog.files = [
    { path: 'src/shout.ts', change: 'edit', why: 'the other entry', adds: 1, dels: 0 },
    { path: 'docs/none.md', change: 'edit', why: 'no node at all', adds: 1, dels: 0 },
  ];
  // The change's answer: the other graph covers shout.ts, so it is accounted.
  assert.deepEqual(G.unaccountedFiles(prog), ['docs/none.md']);
  // The first sheet's answer: no node here touches it, so it is on this list.
  assert.deepEqual(G.filesOf(G.graphView(prog, 0), 'greet').unaccounted, ['src/shout.ts', 'docs/none.md']);
});

test('on a one-graph file the sheet\'s question and the change\'s have one answer', () => {
  // Which is why the three shipped examples read exactly as they did.
  const one = JSON.parse(readFileSync(exampleFlightpath, 'utf8'));
  one.files = [{ path: 'docs/none.md', change: 'edit', why: 'no node at all', adds: 1, dels: 0 }];
  assert.deepEqual(G.filesOf(G.graphView(one, 0), 'greet').unaccounted, G.unaccountedFiles(one));
});

test('the two sheet-scoped readers refuse a file rather than a view', () => {
  // Handed the file, `prog.entry` is undefined and the reachable set is empty.
  // The files tab's second group then renders empty — which is what a tab
  // looks like when a node touches nothing — and the drawing places no box at
  // all. Both read right and both are wrong, so both are loud instead.
  assert.throws(() => G.filesOf(twoGraphs(), 'greet'), /entry/);
  assert.throws(() => G.layout(twoGraphs()), /entry/);
});

test('a sheet\'s state starts on its own graph, and two sheets do not share one', () => {
  const prog = twoGraphs();
  const a = G.sheetState(prog, 0);
  const b = G.sheetState(prog, 1);
  assert.equal(a.open, 'greet');
  assert.equal(b.open, 'shout');
  assert.equal(a.view.graph.id, prog.graphs[0].id);
  assert.equal(b.view.graph.id, prog.graphs[1].id);
  assert.notDeepEqual(a.layout.order, b.layout.order);
  // Every sheet is offered the change's layers, so the toggle does not change
  // under the reader when the sheet does.
  assert.equal(a.layer, b.layer);
  // Moving one leaves the other where it was: that is what returning to a
  // sheet and finding it as you left it is made of.
  a.run = 1; a.at = 4; a.open = 'lookupName'; a.tree = true; a.tab = 'files';
  assert.deepEqual([b.run, b.at, b.open, b.tree, b.tab], [0, 0, 'shout', false, 'source']);
});

test('a sheet\'s state is folded from its own first run', () => {
  const prog = twoGraphs();
  const a = G.sheetState(prog, 0);
  assert.deepEqual(a.states, G.fold(G.graphView(prog, 0), prog.graphs[0].presets[0].trace));
});

/* -- the footer band ------------------------------------------------------ */

test('the band states the change\'s cut once, and the sheet\'s blurb beside it', () => {
  const prog = twoGraphs();
  prog.sheet = { scopeRule: 'one graph per entry point', graphsNotDrawn: ['the cron path'] };
  const out = G.sheetFactsMarkup(G.graphView(prog, 1));
  assert.equal((out.match(/<b>scope rule<\/b>/g) || []).length, 1, 'one scope rule, for the change');
  assert.match(out, /one graph per entry point/);
  assert.match(out, /<b>not drawn<\/b> the cron path/);
  // The sheet's own line is the graph's blurb, which nothing else prints.
  assert.match(out, /<b>this sheet<\/b> The other entry point/);
  assert.ok(out.includes(prog.blurb), 'and the change\'s blurb');
});

test('a sibling sheet is never listed as a graph not drawn', () => {
  // "Not drawn" means found and in no sheet of this file. Both graphs of the
  // shipped example are sheets, so its list is empty rather than naming one.
  const prog = JSON.parse(readFileSync(layeredFlightpath, 'utf8'));
  assert.deepEqual(prog.sheet.graphsNotDrawn, []);
  const out = G.sheetFactsMarkup(G.graphView(prog, 0));
  assert.doesNotMatch(out, /<b>not drawn<\/b>/, 'an empty list draws no line at all');
  for (const g of prog.graphs) assert.ok(!out.includes('not drawn</b> ' + g.title));
});

test('the band puts every author string through the escape', () => {
  const prog = twoGraphs();
  // Mixed case and four different tags, because the assertion below is not
  // about script tags. A test that hunts for one tag by name passes the day an
  // author writes another, or the same one shouting.
  prog.blurb = 'change <script>a</SCRIPT>';
  prog.graphs[1].blurb = 'graph <ScRiPt>b</script>';
  prog.sheet = { scopeRule: 'rule <IMG src=x onerror=1>', graphsNotDrawn: ['left <b onclick=1>'] };
  const out = G.sheetFactsMarkup(G.graphView(prog, 1));
  // Strip the band's own markup — a span and a b, the only tags it writes —
  // and nothing that opens a tag may be left. Whatever the author wrote is
  // text by then, whatever they named it and however they cased it.
  assert.doesNotMatch(out.replace(/<\/?(?:span|b)>/g, ''), /</);
  // And every author bracket arrived as one: two in each blurb, one in each of
  // the other two.
  assert.equal((out.match(/&lt;/g) || []).length, 6);
});

test('the sheet picker is one control per graph, and nothing for one graph', () => {
  assert.equal(G.sheetPickerMarkup(JSON.parse(readFileSync(exampleFlightpath, 'utf8'))), '');
  const out = G.sheetPickerMarkup(twoGraphs());
  assert.equal((out.match(/<option /g) || []).length, 2);
  assert.match(out, /<select id="sheet"/);
});

test('a graph title reaches the picker as text, and its id as a validated attribute', () => {
  const prog = twoGraphs();
  prog.graphs[1].title = '</select><img src=x onerror="alert(1)">';
  const out = G.sheetPickerMarkup(prog);
  assert.doesNotMatch(out, /<img src=x onerror/);
  assert.match(out, /&lt;\/select&gt;|&lt;\/select>/);
  assert.match(out, /data-graph="shout"/);
});

test('a graph id the id pattern refuses reaches no attribute', () => {
  // The validator refuses it first, so this is the second line and not the
  // first. A page rendered from an unchecked file still may not carry it.
  const prog = twoGraphs();
  prog.graphs[1].id = 'a" onload="alert(1)';
  assert.doesNotMatch(G.sheetPickerMarkup(prog), /onload/);
});

/* -- the fold ------------------------------------------------------------- */

test('the fold seeds the entry frame with the cursor at zero, before any move', () => {
  // A walk begins in the entry node with the cursor at zero. No move says so,
  // so the seed state has to.
  const s = G.fold(greet, runNamed(greet, 'a known user').trace);
  assert.deepEqual(s[0].frames.map(f => [f.nodeId, f.pc]), [['greet', 0]]);
  assert.deepEqual(s[0].ledger, []);
  assert.equal(s[0].ended, null);
});

test('one state per cursor position, and one more than there are moves', () => {
  const walk = runNamed(greet, 'a known user').trace;
  assert.equal(G.fold(greet, walk).length, walk.steps.length + 1);
});

test('a call pushes a frame at step zero and parks the caller at its own next', () => {
  const walk = runNamed(greet, 'a known user').trace;
  const s = G.fold(greet, walk);
  const i = walk.steps.findIndex(m => m.k === 'call');
  const after = s[i + 1];
  assert.deepEqual(after.frames.map(f => [f.nodeId, f.pc]), [['greet', 2], ['lookupName', 0]]);
  // The caller's cursor is already past its own guard while the callee runs.
  // That is exactly what the uncaught check has to get right.
  assert.equal(after.frames[0].callAt, 1);
});

test('a return pops the frame and clears the caller from its call', () => {
  const walk = runNamed(greet, 'a known user').trace;
  const s = G.fold(greet, walk);
  const i = walk.steps.findIndex(m => m.k === 'return');
  assert.deepEqual(s[i + 1].frames.map(f => f.nodeId), ['greet']);
  assert.equal(s[i + 1].frames[0].callAt, undefined);
});

test('a propagate pops the frame and keeps the error travelling', () => {
  const walk = runNamed(greet, 'no such user').trace;
  const s = G.fold(greet, walk);
  const i = walk.steps.findIndex(m => m.k === 'propagate');
  assert.deepEqual(s[i + 1].frames.map(f => f.nodeId), ['greet']);
  // The caller is still suspended at the call it made, which is the case the
  // uncaught check exists for.
  assert.equal(s[i + 1].frames[0].callAt, 1);
  assert.ok(s[i + 1].errorPath.some(e => e.how === 'propagated'));
});

test('an effect mark outlives the frame that produced it', () => {
  // The drawing shows one box per node and the tree shows one row per call
  // site. Read off the open frame, a node's marks vanished from the drawing
  // the moment it returned, while the tree kept them — one graph seen two
  // ways, disagreeing. The fold carries both keyings for that reason.
  const walk = runNamed(greet, 'a known user').trace;
  const s = G.fold(greet, walk);
  const end = s[s.length - 1];
  assert.equal(end.frames.length, 0, 'nothing is on the stack at the end');
  assert.equal(end.nodeEffects['lookupName[0]'], 'returned');
  assert.equal(end.nodeEffects['greet[6]'], 'returned');
  // And it is still cumulative-to-the-cursor, not the whole walk at once.
  assert.deepEqual(s[0].nodeEffects, {});
});

test('the ledger grows one row per effect, in order, with what the walk claims', () => {
  const walk = runNamed(greet, 'a known user').trace;
  const s = G.fold(greet, walk);
  const end = s[s.length - 1];
  assert.deepEqual(end.ledger.map(l => [l.nodeId, l.kind, l.outcome]), [
    ['lookupName', 'db.get', 'returned'],
    ['greet', 'http.post', 'returned'],
  ]);
});

test('a failing effect is one move, and it lands in the ledger as threw', () => {
  const walk = runNamed(greet, 'the post fails').trace;
  const s = G.fold(greet, walk);
  const end = s[s.length - 1];
  const failed = end.ledger.filter(l => l.outcome === 'threw');
  assert.equal(failed.length, 1);
  assert.equal(failed[0].raised.tag, 'SendFailed');
  assert.equal(end.ended, 'uncaught');
  assert.deepEqual(end.frames, []);
});

test('a catch moves the cursor and records the catch on the error path', () => {
  const walk = runNamed(greet, 'no such user').trace;
  const s = G.fold(greet, walk);
  const i = walk.steps.findIndex(m => m.k === 'catch');
  assert.ok(s[i + 1].errorPath.some(e => e.how === 'caught'));
  assert.equal(s[i + 1].frames[0].pc, walk.steps[i].next);
});

test('every error-path entry that names a node carries the call site of its frame', () => {
  // An entry names a node, and the tree is one row per call site. By the time
  // the cursor sits on the catch, the frames that threw and propagated are popped,
  // so the site cannot be recovered afterwards: the fold has to write it down
  // while it holds the frame.
  const walk = runNamed(greet, 'no such user').trace;
  const s = G.fold(greet, walk);
  const i = walk.steps.findIndex(m => m.k === 'catch');
  assert.deepEqual(s[i + 1].errorPath.map(e => [e.how, e.nodeId, e.site]), [
    ['thrown', 'lookupName', 'greet#1'],
    ['propagated', 'lookupName', 'greet#1'],
    ['caught', 'greet', '@entry'],
  ]);
});

test('an error that reaches the top propagates the frames still open, then names no node and no site', () => {
  // greet threw in its own frame, and that frame is still open when the
  // error reaches the top. So the frame says both, in path order: it threw,
  // and then the error left it.
  const s = G.fold(greet, runNamed(greet, 'the post fails').trace);
  const path = s[s.length - 1].errorPath;
  assert.deepEqual(path.map(e => [e.how, e.nodeId, e.site]), [
    ['thrown', 'greet', '@entry'],
    ['propagated', 'greet', '@entry'],
    ['reached the top uncaught', null, undefined],
  ]);
});

test('an error that reaches the top with frames open puts every frame it crossed on the path', () => {
  // Three frames deep, the innermost throws, and the walk writes one
  // propagate for three frames crossed. No shipped example reaches this. The
  // fold derives the two the walk left out, innermost first, each with its
  // own frame's call site, and the top comes last.
  const prog = G.graphView(errorPastTwoSites(JSON.parse(readFileSync(exampleFlightpath, 'utf8'))), 0);
  const walk = runNamed(prog, 'the store is down').trace;
  walk.steps.splice(walk.steps.findIndex(m => m.k === 'propagate'), 1);
  assert.equal(walk.steps.filter(m => m.k === 'propagate').length, 1);
  const end = G.fold(prog, walk).slice(-1)[0];
  assert.deepEqual(end.errorPath.map(e => [e.how, e.nodeId, e.site, e.chain && e.chain.join('/')]), [
    ['thrown', 'lookupName', 'loadProfile#1', '@entry/greet#0/loadProfile#1'],
    ['propagated', 'lookupName', 'loadProfile#1', '@entry/greet#0/loadProfile#1'],
    ['propagated', 'loadProfile', 'greet#0', '@entry/greet#0'],
    ['propagated', 'greet', '@entry', '@entry'],
    ['reached the top uncaught', null, undefined, undefined],
  ]);
  assert.deepEqual(end.frames, []);
  // And the tree marks every crossed row, while the row that threw keeps its
  // own word.
  const rows = G.treeRows(prog, walk, null, undefined, G.fold(prog, walk));
  assert.deepEqual(rows.map(r => [r.site ? r.site.aside : null, r.errorPath ? r.errorPath.how : null, r.path]), [
    [null, ['propagated'], 'propagated'],
    ['the only call that can fail', ['propagated'], 'propagated'],
    ['by id', null, null],
    ['by alias', ['thrown'], 'thrown'],
  ]);
});

test('the fold records which edges the walk took, and which nodes it reached', () => {
  const walk = runNamed(layered, 'the sheet 404s').trace;
  const end = G.fold(layered, walk).slice(-1)[0];
  assert.ok(end.edges.includes('buildShelf>bindSheet'));
  assert.ok(end.visited.includes('fibreMapFor'));
  // The terminal move leaves no frame open.
  assert.deepEqual(end.frames, []);
  assert.equal(end.ended, 'done');
});

/* -- stepping backward ---------------------------------------------------- */

test('stepping backward returns the state stepping forward produced, move for move', () => {
  for (const preset of greet.presets) {
    const s = G.fold(greet, preset.trace);
    for (let i = s.length - 1; i > 0; i--) {
      const { state } = G.back(s, i);
      assert.deepEqual(state, s[i - 1], `${preset.name} at move ${i}`);
    }
  }
});

test('stepping back over a call redraws it callee to caller', () => {
  const walk = runNamed(greet, 'a known user').trace;
  const s = G.fold(greet, walk);
  const i = walk.steps.findIndex(m => m.k === 'call') + 1;
  assert.deepEqual(s[i].moved, { from: 'greet', to: 'lookupName', dir: 'call' });
  assert.deepEqual(G.back(s, i).redraw, { from: 'lookupName', to: 'greet', dir: 'uncall' });
});

test('stepping back over a return redraws it caller to callee', () => {
  const walk = runNamed(greet, 'a known user').trace;
  const s = G.fold(greet, walk);
  const i = walk.steps.findIndex(m => m.k === 'return') + 1;
  assert.deepEqual(s[i].moved, { from: 'lookupName', to: 'greet', dir: 'return' });
  assert.deepEqual(G.back(s, i).redraw, { from: 'greet', to: 'lookupName', dir: 'unreturn' });
});

test('a move that walks no edge redraws nothing', () => {
  const walk = runNamed(greet, 'a known user').trace;
  const s = G.fold(greet, walk);
  assert.equal(s[1].moved, null); // the opening note
  assert.equal(G.back(s, 1).redraw, null);
});

/* -- the derived cut ------------------------------------------------------ */

test('the shipped layer-carrying example cuts no edge', () => {
  // A layer renames a token, never a node, and a rename only cuts an edge when
  // the token is in that call's own arguments. It is not, here.
  assert.deepEqual(G.cutEdges(layered), []);
});

test('a renamed token in a call step argument cuts that edge', () => {
  const prog = JSON.parse(JSON.stringify(layered));
  const call = prog.nodes.buildShelf.steps.find(s => s.op === 'call' && s.target === 'bindSheet');
  call.args = { loader: 'THREE.TextureLoader' };
  const cuts = G.cutEdges(prog);
  assert.equal(cuts.length, 1);
  assert.deepEqual(
    { layer: cuts[0].layer, from: cuts[0].from, to: cuts[0].to, token: cuts[0].token },
    { layer: 'tests', from: 'buildShelf', to: 'bindSheet', token: 'THREE.TextureLoader' },
  );
});

test('a token that appears in no call argument cuts nothing', () => {
  const prog = JSON.parse(JSON.stringify(layered));
  prog.layers.tests.nodes.bindSheet.requirements = ['SomethingNobodyPasses -> a double'];
  prog.layers.tests.nodes.applyWoodFibre.requirements = ['AlsoNobody -> a double'];
  assert.deepEqual(G.cutEdges(prog), []);
});

test('both arrow spellings name the same renamed token', () => {
  assert.equal(G.renamedToken('Loader -> fake()'), 'Loader');
  assert.equal(G.renamedToken('Loader → fake()'), 'Loader');
});

/* -- the tree ------------------------------------------------------------- */

test('one row is a call site, so a node called twice appears twice', () => {
  const rows = G.treeRows(layered, runNamed(layered, 'the sheet 404s').trace);
  assert.equal(rows.filter(r => r.id === 'bindSheet').length, 2);
  // And the two carry different end marks, which is what makes the second row
  // worth printing.
  const [first, second] = rows.filter(r => r.id === 'bindSheet');
  assert.notDeepEqual(first.effects.map(e => e.mark), second.effects.map(e => e.mark));
});

test('the tree marks a repeat and stops, so a cycle terminates', () => {
  const prog = JSON.parse(JSON.stringify(greet));
  prog.nodes.lookupName.steps.push({ op: 'call', target: 'greet', label: 'again' });
  const rows = G.treeRows(prog, runNamed(prog, 'a known user').trace);
  assert.ok(rows.some(r => r.repeat));
  assert.ok(rows.length < 10, 'the walk terminated');
});

test('the tree reads its marks at the cursor, not only at the end', () => {
  // Stepping works in tree mode. Only the animation goes.
  const walk = runNamed(greet, 'a known user').trace;
  const states = G.fold(greet, walk);
  const atStart = G.treeRows(greet, walk, null, 0, states);
  const atEnd = G.treeRows(greet, walk, null, undefined, states);
  assert.equal(atStart.find(r => r.id === 'lookupName').state, 'not called');
  assert.equal(atEnd.find(r => r.id === 'lookupName').state, 'returned');
});

/* -- the error path, on the tree -------------------------------------------
 *
 * The tree is one row per call site, and the error path names nodes. A node
 * called from two sites is two rows, and at most one of them is the frame the
 * error passed through. */

const twoSites = G.graphView(errorPastTwoSites(JSON.parse(readFileSync(exampleFlightpath, 'utf8'))), 0);
/** Each row as [node, the site's aside, where it stands on the error path]. */
const errorRows = (prog, name, at) => {
  const walk = runNamed(prog, name).trace;
  return G.treeRows(prog, walk, null, at, G.fold(prog, walk)).map(r => [
    r.id,
    r.site ? r.site.aside : null,
    r.errorPath ? r.errorPath.how : null,
  ]);
};
const cursorAfter = (prog, name, k) => runNamed(prog, name).trace.steps.findIndex(m => m.k === k) + 1;

test('a row on the error path says where it stands: thrown, propagated, or caught', () => {
  const at = cursorAfter(twoSites, 'the alias is missing', 'catch');
  assert.deepEqual(errorRows(twoSites, 'the alias is missing', at), [
    ['greet', null, ['caught']],
    ['loadProfile', 'the only call that can fail', ['propagated']],
    // The same node from the other site took no part, so it carries nothing.
    ['lookupName', 'by id', null],
    ['lookupName', 'by alias', ['thrown']],
  ]);
});

test('the row the error started at says so, and not also that it propagated', () => {
  // The fold records the throwing frame twice: it threw, and then it unwound.
  // Only the first is a position. Read as two, the row that threw would
  // carry the mark every frame the error merely crossed carries too.
  const walk = runNamed(twoSites, 'the alias is missing').trace;
  const at = cursorAfter(twoSites, 'the alias is missing', 'catch');
  const path = G.fold(twoSites, walk)[at].errorPath;
  assert.deepEqual(path.filter(e => e.site === 'loadProfile#1').map(e => e.how), ['thrown', 'propagated']);
  const [, , thrower] = errorRows(twoSites, 'the alias is missing', at).find(([, aside]) => aside === 'by alias');
  assert.deepEqual(thrower, ['thrown']);
});

test('a row that raised and caught its own error says both', () => {
  // An effect whose own step carries the handler. No shipped example has one,
  // and it is the case a single word per row would get wrong.
  const prog = {
    entry: 'a',
    graphs: [],
    nodes: {
      a: {
        name: 'a',
        role: 'io',
        steps: [
          { op: 'effect', kind: 'db.get', desc: 'read', onError: [{ tag: 'Gone', goto: 'out' }] },
          { op: 'return', label: 'out', expr: 'null' },
        ],
      },
    },
  };
  const walk = {
    steps: [
      { k: 'effect', at: 0, kind: 'db.get', desc: 'read', raised: { tag: 'Gone', message: 'no row', cause: 'fail' } },
      { k: 'catch', at: 0, goto: 'out', next: 1 },
    ],
  };
  const rows = G.treeRows(prog, walk);
  assert.deepEqual(rows[0].errorPath.how, ['thrown', 'caught']);
  assert.equal(rows[0].errorPath.tag, 'Gone');
  // One word for the marks that can only be one thing — the stripe down a
  // row's edge, the glyph before its name. Where the frame ended up.
  assert.equal(rows[0].path, 'caught');
});

test('the row carries one word for where its frame ended up, beside the full path', () => {
  // A stripe and a glyph can each say one thing, so `path` is the last
  // position in `error.how` — never the last RAW entry for the site. The fold
  // puts a throwing frame on the path twice, thrown then propagated, and
  // reading the raw entries would strip the mark off the row that threw.
  const at = cursorAfter(twoSites, 'the alias is missing', 'catch');
  const walk = runNamed(twoSites, 'the alias is missing').trace;
  const rows = G.treeRows(twoSites, walk, null, at, G.fold(twoSites, walk));
  assert.deepEqual(
    rows.map(r => [r.site ? r.site.aside : null, r.path]),
    [[null, 'caught'], ['the only call that can fail', 'propagated'], ['by id', null], ['by alias', 'thrown']],
  );
});

test('one open frame is running, and the rest are waiting under it', () => {
  const name = 'the alias is missing';
  const trace = runNamed(twoSites, name).trace;
  const at = trace.steps.findIndex(m => m.k === 'throw');
  const rows = G.treeRows(twoSites, trace, null, at, G.fold(twoSites, trace));
  const open = rows.filter(r => r.state === 'running' || r.state === 'waiting');
  assert.ok(open.length > 1, 'more than one frame is open at the throw');
  assert.equal(rows.filter(r => r.state === 'running').length, 1, 'exactly one frame is running');
  assert.equal(open[open.length - 1].state, 'running', 'and it is the deepest');
  // `top` still marks the running row, for the page's rule weight.
  assert.deepEqual(rows.map(r => r.top), rows.map(r => r.state === 'running'));
});

test('the error path marks nothing before the raise and nothing after the return that ends it', () => {
  const name = 'the alias is missing';
  const walk = runNamed(twoSites, name).trace;
  const marked = at => errorRows(twoSites, name, at).filter(r => r[2]).length;
  const thrownAt = walk.steps.findIndex(m => m.k === 'throw');
  assert.equal(marked(0), 0, 'before the first move');
  assert.equal(marked(thrownAt), 0, 'the cursor on the throw, not yet past it');
  assert.equal(marked(thrownAt + 1), 1, 'past the throw, only the row that threw');
  const caughtAt = cursorAfter(twoSites, name, 'catch');
  assert.equal(marked(caughtAt), 3, 'the catch, and every frame the error crossed');
  const endsAt = walk.steps.map(m => m.k).lastIndexOf('return') + 1;
  assert.equal(marked(endsAt), 0, 'the return after the catch ends the error');
  // Stepping back is an index lookup, so every cursor reads the same forward
  // and back. Held across the whole walk anyway: no mark survives a cursor
  // where the error path is empty.
  const states = G.fold(twoSites, walk);
  for (let i = 0; i < states.length; i++) {
    if (!states[i].errorPath.length) assert.equal(marked(i), 0, `cursor ${i}`);
  }
});

test('an error that reaches the top adds no row, and marks every frame it crossed', () => {
  // The frames still open when it reaches the top are on the path too: the
  // move that reaches the top propagates them. So greet reads propagated. The
  // top itself names no node, so no row carries it and no row is made for it.
  assert.deepEqual(errorRows(twoSites, 'the store is down'), [
    ['greet', null, ['propagated']],
    ['loadProfile', 'the only call that can fail', ['propagated']],
    ['lookupName', 'by id', null],
    ['lookupName', 'by alias', ['thrown']],
  ]);
  // And on the shipped example: the entry raised, and the lookup it called
  // earlier and which returned took no part. The entry is also propagated at
  // the top, and the row that threw keeps its own word.
  assert.deepEqual(errorRows(greet, 'the post fails'), [
    ['greet', null, ['thrown']],
    ['lookupName', 'the only call that can fail', null],
  ]);
});

test('the error path is a second signal, independent of the walk state', () => {
  // A row can be on the stack and on the error path at once: greet is still
  // open when it catches.
  const walk = runNamed(twoSites, 'the alias is missing').trace;
  const at = cursorAfter(twoSites, 'the alias is missing', 'catch');
  const entry = G.treeRows(twoSites, walk, null, at)[0];
  assert.equal(entry.state, 'running');
  assert.deepEqual(entry.errorPath.how, ['caught']);
});

/* -- two copies of one subtree ---------------------------------------------
 *
 * A node called from two steps is two rows, and #79 tested that. This is the
 * case one level down: the node whose CALLER is drawn twice. Everything under
 * a repeated node is drawn twice too, and the two copies sit at the same call
 * step of the same node — so a name made of the caller and the step cannot
 * tell them apart, and every signal that reads it is shared. */

const twoCopies = G.graphView(repeatedSubtree(JSON.parse(readFileSync(exampleFlightpath, 'utf8'))), 0);
/** The two lookupName rows, which are the copies, in tree order. */
const copies = (prog, name, at) => {
  const walk = runNamed(prog, name).trace;
  return G.treeRows(prog, walk, null, at, G.fold(prog, walk)).filter(r => r.id === 'lookupName');
};

test('a copy of a repeated subtree carries only what happened under it', () => {
  const [first, second] = copies(twoCopies, 'the second copy fails');
  assert.equal(second.path, 'thrown', 'the copy the walk failed in says so');
  assert.equal(first.errorPath, null, 'and the copy that returned cleanly says nothing');
});

test('a copy that returned reads returned while the other copy is still in', () => {
  const [first, second] = copies(twoCopies, 'the second copy fails');
  assert.equal(first.state, 'returned');
  assert.equal(second.state, 'running');
});

test('one row is the frame the walk is in, however many copies share its call step', () => {
  const walk = runNamed(twoCopies, 'the second copy fails').trace;
  const rows = G.treeRows(twoCopies, walk, null, undefined, G.fold(twoCopies, walk));
  assert.equal(rows.filter(r => r.top).length, 1, 'exactly one row');
  const [first, second] = rows.filter(r => r.id === 'lookupName');
  assert.equal(second.top, true, 'and it is the copy the walk is in');
  assert.equal(first.top, false);
});

test('an effect mark answers for its own copy', () => {
  const [first, second] = copies(twoCopies, 'the second copy fails');
  assert.deepEqual(first.effects.map(e => e.mark), ['returned'], 'the copy that found its row');
  assert.deepEqual(second.effects.map(e => e.mark), ['threw'], 'the copy the store was down for');
});

/* -- deeper than the tree draws --------------------------------------------
 *
 * The tree draws a repeated node once more and then stops, or a cycle never
 * terminates. So a walk can run below the last row there is. Those frames'
 * marks belong to the row that stopped: it is the row that speaks for what is
 * under it, and the drawing cannot show a cycle at all (#88), so dropping them
 * would lose them from every view at once. */

const recursive = G.graphView(selfRecursive(JSON.parse(readFileSync(exampleFlightpath, 'utf8'))), 0);

test('the tree draws a repeated node once more and stops, however deep the walk runs', () => {
  const walk = runNamed(recursive, 'three frames down').trace;
  const end = G.fold(recursive, walk).pop();
  assert.equal(end.frames.length, 3, 'the walk is three frames down');
  const rows = G.treeRows(recursive, walk, null, undefined, G.fold(recursive, walk));
  assert.deepEqual(rows.map(r => r.repeat), [false, true], 'and the tree draws two rows');
});

test('a failure below the last row drawn is carried by the row that stopped', () => {
  const walk = runNamed(recursive, 'three frames down').trace;
  const rows = G.treeRows(recursive, walk, null, undefined, G.fold(recursive, walk));
  const repeat = rows[rows.length - 1];
  assert.equal(repeat.repeat, true);
  assert.equal(repeat.path, 'thrown', 'the repeat row says the error started under it');
  assert.deepEqual(repeat.effects.map(e => e.mark), ['threw'], 'and carries the mark of the frame that failed');
  assert.equal(repeat.top, true, 'the walk is somewhere inside that subtree');
});

test('no mark the walk made is missing from the tree', () => {
  // The invariant the repeat row exists to keep. Every chain the fold entered
  // is spoken for by exactly one row, so a walk below the drawn rows moves a
  // mark rather than losing it.
  const walk = runNamed(recursive, 'three frames down').trace;
  const end = G.fold(recursive, walk).pop();
  const entered = Object.keys(end.sites).filter(k => end.sites[k].entered);
  assert.equal(entered.length, 3, 'three frames went in');
  const marks = G.treeRows(recursive, walk, null, undefined, G.fold(recursive, walk))
    .flatMap(r => r.effects.map(e => e.mark));
  assert.ok(marks.includes('threw'), 'the deepest frame failed and the tree says so');
});

test('a failure is not hidden by a frame that succeeded at the same step', () => {
  // Two frames one row speaks for, marking the SAME step differently. Merging
  // by insertion order would take the deeper chain, which is the one that
  // returned — and the row would report a clean record beside its own thrown
  // stripe, contradicting itself on one line.
  const walk = runNamed(recursive, 'the deeper frame lands and the shallower one fails').trace;
  const rows = G.treeRows(recursive, walk, null, undefined, G.fold(recursive, walk));
  const repeat = rows[rows.length - 1];
  assert.equal(repeat.path, 'thrown', 'the row says an error started under it');
  assert.deepEqual(repeat.effects.map(e => e.mark), ['threw'], 'so it must not also say the step recorded cleanly');
});

test('a call step sums its copies, because the listing shows a node and not a path', () => {
  // The cutaway lists ONE node's source and marks each call line by what the
  // walk did with it. It has a node and a step index in hand and no path, so
  // it cannot ask the tree's table, which is keyed by the path from the entry.
  // This is the second reading of the same fold, and the two must agree.
  const walk = runNamed(twoCopies, 'the second copy fails').trace;
  const end = G.fold(twoCopies, walk).pop();
  // loadProfile calls lookupName at one step, and the tree draws that step
  // twice. One copy came back; the other is still in.
  assert.deepEqual(G.callCounts(end, 'loadProfile', 0), { entered: 2, returned: 1, open: true });
  // greet's two call steps are two lines of source and answer separately.
  assert.deepEqual(G.callCounts(end, 'greet', 0), { entered: 1, returned: 1, open: false });
  assert.deepEqual(G.callCounts(end, 'greet', 1), { entered: 1, returned: 0, open: true });
  // A step no walk reached carries nothing rather than answering for another.
  assert.deepEqual(G.callCounts(end, 'lookupName', 0), { entered: 0, returned: 0, open: false });
});

/* -- a frame that threw ------------------------------------------------------
 *
 * A frame leaves by returning or by throwing. The walk state names both, and
 * reads which one from the call site's own counts: entered more times than it
 * returned, with no frame open, is a frame that left by throwing. Never from
 * the error path, which holds where an error is NOW — and which is empty once
 * a handler caught the error and the walk ran on past it (#83). */

/** The word each row reads at the cursor, as [node, walk state]. */
const stateRows = (prog, walk, at) =>
  G.treeRows(prog, walk, null, at, G.fold(prog, walk)).map(r => [r.id, r.state]);

test('a frame that left by throwing reads threw, not returned', () => {
  // The shipped example's own case: greet raises SendFailed and nothing
  // catches it. Its row sat beside its own thrown error reading `returned`.
  assert.deepEqual(stateRows(greet, runNamed(greet, 'the post fails').trace), [
    ['greet', 'threw'],
    ['lookupName', 'returned'],
  ]);
});

test('a frame whose error was caught above it still reads threw — the case the error path cannot reach', () => {
  // lookupName throws and greet catches it, then greet runs on and returns.
  // At the end the error path is EMPTY: nothing is travelling. So the word has
  // to come from the counts, and it is scoped to the frame — lookupName threw,
  // whatever caught it; greet caught and returned, so greet returned.
  const walk = runNamed(greet, 'no such user').trace;
  const end = G.fold(greet, walk).pop();
  assert.deepEqual(end.errorPath, [], 'the error path says nothing at the end');
  assert.deepEqual(stateRows(greet, walk), [
    ['greet', 'returned'],
    ['lookupName', 'threw'],
  ]);
});

test('a site entered twice and returned once, with no frame open, reads threw', () => {
  // One call step reached twice by a loop. The first call returns; the second
  // throws, and the caller catches it and returns.
  const prog = {
    entry: 'a',
    graphs: [],
    nodes: {
      a: {
        name: 'a',
        role: 'handler',
        steps: [
          { op: 'call', target: 'b', label: 'again', onError: [{ tag: 'Gone', goto: 'out' }] },
          { op: 'goto', target: 'again' },
          { op: 'return', label: 'out', expr: 'null' },
        ],
      },
      b: { name: 'b', role: 'io', steps: [{ op: 'return', expr: '1' }] },
    },
  };
  const walk = {
    steps: [
      { k: 'call', at: 0, to: 'b', next: 1 },
      { k: 'return', at: 0, value: '1' },
      { k: 'goto', at: 1, next: 0 },
      { k: 'call', at: 0, to: 'b', next: 1 },
      { k: 'throw', at: 0, tag: 'Gone', message: 'no row', cause: 'fail' },
      { k: 'propagate' },
      { k: 'catch', at: 0, goto: 'out', next: 2 },
      { k: 'return', at: 2, value: 'null' },
    ],
  };
  assert.deepEqual(G.callCounts(G.fold(prog, walk).pop(), 'a', 0), { entered: 2, returned: 1, open: false });
  assert.deepEqual(stateRows(prog, walk), [['a', 'returned'], ['b', 'threw']]);
});

test('the other four states are unchanged by threw', () => {
  // Equal counts still read returned; never entered still reads not called;
  // an open frame still reads running or waiting, whatever its counts say.
  const walk = runNamed(greet, 'a known user').trace;
  assert.deepEqual(stateRows(greet, walk), [['greet', 'returned'], ['lookupName', 'returned']]);
  assert.deepEqual(stateRows(greet, walk, 0), [['greet', 'running'], ['lookupName', 'not called']]);
  const inLookup = walk.steps.findIndex(m => m.k === 'call') + 1;
  assert.deepEqual(stateRows(greet, walk, inLookup), [['greet', 'waiting'], ['lookupName', 'running']]);
  const post = runNamed(greet, 'the post fails').trace;
  // The cursor just past the raise: greet threw, but its frame is still open.
  const raisedAt = post.steps.findIndex(m => m.raised) + 1;
  assert.deepEqual(stateRows(greet, post, raisedAt), [['greet', 'running'], ['lookupName', 'returned']]);
});

test('the word is derived once, from the counts, for every view', () => {
  assert.equal(G.walkState({ entered: 0, returned: 0, open: false }, false), 'not called');
  assert.equal(G.walkState({ entered: 1, returned: 0, open: true }, true), 'running');
  assert.equal(G.walkState({ entered: 1, returned: 0, open: true }, false), 'waiting');
  assert.equal(G.walkState({ entered: 2, returned: 2, open: false }, false), 'returned');
  assert.equal(G.walkState({ entered: 2, returned: 1, open: false }, false), 'threw');
  // Open wins over the counts: a site that threw once and is in again is in.
  assert.equal(G.walkState({ entered: 2, returned: 0, open: true }, true), 'running');
});

/** The second copy's failure, carried to the top: every frame it crossed is
 *  closed, so each row's word comes from its counts alone. */
const copiesToTheTop = () => {
  const walk = JSON.parse(JSON.stringify(runNamed(twoCopies, 'the second copy fails').trace));
  walk.steps.push({ k: 'propagate' }, { k: 'propagate' }, { k: 'propagate' }, { k: 'uncaught', tag: 'StoreDown', message: 'the name store timed out', cause: 'fail' });
  return walk;
};

test('a node the tree draws twice takes the word per row, not summed', () => {
  // One copy returned and one threw. Summed, both would read threw.
  const walk = copiesToTheTop();
  assert.deepEqual(stateRows(twoCopies, walk), [
    ['greet', 'threw'],
    ['loadProfile', 'returned'],
    ['lookupName', 'returned'],
    ['loadProfile', 'threw'],
    ['lookupName', 'threw'],
  ]);
});

test('the fold keeps the counts again by node, for the drawing', () => {
  // The drawing is one box per node and has no chain in hand, so it reads the
  // counts summed over every site that entered the node — the nodeEffects
  // pattern, for the same reason.
  const end = G.fold(twoCopies, copiesToTheTop()).pop();
  const counts = id => [end.nodeCalls[id].entered, end.nodeCalls[id].returned];
  assert.deepEqual(counts('greet'), [1, 0]);
  assert.deepEqual(counts('loadProfile'), [2, 1]);
  assert.deepEqual(counts('lookupName'), [2, 1]);
  assert.equal(G.nodeState(end, 'lookupName'), 'threw', 'one box, and a frame of it threw');
  // Keyed without a prototype: a node id is a stranger's string.
  assert.equal(Object.getPrototypeOf(end.nodeCalls), null);
  assert.equal(G.nodeState(end, 'constructor'), 'not called');
});

test('the tree, the drawing and the text agree on the word for every row of every shipped example', () => {
  // A node the tree draws once is one box in the drawing, so the two must say
  // the same thing at every cursor. A node drawn twice is two rows and one
  // box, and the per-row rule above is what governs it.
  for (const file of readdirSync(examples).filter(f => f.endsWith('.flightpath.json'))) {
    const prog = JSON.parse(readFileSync(join(examples, file), 'utf8'));
    prog.graphs.forEach((g, gi) => {
      const v = G.graphView(prog, gi);
      for (const run of g.presets) {
        const states = G.fold(v, run.trace);
        for (let at = 0; at < states.length; at++) {
          const rows = G.treeRows(v, run.trace, null, at, states);
          for (const row of rows) {
            if (rows.filter(r => r.id === row.id).length > 1) continue;
            assert.equal(G.nodeState(states[at], row.id), row.state, `${file} / ${g.id} / ${run.name} / cursor ${at} / ${row.id}`);
          }
        }
      }
    });
  }
});

test('the tree carries the layer rename on the row', () => {
  const rows = G.treeRows(greet, runNamed(greet, 'a known user').trace, 'tests');
  const row = rows.find(r => r.id === 'lookupName');
  assert.ok(row.rename && row.rename.length, 'the row carries the renamed tokens');
});

/* -- the complexity of a node, as drawn ----------------------------------- */

test('cyclomatic complexity is one plus the ifs, the handlers and the loops', () => {
  // greet: one if, one onError handler on its call, and a goto that jumps
  // forward — which is no loop. lookupName: one if and nothing else.
  assert.deepEqual(G.complexityOf(greet.nodes.greet), { value: 3, ifs: 1, handlers: 1, loops: 0 });
  assert.deepEqual(G.complexityOf(greet.nodes.lookupName), { value: 2, ifs: 1, handlers: 0, loops: 0 });
});

test('a jump backward is a loop, and a node with no fork has one path', () => {
  const node = {
    steps: [
      { op: 'comment', comment: 'top', label: 'top' },
      { op: 'if', cond: 'again?', then: 'top', else: 'out' },
      { op: 'return', expr: 'x', label: 'out' },
    ],
  };
  assert.deepEqual(G.complexityOf(node), { value: 3, ifs: 1, handlers: 0, loops: 1 });
  assert.deepEqual(G.complexityOf({ steps: [{ op: 'return', expr: 'x' }] }), { value: 1, ifs: 0, handlers: 0, loops: 0 });
  assert.equal(G.complexityOf({}).value, 1);
});

/* -- the failure kind ----------------------------------------------------- */

test('the kind table reads the throw steps and the raised moves of the whole file', () => {
  // greet's lookupName throws NoSuchUser as a fail. Nothing throws
  // SendFailed anywhere; one trace raises it from an effect, as a fail. Both
  // reach the table, because both are what the file says.
  // Spread to compare, because the table has no prototype on purpose — see
  // the tag named after a property of every object, below.
  assert.deepEqual({ ...G.failureKinds(greet) }, { NoSuchUser: ['fail'], SendFailed: ['fail'] });
});

test('a tag the file gives no kind for is absent from the table, so the row prints bare', () => {
  const prog = JSON.parse(JSON.stringify(greet));
  prog.nodes.greet.channels.error.push('Ghost');
  assert.equal(G.failureKinds(prog).Ghost, undefined);
});

test('a handler is not a source of a kind', () => {
  // An onError entry names the tag it catches and no cause. It says where a
  // failure stops, never what kind of failure it was. Catch a tag that nothing
  // throws and no trace raises, and the handler is the only place it appears.
  const prog = JSON.parse(JSON.stringify(greet));
  const call = prog.nodes.greet.steps.find(s => s.onError);
  call.onError.push({ tag: 'OnlyCaught', goto: 'plain' });
  assert.equal(G.failureKinds(prog).OnlyCaught, undefined);
});

test('a throw move is not a source of a kind — the step it ran is', () => {
  // The move repeats the step's cause, so reading both would be reading one
  // fact twice. Contradict them and the step is what the table says. The
  // validator refuses this file; the module is asked directly, which is what
  // makes the source of the fact visible.
  const prog = JSON.parse(JSON.stringify(greet));
  for (const p of prog.presets) for (const m of p.trace.steps) if (m.k === 'throw') m.cause = 'die';
  assert.deepEqual(G.failureKinds(prog).NoSuchUser, ['fail']);
});

test('a kind supplied only by another graph\'s trace still reaches this sheet', () => {
  // The kind is file-wide, and this is the case that says so. Read per graph,
  // a tag whose only `raised` lives in a trace of a graph you are not looking
  // at loses its kind and prints bare — no error, no failing test, and
  // invisible in every one-graph file that ships. The whole file is one
  // change, so what the change says about a tag holds on every sheet of it.
  const prog = JSON.parse(JSON.stringify(greet));
  const fails = prog.graphs[0].presets.find(p => p.trace.steps.some(m => m.k === 'effect' && m.raised));
  const dies = JSON.parse(JSON.stringify(fails));
  for (const m of dies.trace.steps) if (m.k === 'effect' && m.raised) m.raised.cause = 'die';

  // Move the fatal reading into a second graph, and leave the first with only
  // the fail. Read file-wide the tag has both; read per graph it has one.
  prog.graphs.push({ id: 'second', title: 'a second entry', blurb: 'b', entry: 'lookupName', presets: [dies] });
  assert.deepEqual(G.failureKinds(prog).SendFailed, ['fail', 'die']);

  // And a view of the *first* graph gives the same answer, which is the point:
  // the reader on sheet one is told what the change knows, not what sheet one
  // happens to contain.
  assert.deepEqual(G.failureKinds(G.graphView(prog, 0)).SendFailed, ['fail', 'die']);
});

test('a tag named after a property of every object is still just a tag', () => {
  // A failure tag is author text, and nothing validates it — only a node id is
  // constrained. So the kind table is looked up by a stranger's string, and a
  // plain object answers "constructor" and "toString" with something truthy
  // that is not a list of kinds. A file with such a tag rendered before this
  // table existed, and has to keep rendering.
  const prog = JSON.parse(JSON.stringify(greet));
  prog.nodes.greet.channels.error.push('constructor', 'toString', '__proto__');
  const table = G.failureKinds(prog);
  for (const tag of ['constructor', 'toString', '__proto__']) {
    assert.equal(table[tag], undefined, `${tag} has no kind`);
  }
  const rows = G.treeRows(prog, runNamed(prog, 'a known user').trace);
  const entry = rows.find(r => r.id === 'greet');
  for (const tag of ['constructor', 'toString', '__proto__']) {
    assert.equal(entry.kinds[tag], undefined, `${tag} carries no kind onto the row`);
  }
  // And the tags themselves are still on the row, to be printed bare.
  assert.ok(entry.error.includes('constructor'));
});

test('a tag raised with two kinds keeps both, fail before die', () => {
  // A tag that fails in one place and dies in another is two facts, and
  // flattening them to one would lose the one the reader came for.
  const prog = JSON.parse(JSON.stringify(greet));
  const fails = prog.presets.find(p => p.trace.steps.some(m => m.k === 'effect' && m.raised));
  const dies = JSON.parse(JSON.stringify(fails));
  dies.name = 'the post dies';
  for (const m of dies.trace.steps) if (m.k === 'effect' && m.raised) m.raised.cause = 'die';
  // Written to the graph, which is where the file keeps its traces and where
  // the file-wide table reads them. Die is met first; the order out is still
  // fail, die.
  prog.graphs[0].presets = [dies, fails];
  prog.presets = prog.graphs[0].presets;
  assert.deepEqual(G.failureKinds(prog).SendFailed, ['fail', 'die']);
});

test('the tree row carries the kinds of the tags it prints, and nothing else', () => {
  const rows = G.treeRows(greet, runNamed(greet, 'a known user').trace);
  const entry = rows.find(r => r.id === 'greet');
  const callee = rows.find(r => r.id === 'lookupName');
  assert.deepEqual({ ...entry.kinds }, { NoSuchUser: ['fail'], SendFailed: ['fail'] });
  assert.deepEqual({ ...callee.kinds }, { NoSuchUser: ['fail'] });
  // The error list is still the list of tags it always was.
  assert.deepEqual(callee.error, ['NoSuchUser']);
});

/* -- what a node does with a tag ------------------------------------------ */

test('a node throws a tag, catches it, or lets it pass up from beneath', () => {
  // greet declares a handler for NoSuchUser and throws nothing, so it catches.
  // lookupName throws it. Neither node names SendFailed in a throw or a
  // handler, so on greet it passes up from beneath.
  assert.deepEqual(G.tagFate(greet.nodes.greet, 'NoSuchUser'), { throws: false, catches: true });
  assert.deepEqual(G.tagFate(greet.nodes.lookupName, 'NoSuchUser'), { throws: true, catches: false });
  assert.deepEqual(G.tagFate(greet.nodes.greet, 'SendFailed'), { throws: false, catches: false });
});

test('a node that both throws a tag and catches it says both', () => {
  // No shipped example holds one, and it is the case a two-way answer would
  // get wrong: a node that raises a tag on one path and catches it on another
  // is not "the thrower" and not "the catcher".
  const node = {
    steps: [
      { op: 'call', target: 'x', onError: [{ tag: 'Wobble', goto: 'out' }] },
      { op: 'throw', tag: 'Wobble', message: 'again', cause: 'fail' },
      { op: 'return', expr: 'x', label: 'out' },
    ],
  };
  assert.deepEqual(G.tagFate(node, 'Wobble'), { throws: true, catches: true });
});

/* -- which run the text suggests ------------------------------------------ */

test('the suggested run is the longest walk', () => {
  for (const prog of [greet, layered]) {
    const i = G.suggestRun(prog);
    const longest = Math.max(...prog.presets.map(p => p.trace.steps.length));
    assert.equal(prog.presets[i].trace.steps.length, longest);
  }
});

/* -- the drawing ---------------------------------------------------------- */

test('a node with one caller sits straight beneath it', () => {
  // fibreMapFor is called by applyWoodFibre and nobody else. Centring each row
  // on the sheet put it under the middle of the drawing instead, three boxes
  // away from the only edge that reaches it.
  const l = G.layout(layered);
  assert.equal(l.pos.fibreMapFor.x, l.pos.applyWoodFibre.x);
  // Placing by caller never lets two boxes in a row overlap.
  const byRow = {};
  for (const [id, p] of Object.entries(l.pos)) (byRow[p.y] = byRow[p.y] || []).push(p.x);
  for (const xs of Object.values(byRow)) {
    xs.sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= l.width, 'two boxes in one row overlap');
  }
  // And nothing runs off the right edge of the canvas.
  for (const p of Object.values(l.pos)) assert.ok(p.x + l.width <= l.canvasW);
});

test('the layout places every node of the sheet and draws every call edge once', () => {
  const l = G.layout(layered);
  // Written out rather than derived from `reachable`, which is what `layout`
  // itself calls: a test that asks the implementation what the answer is
  // agrees with it whatever it says. These are the six the first-paint entry
  // reaches; the change's other three are the panel-apply sheet's.
  assert.deepEqual(Object.keys(l.pos).sort(), [
    'applyWoodFibre', 'bindSheet', 'buildShelf', 'fibreMapFor', 'resolveWoodwork', 'worldSpaceUvs',
  ]);
  const pairs = l.edges.map(e => `${e.from}>${e.to}`);
  assert.equal(new Set(pairs).size, pairs.length, 'no edge is drawn twice');
  assert.ok(l.canvasW > 0 && l.canvasH > 0);
});

/* -- the drawing, under recursion ----------------------------------------- */

// No shipped example is recursive, so every graph here is derived from the
// small one. Four shapes: a node that calls itself, a mutual pair, the pair
// beside a plain branch — where the caller's sibling sits on its row — and a
// node that both calls itself and sits in a mutual pair.
const shaped = (entry, calls, errors) =>
  G.graphView(callGraph(JSON.parse(readFileSync(exampleFlightpath, 'utf8')), entry, calls, errors), 0);
const selfCall = () => G.graphView(selfRecursive(JSON.parse(readFileSync(exampleFlightpath, 'utf8'))), 0);
const mutualPair = () => shaped('a', { a: ['b'], b: ['a'] }, ['a']);
const pairBesideBranch = () => shaped('a', { a: ['b', 'c'], b: ['a'], c: ['d'], d: [] }, ['a', 'd']);
const selfAndPair = () => shaped('a', { a: ['b'], b: ['b', 'a'] }, ['a', 'b']);
const edgeOf = (l, from, to) => l.edges.find(e => e.from === from && e.to === to);

test('a node that calls itself is drawn on the first row, centred like any entry', () => {
  const l = G.layout(selfCall());
  assert.equal(l.pos.scan.y, Math.min(...Object.values(l.pos).map(p => p.y)));
  assert.equal(l.pos.scan.x, (l.canvasW - l.width) / 2);
});

test('no shipped drawing moves: an acyclic graph lays out as it did before back edges', () => {
  // Digests of JSON.stringify(layout(view)) for every graph that ships, taken
  // from the module as it stood before #88. None of these graphs is
  // recursive, so the rule for a back edge must not move one box or one wire
  // of them. An edit to an example that moves its drawing changes its digest
  // too — which is a drawing change, and one a reviewer should see.
  const before = {
    'greet.flightpath.json#greet': '5cfa79b14ad3f38c20ce1f12f6b9357fd765e85eb2436bdb9b22e491637d29ae',
    'map-300-woodwork.flightpath.json#ship-the-woodwork': '24929b648f8ba3e4b8c0742f48873384cc40c71db51010612795f5040f73a457',
    'pr-313.flightpath.json#first-paint': '7b65f40072c10f562531f8a921bbf0194236ef4677ed5d751043f9e6b4edc243',
    'pr-313.flightpath.json#panel-apply': 'd20101a80ba2641c4656c6c3e1009d8ed468dd2dfd37ebaf1562c53eac459fb8',
  };
  for (const key of Object.keys(before)) {
    const [file, id] = key.split('#');
    const prog = JSON.parse(readFileSync(join(examples, file), 'utf8'));
    const l = G.layout(G.graphView(prog, prog.graphs.findIndex(g => g.id === id)));
    assert.ok(l.edges.every(e => !e.back), key);
    assert.equal(createHash('sha256').update(JSON.stringify(l)).digest('hex'), before[key], key);
  }
});

test('a mutual pair draws its entry above the node it calls', () => {
  const l = G.layout(mutualPair());
  assert.ok(l.pos.a.y < l.pos.b.y);
});

test('a pair beside a plain branch keeps the entry on top and every forward wire running down', () => {
  // Before back edges were dropped from depth, a climbed below c, which is not
  // in the cycle, and no node was left at depth 0.
  const l = G.layout(pairBesideBranch());
  assert.equal(l.pos.a.y, Math.min(...Object.values(l.pos).map(p => p.y)));
  assert.ok(l.pos.b.y > l.pos.a.y);
  assert.equal(l.pos.c.y, l.pos.b.y);
  assert.ok(l.pos.d.y > l.pos.c.y);
  for (const e of l.edges.filter(e => !e.back)) assert.ok(l.pos[e.to].y > l.pos[e.from].y, `${e.from}>${e.to} runs upward`);
});

/* An orthogonal wire as its points, read off the M and L commands the layout
 * writes. Nothing else appears in a wire's path. */
const points = d => [...d.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map(m => ({ x: +m[1], y: +m[2] }));
const inside = (p, box, w) => p.x > box.x && p.x < box.x + w && p.y > box.y && p.y < box.y + box.h;

/* Whether one straight leg of a wire enters a box's interior. A leg may end
 * on the box's edge — that is how a wire attaches — but never cross into it. */
const legCrosses = (p, q, box, w) => {
  const x0 = Math.min(p.x, q.x), x1 = Math.max(p.x, q.x), y0 = Math.min(p.y, q.y), y1 = Math.max(p.y, q.y);
  return x0 < box.x + w && x1 > box.x && y0 < box.y + box.h && y1 > box.y;
};

test('a self call is a loop out of the left edge, low, and back into it, high', () => {
  const l = G.layout(selfCall());
  const e = edgeOf(l, 'scan', 'scan');
  assert.equal(e.back, true);
  assert.equal(e.self, true);
  const box = l.pos.scan;
  const pts = points(e.call);
  const [first, last] = [pts[0], pts[pts.length - 1]];
  assert.equal(first.x, box.x);
  assert.equal(last.x, box.x);
  assert.ok(first.y > last.y, 'it leaves lower than it comes back');
  for (const y of [first.y, last.y]) assert.ok(y > box.y && y < box.y + box.h);
  for (const p of pts) assert.ok(p.x <= box.x, 'no part of the loop lies inside the box');
});

test('a back edge between two nodes leaves the caller\'s right edge and enters the callee\'s', () => {
  const l = G.layout(mutualPair());
  const e = edgeOf(l, 'b', 'a');
  assert.equal(e.back, true);
  assert.equal(e.self, false);
  const pts = points(e.call);
  const [first, last] = [pts[0], pts[pts.length - 1]];
  assert.equal(first.x, l.pos.b.x + l.width);
  assert.ok(first.y > l.pos.b.y && first.y < l.pos.b.y + l.pos.b.h);
  assert.equal(last.x, l.pos.a.x + l.width);
  assert.ok(last.y > l.pos.a.y && last.y < l.pos.a.y + l.pos.a.h);
  // The arrow points into the box: the last leg runs leftward onto its edge.
  assert.ok(pts[pts.length - 2].x > last.x);
  // The forward half of the pair is an ordinary wire.
  const fwd = edgeOf(l, 'a', 'b');
  assert.deepEqual(Object.keys(fwd).sort(), ['call', 'err', 'from', 'hasE', 'to']);
});

test('a back edge detours round a box beside it, and runs straight where there is none', () => {
  // Nothing sits to the right of either end of the pair, so the wire is three
  // legs: out to the lane, along it, and in. A detour there draws a jog that
  // avoids nothing.
  const pair = G.layout(mutualPair());
  assert.equal(points(edgeOf(pair, 'b', 'a').call).length, 4);
  assert.equal(points(edgeOf(pair, 'b', 'a').err).length, 4);
  // Beside the branch, c sits right of b on b's row, so b's end detours round
  // it through the gap above the row. Nothing sits right of a, so a's end
  // still comes straight in off the lane.
  const branch = G.layout(pairBesideBranch());
  const pts = points(edgeOf(branch, 'b', 'a').call);
  assert.equal(pts.length, 6);
  assert.ok(pts[2].y < branch.pos.b.y, 'the detour runs above the caller\'s row');
});

test('a back edge climbs the nearest clear lane, not the drawing\'s far edge', () => {
  // b calls a back, and c sits right of b on its row. Nothing sits right of a
  // on the row above, so once the wire has gone round the top of c it can
  // climb just past a: the lane runs over c's column, never down past c.
  const l = G.layout(pairBesideBranch());
  const pts = points(edgeOf(l, 'b', 'a').call);
  // The lane is the upright leg that reaches a's height; the stub beside b is
  // an upright leg too, and a short one.
  const lane = pts.find((p, i) => i > 0 && p.x === pts[i - 1].x && p.y < l.pos.a.y + l.pos.a.h);
  assert.ok(lane, 'the wire climbs to a');
  assert.ok(lane.x < l.pos.c.x + l.width, `the lane at ${lane.x} swings out past c`);
});

test('a back edge\'s lane keeps clear of the forward wires it climbs beside', () => {
  // The nearest lane right of a can land in the column where a's call into c
  // comes down, between that call and its error wire. Eight is the least room
  // that still reads as two lines.
  const uprights = d => {
    const pts = points(d);
    return pts.slice(1).map((q, i) => [pts[i], q]).filter(([p, q]) => p.x === q.x)
      .map(([p, q]) => ({ x: p.x, top: Math.min(p.y, q.y), bottom: Math.max(p.y, q.y) }));
  };
  for (const [name, make] of [['pair', mutualPair], ['pair beside a branch', pairBesideBranch], ['self and pair', selfAndPair]]) {
    const l = G.layout(make());
    const fwd = l.edges.filter(e => !e.back).flatMap(e => uprights(e.call).concat(uprights(e.err)));
    for (const e of l.edges.filter(e => e.back && !e.self)) {
      for (const u of uprights(e.call).concat(uprights(e.err))) {
        for (const f of fwd) {
          if (u.top >= f.bottom || u.bottom <= f.top) continue;
          assert.ok(Math.abs(u.x - f.x) >= 8, `${name}: ${e.from}>${e.to} climbs ${Math.abs(u.x - f.x)} from a forward wire`);
        }
      }
    }
  }
});

test('no two back edges draw along the same line', () => {
  // Four siblings each call the entry back. The first three have a box beside
  // them, so they all detour through the one gap above their row — and each
  // needs its own height there, or two wires collapse into one.
  sameLineFree(G.layout(shaped('a', { a: ['b', 'c', 'd', 'e'], b: ['a'], c: ['a'], d: ['a'], e: ['a'] }, ['a'])));
  // Two detours through that gap with two other back edges between them in
  // the graph's order. A height counted over the whole graph gives these two
  // the same one; it has to be counted per gap.
  sameLineFree(G.layout(shaped('a', { a: ['b', 'c', 'e', 'f'], b: ['a'], c: ['x'], x: ['y', 'c'], y: ['c'], e: ['a'], f: [] }, ['a'])));
});

function sameLineFree(l) {
  const legs = [];
  for (const e of l.edges.filter(e => e.back)) {
    for (const d of [e.call, e.err]) {
      const pts = points(d);
      for (let i = 1; i < pts.length; i++) legs.push({ p: pts[i - 1], q: pts[i], who: `${e.from}>${e.to}` });
    }
  }
  const span = (a, b) => [Math.min(a, b), Math.max(a, b)];
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const [s, t] = [legs[i], legs[j]];
      if (s.who === t.who) continue;
      const flat = s.p.y === s.q.y && t.p.y === t.q.y && s.p.y === t.p.y;
      const upright = s.p.x === s.q.x && t.p.x === t.q.x && s.p.x === t.p.x;
      if (!flat && !upright) continue;
      const [a0, a1] = flat ? span(s.p.x, s.q.x) : span(s.p.y, s.q.y);
      const [b0, b1] = flat ? span(t.p.x, t.q.x) : span(t.p.y, t.q.y);
      assert.ok(Math.min(a1, b1) <= Math.max(a0, b0), `${s.who} and ${t.who} share a line`);
    }
  }
}

test('no back-edge wire, or its error wire, crosses a box', () => {
  for (const [name, make] of [['self', selfCall], ['pair', mutualPair], ['pair beside a branch', pairBesideBranch], ['self and pair', selfAndPair]]) {
    const l = G.layout(make());
    const backs = l.edges.filter(e => e.back);
    assert.ok(backs.length > 0, name);
    for (const e of backs) {
      for (const d of [e.call, e.err]) {
        const pts = points(d);
        for (let i = 1; i < pts.length; i++) {
          for (const [id, box] of Object.entries(l.pos)) {
            assert.ok(!legCrosses(pts[i - 1], pts[i], box, l.width), `${name}: ${e.from}>${e.to} crosses ${id}`);
          }
        }
      }
      // And the canvas holds it.
      for (const p of points(e.call).concat(points(e.err))) assert.ok(p.x >= 0 && p.x <= l.canvasW && p.y >= 0 && p.y <= l.canvasH, name);
    }
  }
});

test('a back edge draws an error wire exactly when its callee declares an error channel', () => {
  // a declares one and b does not, so b's call back into a has an error wire
  // to return along and a's call into b has none.
  const l = G.layout(mutualPair());
  assert.equal(edgeOf(l, 'b', 'a').hasE, true);
  assert.equal(edgeOf(l, 'a', 'b').hasE, false);
  const quiet = G.layout(shaped('a', { a: ['b'], b: ['a'] }, []));
  assert.equal(edgeOf(quiet, 'b', 'a').hasE, false);
  // A self call's error wire runs inside its loop, clear of the box.
  const self = edgeOf(G.layout(selfCall()), 'scan', 'scan');
  assert.equal(self.hasE, true);
});

/* a calls b, b calls a back, and both return. */
const pairWalk = () => {
  const prog = mutualPair();
  return {
    prog,
    states: G.fold(prog, {
      steps: [
        { k: 'call', at: 0, to: 'b', next: 1 },
        { k: 'call', at: 0, to: 'a', next: 1 },
        { k: 'return', at: 1 },
        { k: 'return', at: 1 },
      ],
    }),
  };
};

test('a back edge is live only while its caller\'s frame sits directly under its callee\'s', () => {
  const { prog, states } = pairWalk();
  const l = G.layout(prog);
  const [ab, ba] = [edgeOf(l, 'a', 'b'), edgeOf(l, 'b', 'a')];
  // a, b: both on the stack, but no frame of a sits above a frame of b.
  assert.equal(G.wireLive(states[1], ab), true);
  assert.equal(G.wireLive(states[1], ba), false);
  // a, b, a: now one does.
  assert.equal(G.wireLive(states[2], ba), true);
  assert.equal(G.wireLive(states[2], ab), true);
  // a, b again, after the inner a returned.
  assert.equal(G.wireLive(states[3], ba), false);
  assert.equal(G.wireLive(states[4], ab), false);
});

test('a move animates exactly one wire of a mutual pair, in the direction it moved', () => {
  const { prog, states } = pairWalk();
  const l = G.layout(prog);
  const [ab, ba] = [edgeOf(l, 'a', 'b'), edgeOf(l, 'b', 'a')];
  // Forward over the inner a's return: back along b's call into a.
  const ret = states[3].moved;
  assert.deepEqual([G.wireFlow(ret, ba), G.wireFlow(ret, ab)], ['flow-rev', null]);
  // Back over the same move: the same wire, the other way.
  const undo = G.back(states, 3).redraw;
  assert.deepEqual([G.wireFlow(undo, ba), G.wireFlow(undo, ab)], ['flow', null]);
  // The calls, forward and back.
  assert.deepEqual([G.wireFlow(states[1].moved, ab), G.wireFlow(states[1].moved, ba)], ['flow', null]);
  assert.deepEqual([G.wireFlow(G.back(states, 2).redraw, ba), G.wireFlow(G.back(states, 2).redraw, ab)], ['flow-rev', null]);
  assert.equal(G.wireFlow(null, ab), null);
});

test('an error propagating up a wire animates it callee to caller, as a return does', () => {
  const { prog } = pairWalk();
  const l = G.layout(prog);
  const up = { from: 'b', to: 'a', dir: 'propagate' };
  assert.deepEqual([G.wireFlow(up, edgeOf(l, 'a', 'b')), G.wireFlow(up, edgeOf(l, 'b', 'a'))], ['flow-rev', null]);
});

test('a self call\'s one wire animates in the direction of the move', () => {
  const prog = selfCall();
  const l = G.layout(prog);
  const e = edgeOf(l, 'scan', 'scan');
  const states = G.fold(prog, prog.presets[1].trace);
  assert.equal(G.wireFlow(states[1].moved, e), 'flow');
  assert.equal(G.wireFlow(states[4].moved, e), 'flow-rev');
  assert.equal(G.wireFlow(G.back(states, 1).redraw, e), 'flow-rev');
});

test('three frames deep in a self call, the count beside its loop reads ×3, and goes when they return', () => {
  const prog = selfCall();
  const l = G.layout(prog);
  const loop = edgeOf(l, 'scan', 'scan').count;
  const states = G.fold(prog, {
    steps: [
      { k: 'call', at: 0, to: 'scan', next: 1 },
      { k: 'call', at: 0, to: 'scan', next: 1 },
      { k: 'effect', at: 1, kind: 'db.put', desc: 'record the row', next: 2, result: { ok: true } },
      { k: 'return', at: 2 },
      { k: 'effect', at: 1, kind: 'db.put', desc: 'record the row', next: 2, result: { ok: true } },
      { k: 'return', at: 2 },
      { k: 'effect', at: 1, kind: 'db.put', desc: 'record the row', next: 2, result: { ok: true } },
      { k: 'return', at: 2 },
    ],
  });
  assert.equal(G.countMark(l, states[0], 'scan'), null, 'one frame is no recursion');
  assert.deepEqual(G.countMark(l, states[1], 'scan'), { text: '×2', at: { x: loop.x, y: loop.y } });
  assert.deepEqual(G.countMark(l, states[2], 'scan'), { text: '×3', at: { x: loop.x, y: loop.y } });
  assert.deepEqual(G.countMark(l, states[4], 'scan').text, '×2');
  assert.equal(G.countMark(l, states[6], 'scan'), null);
  assert.equal(G.countMark(l, states[8], 'scan'), null, 'no frame at all');
  // The count sits in the loop's own corner, outside the box.
  assert.ok(loop.x < l.pos.scan.x && loop.x > l.pos.scan.x - 26);
});

test('a count too wide for the loop\'s corner moves into the box\'s top row', () => {
  const prog = selfCall();
  const l = G.layout(prog);
  const deep = { frames: Array.from({ length: 1000 }, () => ({ nodeId: 'scan' })) };
  assert.deepEqual(G.countMark(l, deep, 'scan'), { text: '×1000', at: null });
  // A node that does not call itself shows no count, however many frames.
  const pair = pairWalk();
  assert.equal(G.countMark(G.layout(pair.prog), { frames: [{ nodeId: 'a' }, { nodeId: 'b' }, { nodeId: 'a' }] }, 'a'), null);
});

/* -- the files tab -------------------------------------------------------- */

// The tab is built at runtime from `innerHTML`, so the rendered page as a
// string cannot show the tree. The grouping lives here instead, which is the
// same seam the fold uses: a pure function the page calls and this file calls,
// with no DOM between them.

test('the three groups a node sees are read off the change and the node map', () => {
  const f = G.filesOf(layered, 'bindSheet');
  assert.deepEqual(f.mine, ['packages/site/src/shelf/woodwork.ts', 'packages/site/public/wood/sapele-diff-512.jpg']);
  // scene.ts is buildShelf's, and woodwork.ts is several nodes' — a file this
  // node touches is still listed against the others that touch it.
  assert.ok(f.others.includes('packages/site/src/shelf/scene.ts'));
  assert.ok(f.others.includes('packages/site/src/shelf/woodwork.ts'));
  // shelf-settings.ts is the panel-apply sheet's. No node here touches it, so
  // it is not in the second group — and the third group, which is also this
  // sheet's, is where it lands rather than nowhere.
  assert.ok(!f.others.includes('packages/site/src/shelf/shelf-settings.ts'));
  assert.ok(f.unaccounted.includes('packages/site/src/shelf/shelf-settings.ts'));
  assert.equal(f.unaccounted.length, 14);
  assert.ok(!f.unaccounted.includes('packages/site/src/shelf/scene.ts'));
  // The check asks the change, and there the other sheet accounts for it.
  assert.ok(!G.unaccountedFiles(layered).includes('packages/site/src/shelf/shelf-settings.ts'));
});

test('the second group is not empty while other nodes touch files', () => {
  // A tripwire, and the shape of the bug it is set for matters more than the
  // assertion. Once a file lists graphs there is no top-level `entry` — only a
  // view of one graph has one — so a reader that narrows this group by what
  // the entry reaches, handed the raw program, narrows it by `undefined` and
  // gets nothing. The group renders empty, and empty is what a files tab looks
  // like when a node touches nothing, so the page still reads as if it were
  // telling the truth.
  //
  // The failure cannot be provoked here: nothing on this branch narrows the
  // group, and the graphs shape does not exist yet. What can be held is the
  // symptom, which is the same whatever causes it. The two `includes` above
  // would also catch it, but they are asserting something else and would not
  // survive a rewrite of that test with this property intact. They were
  // written the same day as this one, which is the point rather than a
  // mitigation: a test acquires an unnamed load-bearing assertion as soon as
  // it is written, not once it has aged into folklore, and the next person to
  // tidy it drops the property with a green suite.
  for (const [prog, id] of [[layered, 'bindSheet'], [layered, 'fibreMapFor'], [greet, 'greet']]) {
    assert.ok(G.filesOf(prog, id).others.length > 0, id);
  }
});

test('a file that states no changed files leaves nothing unaccounted for', () => {
  const bare = { ...layered };
  delete bare.files;
  assert.deepEqual(G.filesOf(bare, 'bindSheet').unaccounted, []);
});

test('paths group under their directories, in first-appearance order', () => {
  const rows = G.fileTree(G.filesOf(layered, 'bindSheet').unaccounted);
  const dirs = rows.filter(r => !r.path).map(r => r.label);
  assert.deepEqual(dirs, ['gates', 'packages/site/src/shelf', 'docs', 'adr']);
  // Every path put in comes back out exactly once, and nothing else does.
  const files = rows.filter(r => r.path);
  assert.equal(files.length, 14);
  assert.equal(new Set(files.map(r => r.path)).size, 14);
});

test('a directory holding one thing collapses into the line below it', () => {
  const rows = G.fileTree(G.filesOf(layered, 'bindSheet').unaccounted);
  // docs/log holds one file, so it is one row and not a header plus a row.
  const log = rows.filter(r => r.label.startsWith('log/'));
  assert.equal(log.length, 1);
  assert.equal(log[0].path, 'docs/log/2026-08-30-the-species-menu-and-the-read-back.md');
  assert.equal(log[0].label, 'log/2026-08-30-the-species-menu-and-the-read-back.md');
  // And a chain of one-child directories is one header, not four.
  assert.equal(rows.filter(r => r.label === 'packages').length, 0);
});

test('a lone path is one line with no header above it', () => {
  assert.deepEqual(G.fileTree(['src/greet.ts']), [{ depth: 0, label: 'src/greet.ts', path: 'src/greet.ts' }]);
  assert.deepEqual(G.fileTree([]), []);
});

test('a row sits one level under the header that names its directory', () => {
  const rows = G.fileTree(['a/one.ts', 'a/two.ts', 'b/c/three.ts', 'b/d/four.ts']);
  assert.deepEqual(rows, [
    { depth: 0, label: 'a' },
    { depth: 1, label: 'one.ts', path: 'a/one.ts' },
    { depth: 1, label: 'two.ts', path: 'a/two.ts' },
    { depth: 0, label: 'b' },
    { depth: 1, label: 'c/three.ts', path: 'b/c/three.ts' },
    { depth: 1, label: 'd/four.ts', path: 'b/d/four.ts' },
  ]);
});

test('a label joined to its ancestors is the path again, whatever the path holds', () => {
  // The label is what prints. If it did not reconstruct the path, the tab
  // would be showing a reader a path that is not the one in the change.
  for (const p of ['/leading.ts', 'doubled//sep.ts', 'trailing/', 'bare.ts']) {
    const rows = G.fileTree([p]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].label, p);
    assert.equal(rows[0].path, p);
  }
});

/* -- the files tab, as markup --------------------------------------------- */

// This is the only surface the tab has. It is written into the cutaway with
// `innerHTML` at click time, so no rendered page carries it as a string and
// tests/groundtrack-render.test.mjs cannot see it at all. The function is in
// the module for that reason, and these are the tests that reason bought.

const POISON = '<img src=x onerror=alert(1)> & "quoted" </script><script>alert(2)</script>';

test('every author string on a row reaches the tab escaped', () => {
  // A path with a separator in it poisons a directory segment and a leaf, and
  // the `why` poisons the comment that trails the leaf. Drop the `esc` from
  // any of the three and this is what says so.
  const prog = JSON.parse(JSON.stringify(greet));
  prog.files[0].path = `${POISON}/${POISON}`;
  prog.files[0].why = POISON;
  prog.nodes.greet.touches = [`${POISON}/${POISON}`];
  const out = G.filesMarkup(prog, 'greet');
  assert.doesNotMatch(out, /<img src=x onerror/);
  assert.match(out, /&lt;img src=x onerror/);
  // Twice over: the row is in 	his node AND in very file in the change,
  // which now indexes the whole change rather than the remainder. Three
  // escaped strings per row, two rows.
  assert.equal((out.match(/&lt;script>alert\(2\)/g) || []).length, 6, 'the segment, the leaf and the why, on both rows');
});

test('the tab opens and closes one div per level it indents', () => {
  // The depth loop is where broken nesting would live, and broken nesting on
  // an innerHTML assignment silently eats the rest of the tab.
  for (const [prog, id] of [[layered, 'bindSheet'], [layered, 'buildShelf'], [greet, 'greet']]) {
    const out = G.filesMarkup(prog, id);
    assert.equal((out.match(/<div/g) || []).length, (out.match(/<\/div>/g) || []).length, id);
  }
});

test('a file row carries its mark, its leaf, its counts and its why', () => {
  const out = G.filesMarkup(layered, 'buildShelf');
  assert.match(out, /<span class="fchange av-label">new<\/span>/, 'a new file reads new');
  assert.match(out, /<span class="fchange av-label">modified<\/span>/, 'an edited one reads modified');
  assert.match(out, /<span class="fpath">one-sheet\.test\.ts <span class="fwhy">&mdash; G53/);
  assert.match(out, /<span class="fadd">\+194<\/span> <span class="fdel">&minus;0<\/span>/);
  // The collapsed row prints the segments it swallowed, not a bare leaf.
  assert.match(out, /<span class="fpath">log\/2026-08-30-the-species-menu-and-the-read-back\.md /);
  assert.doesNotMatch(out, /<div class="fdir">log\//);
  assert.match(out, /<div class="fdir">gates\/<\/div>/);
  assert.match(out, /every file in the change/);
});

test('a change kind outside the four prints a question mark, not a function', () => {
  // The validator refuses one, and this does not lean on the validator: a
  // bare-object lookup would find Object's own constructor and print it.
  const prog = JSON.parse(JSON.stringify(greet));
  prog.files[0].change = 'constructor';
  const out = G.filesMarkup(prog, 'greet');
  assert.match(out, /<span class="fchange av-label">\?<\/span>/);
  assert.doesNotMatch(out, /function Object/);
});

test('a path that is a prototype member name still reads its own row', () => {
  // The second key into a plain object in this function, and the one with no
  // validator behind it at all: a path is author text. It has to *be* a
  // prototype name, not end in one — `src/constructor` is an ordinary key.
  //
  // With a bare `{}`, a node touching a path the change does not state finds
  // Object's own constructor, which is truthy, so the `|| {}` fallback never
  // fires and the row prints its change, adds and dels as undefined.
  const prog = JSON.parse(JSON.stringify(greet));
  prog.nodes.greet.touches = ['constructor'];
  const out = G.filesMarkup(prog, 'greet');
  assert.match(out, /<span class="fchange av-label">modified<\/span>/, 'the fallback fired');
  assert.match(out, /<span class="fadd">\+0<\/span> <span class="fdel">&minus;0<\/span>/);
  assert.doesNotMatch(out, /undefined/);
  assert.doesNotMatch(out, /function Object/);
});

test('a file that states no changed files says so instead of drawing a tree', () => {
  const prog = JSON.parse(JSON.stringify(greet));
  delete prog.files;
  const out = G.filesMarkup(prog, 'greet');
  assert.match(out, /not stated by this file/);
  assert.doesNotMatch(out, /every file in the change/);
});

/* -- the help note ---------------------------------------------------------
 *
 * Where a note goes is arithmetic on three boxes, so the module does it and
 * the page only reads the answer. The boxes below are the ones measured on
 * the shipped pull-request sheet at 1280 by 820: the run picker at the left,
 * and the error hold in the rail at the right. */

const WIN = { width: 1280, height: 820 };
const NOTE = { width: 320, height: 75 };
const boxAt = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height });

const middle = box => (box.left + box.right) / 2;

test('a help note hangs centred under the thing it describes, its leader on the middle', () => {
  const run = boxAt(316, 76, 561, 30);
  const at = G.tipAt(run, NOTE, WIN);
  assert.equal(at.left + NOTE.width / 2, middle(run), 'centred under it');
  assert.equal(at.top, run.bottom + 9, 'below it, a leader gap away');
  assert.equal(at.left + at.lead, middle(run), 'the leader on its middle');
  assert.equal(at.above, false);
});

test('at the window\'s edge a note is kept inside it, and its leader still lands on the thing', () => {
  // The rail sits at the window's right edge. A note hung from a control's
  // left edge and then clamped inside the window started left of the control
  // and led to nothing the reader was pointing at.
  const error = boxAt(1114, 219, 88, 27);
  const at = G.tipAt(error, NOTE, WIN);
  assert.equal(at.left + NOTE.width, WIN.width - 12, 'kept inside the window');
  assert.equal(at.left + at.lead, middle(error), 'the leader still on the control');
});

test('with no room below, a note goes above', () => {
  const low = boxAt(20, 780, 60, 28);
  const at = G.tipAt(low, NOTE, WIN);
  assert.equal(at.above, true);
  assert.equal(at.top, low.top - NOTE.height - 9);
});

test('a note never runs off the window, and its leader never runs off the note', () => {
  // The widest note the page lets there be: the window less a margin each
  // side. The stylesheet holds it there, and the render tests hold that.
  const widest = { width: WIN.width - 2 * 12, height: 50 };
  const at = G.tipAt(boxAt(5, 10, 10, 10), widest, WIN);
  assert.equal(at.left, 12, 'the window margin on the left');
  assert.ok(at.left + widest.width <= WIN.width - 12, 'and on the right');
  assert.equal(at.lead, 12, 'and the leader keeps the same margin inside the note');
});


