# Binding: Antigravity

This file maps a contract's plain words to an Antigravity agent file. Read
it when `tools` says the agent is built for Antigravity. Ask, don't guess: a
fact missing from the contract, the template, the skill's steps or here is a
gap, as SKILL.md says.

## Last checked

agy 1.2.13, on 2026-09-30. Name this version in the hand-back.

## Where files go

Write where the person's agents already live: `.agents/agents/` in a
workspace (loaded; effect not tested). Ask only before a write that would
install. The contract and the change log go beside the file, as the template
says.

## The file

The file is `<name>.md`: YAML frontmatter, between two `---` lines, then the
body: the agent's instructions.

- **Keys it writes:** `name`, `description`, `tools`. Any other key: ask
  what it does and record it **Decided** with its value. No other key was
  checked.
- **Always write `tools:`** in flow form, such as
  `tools: [view_file, write_to_file]` (loaded in that form).

## Capabilities

| Capability | In the file | Source |
|---|---|---|
| Read files | `view_file` | Loaded |
| Create files | `write_to_file` | Loaded |
| Change files | `replace_file_content` | Loaded |
| Run commands | `run_command` | Loaded |
| Fetch web pages | `read_url_content` | Loaded |
| Search the web | `search_web` | Loaded |

Loaded means a file listing that name ran in agy 1.2.13, on 2026-09-30; its
effect was not tested.

**Limits this file cannot hold.** Say each in the hand-back, as not gated:

- A `tools` list cannot limit where the agent writes. Granting
  `write_to_file` or `replace_file_content` makes "writes only in the
  project folder" a plain request.
- Granting `run_command` makes "writes only in the project folder" and "no
  network" plain requests too.
- The list may not be every tool agy gives the agent. An agent listing only
  `view_file` reported `manage_task` as well in agy 1.2.13; that is its own
  report, not tested. So "only these tools" is not gated.

## Settings that let it act without asking

None checked. When the person picks a setting that lets an agent act without
their approval, say so, and record it under `tools`, marked **Decided**.

## Validate

After building, run `claude plugin validate --strict` on the folder that
holds the agent's file, when the command is available. A clean pass names no
file: unless the output names the built file, say it passed and named no
file. Show the errors as printed, fix what is the skill's own, and do not
call the build done on a failure. The validator is Claude Code's, so its
verdict on an Antigravity file is partial: say so. When the command is not
available, say the file was not validated.

## Example

A reviewer that only reads:

```markdown
---
name: commit-reviewer
description: Reviews staged commit messages against the team's rules, and reports each message that breaks one. Use before a push. Not for writing commit messages.
tools: [view_file]
---

# commit-reviewer

Read the staged commit messages. Report each one that breaks a rule, with
the rule and the message. Change no file. When a rule is unclear, list it as
unsettled.
```
