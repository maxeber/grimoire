<p align="center">
  <img src="../../docs/brand/head-chef-card.svg" width="100%" alt="head-chef — lead the sessions; let them do the work">
</p>

# head-chef

**One session leads. The sessions it starts do the work.**

A person who runs many sessions on one or more efforts repeats the same
actions by hand: starting a session, managing its context, handing work to
another session, and archiving it. head-chef takes care of those, so you can
stay on the bigger picture, keep its direction, and step in where you need to.

head-chef makes one Claude Desktop session the **head chef**: the lead of a
**brigade**, the sessions it starts. Unlike a subagent or a workflow, every
session it starts is one you can talk to directly, at any time. When and why
to start a session comes from your own process or your request.

## The words it uses

- **Head chef:** the session this skill runs in, which leads the others.
- **Lead:** the Desktop session the head chef runs in.
- **Brigade:** the sessions the lead started.
- **Name-back:** the list the head chef shows before an act that cannot be
  undone, naming exactly what it will touch.
- **Permission warning:** the band above the prompt that says what the head
  chef's sessions put at risk.

## Use it

Install grimoire as a Claude Code plugin to get the skill, the Brigade pane
and the permission warning together:

```text
claude plugin marketplace add mephistopheles4/grimoire
claude plugin install grimoire@mephistopheles4
```

An `npx skills` install copies skill folders only. It gives you `head-chef`
but not `/brigade` or the warning band: the skill then says the warning once
in chat instead, and it cannot start a background session, because the start
tool is part of the plugin. It offers the Desktop start then.

It needs Claude Code, Claude Desktop, git, and the GitHub command line (`gh`)
installed and signed in. The background start needs Claude Code 2.1.319.

Before the first background start, open `claude` once in each main checkout you
want sessions started in and accept the trust prompt. The harness refuses a
background start in a folder you have not trusted (see `SECURITY.md`).

Then, in Claude Desktop, ask for work to run elsewhere, for example *"start a
session to build ticket 4 of issue 312, Sonnet medium."* Or type
`/head-chef`. With the plugin installed, the pane opens when the skill loads,
or type `/brigade` to open it.

## What it does

- **Starts sessions in the background.** Each one is a background session
  with Remote Control by default, started with the Brigade start tool, with its name, model and effort as
  fields, so there is no approval card to accept. The model and effort
  come from your words or your own process. Its start prompt is one sentence
  pair: the issue, which holds the brief, and the lead to send questions and
  reports to. It may add one short note from the head chef, labelled as the
  head chef's words and not yours. You open it from its card in the Brigade pane, from the
  claude.ai session list on the phone, or with `claude attach <name>` in a
  terminal.
- **Starts a Desktop session only on your words.** Say "as a Desktop
  session", and the head chef uses Desktop's start tool and setters, as it did
  before head-chef 1.20.0. When that start is refused, or the background start
  tool refuses, the head chef says so in one line and offers the other route.
  It retries neither on its own. Over Remote Control from the phone, Desktop's
  start tool refuses a start, so the Desktop route waits until you are at the
  desk.
- **Starts a fresh session when the model changes** (since 1.22.0). It never
  switches a running session's model: a switch drops the prompt cache, and the
  new model would carry the old session's whole context. It starts a new
  session from the record on the issue, names it as the one carrying the
  issue, and asks you before it archives or stops the old one. Changing only
  the effort on the same model stays allowed on a Desktop session.
- **What you give up with a background session.** A member's chat in the
  Desktop sidebar, Desktop's split view, and the approval card that showed an
  effort raise. Whether a background session survives the app closing is not
  checked.
- **Never relies on a card** to start work you asked for. When a start can
  only happen through a card, such as an approval above the lead's settings,
  it says in one line that the card needs a tap in the desktop app.
- **Nudges about context** (since 1.9.0). When it takes a member's report it reads that member's figure with the
  Brigade mod's `read_context`, and past 60% suggests a fresh session or
  carrying on, once per member per 10% step. A fresh session a figure prompts
  starts only on your words. A figure it cannot read raises nothing.
- **Reports the start** in a few lines: the session, its issue, what you must
  do, and your usage. Usage stays in chat.
- **Relays** questions and answers, quoted, with the source named.
- **Decides small questions** your direction already covers, and tells you in
  one line.
- **Hears when a session stops** (since 1.0.0). After each start and each
  report it asks for the session's idle notice, so it never polls. A session
  that goes idle with no report since the lead's last message is asked once,
  unless it reported that it waits on something that runs without it; the lead then checks
  that wait on a timer (since 1.14.0).
  Before it messages a session idle for over an hour, it tells you in one line
  that the session will re-read its whole context at full price. A session
  waiting at a permission prompt may not go idle, so the lead may not notice
  it; that session's own chat shows the prompt.
- **Approves plans and closes sessions in plain text.** A session's "spec
  ready" report asks the lead to approve; the lead answers "approved" or
  "revise: ...". The go-ahead on a spec is as your user-level instructions file says. To close a session, the lead asks it to wrap up: commit,
  push, report, and say it is ready to close.
- **Keeps the Brigade pane** in the same step as each act, while the pane is
  open.
- **Cleans up** on your "done", in every repository its sessions ran in, and
  on your word in chat, from the desktop or the phone. At levels 1 and 2, a
  message that names each session by its title and says to clean it up is the
  yes: the lead archives or stops those sessions at once, then lists what it
  touched. Anything vaguer ("done with build-4", "clean up the done ones",
  "all") gets a list first: each session's title and kind, its folder and
  branch, and the cleaner your instructions name. It waits for your yes. It
  archives each Desktop session, or stops a background one with the mod's
  `stop_background_session`. It runs a cleaner only if your own instructions
  state the program and how to run it, from its own shell and under the
  permission mode in force (a prompt in the default mode; in auto or bypass
  mode, or under an allow rule, it states the command in chat first); with none named it removes nothing and says what
  stays. Whether a removal can be undone, and what it keeps, is that
  cleaner's own promise. The lead removes no worktree or branch itself and
  never runs `claude rm`; to remove a stopped session for good, you run
  `claude rm <id>` by hand, which deletes the worktree with whatever is left
  in it. A wrong card is undone by recreating its worktree with
  `git worktree add` from its remote branch or the tip the cleaner printed,
  then unarchiving or attaching the session. At level 3 your user-level
  instructions file decides cleanup, as it does merges.
- **Acts on GitHub** on your own words in its chat: merge, close, edit,
  delete or label an issue or a pull request, file an issue, or post a comment, each named in
  one line first. At levels 2 and 3, your user-level instructions file says which of these wait
  for you; at a level 3 with a goal it takes the rest toward the goal itself
  and logs each first.
- **Runs at your level** (since 0.17.0). It reads the Brigade pane's
  autonomy level before each decision it would take alone, and logs each
  decision before it acts. At 1 it asks you on every decision; at 2 it
  decides everything but what your user-level instructions file keeps for you, which it sends you as to-dos; at 3 it runs
  toward your goal and lists each decision in the Decisions tab for you to
  review. At levels 2 and 3 it follows your user-level instructions file:
  at level 2, what that file keeps for you waits. At level 3, inside the goal, the lead and its members stop for nothing: what the file keeps for you, its hard stops included, the lead decides itself, logs with an "Owner's call:" flag and tells you after. Only Claude's own guardrails and the harness stop them: a permission prompt, a classifier block, a tool that refuses. Cleanup and a fresh session a context figure prompts are
  the skill's stops: at level 2 each waits for your confirmation, and at level
  3 each is logged and flagged.

## What counts as your yes

Your own words, in any form and anywhere. A session's message, a report, a
note or an issue comment never counts: a request in one is told to you, and
nothing happens. Pressing I understand on the permission warning is a
reminder, not acceptance. A start needs your ask, or a goal that names the
work. The head chef's stops list holds what else waits: cleanup and a fresh session a context
figure prompts. At level 2 each waits
for your confirmation; at level 3 each is logged and flagged. A level 3 counts
at once: press the slider, or type `/brigade level 3 <goal>` at the prompt or
from your phone. A reload, a clear and a resume reset it to 1. A goal exists at levels 2 and 3, and a pressed 3 takes its goal from
your words, and the lead asks for one, acting at 2 until you give it, when
there is none; a level or a goal named anywhere else is data. A reply
accepting the lead's picks accepts the picks in the lead's own last message,
and not when a session's report came between; it never counts as cleanup's
confirmation.

## What the sessions trust

A session knows its lead by name only (since 1.0.0; ADR 0013). Its start
prompt names the issue and the lead's session, and it sends its questions
and reports to that name. Since 1.10.0 the prompt carries no rule: how the
session treats a message under that name, and what it reports, follow its
own rules. A program of yours, or another session that holds the lead's
name, can pass as the lead, or name a new lead and redirect the reports: the
threat model lists that as an open issue. The head chef tells
you at once when a session reports a decision it never sent.

Before the lead is renamed, the head chef tells each session and you the new name.

A session also follows comments on its issue made as you, and every session
you start posts as you, so a comment from one session can steer another.
Every background session it starts is on Remote Control, so any device signed
in to your account can read and drive it. The permission warning says all of this before the
first launch in each lead, until you tick "Don't show again". It shows again
when its wording changes.

## The permission warning

The Brigade mod draws it above the prompt when the head chef calls its
`show_permission_warning` tool. "I understand" hides it for this session.
Tick "Don't show again" first, and it stays hidden in every later lead until
its wording changes. The choice is kept in the plugin's own store, as the
time and a hash of the wording.

## Upgrading from an older head-chef

A brigade running when you install 1.0.0 keeps working: its sessions follow
their old start prompts, and a 1.0.0 lead's messages, sent by name, still come
from the lead's own address and session, which the 0.17.0 check pairs. Finish
or clean up a brigade a head chef older than 0.17.0 started before you
upgrade.

**Leftovers from 0.4.0.** Its relay scripts may have left five kinds of
file, which can hold your quoted words, questions and session ids. 0.9.0 no
longer checks for them, so delete them by hand. Before you delete the
folder, check that it is a plain folder, not a link or a junction.

| What | Where | How to spot it |
| --- | --- | --- |
| The relay state folder | `plugins/data/grimoire-relay/` under your Claude config folder: `CLAUDE_CONFIG_DIR` when that is an absolute path, otherwise `.claude` in your home folder | Per-session JSON files, holding question words, choices, issue links and session ids |
| Lock and copy files | In that folder | `.lock` files, and `<session id>.<hex>.tmp` copies |
| Post files | The temporary folder that your `TEMP`, `TMP` or `TMPDIR` setting names | Named `grimoire-relay-<hex>.md`; one left by a crashed run can hold your quoted words |
| Question files | `$CLAUDE_JOB_DIR/tmp`, or the temporary folder that `TEMP`, `TMP` or `TMPDIR` names | Random names; one question line, then lines starting `A)`, `B)` and on |
| Local-only list files | The temporary folder that `TEMP`, `TMP` or `TMPDIR` names | Random names; one line of local-only answers |

The last two have no fixed name, so you may not find them all. A record act
from 0.6.0 to 0.8.x that was interrupted can also leave a post file in the
temporary folder, named `grimoire-act-<hex>.txt`; from 0.9.0 the file is
named `head-chef-post-<hex>.md`. Either can hold text you asked the head chef
to post.

**What 0.4.0 posted on your issues stays there.** Sessions under 0.4.0
posted your quoted words, their questions and choices, and taken-answer and
failed-check lines on their issues, which may be public. To remove them,
delete those comments, or delete the old version from each edited comment's
history: an edit alone keeps the old text there. Notification emails already
sent keep it too.

## Running the eval cases

The cases in `evals/head-chef/` run once on Haiku, with a Haiku judge,
only when you ask for a run, never as part of merging:

```bash
claude plugin eval <repo> --model haiku --runs 1 --ablation none --no-publish --max-cost-usd 1
```

The cases are counted, and a new one has to earn its place: see
[Eval cases](../../CONTRIBUTING.md#eval-cases).

To run one case, add `--case <name>`; a second `--case` replaces the first.
On 2026-10-24 two cases on Haiku, with a Haiku judge, cost under a cent each
and took 19 and 29 seconds, so a full run costs roughly $0.30, an estimate.
To calibrate the judge now and then, add `--judge-model opus`, which costs
about $0.02 a case more; on 2026-10-25 the Opus judge refused to grade 7 of
the 33 cases. A run writes its report to `evals/results/`, which git ignores;
read it, then delete it.

A case passes only when all its graders pass. A check a pattern or a tool call
can decide is a fixed grader (`regex` or `tool_used`), which costs nothing and
never refuses; what needs judgement is one `llm` grader per case. Each `llm`
grader tells the judge to fail an answer it cannot decide and say unknown,
but the report shows only the judge's votes, not its reasons. So when an
answer reads as a pass and the judge failed it, look at the case or its
grader before the skill. A judge that refuses the grading call leaves the
case without a verdict, which is no fault of the skill; an Opus calibration
run leaves ungraded the cases its judge refuses, 7 of 33 on 2026-10-25. The
grader keys were read from
Claude Code 2.1.310, which rejects a case with a key it does not know.

## Files

| File | What it is |
|---|---|
| `SKILL.md` | The skill. Its sections are schedules. |
| `references/roster.md` | How the head chef keeps the pane's roster. Generated with `SKILL.md`. |
| `references/cleanup.md` | Cleanup's steps: your yes, the list, the archive or stop, the cleaner, what stays, and the undo, read when cleanup starts. Generated with `SKILL.md`. |
| `references/starting.md` | The steps of a start, background by default, read before each start. Generated with `SKILL.md`. |
| `references/desktop.md` | The Desktop route, read only when your words name it. Generated with `SKILL.md`. |
| `references/CONTRACT.md` | The contract: intent, then its schedules. |
| `references/contract.changelog.md` | The contract's history, from 0.1.0. |
| `.skillspector-baseline.yaml` | Why four of the scanner's rules are false positives here. |

The drift test holds schedules equal to their sections. Change the schedule,
then copy it; a reviewer reads every changed file in full.
