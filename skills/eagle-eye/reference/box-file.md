# The box file in detail

This file holds the detail behind the brief, the rows, the presets, the tour
and the renderer's checks. `SKILL.md` holds the steps and the stops.

## Contents

- An example brief (questions 4, 9, 15)
- Challenge the premise with a row (questions 10, 16)
- The problem statement (questions 10, 15)
- Presets in detail (questions 4, 17)
- The tour in detail (question 4)
- What the renderer checks (questions 3, 4)
- Common mistakes (questions 16, 17, 18)

## An example brief (questions 4, 9, 15)

> **problem.** The gate blocks a merge when a build is red. Nobody has said who
> must be able to clear it. A maintainer can fix almost anything, and a
> first-time contributor with a fresh clone cannot. This box decides the reader
> the standard is written for, the remedy it promises them, and who reviews the
> promise.
> **who.** Every contributor who opens a pull request, and the two maintainers
> who answer them.
> **when.** Before the next release, because the release note repeats the
> promise.

## Challenge the premise with a row (questions 10, 16)

The brief says why the box exists. The box never tests that statement. Every row
carries a strawman, so a reader can attack its options. The reason for the whole
box carries none.

**Draw the premise as an ordinary row.** Its cells are *solve it*, *defer it*
and *do it by hand*. They exclude each other, and each one combines with the
cells of every other row. The row test passes.

This row needs no new concept. Strawmen, edges and all seven findings work on it
today. The *strawman not rejected* finding then also covers the premise. The
renderer does not enforce this row. Draw it when the premise deserves a test.

## The problem statement (questions 10, 15)

This section is about a **row**. For the box, see "The brief" in `SKILL.md`.

**Every row carries a `problem`: what this decision is about, for a reader who
does not know the domain.** A row name is a handle, not an explanation.
*"Reachable by whom"* tells a newcomer nothing, and neither does a one-line
`question` that uses a term they have not met. The page opens the **In
short** block with it, above the derived state.

This is the one part of a row nothing can derive. The renderer can count
options, name what requires what, and report the conflict. It cannot say why
anybody is choosing.

Two to five sentences, under the writing rules. Cover:

- **The terms the row uses.** Define the ones a stranger has not met.
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

## Presets in detail (questions 4, 17)

A preset's `reframe` is optional, and it is not the `text`. The `text` says
what the reader sees. The `reframe` says what the box now decides. The page
prints the `text` above the steps. It prints the `reframe`
in the brief, under the problem, while that preset still describes the grid.
The reader's own pick stops it, so a sentence written for one configuration
never shows over another.

> *The strawman run.* **text:** Set the strawman and open the row it closes.
> **reframe:** The problem becomes whether anything in the box rules the weak
> answers out.

**Do not write a Reset step.** The page resets when the reader picks the
preset, so a first step that only resets spends their first click on
housekeeping. `reset` stays valid in the schema for a preset that returns to
the baseline part-way through; it is not how one starts.

**A step that only sets `view: 'findings'` does nothing**, because that is the
view already. To send the reader back from an open row, close the row in the
same step: `{ open: null, view: 'findings' }`. Use `view` on its own only for
`'sheet'`.

## The tour in detail (question 4)

A stop names a `region` and writes `now`. It may change options with `set`, open
a row with `open`, and pick the `view`. A stop states its whole page. What it
leaves out is the default: the chosen set, no row open, the findings view.

The regions are `views`, `presets`, `coach`, `export`, `reset`, `index`,
`verdict`, `start`, `findings`, `cards` and `sheet`.

The renderer refuses a stop whose state does not show its region. The sheet
needs `"view": "sheet"`. The option cards need a row open. The brief and the
findings need no row open. The page turns coach off during the tour. When the
tour ends, the page puts back the reader's options.

## What the renderer checks (questions 3, 4)

It warns on a row with no `problem`, on a row with no strawman, and on a
strawman that is the chosen option.

**The box's `problem` and a row's `problem` are two fields.** The renderer
refuses a box that has no `problem`. It warns about a row that has none. The
two messages name different places: `problem:` for the box, `dims[i]` for a
row.

**A strawman can be the chosen option.** The *strawman not rejected* finding
says: give the reason to reject it, or pick it. Picking it is the second
answer, and it is the interesting one: the weak option survived the whole
grid. Keep the flag set and say in `notes` why it survived. The flag records
coverage, never quality.

No validator can tell a dimension from a menu of positions, and none can tell
you a row is missing. One mechanical check would help and does not exist yet:
warn when a single option rules out options across most of the other rows,
because that cell is usually a position.

## Common mistakes (questions 16, 17, 18)

Each mistake names the failure from question 16 that it causes.

- **Drawing an edge you cannot say why for.** The grid colours on it as if it
  were measured. Write the why or drop the edge. (Failure 1, wrong edges.)
- **Marking an argued edge as sourced.** Sourced means a named document says
  it. Name it in `src` or it is argued. (Failure 1.)
- **No strawmen.** The *strawman not rejected* finding is the one that changes
  minds most. A row without one has nothing to test the chosen option against.
- **A row name written for the people already in the room.** *"Reachable by
  whom"* is a handle. Write the `problem` so a stranger can read the row.
- **A row that lists positions instead of dimensions.** *Build it / document
  it / leave it* is three answers, not one decision. The grid then
  reproduces those three and produces nothing new. (Failure 5.)
- **More questions after the person accepts the chosen set.** Each one is a
  row you did not draw. Add the row; do not carry it in prose. (Failure 3.)
- **Recommending in prose instead of drawing the box.** A paragraph that says
  "that would need a backend" is an edge nobody can click. The same fault
  appears as an answer you recommend that is not a cell anywhere.
- **A preference drawn as a constraint.** "The owner wants depth tuning" is
  not an edge. Put it in `notes`, or in `suspected`. (Failure 1.)
- **Presets that all walk the chosen set.** Four tours of the baseline teach
  the reader one configuration. Give at least one preset a `set` step.
- **Saying an id in chat.** *"deb-chat"* names nothing to the reader. Say the
  row name and the `short`. (Failure 7.)
- **Acting on a restore code without saying it back.** The person pastes ids
  they cannot check by reading. Say the set back in words first, or a misread
  becomes the record. (Failure 7.)
- **Changing the set before you check the edge that blocks it.** An argued
  edge can be wrong, and then the set holds as it is. Check the edges behind
  each conflict first. (Failure 1.)
- **Reading each edge and never the chain.** Sound edges can join into an
  unsound argument. The *chain* finding names the join. Read it. Then say
  whether the box states the relation it derives. (Failure 1.)
- **An audit score written into the box, or used to change a tier.** A score
  says which edge to reread. It is not a verdict. (Failure 6.)
- **Changing the export format in one place.** The page writes it; `SKILL.md`
  specifies it; you read it. All three, or none.
