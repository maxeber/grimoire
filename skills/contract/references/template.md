# The contract template

*A skill, an agent or a CLAUDE.md is built to do one job for you. The
contract is the terms you agree with it: nine parts, filled one question at
a time, the last one optional. The built file is generated from the contract.
A small one takes ten minutes. A serious one takes an hour.*

## Contents

- Two choices before you start
- How the contract is kept
- The parts
- Where a schedule lives
- Agreeing what good looks like
- Rules, and what they guard against
- The eval offer

## Two choices before you start

**What are you making?**

- A **skill** is a set of instructions the agent picks up by itself when a
  situation matches. It is a folder named for the skill, holding `SKILL.md`,
  an open format many agents read: https://agentskills.io/specification.
- An **agent** is one file, in the format your tool uses, that the main
  agent sends off to do one job alone and report back.
- A **CLAUDE.md** holds the instructions that govern the main session. Claude
  Code loads it at the start of every session in its scope. Only Claude Code
  has one here.

**How thorough do you want to be?** The level only sets which parts are
asked. You may change it at any time, by answering more or fewer questions.
The change is a row in the change log, and nothing more.

| Level | Parts filled | Good for |
|---|---|---|
| **Quick** | `purpose`, `why`, `good`, `roles`, `tools` | A small skill or agent that only you use |
| **Standard** | adds `rules` and `writing` | One you rely on, or share |
| **Thorough** | adds `open`, and the systematic look for failures in `rules` | One others depend on, or one that can do damage |

An empty part that keeps getting "does not apply" means the level is too
high. Any level may also fill `schedules`, the last part.

## How the contract is kept

**The contract is the source; the built file is output.** Nobody edits the
built file by hand. To change what the skill or agent does, amend the
contract, then regenerate the file. The contract holds current terms only.
History goes to the change log beside it.

**Where each file lives.** Write where your skills and agents already live.
Ask only before a write that would install.

| Type | Built file | Contract | Change log |
|---|---|---|---|
| Skill | `<name>/SKILL.md` | `<name>/references/CONTRACT.md` | `<name>/references/contract.changelog.md` |
| Agent | `<name>.md`, or `<name>.toml` for Codex | `<name>.contract.md`, beside it | `<name>.changelog.md`, beside it |
| CLAUDE.md | `CLAUDE.md` | `CLAUDE.contract.md`, beside it | `CLAUDE.changelog.md`, beside it |

The contract and the change log never open with frontmatter, so no tool
loads either as an agent. A skill whose contract has schedules also has each
schedule's home file, `<name>/references/<file>.md`.

**The title block.** The contract opens `# Contract: <name>`, then
`Version: X.Y.Z` starting at 0.1.0, then `Kind: skill`, `Kind: agent` or
`Kind: CLAUDE.md`, then `Level: Quick`, `Level: Standard` or
`Level: Thorough`. Every contract has all the part headings, named as in
this template, with `schedules` last. A part the level does not ask stays
empty. A contract written before `schedules` existed may lack that heading,
and reads as one with the part empty.

**Marks.** Each answer carries one mark and at most a one-line why:

- *Proposed*: drafted, not yet confirmed.
- **Confirmed**: you accepted a draft without a change.
- **Decided**: your own words, or a draft you rewrote.

No date goes on a mark. The date, the source and who relayed it go in the
change-log row that made the answer.

**Freedom.** Each clause in the built file is open, guided or fixed. A
clause with no freedom written is open: the agent works it out from context,
and the file writes nothing. Write only guided and fixed. *Guided* is a
default the agent may adapt, with when. *Fixed* is for a stop, a safety rule
or your own decision, with its reason here. Anthropic's Skills docs call
these high, medium and low freedom. You may change any clause's freedom.

**Gated by.** A clause that a check, a hook or a tool list blocks says so on
its row: `Gated by: <the gate>`. A gate nobody has seen fail reads
`Gated by: <the gate> (unconfirmed)`. A gate with no rule to serve should not
exist. Name the tool that applies a tool list: a tool list is only as strong
as the tool that reads it.

**Fences.** The built `SKILL.md` wraps each generated part in
`<!-- contract:begin NAME -->` and `<!-- contract:end NAME -->` lines, which
stay in the file. A part is fenced where it writes text into the body, so
`purpose`, `why` and `open` get none. This is a default. An amendment
regenerates exactly the fenced parts it touches and keeps the rest word for
word. An agent file or a `CLAUDE.md` has no fences: an amendment there
regenerates the sections its touched parts write. The built `SKILL.md` of a
contract with schedules also has no fences, because each home is matched by
its heading, and a change goes into the schedule first. A contract without
schedules keeps its fences.

**The change log.** A table, one row per change:

| Version | Date | Change | Why, and where it came from | Parts touched | Field signal |
|---|---|---|---|---|---|

*Parts touched* names parts, such as `rules, writing`. *Field signal* answers
one question: could you explain the old clauses from the contract alone? Write
yes, partly or no. A change of level goes here too, with its reason.

## The parts

### `purpose`

Its **name** first: 1–64 characters, `a`–`z`, `0`–`9` and `-`, not starting
or ending with `-`, with no `--`. For a skill it is the folder name; for an
agent, the file name without its ending. Anthropic reserves "anthropic" and
"claude" in a skill's name. You are told before anything is written, and may
keep it, marked **Decided**.

Then one sentence: what it does, and for whom. Then **when it steps in**,
and **when it stays out**, with the nearest situation where it would be wrong.
The built file carries these only in its description. A CLAUDE.md has no name
of its own and loads in every session, so its "stays out" names the work it
must not shape.

*Test:* a near-miss is named.

### `why`

What it notices or does that nothing else does, **in your own words**. Always
**Decided**. The skill never drafts it, not even as *Proposed*.

*Test:* name one thing. If you cannot, stop: you are about to build
something nobody would miss.

### `good`

What good output looks like: your real example, or the winner of two or three
drafts that differ on purpose. Record it, and what separates good from
so-so in a line or two. See "Agreeing what good looks like".

### `roles`

Who does what, in four lists: what the skill or agent is responsible for;
what automatic checks already enforce (it may point things out, never has the
final say); the decisions that stay yours; and the moments it **stops and
asks**, each written "when X happens". If it records what it did, give a
stop its own value, such as "stopped and waiting".

Also: what makes it step in, and where that trigger lives (the description,
an instruction, or a hook you install), and what happens when it does not.
Each clause carries its freedom, and `Gated by:` where one applies.

**When it is unsure.** Pick one and say why. Start from the last.

| Choice | What happens |
|---|---|
| Asks you at once | It stops and waits |
| Pauses at set points | It works to a named stage, then waits |
| Leaves questions in the result | It continues and lists what it could not settle |
| Decides, and shows you | It makes the call, marks it, and you can change it |

A question helps only when it can tell it does not know, you can answer, and
a wrong guess costs more than the interruption.

### `tools`

The shortest list that does the job, each with a reason. For an agent, say
what it may do in plain words, not one tool's names:

| Capability | In plain words |
|---|---|
| Read files | Reads and searches files in the project folder |
| Create files | Writes new files in the project folder |
| Change files | Edits existing files in the project folder |
| Run commands | Runs shell commands |
| Fetch web pages | Reads a page at an address |
| Search the web | Sends a search to the web |
| Use a connected server's tools | Uses every tool of one connected service |

Then its limits in the same words, such as "writes only in the project
folder; no network". The binding maps these words to the tool it is built
for; a limit a tool's file cannot hold is not gated, and the hand-back says
so. Also here:

- the tool it is built for, in plain words: "Built for Codex". An agent
  and a CLAUDE.md need one ("Built for Claude Code"); a skill does not;
- every action beyond reading and writing its own notes (sending data,
  spending money, changing files elsewhere), each with what it tells you
  first and what counts as your yes. "Nothing" is a good answer;
- for every tool of one connected service: what its tools can do, the kinds
  of data it holds and the kinds of place it can send data. Kinds only,
  never an account, an address or a real record: a contract is often
  committed;
- a record of what it did, only if you ask for one: where it is kept and what
  it holds. Nothing records anything by default;
- what it needs installed to run, which a skill's frontmatter `compatibility`
  line states;
- each setting that lets it act without your approval, with its value, marked
  **Decided**.

For a CLAUDE.md, name the capabilities its instructions rely on. The file
cannot limit the session's tools.

### `rules`

One table. See "Rules, and what they guard against". Standard and above.

### `writing`

The terms it uses, and how it writes. A term list: each word, its plain
meaning, and the standard it comes from if any. Writing rules, and formats
(tables or prose, code or diagrams). With none, the built file writes
plainly and names no standard. The built file uses a word from this
template's vocabulary only when your terms list holds it. Standard and above.

### `open`

What is still open, and when you would retire it. Thorough.

| Question | Why it is open | Settled when |
|---|---|---|

Ask "when would you retire it" plainly: the evidence that gets it cut or
merged, and what you would see. It is your judgment at each amendment,
recorded in the change-log row with the field signal. If most of its output
gets dismissed, that is a failure to record in `rules`.

### `schedules`

Optional, at any level, and last. A **schedule** is the text of one section of
the built file, kept here word for word and copied to its **home**: `SKILL.md`
or one file in `references/`. The built file is output, so a change goes into
the schedule first and is then copied to its home. Each schedule holds:

- its **name**: the heading of its home section, written exactly. A section too
  long for one field is cut into pieces, each named with ` (n of m)` at the
  end. A cut falls only on a blank line outside a code fence, and the pieces
  join with one blank line;
- its **home**: `SKILL.md`, or `references/<file>.md`, where `<file>` is 1 to
  40 characters of `a`–`z`, `0`–`9` and `-`. The contract and its change log
  are never a home;
- its **text**: no heading line, no line holding `<!` or `<?`, and no
  link-reference definition line, so a schedule cannot hide a comment or break
  the contract's outline;
- the body clauses it **carries out**, which it names.

A schedule is high stakes: its text is what the agent runs. It takes the
weakest mark of the text it holds.

**The word.** On the hiring page, a schedule is also a sheet that lists the
entries of one kind, attached under the letter. The entries of this part form
one such sheet. The two senses meet: the sheets attached to a contract's
letter are its schedules, and `schedules` holds the ones that carry procedure.

## Where a schedule lives

These eight rules choose a schedule's home. Each names its sources. Every
source was read on 2026-11-12.

- **R1.** `SKILL.md`'s body stays under 500 lines and about 5,000 tokens. The
  most important instructions come first, written as standing rules.
  ([BP](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) "Token budgets";
  [OV](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview);
  [SPEC](https://agentskills.io/specification);
  [CC](https://code.claude.com/docs/en/skills) "Skill content lifecycle")
- **R2.** `SKILL.md` holds the workflow and the selection logic, the stops and
  gotchas the agent must know before the situation arrives, and one pointer
  per reference saying what it holds and when to read it.
  ([BP](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) "Progressive disclosure patterns";
  [SC](https://github.com/anthropics/skills/blob/b0cbd3df15/skills/skill-creator/SKILL.md) "Domain organization";
  [AS-BP](https://agentskills.io/skill-creation/best-practices) "Gotchas sections";
  [CC](https://code.claude.com/docs/en/skills))
- **R3.** A reference holds detail that only some situations need: domain
  variants, long procedures, exact formats, schemas, examples, long templates.
  It sits one level deep, is named for its content, and has a table of
  contents when it runs past 100 lines.
  ([BP](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) "Avoid deeply nested references";
  [SPEC](https://agentskills.io/specification) "File references";
  [BP](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices))
- **R4.** Each text has one home: `SKILL.md` or one reference, never both.
  (The skill-creator skill before its 2026-02-06 rewrite, the parent of
  [anthropics/skills commit 1ed29a03dc](https://github.com/anthropics/skills/commit/1ed29a03dc):
  "Information should live in either SKILL.md or references files, not both".
  Kept on grimoire's maintainer's word, 2026-11-12.)
- **R5.** Deterministic work goes in `scripts/`, which the agent runs and does
  not read. Files used in output go in `assets/`.
  ([BP](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) "Provide utility scripts";
  [SC](https://github.com/anthropics/skills/blob/b0cbd3df15/skills/skill-creator/SKILL.md);
  [AS-BP](https://agentskills.io/skill-creation/best-practices) "Templates")
- **R6.** "When to use" goes in the description, never the body.
  ([SC](https://github.com/anthropics/skills/blob/b0cbd3df15/skills/skill-creator/SKILL.md))
- **R7.** Write only what the agent would get wrong without it.
  ([BP](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) "Concise is key";
  [AS-BP](https://agentskills.io/skill-creation/best-practices))
- **R8.** Re-home on evidence: a reference read on every run moves into
  `SKILL.md`, and one never read is cut or signposted better.
  ([BP](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) "Observe how Claude navigates Skills")

The abbreviations: BP is the Agent Skills best practices page, OV its
overview page, CC Claude Code's skills page, SPEC the Agent Skills
specification, AS-BP the specification site's best-practices page, and SC the
`skill-creator` skill in `anthropics/skills`, as last changed in commit
b0cbd3df15 (2026-03-06).

## Agreeing what good looks like

Before anything is built, at every level, agree what good output looks like.
You have a real example: it is the answer, **Decided**. You have none: the
skill drafts two or three samples that differ on purpose, shows them
together, and asks one question: which is closest, and why? You pick one, mix
them, or reject all. The samples are text in the conversation. They never
run, install or send anything. Record the winner and your reason in `good`.
Nothing is built until you have agreed.

## Rules, and what they guard against

One table in `rules`, rule and failure together:

| Rule | Guards against | Status | Gated by, freedom |
|---|---|---|---|

*Status* is *potential* or *observed*, with where it was seen. A failure with
no rule yet is a row with an empty Rule cell, and its status is potential. A
potential failure may earn a rule at any level, marked so. The last column
is written only where it applies.

How hard to look for failures follows the level. At Quick, when you choose to
fill `rules`, look for the obvious ones. At Standard, look for the likely
ones. At Thorough, look for them systematically. Examples are nitpicking,
sounding tough and helping nobody, being trusted too much, following
instructions found inside a file, arguing in prose when it should show you,
and overloading you with questions. Crying wolf, firing until you dismiss
it, is an observed row when it happens.

A rule with a reason you cannot give is clutter. A rule keeps a rationale
clause in the built file only where the agent needs it for a case the rule
does not name. Provenance never enters a built file. Where a rule serves a
stop, keep the stop word for word, and look for wording that lets the agent
talk itself past it, such as "unless it seems unnecessary".

## The eval offer

After the first build, offer to write one case per row of the table below,
with graders in `claude plugin eval` format, testing the built skill's or
agent's behaviour only. Say the rough cost of a run before you ask. Offer nothing for a tool the runner cannot load. You run them or not; a
no is not logged against you. This table maps parts to case types:

| Part | Case type |
|---|---|
| `purpose` | Steps in when it should; stays out in each near-miss |
| `roles` | Stops where a stop is written; leaves your decisions to you |
| `tools` | Does nothing beyond the listed actions |
| `rules` | Each observed failure stays gone |

After that first set, add a case only for a failure seen in use, and review
the suite's size at each amendment. The skill may run cases it wrote only after your confirmation,
each time, with `--max-cost-usd` and `--no-publish`. One confirmation never
covers the next run.
