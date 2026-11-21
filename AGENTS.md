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

## Four directories are called `scripts/`

`scripts/` at the repository root holds this repository's own checks — the one
command, the site build, and the table that says which renderer owns which
artifact — and the two scripts that draw each skill README's sheets, with the kit they
share in `scripts/lib/drafting.mjs`. `skills/groundtrack/scripts/` holds that skill's renderer and the one
module it inlines into the page. `skills/contract/scripts/` holds the contract
skill's interview script, the one module it shares with the hiring page, and
the kinds table both read. `skills/incantation/scripts/` holds
that skill's scripts. The path says which.

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

This repository's threat model is [`docs/security/threat-model.md`](docs/security/threat-model.md), boundaries first, capped at 3,000 words; `SECURITY.md` also links it. Hand it to any security review. A change to its scope, its accepted classes or this line is the owner's decision, and so is one that loosens the cleaner's checks, the deny and ask rules or the head chef's gates.

## Agent skills

### Issue tracker

GitHub issues on `mephistopheles4/grimoire`, driven by the `gh` CLI. See `docs/agents/issue-tracker.md`.

Before the first edit to a file, assign the issue you take to yourself with `gh issue edit <n> --add-assignee @me`. If you stop without finishing, unassign yourself with a comment on where you got to. An assignee is a signal, not a lock: the doc says what that means.

### Triage labels

The five canonical roles are `needs-triage` (the maintainer must evaluate it), `needs-info` (waiting on the reporter), `ready-for-agent` (fully specified, an agent can take it), `ready-for-human` (needs a human to implement it) and `wontfix` (will not be actioned). Each label string equals its role name.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. `CONTEXT.md` is the glossary; use its terms and not the ones it says to avoid. Read the ADRs that touch the code you are about to change: 0003 before changing groundtrack's `fold`, 0004 before adding or changing a size limit in its renderer. When your output contradicts an ADR, say so; do not override it silently. When a concept you need is not in `CONTEXT.md`, you are either inventing language the project does not use (reconsider) or you found a gap (note it for `/domain-modeling`). `/domain-modeling` adds a term or an ADR when one is settled.

`docs/decisions/` holds kept eagle-eye box files. A box is a working surface, so most stay in scratch.

Read `docs/spec/` changes closely.
