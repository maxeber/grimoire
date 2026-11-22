# AGENTS.md

Before you patch anything, read [`CONTRIBUTING.md`](CONTRIBUTING.md) — it is the
contract for any patch.

Read [Run the check in a container](CONTRIBUTING.md#run-the-check-in-a-container)
first, for how to install athanor and when it is safe to run, then run the
check with `athanor run check` by default.

A hook in `.claude/settings.json` enforces that order: while `athanor` works, it
refuses `node scripts/check.mjs` from you. When athanor is missing (a shim that
dangles counts as missing), run the host check as it is. When an athanor run
exits 124, 125 or 137, add `--host-fallback=<reason>` to the host check, in your
own words with no path, token or pasted error text, and say in your report that
you used the fallback. A sha512 mismatch in the image build also exits 125; it
is not a Docker fault, so stop and tell the owner. Read
[The agent guard](CONTRIBUTING.md#the-agent-guard) for the rest.

## Layout

The four `scripts/` directories and `docs/decisions/` are described in [`docs/layout.md`](docs/layout.md).

## Head-chef and the rules it runs under

Head-chef manages sessions. How the work inside a session should be done is not its concern; that comes from whatever configuration a person runs. Head-chef and the Brigade pane may read that configuration, but they never assume one, use its terms or need it installed.

Before adding a rule or a field to either, ask: would this still make sense for any session, under any configuration? If not, it comes from configuration.

## The Brigade pane and the head chef

A Brigade change that adds data the pane keeps says, in the same change,
whether the lead can read it through a tool; when it can, the same change
updates the head-chef contract and its `SKILL.md`, and its
`docs/security/brigade.md` row says where the tool's answer then flows.

The Decisions tab draws only the current lead's own decision log. Drawing
anything from another session's log needs the owner's own words.

## Threat model

This repository's threat model is [`docs/security/threat-model.md`](docs/security/threat-model.md); hand it to any security review.

## Agent skills

### Issue tracker

GitHub issues on `mephistopheles4/grimoire`, driven by the `gh` CLI. See `docs/agents/issue-tracker.md`.

Before your first edit, assign yourself the issue you take in the project's tracker; if you stop, unassign yourself with a comment on where you got to.

### Triage labels

The five canonical roles are `needs-triage` (the maintainer must evaluate it), `needs-info` (waiting on the reporter), `ready-for-agent` (fully specified, an agent can take it), `ready-for-human` (needs a human to implement it) and `wontfix` (will not be actioned). Each label string equals its role name.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. `CONTEXT.md` is the glossary; use its terms and not the ones it says to avoid. Read the ADRs that touch the code you are about to change: 0003 before changing groundtrack's `fold`, 0004 before adding or changing a size limit in its renderer. When your output contradicts an ADR, say so; do not override it silently. When a concept you need is not in `CONTEXT.md`, you are either inventing language the project does not use (reconsider) or you found a gap (note it for `/domain-modeling`). `/domain-modeling` adds a term or an ADR when one is settled.

Read `docs/spec/` changes closely.
