# groundtrack — the locked spec

The destination of [the map, #25](https://github.com/mephistopheles4/grimoire/issues/25).
Sixteen tickets closed; this document is what they decided, in one place, so an
implementation session does not have to reconstruct the skill from a decision
index.

**This file is canonical.** Where a ticket and this file disagree, the ticket is
the record of the argument and this file is the instruction. Where this file is
silent, the ticket resolution stands.

---

## Problem Statement

A reader who did not write a change cannot see its shape.

A pull request arrives as a list of files. A plan arrives as a list of tickets.
Neither says what calls what, what each part hands back, where it can break, or
what it needs in order to work. So the reader opens files one at a time and
holds the graph in their head, and the parts of it they never load are the parts
they cannot ask about.

Four things go missing in particular.

**Where a thing breaks, and how badly.** An expected failure a caller catches
and a defect that destroys the process are two different facts, and a file
list carries neither of them. The last one is invisible to
tooling as well as to the reader: a renderer killed for running out of memory
reaches no error handler, so nothing logs it and the debugging session drops at
the moment the data was worth having.

**What a part actually needs.** A node's dependencies are the thing a reader
most wants to know and the thing source code says least clearly. "This design
has no hidden dependencies" stays a sentence in a description that nobody can
check.

**Whether a drawing is true.** A hand-drawn diagram is a claim about a system
with nothing holding it to the system. It is drawn once, it goes stale
immediately, and a wrong one raises no error.

**Which part of a large change to look at at all.** Seventeen files and two
thousand lines do not fit on one graph. A reader with no map of the change
cannot choose a starting point, and a tool that picks for them and picks wrong
draws a true picture of nothing interesting.

## Solution

**groundtrack** turns durable material into a call graph a reader can step
through.

The reader points it at something that already exists — a diff, a plan, a named
function, a bare path into a codebase. The agent reads the material and
hand-writes one file, `<topic>.flightpath.json`, which states one graph and one
or more recorded traces through it. A zero-dependency renderer turns that file
into a single self-contained HTML page.

Every node on the graph carries three channels, in the framing the skill
borrows from Effect:

- **success** — what flows out of the node.
- **error** — where it breaks: the tags it can throw as a fail. A die is a
  defect, and never appears in this list.
- **requirements** — what it needs to work.

The page draws the graph and steps a cursor over a recorded trace. Nothing is
computed at read time: every branch an `if` took, every value an effect
returned, and every catch, is a literal in the file. That is what makes the trace
a list of checkable claims rather than a program a reader has to believe.

A **layer** redraws the same graph under a different set of dependencies — the
test layer being the obvious one. Flip the toggle and a node that still reaches
the real network under test is a design defect you can see rather than a
sentence you have to trust.

On request the skill prints the same graph as an indented text tree, so the
answer in the reply and the answer on the page are the same graph seen two ways.

The honesty property is the point of the whole thing, and it has a stated limit.
The material is durable, so a sceptical reader can go and check the drawing
against it. The validator proves the trace is a legal path through the graph the
file declares. It cannot prove which branch was taken or what an effect
returned; those stay the author's claims. The skill says so rather than hiding
it.

---

## User Stories

**Reading a change**

1. As a reviewer opening a large pull request, I want a drawing of what calls
   what, so that I can see the shape of the change before I read a single file.
2. As a reviewer, I want each node to state what it returns, so that I can tell
   what flows through the change without inferring it from call sites.
3. As a reviewer, I want each node to state the failure tags it can throw, so
   that I can see where the change can break.
4. As a reviewer, I want a failure marked as a fail or a die, so that I can
   tell an expected error from a defect that destroys the process.
5. As a reviewer, I want each node to state what it needs to work, so that a
   dependency I did not expect is visible rather than buried in an import.
6. As a reviewer of a 17-file pull request, I want the change cut into more than
   one graph, so that I am not handed a picture too dense to read.
7. As a reviewer, I want the skill to list every graph it found and let me pick,
   so that I choose the starting point rather than accepting one it guessed.
8. As a reviewer, I want that list before the skill draws anything, so that I
   can disagree with the cut before the work rather than after it.
9. As a reviewer, I want the files in the diff that no node accounts for listed
   by name, so that a documentation-only or config-only part of the change is
   not silently dropped.
10. As a reviewer, I want the graphs the run did not draw named, so that I know
    what I have not yet looked at.
11. As a reviewer, I want the page to print the scope rule the run applied, so
    that I can disagree with the cut.

**Reading a plan**

12. As a maintainer holding a plan of sixteen tickets, I want the same drawing
    for work not yet done, so that I can see a plan's shape the way I see a
    change's.
13. As a maintainer, I want a node to point at a ticket or a URL rather than
    only a file path, so that a plan's nodes locate to the thing that actually
    exists.
14. As a maintainer, I want a plan and a change to use the same file shape, so
    that I learn one format rather than two.

**Stepping the trace**

15. As a reader, I want to step forward through a recorded trace, so that I can
    follow one route through the mechanism rather than read a static picture.
16. As a reader, I want to step backward, so that I can re-watch a call I moved
    past too quickly.
17. As a reader stepping back over a call, I want the drawing to redraw the call
    in reverse — callee to caller — so that unwinding reads as unwinding.
18. As a reader, I want the run animated, so that the direction of a call is
    something I see rather than something I work out.
19. As a reader, I want to hold the run on the next effect, so that I can stop
    where the system touches the outside world.
20. As a reader, I want to hold the run on the next error, so that I can stop
    where it breaks without stepping there by hand.
21. As a reader, I want the call stack as it stands at the cursor, so that I
    know how I got to the node I am looking at.
22. As a reader, I want the effects ledger to grow as I step, so that I can see
    what the run touched, in order.
23. As a reader, I want the error path shown when something throws, so that I
    can see how far an error travelled before something caught it.
24. As a reader, I want the run's arguments shown read-only, so that I know the
    condition this trace was recorded under, without a field that looks editable
    and is not.
25. As a reader, I want to pick which of several recorded runs to step, so that
    I can watch the failing one rather than the happy path.
26. As a reader, I want each run to carry the sentence its author wrote, so that
    I can choose between runs without stepping all of them.

**Reading one node**

27. As a reader, I want to open one node and see its body, so that I can read
    the steps the trace is moving over.
28. As a reader, I want the open node's current step marked, so that the source
    view and the cursor agree.
29. As a reader, I want the open node's files grouped into this node, other
    nodes on this sheet, and in the diff on no node, so that one list answers
    all three questions.
30. As a reader, I want the open node's declared contract shown, so that I can
    compare what it says it does against what the run did.

**Reading without the drawing**

31. As a reader who does not want an animated diagram, I want a tree view of the
    same graph, so that I can read it as indented text.
32. As a reader in the tree view, I want stepping to keep working, so that I
    lose the animation and nothing else.
33. As a reader asking for text, I want the graph printed into the reply, so
    that I can paste it into a review comment or an issue.
34. As a reader asking for text, I want one row per call site rather than per
    node, so that a node called twice appears twice and the text matches the
    tree on the page.
35. As a reader asking for text, I want the run's end marks included, so that
    choosing a different run changes what I read.
36. As a reader asking for text, I want the skill to suggest one run and list
    the rest by name and blurb, so that I can overrule the suggestion cheaply.
37. As a reader asking for text, I want one line saying where the traces came
    from, so that I know whether I am reading a claim or a recording.
38. As a reader, I want a repeated node marked and stopped rather than expanded
    forever, so that a cycle terminates.

**Layers**

39. As a designer, I want to declare a named layer that renames what a node
    needs, so that I can state how the graph looks under test.
40. As a designer, I want to flip to that layer on the page and watch the graph
    redraw, so that a hidden dependency is something I see rather than assert.
41. As a designer, I want a node that keeps its real dependency under the test
    layer to be visible, so that the one node no test reaches stands out.
42. As a designer, I want a layer to be able to state its own entry point, so
    that a layer that enters the graph somewhere else draws the unreached part
    as unreached.
43. As a designer, I want the toggle to offer every layer the file declares,
    so that a file with three layers does not get two buttons.
44. As a reader of a file that declares no layer map, I want the toggle disabled
    with the reason visible, so that I am not offered a switch that does
    nothing.

**Writing the file**

45. As an agent, I want one document that states the shape I write against, so
    that I do not have to infer the format from an example.
46. As an agent, I want a worked example beside the shape document, so that I
    can see a complete legal file.
47. As an agent, I want a validator I can run, so that I find out I am wrong
    before a human does.
48. As an agent, I want an unknown key refused, so that a typo cannot silently
    change what the file means.
49. As an agent, I want a refusal that names the file, the run, the move and the
    reason, so that I can act on it without guessing.
50. As an agent, I want a refusal to name the move that caused the fault rather
    than the first move to notice it, so that I do not rewrite the wrong half of
    the trace.
51. As an agent, I want a trace that claims a tag reached the top uncaught to be
    refused when a frame in its way declares a handler for it, so that a file
    cannot contradict itself and pass.
52. As an agent, I want the checker to run in one command with no install, so
    that the write-validate-fix loop costs nothing to start.
53. As an agent writing about a whole module rather than a diff, I want to be
    asked for the file set, so that I do not invent a bound the reader did not
    choose.
54. As an agent, I want to name only vocabulary this repository owns, so that
    the skill does not couple itself to a tool the reader may not have.

**Running the skill**

55. As a user, I want to ask for the skill by name, so that I can reach it
    deliberately.
56. As a user, I want the skill to trigger on a plan already made or work
    already done, so that it fires at the right phase without naming another
    skill.
57. As a user, I want the run to write its file and its page to scratch, so that
    my working tree does not collect untracked artifacts.
58. As a user, I want a copy in the repository only when I ask for one, so that
    the artifact stays disposable by default.
59. As a user, I want the page to be one self-contained file, so that I can open
    it by double-clicking and send it to somebody else.
60. As a user on a locked-down network, I want the page to make no network
    request at all, so that the drawing does not degrade to whatever font
    happens to be installed.

**Maintaining the repository**

61. As a maintainer, I want `node scripts/check.mjs` to validate every
    `.flightpath.json` in the tree, so that the one-command contract keeps
    covering the new skill.
62. As a maintainer, I want the site build to publish a groundtrack page, so
    that a stranger can see what the skill produces without installing it.
63. As a maintainer, I want the two root scripts to read one registry of
    artifact type to renderer, so that a third skill is a row rather than a
    branch in two files.
64. As a maintainer, I want that registry keyed on repository-relative path, so
    that two artifacts sharing a file name cannot overwrite each other in the
    published site.
65. As a maintainer, I want the skill to carry no fixed path, so that it runs
    from every install route.
66. As a maintainer, I want the skill to take no dependency, so that it runs
    from a bare checkout.
67. As a maintainer, I want both manifests to name both skills, so that a
    stranger deciding whether to install reads an accurate line.
68. As a maintainer, I want a change under the new skill to force a version
    bump, so that installed users receive the update.

---

## Implementation Decisions

### The skill, and what it is called

**The skill is `groundtrack`.** One word, no hyphen. Directory
`skills/groundtrack/`, invoked as `/groundtrack`, and `/grimoire:groundtrack`
under the plugin. `eagle-eye`'s hyphen is incidental, not a convention.

**Its artifact is `<topic>.flightpath.json`.** The two words are placed by where
they are read: the skill name is taught once and used deliberately, so it can
afford precision; the filename is met cold in a directory listing by somebody
who has never heard of the skill, so it trades on recall. A ground track is the
path actually traced; a flight path is commonly the intended one, which is the
distinction the skill exists to draw.

**The skill names no other skill.** Not in its description, not in its body, not
in its examples. There is no handoff in either direction and no routing clause
pointing anywhere. The occasion is stated as a bare fact a stranger can check —
*for a plan already made or work already done* — and it names nothing. No
outside tool name, command name or tool-specific noun appears anywhere the skill
ships.

**Evocative on the door, plain language inside.** The name is a metaphor. The
prose is not: page and reference text follow the same controlled-English rules
`eagle-eye` uses, tested against ISO 24495-1. Drafting vocabulary — *sheet*,
*plan*, *cutaway*, *title block* — is available to the page as long as each word
names exactly one thing. `groundtrack` and `flightpath` are reserved out of the
page's notation, so neither also names a region or a line style.

### What it takes in

**The admission rule is a property, not a list:** groundtrack accepts durable
material an agent can read, plus a file set.

That admits a written change, an unbuilt plan, a named function or region, and a
bare module path. The source usually states the file set — a diff states it, a
plan's file list states it. **When the source states none, the reader states
it**, and the skill asks rather than inventing a bound.

**The agent hand-writes the file.** It reads the source the way it reads any
other material and writes the JSON. There is no parser, no static analysis and
no dependency. Static analysis buys completeness, and this artifact never claims
completeness, so it never needs the promise.

### How a large change is cut

**One graph per entry point**, where an entry point is a changed symbol that no
other changed symbol calls — the roots of the changed-call graph.

**The skill lists every graph it found and the reader picks which to draw.** It
announces the list before it draws, so the cut is checkable before the work
rather than after. Asking is the default and is a setting.

**Nothing ranks the graphs, and nothing suggests one.** The list is the whole
mechanism: the reader picks, and a run that is not told which graph to draw asks
rather than choosing. This is stated because the opposite is an easy thing to
assume — the *text* output does suggest, but it suggests one **run** within one
graph, on a rule that names exactly one run in all three worked programs. No
rule was ever measured for ranking graphs against each other, so inventing a
score here would put an undecided default in front of every reader.

Three things reach the page so a reader can audit the cut:

- **The scope rule the run applied**, so the reader can disagree with it.
- **Files in the diff that no node accounts for**, by name. This is already
  computed and already grouped in the open-node view; it is not rendered a
  second time at sheet level.
- **Graphs found and not drawn**, each named with why it is worth a draw. This
  and the scope rule share the footer band's existing row rather than adding
  one.

*Files with no node* and *graphs not drawn* stay two separate statements. They
are different failures and merging them loses which is which.

### The file: four rules

1. **One name, one meaning.** No field name means two things.
2. **An unknown key is an error.** The author-keyed maps are the exception —
   the node map, the ambient values, the layer map, a layer's node map, and a
   run's inputs all hold names the author chooses.
3. **Nothing runs.** Every expression field is text the page prints. No program
   evaluates it, so it may say anything a reader understands.
4. **Every part of the core is required**, and the three fields outside the core
   are each optional on their own.

**Leave an optional field out rather than write it empty.** An empty file list
claims a change that touched nothing, which is a different statement from *this
file says nothing about changed files*, so the empty list is refused.

**The core:** the file's own id, a title, a blurb, the entry node, the ambient
values, the node map, and the runs.

**The three optional fields:** the changed files, the layer map, and the sheet
rule. They do not divide plans from changes, and the material says so — a
wayfinder map lists thirteen changed files and declares no layers and no sheet
rule, and one real pull request declares none of the three.

### The file: a node

A node carries a name, a role, a location, the names it takes in, its three
channels, its body of steps, the paths it changes, and the test files whose
specs enter it.

- **`role` is an open word.** The page prints it and nothing branches on it. The
  words in use are pure, io, handler, agent and prototype; an author adds one
  when none fits. This replaces the closed node category the prototype had.
- **The channels are `success` a string, `error` a list of tags,
  `requirements` a list of tokens.**
- **The test field names only the specs that *call* this node**, and nothing
  else. A node covered through its caller lists nothing. Coverage of a lower
  node follows from the call edges, so no field states it. This is a rename and
  a narrowing of the prototype's overloaded field, which meant two things.
- **Cardinality is dropped.** It was a prototype field and it earned no place.

### The file: a step

Eight ops, and every step may carry a jump label and a remark:

| op | required | notes |
| --- | --- | --- |
| comment | the comment text | |
| var | a name and an expression | |
| if | a condition, a then and an else | both branches name labels in this node |
| goto | a target | names a label in this node |
| call | a target node | may bind, pass args and declare handlers |
| effect | a kind and a description | may bind, pass args and declare handlers |
| throw | a tag, a message and a cause | the cause is fail or die |
| return | an expression | |

**A jump label is a jump target and only a jump target.** An effect's readable
name is its description; a trace move's readable name is its description.

**The remark on a step and the comment op are two different things**, and the
prototype called both `note`. Rule 1 renames the annotation.

**No step carries a result.** The prototype gave an effect a result, a failure
condition, a failing attempt and a failure value, so its interpreter knew what
to return. Nothing runs now, so all four are gone: what an effect returned is a
fact in the trace, not a rule in the program.

Handlers are declared per step as a list of `{ tag, goto }` pairs, each `goto`
naming a label in the same node.

### The file: a run and its trace

A run carries a name, a one-sentence blurb, its inputs, and its trace. A trace
carries its provenance — **authored** or **captured** — and a flat list of
moves.

**Three rules cover the whole tape.**

1. **The move kind is the op that ran.** A `var` step produces a `var` move,
   an `if` step an `if` move. There is no mapping to learn. Four kinds name no
   op, because they move a frame rather than run a step.
2. **`at` always names the step that ran.** Every move that runs a step carries
   one; the four frame moves run no step and carry none.
3. **`next` always names where the cursor goes in that same frame.** Every move
   that leaves a live cursor behind carries one. The cursor never advances on
   its own, so a reader works nothing out.

The qualifiers on rules 2 and 3 are load-bearing. Read without them, both rules
demand a field of moves that cannot have it.

**Eight moves run a step**, one per op. **Four move a frame:** a catch, a
propagate, the entry frame returning, and an error reaching the top uncaught.

**Which moves carry which fields:**

| kind | `at` | `next` | also |
| --- | --- | --- | --- |
| comment, var | yes | yes — the following index | |
| if | yes | yes — the then label or the else label | |
| goto | yes | yes — the target label | |
| call | yes | yes — where **this** frame resumes | the node it pushed |
| effect | yes | **either** `next` **or** `raised`, never both | the kind, the description, and a result on the `next` form |
| throw | yes | no — the frame is leaving | the tag, the message, the cause |
| return | yes | no — the frame is leaving | the returned value, optional |
| catch | yes — the step that declares the handler | yes — the step the cursor moves to | the handler label |
| propagate | no | no | |
| done | no | no | the result, optional |
| uncaught | no | no | the tag, the message, the cause |

**Frames.**

- **A trace begins in the entry node with the cursor at zero.** No move says so.
- **A call pushes the frame it names, and that frame enters at step zero**, the
  same rule the entry frame follows. Nothing else pushes a frame.
- **The call's own `next` is the caller's continuation** — where the caller
  resumes when the callee returns. It is set when the call is made, *before* the
  callee is pushed, which is why a caller's cursor is already past its own guard
  while the callee runs. That detail is not trivia: it is exactly what one of
  the shipped validator checks had to get right.
- **A frame is popped by a return, a propagate or an uncaught**, and by nothing
  else.
- **The two terminal moves need no open frame, and they treat open frames
  differently.** A `done` arrives after the last frame has gone, so a validator
  that demands an open frame on every move rejects every valid trace. An
  `uncaught` may arrive with frames still open. It pops them, and the error path
  records each one as propagated, innermost first. The asymmetry is deliberate:
  the uncaught check reads those open frames for a handler that should have
  caught the tag, and it would have nothing to read if the move required none.

**A failing effect is one move, not two.** The effect move carries `raised`
instead of a `next`, and the ledger row is derived from that one move. **There
is no separate raise move, and `raise` is not a move kind.** The prototype had
one, and it died when the shape locked: an effect with both a status field and a
separate raise gave a file two ways to say one thing, which is how a file comes
to disagree with itself. The status field died in the same pass, because three
capable runs read it the other way from the checker.

**Model a failure the way the code does.** If the real effect throws, the effect
move carries `raised`. If it returns a failure value that an `if` inspects, the
effect move carries `next` to that `if`, and the `if` routes to the throw step.
Both are ordinary and the tape tells them apart.

A tape covering a call and a failure, in full:

```json
[
  { "k": "var",    "at": 0, "next": 1 },
  { "k": "call",   "at": 1, "to": "bindSheet", "next": 2 },
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
propagates. The entry frame's call step declared a handler, so the error is caught
there and the cursor lands on the step labelled `warn`. The entry frame returns,
and the trace is done with no frame open.

**Traces live in the file.** They cost about a quarter of a program file — a
kilobyte or two per run, roughly sixty bytes a move — which is cheap enough that
storing them elsewhere is not a question.

**No recorder ships.** The measurement is the reason: a structural path check
with no evaluator at all ran 560 moves with zero errors and caught nine of
eleven deliberate corruptions, a wrong branch included, and a capable agent
hand-wrote a legal trace nine times out of nine, three of them on a held-out
task the shape had never seen. A recorder would also make one of the two
measured residual failures *worse* rather than better, because it replays the
graph it is given and would render a wrong graph internally consistent.

### The file: layers

A layer redraws the graph for one context. The map is author-keyed and any name
is legal.

```json
"layers": {
  "production": { "nodes": {} },
  "tests": {
    "entry": "buildShelf",
    "nodes": { "bindSheet": { "requirements": ["THREE.TextureLoader -> fakeLoader()"] } }
  }
}
```

- **A layer renames a token, never a node.** The geometry is untouched, so a
  redraw computes nothing. Token-for-token was settled by writing a real one:
  across a 2109-line pull request with two genuine doubles there is no mocking
  library and no stand-in module — a double goes in at the call site, through a
  parameter with a real default, so the requirement is renamed and the node
  stays.
- **A layer may state its own entry.** Everything the call edges cannot reach
  from it draws as unreached.
- **A cut edge is derived, never declared.** If a renamed token appears in a
  call step's arguments, that edge is cut under that layer. Nobody writes it
  down; the validator finds it.
- **The layer set is open**, and the toggle renders one control per layer the
  file declares. Two hard-coded buttons is a defect: three layers are already
  real — production, the unit specs, and a smoke run that substitutes nothing.
- **A file that declares no layer map disables the toggle and says why.**

### The validator is the schema

**The hand-rolled validator is the definition of the format, and no machine-readable
schema file ships.** `eagle-eye` ships one, held to its validator by nothing,
and six divergences already exist between them. A second artifact that can
silently disagree with the first is not worth having. A prose shape document
ships instead, and the test suite is what binds the two.

The validator proves the trace is a **legal path** and evaluates nothing:

- Every `at` indexes a real step of the frame's node, and equals the cursor.
- Every `next` indexes a real step of the same node.
- Every move naming an op ran a step of that op.
- `next` lands somewhere the step can reach.
- A call's target matches the step's target; an effect's kind matches the step's
  kind.
- A catch names a step that declares that handler, and lands on it.
- Frames push and pop in order. A `done` arrives with none open; an `uncaught`
  may arrive with frames open, and the check for a handler in its way reads them.
- A fail is in the error list of every node it leaves, and a die is in none.
- A throw move and an uncaught move repeat the cause the error carries.

A handler for a tag the file throws as a die is legal, and `--check` reports it
as a finding.

**Two more checks ship, both measured rather than argued:**

- **Refuse a tag claimed uncaught while a frame in its way declares a handler
  for it.** A frame is in the way when it is *suspended at a call* — track the
  call step when a call pushes a frame, clear it on the matching return, and
  keep it through a propagate, which is exactly the case where the error is still
  travelling. Two earlier formulations were wrong: *any step of the node* is too
  wide, and *the step the frame's cursor sits at* is simply wrong, because a
  call advances the caller's cursor past the guard before pushing the child.
  This check costs nothing across the whole corpus — not one existing file
  changes verdict — and it refuses exactly the files that were green and wrong,
  finding two errors in each where the fidelity rubric found one.
- **Name the move that emptied the frame stack**, not the first move to notice.
  One measured run went 34 → 36 → 36 → 36 → 36 errors and finished blaming the
  checker, when the whole fault was a spurious propagate one move earlier than the
  refusal pointed.

**The limit is stated, not hidden.** Structure is checkable and values are not.
An authored trace may claim any effect result and nothing contradicts it. The
skill says this where a reader will see it.

### The page

**The placement rule is tempo.** Every region is defined by how fast what it
holds changes, and each control sits with what it acts on.

| Region | Holds | Tempo |
| --- | --- | --- |
| Head | the run picker and the step controls | drives the run |
| Tools, the rail's header | zoom, layer, view, and the holds | changes how the sheet is **read**, and where a run stops; never moves the cursor |
| Rail, right | under the tools: call stack, arguments, error path, effects ledger | reads the trace; moves on every step |
| Cutaway, below | one node — source, files, contract | changes when a different node is opened |
| Footer band | title-block cells, sheet facts, the trace band | states the sheet; only the trace band moves |

Settled placements:

- **The tools are the rail's header, not a block.** One row per tool — zoom,
  layer, view, hold — with a fixed key column, so the rows read as a table of
  controls. They carry no frame of their own and no rules between buttons:
  they are the panel's own rows, on the header's ground. The live tool takes the tab treatment — label plus a
  bottom rule — not a filled chip, which this sheet uses nowhere. The layer
  row is built from the file, so its width is data. A row too long for the
  rail wraps under its first control.
- **The holds are the tools' last row** — hold: effect, error — at the top of
  the rail, over the blocks they watch. The head drives the run forward; the
  holds say where it stops.
- **No tool sits on the plan pane.** The drawing and the tree own all of it,
  so neither has a corner that a node or a row can go under. The tree has no
  pan, so a row under a tool would stay there. The rail takes the tools at no
  cost to the drawing, because the fit is height-bound. The rail pays instead:
  its header is sticky, so at a short window its blocks scroll under four
  rows of tools.
- **The view toggle switches the plan between the drawing and a tree.** The tree
  is the text format rendered from the same file and the same trace, on paper.
  Stepping works in tree mode; only the animation goes. Zoom has nothing to act
  on there and greys out.
- **The tree marks the error path, row by row.** At a cursor where an error is
  live, every row whose call site took part says which part: thrown,
  propagated, or caught. The tree is one row per call site, so it is the
  one view that shows the path as a path. Rows are matched by the site each
  error-path entry carries, never by node, so a node called from several
  places is marked only where the error went. The error reaching the top names
  no node, so no row carries it. Each position gets three channels, because a
  hue alone is gone on paper and for a colour-blind reader: a stripe inset
  down the row's left edge, a glyph before the name, and the word itself in a
  chip after it. The stripe goes on the left and not the right — a reader
  enters a row at its left edge, and that is where the rarest signal on the
  sheet belongs — just inside the row-state border, which is drafting order:
  the object outline outermost, its annotation within. `--text` prints the
  same positions, for an error still live at the end of the trace.
- **The stripe and the glyph say where the frame ended up, one word.** A frame
  that throws and then catches its own error is on the path twice; the rail
  lists both in order, and the row says `caught`, which is where it came to
  rest. That word is read off the row's filtered path and never off the fold's
  raw entries — the fold records a throwing frame as thrown and then as
  propagated as the error leaves it, so the raw last entry would strip the mark off the
  one row a reader looks for first.
- **The tree tells the frame the trace is in from the frames waiting under it.**
  The row states are `running` and `waiting`, and on a deep stack `waiting` is
  most of the rows. The running frame keeps the full-ink left rule; the ones
  waiting under it take
  the design system's state rule, which is ink 55 — a stroke that carries a
  signal is held to 3:1. Neither takes a hue: a position on the stack is not a
  condition. The row's four states are `not called`, `running`, `waiting` and
  `returned`, and `--text` prints the same four.
- **The sheet asks the design system for a role, never for a mark colour.** An
  error in flight and a failed effect are one condition and ask for the path;
  where the path stops and an effect that returned are resolved and ask for the
  caught role. Each theme answers in what it carries: amber and green in the
  deck theme, redline and plain ink in the site theme, where reaching for
  caution directly would have got ink and said nothing. The effect outcome
  wears the same chip as the path's word, at the same weight — it is a closed
  set, derived per call site, and it was already spending those two colours on
  an 11px word where they could not be seen. Not called is an absence and
  takes no chip, so every chip drawn means something.
- **The arguments block is read-only and is called arguments**, showing the run's whole
  input block including any injected fault. A field that looks editable and is
  not is worse than a value that never looked editable, and the player needs no
  per-frame scope at all.
- **The provenance stamp goes in the footer band.** Both alternative placements
  cost the same 22 pixels, because the stamp takes a second line in whichever
  title-block cell holds it; the band costs nothing and is already the row for
  sheet-level facts. Authored draws as a bordered caution stamp, captured as a
  nominal one — one of green's few honest uses.
- **The cutaway opens at 12rem.** Measured as the knee: the smallest cut that
  still shows a small node's whole tape. Ten clips a five-step node, and the
  tape is where the trace is read. The splitter still moves.
- **A help note hangs under the thing it describes.** It is centred under the
  thing, with its leader on the thing's middle, and it goes above when there
  is no room below. It is kept inside the window, and its leader stays on the
  thing when it is. A note hung from a thing's left edge and then clamped
  inside the window led to nothing the reader was pointing at, and the tools
  sit at the window's right edge.

Measured facts that govern the layout:

- **The fit is height-bound in every configuration.** Deleting the whole side
  rail changes the drawing's scale by 0%, so the rail is free and the argument
  for what goes in it is never about the drawing. The cutaway height is the only
  throttle.
- **The scale block speaks in ratios, never percentages.**
- **Pan and zoom are load-bearing.** The drawing does not fit at 1:1 in any
  arrangement.
- **A call site's remark is the only shrinkable element on its row**, and a short
  jump label is preferred over it. Everything else fits; one remark overflowed a
  row by 600 pixels on its own.

**The player may derive, never decide.** It pushes a frame, pops a frame,
appends a ledger row and moves a cursor. It evaluates nothing, and **the page
contains no dynamic code evaluation at all.** Everything else — the step
counter, what has been visited, which edges the run took — is derived by the
fold.

**The page holds the trace to the graph** before drawing it: a move naming a step
the node has not got, or a pop with no frame open, is refused rather than drawn.

### Author text on the page

**Every field an author writes is a stranger's text**, and the page shows a lot
more of it than the incumbent does: expressions, step remarks, effect
descriptions, error messages, run blurbs, layer tokens, file paths and reasons,
and a node's location.

**Two escapes, and each one states the context it is for.**

- **The embedded file.** The closing-tag sequence is escaped before the file is
  written into the page's script block, so no author string can close it. The
  same guard the incumbent has.
- **Text going into markup.** Escape `&` and `<` before author text reaches the
  page's markup, using the shared module so the page and the tests run the same
  function.

**The second escape is narrow, and it is only enough while no author text
reaches an HTML attribute.** That pairing is the incumbent's, it is written down
in this repository's security policy, and that policy states in as many words
what breaks it: an attribute that interpolates author text stops the escape
being enough, because the escape leaves the double quote alone.

**So this skill states the rule rather than inheriting it silently, because
groundtrack has a field the incumbent has not got: a node's location, which is a
path or a URL, and a URL is the thing most likely to be reached for as an
attribute.** Two rules follow, and they are a decision, not a note:

- **Author text goes into element content, never into an attribute.** Every
  interpolated attribute on the page holds a node id, an index, or a fixed class
  name.
- **If an attribute must ever carry author text, the narrow escape does not
  cover it.** A URL wants percent-encoding, which is what the site build already
  uses for the one href it writes. Widening the shared escape to cover quotes
  instead is a change to the security policy and is reviewed as one.

**Ids are validated rather than escaped**, on the incumbent's pattern: a node id
that does not match a plain lowercase-and-hyphen shape is refused by the
validator, so an id reaching an attribute is a known-safe string. *Amended in
implementation — see [Amendments](#amendments).*

**The page's own vocabulary is drawn from author-keyed maps** — node ids, layer
names, ambient value names, run input names. All four are author-chosen, so all
four are author text, and none of them is exempt because it looks like a key.

### The text output

**The text prints the graph with end marks, on request, for one run the reader
picks.**

- **One shared fold drives the page and the text**, so the two produce the same
  row list. This is what the claim *the same graph seen two ways* means, and it
  is the half that can be held to code. The other half narrows: the page moves a
  cursor and the text has none, so they are the same graph rather than the same
  artifact.
- **One row is a call site**, not a node. A node called twice appears twice.
- **A row carries** the name, the role, the three channels, the effect marks, the
  layer rename, the call site's label and its remark on its own line. Labels are
  sparse and remarks are long, so both are printed and neither alone is enough.
  The location, the parameters, the touched paths and the test files do not
  reach the text.
- **Layer renames go on the row**, not in a section per layer. A section per
  layer duplicates every row to change two strings.
- **It prints only when asked**, into the reply, in a plain text fence. Not a
  TypeScript fence: the block is not TypeScript and a highlighter colours the
  channel rows as keywords.
- **One line of provenance for the file**, above everything.
- **A repeated node is marked and stopped**, or the output does not terminate.
- **The skill suggests the longest trace.** It is the only rule that names
  exactly one run in all three worked programs with no tie. *The run that fails*
  names none where nothing throws; *the widest run* ties six ways.
- **Every run not printed is listed by name with the blurb its author already
  wrote.** Sixteen of sixteen runs carry one, so this derives nothing and is
  what lets a reader overrule the suggestion.

End marks are not decoration. Without them, all sixteen runs across the three
worked programs print byte-identical text within their file, which would make
the reader's choice of run change nothing.

### Where the files live

```text
skills/groundtrack/
  SKILL.md
  scripts/      the renderer, and the shared module it inlines
  references/   the shape document, and the trace-authoring rules
  assets/       the page template, and three vendored font faces
  examples/     the worked programs
```

The three named directories are the documented convention for a published skill:
executable code, documents loaded into context as needed, files consumed to
produce output. `examples/` is a fourth the convention neither names nor
forbids; a worked example is not a document an agent loads mid-task, it is a
file a reader opens.

**This overrides `eagle-eye`'s tree shape and nothing else.** The constraints
the mould carries stand: zero dependencies, self-contained under the skill
directory, and no fixed path anywhere. The sibling owes the incumbent no
consistency beyond that, carries nothing back to it, and no issue opens against
it.

**Two directories are called `scripts/` and that is accepted.** The root one
holds the repository's checks; the skill's holds its renderer. The path always
disambiguates, and `AGENTS.md` gets one line saying which is which.

**The shared module lives in the skill's `scripts/`.** *Not fixed by a ticket* —
the four directories are, the module's home is not. It goes there because it is
code: the renderer requires it and inlines it into the template, so the page and
the tests run the same function. This is the arrangement `eagle-eye` already
uses for the one function both its page and its tests need.

### The artifact is disposable

**A run writes its file and its page to scratch, never beside its input.** A
copy in the repository happens only when the reader asks for one.

This closes a measured accident on the incumbent: a plain render drops a page
beside its input, the ignore rules do not cover it, and one working tree carried
four untracked pages because of it. **The renderer therefore requires an output
path to write a page**; `--check` and the text output write nothing.

### Wiring into the repository

**Both root scripts take one registry: a table of artifact glob to renderer
path.** Today both hard-code the incumbent's glob and renderer, so until the
registry exists nothing validates a `.flightpath.json` and nothing publishes its
page. A third skill becomes a row rather than a branch in two files.

**The registry keys on repository-relative path, not basename.** The current
site walker keys on basename, so two artifacts sharing a file name resolve to
one output and the second silently overwrites the first. Publishing a second
artifact type makes that reachable.

**Source identity and output identity are two different keys, and only the
second can collide.** An artifact is identified by its repository-relative path,
so **two artifacts sharing a basename in different directories are both legal
and both publish** — that is the case path keying exists to fix, not to refuse.
The published page's name is derived from that path by flattening it, and **the
collision key is the derived name, compared case-insensitively.** Flattening is
not injective, so two different paths can still ask for one page; that is the
one case the build refuses, and it refuses before it renders anything rather
than overwriting. Case folding is in the key because the filesystem this site is
built from folds case, and two names differing only in case silently became one
file there.

**One worked example renders into the published site.** *Disposable by default*
governs what a reader's run leaves behind, not whether the repository shows what
the skill produces — and a page that steps over a trace is not something a
screenshot can carry.

**Fonts are vendored and inlined.** Three monospace faces ship in the skill's
assets and are inlined as data URIs, about 45 KB before encoding, against a
program file whose traces already cost a quarter of that. **The page makes no
network request at all.** The incumbent links a font CDN instead; a CDN link is
a dependency on somebody else's uptime, some hosts will not load one, and a
drawing whose monospace silently degrades is a worse drawing. The prototype
reads its faces from a fixed path on one machine, which the skill cannot do —
the fixed-path rule refuses it and the skill directory must be self-contained.
The faces are vendored, not read.

**The skill's prose is scanned, and the scan gates the merge.** This landed
after the map's tickets closed, so no resolution mentions it, and it binds this
work anyway: groundtrack is mostly prose an agent obeys, which is exactly what
the scanner reads.

Four things the implementation session needs to know before it writes a word of
`SKILL.md`:

- **One unsuppressed finding fails, at any severity.** There is no risk-score
  threshold and no severity floor — the scanner's own exit code answers *should
  I install this whole skill*, which is the wrong question for *did this change
  add something*. The baseline is the argument instead.
- **A suppression is keyed by rule identifier and carries a reason**, never by a
  fingerprint of the matched text. Fingerprints expire silently on the next edit
  of prose this repository rewrites constantly, and the root file declares an
  empty fingerprint list so nobody is invited to add one.
- **If any rule fires inside the skill directory, the skill needs its own
  baseline file at its top.** The scanner finds a baseline only at the top of
  the directory it was pointed at, and a reader who scans the skill before
  installing it is pointed at the skill, not at this repository. That is why the
  incumbent carries one.
- **A rule suppressed in a skill's baseline must appear in the repository root's
  baseline too, with the identical reason and the identical file scope.** The
  root check enforces all three, word for word, because a rule reasoned away in
  one file and not the other is a suppression nobody has read.

**Nothing is reworded to satisfy a pattern matcher.** Both existing baselines
say so in their own headers, and it is the rule that matters most here: a
finding on this skill's prose is answered with a reason in the baseline, or by
changing what the prose actually instructs — never by editing wording until a
regex goes quiet. A skill whose safety text was tuned to pass a scanner is the
failure the scan exists to catch.

**Registration needs no per-skill manifest.** The repository is the plugin and
the default scan reads one level of the skills directory. The skill's
frontmatter carries the invocation name. The plugin version moves, which the
version-bump rule forces on any change under `skills/` anyway. **Both manifest
descriptions currently name one skill and are rewritten to name both**, one
clause each — a plugin listing its own contents is not a skill naming outside
vocabulary, and a stranger deciding whether to install reads that line.

---

## Testing Decisions

### What makes a good test here

**Test what a reader or an agent can observe, at the surface they actually
use.** For this repository that is a process: arguments in, stdout, stderr and
an exit code out, plus whatever landed on disk. A test that reaches inside the
renderer to assert on an intermediate is a test that has to be rewritten every
time the renderer is tidied, and it proves nothing about the thing anybody runs.

The existing suite states the standard in its own header: the repository's own
check already proves a file renders without throwing, and what it cannot prove
is that the page is *right* and that a crafted file fails to inject script. The
tests exist for exactly the part the check cannot reach.

**Commit no artifact fixture into the tree.** Both root walkers find every
matching file, so a valid fixture would be published to the public site and an
invalid one would fail the check. Fixtures are derived from the shipped example
and written to a temporary directory at run time.

### The seams

**One new seam, and two existing ones reused.**

**Seam 1 — the renderer's command line.** New, and the only new one.

```text
node <skill>/scripts/render.mjs <topic>.flightpath.json
       --check          validate; refusals on stderr, exit 1; findings on stdout
       --out <page>     write one self-contained HTML file
       --text [<run>]   print the tree to stdout
```

Everything the skill does is observable here: every validator refusal, the
findings, the text output, and the page as a string on disk. The contract must
match what the root check already speaks — refusals on stderr with a non-zero
exit, the answer on stdout — or the registry cannot drive it without a special
case.

**Seam 2 — one shared module, required by Node and inlined into the template.**
Not a new surface; it is the arrangement the incumbent already uses for the one
function its page and its tests share, and the module's own comment says why: it
lives apart from the markup that calls it so that a test can reach it, and the
renderer inlines it so the page and the test run the same function.

This is what makes the trace fold testable. The repository takes no dependency,
so there is no headless browser and there never will be; the fold has to be
reachable from Node with no DOM. The prototype's own smoke test drove a real
browser through a package manager, which this repository cannot do.

**Seam 3 — the two root scripts, through their own command lines.** Existing and
already covered: each test copies the parts of the tree the script reads into a
temporary directory, breaks exactly one thing, and asserts the script says so.
The copy is not decoration — each script finds the repository root from its own
file location, so it cannot be pointed at a fixture any other way. The registry
is a data table and needs no seam of its own; it is exercised through both of
these.

**The seam count is deliberate.** Three seams, one of them new, and no new
surface invented for the page.

### What is tested where

**Through seam 1 — the renderer's command line**

- **The shape document and the validator agree.** The prototype's case list —
  52 claims binding the prose to the checker — becomes part of this
  repository's own suite rather than a separate script. That is what *the
  validator is the schema* has to mean in practice, and it is the only thing
  standing where a schema file would otherwise stand.
- **Every refusal fires on a file that breaks exactly that rule**, and the
  message locates the fault as precisely as the fault allows. **A file, and a
  reason, always.** The run and the move are carried **when the fault is in a
  trace**, which is what makes a refusal actionable there — the measured example
  reads `<file> / <run> [<move>] "<tag>" is uncaught, but <node>[<step>] declares
  onError for it`. A fault in the file's shape has no run and no move to name: a
  top-level unknown key and an empty optional list are both refused before a
  trace is read, and both locate to a path into the document instead. A contract
  that demanded all four fields would be a contract two of the required refusals
  could not satisfy.
- **An unknown key is refused**, including one that differs from a real key by a
  letter. This is measured, not theoretical: renaming one key in a shipped file
  took it from six findings to zero, exit 0 both times.
- **The empty optional list is refused** and the absent optional field is not.
- **The two shipped structural checks fire** — the uncaught tag with a handler
  in its way, and the refusal that names the move that emptied the stack — and
  **neither changes the verdict on any shipped example.** That second half is
  the one worth pinning: the check earns its place by costing nothing elsewhere.
- **Every shipped worked example validates.** The examples are the acceptance
  set, and the layer-carrying one exercises the toggle's both sides.
- **The text output** prints one row per call site, marks and stops a repeat,
  suggests the longest run, and lists the others with their own blurbs.
- **The page as a string:** the file is embedded, **there is no dynamic code
  evaluation**, and **the emitted page holds zero external references.** That
  last assertion is the inverse of the incumbent's, which pins its external link
  count at exactly one; here the count is zero, and a test that pins it is what
  keeps a convenience link from creeping back.
- **Author text cannot become markup or script**, tested per field rather than
  once. One fixture carries `<`, `&`, a double quote and a closing script tag,
  and it carries them in **every** author-written field the page shows: an
  expression, a step remark, an effect description, an error message, a run
  blurb, a layer token, a file path and its reason, and a node's location. Each
  reaches the page as text and closes no block. One field left out of that
  fixture is one field with no coverage, which is how the incumbent shipped a
  row name that reached the page as markup.
- **The escape's width is pinned, not just its behaviour** — `&` and `<` are
  escaped **and** the double quote passes through — so widening it or narrowing
  it back is a visible test change. The incumbent pins its escape the same way
  and its security policy explains why: the narrow escape is safe only while the
  attribute rule holds, so a silent widening hides the fact that the pairing
  moved.
- **No author text reaches an HTML attribute.** Stated as a limit rather than a
  claim: proving it needs a parse of the rendered page, and nothing in this
  repository parses one. Until something does, this is read by a reviewer, and a
  new `="${` in the template is a change to the security policy.
- **The argument parser**, at the level the incumbent's already is: a flag
  missing its value, a flag followed by another flag, and a repeated value all
  land at the usage line rather than in a stack trace.
- **A default render without an output path writes nothing** and says so.

**Through seam 2 — the shared module**

- **The trace fold** over a known tape: what the call stack holds at each move,
  what the ledger has collected, which nodes are unreached, and which edges the
  run took.
- **Stepping backward** returns the state stepping forward produced, move for
  move, including the reversed redraw of a call.
- **Cut-edge derivation** under a layer: a renamed token that appears in a call's
  arguments cuts that edge, and one that does not, does not. The shipped
  layer-carrying example cuts nothing, so this needs a derived fixture as well
  as the example.
- **The escape** used on author text, both halves of what it does and does not
  escape, in the same shape the incumbent's is pinned today.

**Through seam 3 — the root scripts**

- **The root check validates a `.flightpath.json`** and fails on a broken one.
- **The site build renders one**, and the index links it.
- **Two artifacts of different types sharing a basename in different directories
  both publish**, to two pages. This is the case path keying exists to fix, and
  a test that asserted a refusal here would pin the bug rather than the fix.
- **Two artifacts whose paths flatten to one page name refuse** rather than
  overwrite, and refuse before anything is rendered. Including two that differ
  only in case, which is the form that silently lost a page on the machine the
  site is built from.
- **The registry has a row for each artifact type**, and an artifact type with no
  row is reported rather than silently skipped. A gate that quietly does nothing
  reads as a gate that passed, and this repository has already written a commit
  about that.
- **The fixed-path rule covers the new skill**, including its non-markdown files.
- **The skill's own prose baseline agrees with the root's**, if the skill needs
  one: same rule identifiers, same reasons word for word, same file scopes. The
  root check already asserts this for the incumbent, and a second skill is what
  makes the rule worth having rather than a rule about one file.

### Prior art

Everything above has a model in the existing suite. The renderer suite drives
the incumbent's command line through a shared process runner that reports both
streams and the exit code rather than throwing, because a test about a gate that
fails needs the failure and not an exception. The check and site-build suites
copy trees into temporary directories and mutate one thing each. The escape
suite reaches one shared module directly. The runner already carries the guard
that stops the check and the suite from invoking each other forever, and the new
tests inherit it unchanged.

The suite runs on the test runner that ships with Node, under the same one
command as everything else, because a suite behind a command nobody is told to
run is a suite nobody runs.

---

## Out of Scope

- **The annotation layer's contrast.** The annotation ink is 3.53:1 on paper and
  carries every 11-pixel element on the sheet; ink at 0.64 alpha is the lowest
  that clears 4.5:1. Rendered both ways and ruled a design-system decision rather
  than this sheet's, because the ink ramp annotates by role and changing the
  annotation tier changes every page that uses it. Amber as text, at 3.05:1,
  goes with it. Nothing here is blocked on it, and the sheet still needs no
  fifth colour.
- **A second viewer.** The stepper prototype proved the engine and retires. One
  page ships. A recorded trace needs no reducer, so the prototype's engine stays
  retired even though stepping came back. The tree is not a second viewer: one
  page, one file, one trace, two renderings behind a toggle.
- **The live conversation as an input.** Nothing durable exists to check the
  graph against, so the honesty property the skill rests on disappears. A graph
  of what was just said is a claim with no source.
- **A recorder.** No offline runner ships. The measurement is in the
  implementation decisions above, and the residual it would buy back is one run
  in nine on a trace error, against making a graph error worse.
- **Any change to `eagle-eye`.** Not its layout, not its schema file, not its six
  divergences, not its unknown-key hole. Two unrelated skills making different
  calls is independence, not divergence.
- **Another skill calling groundtrack, or groundtrack calling another.** This
  repository's skills couple to no vocabulary they do not own. Pointing
  groundtrack at a plan already works, because a plan is durable material; that
  needs no trigger clause and no mention on either side.
- **A machine-readable schema file.** Stated here because the incumbent ships one
  and the obvious move is to copy it. The validator is the schema.

---

## Further Notes

**The entry-point rule is argued, not measured.** *An entry point is a changed
symbol that no other changed symbol calls* was derived from one real pull
request, where it gives the right answer. Nobody has run it against a diff and
compared the result to a hand-drawn answer. **This is the highest-value thing to
measure before the implementation session gets far**, and it is the rule the
whole slicing decision rests on.

**Two structural findings are deliberately left unplaced**, and the
implementation session decides where they go. Both are already computed by
working code from the file alone, with no run:

- **One file edited by several nodes.** The one finding of the three that is not
  a graph-versus-trace contradiction, so the argument for refusing it is weaker.
- **An `error` list declaring a tag nothing beneath it can produce.** The map
  reads this as folded into a refusal; the two checks that actually shipped are
  different rules, and the prototype surfaces this one as a notice. That
  mismatch is real and is why it is open.

The prototype surfaces both three ways — a count in the title block, the full
text in the open node's files view, and the declared ones in its contract view —
and two of the three fire on the shipped example. What is open is where they
belong, not whether they can be derived.

**A weak agent is unreliable at first-attempt authoring, and the loop only half
closes the gap.** With the validator in hand, eight runs in nine reach a clean
checker in a median of two passes, and valid-and-faithful moves from three in
nine to seven in nine. The residual is precise: **the loop repairs every fidelity
miss that is also a path error, and does not touch one that is not.** A
declared-but-unused handler is a perfectly legal path, so no refusal ever
mentions it. The uncaught-with-handler check moves exactly that class of error
into the structural half, where the loop demonstrably fixes it — measured end to
end on three fresh runs, one of which named its own cause at pass three and
finished green and faithful.

**Read the eval numbers as noisy.** Nine runs a round, and the first-attempt rate
swung from four in nine to one in nine across two rounds on the same tasks with
the same model. The convergence result does not lean on it. **All five rounds
came from one model family**; no other agent was reachable, and the procedure is
written to be harness-neutral so somebody can close that gap.

**Which programs ship as worked examples is reopened.** The set was chosen partly
on a claim that turned out to be false — a keyword search for mocking vocabulary
cannot see a double passed as a function argument, which is how the real ones go
in. The candidates are: the pull request whose program already exists, already
declares a layer map and is already the acceptance set; that one plus the change
whose failure story is an out-of-memory kill reaching no handler, which is the
clearest justification for the channel framing found anywhere in the search; or
all three from the original resolution, which is probably one more than a reader
needs. **This is the owner's call.**

**A synthetic example is available but never the primary.** It can be sized
perfectly and tuned to show off a channel, and it gives up the one property the
skill rests on: durable material a sceptical reader can go and check. An invented
program has an unfalsifiable layer map and a trace that replays against nothing.

**The incumbent breaks the naming rule this spec inherits, in seven places**, and
that is tracked as its own issue rather than as part of this work.

**The evidence is on branches, and none of it is a merge base.** The prototypes,
the three worked programs, the shape document, the checker, the case list and
five rounds of eval output all live under prototype branches on this repository.
They are what the decisions were made against. The skill does not exist yet, and
nothing there is written to be merged.

---

## Amendments

Written by the implementation session that built the skill, in the same series
as the build, and by the sessions that have changed the skill since. The
instruction was to amend this file rather than contradict it in silence. The
build's own amendments come first; a later one goes at the end.

**A node id is letters, digits and hyphens, not lowercase and hyphens.** The
prose above asks for a lowercase-and-hyphen shape. This document's own layer
example writes `bindSheet` and `buildShelf` as node ids, and all three worked
programs use camel case throughout — so the file contradicted itself, and one
of the two halves had to give. The pattern shipped is
`^[A-Za-z0-9][A-Za-z0-9-]*$`. The property the rule exists for is unchanged:
an id reaching an HTML attribute is still a known-safe string, and the double
quote, the angle bracket and the space are all still refused. What is bought
back is the id matching the symbol it names, which is what a sceptical reader
checks the drawing against.

**The two unplaced structural findings are findings, not refusals.** *One file
edited by several nodes* and *an `error` list declaring a tag nothing beneath it
can produce* are printed on standard output under `--check`, and the exit code
stays zero. Neither is a graph-versus-trace contradiction, so refusing a file
for either would refuse a file that says exactly what its author meant. Several
nodes editing one file is the ordinary shape of a change where one file carries
two concerns, and the shipped example fires it five times.

The second finding needed one change to be worth printing at all. The
prototype could read an effect's failure set off the step, because its
intermediate representation gave an effect a `failWith`. The locked shape
removes that field on purpose, so nothing in the steps says which tags an
effect can throw. Read from the steps alone the rule fires on every effect that
can fail, which is most of them. **So the rule reads the traces as well**: a node
produces a tag if it throws it, if a step of it declares a handler for it, or
if one of its effects threw it in a trace this file carries. That is still
computed from the file alone — a trace is part of the file — and it takes the
shipped example from one false finding to none.

**The layer cut is the argument list and nothing else.** The prototype also cut
every call the renamed node itself makes. That is a node rule wearing a token
rule's clothes, and *a layer renames a token, never a node* rules it out. It
also disagreed with this document's own testing decision, which states that the
shipped layer-carrying example cuts nothing. With the clause removed, it does.

**One worked example the spec left open was never written.** *Which programs
ship as worked examples is reopened* names three candidates, and the middle one
is "the change whose failure story is an out-of-memory kill reaching no
handler". No program for that change exists on any branch — it was found in a
search and never written up. So the shipped set is the acceptance set
(`pr-313`), the plan (`map-300-woodwork`, which is where both
failure causes and an uncaught tag actually appear), and the small
`greet` example that uses every move kind in thirty-two moves. The panel-apply
program stayed on its branch while a file could hold one graph; it is now the
second graph of `pr-313`, which is what makes that example the first two-sheet
file the skill ships. **This remains the owner's call**, and changing the set is
a one-file change.

**The entry-point rule is still unmeasured.** *An entry point is a changed
symbol that no other changed symbol calls* ships as written, in `SKILL.md`.
Measuring it is a design activity rather than an implementation one, and it did
not happen here.

**The vendored faces are IBM's own subsets, and there are six of them.** The
spec says *three monospace faces ship in the skill's assets and are inlined as
data URIs, about 45 KB before encoding*. That number came from three faces the
prototype had cut down by hand, and they could not ship.

The licence names `Plex` as a Reserved Font Name, and it defines a Modified
Version to include a derivative made by deleting components. A face subset by
hand is therefore a modified version, and a modified version may not use the
reserved name — which both the page's `font-family` and the files' own name
tables did.

IBM publish per-script subsets themselves, and an original version distributed
by the copyright holder is not a modified version. So the skill ships IBM's
`Latin1` and `Pi` subsets for each of the three weights, unmodified: six files,
about 94 KB before encoding, each declared under the `unicode-range` IBM
declares for it. Latin1 carries the text; Pi carries the one arrow the tree and
the source view draw. The full licence, IBM's own copy with their copyright
line, ships beside them as `OFL.txt`.

**Everything the spec asked of the fonts still holds.** They are vendored, they
are inlined, the page makes no network request, and no fixed path is named. The
only figure that moved is the byte count, and it moved because the smaller one
was not licensed to ship.

**The files tab is a directory tree, and its third group is the sheet's.** The
three groups are unchanged — this node, other nodes, and the change on no node —
but each is grouped by directory rather than printed flat, and a directory
holding one thing collapses into the line below it. The acceptance set puts
fourteen files in the third group, which as a flat list is fourteen rows of
docs, tests and source interleaved, and as a tree is four folders. The change
kind moved from a word to a one-letter mark, and the tab's help text says what
the four marks mean; the `why` moved from its own line to a comment trailing the
path. The third group is labelled *in the change, on no node of this sheet*,
which is the same set as before and says whose set it is, so that a file holding
several sheets cannot have its per-sheet list read as the change-wide one. The
grouping is a pure function in the shared module, because the tab is built at
runtime and the rendered page as a string cannot show what it draws.

**A file states one change, not one graph.** This document is written
throughout as though a flightpath file were one graph and its traces. It is now
one change: the id, the title, the blurb, the changed files, the sheet rule,
the ambient values, the layers and one node map at the top level, and a
`graphs` array beneath them. A graph is an entry point and the runs from it,
and its drawing is whatever that entry reaches through call edges. Node ids are
unique across the change and a node belongs to no graph, so a symbol two graphs
reach is defined once. Run names are unique per graph.

Nobody argued for one graph per file; the record shows it came from the
prototype. The evidence for the change is measured duplication — the two
`pr-313` programs define two of the same nodes, and each file repeated the
change facts — and a finding, *a file in the change that no node accounts for*,
that was true of one graph and silent about the rest. The decision was settled
in an eagle-eye box of nine rows, and no edge in the box reaches the chosen
set: the array, the single node map and the rest are choices with a cost each.
Only the status quo carried forcing edges.

**The old shape is refused rather than accepted alongside.** A file with a
top-level `entry` or `presets` fails with a message naming `graphs`. This
document's own rule that a file has one way to say one thing rules out
accepting both. The three shipped examples migrate: each has one entry today,
so each becomes a one-graph file with the same nodes, the same runs, the same
layers and the same findings.

**Two additions to the validator, and no trace rule changed.** A trace is proved
against the graph it belongs to, entering at that graph's entry. A graph whose
`entry` is not in the node map is refused. A node no graph's entry reaches is a
*finding*, exit zero, for the reason the other two structural findings are
findings: it is not a graph-versus-trace contradiction, and a node written and
not yet connected is a work in progress rather than a mistake.

**Every refusal now carries a path into the document.** A shape fault prints
the path alone, because it is refused before any trace is read and there is no
run or move to name. A trace fault prints the path and then the graph, the run
and the move in words, because counting into two arrays to find
`graphs[1].presets[0]` is work a person should not have to do. The rule that a
refusal names the move that emptied the frame stack, not the first to notice,
is unchanged.

**`--text` takes `--graph <id>`.** On a one-graph file it prints exactly as it
did. On a file stating several, without `--graph` it lists the graphs, one line
each, and exits non-zero. Nothing ranks them and nothing suggests one, which is
the rule `SKILL.md` already states for choosing a graph to draw.

**The tempo table gains a sheet picker.** The head holds the sheet picker, the
run picker and the step controls. A sheet picker changes slower than a run and
changes everything beneath it, so it sits to the left of the run picker. The
picker itself, and per-sheet page state, are a separate ticket; what shipped
here is the page reading its graph through one accessor rather than off the
file root, and a one-graph file showing no picker at all.

**The head is two rows: identity above, the run's controls below.** The tempo
table puts the pickers and the step controls in the head and says nothing about
their arrangement; the head was one flex row because two controls fitted on one.
Three do not — a run picker wide enough to read a run's blurb crowds the title
off a narrow screen, and the blurb is where a reader learns what they are about
to step. So the first row is the lockup and the second is the sheet picker, the
run picker and the step controls, in the order a reader chooses them: the sheet,
the run on it, then the moves of that run. Nothing moved between regions and the
tempo table is unchanged.

The run picker takes whatever the row has left rather than a fixed cap. Every
other control on it is as wide as its content, so it is the one thing there with
a reason to grow, and it shrinks below its content too — a narrow window narrows
the box, and the step controls wrap under it rather than off the edge.

The root grid's first column became `minmax(0, 1fr)` with it. A track's
automatic minimum is its content, so the widened picker grew the column instead
of shrinking itself, and a narrow window got a horizontal scrollbar. Nothing on
this page wants a content floor — the plan and the cutaway both clip their own
overflow.

**The picker landed, and a sheet is what its entry reaches.** A file stating
several graphs draws one at a time and lists the rest by title in the head. A
one-graph file shows no picker, because a control that does nothing is worse
than no control. Each sheet keeps its own run, cursor, layer, view and open
node, so a reader returning to a sheet finds it as they left it; a sheet opened
for the first time is fitted to the pane the way the first one is.

The picker is rendered into the page rather than built by the page's script.
Every other control on the head row is built at runtime, which is why no test
could ever count one — and *one control per graph, or none* is exactly what
this ticket owes. So the markup is a function in the shared module, spliced in
at render time, on the same bargain the files tab already makes. A graph title
is author text and goes through the escape into element content; a graph id is
validated against the id pattern before it reaches an attribute, in the module
as well as in the validator, because a page can be rendered from a file the
validator has not seen.

**What is on a sheet is the entry's reachable set, and three things say so
together.** The spec left this open and the shape ticket named it: either a
sheet draws only the graph's own nodes, or it draws the whole map with the rest
cold. It draws the graph's own. `layout` places the reachable set; the files
tab's second group — *other nodes on this sheet* — is read through the same
set; and the cold ink has nothing left to say about a node that is not there,
so it keeps the one job it had, which is a node a *layer's* cut has stranded.
No shipped example reports an unreached node, so no one-graph drawing moved.

**The files tab's third group is the sheet's; the check's finding is the
change's.** That is this document's own pairing — story 28 asks for the third
group *labelled as this sheet's, so that I do not take a per-sheet list for the
change-wide one*, and story 29 asks the check for the change-wide one — but it
had not been read that way, because before this ticket a sheet was the whole
node map and the two sets were the same on every shipped file.

They come apart on a two-sheet file, and the tab has to be the sheet's for the
three groups to cover: narrow the second group to the sheet and leave the third
change-wide, and a file only the *other* sheet's nodes touch is in neither, with
no label anywhere saying where it went. Measured on the migrated example:
`shelf-settings.ts` is the panel-apply sheet's and appeared nowhere on the
first-paint one. All three groups are the sheet's now, so every file the change
states lands in exactly one of them on every sheet, and `--check` still reports
across the whole change — a file one graph covers is not reported because
another does not.

The prior claim that the tab and the check *must not be able to disagree* was
written while a file drew one graph, and it is withdrawn. They ask different
questions, this document asks both, and on a one-graph file they still have one
answer.

**The shipped pull-request example is one change on two sheets.** `pr-313`
gains the panel-apply graph the prototype branch carried, so the acceptance set
exercises the picker and the shared node map for real. Its two shared symbols,
`resolveWoodwork` and `applyWoodFibre`, are defined once, and the prototype's
traces were re-indexed onto the shipped definitions: the shipped
`resolveWoodwork` carries two `comment` steps the prototype has not got, and the
shipped `applyWoodFibre` calls `fibreMapFor` where the prototype inlined the
bake. The three nodes only the second graph reaches were given the `touches`
the prototype lacked, which is what takes `shelf-settings.ts` off the
unaccounted list — the change-wide finding, answered by a graph the old file
could not state. The file's `graphsNotDrawn` is now empty: a sibling sheet is
never a graph not drawn.

The file's title and blurb are the change's, and the first-paint graph's blurb
is the one the file used to carry. The file is `pr-313.flightpath.json`, since
it is no longer one entry point's.

**Two small readings follow the sheet rather than the change.** The footer's
`nodes` count is what this sheet draws, so a reader can count the boxes and
agree with it; `--check` still says how many the change has, and the two differ
on a two-sheet file on purpose. And the band gained one line that is the
sheet's: the graph's `blurb`, a required field that until now printed nowhere.
The band's other three facts are the change's and are still stated once. The
band moved into the shared module to be tested at all, on the same bargain the
files tab makes.
