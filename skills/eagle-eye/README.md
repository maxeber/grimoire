<p align="center">
  <img src="../../docs/brand/eagle-eye-card.svg" width="100%" alt="eagle-eye — coupled decisions, as a morphological box">
</p>

# eagle-eye

**A decision is made once it has been seen against the whole system.**

Most tools ask about one decision at a time. That works until the decisions
are coupled: picking the cheap database changes what the deployment can be,
which changes who can be on call. A list of questions then hides the thing you
need to see.

eagle-eye draws a **morphological box** instead. One row per decision. One
cell per option. An **edge** between two options that rule each other out, or
that require each other. Then it renders a page that reads any configuration
back.

**Live example: [the decision to publish this repository][demo].** Click an
option and watch the grid recolour. That page was written by the skill, about
itself.

**[Take the tour of the page →][tour]** Open the skill's own design box and
press `Tour` at the top right. It walks the page one region at a time, changes
one option, and shows the verdict move.

The two sheets below are drawn from that box and its tour, so they say what
the page says. The first is the page after one option changes, with every
region numbered and every pane it hides until you click. The second is the
tour's walk.

<p align="center">
  <img src="../../docs/brand/eagle-eye-skill-sheet-1.svg" width="100%" alt="The eagle-eye page on the skill's own design box after one option changes to Prompt-only, with each region numbered and named in a parts list, and the option cards, the sheet, the export box and the coach prediction drawn as separate views">
</p>

<p align="center">
  <img src="../../docs/brand/eagle-eye-skill-sheet-2.svg" width="100%" alt="The eagle-eye tour, stop by stop: the page at each stop that changes it, with the region the stop explains framed and what the reader sees there written under it">
</p>

[demo]: https://mephistopheles4.github.io/grimoire/
[tour]: https://mephistopheles4.github.io/grimoire/skills-eagle-eye-examples-eagle-eye-skill.html

## Use it

Ask for it by name:

```text
/eagle-eye <topic>
```

Or let it offer. On three or more open decisions, where at least two are
coupled (one choice changes what is possible in another), it says how many it
sees and asks before it builds a box. Two independent choices never earn a
box, and it stays out when you ask for the quick route.

## What the page tells you

Seven findings. Six read the configuration you are looking at. The seventh
reads the box itself.

| Finding | What it points at |
| --- | --- |
| row not opened | A row with edges to the rows you changed on the page, that you did not open. |
| weakest edge | The lowest-evidence edge your verdict depends on. Measure this one first. |
| most connected | The option with the most edges. Change it and the most moves. |
| row with no edges | Independent, or an edge is missing. |
| strawman not rejected | A deliberately weak option that nothing rules out. Give the reason, or pick it. |
| chain | Edges that join into a relation, and whether the box says that relation itself. A cycle reports on its own. |
| evidence for the verdict | If every edge is true, can the set still be wrong? Names the rows whose active edges are all argued. |

## Why the edges carry a tier

Every edge states **why**, and every edge is `measured`, `sourced`, or
`argued`. An argued edge is your reasoning, and the page colours on it exactly
as hard as it colours on a measurement. Naming the tier is how you find out
that a confident-looking verdict rests on three guesses.

## Run the renderer by hand

No install, no dependencies. Node 24 or later:

```bash
node skills/eagle-eye/render.mjs <box.json> --out page.html
```

| Flag | What it does |
| --- | --- |
| `--check` | Validates a box and prints the findings. Writes no file. |
| `--out <page>` | Writes one self-contained HTML file. |
| `--sel "row: opt-a, opt-b"` | Reads a configuration from the command line. |

## What is in this directory

| Path | What it is |
| --- | --- |
| [`SKILL.md`](SKILL.md) | The skill. The prose an agent follows, generated from its contract. |
| [`CONTRACT.md`](CONTRACT.md) | The terms the skill is generated from. Change this, not `SKILL.md`. |
| [`render.mjs`](render.mjs) | The renderer and the validator. |
| [`audit.mjs`](audit.mjs) | An optional audit of the argued edges. It ranks them, so you know which to reread first. It sends the box's text to the model provider, and only when you run it with a key. The provider charges each request to that key. |
| [`box.schema.json`](box.schema.json) | The shape of a box file. |
| [`lib/`](lib) | The one module the page and the tests both run. |
| [`reference/`](reference) | How to write an edge, the edge audit, and the box file in detail. |
| [`examples/`](examples) | A complete box: the skill's own design, boxed. |

The renderer names no fixed path to itself, so this directory runs from
wherever it lands.
