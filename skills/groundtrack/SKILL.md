---
name: groundtrack
description: Use for a plan already made or work already done, when a reader needs to see its shape — what calls what, what each part hands back, where it breaks, and what it needs to work. Writes one call graph with recorded traces through it, renders a self-contained page, and prints the same graph as an indented tree on request. Not for a conversation with nothing durable behind it.
---

# groundtrack

A reader who did not write a change cannot see its shape. A change arrives as a
list of files. A plan arrives as a list of tickets. Neither says what calls
what.

groundtrack turns durable material into a call graph a reader can step through.
You read the material and write one file by hand. A renderer turns that file
into one self-contained page.

**Stance.** The drawing is a claim, and the material is what holds it. You draw
what the material says. You say so when the drawing goes past it.

## When to use

- A plan already made, or work already done, and a reader needs its shape.
- The reader asks what calls what, what a part returns, or where it can break.
- The reader asks by name.

**Do not use it on a conversation.** Nothing durable exists to check the graph
against, so the one property this skill rests on disappears.

## What it takes in

**The rule is a property, not a list.** groundtrack accepts durable material
you can read, plus a file set.

That admits a written change, an unbuilt plan, a named function or region, and
a bare path into a codebase.

The source usually states the file set. A change states it. A plan's file list
states it. **When the source states none, ask the reader for it.** Never invent
a bound the reader did not choose.

## The three channels

Every node carries three channels, and they are the point of the drawing.

- **success** — what flows out of the node.
- **error** — where it breaks: the tags it can throw as a **fail**. A **die**
  never appears in this list.
- **requirements** — what it needs to work.

The two failure kinds are different facts. A fail is an expected error, and a
caller is meant to catch it. A die is a defect, and nothing is meant to catch
it. A process killed for running out of memory reaches no handler, so nothing
logs it. The debugging session drops where the data was worth having. The
`error` list is where a reader sees that in advance.

## Procedure

1. **Read the material.** Follow the calls. Do not draw from the file list.

2. **Cut it into graphs.** One graph per entry point, where an entry point is a
   changed symbol that no other changed symbol calls. Seventeen files do not
   fit on one graph.

   **This rule is argued, not measured.** It was derived from one real change,
   where it gives the right answer. Nobody has run it against a set of changes
   and compared the result to a hand-drawn one. So read your own cut before you
   show it: if a graph comes out with one node, or with everything in it, the
   rule has told you something you should say out loud rather than draw.

3. **List every graph you found, and let the reader pick.** Say the list before
   you draw anything, so the reader can disagree with the cut before the work
   rather than after it. **Rank nothing and suggest nothing.** No rule for
   ranking graphs has ever been measured, so a score here would put an
   undecided default in front of every reader. A run that is not told which
   graph to draw asks.

4. **Write one file for the change.** One file states the change: its title,
   its blurb, its changed files, its sheet rule, one node map, and a list of
   graphs. A graph is an entry point and the runs from it, so a second graph is
   an entry named rather than a second file. A symbol two graphs reach is
   defined once.

   Read [`references/flightpath-file.md`](references/flightpath-file.md) for
   the shape, and
   [`skills/groundtrack/examples/greet.flightpath.json`](examples/greet.flightpath.json)
   for a complete legal file. Write the nodes and the graphs first. Validate.
   Then write the traces, one at a time.

5. **Validate, read the refusal, fix, repeat.** See
   [`references/writing-traces.md`](references/writing-traces.md) for the loop and
   for the two mistakes measurement says you will make.

6. **Read every finding, and answer each one.** `--check` exits zero and still
   prints its findings, because a finding never refuses. A clean checker is not
   a finished file.

   Answer a finding in one of two ways. Fix the file, or write one line saying
   why the finding is what you meant. A node you have written and not yet
   connected is a finding you write the line for. You usually fix an `error` tag
   nothing beneath it produces. Draw what throws the tag, or drop a tag the
   program never throws.

   Both answers are legitimate. Never skip this step. **Give the reader the
   findings you kept**, each with the line you wrote for it. A reader who never
   sees the finding cannot disagree with your answer.

7. **Render the page**, and say where it is.

8. **State the limit.** The validator proves the trace is a legal path. It
   cannot prove which branch an `if` took or what an effect returned. Those
   stay your claims. Say this when you hand the page over.

## Where the run writes

**Write the file and the page to a scratch directory.** Never beside the input.
A page dropped next to the file it was made from is an artifact nobody asked
for and nothing cleans up.

**Copy either one into the repository only when the reader asks.** The artifact
is disposable by default.

The renderer will not write a page without an output path, for the same reason.

## The command line

```bash
node <skill>/scripts/render.mjs <topic>.flightpath.json --check
node <skill>/scripts/render.mjs <topic>.flightpath.json --out <page>.html
node <skill>/scripts/render.mjs <topic>.flightpath.json --text ["<run>"] [--graph <id>]
```

`<skill>` is the base directory this skill was installed into. Ask the harness
for it. Never write a fixed path.

| Flag | What it does |
| --- | --- |
| `--check` | Validates. Refusals on standard error, exit 1. Findings on standard output, exit 0. |
| `--out <page>` | Writes one self-contained HTML file. |
| `--text ["<run>"]` | Prints the tree to standard output, for one run. |
| `--graph <id>` | Which graph `--text` reads. Refused with `--check` and `--out`, which both read every graph — the check validates them all, and the page carries them all and picks between them. |

**A file with several graphs needs the graph named.** `--text` on a one-graph
file prints as it always did. On a several-graph file without `--graph` it
lists the graphs, one line each, and stops. **Nothing ranks them and nothing
suggests one**, which is the same rule as step 3: a run that is not told which
graph to read asks.

## The page

The page draws one graph and steps a cursor over one recorded trace.

**A file with several graphs is one page with several sheets.** The head holds
two rows: the title above, and below it the sheet picker, the run picker and the
step controls. The sheet picker lists each graph by title. A one-graph file
shows none.

A sheet draws what its entry reaches through call edges. Write a symbol two
graphs reach once; both sheets draw it.

Each sheet keeps its own run, cursor, layer, view and open node. Leave a sheet
and come back and it is as you left it.

Nothing is computed while the reader watches. Every branch an `if` took, every
value an effect returned, and every catch is a literal in the file. That is
what makes the trace a list of checkable claims.

The reader steps forward and back, holds the run on the next effect or the
next error, reads the call stack and the effects ledger, opens one node to see
its body, and flips between the drawing and a tree.

The cutaway follows the cursor. Each move opens the node the trace is in and
brings the step that ran into view. A node opened by hand stays open until the
cursor next moves.

The source tab marks each line with what the run did to it. It marks four
kinds of line. The first is the line the cursor is on. The second is a line in
a frame still running or waiting. The third is a line that ran. The fourth is a
line the run never reached. The last is the one worth having — an untaken
branch is the first thing a reader interrogates, so it stays legible rather
than being hidden. A call or an effect also carries its outcome, and only
once the run has given it one. A token is coloured because the run touched
it, never because of what it is.

The files tab reads as a directory tree, so a change of many files reads as a
few folders. A directory holding one thing prints on one line. Each file leads
with its added and removed lines and ends with how it changed — **new**,
**modified**, **deleted** or **forbidden** — and the `why` you wrote trails the
path the way a comment trails a line of code.

Its last group is every file in the change, not the ones no node accounts for.
The first two groups leave each other's files out, so without it a reader could
not see where one node's file sits in the whole change.

The wheel scrolls the drawing. With ctrl held it zooms about the pointer.

The contract tab states one number per node: its cyclomatic complexity, as
drawn. One, plus one for each `if`, each error handler and each backward jump.
It measures the drawing, and the drawing is what you chose to draw.

The page makes no network request. Open it by double-clicking, or send it to
somebody else.

## Cutting a large change

Three things reach the page so a reader can audit the cut.

- **The scope rule the run applied**, so the reader can disagree with it.
- **Files in the change that no node accounts for**, by name. A
  documentation-only part of a change is not silently dropped. It reads every
  node of the change, so a file one graph covers is not reported because
  another does not.
- **Graphs found and not drawn**, each named with why it is worth a draw. Found
  and in no sheet of this file: a graph the file carries is drawn, so it is
  never listed here.

Those last two stay two separate statements. They are different failures, and
merging them loses which is which.

## Layers

A layer redraws the same graph under a different set of dependencies. The test
layer is the obvious one.

**A layer renames a token, never a node.** The geometry is untouched, so the
redraw computes nothing. A real double goes in at the call site, through a
parameter with a real default, so the requirement is renamed and the node
stays.

Flip the toggle. A node that still reaches the real network under the test
layer is a design defect you can see, rather than a sentence you have to trust.

A layer may state its own entry. Everything the call edges cannot reach from it
draws as unreached.

A file that declares no layer map disables the toggle and says why.

## The text output

**Print the tree only when the reader asks for text.** Print it into the reply,
in a plain text fence.

- **Name the graph when the file states more than one.** `--graph <id>`. Asked
  without it, the command lists the graphs and stops rather than picking for
  the reader.
- **One row is a call site**, not a node. A node called twice appears twice.
- **A repeated node is marked and stopped**, or a cycle never terminates.
- **An `error` tag carries its failure kind when the file states one**, `fail`
  or `die`.
  The renderer derives the kind from the file's `throw` steps and `raised`
  objects. The `error` list never states it. A tag the file gives no kind
  for prints bare.
- **Suggest the longest trace.** It is the only rule that names exactly one run
  in every worked example, with no tie.
- **List every run you did not print**, by name, with the blurb its author
  wrote. The reader overrules your suggestion from that line alone.
- **Print one line of provenance above everything**, so the reader knows
  whether they read a claim or a recording.

## The honesty property, and its limit

The material is durable, so a sceptical reader can go and check the drawing
against it. That is the whole reason this skill prefers real material over a
tidy invented example.

The validator proves the trace is a legal path through the graph the file
declares. **It cannot prove which branch was taken or what an effect
returned.** Those stay the author's claims.

Say the limit. Do not let a page imply a check it did not make.
