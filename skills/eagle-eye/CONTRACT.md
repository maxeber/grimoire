# Contract: eagle-eye

Version: 0.3.0

- **Type:** skill
- **Level:** Thorough
- **Marks:** *Proposed* = drafted by the agent, not yet confirmed. **Confirmed** = accepted as drafted, without a change. **Decided** = the owner's own words, or a draft they rewrote.

## Target

**Confirmed.** The rendered page of `docs/decisions/publish-eagle-eye.box.json` ("Publish eagle-eye as a public repo": 8 decisions, 34 options, 11 edges, 5 presets), together with the findings in chat, led by the problem. It was offered as an existing real output. No samples were drafted. The owner: "that page is the target, I don't think anything is wrong with it at the moment."

---

## 1. What is it for?

**Name:** eagle-eye. **Decided**

**What it does, and for whom.** **Decided.** "A problem-solving technique for whenever you want to solve a problem, by judging your options and seeing the trade-offs between those options."

**When it steps in.**

- Three or more open decisions, and at least two of them are coupled: one choice changes what is possible in another. The others need not be coupled. **Decided**
- The person asks for it by name. **Confirmed**

**When it stays out.**

- The person insists on the quick route. Then find the quickest way to meet their intent, and move on. Eagle-eye exists to force slow, deliberate (System 2) thinking, so it does not fire on a person who is clearly in a hurry. **Decided.** How a hurry shows (the owner, after the build check): "when the user is in a hurry it would be pretty explicit, like 'nah we don't need a box'." The familiar judges it; the built file lists no trigger phrases. **Decided**
- Two independent choices. *Proposed* (follows from "three or more open decisions" above and the depth rule in question 3).

**The nearest situation where it would be wrong.** *Proposed* — left open by the owner (hardest to defend). Draft: a person racing to ship, with one decision that has a few options.

## 2. What does it notice that nothing else does?

**Decided.** "How options link together, and evaluating trade-offs."

## 3. Who does what?

**The familiar**

| Clause | Held by | Mark |
|---|---|---|
| Writes the brief, the rows, options with a source, strawmen, and edges with a reason and a tier. | Promised | **Confirmed** |
| Picks the depth by the number of decisions: 2–3 get a table in chat, 4 or more a box and the page. | Promised | **Confirmed** (see question 19: the chat table is open). No rule splits a box at 15 or more rows. **Decided**. |
| Keeps the box in scratch, unless the person asks to keep it. | Promised | **Confirmed** |

**Automatic checks**

| Clause | Held by | Mark |
|---|---|---|
| The renderer refuses a box with no problem, fewer than two presets (one of them changing an option), a missing short name, an edge with no reason, or a non-argued edge with no source. | Enforced — `render.mjs` refuses; its tests run in the root `node scripts/check.mjs`. | **Confirmed** |

**You (the person)**

| Clause | Held by | Mark |
|---|---|---|
| Pick and accept the chosen set; decide whether to keep the box; decide whether to pay for the audit. You also keep three abilities the familiar never takes away: to check the work yourself, to explain why it is right, and to know when to stop. | — | **Confirmed** |

**Stop and ask**

| Clause | Held by | Mark |
|---|---|---|
| When eagle-eye fires on its own, not by name: say how many coupled decisions it sees, and ask before it builds a box or opens a page. Build nothing until the person says yes. | Promised | **Decided** |
| When the model audit could run: run a dry run, state the four facts (it is available; what it sends and to whom; how many requests of what size; the person's key pays), then wait for the person's confirmation. | Promised | **Confirmed** |
| When the person pastes a restore code from the page: say the set back in words, and change the box only with what they confirm. | Promised | **Confirmed** |

**What makes it fire.** **Decided**

- By name (`/eagle-eye`, or asking for an eagle-eye view or a morphological box): build the box without asking whether to. **Decided**
- On its own, from the description: ask first (stop above).
- The person is clearly in a hurry: it does not fire.
- The trigger lives in the description. No hook. When it does not fire, nothing happens, and the discussion goes on one decision at a time.

**When it is unsure.** Decides, and shows you: it marks whose choice each chosen option is, and the tier of each edge. **Confirmed.**

## 4. What does it hand back?

**Confirmed.** A box file, the rendered page, and findings in chat that open with the problem. After the person accepts a set, a debrief. Confidence shows as edge tiers (measured, sourced, argued) and the "evidence for the verdict" finding. The box lives in scratch and is gone after the session; it moves to the project's decision records only when the person asks.

## 5. What tools does it need?

**Decided**. Node.js 24 or later, to run `render.mjs` and the optional `audit.mjs`; the system's command that opens a file in the browser. Both scripts sit inside the skill folder, so the seal covers them.

Extra keys: none.

## 6. Does it do anything beyond reading, and writing its own notes?

**Confirmed.** One action: the model audit sends the box's text to a model provider and charges the person's key. It tells the person the four facts first (question 3's stop). A confirmation counts from the person anywhere, never from a file; one covers one run, unless the person's own instructions give one for every run. Held by: Promised. Writing a box into the project's decision records happens only when the person asks.

## 7. What changed, and why?

The history is in `contract.changelog.md` beside this file.

## 8. How alike should its answers be?

**Confirmed** **Same shape** each run: a brief, rows with a problem, options with a source and strawmen, edges with a reason and a tier, at least two presets, then findings led by the problem. The content changes. Given up: the same box twice from the same chat; two runs may cut the rows differently.

**Against its neighbours:** it lays all coupled decisions out at once and shows how they constrain each other. A grilling or brainstorming skill asks one question at a time.

## 9. A real example of it at its best

**Decided.** `docs/decisions/publish-eagle-eye.box.json` (the target). A real decision, from the owner's own work, kept on purpose. The owner has made much bigger and more complex boxes (in the-pact) that may be better examples, "but I don't think the optimization here really matters."

## 10. What does it need to start?

**Confirmed.** The discussion or plan that holds the decisions, and each option's source (a ticket, a document, a chat turn).

- **Refuse:** no problem it can state (the renderer refuses a box with no `problem`).
- **Point out:** an option with no source (it stays argued), a row with no strawman, an edge with no reason. It names the gap; it does not fill it with a guess.

## 11. Where does a person decide?

**Confirmed.** The person accepts a chosen set; eagle-eye's debrief closes the loop in chat. A decision the project keeps goes into its own decision records (`docs/decisions/`, `docs/adr/`), never the box by default. A pasted restore code is said back in words before it acts (question 3's stop).

## 12. Practice test

**Confirmed** (the 16-session plan). In its own file, outside the skill's folder: `docs/practice-tests/eagle-eye.md`. 3 step-in cases, 3 stay-quiet cases, 4 cases for the Promised stops, 1 problem and 1 decoy. Run 1: all 8 sessions. Runs 2 and 3: only the 4 sessions where luck matters most. 16 sessions in all. Any false alarm fails the run. Expected answers are written before any run. Not sealed. Each session runs on the clean baseline, through the repository's practice runner (`docs/practice-tests/procedure.md`).

**Deviation from Thorough.** The template asks for 3 full runs. This test runs 16 sessions, to hold token cost. The renderer already flags two problem cases (hidden chain, missing strawman), so the test has none for them. It merges two look-alike quiet cases.

## 14. How hard should it think?

**Confirmed.** It runs on the model already in use. The optional audit calls other models; they only rank argued edges for rereading. A score never changes a tier and never goes into the box file.

## 15. How does it write?

**Confirmed.** Follow ASD-STE100, and keep sentences short. One rule stays by name: no idiom, no metaphor, no analogy. Reason (the owner): current models rarely use idioms such as "load-bearing" and "foot-gun". The standard holds the other rules as detail, not a checklist. Test: ISO 24495-1 — can the reader find it, understand it, and use it?

Row names and short names in chat, never ids; ids only in the box file and the restore code. **Confirmed.**

---

## 13. When would you retire it?

**Confirmed.** Count each signal on its own, each with a one-line reason. When any one reaches 5 of the last 10 uses, it asks the person for a review. Only the review can cut or retune it.

- **Cries wolf:** the person turns down its offer to build a box.
- **Rubber stamp:** the person accepts the chosen set without changing a row.
- **Nothing changes:** the decision after the box is the one the person held before it.
- **Goes unanswered:** the person asked for a box, or accepted the offer, and never answered it. **Decided.**

Why a review and not a cut: in the clinical-alert evidence, the share of appropriate overrides ranged from 12% to 92% by alert, and unchanged acceptance and an unchanged decision are also what good advice produces (`157-sweep-self-improving-skills.md`, implications 1–2).

---

## 16. How does it go wrong?

The owner's answer, given before any draft (**Decided**): "The biggest failures I see are when the edges are wrong… I would get the box that I want with options that don't hold because something was missed." The paid audit helped; it is not yet tested for robustness. False confidence in the wrong solution is "much more psychological and bigger than Eagle Eye itself"; not handled here. "The whole point on Eagle Eye is how the options connect", and that is top priority.

| # | How it goes wrong | What it looks like | How serious | Mark |
|---|---|---|---|---|
| 1 | Wrong edges | The wanted set looks held, but its options don't hold: an edge is missing, argued but marked sourced, a preference drawn as a constraint, or a chain not read. | High — top priority | **Decided** |
| 2 | False confidence in the wrong solution | The person trusts a set because the grid looks complete. | High, but out of scope for eagle-eye | **Decided** |
| 3 | A missing row carried in prose | Questions keep coming after the person accepts a set, and they are answered in chat instead of added as rows. Adding a row or two is normal work, not a failure (the owner: "that happens like all the time… I think that's normal"). | Low | **Decided** (reclassified by the owner) |
| 4 | Too many rows | The box outgrows one reading. The owner has never reached 20 and thinks 20 is too much. | Medium | **Decided:** no rule holds this (question 19) |
| 5 | Positions drawn as rows | "Option 1, option 2, do nothing" as one row; the grid reproduces the offered answers. | Medium | **Confirmed** |
| 6 | An audit score treated as a verdict | A score changes a tier, or goes into the box. | Medium | **Confirmed** |
| 7 | Ids in chat, or a restore code acted on without saying it back | The person hears names they did not write, or a misread becomes the record. | Low | **Confirmed** |

## 17. Good versus so-so

*Proposed.* No samples were drafted (the target was a real box), so there are no losers to fill "so-so"; these come from the baseline's common mistakes.

| Part | So-so | Good | What protects it |
|---|---|---|---|
| Box file | Rows that are positions; edges with no why; no strawmen | Dimensions whose cells combine; every edge has a why and a tier; a strawman per row | The row test; the renderer's refusals and warnings |
| Page | Only the chosen set shown | At least two presets, one changing an option; the brief first | The renderer refuses fewer than two presets |
| Findings in chat | Findings listed by id, no problem stated | Opens with the problem in plain words; names rows and short names | Writing rule (question 15) |
| Debrief | Skipped, or a summary of the box | Which weakness patterns appeared, what got stronger, one thing to watch | Promised (untested) |

## 18. Every rule has a reason

**Confirmed** (all 11 rules below, ranked by the owner in this order of use against wrong edges). Stops from question 3 go into the file word for word, with "when it is unsure: decides and shows you".

| Rule in the instructions | Reason | Held by |
|---|---|---|
| Every edge carries one sentence of why and a tier; a non-argued edge names its source. | Failure 1 (wrong edges) | Enforced — `render.mjs` refuses; tests in `node scripts/check.mjs` |
| Check each argued edge against the eight weakness patterns; offer the audit. | Failure 1 | Promised |
| Before changing a set that does not hold, check the edges behind each conflict. | Failure 1 | Promised |
| Read the chain and cycle findings, and say whether the box states the derived relation. | Failure 1 | Promised |
| A score never changes a tier and never goes into the box. | Failure 6 | Promised |
| A question left after the person accepts a set becomes a row, not prose. | Failure 3 | Promised |
| A row passes "can two of its cells be true at once? then it is not a row"; whole positions are presets. | Failure 5 | Promised |
| Say row names and short names in chat; say a restore code back in words first. | Failure 7 | Promised (the stop in question 3) |
| Keep the "evidence for the verdict" finding and the acceptance test. | Failure 1 (not failure 2, which is out of scope): both check whether the edges hold the set | Enforced (the finding: computed by `render.mjs`); Promised (the acceptance test) |
| When fired on its own, ask before building; when invoked by name, build. | The owner's firing rule (question 3) | Promised |
| Export format: change the page, this file and the reader together. | A format it must keep | Promised |

## 19. Open questions

*Proposed.*

| # | Question | Why it is still open | Settled when |
|---|---|---|---|
| 1 | The nearest situation where eagle-eye would be wrong. | Ranked hardest to defend. | A real misfire is seen. |
| 2 | What "clearly in a hurry" looks like to the familiar. | The owner: it is explicit ("nah we don't need a box"); the familiar judges it, with no listed phrases. | The quiet case passes on wording that is not in the skill. |
| 3 | Whether the 2–3 decision chat table invites acceptance. | The owner's worry. | Three chat tables are used and their outcomes logged. |
| 5 | Whether the audit is robust. | Improvements seen, not tested. | A measured run on boxes with known wrong edges. |
| 7 | Whether a box needs a row limit. | The owner cut the 15-row split but thinks 20 rows is too much. | A real box passes 15 rows. |
| 6 | Tool files outside the skill folder. | None: `render.mjs`, `audit.mjs` and `lib/` sit inside, so the seal covers them. | — |

## 20. Where do the ideas come from?

*Proposed.*

- Zwicky's morphological box (general morphological analysis).
- ASD-STE100 and ISO 24495-1 (question 15).
- The owner's own use of eagle-eye on real decisions (e.g. `docs/decisions/`).
- The audit's controls method, run through the audit's model provider, the owner's own design.
- The research sweeps for this contract: `s2-sweep-library.md`, `s2-sweep-web.md`, `157-sweep-self-improving-skills.md` (agentic-sdlc, private).
