# Skills own their vocabulary

A skill in this repository names no vocabulary the repository does not own — no
outside skill name, command name, or tool-specific noun — in its description,
its body, or its examples. The plugin ships to strangers, and every example
artifact also renders to GitHub Pages, so a borrowed proper noun reaches a
reader who cannot resolve it and sends them looking for something they cannot
install. The test is one question an author can run without knowing what they
are avoiding: *does this sentence stay true and checkable for a reader who has
only this repository?*

## Considered Options

The test is **per sentence, not per word**. Two narrower tests were rejected.

**Resolvability** — *does the word send the reader looking for something they
cannot get?* — is subsumed by the chosen test but too weak on its own. It misses
sentences assembled entirely from ordinary words that still assert a named
tool's behaviour. The instance that decided it: *"Brainstorming has the
clarifying questions answered and has not yet proposed approaches"* contains no
proper noun and is still a claim about one specific tool's phase sequence.

**Provenance** — *is the word the name of something outside this repository?* —
is the easiest to apply and over-cuts. It takes *a design review* and *during
brainstorming*, which are ordinary English that happens to collide with a name,
and which cost a reader nothing.

A **two-tier** rule was also rejected: a low repository-wide floor covering
description and body, with `groundtrack` keeping its stricter examples clause.
Instead `eagle-eye` rises to meet the strict version and the rule is single-tier.
A floor that every existing skill exceeds is an untested lower bound, and it
grants a future author permission the codebase has never exercised. The
alternative — relaxing `groundtrack`'s locked spec down to a floor written after
it — would invert which document is authoritative.

## Consequences

**Nothing enforces this mechanically, deliberately.** A denylist can only hold
names somebody already thought of, which is the inverse of the failure mode: the
rule exists for the *next* borrowed noun. A passing check would read as *this
file is clean* when it means *this file contains none of six words*, which is
worse than no check. This follows the precedent already set for the code-fence
rule — a hand-written rule and not a linter, on purpose.

**There is no exception mechanism.** No allowlist, no table of surviving
mentions with reasons. An allowlist with no entries invites the first one and
grows by precedent once it has one. A genuine exception is a patch to this
decision, argued in a pull request.

**The host platform is not an exception.** The agent that runs a skill is named
by the same test as anything else, and it fails it: `docs/decisions/portable-skill.box.json`
already decided that a skill's text is copied into agents that are not the one
it was written for, and chose wording that fits any agent. So skill prose says
*the agent*, not a product name, and describes a capability rather than the
service that provides it. Files outside `skills/` are unaffected — this
repository is free to name its own host, and does.

**A `src` field is out of scope, and this is not an exception to the rule
above.** Provenance points outside the repository by definition, so a rule that
forbade it there would forbid citation itself — and the renderer refuses a
`sourced` edge that names no `src`. The rule governs words a reader must
resolve to use the skill. A citation is a pointer for somebody checking a
claim, and the `why` it sits beside still obeys the rule.

**Code that calls a service names it, and prose still does not.** eagle-eye's
edge audit, `skills/eagle-eye/audit.mjs`, posts a box's text to one model
service, and it names that service twice: in the endpoint it posts to, and in
the environment variable it reads the key from. Both names carry weight. A
reader auditing the script must see where the box text goes, and a user setting
the key must know which variable to set. A generic name for either would hide
the one fact the person checking the code came for. The prose that tells the
agent when to run it says *the model provider*, and the test above holds for it
unchanged: the sentence stays true for a reader who has only this repository,
and it stays true if the service changes. `tests/audit.test.mjs` fails if any
other file under `skills/` names the provider. That is not the denylist argued
against above. It does not guess at the next borrowed noun; it holds one
name this record allowed to the one file this record allowed it in.

**Some provenance is lost, and that is accepted.** `eagle-eye`'s own boxed
design recorded three named tools as candidate host flows for its trigger. The
labels now say *another host flow*. The argument survives in full — the row
states that a host flow may call the skill, and the edge states that hosts are
global while the skill is repo-level — so only the examples go.
