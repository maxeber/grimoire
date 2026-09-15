# groundtrack programming vocabulary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace groundtrack's invented programming words with the words a programmer already knows, in the flightpath file, the validator, the page, the text output and the prose.

**Architecture:** Five tasks, each one commit, each leaving `node scripts/check.mjs` green. Task 1 renames the file format and every place that reads it, and bumps the version for the break; the words a reader sees stay as they are. Task 2 adds the validator checks that give `fail` and `die` their meaning. Task 3 renames the words the page and `--text` print. Task 4 brings the prose into line. Task 5 renders the examples and looks at the page.

**Tech Stack:** Node 20+, built-in modules only, `node --test`. No dependencies — `scripts/check.mjs` fails on one.

**Spec:** [mephistopheles4/grimoire#90](https://github.com/mephistopheles4/grimoire/issues/90) — the issue body is the inventory; [the direction comment](https://github.com/mephistopheles4/grimoire/issues/90#issuecomment-5672108134) is the decision. This plan supersedes the comment in three places, all agreed after it was posted: the three "still to settle" renames are settled (`walk` → `trace`, `let` → `var`, `note` → `comment`); the contract prints no `Effect<…>` type string (ADR 0001); and the raise/throw glyph distinction goes with the word.

## Global Constraints

- **Where a word comes from:** C# and Java runtime words; JavaScript's word when they disagree; plain English when none has one. The contract's three parts are `success`, `error`, `requirements`.
- **ADR 0001 stands.** No file under `skills/` names a language, a library or a tool as the source of a word. Never write `Effect`, `C#`, `Java`, `JavaScript`, `RxJS` or `Effect<…>` under `skills/`. The words themselves are ordinary vocabulary and pass.
- **Aviation and drafting words stay:** sheet, rail, cutaway, drawing, tree, title block, trace band, layer, cut, hold.
- **Breaking the file format is allowed.** Nothing reads the old shape after Task 1. No compatibility shim, no migration message.
- **`effect` stays its own step.** Showing side effects is a main point of the tool. Never fold it into `call`.
- **Zero dependencies.** Node built-ins only.
- **Never commit a fixture.** Derive from a shipped example and write to a temporary directory, as `tests/groundtrack-render.test.mjs` already does.
- **Every code fence in a markdown file declares a language.** `node scripts/check.mjs` fails otherwise. Use `text` for plain blocks.
- **groundtrack's prose is controlled English:** active voice, present tense, one instruction per sentence, twenty words or fewer.
- **Format changes land together.** The validator, `references/flightpath-file.md` and `tests/groundtrack-render.test.mjs` change in the same commit.
- **Run `git fetch origin` before `node scripts/check.mjs`.** The version gate compares against the `origin/main` on disk.
- **Shell:** the maintainer's machine is Windows. Commands below are plain `node` and `git`, which run the same in PowerShell.

## The vocabulary

This table is the contract every task reads. A task implements a row; it does not reinterpret it.

### File format (Task 1)

| Now | New |
| --- | --- |
| `nodes.<id>.channels.A` / `.E` / `.R` | `.success` / `.error` / `.requirements` |
| `layers.<l>.nodes.<id>.R` | `layers.<l>.nodes.<id>.requirements` |
| `channel` on a `throw` step, a `throw` move, a `raised` object, an `uncaught` move | `cause` |
| `channel` values `retry`, `escape` | `cause` value `fail` |
| `channel` value `die` | `cause` value `die` |
| step `{ "op": "let", … }` | `{ "op": "var", … }` — fields `name`, `expr` unchanged |
| step `{ "op": "note", "note": "…" }` | `{ "op": "comment", "comment": "…" }` |
| move `k` `let` / `note` | `var` / `comment` |
| move `k` `handled` | `catch` |
| move `k` `unwind` | `propagate` |
| move `k` `done`, `uncaught` | unchanged |
| run field `walk` (`presets[i].walk`) | `trace` — its `provenance` and `steps` unchanged |

### Validator meaning (Task 2)

- A `throw` step whose `cause` is `fail` names a tag its node's `error` list names. Refused otherwise.
- A `throw` step whose `cause` is `die` names a tag its node's `error` list does not name. Refused otherwise.
- In a trace, a `fail` error that leaves a frame — by `propagate`, or still open when `uncaught` arrives — leaves a node whose `error` list names it. Refused otherwise.
- In a trace, a `die` error that leaves a frame leaves a node whose `error` list does not name it. Refused otherwise.
- An `onError` handler for a tag the file gives the cause `die` is a finding, not a refusal.

### Reader-facing words (Task 3)

| Where | Now | New |
| --- | --- | --- |
| tree row `state`, `--text` | `not reached` | `not called` |
| tree row `state`, `--text` | `on stack` | `running` (the frame the trace is in) or `waiting` (open under it) |
| drawing chip | `on stack` / `waiting` / `returned` | `running` / `waiting` / `returned` |
| error path (fold `how`) | `raised`, `thrown` | `thrown` |
| error path (fold `how`) | `passed through` | `propagated` |
| error path (fold `how`) | `caught`, `reached the top uncaught` | unchanged |
| effect outcome and marks | `landed` / `failed` / `not reached` | `returned` / `threw` / `not called` |
| ledger line | `raised <tag> — <message>` | `threw <tag> — <message>` |
| tag kind beside a tag | `retry` / `escape` / `die` | `fail` / `die` (data change from Task 1; wording of help text here) |
| channel labels (drawing, tree, `--text`) | `A` / `E` / `R` | `success` / `error` / `requirements` |
| contract rows | `A — returns` / `E — breaks` / `R — needs` | `success` / `error` / `requirements` |
| rail block | `inputs` | `arguments` |
| rail empty error path | `nothing has raised` | `nothing has thrown` |
| title block cell | `walk` | `trace` |
| `--text` layer line | `R under <layer>:` | `requirements under <layer>:` |

**Decided, not open:** the tree's four states become `not called`, `running`, `waiting`, `returned`. The `top` boolean stays on the row. The fourth exit state for a frame that left by throwing is #83's, and #83 uses the word `threw`. This plan does not add it.

**Decided, not open:** the page draws one glyph, `◆`, for `thrown`. The hollow `◇` for a hand-written throw goes, because the word it distinguished goes.

**Accepted collision:** the page already has a trace band (`.trace`, `.traceband`, `#traceSpan`, `#traceVal`) under the drawing. It prints no word — its help text is "Drag or click to move the cursor" — so the collision is in class names only. The field takes `trace` and the band keeps its classes.

---

### Task 1: Rename the file format

Every reader of the file changes here. No word a reader sees changes: labels still print `A`, `E`, `R`, `retry`-era help text stays until Task 3, except that tag kinds now print `fail` or `die` because the data changed.

**Files:**
- Modify: `skills/groundtrack/scripts/render.mjs` (constants 30–71, `shape` 190–280, `path` 289–479, `findings` 523–561, `text` 583–641)
- Modify: `skills/groundtrack/scripts/groundtrack.js` (`sheetState` ~166, `KINDS` and `failureKinds` 255–308, `fold` 356–517, `cutEdges` ~569, `layout` ~692, `treeRows` 879–906, `suggestRun` ~1105)
- Modify: `skills/groundtrack/assets/template.html` (script 749 onward: `holdToGraph`, `rOf`, `nodeBox`, `drawTree`, `drawErrPath`, `drawSource`, `drawContract`, `drawTitleBlock`, the play loop ~1346, `useSheet` callers ~1470)
- Modify: `skills/groundtrack/examples/greet.flightpath.json`, `map-300-woodwork.flightpath.json`, `pr-313.flightpath.json`
- Modify: `skills/groundtrack/references/flightpath-file.md`
- Test: `tests/groundtrack-render.test.mjs`, `tests/groundtrack-fold.test.mjs`, `tests/helpers.mjs`

**Interfaces:**
- Produces: `Groundtrack.KINDS` is `['fail', 'die']`. `failureKinds(prog)` reads `step.cause` and `move.raised.cause`, and reads runs through `preset.trace`. Fold error-path entries carry `cause` instead of `channel`. `treeRows` rows carry `success`, `error`, `requirements` instead of `A`, `E`, `R`; `kinds`, `rename`, `state`, `top`, `error`, `path`, `effects` are unchanged. `render.mjs`'s `path()` keeps a `raised` object `{ tag, from }` (Task 2 adds `cause`).

- [ ] **Step 1: Write the example migration script to the scratchpad**

This is a one-off. Do not commit it. The examples are `JSON.stringify(…, null, 2)` output with a trailing newline, so a structural rewrite keeps the diff to the renamed lines.

```js
// migrate-examples.mjs — run once against skills/groundtrack/examples
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const CAUSE = { retry: 'fail', escape: 'fail', die: 'die' };
const MOVE = { let: 'var', note: 'comment', handled: 'catch', unwind: 'propagate' };
const rename = (obj, map) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [map[k] || k, v]));
const withCause = o => rename({ ...o, channel: CAUSE[o.channel] }, { channel: 'cause' });

function migrate(p) {
  for (const n of Object.values(p.nodes)) {
    if (n.channels) n.channels = rename(n.channels, { A: 'success', E: 'error', R: 'requirements' });
    n.steps = (n.steps || []).map(s => {
      if (s.op === 'throw') return withCause(s);
      if (s.op === 'note') return rename({ ...s, op: 'comment' }, { note: 'comment' });
      if (s.op === 'let') return { ...s, op: 'var' };
      return s;
    });
  }
  for (const layer of Object.values(p.layers || {})) {
    for (const id of Object.keys(layer.nodes || {})) layer.nodes[id] = rename(layer.nodes[id], { R: 'requirements' });
  }
  for (const g of p.graphs) {
    g.presets = g.presets.map(r => {
      const run = rename(r, { walk: 'trace' });
      run.trace.steps = run.trace.steps.map(m => {
        let x = MOVE[m.k] ? { ...m, k: MOVE[m.k] } : m;
        if (x.channel !== undefined) x = withCause(x);
        if (x.raised) x = { ...x, raised: withCause(x.raised) };
        return x;
      });
      return run;
    });
  }
  return p;
}

const dir = process.argv[2];
for (const f of readdirSync(dir).filter(x => x.endsWith('.flightpath.json'))) {
  const file = join(dir, f);
  const out = JSON.stringify(migrate(JSON.parse(readFileSync(file, 'utf8'))), null, 2) + '\n';
  if (/"(A|E|R|channel|walk)":|"(retry|escape)"|"k": "(let|note|handled|unwind)"|"op": "(let|note)"/.test(out)) {
    throw new Error(`${f}: an old key survived the migration`);
  }
  writeFileSync(file, out);
  console.log('migrated', f);
}
```

- [ ] **Step 2: Run it**

Run: `node <scratchpad>/migrate-examples.mjs skills/groundtrack/examples`
Expected: three `migrated` lines. `git diff --stat skills/groundtrack/examples` shows only small, balanced line counts. A large count means formatting changed; stop and investigate.

- [ ] **Step 3: Write the test migration script to the scratchpad and run it**

The test files build fixtures as JavaScript objects and assert on validator messages. This rewrites the file-format words and the validator messages that Task 1 changes. It does not touch reader-facing words — those are Task 3.

```js
// migrate-tests.mjs — run once against the three groundtrack test files
import { readFileSync, writeFileSync } from 'node:fs';

const KEY = { A: 'success', E: 'error', R: 'requirements' };
const RULES = [
  // channel keys, inside a channels literal and on access
  [/channels:\s*\{[^{}]*\}/g, blk => blk.replace(/\b([AER]):/g, (_, k) => `${KEY[k]}:`)],
  [/\{\s*R:\s*\[/g, '{ requirements: ['],
  [/\.([AER])\b(?!\w)/g, (_, k) => `.${KEY[k]}`],
  // cause
  [/\bchannel:\s*'(retry|escape)'/g, "cause: 'fail'"],
  [/\bchannel:\s*'die'/g, "cause: 'die'"],
  [/\.channel\b/g, '.cause'],
  [/\bchannel:/g, 'cause:'],
  [/'(retry|escape)'/g, "'fail'"],
  [/\bretry die\b/g, 'fail die'],
  // ops and moves
  [/op:\s*'note',\s*note:/g, "op: 'comment', comment:"],
  [/\b(k|op):\s*'note'/g, "$1: 'comment'"],
  [/\b(k|op):\s*'let'/g, "$1: 'var'"],
  [/k:\s*'handled'/g, "k: 'catch'"],
  [/k:\s*'unwind'/g, "k: 'propagate'"],
  [/=== 'note'/g, "=== 'comment'"],
  [/=== 'let'/g, "=== 'var'"],
  [/=== 'handled'/g, "=== 'catch'"],
  [/=== 'unwind'/g, "=== 'propagate'"],
  [/, 'handled'\)/g, ", 'catch')"],
  // the run's move list
  [/\.walk\b/g, '.trace'],
  [/\bwalk:\s*\{/g, 'trace: {'],
  // validator messages
  [/handled at /g, 'catch at '],
  [/handled goto/g, 'catch goto'],
  [/handled lands/g, 'catch lands'],
  [/unwind with no error/g, 'propagate with no error'],
  [/declares E tag/g, 'declares error tag'],
  [/raised channel/g, 'raised cause'],
  [/\bchannel "/g, 'cause "'],
  [/a walk with no moves/g, 'a trace with no moves'],
  [/at the end of the walk/g, 'at the end of the trace'],
  [/the walk ended/g, 'the trace ended'],
  // nodeBox must not read the tree row's error path. `ch.error` is now a
  // channel read, so the guard names the row's error path instead.
  [/\/\\\.error\\b\|tr-err\|tr-gl\//g, '/row\\.error\\b|\\.error\\.how|tr-err|tr-gl/'],
];

for (const file of process.argv.slice(2)) {
  let text = readFileSync(file, 'utf8');
  for (const [re, to] of RULES) text = text.replace(re, to);
  writeFileSync(file, text);
  console.log('migrated', file);
}
```

Run: `node <scratchpad>/migrate-tests.mjs tests/helpers.mjs tests/groundtrack-render.test.mjs tests/groundtrack-fold.test.mjs`

Then gate on survivors. Every hit must be either a reader-facing word (left for Task 3) or English prose in a comment or test name. Fix any other hit by hand.

Run: `git grep -nE "\b(retry|escape)\b|\bchannel\b|'(handled|unwind)'|op: '(let|note)'|k: '(let|note)'|\.walk\b|\b[AER]:" -- tests/helpers.mjs tests/groundtrack-render.test.mjs tests/groundtrack-fold.test.mjs`
Expected: no hit that names a file key, a move kind, or an op.

The `'(retry|escape)'` rule can turn a three-kind list into a duplicate. Check for it.

Run: `git grep -n "'fail', 'fail'" -- tests`
Expected: no output. Fix any hit to the two-cause list `['fail', 'die']`, or to the single cause the assertion means.

Confirm the guard in the nodeBox assertion was rewritten:

Run: `git grep -n "doesNotMatch(box" -- tests/groundtrack-render.test.mjs`
Expected: the pattern reads `/row\.error\b|\.error\.how|tr-err|tr-gl/`.

- [ ] **Step 4: Run the suite to see it fail**

Run: `node --test tests/groundtrack-fold.test.mjs tests/groundtrack-render.test.mjs`
Expected: FAIL. The examples and tests speak the new format; the validator refuses it with `unknown key "success"`, `op "var" is not one of …`, `k "catch" is not a move kind`, `unknown key "trace"`.

- [ ] **Step 5: Rename the validator's constants**

In `skills/groundtrack/scripts/render.mjs`, replace the constant block with:

```js
const PRESET = ['name', 'blurb', 'input', 'trace'];
const CHANGE = ['new', 'edit', 'delete', 'forbidden'];
const CAUSE = Groundtrack.KINDS;

const STEP = {
  comment: { req: ['comment'], opt: [] },
  var: { req: ['name', 'expr'], opt: [] },
  if: { req: ['cond', 'then', 'else'], opt: [] },
  goto: { req: ['to'], opt: [] },
  call: { req: ['target'], opt: ['args', 'bind', 'onError'] },
  effect: { req: ['kind', 'desc'], opt: ['args', 'bind', 'onError'] },
  throw: { req: ['tag', 'message', 'cause'], opt: [] },
  return: { req: ['expr'], opt: [] },
};

const MOVE = {
  comment: { req: ['at', 'next'], opt: [] },
  var: { req: ['at', 'next'], opt: [] },
  if: { req: ['at', 'next'], opt: [] },
  goto: { req: ['at', 'next'], opt: [] },
  call: { req: ['at', 'to', 'next'], opt: [] },
  effect: { req: ['at', 'kind', 'desc'], opt: ['next', 'raised', 'result', 'attempt'] },
  throw: { req: ['at', 'tag', 'message', 'cause'], opt: [] },
  return: { req: ['at'], opt: ['value'] },
  catch: { req: ['at', 'goto', 'next'], opt: [] },
  propagate: { req: [], opt: [] },
  done: { req: [], opt: ['result'] },
  uncaught: { req: ['tag', 'message', 'cause'], opt: [] },
};

const OP_MOVES = new Set(['comment', 'var', 'if', 'goto', 'call', 'effect', 'throw', 'return']);
```

Replace every other use of `CHANNEL` with `CAUSE`.

- [ ] **Step 6: Rename the validator's readers**

In `shape`:

```js
    if (n.channels !== undefined) {
      keys(r, `nodes.${id}.channels`, n.channels, ['success', 'error', 'requirements']);
      if (isObj(n.channels)) {
        if (n.channels.error !== undefined && !Array.isArray(n.channels.error)) r.shape(`nodes.${id}.channels.error`, 'expected an array of failure tags');
        if (n.channels.requirements !== undefined && !Array.isArray(n.channels.requirements)) r.shape(`nodes.${id}.channels.requirements`, 'expected an array of tokens');
        if (n.channels.success !== undefined && typeof n.channels.success !== 'string') r.shape(`nodes.${id}.channels.success`, 'expected a string');
      }
    }
```

```js
      if (s.op === 'throw' && !CAUSE.includes(s.cause)) r.shape(w, `cause "${s.cause}" is not one of ${CAUSE.join(', ')}`);
```

The layer override key check (line ~183) becomes `keys(r, \`layers.${ln}.nodes.${nid}\`, ov, ['requirements']);`, and any read of `ov.R` in that block becomes `ov.requirements`.

The preset block:

```js
      if (!isObj(p) || !isObj(p.trace)) return;
      keys(r, `graphs[${gi}].presets[${i}].trace`, p.trace, ['provenance', 'steps']);
      if (!['authored', 'captured'].includes(p.trace.provenance))
        r.shape(`graphs[${gi}].presets[${i}].trace.provenance`, `"${p.trace.provenance}" is not authored or captured`);
      if (!Array.isArray(p.trace.steps)) return r.shape(`graphs[${gi}].presets[${i}].trace.steps`, 'expected an array');
      if (!p.trace.steps.length) r.shape(`graphs[${gi}].presets[${i}].trace.steps`, 'a trace with no moves shows nothing');
      p.trace.steps.forEach((m, j) => {
        const w = `graphs[${gi}].presets[${i}].trace.steps[${j}]`;
```

In `path`:

```js
  const { trace: walk, name: runName } = graph.presets[pi];
```

```js
  const pathAt = i => (i >= walk.steps.length ? `${base}.trace` : `${base}.trace.steps[${i}]`);
  const wordsAt = i => (i >= walk.steps.length ? `${where}, at the end of the trace` : `${where}, move ${i}`);
```

Rename the frame moves. `m.k === 'unwind'` becomes `m.k === 'propagate'`, with the message `'propagate with no error travelling — a frame is popped by a return unless something threw'` and `noteEmpty(i, 'propagate')`. `case 'note': case 'let':` becomes `case 'comment': case 'var':`. `case 'handled':` becomes `case 'catch':`, and every `m.k !== 'handled'` becomes `m.k !== 'catch'`. Each `handled at`, `handled goto`, `handled lands` message becomes `catch at`, `catch goto`, `catch lands`.

The raised block:

```js
          keys({ shape: (p, why) => r.walk(p, wordsAt(i), why) }, `${pathAt(i)}.raised`, m.raised, ['tag', 'message', 'cause']);
          if (isObj(m.raised) && !CAUSE.includes(m.raised.cause))
            bad(i, `raised cause "${m.raised.cause}" is not one of ${CAUSE.join(', ')}`);
```

The two end-of-tape messages become `the trace ended with ${frames.length} frame(s) still open` and `the trace ended while "${raised.tag}" was still travelling (raised at move ${raised.from}) — write the catch, or the uncaught that ends it`.

In `findings`: `Groundtrack.fold(view, p.walk)` becomes `Groundtrack.fold(view, p.trace)`; `(n.channels || {}).E` becomes `(n.channels || {}).error`; the message becomes `` `${id} declares error tag "${tag}", and nothing beneath it produces that tag` ``.

In `text`: `run.walk` becomes `run.trace`; `p.walk.provenance` becomes `p.trace.provenance`; `row.A`, `row.E`, `row.R` become `row.success`, `row.error`, `row.requirements`; `ov.R` becomes `ov.requirements`. The printed labels stay `A`, `E`, `R` until Task 3.

- [ ] **Step 7: Rename the module's readers**

In `skills/groundtrack/scripts/groundtrack.js`:

```js
  /* -- the failure cause ---------------------------------------------------
   *
   * The two causes a failure can have, in the order they print. A fail is an
   * expected error a caller handles. A die is a defect, and never part of the
   * contract.
   */
  const KINDS = ['fail', 'die'];
```

In `failureKinds`, the reads become `add(s.tag, s.cause)`, `p.trace && p.trace.steps`, and `add(m.raised.tag, m.raised.cause)`. Rename the parameter `channel` inside `add` to `cause`. Update the doc comment's "Both name a channel" to "Both name a cause".

In `fold`:

```js
      if (m.k === 'propagate') {
        const gone = frames.pop();
        if (gone) {
          moved = { from: gone.nodeId, to: frames.length ? frames[frames.length - 1].nodeId : null, dir: 'propagate' };
          errorPath = errorPath.concat([{ nodeId: gone.nodeId, site: gone.site, chain: gone.chain.slice(), how: 'passed through' }]);
        }
```

```js
        errorPath = errorPath.concat([{ nodeId: null, how: 'reached the top uncaught', tag: m.tag, message: m.message, cause: m.cause }]);
```

`case 'note': case 'let':` becomes `case 'comment': case 'var':`. `case 'handled':` becomes `case 'catch':`. The two error-path entries for a raise and a throw carry `cause: m.raised.cause` and `cause: m.cause`.

Search the template for `dir === 'unwind'` and rename it with the module, since `moved.dir` is now `'propagate'`.

`sheetState` and `suggestRun` read `.trace` instead of `.walk`. `cutEdges` reads `ov.requirements`. `layout`'s `hasE` reads `.error`.

In `treeRows`, the row literal becomes:

```js
        success: ch.success,
        error: (ch.error || []).slice(),
        kinds: (ch.error || []).reduce((m, t) => (kinds[t] ? ((m[t] = kinds[t].slice()), m) : m), bare()),
        requirements: (ch.requirements || []).slice(),
```

and `layer.nodes[r.id].R` becomes `layer.nodes[r.id].requirements`.

- [ ] **Step 8: Rename the page's readers**

In `skills/groundtrack/assets/template.html`, change reads only — no printed word:

- `holdToGraph`: `p.walk.steps` → `p.trace.steps`; `m.k === 'unwind'` → `m.k === 'propagate'`.
- `rOf`: `ov.R` → `ov.requirements`; `.R` → `.requirements`.
- `nodeBox`: `ch.A` → `ch.success`; `ch.E` → `ch.error`. `channelKey('A')` and its siblings stay as they are.
- `drawTree`: `SHEET.presets[S.run].walk` → `.trace`; `row.E` → `row.error`; `row.R` → `row.requirements`; `row.A` → `row.success`.
- `drawErrPath`: `e.channel` → `e.cause`.
- `drawSource`: `s.op === 'note'` → `s.op === 'comment'` reading `s.comment`; `s.op === 'let'` → `s.op === 'var'`; the throw line reads `s.cause`. The printed keyword stays `let` until Task 3.
- `drawContract`: `ch.A` → `ch.success`; `ch.E` → `ch.error`.
- `drawTitleBlock`: `run.walk.provenance` → `run.trace.provenance`.
- The play loop: every `m.k === 'handled'`, `'unwind'`, `'note'`, `'let'` → the new kind.
- Every other `.walk` read → `.trace`.

Run: `git grep -nE "\.walk\b|\.channel\b|\.[AER]\b|\b[AER]:|'(handled|unwind|note|let)'" -- skills/groundtrack/assets/template.html skills/groundtrack/scripts`
Expected: the only hits are the display calls `channelKey('A')`, `channelKey('E')`, `channelKey('R')`, the `HELP` keys `A:`, `E:`, `R:`, the `A `/`E `/`R ` labels in `text`, and the printed `let` keyword in `drawSource` — all of which Task 3 renames. Any other hit is a reader this step missed, including in `back()`, `hardenKeys` or `sheetFactsMarkup`.

Nothing outside `skills/groundtrack` parses a flightpath file's keys: `scripts/` reads no `channels`, `presets` or `walk`. Confirm before committing.

Run: `git grep -nE "channels|presets|\.walk\b" -- scripts`
Expected: no output.

- [ ] **Step 9: Rewrite the reference tables**

In `skills/groundtrack/references/flightpath-file.md`, apply the file-format table above to:

- the node table (`channels` row) and the `### channels` section — three bullets `success`, `error`, `requirements`, with the existing meanings;
- the sentence under channels about kinds: "The tree, the text output and the contract tab each print `fail` or `die` beside a tag … A tag found with both prints both, fail before die.";
- the step table (`comment` with required `comment`; `var`; `throw` with `cause`) and "`channel` is one of" → "`cause` is `fail` or `die`";
- "**`note` is an op, and `aside` is the remark on any other step.**" → "**`comment` is an op, and `aside` is the remark on any other step.**";
- the run table (`trace`, linking `#the-trace`), `## The walk` → `## The trace`, the refusal example `graphs[1].presets[0].walk.steps[4]` → `.trace.steps[4]`, and the move tables (`comment`, `var`, `catch`, `propagate`, `cause` on `throw` and `uncaught` and inside `raised`);
- the worked tape;
- the layer example key `R` → `requirements` and "`nodes.<id>.R` renames" → "`nodes.<id>.requirements` renames";
- the findings bullet "An `E` channel declaring…" → "An `error` list declaring…".

Leave the new `cause` rules for Task 2.

- [ ] **Step 10: Run the suite**

Run: `node --test tests/groundtrack-fold.test.mjs tests/groundtrack-render.test.mjs`
Expected: PASS. A failure here is a reader the steps above missed — fix the reader, not the test. The one test Step 3 rewrote on purpose is the nodeBox guard; if it fails, compare it with the pattern Step 3 expects before touching the page.

- [ ] **Step 11: Bump the version**

The format break is the reason for the bump, so it lands with the break and every later commit runs the full check green.

Run: `git fetch origin` then `git show origin/main:.claude-plugin/plugin.json`
Set `version` in `.claude-plugin/plugin.json` one minor above what `origin/main` carries. From `0.18.1` that is `0.19.0`. It is minor, not patch, because old files stop validating.

- [ ] **Step 12: Run the whole check**

Run: `node scripts/check.mjs`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add skills/groundtrack tests .claude-plugin/plugin.json docs/superpowers/plans/2026-09-14-programming-vocabulary.md
git commit -m "Rename the flightpath format to the words a programmer uses (#90)"
```

---

### Task 2: Give `fail` and `die` their meaning

**Files:**
- Modify: `skills/groundtrack/scripts/render.mjs` (`shape` step loop, `path`, `findings`)
- Modify: `skills/groundtrack/examples/map-300-woodwork.flightpath.json`
- Modify: `skills/groundtrack/references/flightpath-file.md`
- Test: `tests/groundtrack-render.test.mjs`

**Interfaces:**
- Consumes: `CAUSE` (`['fail', 'die']`) and the `path()` `raised` object from Task 1; `Groundtrack.failureKinds(prog)` returning `tag -> ['fail'] | ['die'] | ['fail', 'die']`.
- Produces: `raised` in `path()` is `{ tag, from, cause }`.

- [ ] **Step 1: Write the five failing tests**

Add after the existing refusal tests in `tests/groundtrack-render.test.mjs`. In the greet example, `lookupName` step 3 throws `NoSuchUser`; run 1 is "no such user"; run 2 is "the post fails", whose move 9 is the `uncaught`.

```js
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test --test-name-pattern="a fail|a die|throws a|catching a die" tests/groundtrack-render.test.mjs`
Expected: FAIL — four report exit 0 where 1 was expected; the last reports no finding on stdout.

- [ ] **Step 3: Add the step check**

In `shape`, directly after the `cause "…" is not one of` line:

```js
      /* A fail is part of the node's contract, so its error list names it. A
       * die is a defect, so the list never does. */
      if (s.op === 'throw' && CAUSE.includes(s.cause) && isObj(n.channels)) {
        const listed = (n.channels.error || []).includes(s.tag);
        if (s.cause === 'fail' && !listed) r.shape(w, `throws "${s.tag}" as a fail, and ${id}'s error list does not name it`);
        if (s.cause === 'die' && listed) r.shape(w, `throws "${s.tag}" as a die, and ${id}'s error list names it — a die is never in the list`);
      }
```

- [ ] **Step 4: Add the trace check**

In `path`, below `let raised = null;`:

```js
  /* An error leaves a frame when it propagates out, or when it reaches the top
   * with the frame still open. The node it leaves states it in its error list
   * when it is a fail, and never when it is a die. */
  const leaves = (i, nodeId) => {
    if (!raised || !CAUSE.includes(raised.cause)) return;
    const listed = ((((prog.nodes[nodeId] || {}).channels) || {}).error || []).includes(raised.tag);
    if (raised.cause === 'fail' && !listed) bad(i, `"${raised.tag}" is a fail and leaves ${nodeId}, but ${nodeId}'s error list does not name it`);
    if (raised.cause === 'die' && listed) bad(i, `"${raised.tag}" is a die and leaves ${nodeId}, but ${nodeId}'s error list names it — a die is never in the list`);
  };
```

In the `propagate` branch, between the no-error check and `frames.pop()`:

```js
      leaves(i, frames[frames.length - 1].nodeId);
```

In the `uncaught` branch, before `raised = null;`:

```js
      for (const fr of frames) leaves(i, fr.nodeId);
```

Carry the cause when an error starts. The effect branch:

```js
          if (isObj(m.raised)) raised = { tag: m.raised.tag, from: i, cause: m.raised.cause };
```

The throw branch reads the step, because the step is where the file states it:

```js
        raised = { tag: m.tag, from: i, cause: st.op === 'throw' ? st.cause : m.cause };
```

- [ ] **Step 5: Add the finding**

In `findings`, before the unaccounted-files block:

```js
  /* A handler for a tag the file throws as a die. Legal — a defect can be
   * caught — and worth seeing, because a catch of a defect should be on
   * purpose. */
  const causes = Groundtrack.failureKinds(prog);
  for (const [id, n] of Object.entries(prog.nodes)) {
    (n.steps || []).forEach((s, at) => {
      for (const h of s.onError || []) {
        if ((causes[h.tag] || []).includes('die')) out.push(`${id}[${at}] catches "${h.tag}", which the file throws as a die`);
      }
    });
  }
```

- [ ] **Step 6: Run the new tests**

Run: `node --test --test-name-pattern="a fail|a die|throws a|catching a die" tests/groundtrack-render.test.mjs`
Expected: PASS.

- [ ] **Step 7: Run the full groundtrack suite**

Run: `node --test tests/groundtrack-fold.test.mjs tests/groundtrack-render.test.mjs`
Expected: one failure, "every shipped worked example validates", naming `map-300-woodwork.flightpath.json`. Its `map` node throws `FanOutRefused` and `ShippedAShimmer` as a die and lists both in its error list.

- [ ] **Step 8: Fix the example**

In `skills/groundtrack/examples/map-300-woodwork.flightpath.json`, set `nodes.map.channels.error` to `[]`. Both tags stay on their `throw` steps and `uncaught` moves as `die`.

Run: `node skills/groundtrack/scripts/render.mjs skills/groundtrack/examples/map-300-woodwork.flightpath.json --check`
Expected: exit 0. Read stdout: no new finding mentions `map`.

Run the same for `greet.flightpath.json` and `pr-313.flightpath.json`.
Expected: exit 0 for both, with no new refusal.

Run: `node scripts/check.mjs`
Expected: PASS.

- [ ] **Step 9: Document the rules**

In `skills/groundtrack/references/flightpath-file.md`, add under `### channels`:

```markdown
### fail and die

Every `throw` step, `raised` object and `uncaught` move carries a `cause`.

- **`fail` is an expected error.** A caller is meant to catch it.
- **`die` is a defect.** Nothing is meant to catch it.

**A fail is part of the contract, and a die never is.**

- A node that throws a fail names the tag in its `error` list.
- A node that throws a die does not name the tag there.
- A fail that leaves a node uncaught is in that node's `error` list.
- A die that leaves a node is not in that node's `error` list.

The validator refuses each break of these rules. A handler for a die is legal, and `--check` reports it as a finding.
```

Add to "What the validator proves" a bullet: "**A fail is in the error list of every node it leaves, and a die is in none.**" Add to "Findings" a bullet: "**A handler for a tag the file throws as a die.** Legal, and it should be on purpose."

Retries are not a cause. Add one sentence to the effect move row: "`attempt` counts the tries of an effect that ran more than once."

- [ ] **Step 10: Commit**

```bash
git add skills/groundtrack tests
git commit -m "Refuse a fail missing from the contract and a die inside it (#90)"
```

---

### Task 3: Print the words a programmer uses

**Files:**
- Modify: `skills/groundtrack/scripts/groundtrack.js` (`ERROR_POSITION` 717, `fold` 414–499, `treeRows` 819–906, `callCounts` comments)
- Modify: `skills/groundtrack/scripts/render.mjs` (`text` 583–641)
- Modify: `skills/groundtrack/assets/template.html` (markup 700–745, CSS, script)
- Test: `tests/groundtrack-fold.test.mjs`, `tests/groundtrack-render.test.mjs`

**Interfaces:**
- Consumes: row fields from Task 1.
- Produces: fold `how` is one of `thrown`, `propagated`, `caught`, `reached the top uncaught`. Effect outcome is `returned` or `threw`; a mark is also `not called`. Row `state` is `not called`, `running`, `waiting` or `returned`. `ERROR_POSITION` is `{ thrown: 'thrown', propagated: 'propagated', caught: 'caught' }`.

- [ ] **Step 1: Update the fold tests to the new words**

In `tests/groundtrack-fold.test.mjs`:

- `'landed'` → `'returned'` (lines ~482, 483, 493, 494, 836).
- `'failed'` → `'threw'` (lines ~502, 837, 864, 878, 890).
- `'not reached'` → `'not called'` (line ~643).
- In `how` lists and `path` values: `'raised'` and `'thrown'` → `'thrown'`; `'passed through'` → `'propagated'` (lines ~470, 526, 527, 536, 669, 672, 683, 685, 712, 729, 776, 778, 783, 815, 863, 889). Where a list held `['thrown', 'passed through']`, it becomes `['thrown', 'propagated']`.
- Replace the test at ~733 with:

```js
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
```

- Line ~794: `assert.equal(entry.state, 'running');`. Line ~822: `assert.equal(second.state, 'running');`.
- Update the test titles that quote the old words to the new ones: "thrown, passed through, or caught" → "thrown, propagated, or caught"; "not also that it passed through" → "not also that it propagated".

- [ ] **Step 2: Update the render tests to the new words**

In `tests/groundtrack-render.test.mjs`:

- Line ~688: `['', 'error path: propagated', '', 'error path: thrown StoreDown']`.
- Line ~706: `['error path: thrown SendFailed', '']`.
- Line ~662: `/SendFailed fail die/` (already migrated in Task 1; confirm).
- Lines ~764–765: `glyphs.length, 4` and `new Set(glyphs).size, 4`, with messages "a glyph per fold word, the top included".
- Lines ~776 and ~779–781: `tr--raised` → `tr--thrown` (the class is renamed in Step 5).
- Replace the test at ~797 with:

```js
test('the tree separates the running frame from the frames waiting under it', () => {
  const html = pageOf(exampleFlightpath);
  const tree = between(html, 'function drawTree(', '/* -- the rail');
  assert.match(tree, /row\.state === 'running'/, 'the running frame and the waiting ones part');
  assert.match(tree, /tr--waiting/, 'and the waiting ones have their own class');
  assert.match(html, /\.tr--waiting\b[^{]*\{[^}]*--av-state-rule/, 'waiting takes the system state rule');
  assert.match(html, /\.tr--active\b[^{]*\{[^}]*var\(--av-ink\)/, 'the running frame keeps full ink');
});
```

- Add a text test:

```js
test('the text names the contract in words, not letters', () => {
  const r = run(groundtrack, [exampleFlightpath, '--text']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /success a greeting line {3}error NoSuchUser fail · SendFailed fail {3}requirements the name store/);
  assert.doesNotMatch(r.stdout, /(^| {3})[AER] /m);
  assert.match(r.stdout, /requirements under tests: /);
});
```

- Add a page test:

```js
test('the page prints the programming words, and none of the old ones', () => {
  const html = pageOf(exampleFlightpath);
  for (const word of ['>running<', '>waiting<', '>arguments<', "'propagated'", "'not called'", "'returned'", "'threw'"]) {
    assert.ok(html.includes(word), `the page carries ${word}`);
  }
  for (const word of ['on stack', 'not reached', 'passed through', "'landed'", "'failed'", 'nothing has raised', '>inputs<', 'A — returns', 'E — breaks', 'R — needs']) {
    assert.ok(!html.includes(word), `the page no longer carries ${word}`);
  }
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `node --test tests/groundtrack-fold.test.mjs tests/groundtrack-render.test.mjs`
Expected: FAIL on the renamed words.

- [ ] **Step 4: Rename the module's words**

In `skills/groundtrack/scripts/groundtrack.js`:

```js
  const ERROR_POSITION = Object.freeze({ thrown: 'thrown', propagated: 'propagated', caught: 'caught' });
```

Rewrite its doc comment: "The three words the fold writes on the error path, each its own position. The tree, the text and the page all sort by this one table."

In `fold`: `how: 'passed through'` → `how: 'propagated'`; `how: 'raised'` → `how: 'thrown'`; `'failed' : 'landed'` → `'threw' : 'returned'`.

In `treeRows`:

```js
      const started = how.some(h => ERROR_POSITION[h] === 'thrown');
      return { how: started ? how.filter(h => h !== 'propagated') : how.slice(), tag: end.errorPath[0].tag };
```

```js
        if (drawn[i].effects[at] === 'threw') continue;
```

```js
        state: !reached ? 'not called' : r.open ? (i === topRow ? 'running' : 'waiting') : 'returned',
```

```js
          mark: (reached && r.effects[`${r.id}[${e.at}]`]) || 'not called',
```

Rewrite the `topRow` comment: `state` now says `running` or `waiting`; `top` stays as the boolean the page reads. Update every comment in this file that quotes `on stack`, `passed through`, `raised` as a path word, `landed` or `failed`.

- [ ] **Step 5: Rename the page's words**

In `skills/groundtrack/assets/template.html`:

Markup:
- line ~712: label `inputs` → `arguments`; help "The values this run started from. Read-only: the run was recorded under exactly these."
- line ~713: help "How far the current error has travelled: where it was thrown, which frames it propagated through, and where it was caught."
- line ~714: help "Every effect the run has run so far, in order, with what the author says it returned or threw."
- line ~707: help "When playing, stop on the next throw, the next effect that throws, or an error reaching the top uncaught."
- line ~726: help "What the node declares: what it takes, what it returns on success, the errors it can throw, and what it requires".

`HELP`:

```js
const HELP = {
  success: 'success — what this node returns.',
  error: 'error — the tags this node can throw as a fail. A die is a defect, and never listed here.',
  requirements: 'requirements — what this node needs to work. A layer can rename these.',
  role: 'What kind of thing this node is. The page prints it; nothing branches on it.',
  err: {
    thrown: 'Where the current error started: this call threw it.',
    propagated: 'The current error left this call without being caught, on its way up.',
    caught: 'A handler at this call caught the current error.',
  },
  authored: 'Written by hand from the material. A claim about the program, not a recording of it.',
  captured: 'Produced by a real run.',
  paths: 'Cyclomatic complexity of the node as drawn: one, plus one for each if, each error handler and each backward jump. It measures the drawing, and the drawing is what the author chose to draw of the code.',
};
```

`channelKey('A')`, `('E')`, `('R')` become `channelKey('success')`, `('error')`, `('requirements')` in `nodeBox` and `drawTree`. `channelKey` prints its key, so the label is the word.

CSS comments at ~269, ~347 and ~376 quote `not reached` and `passed through`; rewrite them to `not called` and `propagated`, because the page test in Step 2 reads the whole page string.

CSS: `.nd-ch { … grid-template-columns: 1.2rem 1fr; … }` → `grid-template-columns: max-content 1fr;`. Rename `.tr--raised` → `.tr--thrown`. Rename `.tr-fxm--not-reached` → `.tr-fxm--not-called`.

`nodeBox`:

```js
    const erroring = st.errorPath.some(e => e.nodeId === id && e.how === 'thrown');
```

```js
    const chip = top
      ? '<span class="av-label chip-help" style="margin-left:auto" data-help="The frame the cursor is in">running</span>'
```

```js
        const k = mark === 'threw' ? ' fx--fail' : mark === 'returned' ? ' fx--ok' : '';
```

`PATH_MARK`:

```js
  const PATH_MARK = {
    'thrown': { cls: 'tr--thrown', glyph: '◆' },
    'propagated': { cls: 'tr--onpath', glyph: '│' },
    'caught': { cls: 'tr--caught', glyph: '└' },
    'reached the top uncaught': { cls: null, glyph: '↑' },
  };
```

Rewrite the comment above it: a filled lozenge where the error was thrown, a vertical where it propagated, a corner where it stopped, an arrow where it left the top.

`drawTree`:

```js
        const cls =
          'tr' + (row.state === 'not called' ? ' tr--cold' : '') +
          (row.state === 'running' ? ' tr--active' : row.state === 'waiting' ? ' tr--waiting' : '') +
          (p && p.cls ? ' ' + p.cls : '') + (row.id === S.open ? ' tr--sel' : '');
```

```js
            const k = f.mark === 'threw' ? 'caut' : f.mark === 'returned' ? 'ok' : 'none';
            const chip = f.mark === 'not called' ? '' : ' gt-chip';
```

`(position === 'raised' ? …` → `(position === 'thrown' ? …`.

`drawErrPath`: `'nothing has raised'` → `'nothing has thrown'`.

`drawLedger`:

```js
        const mark = l.outcome === 'threw'
          ? '<span class="caut">threw ' + esc(l.raised.tag) + ' — ' + esc(l.raised.message) + '</span>'
```

`siteClass`: `'failed'` → `'threw'`; `'landed'` → `'returned'`.

`drawSource`: the `var` keyword prints `var` — `'<span class="av-code-kw">var</span> '`.

`drawContract`:

```js
      line('success', esc(ch.success || '—'), HELP.success) +
      line('error', (ch.error || []).length ? (ch.error || []).map(eContract.bind(null, n)).join('') : '<span class="none">never</span>', HELP.error) +
      line('requirements', rOf(S.open).length ? esc(rOf(S.open).join(', ')) : '<span class="none">nothing</span>', HELP.requirements) +
```

`drawTitleBlock`: `cell('walk', stamp)` → `cell('trace', stamp)`.

Rewrite every help string and comment in the file that says "walk" meaning the recording to "run" when it means the playback, and "trace" when it means the recorded list. Do not touch `aviation.bundle.css`.

- [ ] **Step 6: Rename the text output's words**

In `skills/groundtrack/scripts/render.mjs`, `text`:

```js
      const how = row.error.how.map(h => (Groundtrack.ERROR_POSITION[h] === 'thrown' ? `${h} ${row.error.tag}` : h));
```

```js
    const E = row.error.length ? row.error.map(t => [t, ...(row.kinds[t] || [])].join(' ')).join(' · ') : 'never';
    const R = row.requirements.length ? row.requirements.join(', ') : 'none';
    L.push(`${pad}   success ${row.success || '—'}   error ${E}   requirements ${R}`);
```

```js
      if (ov && ov.requirements && ov.requirements.length) L.push(`${pad}   requirements under ${ln}: ${ov.requirements.join(', ')}`);
```

The provenance sentences say "The traces in this file were …" instead of "The walks in this file were …". Update the render test at ~667 in the same step if it quotes "walks".

- [ ] **Step 7: Run the suite**

Run: `node --test tests/groundtrack-fold.test.mjs tests/groundtrack-render.test.mjs`
Expected: PASS.

- [ ] **Step 8: Gate on survivors**

Run: `git grep -nE "on stack|not reached|passed through|'landed'|'failed'|nothing has raised|>inputs<|\bretry\b|\bescape\b|\.[AER]\b|\b[AER]:|channelKey\('[AER]'\)" -- skills/groundtrack/scripts skills/groundtrack/assets/template.html`
Expected: no output. A hit in a comment is still a hit — rewrite it.

Run: `node scripts/check.mjs`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add skills/groundtrack tests
git commit -m "Print running, thrown, propagated and the contract's words (#90)"
```

---

### Task 4: Bring the prose into line

**Files:**
- Modify: `skills/groundtrack/SKILL.md`, `skills/groundtrack/README.md`
- Rename: `skills/groundtrack/references/writing-walks.md` → `skills/groundtrack/references/writing-traces.md`
- Modify: `docs/spec/groundtrack.md`
- Modify: `.claude-plugin/plugin.json` (`description` only)

Do not edit `docs/adr/*.md`. An ADR records a decision as it was taken.

- [ ] **Step 1: Rename the reference**

```bash
git mv skills/groundtrack/references/writing-walks.md skills/groundtrack/references/writing-traces.md
```

Run: `git grep -n "writing-walks"`
Expected: fix every hit to `writing-traces`, then the command prints nothing.

- [ ] **Step 2: Rewrite the prose**

Apply both vocabulary tables to `SKILL.md`, `README.md`, `references/writing-traces.md` and `docs/spec/groundtrack.md`. "Walk" meaning the recorded list of moves becomes "trace". "Walk" meaning the act of stepping through it becomes "run". In `plugin.json`, "recorded walks through it" becomes "recorded traces through it".

Each rewritten sentence obeys the controlled English rule: active, present tense, twenty words or fewer. Each sentence under `skills/` passes ADR 0001: it names no language, library or tool.

- [ ] **Step 3: Gate on survivors**

Run: `git grep -nE "\bwalks?\b|\bchannel\b|\b(retry|escape)\b|\bhandled\b|\bunwind\b|on stack|not reached|passed through|\blanded\b|\bA/E/R\b|\b[AER] channel|\`[AER]\`" -- skills/groundtrack/SKILL.md skills/groundtrack/README.md skills/groundtrack/references docs/spec/groundtrack.md .claude-plugin/plugin.json`
Expected: every remaining hit is ordinary English with no format meaning ("a retry loop in the code being drawn" may stay; "the `E` channel" may not). The field `channels` keeps its name, so "the three channels" may stay.

Run: `git grep -nE "\b(Effect|RxJS|Java|JavaScript)\b|C#" -- skills`
Expected: no output.

- [ ] **Step 4: Run the whole check**

Run: `git fetch origin` then `node scripts/check.mjs`
Expected: PASS. If the version gate fails because `origin/main` moved past this branch's bump, rebase and bump again as `CONTRIBUTING.md` says.

- [ ] **Step 5: Commit**

```bash
git add -A skills docs/spec .claude-plugin/plugin.json
git commit -m "Write the groundtrack prose in the new vocabulary (#90)"
```

---

### Task 5: Look at the page

**Files:** none changed, unless the look finds a fault.

- [ ] **Step 1: Run the whole check**

Run: `git fetch origin` then `node scripts/check.mjs`
Expected: PASS.

- [ ] **Step 2: Render the three examples**

Run, into the scratchpad:

```bash
node skills/groundtrack/scripts/render.mjs skills/groundtrack/examples/greet.flightpath.json --out <scratchpad>/greet.html
node skills/groundtrack/scripts/render.mjs skills/groundtrack/examples/map-300-woodwork.flightpath.json --out <scratchpad>/map-300.html
node skills/groundtrack/scripts/render.mjs skills/groundtrack/examples/pr-313.flightpath.json --out <scratchpad>/pr-313.html
node skills/groundtrack/scripts/render.mjs skills/groundtrack/examples/greet.flightpath.json --text "the post fails"
```

Expected: three pages written; the text prints `success`, `error`, `requirements`, `running` or `returned`, and `error path: thrown SendFailed`.

- [ ] **Step 3: Look at the page**

Serve the scratchpad over http from a fresh high port with a small `node:http` static server, and open `greet.html` in the browser pane. A `file:` URL does not screenshot. Confirm the served page's title is `Example · greet a user` before trusting it.

Check, and write down what you saw:

- **Node boxes:** the `success` / `error` / `requirements` labels fit. `layout()` hard-codes box heights, so a label that wraps breaks the drawing. If one wraps, shorten the grid gap or the type, not the words.
- **Drawing chips:** the top frame reads `running`, others `waiting`, finished ones `returned`.
- **Tree, run "no such user", cursor after the catch:** `thrown` on `lookupName` with `◆`, `caught` on `greet`.
- **Tree, run "the post fails", at the end:** `thrown SendFailed` on `greet`; effect marks read `returned` and `threw`.
- **Rail:** `arguments`, the error path, and the ledger line `threw SendFailed — 502 from the greeting service`.
- **Contract tab:** rows `success`, `error`, `requirements`; `SendFailed` shows `fail`.
- **Title block:** a `trace` cell.

Stop the server when done.

- [ ] **Step 4: Commit a fix, if the look found one**

A fault found here is a Task 3 fault. Fix it in `template.html`, run `node scripts/check.mjs`, and commit.

```bash
git add skills/groundtrack/assets/template.html
git commit -m "Fit the contract's words on the node box (#90)"
```

Found nothing? Commit nothing, and say what you looked at in the pull request.
