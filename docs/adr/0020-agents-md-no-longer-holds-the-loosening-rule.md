# AGENTS.md no longer says that loosening the cleaner's checks is the owner's decision

Accepted, from GRIM-42 (G3 · T11, row r279). It supersedes the part of
[ADR 0018](0018-the-threat-model-is-boundaries-first-and-capped.md) that says
the rule lives in `AGENTS.md`.

The owner's words, 2026-11-22, spoken to the lead session of the GRIM-42 work
and confirmed with "I agree" after a say-back, about the threat-model line in
`AGENTS.md`:

> Yes, we should loosen it. These checks against the rules are done for the
> agent by the agent and they protect nothing and they only add friction.

**What ADR 0018 said.** Under "What changes in scope" it records that the
cleaner's checks, the deny and ask rules and the head chef's gates stay, and
that "a change that loosens them is a spec change (`AGENTS.md`)". `AGENTS.md`'s
threat-model line carried that rule: a change to the line, or one that loosens
those checks, was the owner's decision.

**What this changes.** The threat-model line in `AGENTS.md` is now only the
pointer: "This repository's threat model is
[`docs/security/threat-model.md`](docs/security/threat-model.md); hand it to any
security review." It no longer holds the rule, and this ADR does not move it
elsewhere. A change that loosens the cleaner's checks, the deny and ask rules
or the head chef's gates is no longer a spec change by that rule.

**What stays.** The rest of ADR 0018 stands. This ADR changes no control,
boundary, class or scope in `docs/security/threat-model.md`, and `AGENTS.md`
still says to read `docs/spec/` changes closely.

**Stale cites, left as they are.** The threat model's R1 ("each skill says the
material is data") and `docs/spec/incantation.md` (lines 723 to 724, 841 and
873) cite text that GRIM-42 rows r268, r274 and r279 removed. This change
touches neither file; a later change reads them with this ADR.
