# The flightpath file

A `<topic>.flightpath.json` file states **one change**: its facts, one node map,
and a list of graphs. A graph is an entry point and the traces from it. You write
the file by hand. A page draws one graph at a time. Nothing runs the program the
file describes.

This document is the shape you write against. `scripts/render.mjs` enforces it.
**The validator is the format.** No machine-readable schema ships, because a
second artifact that can silently disagree with the first is not worth having.
The repository's test suite is what binds this document to the validator.

## Contents

- The four rules
- The core and the four optional fields
- One change, one file
- Top level
- A graph
- files
- tour
- A node
  - Lists of strings
  - role
  - channels
  - fail and die
  - enteredBy
- A step
- A run
- The trace
  - The eight moves that run a step
  - The four moves that move a frame
  - Frames
  - An effect carries `next` or `raised`, never both
  - A tape covering a call and a failure, in full
- What the validator proves
- What a refusal says
- layers
- Findings

## The four rules

1. **One name, one meaning.** No field name means two things.
2. **An unknown key is an error.** The author-keyed maps are the exception:
   `nodes`, `env`, `layers`, a layer's `nodes`, and a run's `input` hold names
   you choose.
3. **Nothing runs.** Every expression field is text the page prints. No program
   evaluates it, so it may say anything a reader understands.
4. **Every part of the core is required.** Four fields sit outside the core,
   and each is optional on its own.

**Leave an optional field out rather than write it empty.** `"files": []`
claims a change that touched nothing, which is a different statement from *this
file says nothing about changed files*. The validator refuses the empty list
for that reason.

## The core and the four optional fields

groundtrack draws two kinds of thing. A **change** is work already done: a
written change, a branch, a set of edits. A **plan** is work not yet done: a
map of tickets, a design still being argued. Both are graphs of nodes, and both
carry traces.

**The core is every file's:** `id`, `title`, `blurb`, `env`, `nodes`, `graphs`.

**Four fields are optional, and each stands alone:** `files`, `layers`,
`sheet`, `tour`.

They do not divide plans from changes. A plan can touch files. A change can
need no test layer.

## One change, one file

A change with two entry points needs two graphs. It is still one change, so it
is still one file: the title, the blurb, the changed files, the sheet rule, the
ambient values, the layers and the node map are stated once, and the graphs
list what enters where.

```json
{
  "id": "pr-313", "title": "…", "blurb": "…",
  "files": [ … ],
  "sheet": { "scopeRule": "…", "graphsNotDrawn": [ … ] },
  "env": { … },
  "layers": { … },
  "nodes": { … },
  "graphs": [
    { "id": "first-paint", "title": "…", "blurb": "…", "entry": "buildShelf", "presets": [ … ] },
    { "id": "panel-apply", "title": "…", "blurb": "…", "entry": "applySettings", "presets": [ … ] }
  ]
}
```

- **A graph is an entry point and the runs from it.** Its drawing is whatever
  its entry reaches through call edges.
- **Node ids are unique across the change, and a node belongs to no graph.** Two
  graphs reach the same node by both reaching it, and the node is defined once.
- **Layers and ambient values are the change's.** A layer that renames a node
  token renames it on every sheet. A layer's own `entry` names a node in the map.
- **Run names are unique per graph**, so two graphs may each have a happy path.
  A repeat within one graph is refused: `--text <run>` resolves by name and
  takes the first match, so the second would be unreachable.
- **A graph id is letters, digits and hyphens**, like a node id, and unique in
  the file. It reaches the page as an attribute, so it is validated rather than
  escaped.

**The old one-graph shape is refused.** A file with a top-level `entry` or
`presets` fails with a message naming `graphs`. There is one way to say one
thing, so nothing accepts both.

**Three size limits.** The renderer refuses a file that goes over any one of them.
Each limit bounds a cost that a small file can make large.

- **A graph's call structure goes at most 1,000 calls deep.** The entry is 0
  calls deep. The renderer counts calls between nodes and reads no run. The
  drawing recurses once per call to pick and place its nodes. A deeper graph
  can crash it. Shorten the deepest chain of calls. Or split the change into
  more than one graph.
- **A graph's tree view draws at most 20,000 rows.** The tree view draws one
  row per path from the entry, not one row per node. A graph that calls the
  same nodes from more than one place draws more rows than it has nodes.
  Flatten the call graph. Or split the change into more than one graph.
- **The cut calls cost at most 1,000,000 units of work to find.** The
  renderer searches every call argument for each token that a layer
  renames. A layer costs its renamed tokens times a sum. The sum is the
  characters of every call argument plus the number of call steps. The file
  costs the total over its layers. Rename fewer tokens. Or rename them in
  fewer layers. Or shorten the call arguments.
## Top level

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | The file's own name. Letters, digits and hyphens. |
| `title` | string | One line for the page head: what the change is. |
| `blurb` | string | Two or three sentences: what this change is. |
| `env` | object | Ambient values the graphs read. Author-keyed. |
| `files` | array | The changed files. See [files](#files). |
| `layers` | object | Contexts that redraw the graphs. See [layers](#layers). |
| `nodes` | object | The change's one node map, author-keyed by node id. See [a node](#a-node). |
| `graphs` | array | The graphs. See [a graph](#a-graph). |
| `sheet` | object | `scopeRule` (string) and `graphsNotDrawn` (array of strings). |
| `tour` | array | The page's own walk, one stop at a time. See [tour](#tour). |

## A graph

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | The graph's own name. Letters, digits and hyphens; unique in the file. |
| `title` | string | One line: the sheet picker's label. |
| `blurb` | string | One or two sentences: what this entry point does. |
| `entry` | string | The node id the traces enter. Must exist in `nodes`. |
| `presets` | array | Named runs from this entry. See [a run](#a-run). |

**A node id is letters, digits and hyphens, and nothing else.** The id reaches
the page as an HTML attribute, so it is validated rather than escaped. Every
other author string on the page goes into element content and is escaped there.
The id is a handle: put the real symbol in `name` and the real place in `loc`.

## files

Each entry: `path`, `change`, `why`, `adds`, `dels`.

`change` is one of `new`, `edit`, `delete`, `forbidden`. `adds` and `dels` are
numbers. `why` says in one sentence why the change touches this file.

## tour

A tour walks a first-time reader through the page. Each stop frames one region
of the page at one move of one run. The page says what the region is. The stop
says what the reader sees there now.

```json
"tour": [
  { "region": "callStack", "run": "no such user", "move": 5,
    "now": "lookupName is on top of greet, and it has just thrown NoSuchUser." },
  { "region": "cutaway", "run": "a known user", "move": 0, "tab": "files",
    "now": "The two files this change touches: one edited, one new." }
]
```

| Field | Type | Meaning |
| --- | --- | --- |
| `region` | string | The part of the page this stop frames. One of the names below. |
| `run` | string | The name of a run of the stop's graph. |
| `move` | number | The move the page shows as `n / last`. A run of n trace steps has moves 0 to n. |
| `now` | string | One or two sentences: what the reader sees in the region at this move. |
| `graph` | string | Optional. The id of the graph the stop is on. Required when the file states more than one graph. |
| `tab` | string | Optional. The cutaway tab to open: `source`, `files` or `contract`. |
| `view` | string | Optional. `plan` for the drawing, `tree` for the indented tree. |
| `layer` | string | Optional. A layer the file declares in `layers`. |

**The regions** are `sheet`, `run`, `controls`, `plan`, `tools`, `callStack`,
`arguments`, `errorPath`, `effectsLedger`, `cutaway`, `titleBlock` and `trace`.
`sheet` exists only on a file with more than one graph.

- **Write what changed, not what the region is.** The page already says what a
  call stack is. `now` says what this run put in it.
- **A stop sets only what it names.** A tab, view or layer a stop leaves out
  stays as the stops before it set it. Before any stop names one, the page
  keeps its own. A stop shows the same page going back as going forward.
- **The validator checks every stop.** It refuses a region the page does not
  have and a run the graph does not have. It refuses a move past the end of
  the run.
- **The validator reads the moves last.** It counts a run's moves only when
  every trace is a legal path. So a move past the end shows after the other
  refusals are fixed.
- **The tour is optional.** The validator refuses an empty tour. Leave the key
  out instead.

## A node

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | string | What a reader calls this node. |
| `role` | string | What kind of thing the node is. See [role](#role). |
| `loc` | string | Where the node lives: a path, a ticket, a URL. |
| `params` | array of strings | The names this node takes in. A name may carry its default after `=`, as in `target = surface`. A name that starts with `...` takes the rest. |
| `channels` | object | `success`, `error`, `requirements`. See [channels](#channels). |
| `steps` | array | The node's body. See [a step](#a-step). |
| `touches` | array of strings | Paths from `files` this node changes. |
| `enteredBy` | array of strings | Test files whose specs **call** this node. |

### Lists of strings

**These fields are arrays of strings:**

- a node's `params`, `touches` and `enteredBy`
- `error` and `requirements` in a node's `channels`
- a layer's renamed `requirements`
- `sheet.graphsNotDrawn`

Each one is required where its parent is. Write an empty array to say
"none". The validator refuses a list that is not an array. It also refuses
each entry that is not a string, by its index:

```text
greet.flightpath.json: nodes.lookupName.params: expected an array of strings
greet.flightpath.json: nodes.lookupName.params[1]: expected a string
```

The same two shapes hold for `nodes.<id>.enteredBy`, `nodes.<id>.touches`,
`layers.<name>.nodes.<id>.requirements` and `sheet.graphsNotDrawn`. The
validator refuses each entry in `nodes.<id>.channels.error` or
`nodes.<id>.channels.requirements` that is not a string. Those two lists keep
their own words when they are not arrays. For `error` the words are `expected
an array of failure tags`. For `requirements` they are `expected an array of
tokens`. These refusals name the path, and never the value. See
[What a refusal says](#what-a-refusal-says) for a field of the wrong type.

**An entry can be any string, a prototype-member name such as `constructor`
included.** A tool that reads a flightpath file, the renderer included, looks
an entry up in a Set, a Map or an object with no prototype. It never uses a
plain object.

**Write the paths in `loc`, `touches`, `enteredBy` and `files` relative to the
repository root.** The page prints them. An absolute path from a home folder
puts the author's user name on the page.

`--check` reports an absolute path in these four fields as a finding. The
finding names the field, such as `nodes.greet.touches[0]`, and never the
path. The page still renders. These forms count as absolute:

- a drive letter and its root, such as `C:\` or `C:/`;
- a leading slash or backslash, which covers `/home/…`, `\\server\…` and
  `/c/…`;
- a `file:` URL;
- `~` and a user name, such as `~<user>/…`.

The check reads past white space at the start of a path. It does not report
`~/…`, a web URL or a relative path. It reads only these four fields. It does
not report an editor's own URL scheme or a `..` path. It does not report a
drive letter with no slash after it. It does not read a path in any other field, such as a
blurb, an aside or a captured value. Remove a home path there yourself before
you share the page.

### role

Any word. The page prints it and nothing branches on it except the
pure-with-effect finding. The words in use are `pure`, `io`, `handler`,
`agent`, `prototype` and `mutates`. Add one when none fits.

**`pure` claims the node runs no effect.** `--check` reports a node whose role
is exactly `pure` and whose steps include an `effect` step. See
[Findings](#findings).

**`mutates` means the node changes one of its arguments in place.** It is not
`pure`, and unlike `io` nothing leaves the program.

### channels

- `success` — a string. What flows out of the node.
- `error` — an array of strings. The failure tags the node can throw.
- `requirements` — an array of strings. What the node needs to work.

**`void` means nothing flows out.** Only the exact word `void` has this
meaning. `Void`, `undefined` and `VoidResult` mean what you wrote. A return
move out of a `void` node carries no `value`. The validator refuses one that
does, and a `value` of `null` too. The node's `return` step still needs an
`expr`, as every `return` step does.

**Never write a tag's kind here.** `error` is a list of tags, and
nothing more.

The tree, the text output and the contract tab each print `fail` or `die`
beside a tag. The kind is derived file-wide, from the `throw` steps and
the `raised` moves. A tag found in neither prints bare. A tag found with both
prints both, fail before die.

### fail and die

Every `throw` step, `raised` object and `uncaught` move carries a `cause`.

- **`fail` is an expected error.** A caller is meant to catch it.
- **`die` is a defect.** Nothing is meant to catch it.

**A fail is part of the contract, and a die never is.**

- A node that throws a fail names the tag in its `error` list.
- A node that throws a die does not name the tag there.
- A fail that leaves a node, by `propagate` or at the top, is in that node's `error` list.
- A die that leaves a node is not in that node's `error` list.

The validator refuses each break of these rules. A handler for a die is legal, and `--check` reports it as a finding.

### enteredBy

**This field names the test files whose specs call this node, and nothing
else.** A node whose concern is covered through its caller lists nothing here.
Coverage of a lower node follows from the call edges, so no field states it.

## A step

Every step has `op`. Every step may have `label`, a jump target other steps
name, and `aside`, a remark about the step.

**`comment` is an op, and `aside` is the remark on any other step.** Two different
things, two different names.

**No step carries a result.** What an effect returned is a fact in the trace,
not a rule in the program.

| `op` | Required fields | Optional |
| --- | --- | --- |
| `comment` | `comment` | `label`, `aside` |
| `var` | `name`, `expr` | `label`, `aside` |
| `if` | `cond`, `then`, `else` | `label`, `aside` |
| `goto` | `to` | `label`, `aside` |
| `call` | `target` | `label`, `aside`, `args`, `bind`, `onError` |
| `effect` | `kind`, `desc` | `label`, `aside`, `args`, `bind`, `onError` |
| `throw` | `tag`, `message`, `cause` | `label`, `aside` |
| `return` | `expr` | `label`, `aside` |

`then`, `else` and `to` name a `label` on a step of the **same** node. `target`
names a node id. `cause` is `fail` or `die`.

`args` is a string or an object. **On a `call` step, an object's keys are the
callee's param names.** `--check` compares them with the callee's `params`. See
[Findings](#findings). An effect has no callee, so `--check` does not compare
its `args`.

**An object `args` keeps its prototype.** The renderer does not rebuild it. A
tool that reads a flightpath file, the renderer included, tests a param name
against `args` with an own-property test, such as `Object.hasOwn`. It never
reads the property.

`onError` is an array of `{ tag, goto, bind? }`. `goto` names a `label` on a
step of the same node.

**`label` is a jump target and only a jump target.** An effect's readable name
is `desc`. An effect move's readable name is `desc` too.

## A run

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | string | The run's name. |
| `blurb` | string | One sentence: what this run shows. |
| `input` | object | The values this run starts from. Author-keyed. |
| `trace` | object | `provenance` and `steps`. See [the trace](#the-trace). |

## The trace

`provenance` is `authored` (a person or an agent wrote it) or `captured` (a
real run produced it). `steps` is a flat list of moves.

**Three rules cover the whole tape.**

1. **`k` is the op that ran.** A `var` step produces a `var` move, an `if` step
   an `if` move, a `call` a `call`. There is no mapping to learn. Four moves
   name no op, because they move a frame rather than run a step: `catch`,
   `propagate`, `done` and `uncaught`.
2. **`at` always names the step that ran.** Every move that runs a step has
   one. Three of the four frame moves run no step and carry none.

   **`catch` is the exception, and it is not a second rule.** A catch move
   carries `at`, and that `at` names the call step whose `onError` caught —
   the step this frame is suspended at, not a step that just ran. It is the
   one move that arrives after a propagate, so its `at` is the only way to say
   which guard did the catching.
3. **`next` always names where the cursor goes in that same frame.** Every move
   that leaves a live cursor behind has one. The cursor never advances on its
   own, so a reader works nothing out.

The qualifiers on rules 2 and 3 carry weight. Read without them, both rules
demand a field of moves that cannot have it.

### The eight moves that run a step

| `k` | Fields |
| --- | --- |
| `comment` | `at`, `next` — the following index |
| `var` | `at`, `next` — the following index |
| `if` | `at`, `next` — the `then` label or the `else` label |
| `goto` | `at`, `next` — the `to` label |
| `call` | `at`, `to`, `next` — `next` is where **this** frame resumes |
| `effect` | `at`, `kind`, `desc`, and then **either** `next` (+ `result?`, `attempt?`) **or** `raised` — `attempt` counts the tries of an effect that ran more than once |
| `throw` | `at`, `tag`, `message`, `cause` |
| `return` | `at`, `value?` — never a `value` out of a `void` node |

### The four moves that move a frame

| `k` | Fields | Meaning |
| --- | --- | --- |
| `catch` | `at`, `goto`, `next` | The step at `at` declares this `goto` in its `onError`. The cursor moves to `next`, the step labelled `goto`. |
| `propagate` | — | Pop a frame the error leaves. |
| `done` | `result?` | The entry frame returned. |
| `uncaught` | `tag`, `message`, `cause` | Nothing caught the error. Pop every frame still open. |

### Frames

- **A trace begins at its graph's entry with the cursor at zero.** No move says so.
- **A call pushes the frame it names, and that frame enters at step zero.**
  Nothing else pushes a frame.
- **The call's own `next` is the caller's continuation** — where the caller
  resumes when the callee returns. It is set when the call is made, *before*
  the callee is pushed, which is why a caller's cursor is already past its own
  guard while the callee runs.
- **A frame is popped by a return, a propagate or an uncaught**, and by
  nothing else.
- **The two terminal moves treat open frames differently.** A
  `done` arrives after the last frame has gone. An `uncaught` can arrive with
  frames still open. It pops them, and the error path records each one as
  propagated, innermost first.

### An effect carries `next` or `raised`, never both

**A failing effect is one move, not two.** The effect move carries `raised`
instead of `next`, and the ledger row is derived from that one move. There is
no separate raise move, and `raise` is not a move kind. `raised` holds `tag`,
`message` and `cause`.

**Model a failure the way the code does.** If the real effect throws, write an
`effect` move with `raised`. If the real effect returns a failure value that an
`if` inspects, write the `effect` with a `next` to that `if`, and let the `if`
route to the `throw` step. Both are ordinary, and the tape tells them apart.

### A tape covering a call and a failure, in full

```json
[
  { "k": "var",    "at": 0, "next": 1 },
  { "k": "call",   "at": 1, "to": "bind-sheet", "next": 2 },
  { "k": "effect", "at": 0, "kind": "net.get", "desc": "fetch the sheet",
                   "raised": { "tag": "SheetMissing", "message": "404",
                               "cause": "fail" } },
  { "k": "propagate" },
  { "k": "catch", "at": 1, "goto": "warn", "next": 4 },
  { "k": "return", "at": 5, "value": { "bound": false } },
  { "k": "done",   "result": { "refused": null } }
]
```

Read it as: the entry frame runs a `var` and then calls, parking its own cursor
at 2. The callee enters at zero, its effect throws, and the callee's frame
propagates. The entry frame's call step declares a handler, so it catches the
error there. The cursor lands on the step labelled `warn`. The entry frame
returns, and the trace is done with no frame open.

## What the validator proves

It proves the trace is a **legal path**, and it evaluates nothing. The validator
proves a trace against the graph it belongs to, entering at that graph's entry.

- Every `at` indexes a real step of the frame's node, and equals the cursor.
- Every `next` indexes a real step of the same node.
- Every move that names an op ran a step of that op.
- `next` lands somewhere the step can reach.
- A call's `to` matches that step's `target`; an effect's `kind` matches that
  step's `kind`.
- A catch names a step whose `onError` declares that `goto`, and lands
  on it.
- Frames push and pop in order. A `done` arrives with none open. An `uncaught`
  can arrive with frames open, and the check below reads them.
- **A tag claimed uncaught is refused when a frame in its way declares a
  handler for it.** A frame is in the way when it is suspended at a call.
- **A refusal names the move that emptied the frame stack**, not the first move
  to notice.
- **The three exceptional moves need an error to be travelling.** A throw and a
  throwing effect start one; a propagate keeps it; a catch and an uncaught
  end it. So the validator refuses a `propagate` with nothing thrown. It
  refuses a `catch` that catches nothing. It refuses an `uncaught` whose tag is
  not the one travelling. It also refuses a `catch` whose named `onError`
  entry declares a different tag.
- **While an error is travelling, only the moves that carry it may run.** A
  `return` that discards the error, and a `done` that arrives while it is
  still moving, are both refused. **An error is caught, or it reaches the
  top.** There is no third ending.
- **A fail is in the error list of every node it leaves, and a die is in none.**
- **A throw move and an uncaught move repeat the cause the error carries.**
- **A return move out of a `void` node carries no `value`.** The refusal names
  the node and both fixes: drop the value, or name what the node returns in
  `channels.success`. It never prints the value.

**What it cannot prove.** Which branch an `if` took, and what an effect
returned. Both are claims you make. In practice a wrong branch is often caught
anyway, because the moves after it no longer fit the graph.

**Say this limit out loud when you hand the page over.** The material is
durable, so a sceptical reader can check the drawing against it. The trace's
structure is checked. Its values are not.

## What a refusal says

**A refusal in a trace names the graph, the run and the move in words** after the
path, because counting into two arrays to find `graphs[1].presets[0]` is work a
person should not have to do:

```text
greet.flightpath.json: graphs[1].presets[0].trace.steps[4]: graph "panel-apply", run "a known user", move 4: call to "greet", but step 0 targets "lookupName"
```

**A fault in the file's shape prints the path alone.** The validator refuses it
before it reads any trace, so there is no run and no move to name. A refusal
never names one that does not exist.

**The validator checks each field's type first, and alone.** Each field in
this document holds a string, except these:

- a file's `adds` and `dels`, a move's `at`, `next` and `attempt`, and a
  tour stop's `move` hold numbers;
- `args`, `bind`, `env`, a run's `input`, and a move's `value` and `result`
  hold any value;
- the lists, the objects and each step in `steps` hold what their sections
  say.

The validator checks every one of these before any other rule. It refuses a
field of another type with one of these refusals:

```text
greet.flightpath.json: title: expected a string
greet.flightpath.json: files[0].adds: expected a number
greet.flightpath.json: nodes.greet.steps[8]: expected an object
```

When any field has the wrong type, the validator stops there. Fix those
refusals. Then run `--check` again for the rest. A type refusal names the
path, and never the value.

**An op or a move kind is one of the names in the tables.** A built-in name
such as `constructor` is not one of them. The validator refuses it the same
way.

**Every line the renderer prints from the file is one line.** This holds for
refusals, findings, the `ok:` line and the `--text` tree. A name can hold a
line break or another hidden character. The renderer prints each such
character as one or two escapes such as `\u000a`, the escape for a line
break. So a name cannot split a line, and cannot fake a refusal.

**A printed line stops at 2,000 characters.** A longer line prints its first
2,000 characters, then its full length and the start of its digest:

```text
greet.flightpath.json: nodes.aaaa… (the first 2,000 of 50,140 characters, sha256 <first 16 hex digits>)
```

The renderer cuts the line before it escapes it, so the 2,000 counts the
file's text. With its escapes, a cut line can print about six times as many
characters. The count can be 1,999, so the cut never splits a character.
This bounds what the renderer prints and refuses nothing.

**A long name stops where it enters a line, so the line's own end prints.**
The title in the `ok:` line and a run's name in a refusal stop at 200
characters. A name or text in the `--text` tree stops at 1,000. Each one
prints its first characters and then its full length:

```text
ok: Greet a us… (3,000 characters) — 2 node(s), 1 graph(s), 3 run(s), 0 finding(s)
```

**Three lines exit 2, and none of them is a refusal.** Each names a file and
none of its text:

```text
cannot read greet.flightpath.json: not valid JSON, at line 4 column 17
cannot write <page>.html: ENOENT
greet.flightpath.json: the renderer stopped on this file (RangeError)
```

- `cannot read` means the file is not JSON. The parser gives the line and
  column when it knows them.
- `cannot write` names the page from `--out`, and the reason the system gave.
  The input file is fine.
- `the renderer stopped` means a fault no rule foresees. The known cause is
  very deep nesting in a value of any type, such as `args`. Flatten it.

## layers

A layer redraws the graph for one context. Author-keyed; any name.

```json
{
  "production": { "nodes": {} },
  "tests": {
    "entry": "build-shelf",
    "nodes": { "bind-sheet": { "requirements": ["TextureLoader -> fakeLoader() · shelf.test.ts:483"] } }
  }
}
```

- `entry` is optional and names the node this layer enters. Everything the call
  edges cannot reach from it draws as unreached.
- `nodes.<id>.requirements` renames that node's requirements under this layer. **A layer
  substitutes a token, never a node.** The geometry is untouched, so a redraw
  computes nothing.
- **A cut edge is derived, never declared.** If a renamed token appears in a
  call step's `args`, that edge is cut under that layer. Nobody writes it down;
  the validator finds it. Write the rename as `old -> new`; the arrow may be
  either `->` or a single arrow character.
- **The layer set is open.** The page renders one control per layer the file
  declares. A file that declares no layer map disables the toggle and says why.

## Findings

A finding is not a refusal. `--check` prints these on standard output and still
exits zero. Each one is a thing you may have meant.

- **An absolute path in `loc`, `touches`, `enteredBy` or `files`.** The
  finding names the field and never the path. See
  [Lists of strings](#lists-of-strings) for the forms it reports.
- **Several nodes edit one file.** Legal, and worth seeing: it is the shape a
  change takes when one file carries two concerns. The finding names an
  absolute path by the first `touches` entry that holds it.
- **An `error` list declaring a tag nothing beneath it can produce.** A node
  produces a tag three ways: it throws it, a step of it declares a handler for
  it, or one of its effects threw it in a trace this file carries.
- **A file in the change that no node accounts for**, by name. It reads every
  node of the change, so a file one graph covers is not reported because
  another graph does not. The finding names an absolute path by its `files`
  entry.
- **A node no graph's entry reaches**, so no sheet draws it. Legal: a node you
  have written and not yet connected is a work in progress.
- **A call edge a layer cuts.**
- **A handler for a tag the file throws as a die.** Legal, and it should be on purpose.
- **A `pure` node that runs an effect.** The finding names the node and its
  first `effect` step. Fix the role or the step, or write one line that says
  why the role stands.
- **A call step whose `args` name something the callee's `params` do not.**
  One line per call step names the caller, the step, the callee and every
  such name. Each name is in quotes, with its control and invisible
  characters escaped. A name longer than 200 characters prints as its first
  200, its length and the start of its digest. A param matches by the name before its `=`. A callee
  with a `...` param takes every name. The check skips an `args` that is not
  an object. A callee whose `params` are not all strings never reaches this
  check: the validator refuses it first. See [Lists of strings](#lists-of-strings). Fix
  the call site when a name is a typo or `params` no longer lists what the
  callee takes. Write one line that says why when the args are an options
  object's fields or a route word.
