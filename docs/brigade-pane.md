# head-chef and the Brigade pane

The detail behind the [head-chef section of the root README](../README.md): what the head chef may do in your name, the Brigade pane (sessions, pull requests, decisions, the autonomy levels, the context and burn-rate views), and the usage summary files with their known limits. It moved here whole from the root README, so the front page stays a front page. For what the skill does, what counts as your yes and what cleanup names back, read [`skills/head-chef/README.md`](../skills/head-chef/README.md).

## What the head chef does

Reach for it in Claude Desktop when you want work to run in another session,
or want to lead several at once. head-chef starts each session as a Desktop
session under the lead, one you can talk to directly, with the model and
effort set. Its start prompt points the session to its issue, which holds the
brief. It takes the session's milestone reports, relays between sessions, and
cleans a session up when you say it is done, on your yes in chat, from the desktop
or your phone.
It takes the when and the why from your own process, and it never counts a
message from another session as your yes to start, archive or delete. On your
own words in its chat, it can also merge, close, edit, delete or label an
issue or a pull request, file an issue, or post a comment. The sessions it starts get only
their issue and the lead's name, and treat a message from the lead by their
own rules; a session cannot tell a forged sender from the lead. Before its first launch in a lead, a
permission warning above the prompt says so. Read the skill's README before
you install. Not for work in the same session.

## The Brigade pane

`/brigade` opens the Brigade pane, and so does loading the head-chef skill from the plugin or from your own skills folder: one compact row per session the lead
started. A switch at the top shows Sessions, Pull requests or Decisions, and
the pane opens on Sessions each time. Sessions keeps three foldable groups: Waiting
on you, Working, and Done · stopped, which starts folded and counts the reports
its sessions sent since you opened the pane. Waiting on you holds your to-dos
alone. A session the lead marked idle, or a working one that is idle or waits on a
prompt, stays under Working, marked idle, and the status strip counts it apart. A row shows a checkbox, a status
dot, the title, the latest report's first line, the live busy or idle
state (a row shows the session's own title) and how long the session has been in its status. Model and
effort show as the settings line the lead wrote, at the right of the pull request pill on Desktop. Pressing it opens a small
popover with the same words, and a `⋯` on each row holds Open, Split and
Dismiss, each only where it applies; in the terminal Open and Dismiss are always shown. A pull request
pill opens the pull request in your browser.
Since 0.144.0, on Desktop only, a row that fits one of three actions shows a
button left of the `⋯`: **Ask** on an idle row, **Merge** on a done
row with no `repo` whose pull request `gh` says is open, and **Clean up** on a
done or stopped row with no pull request or one `gh` says is merged or closed.
A button puts one line in your prompt box and sends nothing: you read it and
press Enter, so the yes is still yours. Ask fills `What does <title> need from
me?`, Merge fills `Merge PR #<n> in <owner>/<name>.`, and Clean up fills `Show me
what cleaning up <title> would remove.`, which asks for the list first. A title
with anything but letters, digits, `.`, `_` or `-`, or over 80 characters, gets no button, and a button does nothing while the box holds a
draft (a toast says so). If the box cannot be filled, a toast shows the line to type.
The terminal, the phone and VS Code draw no button; ask the lead in chat there.
Tick several rows and a bar at the foot dismisses them together. An idle row has no
checkbox and can be dismissed while it stays idle; it comes back when its status
changes or it stops being idle. Reopening the pane brings
dismissed rows back. The pane's section bars, hover and selection bar are drawn
for Desktop's dark theme, so in a light theme they look darker than the rest of
the app.

The lead can put each session's pull request on its row. A pill shows the
number in the state's colour. The Pull requests view lists those pull requests
grouped Open, Draft, Merged and Closed (a draft has a grey pill), with title, added and removed lines, repository
and age. While the pane is open and a row carries a pull request, the pane asks
`gh` for the details once a minute, and stops once every pull request it shows is merged. When
a session's pull request is in another repository than the lead's own, the lead
can name it on the row (`repo`, as `owner/name`): the pane then asks `gh` about
that repository too, at most 6 runs a minute in all, the repositories taking
turns past five, and the pane names it on the Pull
requests row. **The
details need `gh` installed, signed in, and run from a github.com repository.** On
macOS and Linux the pane also asks only when every folder on PATH is an absolute
path. Without them the pill shows the number and the state the lead last knew, and the
Pull requests view says "PR details unavailable". A pull request opened from a
fork is never shown as the brigade's.

The lead logs each decision it takes or relays with the `log_decision` tool,
and the Decisions view lays them out for you to review. To review shows the
oldest decision you have not read, at full size: "n of N", the pick, which session wrote it,
whether it was the lead's own pick or your answer as the lead relayed it, the
time and level, the question, the options, why, how to undo it, and when to
revisit it. "✓ Read, next" marks it read and shows the next; "⚑ Flag" marks
it read and puts it in Flagged to revisit; Skip shows the next without marking
it. Flagged to revisit, folded at first, holds the flagged decisions oldest
first; each row opens into the same card, with "⚑ Unflag", and its pick box
feeds the same selection island as the Sessions view, whose Dismiss unflags
the picked rows and marks them read. Since 0.93.0 the lead can flag a
decision it is unsure of, with a one-line reason: the decision goes straight
to Flagged to revisit, in the pane of the lead that flagged it. It never goes to To review, so Mark all as read never takes
it, and its card shows "Flagged by the lead" with the reason. Only you unflag it,
and the flag holds nothing up: the lead still acts on its pick. A session
still on an older version cannot read a log that holds a flag until it
reloads; never delete that log to clear its refusal. No press removes a
decision from a log.
Your marks survive a reload and a new lead. History, folded at first, holds
every decision newest first, 50 at a time. On Desktop and the terminal a
search box filters all three by every word you type.

Since 0.121.0 (issue 509) the tab draws only this session's own decision
log, and nothing from any other log: no carried card, no line for an ended
session, no fold, no flagged row and no count of another log's entries. The
current lead is the session whose id the pane reads as its own, so whatever
keeps that id keeps its log in view; a new session id starts a new lead with
an empty tab. Earlier sessions' logs stay on disk, untouched, and you see one
again only by resuming that session in its own chat. The tab reads this
session's own decision log and marks file and no other session's, and so does
a full log's drop rule. A question meant for you in an
earlier lead's log stays in that lead's log. "✓ Mark all as read", at the right of To review's heading,
marks everything under To review read in one write: every card of this
session's log, Lead, Relayed, waiting entries and alarms, including its own
waiting entries that no Relayed entry answers. It ignores the search: it takes everything
under To review, whatever is typed. The label does not carry a count. A press
takes up to 500 entries, which a lead's appends keep this log's unread
entries within, so one press empties To review. A press marks nothing if the set
changed since the pane last drew it, or if your marks file is so full that the
write would push out marks of entries you read. A question marked read keeps
its link, so an answer logged later still pairs with it.

Since 0.91.0 a question in this lead's own log and the Relayed entry that
answers it, both unread, show on one card in To review. Since 0.132.0 that
card draws the question once, its options with the answer's pick marked, the
answer's pick as its headline, and the answer's writer, label, time, level, why,
to undo and revisit. One "✓ Read, next" marks
both read in one write, Flag flags both and Skip moves both. To review's count
and "n of N" count the card once; the tab's totals still count entries.

A mark from any bulk press records the press, not a
reading of each entry, and the marks one press writes share one press time.
A claim it marks stays in History only until its log's cap drops it as a
read entry.

At the foot of the Decisions view, the autonomy slider sets how far the lead
may go on its own. At 1 Manual the lead asks you on every decision. At 2 Auto
it decides everything but what your user-level instructions file keeps for
you, and sends you that as to-dos while it carries on. At 3 Turbo (Turbo mode before 0.113.0), once you
press 3 or type `/brigade level 3 <goal>` at the prompt or from your phone,
it runs toward your goal: it checks whether the goal is met, and if not,
continues, until it is met or you say otherwise. A press counts at once; the
lead asks for a goal in its chat when there is none, and acts at Auto until it has one. At levels 2 and 3 the
lead follows your user-level instructions file: at level 2 what that file keeps for you
waits for you, as a to-do; at level 3, inside the goal, nothing waits, and the lead
decides it, flagged "Owner's call:", stopped only by Claude's own guardrails and the harness. Cleanup's yes is yours in chat at levels 1 and 2, and at level 3 your user-level
instructions file decides it; a fresh session a context
figure prompts waits for you at level 2, and is logged and flagged at level 3.
Only your press or your own `/brigade level 1`, `/brigade level
2` or `/brigade level 3 <goal>` moves the level, and
the level in force is drawn on every view (on Desktop, at the pane's foot), 3 in the warning colour; a lowering or a 2 you type also gives the lead one turn, so it reads the new level at once (a 3 does not: tell the lead yourself); a 3 the
command set shows its goal under the slider. Each move
is logged as your own decision ("Owner"). The level is the last one set, held
in the mod's memory; a stored copy in plugin state serves one job, a reload,
and something else rewriting it changes nothing (since 0.116.0; before that,
it set the level back to 1 and raised an alarm, and old logs still show those
alarms as "Not from a press"). A compaction keeps the level, whether a press or a command set it
(since 0.116.0). A new lead session starts at 1, and so does a
reload of the mod, a clear and a resume; a reload from a level above 1 is
logged as "Pane". Showing the pane again no longer resets it. A reset that
cannot be logged is said on the pane and tried again. The lead reads its level
with the `read_autonomy` tool, whether the pane is open, behind another tab or
closed. While level 3 is in force, a line above the lead's prompt says so,
with the time of its press and a Dismiss, which hides it until the next press
of 3, or the next compaction or reload. The line shows on the terminal and
Desktop only: the mobile app, claude.ai and VS Code draw nothing above the
prompt. Since 0.105.0 it stays above the next-step box at the end of the
lead's turn, and above any other survey. If you go back to a mod older than
0.88.0, its Decisions tab leaves out a compaction's Pane entry and counts it
among the entries it cannot draw.

Under its cache bar, one context bar shows how full the session's context is: amber
from 70%, red from 90%. Once the session has made two calls and its window is known, that
bar is a bar of the context against its window, with a tick where auto-compaction fires
(your `autoCompactWindow` setting when it is set and under the window, else the window
less 33k, never under half of it, marked with `~`) and a dot on the bar for each of the
last five turns since the last compaction that added more than 20k; amber and red then
count the way to the tick. Icon buttons on the row switch to two more views. Burn rate is a
sparkline of the new tokens the session spent in each of the last 30 minutes,
with its rate per minute. Context trend shows the same bar with `<used> of <window>` beside it, and
under it `compacts at ~N` with an estimate of the turns left from the average growth per turn
since the last compaction; it shows only when the row has that bar. No row draws a chart of
its last calls' context or a count of compactions, and none draws a reminder to reply or
to hand off. A row shows these buttons only when it has more than one view, and
keeps your choice while the lead session lasts. At the bottom of the pane
it shows the lead session's own rate limits and context. A faint extension on
the session and weekly limit bars shows where each will be at its reset if the
current pace holds, and a red note says how early a limit runs out when that
pace would pass 100%. It needs the plugin install above. The skill works
without it.

## The skill's own pages

What it does, what counts as your yes, and what cleanup names back:
[`skills/head-chef/README.md`](../skills/head-chef/README.md). The skill's contract, which
its `SKILL.md` is generated from:
[`skills/head-chef/references/CONTRACT.md`](../skills/head-chef/references/CONTRACT.md).

## Usage summaries, and the limits of what the pane draws

Since 0.60.0 every session with the plugin writes its own usage numbers to a
small summary file. Since 0.61.0 the pane draws a member's card from that file
whenever it passes its checks, so a member whose transcript is too large to
read keeps its cache line, context meter and views. A card that reads "summary
path refused" or "not a summary file" is drawn from its transcript instead:
the member's file failed the path check, or the same file failed its checks
two polls running. SECURITY.md says where the files are.
Since 0.115.0 the pane looks for a member's summary in the data folder of every
install of the plugin, not only the lead's own, because a member started from
another install writes to that install's folder. It reads the lead's own folder
and at most seven others, each a plain folder named `grimoire-` and an id, by
the same checks. The passing file with the newest last call feeds the card.
Since 0.62.0 a member keeps the Remote Control link the pane read while its
transcript was 4 MiB or less, once the transcript grows past that and after a
plugin reload. **Known limits:** a member first seen with a transcript already
over 4 MiB, or one that turned Remote Control on after it passed 4 MiB, shows
no link; and after a reload, a card whose name moved to another large session
can show the old session's link. If you notice a missing link, a read of just
the start of a large transcript, through a process, is the next step (issue
#308).
[`SECURITY.md`](../SECURITY.md) says what the file holds and who can read it.
**Known limit:** a card the pane draws from that file counts its cache down from 1 hour after the last call, because the engine's
per-call usage does not say whether a call cached for 5 minutes or for 1 hour.
A session whose main conversation is not on the 1-hour cache can then show
warm for up to 55 minutes after its cache went cold. This holds at every transcript
size, including members whose transcript the pane could read and whose window
it showed correctly before. Examples: a session in usage overage; a session on
an API key, or on Bedrock, Vertex or Foundry, without the 1-hour opt-in; a
session through the Claude apps gateway, or a gateway that drops the 1-hour
header; and a session where a setting or environment variable chooses 5
minutes.
