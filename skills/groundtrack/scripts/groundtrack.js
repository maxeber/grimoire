/* groundtrack.js — the one module the page and the tests both run.
 *
 * It lives apart from the markup that calls it so that a test can reach it,
 * and render.mjs inlines it into the page. Two copies of the fold would be two
 * things to get right, and the second one would have no test.
 *
 * Nothing here evaluates an expression. There is no `new Function`, no `eval`,
 * no scope and no value compared. Every expression field in a flightpath file
 * is text this module hands to the page to print.
 */
const Groundtrack = (() => {
  /* -- author text ---------------------------------------------------------
   *
   * A flightpath file is a stranger's text, and the page shows a lot of it:
   * expressions, step remarks, effect descriptions, error messages, run
   * blurbs, layer tokens, file paths and reasons, and a node's location.
   *
   * This escapes & and < and nothing else. That is deliberate and it is
   * narrow: it is enough only while no author text reaches an HTML attribute,
   * where the double quote would end the value. The page keeps that bargain —
   * every interpolated attribute holds a node id, an index or a fixed class
   * name — and SECURITY.md states the pairing. tests/groundtrack-fold.test.mjs
   * pins both halves, the escaping and the passing through, so widening it is
   * a visible test change rather than a quiet one.
   */
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

  /* A node id reaches an HTML attribute, so it is validated rather than
   * escaped. render.mjs refuses a file whose ids do not match this, which is
   * what makes an id a known-safe string by the time the page sees it.
   *
   * That is a claim about attributes and about nothing else. See `bare` below:
   * as an object key an id is as dangerous as any other author string, and
   * this pattern is no defence at all. */
  const ID = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

  /** An object with no prototype, for any map keyed by text out of the file.
   *
   * **Nothing out of the file is safe as a key, ids included.** A plain `{}`
   * inherits from `Object.prototype`, so a key nobody set still answers: the
   * ID pattern above admits `constructor`, `toString`, `valueOf`,
   * `hasOwnProperty` and `isPrototypeOf`, and tags, labels, paths, run names
   * and layer tokens are not validated at all. Only `__proto__` is excluded,
   * and only over its underscore.
   *
   * Read `t[k] || fallback` on such a table and the fallback never fires; read
   * `t[k] === undefined` and the guard never fires. Neither throws where it
   * happens, so the failure surfaces somewhere else — as a crash, or worse as a
   * refusal naming the wrong thing. SECURITY.md carries the rule.
   */
  const bare = () => Object.create(null);

  /** `bare()` seeded from entries, for the tables built in one go. */
  const bareFrom = entries => Object.assign(bare(), Object.fromEntries(entries));

  /** A frame's chain of call sites from the entry, as one table key.
   *
   *  A link is one call site, `caller#step`, and that names one line of
   *  source. It does NOT name one place in the tree: a subtree drawn twice
   *  puts the same link under both copies. The chain from the entry does name
   *  one place, which is why the tree keys by this and not by the last link.
   *
   *  Neither half of a link can hold the separator: an id is letters, digits
   *  and hyphens by `ID` above, and a step is an array index because
   *  `render.mjs` refuses a move whose `at` is not a number. So a chain splits
   *  back into its links unambiguously — on an invariant enforced outside this
   *  function, and half of it outside this file. */
  const chainKey = chain => chain.join('/');
  const chainLinks = key => key.split('/');

  /** Rebuild a parsed file's author-keyed maps with no prototype.
   *
   * The tables this module builds are `bare()` by construction. **The biggest
   * author-keyed map is not built here at all** — `JSON.parse` builds it, and
   * it builds a plain object. So `prog.nodes.constructor` answers with a
   * function for a node the file never declared, and every membership test
   * over the node map reads true for five names the author never wrote.
   *
   * The damage is not a crash. `render.mjs` refuses a call whose target is not
   * a node with `if (!prog.nodes[s.target])`, and that guard silently stops
   * firing: a file calling a node that does not exist validates clean and
   * exits zero. A validator that accepts a file contradicting its own graph is
   * the one thing this validator exists to prevent.
   *
   * Hardening once at the boundary fixes every reader at the same time,
   * including the ones nobody has audited. The maps are the five the shape
   * document calls author-keyed: `nodes`, `env`, `layers`, a layer's `nodes`,
   * and a run's `input`. A copy rather than a mutation, so the caller's parsed
   * object is left as it found it.
   */
  function hardenKeys(prog) {
    if (!prog || typeof prog !== 'object' || Array.isArray(prog)) return prog;
    const isMap = o => o !== null && typeof o === 'object' && !Array.isArray(o);
    const rebuild = o => (isMap(o) ? Object.assign(bare(), o) : o);
    const out = { ...prog };
    if (prog.nodes !== undefined) out.nodes = rebuild(prog.nodes);
    if (prog.env !== undefined) out.env = rebuild(prog.env);
    if (isMap(prog.layers)) {
      out.layers = rebuild(prog.layers);
      for (const name of Object.keys(out.layers)) {
        const layer = out.layers[name];
        if (isMap(layer) && layer.nodes !== undefined) out.layers[name] = { ...layer, nodes: rebuild(layer.nodes) };
      }
    }
    const hardenRuns = runs =>
      runs.map(p => (isMap(p) && p.input !== undefined ? { ...p, input: rebuild(p.input) } : p));
    if (Array.isArray(prog.presets)) out.presets = hardenRuns(prog.presets);
    if (Array.isArray(prog.graphs)) {
      out.graphs = prog.graphs.map(g => (isMap(g) && Array.isArray(g.presets) ? { ...g, presets: hardenRuns(g.presets) } : g));
    }
    return out;
  }

  /* -- one change, several graphs ------------------------------------------
   *
   * A file states one change: its facts, one node map, and a list of graphs. A
   * graph is an entry point and the runs from it. Everything below this reads
   * one graph at a time, so everything below this reads a *view*: the change's
   * node map with one graph's entry and runs laid on top.
   *
   * The view exists so that the fold, the tree and the page did not have to
   * learn about the container. A node belongs to no graph — two graphs reach
   * the same node by both reaching it — so there is nothing to slice out of
   * `nodes`, and a view is a rename rather than a copy of the graph.
   *
   * **A file-wide reader must go through `graphs`, never through `presets`.**
   * `presets` on a view is one graph's runs, and on the file itself it does
   * not exist at all — so a rule that wants every walk in the file and reads
   * `prog.presets` is silently one graph's answer in the first case and
   * silently nothing in the second. Neither throws and neither is visible in a
   * one-graph file, which is every example that ships today. The view carries
   * `graphs` through untouched for exactly this reason: write
   * `prog.graphs.flatMap(g => g.presets)` and the reader is right whether it
   * was handed the file or a view. `findings` and `text` in render.mjs both
   * do. Per-graph readers — the fold, the tree, the drawing — take the view
   * and read `presets`, which is what a view is for.
   */
  const graphView = (prog, i) => {
    const graph = prog.graphs[i || 0];
    return Object.assign({}, prog, { entry: graph.entry, presets: graph.presets, graph });
  };

  /** Everything one sheet remembers, seeded for a graph the reader has not
   *  opened yet.
   *
   *  A page with several sheets keeps one of these per graph and swaps between
   *  them, so a reader who leaves a sheet and comes back finds their run, their
   *  cursor, their layer, their view and their open node where they left them.
   *  It is here rather than in the template because a state that a reader can
   *  lose by clicking twice is worth a test, and a test needs it without a DOM.
   *
   *  The layer is one of the five, so it is the sheet's like the rest: a sheet
   *  opened for the first time starts on the file's first layer, whatever
   *  layer the sheet the reader came from is on. What belongs to the change is
   *  the layer *map* — every sheet is offered the same buttons, because a
   *  layer renames a token wherever that token is. Which of them is lit is a
   *  question about this sheet. */
  function sheetState(prog, i) {
    const view = graphView(prog, i);
    const layerNames = Object.keys(prog.layers || {});
    return {
      view,
      layout: layout(view),
      run: 0,
      at: 0,
      states: fold(view, view.presets[0].trace),
      layer: layerNames.length ? layerNames[0] : null,
      open: view.entry,
      tab: 'source',
      tree: false,
      zoom: 1,
      panX: 0,
      panY: 0,
      playing: null,
      /* The edge the last step moved along, kept until the next step so the
         animation on it runs the whole time the cursor rests there. */
      redraw: null,
    };
  }

  /** The sheet picker, as markup, or nothing at all for a one-graph file.
   *
   *  Rendered into the page rather than built by its script, for the same
   *  reason `filesMarkup` is here: a control the script creates is in no
   *  rendered page as a string, so no test can count one per graph. The run
   *  picker is built at runtime and cannot be checked that way; this one can.
   *
   *  A title is author text and goes through `esc` into element content. An id
   *  reaches an attribute, so it is validated rather than escaped — and a file
   *  the validator has not seen carries none, which is why the pattern is
   *  tested here too and not only in `render.mjs`.
   *
   *  The option's value is the index, because that is what the page indexes
   *  its sheets by. `data-graph` carries the id beside it, and no script reads
   *  it: it is there so the id a reader needs for `--text --graph <id>` is in
   *  the page they are looking at, rather than only in the file. */
  function sheetPickerMarkup(prog) {
    const graphs = (prog && prog.graphs) || [];
    if (graphs.length < 2) return '';
    const options = graphs
      .map((g, i) =>
        '<option value="' + i + '"' + (ID.test(String(g.id)) ? ' data-graph="' + g.id + '"' : '') +
        '>' + esc(g.title) + '</option>')
      .join('');
    return (
      '<label class="av-label" for="sheet">sheet</label>' +
      '<select id="sheet" data-help="Which graph of this change to draw. One change, one file: each entry point is a sheet, and each sheet keeps its own run, cursor, layer, view and open node.">' +
      options +
      '</select>'
    );
  }

  /** What one entry reaches through call edges. That set is what a graph draws. */
  function reachable(prog, entry) {
    const seen = new Set();
    (function go(id) {
      if (seen.has(id) || !prog.nodes[id]) return;
      seen.add(id);
      for (const s of prog.nodes[id].steps || []) if (s.op === 'call') go(s.target);
    })(entry);
    return seen;
  }

  /* -- reading the graph ---------------------------------------------------- */

  /** label -> step index, for one node. A label is a jump target and nothing else. */
  const labelsOf = node => {
    const m = bare();
    (node.steps || []).forEach((s, i) => {
      if (s.label !== undefined) m[s.label] = i;
    });
    return m;
  };

  /** The call steps of one node, in order. A node called twice is two sites. */
  const callSites = node => {
    const out = [];
    (node.steps || []).forEach((s, i) => {
      if (s.op === 'call') out.push({ at: i, target: s.target, label: s.label, aside: s.aside });
    });
    return out;
  };

  /** Distinct callees, in first-call order. Used by the drawing, not the tree. */
  const calleesOf = (prog, id) => {
    const out = [];
    for (const s of prog.nodes[id].steps || []) {
      if (s.op === 'call' && prog.nodes[s.target] && !out.includes(s.target)) out.push(s.target);
    }
    return out;
  };

  const effectsOf = node => (node.steps || []).map((s, i) => ({ ...s, at: i })).filter(s => s.op === 'effect');

  /* -- the failure cause ---------------------------------------------------
   *
   * The two causes a failure can have, in the order they print. A fail is an
   * expected error a caller handles. A die is a defect, and never part of the
   * contract.
   */
  const KINDS = ['fail', 'die'];

  /** tag -> the kinds the file gives it, in KINDS order.
   *
   * Two sources, and only two: a `throw` step in the node map, and an effect
   * move that `raised` in a trace. Both name a cause, and between them they
   * are every place the file says what kind of failure a tag is. A tag named
   * nowhere but an error list is absent from this table, and prints bare — the
   * page does not invent a kind the file never stated.
   *
   * An `onError` handler is not a source. It names the tag it catches and no
   * cause: it says where a failure stops, never what kind it was. Nor is a
   * trace's `throw` move, which repeats the cause of the step it ran — one
   * fact, written once, read from the step.
   *
   * It is derived rather than declared for the same reason a cut edge is: a
   * second place to write the kind is a second place for it to be wrong.
   */
  function failureKinds(prog) {
    const seen = bare();
    const add = (tag, cause) => {
      if (tag === undefined || !KINDS.includes(cause)) return;
      (seen[tag] = seen[tag] || new Set()).add(cause);
    };
    /* `nodes` and `graphs` are core fields the validator requires, so neither
     * is guarded here. A guard could never fire on a file this module is given
     * today, and would earn its keep only by hiding the day one of them stops
     * being where it is — returning a table missing every kind that a `raised`
     * move supplies, with no error and nothing to notice. Let that throw.
     *
     * The kind is file-wide, so the walks are read through `graphs` rather
     * than through `presets`. A view carries `graphs` untouched, so this is
     * right whether it is handed the file or one graph's view — and reading
     * `presets` would be wrong both ways: one graph's walks on a view, and
     * nothing at all on the file, where the field does not exist. A tag that
     * only another graph's walk raises would have printed bare. */
    for (const node of Object.values(prog.nodes)) {
      for (const s of node.steps || []) if (s.op === 'throw') add(s.tag, s.cause);
    }
    for (const p of prog.graphs.flatMap(g => g.presets)) {
      for (const m of (p.trace && p.trace.steps) || []) {
        if (m.k === 'effect' && m.raised) add(m.raised.tag, m.raised.cause);
      }
    }
    const out = bare();
    for (const tag of Object.keys(seen)) out[tag] = KINDS.filter(k => seen[tag].has(k));
    return out;
  }

  /** What one node does with one tag: throws it, catches it, both, or neither.
   *  Neither means the tag passes up from beneath, which is the third thing
   *  the contract tab has to be able to say. */
  const tagFate = (node, tag) => ({
    throws: (node.steps || []).some(s => s.op === 'throw' && s.tag === tag),
    catches: (node.steps || []).some(s => (s.onError || []).some(h => h.tag === tag)),
  });

  /* Cyclomatic complexity of one node, as drawn: one, plus one for each place
   * the path forks. An `if` forks. Each onError handler forks, since the call
   * or effect it guards can go on or be caught. A jump backward — a goto, or
   * an if branch, that lands at or before its own step — closes a loop, and a
   * loop is one more independent path.
   *
   * It is the complexity of the drawing and not of the code. The author chose
   * which branches to draw, and a node whose steps are one note has a value
   * of one however the real function reads. Cognitive complexity is not
   * computed, on purpose: it weights nesting depth, and a flat step list with
   * labels does not carry nesting, so any number would be a guess.
   */
  function complexityOf(node) {
    const L = labelsOf(node);
    let ifs = 0, handlers = 0, loops = 0;
    (node.steps || []).forEach((s, i) => {
      if (s.op === 'if') {
        ifs += 1;
        for (const k of ['then', 'else']) if (L[s[k]] !== undefined && L[s[k]] <= i) loops += 1;
      }
      if (s.op === 'goto' && L[s.to] !== undefined && L[s.to] <= i) loops += 1;
      handlers += (s.onError || []).length;
    });
    return { value: 1 + ifs + handlers + loops, ifs, handlers, loops };
  }

  /* -- the fold ------------------------------------------------------------
   *
   * The player may derive, never decide. This pushes a frame, pops a frame,
   * appends a ledger row and moves a cursor. Everything else on the page — the
   * step counter, what has been visited, which edges the walk took — is read
   * off the states this returns.
   *
   * It returns one immutable state per cursor position, so stepping backward
   * is an index lookup and returns exactly what stepping forward produced.
   * states[0] is the walk before its first move; states[i] is the walk after
   * move i - 1.
   */
  function fold(prog, walk) {
    const moves = (walk && walk.steps) || [];

    /* A walk begins in the entry node with the cursor at zero. No move says
     * so, so the seed state does. The entry frame's site is the root: it was
     * pushed by nothing, and the tree hangs its top row off this key.
     *
     * A frame carries its site TWICE, and the two answer different questions.
     * `site` is the call step that pushed it, `caller#step`. `chain` is every
     * site from the entry down to it. A step names one line of source and is
     * what the cutaway asks about; a chain names one path through the graph
     * and is what the tree asks about. They differ exactly when one subtree is
     * drawn more than once, which is the case `site` alone cannot read. */
    let frames = [{ nodeId: prog.entry, pc: 0, callAt: undefined, site: '@entry', chain: ['@entry'] }];
    let ledger = [];
    let visited = [prog.entry];
    let edges = [];
    /* Every entry that names a node also names the call site of its frame —
     * the popped frame on an unwind, the top frame on a throw or a catch. The
     * tree is one row per call site and has to know which row an entry is,
     * and it cannot work that out later: by the time the cursor sits on the
     * catch, the frames that threw and unwound are gone. The entry for an
     * error reaching the top names neither. */
    let errorPath = [];
    /* BY PATH FROM THE ENTRY, which is what the tree reads. A chain key is the
     * frame's chain joined: `@entry/greet#0/loadProfile#1`. No node id can hold
     * the separator — an id is letters, digits and hyphens — so a chain splits
     * back into its links unambiguously. */
    let sites = bare(); /* chain key -> { entered, returned, effects: { "node[at]": outcome } } */
    /* The same marks again, keyed by node rather than by call site. The tree
     * shows one row per call site and wants the first; the drawing shows one
     * box per node and wants the second. Without this the drawing loses a
     * node's effect marks the moment its frame returns, while the tree keeps
     * them — one graph seen two ways, disagreeing. */
    let nodeEffects = {};
    let ended = null;

    const clone = () => frames.map(f => ({ ...f, chain: f.chain.slice() }));
    const touch = chain => (sites[chainKey(chain)] = sites[chainKey(chain)] || { entered: 0, returned: 0, effects: bare() });

    touch(['@entry']).entered = 1;

    const states = [
      {
        i: -1,
        move: null,
        frames: clone(),
        ledger: [],
        visited: visited.slice(),
        edges: [],
        errorPath: [],
        sites: JSON.parse(JSON.stringify(sites)),
        nodeEffects: {},
        ended: null,
        moved: null,
      },
    ];

    moves.forEach((m, i) => {
      let moved = null;
      const top = frames[frames.length - 1];

      if (m.k === 'propagate') {
        const gone = frames.pop();
        if (gone) {
          moved = { from: gone.nodeId, to: frames.length ? frames[frames.length - 1].nodeId : null, dir: 'propagate' };
          errorPath = errorPath.concat([{ nodeId: gone.nodeId, site: gone.site, chain: gone.chain.slice(), how: 'propagated' }]);
        }
      } else if (m.k === 'done') {
        frames = [];
        ended = 'done';
      } else if (m.k === 'uncaught') {
        errorPath = errorPath.concat([{ nodeId: null, how: 'reached the top uncaught', tag: m.tag, message: m.message, cause: m.cause }]);
        frames = [];
        ended = 'uncaught';
      } else if (top) {

        switch (m.k) {
          case 'comment':
          case 'var':
          case 'if':
          case 'goto':
            top.pc = m.next;
            break;
          case 'call': {
            top.pc = m.next;
            /* The call's own next is the caller's continuation, set before the
             * callee is pushed. callAt is the step whose onError guards this
             * call — it is what the uncaught check reads, and the cursor is
             * already past it by now. */
            top.callAt = m.at;
            const key = `${top.nodeId}#${m.at}`;
            const chain = top.chain.concat([key]);
            touch(chain).entered += 1;
            frames.push({ nodeId: m.to, pc: 0, callAt: undefined, site: key, chain });
            if (!visited.includes(m.to)) visited.push(m.to);
            edges = edges.concat([`${top.nodeId}>${m.to}`]);
            moved = { from: top.nodeId, to: m.to, dir: 'call' };
            break;
          }
          case 'effect': {
            const outcome = m.raised !== undefined ? 'threw' : 'returned';
            touch(top.chain).effects[`${top.nodeId}[${m.at}]`] = outcome;
            nodeEffects = { ...nodeEffects, [`${top.nodeId}[${m.at}]`]: outcome };
            ledger = ledger.concat([
              {
                nodeId: top.nodeId,
                at: m.at,
                kind: m.kind,
                desc: m.desc,
                outcome,
                result: m.result,
                attempt: m.attempt,
                raised: m.raised,
              },
            ]);
            if (m.raised !== undefined) {
              errorPath = [{ nodeId: top.nodeId, site: top.site, chain: top.chain.slice(), how: 'thrown', tag: m.raised.tag, message: m.raised.message, cause: m.raised.cause }];
            } else {
              top.pc = m.next;
            }
            break;
          }
          case 'throw':
            errorPath = [{ nodeId: top.nodeId, site: top.site, chain: top.chain.slice(), how: 'thrown', tag: m.tag, message: m.message, cause: m.cause }];
            break;
          case 'catch':
            top.pc = m.next;
            errorPath = errorPath.concat([{ nodeId: top.nodeId, site: top.site, chain: top.chain.slice(), how: 'caught', goto: m.goto }]);
            break;
          case 'return': {
            const gone = frames.pop();
            if (gone) touch(gone.chain).returned += 1;
            if (frames.length) {
              frames[frames.length - 1].callAt = undefined;
              moved = { from: gone.nodeId, to: frames[frames.length - 1].nodeId, dir: 'return' };
            }
            errorPath = [];
            break;
          }
          default:
            break;
        }
      }

      states.push({
        i,
        move: m,
        frames: clone(),
        ledger: ledger.slice(),
        visited: visited.slice(),
        edges: edges.slice(),
        errorPath: errorPath.slice(),
        sites: JSON.parse(JSON.stringify(sites)),
        nodeEffects,
        ended,
        moved,
      });
    });

    return states;
  }

  /** Stepping back over a call redraws it callee to caller, so unwinding reads
   *  as unwinding. The state itself is the one stepping forward produced. */
  function back(states, i) {
    const from = states[i];
    const to = states[Math.max(0, i - 1)];
    const m = from && from.moved;
    return { state: to, redraw: m ? { from: m.to, to: m.from, dir: m.dir === 'call' ? 'uncall' : 'unreturn' } : null };
  }

  /** Where a help note goes, given the box of the thing it describes, the
   *  note's size and the window's. Centred under the thing, above it when
   *  there is no room below, and never off the window. `lead` is where the
   *  leader sits along the note: over the thing's middle, so it still lands on
   *  the thing when the note is pushed back inside the window — which is
   *  where a note from the rail, at the window's right edge, always is.
   *
   *  "Never off the window" needs a note no wider than the window less both
   *  margins. The page's stylesheet holds the note to that width before it is
   *  measured, so the room is always there.
   *
   *  The margins are the system's --av-s2 and the leader gap, held here
   *  because a layout number cannot be read out of a custom property without
   *  a round trip through computed style. */
  const TIP_EDGE = 12, TIP_GAP = 9;
  function tipAt(box, note, win) {
    const middle = (box.left + box.right) / 2;
    const left = Math.max(TIP_EDGE, Math.min(middle - note.width / 2, win.width - note.width - TIP_EDGE));
    const lead = Math.max(TIP_EDGE, Math.min(middle - left, note.width - TIP_EDGE));
    let top = box.bottom + TIP_GAP, above = false;
    if (top + note.height > win.height - TIP_EDGE) {
      top = box.top - note.height - TIP_GAP;
      above = true;
    }
    return { left, top: Math.max(TIP_EDGE, top), lead, above };
  }

  /* -- the derived cut -----------------------------------------------------
   *
   * A layer renames a token, never a node, so the geometry never changes. A
   * rename may still cut a call edge, and nobody writes that down: if the
   * renamed token appears in a call step's args, that edge is cut under the
   * layer. Both arrow spellings are read, because the worked programs use one
   * and the shape document's example uses the other.
   */
  const renamedToken = r => String(r).split(/→|->/)[0].trim();

  function cutEdges(prog) {
    const cuts = [];
    for (const [ln, layer] of Object.entries(prog.layers || {})) {
      for (const [nid, ov] of Object.entries((layer && layer.nodes) || {})) {
        const tokens = ((ov && ov.requirements) || []).map(renamedToken).filter(Boolean);
        for (const [callerId, caller] of Object.entries(prog.nodes)) {
          (caller.steps || []).forEach((s, i) => {
            if (s.op !== 'call') return;
            const args = JSON.stringify(s.args || {});
            /* The rule is the argument list and nothing else. A prototype also
             * cut every call the renamed node itself makes, which cuts edges
             * the substitution never touched — it is a node rule wearing a
             * token rule's clothes, and a layer renames a token, never a
             * node. */
            for (const tok of tokens) {
              if (args.includes(tok)) cuts.push({ layer: ln, from: callerId, at: i, to: s.target, token: tok });
            }
          });
        }
      }
    }
    return cuts;
  }

  /* -- the drawing ---------------------------------------------------------
   *
   * Depth is the longest path from the entry, so a node called from two depths
   * draws below both of its callers. The call runs down the left of a pair and
   * the declared error return up its right: one corridor, two directions.
   */
  const W = 356, GAP_X = 48, GAP_Y = 96, PAD = 36;

  /* A sheet draws one graph, and one graph is what its entry reaches. So the
   * drawing places the reachable set and not the node map: on a change with
   * two entries the other entry's nodes belong to the other sheet, not to this
   * one greyed out. Takes a view, because only a view has an entry.
   *
   * Every shipped example reports no unreached node, so no one-graph drawing
   * moves by a pixel — which is the promise, and the reason this could be
   * settled here rather than argued from a screenshot.
   *
   * Loud on a file, for the reason `filesOf` is: `reachable(prog, undefined)`
   * is the empty set, so a drawing with no boxes in it is what a caller that
   * passed the file rather than the view would get, with nothing said. */
  function layout(prog) {
    if (!prog.entry) {
      throw new Error('layout needs a graph view: a file lists graphs and has no entry of its own');
    }
    const ids = [...reachable(prog, prog.entry)];

    /* A BACK EDGE is a call into a node still on the depth-first walk from
     * the entry, callees visited in call order. A call from a node to itself
     * is always one. Depth is longest-path over every other edge, so a cycle
     * cannot climb it: the entry stays at depth 0 and a mutual pair's entry
     * sits above its callee. An acyclic graph has no back edge, and lays out
     * exactly as it did before there was a rule for one. */
    const backs = new Set();
    const onWalk = new Set(), done = new Set();
    (function walk(id) {
      onWalk.add(id);
      for (const c of calleesOf(prog, id)) {
        if (onWalk.has(c)) backs.add(`${id}>${c}`);
        else if (!done.has(c)) walk(c);
      }
      onWalk.delete(id);
      done.add(id);
    })(prog.entry);
    const isBack = (from, to) => backs.has(`${from}>${to}`);

    const depth = bareFrom(ids.map(i => [i, 0]));
    for (let k = 0; k < ids.length; k++) {
      for (const id of ids) {
        for (const c of calleesOf(prog, id)) if (!isBack(id, c) && depth[c] < depth[id] + 1) depth[c] = depth[id] + 1;
      }
    }

    const order = [], seen = new Set();
    (function dfs(id) {
      if (seen.has(id)) return;
      seen.add(id);
      order.push(id);
      calleesOf(prog, id).forEach(dfs);
    })(prog.entry);

    const rows = {};
    for (const id of order) (rows[depth[id]] = rows[depth[id]] || []).push(id);

    /* The box, measured on the page at 1:1: 12 + 12 padding, a 21 top row —
     * 23 when it carries a state chip, which is the height taken here so no
     * wire starts inside a box — a 24 name, a 19 location, a 71 channel
     * block, and 22 for each effect row under it. The two small type sizes
     * moved up one step, and these moved with them. */
    const H = Object.fromEntries(ids.map(id => [id, 163 + effectsOf(prog.nodes[id]).length * 22]));
    const widest = Math.max(...Object.values(rows).map(r => r.length));
    const sheetW = widest * W + (widest - 1) * GAP_X;

    /* A node sits under the nodes that call it. A caller centres its callees
     * beneath itself, in call order, so a node with one callee puts it straight
     * below and a node with four spreads them either side. A callee reached
     * from two callers takes the mean of what each asked for. Each row after
     * the first is then placed by one left-to-right sweep: a node gets the x
     * it asked for unless the node before it is in the way, in which case it
     * shifts right by exactly the gap. A node no placed node calls keeps the
     * row's right edge. This is one pass with no search, not a layout engine,
     * and the first row is centred on the sheet as before. */
    const pos = bare();
    const rowTop = bare(), rowBottom = bare();
    let y = PAD;
    let rightEdge = PAD;
    for (const d of Object.keys(rows).sort((a, b) => a - b)) {
      const row = rows[d];
      rowTop[d] = y;
      rowBottom[d] = y + Math.max(...row.map(id => H[id]));
      if (d === '0') {
        const rowW = row.length * W + (row.length - 1) * GAP_X;
        let x = PAD + (sheetW - rowW) / 2;
        for (const id of row) {
          pos[id] = { x, y, h: H[id] };
          x += W + GAP_X;
        }
      } else {
        const asks = bareFrom(row.map(id => [id, []]));
        for (const c of ids) {
          if (!pos[c]) continue;
          const kids = calleesOf(prog, c).filter(k => asks[k]);
          kids.forEach((k, i) => asks[k].push(pos[c].x + (i - (kids.length - 1) / 2) * (W + GAP_X)));
        }
        const want = bare();
        for (const id of row) want[id] = asks[id].length ? asks[id].reduce((s, v) => s + v, 0) / asks[id].length : Infinity;
        let x = PAD;
        for (const id of row.slice().sort((a, b) => want[a] - want[b] || row.indexOf(a) - row.indexOf(b))) {
          x = Math.max(want[id] === Infinity ? rightEdge + GAP_X : want[id], x);
          pos[id] = { x, y, h: H[id] };
          x += W + GAP_X;
        }
      }
      for (const id of row) rightEdge = Math.max(rightEdge, pos[id].x + W);
      y += Math.max(...row.map(id => H[id])) + GAP_Y;
    }
    let canvasW = Math.max(sheetW + PAD * 2, rightEdge + PAD);

    /* WHERE A BACK EDGE ATTACHES. Every back edge between two nodes leaves its
     * caller's right side and enters its callee's, so a node in several takes
     * several places down that side: the edges it makes first, then the ones
     * it takes. Each place is a height on the box and a stub out into the gap
     * beside it, and no two share either. A box is at least 163 tall and the
     * gap 48 wide, so past four heights, or three stubs, they stack on the
     * last. */
    const pairs = [];
    for (const from of ids) for (const to of calleesOf(prog, from)) if (isBack(from, to) && from !== to) pairs.push([from, to]);
    const makes = bare(), takes = bare();
    for (const [f, t] of pairs) {
      (makes[f] = makes[f] || []).push(t);
      (takes[t] = takes[t] || []).push(f);
    }
    const place = (id, j) => ({ y: pos[id].y + 40 + Math.min(j, 3) * 28, stub: pos[id].x + W + 16 + Math.min(j, 2) * 12 });

    /* A back edge between two nodes: out of the caller's right side, up a
     * lane, and into the callee's right side.
     *
     * THE LANE is the nearest upright line right of both boxes that clears
     * everything its climb passes: every box in the rows it spans, with room
     * for a self-calling box's loop on that box's left, and every lane an
     * earlier back edge took. Nearest, because the drawing's far edge — which
     * also clears all of it — sends a wire the whole width of the sheet to
     * join two boxes that sit one above the other. The canvas grows when a
     * lane lands past its edge.
     *
     * AN END with a box between it and the lane on its row cannot run
     * straight to the lane: it would cut through that box. That end detours
     * instead: out into the gap beside its box, into the gap between rows,
     * and along it to the lane. An end with nothing in the way runs straight,
     * because a detour there draws a jog that avoids nothing. Which ends
     * detour depends on where the lane is, and how far the lane climbs
     * depends on which ends detour, so the two are settled together: try the
     * nearest lane, and step past whatever it hits.
     *
     * The error wire runs the same route the other way, eight inside it, and
     * crosses its own call nowhere. */
    const LOOP = 26;
    const selfCalls = id => isBack(id, id);
    const lanes = [];

    /* A forward wire: down from the caller's bottom, across the gap, down
     * into the callee's top, with its error wire twenty to the right. */
    const forward = (from, to) => {
      const a = pos[from], b = pos[to];
      const sx = a.x + W / 2 - 10, sy = a.y + a.h;
      const ex = b.x + W / 2 - 10, ey = b.y;
      return { sx, sy, ex, ey, my: (sy + ey) / 2 - 6 };
    };

    /* Every upright leg a forward wire draws. A lane that climbs within eight
     * of one reads as the same line, so these are in the way too. */
    const flows = [];
    for (const from of ids) {
      for (const to of calleesOf(prog, from)) {
        if (isBack(from, to)) continue;
        const { sx, sy, ex, ey, my } = forward(from, to);
        flows.push({ x: sx, top: sy, bottom: my }, { x: sx + 20, top: sy, bottom: my + 12 });
        flows.push({ x: ex, top: my, bottom: ey }, { x: ex + 20, top: my + 12, bottom: ey });
      }
    }

    /* The first box a horizontal at `y`, from `id`'s right edge to `x`, would
     * enter, if any. Only a box in `id`'s row spans that height. */
    const inTheWay = (id, y, x) =>
      ids.find(k => k !== id && pos[k].y < y && y < pos[k].y + pos[k].h && pos[k].x - (selfCalls(k) ? LOOP + 8 : 0) < x && pos[k].x > pos[id].x);

    /* The right edge of the first thing an upright at `x`, with its error
     * wire eight left of it, would run into between `top` and `bottom`; or
     * nothing, when that lane is clear. A box counts from the left of its
     * loop, if it calls itself, to the right of its stubs, if another back
     * edge can bend out of it — `from` and `to` aside, whose stubs this wire
     * leaves by. An earlier lane counts twenty wide, and a forward wire's
     * upright leg sixteen: eight clear of the call on one side and of its
     * error wire on the other. */
    const laneBlock = (x, top, bottom, from, to) => {
      for (const k of ids) {
        const p = pos[k];
        const left = p.x - (selfCalls(k) ? LOOP + 8 : 8);
        const right = p.x + W + (k !== from && k !== to && (makes[k] || takes[k]) ? 44 : 0);
        if (x - 16 < right && x + 8 > left && top < p.y + p.h && bottom > p.y) return right;
      }
      for (const l of lanes) if (Math.abs(x - l.x) < 20 && top < l.bottom && bottom > l.top) return l.x - 4;
      for (const f of flows) if (f.x > x - 16 && f.x < x + 8 && top < f.bottom && bottom > f.top) return f.x - 8;
      return null;
    };

    /* How far into a gap between rows a detour runs, counted per side of
     * each gap: a caller's end detours along the top of the gap above its
     * row, a callee's along the bottom of the gap below its. Three heights,
     * 12 apart, so three detours along one side keep three lines with their
     * error wires between; a fourth shares the first's. Past 36 the two sides
     * of one gap would cross. */
    const detours = bare();
    const lift = side => 12 + ((detours[side] || 0) % 3) * 12;

    const backWire = (from, to) => {
      const a = pos[from], b = pos[to];
      const out = place(from, makes[from].indexOf(to));
      const into = place(to, (makes[to] || []).length + takes[to].indexOf(from));
      const ay = out.y + 14, by = into.y, sa = out.stub, sb = into.stub;
      const above = `above ${depth[from]}`, below = `below ${depth[to]}`;
      const ya = rowTop[depth[from]] - lift(above), yb = rowBottom[depth[to]] + lift(below);

      /* The caller's end reaches the lane at `ay`, or by the gap above its
       * row at `ya`; the callee's end leaves it at `by`, or by the gap below
       * its row at `yb`. The callee is always on a higher row. */
      let lane = Math.max(a.x, b.x) + W + 24;
      let outBent, inBent;
      for (;;) {
        outBent = !!(inTheWay(from, ay, lane) || inTheWay(from, ay - 14, lane));
        inBent = !!(inTheWay(to, by, lane) || inTheWay(to, by + 14, lane));
        /* The climb runs from where the callee's end leaves the lane to where
         * the caller's reaches it, and its error wire eight inside, so this
         * span covers both. */
        const top = inBent ? yb : by, bottom = outBent ? ya : ay;
        const hit = laneBlock(lane, top, bottom, from, to);
        if (hit === null) {
          lanes.push({ x: lane, top: top - 16, bottom: bottom + 16 });
          break;
        }
        lane = Math.max(hit + 24, lane + 1);
      }
      canvasW = Math.max(canvasW, lane + PAD);

      const call = [[a.x + W, ay]];
      const err = [[a.x + W, ay - 14]];
      if (outBent) {
        detours[above] = (detours[above] || 0) + 1;
        call.push([sa, ay], [sa, ya], [lane, ya]);
        err.push([sa - 8, ay - 14], [sa - 8, ya - 8], [lane - 8, ya - 8]);
      } else {
        call.push([lane, ay]);
        err.push([lane - 8, ay - 14]);
      }
      if (inBent) {
        detours[below] = (detours[below] || 0) + 1;
        call.push([lane, yb], [sb, yb], [sb, by]);
        err.push([lane - 8, yb + 8], [sb - 8, yb + 8], [sb - 8, by + 14]);
      } else {
        call.push([lane, by]);
        err.push([lane - 8, by + 14]);
      }
      call.push([b.x + W, by]);
      err.push([b.x + W, by + 14]);
      const d = pts => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ');
      return { call: d(call), err: d(err.reverse()) };
    };

    /* A self call: a loop on the box's left side, out low and back in high.
     * Left, so it never shares the right-hand side a back edge between two
     * nodes uses. Its error wire runs inside the loop, high to low. `count` is
     * where the page writes how many of the node's frames are open: in the
     * loop's own corner, above where it comes back in, and `room` wide. */
    const selfWire = id => {
      const { x, y, h } = pos[id];
      return {
        call: `M${x},${y + h - 44} L${x - LOOP},${y + h - 44} L${x - LOOP},${y + 44} L${x},${y + 44}`,
        err: `M${x},${y + 58} L${x - 12},${y + 58} L${x - 12},${y + h - 58} L${x},${y + h - 58}`,
        count: { x: x - LOOP / 2, y: y + 38, room: LOOP },
      };
    };

    const edges = [];
    for (const from of ids) {
      for (const to of calleesOf(prog, from)) {
        const hasE = ((prog.nodes[to].channels || {}).error || []).length > 0;
        if (isBack(from, to)) {
          const self = from === to;
          const wire = self ? selfWire(from) : backWire(from, to);
          edges.push({ from, to, back: true, self, ...wire, hasE });
          continue;
        }
        const { sx, sy, ex, ey, my } = forward(from, to);
        edges.push({
          from, to,
          call: `M${sx},${sy} L${sx},${my} L${ex},${my} L${ex},${ey}`,
          err: `M${ex + 20},${ey} L${ex + 20},${my + 12} L${sx + 20},${my + 12} L${sx + 20},${sy}`,
          hasE,
        });
      }
    }

    return { pos, edges, order, width: W, canvasW, canvasH: y - GAP_Y + PAD };
  }

  /* The three rules the page draws a wire and a box by, here rather than in
   * the page so a test can reach them. The page calls these and keeps none of
   * its own. */

  /** Whether a wire is open now. A forward wire is, while both its ends are
   *  on the stack. A back edge is only while its caller's frame sits directly
   *  under its callee's: under recursion both ends are on the stack for the
   *  whole descent, and most of that time the walk is not crossing this wire. */
  function wireLive(state, edge) {
    const f = state.frames;
    if (edge.back) return f.some((top, i) => i > 0 && f[i - 1].nodeId === edge.from && top.nodeId === edge.to);
    return f.some(x => x.nodeId === edge.from) && f.some(x => x.nodeId === edge.to);
  }

  /** How the last move animates one wire: `flow` caller to callee, `flow-rev`
   *  callee to caller, or null. A call, and stepping back over a return, run
   *  caller to callee; a return, a propagate and stepping back over a call run
   *  the other way. The redraw names its two ends in the order it moved, so
   *  the direction says which end is the caller — and a mutual pair's two
   *  wires, which join the same two nodes, never animate together. */
  const DOWN = new Set(['call', 'unreturn']);
  function wireFlow(redraw, edge) {
    if (!redraw) return null;
    if (DOWN.has(redraw.dir)) return redraw.from === edge.from && redraw.to === edge.to ? 'flow' : null;
    return redraw.to === edge.from && redraw.from === edge.to ? 'flow-rev' : null;
  }

  /** How deep a self-calling node is: `×3` while three of its frames are
   *  open, and nothing for one or none. It goes in the corner of the node's
   *  loop wire, unless it is too wide for it, when `at` is null and the page
   *  puts it in the box's top row. The width is the mono face's advance, 0.6
   *  of its size, at the page's micro size of 12px — a figure the page cannot
   *  hand this module without a DOM, so it moves when that size does. */
  const COUNT_ADVANCE = 7.2;
  function countMark(lay, state, id) {
    const loop = lay.edges.find(e => e.self && e.from === id);
    const n = state.frames.filter(f => f.nodeId === id).length;
    if (!loop || n < 2) return null;
    const text = '×' + n;
    return { text, at: text.length * COUNT_ADVANCE <= loop.count.room ? { x: loop.count.x, y: loop.count.y } : null };
  }

  /* -- the tree ------------------------------------------------------------
   *
   * One row is a call site, not a node, so a node called twice appears twice
   * and the text matches the tree on the page. A repeated node is marked and
   * stopped, or a cycle never terminates.
   */

  /** Three of the four words the fold writes on the error path, each its own
   *  position — `reached the top uncaught` names no node, so it needs none.
   *  The tree, the text and the page all sort by this one table. */
  const ERROR_POSITION = Object.freeze({ thrown: 'thrown', propagated: 'propagated', caught: 'caught' });

  /** What one CALL STEP did, summed over every path that reached it.
   *
   *  The cutaway lists one node's source and marks each call line by what the
   *  walk did with it. It asks about a node and a step index and holds no
   *  path, because a listing of one node is not a path through the graph — so
   *  it cannot read the fold's table, which is keyed by the chain from the
   *  entry. A step the tree draws in two places is one line of source here,
   *  and its answer is both places together.
   *
   *  This lives in the module rather than in the template for the reason
   *  SECURITY.md gives: a function inside the page is a function no test can
   *  reach. The page keeps the classes it paints from these counts; the words
   *  for a walk's state are the tree's and are not invented here.
   */
  function callCounts(state, nodeId, at) {
    const step = `${nodeId}#${at}`;
    const out = { entered: 0, returned: 0, open: false };
    for (const key of Object.keys(state.sites)) {
      if (chainLinks(key).pop() !== step) continue;
      out.entered += state.sites[key].entered;
      out.returned += state.sites[key].returned;
    }
    out.open = state.frames.some(f => f.site === step);
    return out;
  }

  function treeRows(prog, walk, layerName, atIndex, states) {
    const all = states || fold(prog, walk);
    const end = all[atIndex === undefined ? all.length - 1 : atIndex];
    const layer = (prog.layers || {})[layerName];
    /* One table for the whole file, computed once here and carried on every
     * row, so the tree on the page and the tree in a reply read the same tag
     * the same way. */
    const kinds = failureKinds(prog);

    /* THE ROWS THE TREE DRAWS, and the chain each one stands for. Walked
     * before any mark is read, because which row a mark belongs to is a
     * question about the whole set of rows and cannot be answered one row at
     * a time. A repeated node is drawn once more and stopped, or a cycle never
     * terminates — so the walk can run deeper than the rows go. */
    const drawn = [];
    (function walkNode(id, chain, depth, path, site) {
      const node = prog.nodes[id];
      if (!node) return;
      const repeat = path.includes(id);
      drawn.push({ id, node, chain, depth, site, repeat, entered: 0, returned: 0, effects: bare(), open: false, how: [] });
      if (repeat) return;
      for (const s of callSites(node)) {
        if (!prog.nodes[s.target]) continue;
        walkNode(s.target, chain.concat([`${id}#${s.at}`]), depth + 1, path.concat([id]), s);
      }
    })(prog.entry, ['@entry'], 0, [], null);

    const rowOf = new Map(drawn.map((r, i) => [chainKey(r.chain), i]));

    /* WHICH ROW SPEAKS FOR A CHAIN. Its own row where the tree draws one, and
     * otherwise the row whose chain is the longest prefix of it.
     *
     * For a tree with no repeat every chain has a row and the rule never
     * fires. It fires under recursion, where the walk runs below the last row
     * drawn: those frames' marks land on the repeat row, which is where the
     * tree stopped. Dropping them instead would lose them from every view at
     * once, the drawing having no way to show a cycle at all (#88).
     *
     * A chain under a callee the file never defines lands the same way, on the
     * nearest drawn ancestor, because the tree skips a call to a node it has
     * no definition for. */
    const speaksFor = chain => {
      for (let n = chain.length; n > 0; n -= 1) {
        const i = rowOf.get(chainKey(chain.slice(0, n)));
        if (i !== undefined) return i;
      }
      return undefined;
    };

    /* Every signal a row carries, gathered onto the row that speaks for it.
     * One pass per source, so a chain is attributed once and the four signals
     * cannot disagree about which row it belongs to. */
    for (const key of Object.keys(end.sites)) {
      const i = speaksFor(chainLinks(key));
      if (i === undefined) continue;
      drawn[i].entered += end.sites[key].entered;
      drawn[i].returned += end.sites[key].returned;
      /* A FAILURE IS NEVER OVERWRITTEN BY A SUCCESS. Where several chains land
       * on one row — a recursion running below the drawn rows — two frames can
       * mark the same step with different outcomes, and the row has one mark to
       * show for both. Taking the last one written would take the deepest
       * frame, which is an accident of the order the fold entered them: the row
       * would report a clean record beside its own thrown stripe and contradict
       * itself on one line. The failure is the half a reader must not lose. */
      for (const at of Object.keys(end.sites[key].effects)) {
        if (drawn[i].effects[at] === 'threw') continue;
        drawn[i].effects[at] = end.sites[key].effects[at];
      }
    }
    for (const f of end.frames) {
      const i = speaksFor(f.chain);
      if (i !== undefined) drawn[i].open = true;
    }

    /* WHICH open frame is the one running. `state` already says `running` or
     * `waiting` for every open row, and `top` is kept alongside it rather than
     * folded away: `state` is what --text prints and what the checks read,
     * and a page-only signal has no business changing what they see. The page
     * spends `top` on rule weight — the running frame keeps full ink, the ones
     * waiting under it take the system's state rule.
     *
     * Read through `speaksFor` like every other signal. Where a recursion runs
     * below the drawn rows that makes the repeat row the row the walk is in,
     * which is the honest answer: the walk is somewhere inside that subtree,
     * and the repeat row is the row that speaks for it. Two open frames can
     * land on one row that way, and it is still one row. */
    const topRow = end.frames.length ? speaksFor(end.frames[end.frames.length - 1].chain) : undefined;

    /* Where each row stands on the error path at the cursor: thrown, propagated,
     * caught. A second signal beside `state` and not a fourth value of it,
     * because a row can be running or waiting and on the path at once — the
     * frame that catches is still open.
     *
     * Matched by the chain each entry carries, never by its node. A node called
     * from three sites is three rows, and at most one of them is the frame the
     * error crossed; a node whose CALLER is drawn twice is two rows, and the
     * same holds. The chain tells both apart, which `caller#step` could not.
     *
     * The frame an error starts in is on the fold's path twice — it threw,
     * then it unwound — and only the first is a position. The row where the
     * error started says so; `propagated` is for the frames it crossed. A
     * frame that throws and catches its own error says both, in path order.
     *
     * The entry for an error reaching the top names no chain, so it matches no
     * row and makes none. Nor do the frames still open when it gets there:
     * nothing unwound them, so the fold did not put them on the path. */
    for (const e of end.errorPath) {
      if (e.chain === undefined) continue;
      const i = speaksFor(e.chain);
      if (i === undefined) continue;
      if (!drawn[i].how.includes(e.how)) drawn[i].how.push(e.how);
    }
    const errorOf = r => {
      const how = r.how;
      if (!how.length) return null;
      const started = how.some(h => ERROR_POSITION[h] === 'thrown');
      return { how: started ? how.filter(h => h !== 'propagated') : how.slice(), tag: end.errorPath[0].tag };
    };

    /* WHERE THE FRAME ENDED UP — one word, for a mark that can only be one
     * thing: a stripe down a row's edge, a glyph before its name. `error.how`
     * can hold two, and a frame that throws and then catches its own error is
     * both; the last is where it came to rest, and the rail still lists the
     * whole path in order.
     *
     * Read from `error.how` and never from `end.errorPath` directly. The fold
     * puts the frame that started an error on the path twice — thrown, then
     * propagated as it unwinds — so the last RAW entry for that row says
     * "propagated" and the row that threw would lose its mark. `errorOf`
     * has already dropped that second entry, which is the whole reason it
     * filters. */
    const pathOf = error => (error ? error.how[error.how.length - 1] : null);

    return drawn.map((r, i) => {
      const ch = r.node.channels || {};
      const rename = layer && layer.nodes && layer.nodes[r.id] ? layer.nodes[r.id].requirements : null;
      const error = errorOf(r);
      const reached = r.entered > 0;
      return {
        depth: r.depth,
        id: r.id,
        name: r.node.name,
        role: r.node.role,
        success: ch.success,
        error: (ch.error || []).slice(),
        kinds: (ch.error || []).reduce((m, t) => (kinds[t] ? ((m[t] = kinds[t].slice()), m) : m), bare()),
        requirements: (ch.requirements || []).slice(),
        rename: rename ? rename.slice() : null,
        site: r.site ? { label: r.site.label, aside: r.site.aside } : null,
        state: !reached ? 'not called' : r.open ? (i === topRow ? 'running' : 'waiting') : 'returned',
        top: i === topRow,
        errorPath: error,
        path: pathOf(error),
        effects: effectsOf(r.node).map(e => ({
          kind: e.kind,
          desc: e.desc,
          mark: (reached && r.effects[`${r.id}[${e.at}]`]) || 'not called',
        })),
        repeat: r.repeat,
      };
    });
  }

  /** Files in the change that no node touches, in the order the change states
   *  them. A question about the whole file, not about one node, and this is
   *  the change-wide answer: `--check` reports it as a finding, so a file one
   *  graph covers is not reported because another does not.
   *
   *  The files tab asks a narrower question with the same words — see
   *  `filesOf`. Read `ids` to choose which: every node of the change here, one
   *  sheet's nodes there. */
  function unaccountedFiles(prog, ids) {
    const nodes = ids || Object.keys(prog.nodes);
    const touched = new Set();
    for (const id of nodes) for (const p of prog.nodes[id].touches || []) touched.add(p);
    return (prog.files || []).filter(f => !touched.has(f.path)).map(f => f.path);
  }

  /** The three groups the files tab shows around one open node: what it
   *  changes, what the other nodes *on this sheet* change, and what the change
   *  touches that no node *of this sheet* accounts for. A file two nodes touch
   *  is listed against both.
   *
   *  **All three are the sheet's**, and that is what makes them cover: every
   *  file the change states is in at least one of them, so a reader on this
   *  sheet is never left wondering where a path went. Narrow the second group
   *  without narrowing the third and they stop covering: a file only the other
   *  sheet's nodes touch is in neither, and no group's label says so.
   *
   *  Cover, not partition. The third group is disjoint from the other two — it
   *  is the files no node here touches — but the first two overlap on purpose,
   *  because a file the open node and a neighbour both change is a fact about
   *  both of them and the tab says so twice rather than picking a winner.
   *
   *  That is the spec's own pairing rather than a choice made here. Its story
   *  28 wants this group *labelled as this sheet's, so that I do not take a
   *  per-sheet list for the change-wide one*, and its story 29 wants the
   *  change-wide one from `--check`. Two questions, two answers, and both
   *  printed — the tab's here, the check's from `unaccountedFiles` with no
   *  `ids`. On a one-graph file they are the same set, which is why the three
   *  shipped examples read exactly as they did.
   *
   *  Which means this takes the **view**, not the file. Handed the file,
   *  `prog.entry` is undefined, the reachable set is empty, and the tab would
   *  put every file in the third group under a label saying no node touches
   *  them. It throws instead. */
  function filesOf(prog, id) {
    if (!prog.entry) {
      throw new Error('filesOf needs a graph view: a file lists graphs and has no entry of its own');
    }
    /* No guard on the node itself. `id` is the open node, which starts at the
       entry and only ever moves to a node the walk is in, and the validator
       requires both to be in the map. A guard here could not fire today, and
       the day it could is the day an empty first group would be a wrong answer
       printed in place of a crash. `touches` is optional, so that one stays. */
    const onSheet = [...reachable(prog, prog.entry)];
    const mine = [...new Set(prog.nodes[id].touches || [])];
    const others = [];
    const seen = new Set();
    for (const k of onSheet) {
      if (k === id) continue;
      for (const p of prog.nodes[k].touches || []) if (!seen.has(p)) { seen.add(p); others.push(p); }
    }
    return { mine, others, unaccounted: unaccountedFiles(prog, onSheet) };
  }

  /** Paths as a shallow directory tree, flattened to rows the caller indents.
   *
   *  A row is a directory when it carries no `path` and a file when it does.
   *  `label` is what prints; joined to the labels of its ancestors it is the
   *  path again, which is the invariant that keeps a collapsed row honest.
   *
   *  A directory with one thing under it says nothing its child does not say,
   *  so it collapses into the line below. Order is first appearance, because
   *  the author ordered the change's files and a tree should keep what of that
   *  order it can. */
  function fileTree(paths) {
    const root = { kids: new Map(), file: null };
    for (const p of paths || []) {
      const path = String(p);
      let at = root;
      for (const seg of path.split('/')) {
        if (!at.kids.has(seg)) at.kids.set(seg, { kids: new Map(), file: null });
        at = at.kids.get(seg);
      }
      at.file = path;
    }
    const rows = [];
    (function walk(node, depth) {
      for (const [seg, kid] of node.kids) {
        const parts = [seg];
        let cur = kid;
        while (!cur.file && cur.kids.size === 1) {
          const [s, k] = cur.kids.entries().next().value;
          parts.push(s);
          cur = k;
        }
        const label = parts.join('/');
        rows.push(cur.file ? { depth, label, path: cur.file } : { depth, label });
        if (cur.kids.size) walk(cur, depth + 1);
      }
    })(root, 0);
    return rows;
  }

  /** The files tab, as markup.
   *
   *  Everything else here returns data and leaves the markup to the page. This
   *  one does not, and the reason is the seam. The tab is written into the
   *  cutaway with `innerHTML` when a reader clicks it, so it is in no rendered
   *  page as a string: markup left in the template is markup no test can reach,
   *  and three of the strings below carry author text through `esc`. Put it
   *  here and the page and the test run the same function, which is the same
   *  bargain the fold makes.
   *
   *  The marks are a closed vocabulary the validator already refuses anything
   *  outside of. Nothing else on a row is. */
  const MARK = Object.freeze({ new: 'new', edit: 'modified', delete: 'deleted', forbidden: 'forbidden' });
  function filesMarkup(prog, id) {
    const { mine, others } = filesOf(prog, id);
    /* Keyed by author text, so it does not read through to Object's own
       properties: a path called "constructor" would otherwise find a function
       and print it. */
    const byPath = Object.create(null);
    for (const f of prog.files || []) byPath[f.path] = f;
    /* A path a node touches that the change does not state has no entry to
       read, so it prints as an edit of no stated size rather than not at all. */
    const fileRow = row => {
      const f = byPath[row.path] || { change: 'edit', why: '', adds: 0, dels: 0 };
      return (
        '<div class="frow">' +
        '<span class="fnum"><span class="fadd">+' + esc(f.adds) + '</span> <span class="fdel">&minus;' + esc(f.dels) + '</span></span>' +
        '<span class="fpath">' + esc(row.label) +
        (f.why ? ' <span class="fwhy">&mdash; ' + esc(f.why) + '</span>' : '') + '</span>' +
        '<span class="fchange av-label">' + (Object.hasOwn(MARK, f.change) ? MARK[f.change] : '?') + '</span></div>'
      );
    };
    const tree = paths => {
      let out = '';
      let depth = 0;
      for (const row of fileTree(paths)) {
        while (depth > row.depth) { out += '</div>'; depth--; }
        while (depth < row.depth) { out += '<div class="ftree">'; depth++; }
        out += row.path ? fileRow(row) : '<div class="fdir">' + esc(row.label) + '/</div>';
      }
      while (depth > 0) { out += '</div>'; depth--; }
      return out;
    };
    const group = (label, paths) =>
      '<div class="fgroup"><span class="av-label">' + label + '</span>' +
      (paths.length ? tree(paths) : '<div class="av-annot">none</div>') + '</div>';
    /* The third group is EVERY file in the change, not the remainder no node
       accounts for. The first two groups omit each other's files, so a reader
       looking at one node could not see where its file sat in the whole
       change — which is the question the third list is opened to answer. It
       repeats paths from the groups above on purpose: this is the index, and
       an index that skipped what you had already seen would not be one.
       `filesOf().unaccounted` is unchanged and still drives the checker's
       "no node accounts for" finding; only what this tab draws moved.

       A file that states no changed files has nothing to index, so the group
       says that rather than drawing an empty tree. */
    const third = prog.files
      ? group('every file in the change', (prog.files || []).map(f => f.path))
      : '<div class="fgroup"><span class="av-label">changed files</span><div class="av-annot">not stated by this file</div></div>';
    return group('this node', mine) + group('other nodes on this sheet', others) + third;
  }

  /** The band under the drawing, as markup.
   *
   *  Here rather than in the page for the reason `filesMarkup` is: it is
   *  written into the footer with `innerHTML`, so it is in no rendered page as
   *  a string and no test could otherwise read a word of it. It carries four
   *  author strings through `esc`, and it is where the cut is audited — which
   *  makes it exactly the wrong thing to leave untested.
   *
   *  Three of the four facts are the change's and are stated once, at the
   *  level the cut was made. `graphsNotDrawn` means *found, and in no sheet of
   *  this file*, so a sibling sheet is never listed there — a graph the file
   *  carries is drawn. The fourth is the sheet's: the graph's own blurb, which
   *  is what this entry point does, and the only place a graph's `blurb` is
   *  printed at all. */
  function sheetFactsMarkup(prog) {
    const bits = ['<span><b>blurb</b> ' + esc(prog.blurb) + '</span>'];
    const graph = prog.graph || {};
    if (graph.blurb) bits.push('<span><b>this sheet</b> ' + esc(graph.blurb) + '</span>');
    const sheet = prog.sheet || {};
    if (sheet.scopeRule) bits.push('<span><b>scope rule</b> ' + esc(sheet.scopeRule) + '</span>');
    if ((sheet.graphsNotDrawn || []).length) {
      bits.push('<span><b>not drawn</b> ' + esc(sheet.graphsNotDrawn.join(', ')) + '</span>');
    }
    return bits.join('');
  }

  /** The longest trace. It is the only rule that names exactly one run in all
   *  three worked programs with no tie, so it is the one the text suggests. */
  function suggestRun(prog) {
    let best = 0;
    prog.presets.forEach((p, i) => {
      if (p.trace.steps.length > prog.presets[best].trace.steps.length) best = i;
    });
    return best;
  }

  return { esc, ID, bare, hardenKeys, KINDS, ERROR_POSITION, graphView, sheetState, sheetPickerMarkup, sheetFactsMarkup, reachable, labelsOf, callSites, calleesOf, effectsOf, failureKinds, tagFate, complexityOf, fold, back, tipAt, cutEdges, layout, wireLive, wireFlow, countMark, callCounts, treeRows, unaccountedFiles, filesOf, fileTree, filesMarkup, suggestRun, renamedToken };
})();
if (typeof module !== 'undefined') module.exports = Groundtrack;
