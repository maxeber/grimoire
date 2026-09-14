#!/usr/bin/env node
// groundtrack renderer. Zero dependencies. One flightpath file in, one
// self-contained HTML page out.
//
//   node render.mjs <topic>.flightpath.json
//     --check          validate; refusals on stderr, exit 1; findings on stdout
//     --out <page>     write one self-contained HTML file
//     --text [<run>]   print the tree to stdout
//     --graph <id>     which graph of the change to read
//
// The validator below IS the format. No machine-readable schema file ships,
// because a second artifact that can silently disagree with the first is not
// worth having. references/flightpath-file.md states the same shape in prose,
// and tests/groundtrack-render.test.mjs is what binds the two.
//
// Nothing here evaluates an expression. Every expression field is text the
// page prints.

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const Groundtrack = require(resolve(here, 'groundtrack.js'));

/* -- the shape, exactly as references/flightpath-file.md states it ---------- */

const CORE = ['id', 'title', 'blurb', 'env', 'nodes', 'graphs'];
const OPTIONAL = ['files', 'layers', 'sheet'];
const GRAPH = ['id', 'title', 'blurb', 'entry', 'presets'];
const NODE = ['name', 'role', 'loc', 'params', 'channels', 'steps', 'touches', 'enteredBy'];
const FILE = ['path', 'change', 'why', 'adds', 'dels'];
const PRESET = ['name', 'blurb', 'input', 'walk'];
const CHANGE = ['new', 'edit', 'delete', 'forbidden'];
/* The three kinds a failure can be. Read from the module rather than written
 * again here: the module orders a tag's kinds by this list, and a second copy
 * that drifted would refuse a channel the page then printed. */
const CHANNEL = Groundtrack.KINDS;

const STEP = {
  note: { req: ['note'], opt: [] },
  let: { req: ['name', 'expr'], opt: [] },
  if: { req: ['cond', 'then', 'else'], opt: [] },
  goto: { req: ['to'], opt: [] },
  call: { req: ['target'], opt: ['args', 'bind', 'onError'] },
  effect: { req: ['kind', 'desc'], opt: ['args', 'bind', 'onError'] },
  throw: { req: ['tag', 'message', 'channel'], opt: [] },
  return: { req: ['expr'], opt: [] },
};

/* The move kind is the op that ran. These eight names are the eight ops, and
 * four more move a frame rather than run a step. */
const MOVE = {
  note: { req: ['at', 'next'], opt: [] },
  let: { req: ['at', 'next'], opt: [] },
  if: { req: ['at', 'next'], opt: [] },
  goto: { req: ['at', 'next'], opt: [] },
  call: { req: ['at', 'to', 'next'], opt: [] },
  effect: { req: ['at', 'kind', 'desc'], opt: ['next', 'raised', 'result', 'attempt'] },
  throw: { req: ['at', 'tag', 'message', 'channel'], opt: [] },
  return: { req: ['at'], opt: ['value'] },
  handled: { req: ['at', 'goto', 'next'], opt: [] },
  unwind: { req: [], opt: [] },
  done: { req: [], opt: ['result'] },
  uncaught: { req: ['tag', 'message', 'channel'], opt: [] },
};

/** The moves that name an op. `handled` is not one: it runs no step of its own. */
const OP_MOVES = new Set(['note', 'let', 'if', 'goto', 'call', 'effect', 'throw', 'return']);

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/* Is this the id of a node the author actually wrote?
 *
 * `prog.nodes` comes from JSON.parse, so it carries Object.prototype and
 * answers `constructor`, `toString`, `valueOf`, `hasOwnProperty` and
 * `isPrototypeOf` with an inherited member. Read as `!prog.nodes[id]`, every
 * "is not a node" refusal below silently stops firing for those five names:
 * a graph entering at `constructor`, or a call targeting it, was accepted and
 * then crashed in the walk pass with a stack trace where a refusal belongs.
 *
 * An own-property test is the whole fix, and it belongs at the membership
 * tests rather than at one of them. */
const isNode = (prog, id) => Object.hasOwn(prog.nodes, id);

/* -- refusals -------------------------------------------------------------
 *
 * Every refusal names the file and a path into the document, always. A tool
 * locates the fault from the path without reading the prose.
 *
 * A refusal in a walk names the graph, the run and the move as words after the
 * path, because counting into two arrays to find `graphs[1].presets[0]` is
 * work a person should not have to do. A fault in the file's shape has no run
 * and no move — a top-level unknown key and an empty optional list are both
 * refused before a walk is read — so it prints the path alone rather than
 * naming a run that does not exist.
 */
function refusals(fileLabel) {
  const list = [];
  return {
    list,
    /** A fault in the document's shape: a path into the file, and a reason. */
    shape: (path, why) => list.push(`${fileLabel}: ${path}: ${why}`),
    /** A fault in a walk: the path, then the graph, the run and the move by name. */
    walk: (path, where, why) => list.push(`${fileLabel}: ${path}: ${where}: ${why}`),
  };
}

/** An unknown key is an error. Author-keyed maps never reach here. */
function keys(r, where, obj, req, opt = []) {
  if (!isObj(obj)) return r.shape(where, 'expected an object');
  const named = new Set([...req, ...opt]);
  for (const k of req) if (obj[k] === undefined) r.shape(where, `missing required key "${k}"`);
  for (const k of Object.keys(obj)) if (!named.has(k)) r.shape(where, `unknown key "${k}"`);
}

/* -- pass 1 and 2: shape and links ----------------------------------------- */

function shape(prog, r) {
  /* The top level is read before anything else asks it a question. A file
   * holding `null`, a number or a list parses as JSON and is not a program,
   * and reading `prog.nodes` off it threw a stack trace where a refusal
   * belongs. */
  if (!isObj(prog)) return r.shape('file', 'expected an object — this is valid JSON and is not a flightpath file');
  /* The old one-graph shape, refused by name and refused first. Read through
   * the ordinary key check it produces `unknown key "entry"` and `missing
   * required key "graphs"` — two lines that describe the symptom and leave the
   * author to work the cure out. The fix is one reshape, so this says it and
   * stops rather than cascading. A file states one change and lists its
   * graphs; accepting both shapes would be two ways to say one thing. */
  if (prog.entry !== undefined || prog.presets !== undefined) {
    return r.shape(
      'file',
      'this is the old one-graph shape. A file now states one change and lists its graphs: move "entry" and "presets" into an entry of a "graphs" array, giving that graph its own id, title and blurb. The change facts — id, title, blurb, env, files, layers, sheet — and the one node map stay at the top level.',
    );
  }
  keys(r, 'file', prog, CORE, OPTIONAL);
  /* Said out loud rather than returned from in silence. A `nodes` that is a
   * list or a null used to end this pass with no refusal about it, so the file
   * was accepted and the walk pass then dereferenced a node that was not
   * there. */
  if (prog.nodes !== undefined && !isObj(prog.nodes)) return r.shape('nodes', 'expected an object keyed by node id');
  if (!isObj(prog.nodes)) return;
  if (!Object.keys(prog.nodes).length) r.shape('nodes', 'state at least one node');

  /* An id reaches an HTML attribute on the page, so it is validated rather
   * than escaped. A name carries the real symbol, which is where a reader
   * looks anyway. */
  if (typeof prog.id !== 'string' || !Groundtrack.ID.test(prog.id)) {
    r.shape('id', `"${prog.id}" is not a plain letters-digits-and-hyphens id`);
  }

  if (prog.files !== undefined) {
    if (!Array.isArray(prog.files)) r.shape('files', 'expected an array');
    else if (!prog.files.length)
      r.shape('files', 'state the changed files, or leave the key out. An empty list claims a change that touched nothing, which is a different statement from saying nothing about changed files.');
    else
      prog.files.forEach((f, i) => {
        keys(r, `files[${i}]`, f, FILE);
        if (isObj(f) && !CHANGE.includes(f.change)) r.shape(`files[${i}]`, `change "${f.change}" is not one of ${CHANGE.join(', ')}`);
      });
  }

  /* `sheet` is one of the three optional fields, and the empty-list rule is
   * about those three. An empty graphsNotDrawn is not the same mistake: it
   * says the run found no other graph worth a draw, which is an ordinary thing
   * for a small change to say. */
  if (prog.sheet !== undefined) keys(r, 'sheet', prog.sheet, ['scopeRule', 'graphsNotDrawn']);

  if (prog.layers !== undefined) {
    if (!isObj(prog.layers)) r.shape('layers', 'expected an object');
    else if (!Object.keys(prog.layers).length) r.shape('layers', 'state at least one layer, or leave the key out');
    else
      for (const [ln, layer] of Object.entries(prog.layers)) {
        keys(r, `layers.${ln}`, layer, ['nodes'], ['entry']);
        if (!isObj(layer)) continue;
        if (layer.entry !== undefined && !isNode(prog, layer.entry)) r.shape(`layers.${ln}.entry`, `"${layer.entry}" is not a node`);
        if (isObj(layer.nodes))
          for (const [nid, ov] of Object.entries(layer.nodes)) {
            if (!isNode(prog, nid)) r.shape(`layers.${ln}.nodes.${nid}`, 'is not a node');
            keys(r, `layers.${ln}.nodes.${nid}`, ov, ['R']);
            if (isObj(ov) && Array.isArray(ov.R) && !ov.R.length)
              r.shape(`layers.${ln}.nodes.${nid}.R`, 'state the renamed tokens, or leave the node out of this layer');
          }
      }
  }

  for (const [id, n] of Object.entries(prog.nodes)) {
    if (!Groundtrack.ID.test(id)) r.shape(`nodes.${id}`, 'a node id must be plain letters, digits and hyphens — it reaches the page as an attribute');
    keys(r, `nodes.${id}`, n, NODE);
    if (!isObj(n)) continue;
    if (typeof n.role === 'string' && !n.role.trim()) r.shape(`nodes.${id}.role`, 'is blank — role is an open word, and the page prints it');
    if (n.channels !== undefined) {
      keys(r, `nodes.${id}.channels`, n.channels, ['A', 'E', 'R']);
      if (isObj(n.channels)) {
        if (n.channels.E !== undefined && !Array.isArray(n.channels.E)) r.shape(`nodes.${id}.channels.E`, 'expected an array of failure tags');
        if (n.channels.R !== undefined && !Array.isArray(n.channels.R)) r.shape(`nodes.${id}.channels.R`, 'expected an array of tokens');
        if (n.channels.A !== undefined && typeof n.channels.A !== 'string') r.shape(`nodes.${id}.channels.A`, 'expected a string');
      }
    }
    if (!Array.isArray(n.steps)) {
      r.shape(`nodes.${id}.steps`, 'expected an array');
      continue;
    }

    const L = Groundtrack.labelsOf(n);
    n.steps.forEach((s, i) => {
      const w = `nodes.${id}.steps[${i}]`;
      if (!isObj(s) || !STEP[s.op]) return r.shape(w, `op "${s && s.op}" is not one of ${Object.keys(STEP).join(', ')}`);
      const { req, opt } = STEP[s.op];
      keys(r, `${w} (${s.op})`, s, ['op', ...req], ['label', 'aside', ...opt]);
      for (const k of ['then', 'else', 'to']) {
        if (s[k] !== undefined && L[s[k]] === undefined) r.shape(w, `${k} "${s[k]}" is not a label in ${id}`);
      }
      if (s.op === 'call' && !isNode(prog, s.target)) r.shape(w, `target "${s.target}" is not a node`);
      if (s.op === 'throw' && !CHANNEL.includes(s.channel)) r.shape(w, `channel "${s.channel}" is not one of ${CHANNEL.join(', ')}`);
      if (s.onError !== undefined && !Array.isArray(s.onError)) r.shape(w, 'onError expected an array of { tag, goto }');
      for (const h of Array.isArray(s.onError) ? s.onError : []) {
        keys(r, `${w}.onError`, h, ['tag', 'goto'], ['bind']);
        if (isObj(h) && L[h.goto] === undefined) r.shape(w, `onError goto "${h.goto}" is not a label in ${id}`);
      }
    });
  }

  /* A graph is an entry point and the runs from it. Nothing else: the nodes,
   * the layers and the ambient values belong to the change, so a symbol two
   * graphs reach is defined once and a layer that renames a token renames it
   * on every sheet. */
  if (!Array.isArray(prog.graphs)) return r.shape('graphs', 'expected an array');
  if (!prog.graphs.length) return r.shape('graphs', 'state at least one graph — a graph is an entry point and the runs from it');
  const graphIds = new Set();
  prog.graphs.forEach((g, gi) => {
    keys(r, `graphs[${gi}]`, g, GRAPH);
    if (!isObj(g)) return;

    /* A graph id reaches the page as an attribute, the way a node id does, so
     * it is validated rather than escaped. */
    if (typeof g.id !== 'string' || !Groundtrack.ID.test(g.id)) {
      r.shape(`graphs[${gi}].id`, `"${g.id}" is not a plain letters-digits-and-hyphens id`);
    } else if (graphIds.has(g.id)) {
      r.shape(`graphs[${gi}].id`, `"${g.id}" is already the id of another graph — a graph id names one sheet`);
    } else graphIds.add(g.id);

    if (!isNode(prog, g.entry)) r.shape(`graphs[${gi}].entry`, `"${g.entry}" is not a node`);

    /* Run names are unique per graph, not per file, so two graphs may each
     * have a happy path. */
    if (!Array.isArray(g.presets)) return r.shape(`graphs[${gi}].presets`, 'expected an array');
    if (!g.presets.length) return r.shape(`graphs[${gi}].presets`, 'state at least one run');
    /* The shape document says run names are unique per graph, and until now
     * nothing held it to that. A repeated name is not cosmetic: `--text <run>`
     * resolves by name and takes the first match, so the second run becomes
     * unreachable from the command line while still printing in the list of
     * runs not shown. A file that offers a reader a run they cannot select is
     * refused rather than shipped. Per graph, not per file — two graphs may
     * each have a happy path. */
    const runNames = new Set();
    g.presets.forEach((p, i) => {
      if (isObj(p) && typeof p.name === 'string') {
        if (runNames.has(p.name)) r.shape(`graphs[${gi}].presets[${i}].name`, `"${p.name}" is already the name of a run in graph "${g.id}" — a repeated name cannot be selected by name`);
        else runNames.add(p.name);
      }
    });
    g.presets.forEach((p, i) => {
      keys(r, `graphs[${gi}].presets[${i}]`, p, PRESET);
      if (!isObj(p) || !isObj(p.walk)) return;
      keys(r, `graphs[${gi}].presets[${i}].walk`, p.walk, ['provenance', 'steps']);
      if (!['authored', 'captured'].includes(p.walk.provenance))
        r.shape(`graphs[${gi}].presets[${i}].walk.provenance`, `"${p.walk.provenance}" is not authored or captured`);
      if (!Array.isArray(p.walk.steps)) return r.shape(`graphs[${gi}].presets[${i}].walk.steps`, 'expected an array');
      if (!p.walk.steps.length) r.shape(`graphs[${gi}].presets[${i}].walk.steps`, 'a walk with no moves shows nothing');
      p.walk.steps.forEach((m, j) => {
        const w = `graphs[${gi}].presets[${i}].walk.steps[${j}]`;
        if (!isObj(m) || !MOVE[m.k]) return r.shape(w, `k "${m && m.k}" is not a move kind`);
        keys(r, `${w} (${m.k})`, m, ['k', ...MOVE[m.k].req], MOVE[m.k].opt);
      });
    });
  });
}

/* -- pass 3: is the walk a legal path? -------------------------------------
 *
 * This proves the walk is a legal path through the graph the file declares. It
 * evaluates nothing: which branch an `if` took and what an effect returned are
 * the author's claims, and the skill says so rather than hiding it.
 */
function path(prog, gi, pi, r) {
  const graph = prog.graphs[gi];
  const { walk, name: runName } = graph.presets[pi];
  /* Every node is written before any is read, so this one cannot reach the
   * prototype today. Bare anyway: the property is one loop order away from
   * being untrue, and nothing would say so. */
  const labels = Groundtrack.bare();
  for (const [id, n] of Object.entries(prog.nodes)) labels[id] = Groundtrack.labelsOf(n);
  const frames = [];

  /* Where a refusal points. The path locates the move for a tool; the names
   * spell the same place out for a person. The two refusals that fire once the
   * tape has run out index no move, so they point at the walk itself rather
   * than at a step that is not there. */
  const base = `graphs[${gi}].presets[${pi}]`;
  const where = `graph "${graph.id}", run "${runName}"`;
  const pathAt = i => (i >= walk.steps.length ? `${base}.walk` : `${base}.walk.steps[${i}]`);
  const wordsAt = i => (i >= walk.steps.length ? `${where}, at the end of the walk` : `${where}, move ${i}`);
  const bad = (i, m) => r.walk(pathAt(i), wordsAt(i), m);

  /* A walk begins at its graph's entry with the cursor at zero. No move says so. */
  frames.push({ nodeId: graph.entry, pc: 0 });

  /* The move that emptied the frame stack, not the first move to notice. One
   * measured run went 34 -> 36 -> 36 -> 36 errors and finished blaming the
   * checker, when the whole fault was a spurious unwind one move earlier than
   * the refusal pointed at. */
  let emptiedAt = null;
  let emptiedBy = null;

  /* The travelling error. Three of the four frame moves exist only to carry an
   * error somewhere, and without this a walk could unwind a frame that never
   * threw, catch an error that was never raised, or claim a tag reached the
   * top when nothing produced it. Each of those is a walk that contradicts its
   * own graph, which is the class this pass exists to refuse.
   *
   * Set by a throw and by an effect that raised. Kept through an unwind, which
   * is exactly where the error is still moving. Cleared by the catch, and by
   * reaching the top. */
  let raised = null;
  const noteEmpty = (i, kind) => {
    if (!frames.length) {
      emptiedAt = i;
      emptiedBy = kind;
    }
  };
  const blameEmpty = (i, m) => {
    if (emptiedAt === null) return bad(i, `${m.k} with no frame open`);
    return bad(emptiedAt, `${emptiedBy} emptied the frame stack, and move ${i} (${m.k}) then ran with none open`);
  };

  walk.steps.forEach((m, i) => {
    if (m.k === 'unwind') {
      if (!frames.length) return blameEmpty(i, m);
      if (!raised) bad(i, 'unwind with no error travelling — a frame is popped by a return unless something raised');
      frames.pop();
      noteEmpty(i, 'unwind');
      return;
    }
    if (m.k === 'done') {
      if (frames.length) bad(i, `done arrived with ${frames.length} frame(s) still open`);
      if (raised) bad(i, `done arrived while "${raised.tag}" was still travelling (raised at move ${raised.from}) — an error ends in a catch or at the top, and not by the walk stopping`);
      frames.length = 0;
      return;
    }
    /* A tag cannot be uncaught while a frame it is passing through declares a
     * handler for it. Nothing is evaluated: this reads the call step each open
     * frame is suspended at, which is the step whose onError guards that call.
     * Not the frame's cursor — a call advances the caller to next before
     * pushing, so the cursor sits past the guard. Not any step of the node
     * either — onError is per step, and a handler on some other call is not in
     * this error's way. */
    if (m.k === 'uncaught') {
      if (!raised) bad(i, `"${m.tag}" reached the top uncaught, and no move before it raised anything`);
      else if (raised.tag !== m.tag) bad(i, `"${m.tag}" reached the top, but the error travelling is "${raised.tag}"`);
      raised = null;
      for (const fr of frames) {
        if (fr.callAt === undefined) continue;
        const guard = ((prog.nodes[fr.nodeId] || {}).steps || [])[fr.callAt];
        for (const h of (guard && guard.onError) || []) {
          if (h.tag === m.tag) bad(i, `"${m.tag}" is uncaught, but ${fr.nodeId}[${fr.callAt}] declares onError for it`);
        }
      }
      frames.length = 0;
      return;
    }

    const f = frames[frames.length - 1];
    if (!f) return blameEmpty(i, m);

    /* While an error is travelling, only the moves that carry it may run. A
     * return here would discard the error without a catch and without it
     * reaching the top, and a step-running move would mean the frame the error
     * is leaving carried on regardless. Both are walks that contradict their
     * own graph. The three moves that carry an error — unwind, handled and
     * uncaught — never reach this line or are excepted below. */
    if (raised && m.k !== 'handled') {
      bad(i, `${m.k} ran while "${raised.tag}" was still travelling (raised at move ${raised.from}) — an error is caught, or it reaches the top`);
    }
    const node = prog.nodes[f.nodeId];
    const L = labels[f.nodeId];
    if (typeof m.at !== 'number' || !node.steps[m.at]) return bad(i, `${m.k} at ${m.at} is not a step of ${f.nodeId}`);
    const st = node.steps[m.at];

    /* `at` is always the step that ran, so it is always the cursor. A handled
     * catch is the one move that arrives after an unwind, so its `at` names
     * the step in this frame whose onError caught, not the cursor. */
    if (m.k !== 'handled' && m.at !== f.pc) bad(i, `${m.k} ran step ${m.at}, but the cursor sits at ${f.pc}`);

    /* `next` is always where the cursor goes, and it is never worked out. */
    if (m.next !== undefined && !node.steps[m.next]) bad(i, `next ${m.next} is not a step of ${f.nodeId}`);

    /* The move's name is the step's op, enforced in one place. */
    if (OP_MOVES.has(m.k) && st.op !== m.k) bad(i, `a "${m.k}" move ran step ${m.at}, which is a "${st.op}"`);

    switch (m.k) {
      case 'note':
      case 'let':
      case 'if':
      case 'goto': {
        let ok = false;
        if (st.op === 'if') ok = m.next === L[st.then] || m.next === L[st.else];
        else if (st.op === 'goto') ok = m.next === L[st.to];
        else ok = m.next === m.at + 1;
        if (!ok) bad(i, `no edge from ${m.at} (${st.op}) to ${m.next}`);
        f.pc = m.next;
        break;
      }
      case 'call':
        if (st.op === 'call' && m.to !== st.target) bad(i, `call to "${m.to}", but step ${m.at} targets "${st.target}"`);
        f.pc = m.next;
        f.callAt = m.at;
        if (isNode(prog, m.to)) frames.push({ nodeId: m.to, pc: 0 });
        else bad(i, `call to unknown node "${m.to}"`);
        break;
      case 'effect':
        if (st.op === 'effect' && m.kind !== st.kind) bad(i, `effect kind "${m.kind}" does not match step kind "${st.kind}"`);
        if (m.next !== undefined && m.raised !== undefined) bad(i, 'an effect carries next or raised, never both');
        else if (m.next !== undefined) f.pc = m.next;
        else if (m.raised === undefined) bad(i, 'an effect carries next when it went on, or raised when it threw');
        else {
          /* Found while walking, so it names the graph, the run and the move
           * like every other walk refusal. `keys` reports through `shape`, so
           * it is handed a reporter that routes to the walk form instead —
           * otherwise this one fault, alone among the walk's, would print a
           * path and go quiet about which run it is in. */
          keys({ shape: (p, why) => r.walk(p, wordsAt(i), why) }, `${pathAt(i)}.raised`, m.raised, ['tag', 'message', 'channel']);
          if (isObj(m.raised) && !CHANNEL.includes(m.raised.channel))
            bad(i, `raised channel "${m.raised.channel}" is not one of ${CHANNEL.join(', ')}`);
          if (isObj(m.raised)) raised = { tag: m.raised.tag, from: i };
        }
        break;
      case 'throw':
        if (st.op === 'throw' && m.tag !== st.tag) bad(i, `throw tag "${m.tag}" does not match step tag "${st.tag}"`);
        raised = { tag: m.tag, from: i };
        break;
      case 'handled': {
        const declared = (st.onError || []).filter(h => h.goto === m.goto);
        if (!declared.length) bad(i, `handled at ${m.at} (${st.op}): its onError does not name "${m.goto}"`);
        if (!raised) bad(i, `handled at ${m.at} catches nothing — no move before it raised`);
        else if (declared.length && !declared.some(h => h.tag === raised.tag))
          bad(i, `handled at ${m.at} goes to "${m.goto}", which ${f.nodeId} declares for ${declared.map(h => `"${h.tag}"`).join(', ')}, and the error travelling is "${raised.tag}" (raised at move ${raised.from})`);
        if (L[m.goto] === undefined) bad(i, `handled goto "${m.goto}" is not a label in ${f.nodeId}`);
        else if (m.next !== L[m.goto]) bad(i, `handled lands at ${m.next}, but "${m.goto}" is step ${L[m.goto]}`);
        raised = null;
        f.pc = m.next;
        /* The frame resumed, so the call it was suspended at no longer guards
         * anything. The return path clears this for the same reason. */
        f.callAt = undefined;
        break;
      }
      case 'return':
        frames.pop();
        noteEmpty(i, 'return');
        /* The caller resumed, so its call's onError is no longer in any
         * error's way. An unwind does not clear this: there the error is still
         * travelling through the frame. */
        if (frames.length) frames[frames.length - 1].callAt = undefined;
        break;
      default:
        break;
    }
  });

  if (frames.length) bad(walk.steps.length, `the walk ended with ${frames.length} frame(s) still open`);
  /* The last door in the same rule. A walk whose final move unwinds the last
   * frame leaves no frame open, so the line above is content — and the error
   * is still travelling with nowhere left to go. An error is caught, or it
   * reaches the top. */
  if (raised) bad(walk.steps.length, `the walk ended while "${raised.tag}" was still travelling (raised at move ${raised.from}) — write the catch, or the uncaught that ends it`);
}

export function check(prog, fileLabel) {
  const r = refusals(fileLabel);
  shape(prog, r);
  if (r.list.length) return r.list; /* links are unreliable once the shape is wrong */
  /* Each walk is validated against the graph it belongs to, entering at that
   * graph's entry. Every rule below that is unchanged. */
  prog.graphs.forEach((g, gi) => g.presets.forEach((_, pi) => path(prog, gi, pi, r)));
  return r.list;
}

/* -- findings -------------------------------------------------------------
 *
 * A finding is not a refusal. Each one is computed from the file alone with no
 * run, each one is a thing a reader may have meant, and none of them makes the
 * file illegal. The two the spec left unplaced are here rather than in the
 * validator for that reason: neither is a graph-versus-walk contradiction, and
 * refusing a file for one would refuse a file that says exactly what its
 * author meant.
 */
export function findings(prog) {
  const out = [];

  /* One file edited by several nodes. Legal, and worth seeing: it is the shape
   * a change takes when one file carries two concerns. */
  /* Keyed by a changed file's path, which nothing validates. */
  const editors = Groundtrack.bare();
  for (const [id, n] of Object.entries(prog.nodes)) {
    for (const p of n.touches || []) (editors[p] = editors[p] || []).push(id);
  }
  for (const [p, ids] of Object.entries(editors)) {
    if (ids.length > 1) out.push(`several nodes edit ${p}: ${ids.join(', ')}`);
  }

  /* A node no graph's entry reaches. It is drawn by no sheet, so it is worth
   * seeing — but it is legal, because a node the author has written and not
   * yet connected is a work in progress and not a contradiction. */
  const reached = new Set();
  for (const g of prog.graphs) for (const id of Groundtrack.reachable(prog, g.entry)) reached.add(id);
  for (const id of Object.keys(prog.nodes)) {
    if (!reached.has(id)) out.push(`no graph's entry reaches ${id}, so no sheet draws it`);
  }

  /* An E channel declaring a tag nothing beneath it can produce.
   *
   * A node produces a tag three ways: it throws it, a step of it declares a
   * handler for it, or one of its effects raised it in a walk this file
   * carries. The third source is why this reads the walks. A step gives an
   * effect no failure set — the shape has no field for one, on purpose — so a
   * rule that read the steps alone would report every effect that can fail,
   * which is most of them, and the finding would mean nothing.
   */
  /* Keyed by a node id, and an id is no safer here than any other author
   * string — the pattern that guards it is about attributes. */
  const raisedInWalks = Groundtrack.bare();
  prog.graphs.forEach((g, gi) => {
    const view = Groundtrack.graphView(prog, gi);
    for (const p of g.presets) {
      const states = Groundtrack.fold(view, p.walk);
      for (const l of states[states.length - 1].ledger) {
        if (l.raised) (raisedInWalks[l.nodeId] = raisedInWalks[l.nodeId] || new Set()).add(l.raised.tag);
      }
    }
  });

  const tagsOf = (id, seen = new Set()) => {
    if (seen.has(id)) return new Set();
    seen.add(id);
    const set = new Set(raisedInWalks[id] || []);
    for (const s of prog.nodes[id].steps || []) {
      if (s.op === 'throw') set.add(s.tag);
      for (const h of s.onError || []) set.add(h.tag);
      if (s.op === 'call' && isNode(prog, s.target)) for (const t of tagsOf(s.target, seen)) set.add(t);
    }
    return set;
  };
  for (const [id, n] of Object.entries(prog.nodes)) {
    const can = tagsOf(id);
    for (const tag of (n.channels || {}).E || []) {
      if (!can.has(tag)) out.push(`${id} declares E tag "${tag}", and nothing beneath it produces that tag`);
    }
  }

  /* Files in the change that no node accounts for, by name. A
   * documentation-only or config-only part of a change is not silently
   * dropped. */
  for (const p of Groundtrack.unaccountedFiles(prog)) out.push(`no node accounts for ${p}`);

  /* A cut edge is derived, never declared. */
  for (const c of Groundtrack.cutEdges(prog)) {
    out.push(`layer "${c.layer}" cuts ${c.from}[${c.at}] -> ${c.to} (token "${c.token}")`);
  }

  return out;
}

/* -- the text output ------------------------------------------------------
 *
 * One shared walk drives the page and the text, so the two produce the same
 * row list. One row is a call site, not a node, so a node called twice appears
 * twice. Without the run's end marks every run in a file prints the same text,
 * which would make the reader's choice of run change nothing.
 */
export function text(prog, graphIndex, runIndex) {
  const view = Groundtrack.graphView(prog, graphIndex);
  const i = runIndex === undefined ? Groundtrack.suggestRun(view) : runIndex;
  const run = view.presets[i];
  const rows = Groundtrack.treeRows(view, run.walk);
  const L = [];

  /* Read across the whole file, because the sentence says "in this file". A
   * change whose first graph was written by hand and whose second was captured
   * is mixed, and saying so on either sheet is the honest reading. */
  const kinds = [...new Set(prog.graphs.flatMap(g => g.presets.map(p => p.walk.provenance)))];
  L.push(
    kinds.length === 1 && kinds[0] === 'captured'
      ? 'The walks in this file were captured from a real run.'
      : kinds.length === 1
        ? 'The walks in this file were written by hand. They are claims about the program, not recordings of it.'
        : 'The walks in this file are mixed: some were captured from a real run, some were written by hand.',
  );
  L.push('');
  L.push(`${prog.title}`);
  L.push(`run "${run.name}" — ${run.blurb}`);
  L.push('');

  for (const row of rows) {
    const pad = '  '.repeat(row.depth);
    const arrow = row.depth ? '-> ' : '';
    L.push(`${pad}${arrow}${row.name}  [${row.role}]  ${row.state}${row.repeat ? '  (seen above — stopped)' : ''}`);
    /* Where this call site stood on the error, in the rail's words: the tag
     * beside the raise or the throw, and nothing beside the rest. Only an
     * error still live at the end of the walk shows here, because that is
     * where the text reads the walk. */
    if (row.error) {
      const how = row.error.how.map(h => (Groundtrack.ERROR_POSITION[h] === 'raised' ? `${h} ${row.error.tag}` : h));
      L.push(`${pad}   error path: ${how.join(', ')}`);
    }
    /* The tag, then the kind the file gives it. A tag the file gives no kind
     * for prints bare, and one given two prints both. */
    const E = row.E.length ? row.E.map(t => [t, ...(row.kinds[t] || [])].join(' ')).join(' · ') : 'never';
    const R = row.R.length ? row.R.join(', ') : 'none';
    L.push(`${pad}   A ${row.A || '—'}   E ${E}   R ${R}`);
    if (row.site && (row.site.label || row.site.aside)) {
      if (row.site.label) L.push(`${pad}   at "${row.site.label}"`);
      if (row.site.aside) L.push(`${pad}   ${row.site.aside}`);
    }
    for (const [ln, layer] of Object.entries(prog.layers || {})) {
      const ov = layer.nodes && layer.nodes[row.id];
      if (ov && ov.R && ov.R.length) L.push(`${pad}   R under ${ln}: ${ov.R.join(', ')}`);
    }
    for (const fx of row.effects) L.push(`${pad}   · ${fx.kind}  ${fx.desc} — ${fx.mark}`);
  }

  const others = view.presets.filter((_, j) => j !== i);
  if (others.length) {
    L.push('');
    L.push('other runs in this file:');
    for (const p of others) L.push(`  "${p.name}" — ${p.blurb}`);
  }
  return L.join('\n');
}

/* -- the page -------------------------------------------------------------- */

/* The faces, exactly as IBM publishes them, and their own unicode ranges.
 *
 * These files are IBM's, byte for byte, and that is the whole point. The
 * licence names "Plex" as a Reserved Font Name, so a font we had cut down
 * ourselves would be a Modified Version and could not keep the name it
 * carries. IBM's own splits are original versions, so the name stands.
 *
 * Latin1 holds the text and Pi holds the arrow. Two faces per weight, each
 * with the range IBM declares for it, because two @font-face rules for one
 * family and weight with no range would leave only the last one in force.
 */
const LATIN1 =
  'U+0020-007E, U+00A0-00FF, U+0131, U+0152-0153, U+02C6, U+02DA, U+02DC, U+2013-2014, ' +
  'U+2018-201A, U+201C-201E, U+2020-2022, U+2026, U+2030, U+2039-203A, U+2044, U+20AC, ' +
  'U+2122, U+2212, U+FB01-FB02';
const PI =
  'U+03C0, U+0E3F, U+2000-200D, U+2010-2012, U+2015, U+2028-2029, U+202F, U+2032-2033, ' +
  'U+203E, U+205F, U+2070, U+2074-2079, U+2080-2089, U+2113, U+2116, U+2126, U+212E, ' +
  'U+2150-2151, U+2153-215E, U+2190-2199, U+21A9-21AA, U+21B0-21B3, U+21B6-21B7, ' +
  'U+21BA-21BB, U+21C4, U+21C6, U+2202, U+2206, U+220F, U+2211, U+2215, U+2219-221A, ' +
  'U+221E, U+222B, U+2236, U+2248, U+2260, U+2264-2265, U+2400-2421, U+2500-259F, ' +
  'U+25CA, U+2713, U+274C, U+2B0E-2B11, U+3000, U+FEFF, U+FFFD';

const FONTS = [
  ['400', 'IBMPlexMono-Regular-Latin1.woff2', LATIN1],
  ['400', 'IBMPlexMono-Regular-Pi.woff2', PI],
  ['500', 'IBMPlexMono-Medium-Latin1.woff2', LATIN1],
  ['500', 'IBMPlexMono-Medium-Pi.woff2', PI],
  ['600', 'IBMPlexMono-SemiBold-Latin1.woff2', LATIN1],
  ['600', 'IBMPlexMono-SemiBold-Pi.woff2', PI],
];

export function page(prog) {
  const template = readFileSync(resolve(here, '..', 'assets', 'template.html'), 'utf8');
  const moduleSource = readFileSync(resolve(here, 'groundtrack.js'), 'utf8').replace(/\nif \(typeof module[^\n]*\n?$/, '\n');

  /* The Aviation design system, vendored whole. One file, no imports: tokens,
   * both themes, the dark layer, the av-* vocabulary and the av-tool-* report
   * chrome. Inlined for the same reason the faces below are — a rendered page
   * is one file and must stand on its own. The bundle cannot carry the faces;
   * a stylesheet has no way to embed a binary. See assets/FONTS.md, and do not
   * edit the bundle in place: replace it from the design system repository.
   *
   * Vendored from aviation-design-system 067c21f, which names the walk-sheet
   * roles — --av-path, --av-path-caught and --av-state-rule — so a sheet asks
   * for "the error path" and each theme answers in its own colour, rather
   * than reaching for --av-caution and getting whatever that theme spends it
   * on. It supersedes 32f02eb, which added the planes (--av-ground,
   * --av-paper-tech) and the av-code-* listing vocabulary the source view
   * below wears. Record the revision when you replace it: a
   * vendored copy with no provenance cannot be told from a hand-edited one,
   * which is the failure the "do not edit in place" line above is guarding. */
  const aviation = readFileSync(resolve(here, '..', 'assets', 'aviation.bundle.css'), 'utf8');

  /* The faces are vendored and inlined, so the page makes no network request
   * at all. A font CDN is a dependency on somebody else's uptime, some hosts
   * will not load one, and a drawing whose monospace silently degrades is a
   * worse drawing. */
  const faces = FONTS.map(([weight, file, range]) => {
    const b64 = readFileSync(resolve(here, '..', 'assets', file)).toString('base64');
    return `@font-face{font-family:'IBM Plex Mono';font-style:normal;font-weight:${weight};font-display:block;unicode-range:${range};src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
  }).join('\n');

  /* JSON inside a script block: the closing-tag sequence is escaped so no
   * author string can close it. */
  const data = JSON.stringify(prog).replace(/<\//g, '<\\/');

  /* Function replacements, and this is load-bearing rather than style. A
   * string replacement is interpreted: $&, $` and $' stand for the match and
   * the text on either side of it, so author text carrying one of those
   * splices a slab of the template into the middle of the page — including the
   * template's own real closing script tag, which the escape above cannot help
   * with because that tag never passed through the file. A function
   * replacement is inserted literally and has no patterns at all. */
  /* The sheet picker is rendered here rather than built by the page's script,
   * because a control the script creates is in no page as a string and so no
   * test can count one per graph. Same bargain as the files tab: the markup is
   * the module's, and this splices it in. A one-graph file gets nothing. */
  const picker = Groundtrack.sheetPickerMarkup(prog);

  return template
    .replace('/*TITLE*/', () => String(prog.title).replace(/[<>&]/g, ''))
    .replace('/*AVIATION*/', () => aviation)
    .replace('/*FONTS*/', () => faces)
    .replace('<!--SHEETS-->', () => picker)
    .replace('/*DATA*/', () => data)
    .replace('/*MODULE*/', () => moduleSource);
}

/* -- the command line ------------------------------------------------------ */

const USAGE =
  'usage: node render.mjs <topic>.flightpath.json [--check] [--out page.html] [--text [run]] [--graph <id>]\n' +
  '  --check        validate; refusals on stderr, exit 1; findings on stdout\n' +
  '  --out <page>   write one self-contained HTML file\n' +
  '  --text [run]   print the tree to stdout for one run, by name or index\n' +
  '  --graph <id>   which graph --text reads. Needed when the file states more than one';

function main(argv) {
  const args = argv.slice(2);
  const usage = () => {
    console.error(USAGE);
    process.exit(2);
  };

  const has = n => args.includes(n);
  /* Each argument is judged at its own index. Looking the index up by value
   * finds the first occurrence rather than the position being examined, so a
   * repeated value makes the guard read the wrong neighbour. */
  const valueOf = n => {
    const i = args.indexOf(n);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const VALUED = ['--out', '--text', '--graph'];
  /* A flag that takes a value has two ways to arrive without one: last on the
   * line, or followed by another flag. --text's value is optional, so it is
   * not refused for a missing one; --out and --graph are. */
  const missingValue = n => args.some((a, i) => a === n && (args[i + 1] === undefined || args[i + 1].startsWith('--')));
  if (missingValue('--out') || missingValue('--graph')) usage();

  const positional = args.filter((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]));
  if (positional.length !== 1) usage();
  const file = positional[0];

  const outPath = has('--out') ? valueOf('--out') : undefined;
  const wantText = has('--text');
  const runArg = wantText && valueOf('--text') !== undefined && !valueOf('--text').startsWith('--') ? valueOf('--text') : undefined;
  const graphArg = has('--graph') ? valueOf('--graph') : undefined;

  let prog;
  try {
    /* Hardened before anything asks the file a question: JSON.parse hands\n     * back plain objects, so an unhardened node map answers constructor with\n     * a function and the not-a-node guard stops firing. */
    prog = Groundtrack.hardenKeys(JSON.parse(readFileSync(file, 'utf8')));
  } catch (e) {
    console.error(`cannot read ${file}: ${e.message}`);
    process.exit(2);
  }

  const errs = check(prog, file);
  if (errs.length) {
    for (const e of errs) console.error(e);
    console.error(`${file}: ${errs.length} refusal(s)`);
    process.exit(1);
  }

  const notes = findings(prog);

  /* --graph names the one graph a reading is of, and only --text is a reading
   * of one. --check validates every graph of the change. The page carries
   * every graph and puts a picker over them, so it is not a reading of one
   * either — and *which sheet it opens on* is a thing this flag does not do.
   * Accepting it in either case and quietly ignoring it would answer a
   * question the reader asked with one they did not, at exit 0 and in
   * silence, which is the failure this validator exists to refuse. */
  if (graphArg !== undefined && !wantText) {
    console.error(
      `${file}: --graph names the one graph a reading is of, and only --text is one. --check validates every graph, and the page carries every graph and offers a sheet picker over them — it does not open on a named sheet. Drop --graph, or add --text.`,
    );
    process.exit(2);
  }

  /* A graph the reader named, refused by name when the file has not got it. */
  let graphIndex = 0;
  if (graphArg !== undefined) {
    graphIndex = prog.graphs.findIndex(g => g.id === graphArg);
    if (graphIndex < 0) {
      console.error(`${file}: no graph called "${graphArg}". This file has: ${prog.graphs.map(g => `"${g.id}"`).join(', ')}`);
      process.exit(1);
    }
  }

  if (has('--check')) {
    for (const n of notes) console.log(n);
    const runs = prog.graphs.reduce((s, g) => s + g.presets.length, 0);
    console.error(
      `ok: ${prog.title} — ${Object.keys(prog.nodes).length} node(s), ${prog.graphs.length} graph(s), ${runs} run(s), ${notes.length} finding(s)`,
    );
    process.exit(0);
  }

  if (wantText) {
    /* Nothing ranks the graphs and nothing suggests one. A change with two
     * entry points has two starting points and no reason to prefer either, so
     * the command says what there is and stops rather than picking. The same
     * rule the skill already states for choosing a graph to draw. */
    if (prog.graphs.length > 1 && graphArg === undefined) {
      for (const g of prog.graphs) console.log(`${g.id}  ${g.title}`);
      console.error(`${file}: this file states ${prog.graphs.length} graphs. Name one with --graph <id>; the ids are listed above.`);
      process.exit(1);
    }
    const graph = prog.graphs[graphIndex];
    let index;
    if (runArg !== undefined) {
      index = graph.presets.findIndex(p => p.name === runArg);
      if (index < 0 && /^\d+$/.test(runArg)) index = Number(runArg);
      if (index < 0 || !graph.presets[index]) {
        console.error(
          `${file}: no run called "${runArg}" in graph "${graph.id}". That graph has: ${graph.presets.map(p => `"${p.name}"`).join(', ')}`,
        );
        process.exit(1);
      }
    }
    console.log(text(prog, graphIndex, index));
    process.exit(0);
  }

  /* A run writes its file and its page to scratch, never beside its input, so
   * a working tree does not collect untracked pages. The renderer therefore
   * requires an output path rather than choosing one. */
  if (!outPath) {
    console.error(
      `${file}: name the page to write with --out. This renderer writes no page beside its input, because a page dropped next to the file it was made from is an artifact nobody asked for and nothing cleans up.`,
    );
    console.error(USAGE);
    process.exit(2);
  }

  /* An output path equal to the input overwrites the program with its own
   * page, and there is no copy. Refused rather than written. */
  const source = resolve(file);
  const target = resolve(outPath);
  const refuseSelf = () => {
    console.error(`${file}: --out names the file being rendered. Write the page somewhere else; this would replace the program with its own drawing.`);
    process.exit(2);
  };
  if (source === target) refuseSelf();
  /* Two names can be one file. Comparing the text of the paths does not see a
   * symbolic link or a hard link, so the identity is read off the filesystem
   * as well. Only when both sides report a real device and inode: some
   * filesystems report zero for both, and two different files would then look
   * like one. */
  try {
    const a = statSync(source);
    const b = statSync(target);
    if (a.dev && a.ino && a.dev === b.dev && a.ino === b.ino) refuseSelf();
  } catch (e) {
    /* No such target yet is the ordinary case and means nothing to compare. */
    if (e.code !== 'ENOENT') throw e;
  }

  writeFileSync(target, page(prog));
  console.error(`wrote ${target}`);
  for (const n of notes) console.log(n);
  process.exit(0);
}

// This file is a command, not a module: nothing imports it. It used to run
// main() only when the path node was given matched its own, and through a
// symlinked skill directory the two never matched, so every command exited 0
// having done nothing. A check that says nothing reads as a file with no
// refusals. Run unconditionally, so no path can reach the silent case.
main(process.argv);

