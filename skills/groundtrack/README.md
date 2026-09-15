<p align="center">
  <img src="../../docs/brand/groundtrack-card.svg" width="100%" alt="groundtrack — a plan or a change, as a call graph you can step through">
</p>

# groundtrack

**A reader who did not write a change cannot see its shape.**

A change arrives as a list of files. A plan arrives as a list of tickets.
Neither says what calls what, what each part hands back, where it can break, or
what it needs in order to work.

groundtrack turns durable material into a call graph a reader can step
through. The agent reads the material and writes one `<topic>.flightpath.json`
by hand. That file states one change: one node map, and a list of graphs, each
an entry point with recorded traces from it.
A zero-dependency renderer turns it into one self-contained page.

## The three channels

Every node carries three channels, and they are the point of the drawing.

- **success** — what flows out of the node.
- **error** — where it breaks: the tags it can throw as a **fail**. A fail is
  an expected error a caller is meant to catch. A **die** is a defect nothing
  is meant to catch, and it never appears in this list. The kind prints beside
  the tag in the tree, the text output and the contract tab. The renderer
  derives it from the file's `throw` steps and `raised` objects. A tag with
  neither prints bare.
- **requirements** — what it needs to work.

## Use it

Ask for it by name. The installer route keeps the plain name; the plugin route
namespaces it:

```text
/groundtrack <a plan, a change, a path>
/grimoire:groundtrack <a plan, a change, a path>
```

It works on a plan already made or work already done. It does not work on a
conversation, because nothing durable exists to check the graph against.

## The page

The page draws one graph and steps a cursor over one recorded trace. Nothing is
computed while you watch. Every branch an `if` took, every value an effect
returned, and every catch is a literal in the file. That is what makes the trace
a list of checkable claims rather than a program you have to believe.

A change with several graphs is one page with several sheets. On the page you
can:

- **Pick a sheet**, when the file states more than one graph. The sheet picker,
  the run picker and the step controls share the head's second row, under the
  title. A sheet draws what its entry reaches, and keeps its own run, cursor,
  layer, view and open node.
- Step forward and back, play the run, and hold it on the next effect or the
  next error.
- Read the call stack, the arguments, the error path, and the effects ledger.
- Open one node in the cutaway: its steps, the files it touches as a directory
  tree, and its contract. The cutaway follows the cursor while the run plays.
- Read the steps as a listing that carries the run: which lines executed, which
  branch never ran, and how each call and effect turned out.
- Flip between the drawing and a tree. Pan by dragging or with the wheel; zoom
  with ctrl and the wheel.
- Redraw the graph under a **layer**. Flip to the test layer, and a node that
  still reaches the real network is a design defect you can see.

The page makes no network request. Three monospace faces ship with the skill
and are inlined into it.

## Run the renderer by hand

```bash
node skills/groundtrack/scripts/render.mjs <topic>.flightpath.json --check
node skills/groundtrack/scripts/render.mjs <topic>.flightpath.json --out page.html
node skills/groundtrack/scripts/render.mjs <topic>.flightpath.json --text [--graph <id>]
```

| Flag | What it does |
| --- | --- |
| `--check` | Validates. Refusals on standard error, exit 1. Findings on standard output, exit 0. |
| `--out <page>` | Writes one self-contained HTML file. |
| `--text ["<run>"]` | Prints the same graph as an indented tree, for one run. |
| `--graph <id>` | Which graph `--text` reads. A file stating several needs one named; asked without it, `--text` lists them and stops. Refused with `--check` and `--out`, which both read every graph — the page carries them all and picks between them. |

`--text` gives the answer in a reply and the answer on the page as one graph
seen two ways.

The file's shape is in
[`references/flightpath-file.md`](references/flightpath-file.md), and the
validator is what enforces it. No machine-readable schema ships, because a
second artifact that can silently disagree with the first is not worth having.

## What is in this directory

| Path | What it is |
| --- | --- |
| [`SKILL.md`](SKILL.md) | The skill. The prose an agent follows. |
| [`scripts/render.mjs`](scripts/render.mjs) | The renderer, the validator, and the text output. |
| [`scripts/groundtrack.js`](scripts/groundtrack.js) | The one module the page and the tests both run. |
| [`references/flightpath-file.md`](references/flightpath-file.md) | The shape of a flightpath file. |
| [`references/writing-traces.md`](references/writing-traces.md) | How to write a trace, and the two mistakes measurement says you will make. |
| [`examples/`](examples) | Three complete files: a small one that uses every move kind, a real pull request with a test layer, and a plan of sixteen tickets. |
| [`assets/`](assets) | The page template and the three vendored faces. |

## The honesty property, and its limit

The material is durable, so a sceptical reader can check the drawing against
it. The validator proves the trace is a legal path through the graph the file
declares. **It cannot prove which branch was taken or what an effect
returned.** Those stay the author's claims, and the skill says so rather than
hiding it.
