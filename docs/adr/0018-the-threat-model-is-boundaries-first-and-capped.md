# The threat model is boundaries first, the machine is out of scope, and it is capped at 3,000 words

> Partly superseded by [ADR 0020](0020-agents-md-no-longer-holds-the-loosening-rule.md):
> the statement that a change loosening the cleaner's checks, the deny and ask
> rules or the head chef's gates is a spec change under `AGENTS.md`. The rest
> stands.

Accepted, from issue 596 (ticket 3 of the-pact issue 542).

The owner's words, 2026-11-12, on the-pact issue 542:

> I think the discrepancy in the size is because Grimoire still has provenance
> in this threat model. Prefer having the threat model much smaller.

> We already have ADRs and logs. I don't think we need to keep provenance at
> all.

**The rule.** `docs/security/threat-model.md` is one file of at most 3,000
words, counted by whitespace over the whole file, and `tests/threat-model-cap.test.mjs`
holds it. It starts with the boundaries, each with what crosses it, the
controls that hold it by source (the harness, GitHub, the pact, this
repository's own tools) with when each does not hold, and the residual, as
accepted classes. Its scope names the machine as out: the owner's own
computer or a sandbox run on it, with everything made there. Raising the cap is
a spec change.

**What goes.** The file no longer holds its provenance (the old entries, the
dated worded-by lines, the old row cross-references and the old anchors), its
candidates, its ranked gaps, or the rule about keeping the page short. The
history of how a risk came to be accepted lives in the earlier ADRs, the issues
and the git log, which agents are not told to read.

**What is kept.** The controls R1 to R12 stay as named controls under their
boundary, ids included, and the reference pages [`brigade.md`](../security/brigade.md),
[`checks.md`](../security/checks.md), [`rendering.md`](../security/rendering.md)
and [`hiring-interview.md`](../security/hiring-interview.md) keep the detail behind them. They
stop being part of the threat model: they are reference pages, and an edit that
weakens a control they name is a removed control. A class names only what gets
past the controls. A candidate the owner never named stays an open issue, not
a class.

**What changes in scope.** The compromised machine or sandbox (old class C11)
becomes the scope line. Other accounts, shared temp folders and files at rest
on the owner's machine are the machine's. The loss of work with no attacker
(old class C10) leaves the threat model as a class, and the cleaner's checks,
the deny and ask rules and the head chef's gates stay; a change that loosens
them is a spec change (`AGENTS.md`). Other plugins (old class C4) sit on the
install boundary, and the sync, backup, Remote Control and audit-log flows of
the old classes C7 and K2 sit under one class on the data boundary.

**Amends.** [ADR 0006](0006-skills-are-dangerous-by-default.md) cites the old
class C1 by anchor. The class now reads "Text steers a session", and the ADR
keeps its old link as history. It also contradicts that ADR's rule that a finding gets a threat-model row and a rating, a new script gets a risk row and any other finding waits as a candidate: the model's procedure replaces it, and a finding no class covers is an open issue for the owner. The guide the file is read with is the pact's
`review.md`, The threat model section.
