# Binding: Codex

This file maps a contract's plain words to a Codex agent file. Read it when
`tools` says the agent is built for Codex. Ask, don't guess: a fact missing
from the contract, the template, the skill's steps or here is a gap, as
SKILL.md says.

## Contents

- Last checked
- Where files go
- The file
- Capabilities
- Settings that let it act without asking
- Validate
- Example

## Last checked

Codex 0.159.0, on 2026-09-29. Codex changes often. Name this version in the
hand-back, and say that a newer Codex may read the file differently.

## Where files go

Write where the person's agents already live: `.codex/agents/` in a
project, or `~/.codex/agents/` for the person. Ask only before a write that
would install. The contract and the change log go beside the file, as the
template says.

## The file

The file is TOML: lines of `key = value`, named `<name>.toml`.

- **Keys:** `name`, `description` and `developer_instructions` are required.
  `developer_instructions` holds the agent's instructions, the body a `.md`
  agent would have. `sandbox_mode` is known. Any other key: ask what it does
  and record it **Decided** with its value.
- **Lines:** top-level `key = value` lines, blank lines and whole-line `#`
  comments only. Codex drops an agent file with a `[metadata]` table, or a
  `metadata` key, so write no table header and no dotted or quoted key.
- **Values:** write strings. Each key once, nothing after a value, not even
  a comment.
- **Strings:** a basic string, `"…"` or `"""…"""`, takes only the escapes
  `\"` and `\\`. A literal string, `'…'` or `'''…'''`, takes none. Write
  `developer_instructions` as a `"""` string, closed with exactly three
  quotes.
- **Text:** LF or CRLF line endings, no byte-order mark, and no control or
  invisible character but tab.

## Capabilities

| Capability | In the file | Source |
|---|---|---|
| Read files, and nothing that writes | `sandbox_mode = "read-only"`, when the person names this sandbox | Loaded in Codex 0.159.0; effect not tested |
| Create files or change files | `sandbox_mode = "workspace-write"`, when the person names this sandbox | Docs: Codex's page on agent configuration |
| Run commands | No key. Commands run inside the session's sandbox, or the one `sandbox_mode` names | Docs, same page |
| Search the web | `web_search = "live"`, when the person names it | Docs: learn.chatgpt.com/docs/config-file/config-reference |
| Fetch web pages | Nothing this file can hold. Stop and ask | Network access for a sandbox is a table, which the file may not carry |

**Ask about the sandbox.** Ask the person whether the agent gets its own
sandbox: read-only, workspace-write, or none, which leaves it to the
session. Write `sandbox_mode` only when they name one. Without it, the agent
runs in the session's sandbox, whatever that is. Say so in the hand-back.

**Limits this file cannot hold.** Say each in the hand-back, as not gated:

- The session's own choices, such as a change of permissions during the
  session, override the file's `sandbox_mode` (docs).
- "No network": the agent takes the session's network and tool-server
  settings, and Codex's web search is on by default, as cached search, and
  live under full access (docs).
- "Runs no commands": a read-only sandbox still lets it run commands that
  change nothing. This is a reading of the docs, not tested.

## Settings that let it act without asking

These settings let an agent act without the person's approval: say so when
the person picks one. Record the exact value of each under `tools`, marked
**Decided**.

- `sandbox_mode`, `default_permissions`, `approval_policy`,
  `approvals_reviewer` and `web_search` change what the agent may do.
- `model_instructions_file`, `experimental_instructions_file` and
  `experimental_compact_prompt_file` each load instructions from a file the
  contract does not cover.
- `model_catalog_json` loads a file the contract does not cover.
- `openai_base_url` sends the agent's work to a server the file names.

## Validate

`claude plugin validate --strict` is Claude Code's validator, and it does not
read Codex's TOML. Do not run it on a Codex agent. Say plainly that the file
was not validated.

## Example

A reviewer that only reads, with the sandbox the person named:

```toml
name = "commit-reviewer"
description = "Reviews staged commit messages against the team's rules, and reports each message that breaks one. Use before a push. Not for writing commit messages."
sandbox_mode = "read-only"
developer_instructions = """
Read the staged commit messages. Report each one that breaks a rule, with the rule and the message.
Change no file. When a rule is unclear, list it as unsettled.
"""
```
