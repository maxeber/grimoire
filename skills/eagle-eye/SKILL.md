---
name: eagle-eye
description: Use when a discussion holds three or more open decisions and one choice changes what is possible in another — during brainstorming, a design review, or any walk through a plan one decision at a time — or when the user asks for an eagle-eye view, a morphological box, or invokes /eagle-eye. Not for two independent choices.
---

# Eagle-eye

A decision is made once it has been seen against the whole system. This skill
lays coupled decisions out as a **morphological box** (Zwicky): one row per
decision, one cell per option, and an **edge** between options that rule each
other out or require each other. A page reads any configuration back: what
fights, what is missing, and seven findings that point at what you have not
looked at.

**Stance.** The user's thinking is the product; the box is the receipt. You
draw the box so they can see the system. You do not pick for them.

## When to use

- Three or more open decisions, and picking one changes what is possible in
  another. Two independent choices never earn a box.
- A discussion asks one question at a time. A grid asks them all at once.
- Every clarifying question has an answer. Nobody has proposed an approach yet.
- A plan holds tickets that each settle one decision. Those tickets are the
  rows.
- The user asks by name. Some tools map a command to it: `/eagle-eye <topic>`.

Say it before you build it: *"This has N coupled decisions. I will build a
box."* A wrong trigger costs one sentence.

## Depth follows the row count

| Rows | Output |
|---|---|
| 2–3 | A markdown table in chat, edges listed under it. No file, no page. |
| 4–14 | A box file and the rendered page. |
| 15+ | Split into clusters. One box each. |

## What earns a row

**A row is a dimension of the problem. It is not a list of the answers somebody
already proposed.** The cells of one row must combine with the cells of every
other row. That property is what makes this a box and not a table: the grid
produces configurations nobody wrote down, and one of them is often better than
every option that was offered.

Test each row before you write it: **can two of its cells be true at the same
time?** If yes, it is not a row. A row asserts that its cells exclude each
other, and the page enforces that assertion. Draw it anyway, and the box forbids
a combination that is available.

So **a whole position is a preset, not a cell.** *Option 1*, *option 2* and *do
nothing* from a ticket are three configurations of the real dimensions. Put them
in `presets`. The reader then clicks each one and sees what it costs.

One smell catches this late: a single option that rules out most of the other
rows. A cell that closes half the box is usually a position, not an option.

## Procedure

1. **Brief.** Write the `problem`: what this box decides, for a reader who does
   not know the domain. Add `who` and `when` if you can. See
   [The brief](#the-brief). The renderer refuses a box with no `problem`.
2. **Rows.** Name each decision and give it a **`problem`** — see
   [The problem statement](#the-problem-statement). Apply
   [What earns a row](#what-earns-a-row) first: a menu of positions is not a
   row. List the options that were actually on the table, each with a `src`
   (ticket, document, chat turn). Then add **strawmen**: for each row, ask
   *none / opposite / later / by hand*, and add the ones that are not absurd,
   flagged `strawman: true`. An option somebody proposed can still be the *none*
   or the *later* answer — flag it anyway and keep its `src`. The flag records
   coverage; `src` records who proposed it. The renderer warns on a row with no
   strawman and on a row with no `problem`.
3. **Edges.** For each option: what it rules out (`conf`), what it requires
   (`req`). Each edge carries one sentence of *why* and a **tier**:
   `measured` (somebody ran it), `sourced` (a document says so — name it),
   `argued` (your reasoning). No edge without a why. An edge inside a row is a
   swap, not an edge.
4. **Audit.** Check every `argued` edge against the eight weakness patterns
   (see `reference/writing-edges.md`). Flag each edge that fails the check. A
   flag tells you which edge to reread first. It is not a verdict.

   **A tool can rank the argued edges first.** `audit.mjs` sits next to this
   file, in the skill base directory. Before you offer it, ask it whether a
   key is in the environment:

   ```bash
   node <skill base directory>/audit.mjs --probe
   ```

   The probe prints `yes` or `no`, and it sends nothing. Treat any other output
   as `no`. On `no`, or with no `audit.mjs`, say nothing about the audit.
   When the user asks for the audit and the probe says `no`, run the audit. It
   sends nothing. It prints the steps to set a key, and you give those steps to
   the user. Never ask for the key. Never write it into a file.

   On `yes`, run the audit with `--dry-run` first. It sends nothing. It prints
   how many requests a real run sends, and their rough size. Then say one
   sentence to the user. It states three facts: the audit is available, it
   sends this box's text to the model provider, and the number of requests.
   Never state a price, because the provider sets it and can change it. Offer
   the audit once in a conversation. Run it only when the user
   says yes. Skip the question only when the user already said yes in this
   conversation. Your instructions can also give that yes.

   ```bash
   node <skill base directory>/audit.mjs <scratch>/<topic>.box.json
   ```

   The tool compares each argued edge with controls that it builds from the
   sourced and measured edges in the box. It flags an edge that scores among
   those controls. A box with too few such edges gets a ranking with no flags,
   and the tool says so. A score never changes a tier. Never write a score into
   the box file. A second run sends only the edges that changed.

   Give each flagged edge one disposition, and say it in chat:

   - **Rewrite** the `why` so the link is explicit.
   - **Suspect** it: move it to `suspected`, with the pattern named at the
     front.
   - **Keep** it, and give the reason.

   A rewrite that adds a factual claim names a `src`, or the edge stays
   `argued`. Audit the rewritten edges again, and only those. Stop after two
   rounds. The audit stops when every flagged edge has a disposition. It never
   stops on a score.

   A `suspected` edge is listed on the page but colours nothing. Its string
   keeps the pattern, the edge, the reason, and the rejected `why` word for
   word. That string is the only record after the session ends. A later test of
   the audit needs the rejected `why`, and the reason alone cannot rebuild it.

   The renderer walks the **chains** for you. The *chain* finding names the
   longest run of edges that compose, the relation it derives, and whether the
   box states that relation. The *cycle* finding names the options that require
   each other. Read both findings. Then answer two questions: is the derived
   relation true, and does the box say it? A relation nobody wrote is a hidden
   constraint. Add the edge, or write the reason in `notes`. See
   [Chains](reference/writing-edges.md).
5. **Chosen set.** Mark one option per row as the current position. Say whose
   it is: the spec's, the owner's, or your recommendation.
6. **Presets.** Write at least two, and make at least one of them change an
   option. The renderer refuses a box without them. See [Presets](#presets).
7. **Render and read.** Write `<topic>.box.json` to a **scratch directory** —
   the temporary path your tool reports, or the system temporary directory.
   **A box is disposable.** It is the working surface for one conversation, and
   the decision it produces belongs in the project's records, not the grid that
   found it. See [Where a box lives](#where-a-box-lives).

   Run the renderer. It sits next to this file, in the skill base directory
   your tool reports when it loads this skill. Join that directory to
   `render.mjs`. Do not write a fixed path. **Lead the findings in chat with
   the problem, in your own words.** The renderer prints it first for that
   reason. A finding names two rows that exclude each other. The problem says
   what the reader loses either way. Then give the findings:

   ```bash
   node <skill base directory>/render.mjs <scratch>/<topic>.box.json
   ```

   Open the HTML it writes in the user's browser (`Start-Process <file>` on
   Windows, `open` on macOS, `xdg-open` on Linux). A preview pane inside a tool
   may show local files as static snapshots with no script; do not judge the
   page from one. If your tool can publish or share a file, offer that as well;
   the page works without it. To read a configuration without a browser, use
   `--sel`.
8. **Round trip.** The page has **Export**. The user pastes the Markdown back.
   Read the restore code, then **say the set back in words before you act on
   it** — one line per changed row, `<row name>: <short>`. The user pastes ids,
   which they cannot check by reading. The echo is where they catch a misread.
   Then re-argue the set, and update the box file only with what the user
   confirms. `--sel` reads a restore code from the command line:

   ```bash
   node <skill base directory>/render.mjs <box.json> --sel "eagle-eye: opt-a, opt-b"
   ```

   **When a set does not hold, check its edges before you change it.** The
   user often asks how to make a set hold. `--sel` prints each conflict and
   each requirement not met, with the edge's `why` and tier. Check each of
   those edges against the eight weakness patterns first. A wrong edge makes a
   good set look broken, and it is the cheapest fix. Give each weak edge one
   disposition, as in step 4. Then propose a change to an option for what
   still fails.
9. **Debrief.** When the user accepts a set, close the loop in chat. Three
   things, in three or four sentences:

   - **Which weakness patterns appeared.** Read `suspected`, where every
     rejected edge carries its pattern name. Count them and name the ones that
     repeat.
   - **What got stronger.** Name the row that changed most between the first
     box and the last, and say what changed it.
   - **One thing to watch next time.** The pattern that appeared most often.

   The audit names a pattern each time it rejects an edge. Those names reach
   the chat and stop there, so the next author repeats the same faults. This
   step is where the box teaches. Say it in words, never in ids.

## The seven findings

The page and `--check` compute these. Six read the configuration in front of
you. The seventh, *chain*, reads the whole box. The author makes a chain, and
the reader cannot, so the finding does not change when the reader clicks. In
chat, give the ones that apply.

| Finding | What it points at |
|---|---|
| row not opened | A row with edges to the rows you changed on the page, that you did not open. It reads your clicks, so an edit to `chosen` in the box file is not a change it can see. |
| weakest edge | The lowest-tier edge the verdict depends on. Measure this one first. |
| most connected | The selected option with the most edges. Change it and the most moves. |
| row with no edges | Independent, or an edge is missing. |
| strawman not rejected | A strawman nothing rules out. Give the reason, or pick it. |
| chain | Two or more edges that compose. Names the relation they derive, and says whether the box states it. Options that require each other report as a *cycle*. |
| evidence for the verdict | *If every edge is true, can the set still be wrong?* Counts the argued edges among the active ones. Names each row whose active edges are all argued. Past three rows it gives a count instead. |

## When the box is finished

**Test it by acceptance.** Ask yourself: if the user takes the chosen set as it
stands, is the decision made? Any question you can still put to them is a row
you did not draw.

**Run that test at the moment the user agrees.** *"The chosen set is good"* ends
the session. If you answer it with more questions, the box did not hold the
whole problem, and those questions name what is missing. Rebuild the box before
you write anything else down.

The failure is quiet, because each new question looks like the next round of a
good conversation. It is not. A round moves outward from a settled row; a
question with no row is a hole. Ask where in the grid it would go. If the answer
is nowhere, add the row.

## The brief

**Every box carries a `problem`: what the whole set decides, for a reader who
does not know the domain.** The renderer refuses a box without it. A row's own
`problem` explains one decision. Nothing else explains the set. A reader who
opens a kept box a month later then sees row names and a grid, and no question.

Write the brief first, before the rows. It is the test for each row. A row that
serves no part of the problem does not belong in the box.

**The page prints the brief** at the head of the findings list, under the title,
so the reader meets it before the findings that argue about it. An open row
hides it. That reader has already asked a narrower question, and the option
cards take the pane. The export carries the problem, and `--check` prints it
before the verdict. Write it for a stranger: every one of those readers may be
one.

Two to five sentences, under the [Writing rules](#writing-rules). Cover:

- **The decision, and what forces it now.** Name the terms a stranger does not
  know.
- **The fixed constraints.** Name what the rows must not move.
- **The cost of no decision.** Say what goes wrong while the question stays
  open.

Write the problem, not your answer. The chosen set carries the answer.

**Two optional fields follow it.** Write one plain sentence for each.

- **`who`** names the people the decision affects. There is no people model, so
  write a sentence, not a list of roles.
- **`when`** names the date for the decision. The renderer reads no date, so
  *"not known"* is a valid answer. Write it when the date is open, because
  silence tells a reader that nobody must decide.

> **problem.** The gate blocks a merge when a build is red. Nobody has said who
> must be able to clear it. A maintainer can fix almost anything, and a
> first-time contributor with a fresh clone cannot. This box decides the reader
> the standard is written for, the remedy it promises them, and who reviews the
> promise.
> **who.** Every contributor who opens a pull request, and the two maintainers
> who answer them.
> **when.** Before the next release, because the release note repeats the
> promise.

### Challenge the premise with a row

The brief says why the box exists. The box never tests that statement. Every row
carries a strawman, so a reader can attack its options. The reason for the whole
box carries none.

**Draw the premise as an ordinary row.** Its cells are *solve it*, *defer it*
and *do it by hand*. They exclude each other, and each one combines with the
cells of every other row. The row test passes.

This row needs no new concept. Strawmen, edges and all seven findings work on it
today. The *strawman not rejected* finding then also covers the premise. The
renderer does not enforce this row. Draw it when the premise deserves a test.

## The problem statement

This section is about a **row**. For the box, see [The brief](#the-brief).

**Every row carries a `problem`: what this decision is about, for a reader who
does not know the domain.** A row name is a handle, not an explanation —
*"Reachable by whom"* tells a newcomer nothing, and neither does a one-line
`question` that leans on a term they have not met. The page opens the **In
short** block with it, above the derived state.

This is the one part of a row nothing can derive. The renderer can count
options, name what requires what, and report the conflict — it cannot say why
anybody is choosing.

Two to five sentences, under the [Writing rules](#writing-rules). Cover:

- **The terms the row rests on.** Define the ones a stranger has not met.
- **Why the choice exists at all.** What forces it, and what is already fixed.
- **What turns on it.** What a reader gets wrong by picking carelessly.

Write the *problem*, not your answer. The options carry the answer, and the
edges carry the argument.

> *Reachable by whom.* The rule for a gate says a red build must have a remedy
> somebody can reach. It never says who that somebody is, and the answer
> changes everything. A maintainer can fix almost anything. A first-time
> contributor with a fresh clone cannot. This row names the person the standard
> is written for, because "reachable" without a reader decides nothing.

`question` stays what it was: the decision in one line, under the row name. The
`problem` explains it.

## Presets

**Every box carries at least two, and at least one of them changes an option.**
The renderer refuses a box that does not. A grid on its own shows the chosen set
and nothing else, so the reader never learns which *other* configuration is worth
opening. A preset is the author saying: look at this one, and here is why.

A preset is a title, a one-sentence `text`, and steps run in order from chips on
the page. A step sets options, opens a row, switches view, resets, or turns coach
mode on. The page prints the `text` above the steps.

**A preset may also carry a `reframe`: one sentence that says what the problem
becomes here.** It is optional, and it is not the `text`. The `text` says what
the reader sees. The `reframe` says what the box now decides. The page prints it
in the brief, under the problem, while that preset still describes the grid. The
reader's own pick stops it, so a sentence written for one configuration never
shows over another.

> *The strawman run.* **text:** Set the strawman and open the row it closes.
> **reframe:** The problem becomes whether anything in the box rules the weak
> answers out.

Pick from these archetypes. The first is cheap; the rest are what earn the box.

| Archetype | What it shows | Steps |
|---|---|---|
| **As chosen** | The current position, row by row. | Open the two or three rows that carry the argument, then close the last one. |
| **The break test** | What the *most connected* option holds up. | Set that one option, open its row, read the cascade. |
| **The strawman run** | Whether a strawman really is absurd. It is often consistent, which is the finding. | Set the strawman, open the row it closes. |
| **The cheap route** | The lowest-cost configuration, and what it gives up. | Set each cheap option, read the requirements not met. |
| **The strict route** | The most conservative configuration, and what it forbids. | Set each strict option, read the ruled-out list. |
| **Coach** | Prediction before recognition, on one change. | `coach: true`, then one step with `predict: true`. |

**Do not write a Reset step.** The page resets when the reader picks the preset, so a first step that only
resets spends their first click on housekeeping. `reset` stays valid in the schema for a preset that returns
to the baseline part-way through; it is not how one starts.

**A step that only sets `view: 'findings'` does nothing**, because that is the view already. To send the
reader back from an open row, close the row in the same step: `{ open: null, view: 'findings' }`. Use `view`
on its own only for `'sheet'`.

**Title the configuration, not the verdict.** *The break test* and *Adopt
nothing* tell the reader what they are about to see. *Optimal* and *maintainable*
state the answer the box exists to test.

## Coach mode

Opt-in, on the page. After an override the grid stays uncoloured until the
user predicts which rows are affected, then reveals. Prediction before
recognition. Do not turn it on for them; name it once.

## Where a box lives

**Scratch by default. The repository only when the user asks.**

A box is a working surface. It holds the argument while the argument is live,
and the argument ends when the user accepts a set. What the project needs after
that is the decision and its reasons, in the form the project already uses. A
committed box file asks every later reader to learn a grid to read one choice.

**Disposable is not ephemeral.** The file exists for the whole session, because
`--sel` and the round trip both read it. Disposable means the file leaves no
trace in the repository, not that it never existed.

**Keep it when the user asks, and only then.** Then write it where the project
keeps its decision records (`docs/decisions/`, `docs/adr/`, or wherever they
are), and say the path. A kept box is a record the project now maintains.

Say which one you did. *"The box is in scratch at <path>. Say the word and I
will keep it."* One sentence, at the end of step 7.

## Names in chat

**An id is machine state. It belongs in the box file and in the restore code,
and nowhere else.** Say the row name, then the option's `short`:

> *Where the debrief lands: In chat.*

Never *"deb-chat"*. The reader did not write the ids, cannot see the file while
you speak, and an id that reads as an abbreviation of something teaches them a
word that means nothing. This applies to findings, recommendations, questions,
and the debrief. The renderer already prints names; match it.

The schema requires `short` on every option for this reason. The renderer
refuses a box without one, so the name always exists.

Two places keep ids, because both are machine state the user copies whole: the
restore code and the box file. When you read a restore code back, say the set
in words first. See step 8.

## Writing rules

All text in a box — labels, whys, notes — follows ASD-STE100's writing rules,
tested against ISO 24495-1. Active voice. Present tense. One instruction per
sentence. Twenty words or fewer. No idiom, no metaphor, no `-ing` verb forms.
Re-anchor a coined term when you reuse it. Full rules and the weakness
patterns: `reference/writing-edges.md`.

## Box file

Shape in `box.schema.json`; a complete example in
`examples/eagle-eye-skill.box.json` (the skill's own design, boxed). The
renderer validates: a box-level `problem`, unique ids, exactly one `chosen` per
row, every option has a
`short`, edge targets exist and sit in another row, tier in {measured, sourced,
argued}, a non-argued edge names its `src`, every edge has a why, and two or
more presets of which one changes an option. `who`, `when` and a preset's
`reframe` are optional, and a present one must not be blank. It warns on a row
with no `problem`, on a row with no strawman, and on a strawman that is the
chosen option.

**The box's `problem` and a row's `problem` are two fields.** The renderer
refuses a box that has no `problem`. It warns about a row that has none. The two
messages name different places: `problem:` for the box, `dims[i]` for a row.

**A strawman can be the chosen option.** The *strawman not rejected* finding
says: give the reason to reject it, or pick it. Picking it is the second
answer, and it is the interesting one — the weak option survived the whole
grid. Keep the flag set and say in `notes` why it survived. The flag records
coverage, never quality.

**What it does not check is the part that goes wrong.** No validator can tell a
dimension from a menu of positions, and none can tell you a row is missing. Both
tests are yours: [What earns a row](#what-earns-a-row) before you write the box,
[When the box is finished](#when-the-box-is-finished) after the user reads it.
One mechanical check would help and does not exist yet — warn when a single
option rules out options across most of the other rows, because that cell is
usually a position.

## Export format

What the page produces and what you read back. Change both together.

```markdown
## eagle-eye · <title> · N changes · <verdict>

**Problem.** <the box's problem statement>

| # | Decision | Chosen | My choice |
...
### Conflicts / Requirements not met / Ruled out / Findings
Restore code: `eagle-eye: <opt-id>, <opt-id>`
```

The **Problem** line carries the brief into the paste. A pasted block that names
rows and a verdict, and never the question, reproduces on the clipboard the
failure the brief exists to fix.

The restore code is the full state: every option id that differs from chosen,
comma-separated. `none` means the chosen set. The page also keeps it in the URL
hash (`#sel=`), so a link is a configuration.

On the page the restore code and the **Load** field both stay open, and only the
Markdown folds behind a disclosure. Reading a configuration back is the frequent
move; the full Markdown is the rare one, so that is what hides. **That is layout,
not format** — the block above is unchanged, and Copy still copies all of it.

## Common mistakes

- **Drawing an edge you cannot say why for.** The grid colours on it as if it
  were measured. Write the why or drop the edge.
- **Marking an argued edge as sourced.** Sourced means a named document says
  it. Name it in `src` or it is argued.
- **No strawmen.** The *strawman not rejected* finding is the one that changes
  minds most. A row without one has nothing to test the chosen option against.
- **A row name written for the people already in the room.** *"Reachable by
  whom"* is a handle. Write the `problem` so a stranger can read the row.
- **A row that lists positions instead of dimensions.** *Build it / document it /
  do nothing* is three answers, not one decision. The grid then reproduces those
  three and generates nothing. See [What earns a row](#what-earns-a-row).
- **More questions after the user accepts the chosen set.** Each one is a row you
  did not draw. Rebuild the box; do not carry the missing rows in prose. See
  [When the box is finished](#when-the-box-is-finished).
- **Recommending in prose instead of drawing the box.** A paragraph that says
  "that would need a backend" is an edge nobody can click. The same fault
  appears as an answer you recommend that is not a cell anywhere.
- **A preference drawn as a constraint.** "The owner wants depth tuning" is not
  an edge. Put it in `notes`, or in `suspected`.
- **Presets that all walk the chosen set.** Four tours of the baseline teach the
  reader one configuration. Give at least one preset a `set` step.
- **Saying an id in chat.** *"deb-chat"* names nothing to the reader. They did
  not write the ids and cannot see the file while you speak. Say the row name
  and the `short`. See [Names in chat](#names-in-chat).
- **Acting on a restore code without echoing it.** The user pastes ids they
  cannot check by reading. Say the set back in words first, or a misread
  becomes the record.
- **Changing the set before you check the edge that blocks it.** An argued
  edge can be wrong, and then the set holds as it is. Check the edges behind
  each conflict first. See step 8.
- **Reading each edge and never the chain.** Sound edges can join into an
  unsound argument. The *chain* finding names the join. Read it. Then say
  whether the box states the relation it derives.
- **Changing the export format in one place.** The page writes it; this file
  specifies it; you read it. All three, or none.
