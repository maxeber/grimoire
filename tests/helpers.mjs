// Shared paths and one process runner for the test files.

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(fileURLToPath(import.meta.url), '..', '..');
export const renderer = join(root, 'skills', 'eagle-eye', 'render.mjs');
export const check = join(root, 'scripts', 'check.mjs');
export const exampleBox = join(root, 'skills', 'eagle-eye', 'examples', 'eagle-eye-skill.box.json');
export const buildPages = join(root, 'scripts', 'build-pages.mjs');
export const groundtrack = join(root, 'skills', 'groundtrack', 'scripts', 'render.mjs');
export const examples = join(root, 'skills', 'groundtrack', 'examples');
// The small worked example: two nodes, three runs, and every move kind the
// shape has. It is the one every derived fixture starts from.
export const exampleFlightpath = join(examples, 'greet.flightpath.json');
// The layer-carrying one, which is the acceptance set for the toggle — and
// the only shipped example with two graphs, so it is also the acceptance set
// for the sheet picker and the shared node map.
export const layeredFlightpath = join(examples, 'pr-313.flightpath.json');

/**
 * Reshape a parsed copy of the small example so an error crosses three frames,
 * and the frame it starts in is one of two call sites of the same node.
 *
 * greet calls loadProfile, and loadProfile calls lookupName twice — by id,
 * then by alias. The error always starts at the second site, so the first one
 * is the row an id-keyed match would wrongly mark. Two runs:
 *
 * - "the alias is missing": lookupName throws NoSuchUser, it propagates through
 *   loadProfile, and greet's call step catches it.
 * - "the store is down": the lookup's effect raises StoreDown, which greet
 *   does not catch, so it reaches the top. The validator refuses an uncaught
 *   tag while an open frame declares a handler for it, which is why this run
 *   raises a different tag from the first.
 *
 * Derived, never shipped: a fixture on disk would be published or would fail
 * the check. Mutates and returns the program it is given.
 */
export function errorPastTwoSites(prog) {
  const lookup = prog.nodes.lookupName;
  lookup.channels.error = ['NoSuchUser', 'StoreDown'];
  prog.nodes = {
    greet: {
      name: 'greet',
      role: 'handler',
      loc: 'src/greet.ts:8',
      params: ['userId'],
      channels: { success: 'a greeting line', error: ['StoreDown'], requirements: ['the name store'] },
      touches: ['src/greet.ts'],
      enteredBy: [],
      steps: [
        {
          op: 'call',
          target: 'loadProfile',
          args: { id: 'userId' },
          bind: 'profile',
          aside: 'the only call that can fail',
          onError: [{ tag: 'NoSuchUser', goto: 'plain' }],
        },
        { op: 'return', expr: '"Hello, " + profile.name' },
        { op: 'return', label: 'plain', expr: '"Hello there"' },
      ],
    },
    loadProfile: {
      name: 'loadProfile',
      role: 'service',
      loc: 'src/profile.ts:4',
      params: ['id'],
      channels: { success: 'a profile', error: ['NoSuchUser', 'StoreDown'], requirements: ['the name store'] },
      touches: ['src/name-store.ts'],
      enteredBy: [],
      steps: [
        { op: 'call', target: 'lookupName', args: { id: 'id' }, bind: 'name', aside: 'by id' },
        { op: 'call', target: 'lookupName', args: { id: 'alias' }, bind: 'alias', aside: 'by alias' },
        { op: 'return', expr: '{ name, alias }' },
      ],
    },
    lookupName: lookup,
  };
  const found = { k: 'effect', at: 0, kind: 'db.get', desc: 'read the name row', next: 1, result: { displayName: 'Ada' } };
  const firstLookup = [
    { k: 'call', at: 0, to: 'loadProfile', next: 1 },
    { k: 'call', at: 0, to: 'lookupName', next: 1 },
    found,
    { k: 'if', at: 1, next: 2 },
    { k: 'return', at: 2, value: 'Ada' },
    { k: 'call', at: 1, to: 'lookupName', next: 2 },
  ];
  const storeDown = { tag: 'StoreDown', message: 'the name store timed out', cause: 'fail' };
  prog.graphs = [
    {
      id: 'greet',
      title: 'greet a user, looked up twice',
      blurb: 'Enters at greet, which loads a profile by two lookups of the same node.',
      entry: 'greet',
      presets: [
        {
          name: 'the alias is missing',
          blurb: 'The second lookup throws, and greet catches it.',
          input: { userId: 'u-404' },
          trace: {
            provenance: 'authored',
            steps: [
              ...firstLookup,
              { k: 'effect', at: 0, kind: 'db.get', desc: 'read the name row', next: 1, result: null },
              { k: 'if', at: 1, next: 3 },
              { k: 'throw', at: 3, tag: 'NoSuchUser', message: 'no row for that id', cause: 'fail' },
              { k: 'propagate' },
              { k: 'propagate' },
              { k: 'catch', at: 0, goto: 'plain', next: 2 },
              { k: 'return', at: 2, value: 'Hello there' },
              { k: 'done', result: 'Hello there' },
            ],
          },
        },
        {
          name: 'the store is down',
          blurb: 'The second lookup raises, and nothing catches it.',
          input: { userId: 'u-1' },
          trace: {
            provenance: 'authored',
            steps: [
              ...firstLookup,
              { k: 'effect', at: 0, kind: 'db.get', desc: 'read the name row', raised: storeDown },
              { k: 'propagate' },
              { k: 'propagate' },
              { k: 'uncaught', ...storeDown },
            ],
          },
        },
      ],
    },
  ];
  return prog;
}

/**
 * Reshape a parsed copy of the small example so one SUBTREE is drawn twice.
 *
 * greet calls loadProfile at two steps, and loadProfile calls lookupName at
 * one. So the tree draws loadProfile twice and lookupName twice under it, and
 * both lookupName rows sit at the same call step of the same node. They are
 * told apart only by which copy of loadProfile they hang under.
 *
 * The one run walks the first copy to a clean return, then enters the second
 * and fails there. Every row signal therefore differs between the two copies:
 * the first has returned, landed its effect and is off the error path; the
 * second is on the stack, failed, and is the frame the walk is in.
 *
 * Derived, never shipped, for the reason `errorPastTwoSites` is. Unlike that
 * one this is read only through the module, never rendered, so its walk is
 * never put to the validator — which is why it may stop on an unresolved raise
 * with no `propagate` and no `uncaught` after it. Render it and that would have to
 * change. Mutates and returns the program it is given.
 */
export function repeatedSubtree(prog) {
  const lookup = prog.nodes.lookupName;
  lookup.channels.error = ['StoreDown'];
  lookup.steps = [
    { op: 'effect', kind: 'db.get', desc: 'read the name row', args: { id: 'id' }, bind: 'row' },
    { op: 'return', expr: 'row.displayName' },
  ];
  prog.nodes = {
    greet: {
      name: 'greet',
      role: 'handler',
      loc: 'src/greet.ts:8',
      params: ['userId'],
      channels: { success: 'a greeting line', error: ['StoreDown'], requirements: ['the name store'] },
      touches: ['src/greet.ts'],
      enteredBy: [],
      steps: [
        { op: 'call', target: 'loadProfile', args: { id: 'userId' }, bind: 'mine', aside: 'first copy' },
        { op: 'call', target: 'loadProfile', args: { id: 'theirs' }, bind: 'theirs', aside: 'second copy' },
        { op: 'return', expr: '{ mine, theirs }' },
      ],
    },
    loadProfile: {
      name: 'loadProfile',
      role: 'service',
      loc: 'src/profile.ts:4',
      params: ['id'],
      channels: { success: 'a profile', error: ['StoreDown'], requirements: ['the name store'] },
      touches: ['src/name-store.ts'],
      enteredBy: [],
      steps: [
        { op: 'call', target: 'lookupName', args: { id: 'id' }, bind: 'name', aside: 'the lookup' },
        { op: 'return', expr: 'name' },
      ],
    },
    lookupName: lookup,
  };
  prog.graphs = [
    {
      id: 'greet',
      title: 'greet a user, loaded twice',
      blurb: 'Enters at greet, which loads two profiles through the same pair of nodes.',
      entry: 'greet',
      presets: [
        {
          name: 'the second copy fails',
          blurb: 'The first load succeeds and returns. The second one fails in the lookup.',
          input: { userId: 'u-1' },
          trace: {
            provenance: 'authored',
            steps: [
              { k: 'call', at: 0, to: 'loadProfile', next: 1 },
              { k: 'call', at: 0, to: 'lookupName', next: 1 },
              { k: 'effect', at: 0, kind: 'db.get', desc: 'read the name row', next: 1, result: { displayName: 'Ada' } },
              { k: 'return', at: 1, value: 'Ada' },
              { k: 'return', at: 1, value: 'Ada' },
              { k: 'call', at: 1, to: 'loadProfile', next: 2 },
              { k: 'call', at: 0, to: 'lookupName', next: 1 },
              {
                k: 'effect', at: 0, kind: 'db.get', desc: 'read the name row',
                raised: { tag: 'StoreDown', message: 'the name store timed out', cause: 'fail' },
              },
            ],
          },
        },
      ],
    },
  ];
  return prog;
}

/**
 * Replace a parsed copy of the small example with one node that calls itself.
 *
 * Nothing of the example's own nodes survives — the shape under test is a
 * cycle, and the example has none. It is still the starting point, because
 * every derived fixture begins from a file that already carries the change,
 * the layers and the sheet.
 *
 * The tree draws a repeated node once more and then stops, so two rows are all
 * it ever draws however deep the walk runs. Both runs go three frames down,
 * below the last row the tree draws, which is the case the repeat row has to
 * speak for: one fails in the deepest frame, and one has the deepest frame
 * succeed at the very step a shallower frame fails at.
 *
 * Derived, never shipped, and read only through the module — so, like
 * `repeatedSubtree`, its walks are never put to the validator. Mutates and
 * returns the program it is given.
 */
export function selfRecursive(prog) {
  prog.nodes = {
    scan: {
      name: 'scan',
      role: 'service',
      loc: 'src/scan.ts:3',
      params: ['dir'],
      channels: { success: 'the rows found', error: ['WriteFailed'], requirements: ['the row store'] },
      touches: ['src/scan.ts'],
      enteredBy: [],
      steps: [
        { op: 'call', target: 'scan', args: { dir: 'child' }, bind: 'rows', aside: 'one level down' },
        { op: 'effect', kind: 'db.put', desc: 'record the row', args: { dir: 'dir' } },
        { op: 'return', expr: 'rows' },
      ],
    },
  };
  prog.graphs = [
    {
      id: 'scan',
      title: 'scan a tree',
      blurb: 'Enters at scan, which calls itself and records a row on the way back up.',
      entry: 'scan',
      presets: [
        {
          name: 'three frames down',
          blurb: 'The walk runs three frames deep and the deepest one fails to record.',
          input: { dir: '/src' },
          trace: {
            provenance: 'authored',
            steps: [
              { k: 'call', at: 0, to: 'scan', next: 1 },
              { k: 'call', at: 0, to: 'scan', next: 1 },
              {
                k: 'effect', at: 1, kind: 'db.put', desc: 'record the row',
                raised: { tag: 'WriteFailed', message: 'the row store refused the write', cause: 'fail' },
              },
            ],
          },
        },
        {
          // Two frames the SAME row speaks for, marking the same step with
          // different outcomes. The deeper one lands and the shallower one
          // fails, so a merge that simply takes the later chain would show the
          // reader a row that recorded cleanly while a frame under it did not.
          name: 'the deeper frame lands and the shallower one fails',
          blurb: 'The third frame records its row and returns. The second one then fails to record.',
          input: { dir: '/src' },
          trace: {
            provenance: 'authored',
            steps: [
              { k: 'call', at: 0, to: 'scan', next: 1 },
              { k: 'call', at: 0, to: 'scan', next: 1 },
              { k: 'effect', at: 1, kind: 'db.put', desc: 'record the row', next: 2, result: { ok: true } },
              { k: 'return', at: 2, value: '[]' },
              {
                k: 'effect', at: 1, kind: 'db.put', desc: 'record the row',
                raised: { tag: 'WriteFailed', message: 'the row store refused the write', cause: 'fail' },
              },
            ],
          },
        },
      ],
    },
  ];
  return prog;
}

/**
 * Replace a parsed copy of the small example with a call graph of the given
 * shape, entered at `entry`.
 *
 * `calls` maps each node to the nodes it calls, in call order. `errors` names
 * the nodes that declare an error channel; the rest declare none. The graph
 * carries one run with no moves, because the drawing reads the graph and not
 * the walk.
 *
 * For the recursive shapes the drawing has to lay out, and which no shipped
 * example holds. Derived, never shipped, and read only through the module.
 * Mutates and returns the program it is given.
 */
export function callGraph(prog, entry, calls, errors = []) {
  prog.nodes = {};
  for (const [id, callees] of Object.entries(calls)) {
    prog.nodes[id] = {
      name: id,
      role: 'service',
      loc: `src/${id}.ts:1`,
      params: [],
      channels: { success: 'a value', error: errors.includes(id) ? ['Failed'] : [], requirements: [] },
      touches: [`src/${id}.ts`],
      enteredBy: [],
      steps: [...callees.map(target => ({ op: 'call', target, args: {} })), { op: 'return', expr: 'value' }],
    };
  }
  prog.graphs = [
    {
      id: entry,
      title: `enter at ${entry}`,
      blurb: `Enters at ${entry}.`,
      entry,
      presets: [{ name: 'no moves', blurb: 'The walk has not started.', input: {}, trace: { provenance: 'authored', steps: [] } }],
    },
  ];
  return prog;
}

// Run a node script and report both streams and the exit code, rather than
// throwing. A test about a gate that fails needs the failure, not an exception.
// Every script under test says the interesting part on stderr and the answer
// on stdout, so a runner that drops either one can only test half of them.
//
// GRIMOIRE_IN_TEST stops the recursion: scripts/check.mjs runs this suite as
// its last step, and this suite runs scripts/check.mjs. Whichever one starts,
// the child sees the variable and does not start the other again.
//
// Pass `env: { GRIMOIRE_IN_TEST: null }` to clear it, which is how a test
// reaches the test step itself. Only do that against a copied tree that has no
// tests/ directory; against this one it recurses.
export function run(script, args = [], opts = {}) {
  const env = { ...process.env, GRIMOIRE_IN_TEST: '1', ...opts.env };
  for (const [k, v] of Object.entries(env)) if (v === null) delete env[k];
  // Node sets NODE_TEST_CONTEXT for anything a test file spawns, and a
  // `node --test` that sees it refuses to run: "run() is being called
  // recursively within a test file. skipping running files." It skips and
  // exits 0, so a suite that should have failed reads as a suite that passed —
  // which is how the test for a failing suite first went green. The scripts
  // spawned here are not test files, so the variable does not belong to them.
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: opts.cwd || root,
    env,
    encoding: 'utf8',
  });
  if (r.error) throw r.error;
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
