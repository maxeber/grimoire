# The flightpath file

A `<topic>.flightpath.json` file states **one change**: its facts, one node map,
and a list of graphs. A graph is an entry point and the traces from it. You write
the file by hand. A page draws one graph at a time. Nothing runs the program the
file describes.

This document is the shape you write against. `scripts/render.mjs` enforces it.
**The validator is the format.** No machine-readable schema ships, because a
second artifact that can silently disagree with the first is not worth having.
The repository's test suite is what binds this document to the validator.

## The four rules

1. **One name, one meaning.** No field name means two things.
2. **An unknown key is an error.** The author-keyed maps are the exception:
   `nodes`, `env`, `layers`, a layer's `nodes`, and a run's `input` hold names
   you choose.
3. **Nothing runs.** Every expression field is text the page prints. No program
   evaluates it, so it may say anything a reader understands.
4. **Every part of the core is required.** Three fields sit outside the core,
   and each is optional on its own.

**Leave an optional field out rather than write it empty.** `"files": []`
claims a change that touched nothing, which is a different statement from *this
file says nothing about changed files*. The validator refuses the empty list
for that reason.

## The core and the three optional fields

groundtrack draws two kinds of thing. A **change** is work already done: a
written change, a branch, a set of edits. A **plan** is work not yet done: a
map of tickets, a design still being argued. Both are graphs of nodes, and both
carry traces.

**The core is every file's:** `id`, `title`, `blurb`, `env`, `nodes`, `graphs`.

**Three fields are optional, and each stands alone:** `files`, `layers`,
`sheet`.

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

## A node

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | string | What a reader calls this node. |
| `role` | string | What kind of thing the node is. See [role](#role). |
| `loc` | string | Where the node lives: a path, a ticket, a URL. |
| `params` | array of strings | The names this node takes in. |
| `channels` | object | `success`, `error`, `requirements`. See [channels](#channels). |
| `steps` | array | The node's body. See [a step](#a-step). |
| `touches` | array of strings | Paths from `files` this node changes. |
| `enteredBy` | array of strings | Test files whose specs **call** this node. |

### role

Any word. The page prints it and nothing branches on it. The words in use are
`pure`, `io`, `handler`, `agent` and `prototype`. Add one when none fits.

### channels

- `success` — a string. What flows out of the node.
- `error` — an array of strings. The failure tags the node can throw.
- `requirements` — an array of strings. What the node needs to work.

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
| `return` | `at`, `value?` |

### The four moves that move a frame

| `k` | Fields | Meaning |
| --- | --- | --- |
| `catch` | `at`, `goto`, `next` | The step at `at` declares this `goto` in its `onError`. The cursor moves to `next`, the step labelled `goto`. |
| `propagate` | — | Pop a frame the error leaves. |
| `done` | `result?` | The entry frame returned. |
| `uncaught` | `tag`, `message`, `cause` | Nothing caught the error. |

### Frames

- **A trace begins at its graph's entry with the cursor at zero.** No move says so.
- **A call pushes the frame it names, and that frame enters at step zero.**
  Nothing else pushes a frame.
- **The call's own `next` is the caller's continuation** — where the caller
  resumes when the callee returns. It is set when the call is made, *before*
  the callee is pushed, which is why a caller's cursor is already past its own
  guard while the callee runs.
- **A frame is popped by a return or a propagate**, and by nothing else.
- **The two terminal moves are stack-free.** They arrive after the last frame
  has gone.

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
- Frames push and pop in order, and the terminal move arrives with none open.
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

**What it cannot prove.** Which branch an `if` took, and what an effect
returned. Both are claims you make. In practice a wrong branch is often caught
anyway, because the moves after it no longer fit the graph.

**Say this limit out loud when you hand the page over.** The material is
durable, so a sceptical reader can check the drawing against it. The trace's
structure is checked. Its values are not.

## What a refusal says

**Every refusal carries a path into the document**, so a tool locates the fault
without reading the prose:

```text
greet.flightpath.json: graphs[0].entry: "nowhere" is not a node
```

**A refusal in a trace names the graph, the run and the move in words** after the
path, because counting into two arrays to find `graphs[1].presets[0]` is work a
person should not have to do:

```text
greet.flightpath.json: graphs[1].presets[0].trace.steps[4]: graph "panel-apply", run "a known user", move 4: call to "greet", but step 0 targets "lookupName"
```

**A fault in the file's shape prints the path alone.** The validator refuses it
before it reads any trace, so there is no run and no move to name. A refusal
never names one that does not exist.

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

- **Several nodes edit one file.** Legal, and worth seeing: it is the shape a
  change takes when one file carries two concerns.
- **An `error` list declaring a tag nothing beneath it can produce.** A node
  produces a tag three ways: it throws it, a step of it declares a handler for
  it, or one of its effects threw it in a trace this file carries.
- **A file in the change that no node accounts for**, by name. It reads every
  node of the change, so a file one graph covers is not reported because
  another graph does not.
- **A node no graph's entry reaches**, so no sheet draws it. Legal: a node you
  have written and not yet connected is a work in progress.
- **A call edge a layer cuts.**
- **A handler for a tag the file throws as a die.** Legal, and it should be on purpose.
