# Writing edges

An edge is a reason. A reason can be wrong in eight ways. An edge colours the
grid, so a wrong edge is worse than no edge.

## Tiers

| Tier | Means | `src` |
|---|---|---|
| `measured` | Somebody ran it and saw the result. | Required: what was run, when, the number. |
| `sourced` | A named document states it. | Required: the document, section, or ticket. |
| `argued` | Your reasoning. Nobody checked it. | Optional. |

A tier is a claim about evidence, not about confidence. An argued edge you are
sure of is still argued.

## What an edge can say

- `conf`: if both options are selected, the set does not hold.
- `req`: if this option is selected and the target is not, the set is
  incomplete.
- Several `req` edges from one option are **all required** (AND). There is no
  "requires one of". To say *"needs A or B"*, draw `conf` edges to every option
  in that row that is **not** A or B. The grid then rules those out, and A and
  B stay open.
- An edge is one-directional. A `conf` drawn once is enough; the page
  de-duplicates the reverse if you draw both.
- Target in the same row: not allowed. Choosing one option in a row already
  excludes its siblings.

## Writing rules (ASD-STE100, writing rules only)

1. Active voice. *"The hook reads coverage"*, not *"coverage is read by the hook"*.
2. Present tense for facts. Imperative for instructions.
3. One topic per sentence. One instruction per sentence.
4. Twenty words or fewer. Twenty-five for a descriptive sentence at most.
5. No `-ing` verb forms as nouns or adjectives. *"Measure it"*, not *"measuring is needed"*.
6. No idiom, no metaphor, no analogy. *"pull one thread"*, *"rests on"*, *"fights"* are out.
7. Noun clusters of three words at most. *"per-function coverage figure"* is the limit.
8. Re-anchor a coined term every time it returns: *"the substrate (the shared walking layer)"*.
9. Use the same word for the same thing. Do not vary for style.
10. Write the qualifier, then the point. Never a slogan alone.

Test (ISO 24495-1): can the reader find it, understand it, and use it? A why
that needs a second reading fails.

## The eight weakness patterns (audit every argued edge)

From the TDE method. Name the pattern when you reject an edge; it teaches the
next author.

| Pattern | The edge… | Fix |
|---|---|---|
| **wrong** | states something false. | Drop it, or measure it. |
| **weakly connected** | is true but does not produce the conflict or requirement it claims. | Rewrite the why so the link is explicit, or drop it. |
| **disconnected from context** | would hold in general but not in this system. | Add the context to the why, or drop it. |
| **biased** | exists because the author prefers one option. | State the preference in `notes`. Not an edge. |
| **opinionated** | asserts a judgement as a fact. *"X is the right way"*. | Rewrite as the observable consequence. |
| **disrespectful** | dismisses an option rather than describing its cost. | Describe the cost. |
| **insufficient** | needs a second reason to hold, and the second reason is not written. | Write it, as its own edge if it has its own target. |
| **vague** | could mean two things. | Pick one. |

An edge that fails and cannot be fixed goes to `suspected`: a plain string
that the page lists but that colours nothing.

## Chains

An edge is one reason. A chain is two reasons in a row. The TDE method calls a
set of reasons **cohesive** when each reason extends the one before it. The
audit above reads one edge at a time. The *chain* finding reads the join.

**Only a `req` first edge composes.**

| First | Second | Composes | What the pair derives |
|---|---|---|---|
| `req` | `req` | yes | The source **requires** the far option. |
| `req` | `conf` | yes | The source **rules out** the far option. |
| `conf` | anything | no | The source removes the target from the set. The target's own edges never fire. |

That last row is the one that misleads. Count every pair where one edge's
target is the next edge's source, and the example box — 27 edges — reports 15
chains. Apply the rule, and it reports none.

A chain can hold more than two edges. Each `req` edge carries the run forward,
and one `conf` edge closes it. A run of `req` edges derives *requires*. A run
closed by a `conf` edge derives *rules out*.

**The renderer walks the chains. You answer the two questions.** The *chain*
finding names the longest run, the relation it derives, and whether the box
states that relation. Then ask:

- **Is the derived relation true?** If it is not, one edge on the path is
  wrong. This is the `weakly connected` pattern across a path.
- **Does the box say it?** A derived relation that nobody wrote is a hidden
  constraint. Add the edge, or say in `notes` why the path is enough.

**A cycle is its own finding.** Option A requires B, and B requires A. The pair
is one mutual dependency drawn twice, and the finding reports it once. A longer
loop, through three options or more, reports the same way. Either the rows in
the loop are one decision, or one direction is redundant. Say which, in
`notes`.

## Cogency test

After the audit, ask the user once: *"If every edge in this box is true, can
the chosen set still be wrong?"* The answer is the list of edges that are
missing.

Cohesion and cogency are the pair. Cohesion asks whether the reasons join.
Cogency asks whether the joined reasons reach the verdict.

The page reports this test under a plain name: **evidence for the verdict**. It
counts the argued edges and names the rows whose active edges are all argued.
*Cogency* is the name in the method, and this document is where the method is
explained. The page uses the plain name.

## The suspected list

An edge that fails the audit goes to `suspected`. **Name the pattern first, so
the debrief can count it:**

```text
weakly connected: coh-step req deb-chat — a manual check does not force a manual record. Why: "The check is manual, so the record is manual too."
```

The pattern name, then the edge, then the reason. Then `Why:` and the rejected
`why`, word for word, in quotes. The box file keeps this after the session
ends, so it is the only record of what the audit rejected.

**Keep the rejected `why`.** A reason says what was wrong. It does not say
what the edge said. A later test of the audit compares its scores against real
rejected edges, and only the original sentence gives it one.

## Strawmen

For every row, before edges, ask four questions:

- **none** — do not do this at all.
- **opposite** — the reverse of the chosen option.
- **later** — defer it.
- **by hand** — a person does it instead of the system.

Add the ones that are not absurd, flagged `strawman: true`. Give each a why
like any option. A strawman nothing rules out is the finding the box exists
for.
