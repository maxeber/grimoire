# Security

## Reporting a vulnerability

Use GitHub's **private vulnerability reporting**: the "Report a vulnerability"
button under this repository's Security tab. It reaches the maintainer and
nobody else.

Do not open a public issue for a security problem. That includes anything that
would let a crafted file run script in a reader's browser, or change what an
agent does.

This is a personal project with one maintainer. There is no SLA and no bounty.
You will get an honest answer and, if the finding is real, a fix.

## Scope

**In scope:** everything in this repository. That means both manifests, every
`SKILL.md`, the renderers and page templates, the edge audit, the Brigade
mod in `brigade/` and `hooks/`, the check scripts, and the CI workflows.

**Out of scope:** Claude Code itself, your own box and flightpath files and what
you put in them, and wherever you host a page the renderer wrote.

## What this project is, in threat terms

grimoire is a set of agent skills and one Claude Code mod. A skill is prose an
agent follows, plus a renderer that turns a JSON file into one self-contained
HTML page. There is no server, no account and no database. Node runs the
renderer on your machine, and neither the renderer nor the page makes a network
request.

**The Brigade mod is code Claude Code runs in every session that has the
plugin.** It is a hooks module, `brigade/register.tsx`, named by
`hooks/hooks.json`, and it runs with the session's own rights. At session start
it registers `/brigade`, a `skill.prompt` hook, and the two hooks of its usage summary writer, below;
since 0.74.0 (#380) it also hooks the `Skill` tool's call, the typed `/head-chef` and `/grimoire:head-chef` commands, and each turn's start, and each of those passes on with no engine call unless a head-chef load is under way or a load left the pane waiting (the turn start also, at a level 3 and once after it, for one level-3 note, fixed text that after a command 3 ends with a copy of the owner's goal): where the security default skips `skill.prompt`, a model's head-chef load opens no pane and leaves one fixed note asking for `/brigade`, and a typed one that Claude Code itself answered opens the pane only after one read of the session's local skill list confirms the copy is grimoire's or the owner's; the notes are fixed rows added to the conversation, each starting "Brigade (plugin note):";
since 0.73.0 (#376) its `skill.prompt` hook reads each skill load's name, source and plugin name, acts only on a head-chef skill from a plugin named grimoire or from any user-level skill of that name, and on such a load opens the pane when it is closed, which starts the reads and the `gh` call below and offers `set_roster`, even when the model chose the load (when the engine does not place the pane, it starts none of that and shows a fixed toast naming `/brigade`), and appends one fixed line to that skill's text, never text from the event, the roster or an error;
since 0.69.0 it also reads one key, `permission-warning-ack`, from the plugin's own store and offers a second tool, `show_permission_warning`, below (0.117.0 added a second key, `cleaner-path`; since 0.118.0 nothing reads, writes or deletes it, so a value left there stays, unencrypted and readable by other plugins; since 0.148.0 it also reads the old `startFolders` key once at each session start and deletes it when present);
since 0.158.0 (#208) its Incantation mic band starts a timer at the band's first draw in every session, which reads one file, `~/.grimoire/incantation/run/levels` (a stamp, a state word and 24 digits of mic loudness, no audio and no text), four times a second while a listener writes it and once in eight ticks otherwise, and a press on a band button writes the one word `mute`, `unmute`, `mute-voice` or `unmute-voice` to `run/command` beside it, and the band also reads `run/voice` (one word, `muted` or `on`) the same way;
since 0.164.0 the same mod holds Incantation's voice relay and permission nudge, which act only in the session whose own typed `/incantation` turn ran the skill's `listen.mjs start`; the mod reads each main-thread shell command's text, in every session, to find that start, and keeps only a flag, and it holds the listener's one `wait` in the bound session, holds the listener's one `wait` through `$.process.spawn`, sends each heard turn into the chat as a user-role `[voice]` prompt (or, while a turn works, as context on a tool result), and on a permission prompt or a long tool call runs the skill's `nudge.mjs`, which speaks one fixed line and never answers the prompt; no heard text is written anywhere, and `docs/security/brigade.md` holds the row for each call;
and it holds no idle rule: the owner removed it ([ADR 0019](docs/adr/0019-the-brigade-mod-holds-no-idle-rule.md), which supersedes [ADR 0008](docs/adr/0008-brigade-is-no-longer-idle-by-default.md)). While its pane is open it reads
the engine's own session files, `<config>/sessions/<digits>.json`, for each
session's name, status, waiting reason, update time,
session id and folder, and its Desktop id and job id only to match a card to its
session, never kept. It never opens the key file
beside each by name; a hard link to it is not caught, as for transcripts, and
nothing is kept from a file that is not a session file. The files are the
engine's and undocumented, read as Claude Code 2.1.304 writes them (the background-session fields were measured on 2.1.302); when one
fails its checks the pane says it cannot read the session files. Since 0.67.0
it no longer runs `claude agents --json`, which made every running session do
work at once. It also reads the lead session's roster file from the plugin's
data folder, and reads other sessions' transcripts to find a session's link
and its model calls' usage, which gives each card its cache-warmth line and,
since 0.55.0, its context meter, and since 0.56.0, its burn rate and context
trend; of the model id it keeps only the window
size a fixed table gives the model's family.
Since 0.127.0 the pane also reads the one whole number `autoCompactWindow` from
`settings.json` in the config folder (a file of at most 1 MiB; nothing else of it
is kept or shown) to place the context view's compaction tick.
To find a transcript that moved into a worktree folder, it lists the config
folder's `projects` folder at most once a minute, and reads a transcript only
where a resolving `stat` places it inside that folder.
For warmth and the context meter, a transcript is read again only when it
changes, and never when it is over 4 MiB. A working session's transcript is
read at most once a minute, and at most 5 of them a poll. For the link, a
transcript is read again only when its found path changes. It also reads this session's own usage, its rate limits and context, when the
pane opens and, while it stays open, each time the engine measures the
session, and once more for a typed head-chef load where the security default
skips `skill.prompt`, to read the skill list; it asks only for
the local summary estimate of the context breakdown, which sends no request.
On an Open in app press it reads three environment variables, `OS`,
`SystemRoot` and `windir`, only to tell whether each is set or `OS` is
`Windows_NT`; it never stores, shows or sends them. (0.117.0 also read
`HOME` or `USERPROFILE` for the cleaner command's replies; since 0.118.0 it
does not.)
It makes no network request of its own, apart from the `gh` call below; its
one tool call, below, goes to whatever connected server answers to the name
`ccd_window`. Besides each session's own usage summary, and since 0.81.0 the decision log and the owner's marks and from 0.83.0 to 0.168.0 the lead hand-off, all below, it writes one file, the lead session's roster,
through a tool the model calls, `set_roster`, which skips Claude Code's
permission prompt. So that write has no human and no classifier review; every
call is still recorded in the transcript as the tool's result. The tool exists
only once the owner runs `/brigade` or the head-chef skill loads, which offers it again when the pane is already open, or at the first turn that finds a pane the load left waiting shown, writes only while the pane is open, and
refuses a subagent's call, a deny verdict, an owner's ask rule, any input
outside the roster's shape and size, and any link on the way to the file. It
writes in every permission mode. It finds the Claude config folder from the install
location, else from the session-start record it keeps in plugin state, else from
Desktop's synced install folder. A deny rule for `mcp__grimoire__set_roster` removes it
from the session; the owner's own hooks do not stop it. The second tool,
`show_permission_warning`, is offered in every session from its start, so the
head chef can call it before its first launch with or without the pane. It
takes no input and writes no file: it draws the head chef's permission
warning above the prompt. It refuses a subagent's call, a deny verdict and an
owner's ask rule that names it. When the owner ticks "Don't show again" and
presses "I understand", it writes the time and a hash of the warning's
wording to the plugin's own store, under `permission-warning-ack`, and the
band stays hidden in later sessions until the wording changes. The band draws
that stored time only as a date. The store keeps it unencrypted until it is
removed, and the mod mirrors it in plugin state, which other plugins can read. When the owner presses
Open in app on a card with a Desktop id, it first calls the Claude Desktop
app's own tool, `open_session_in` on the server named `ccd_window`, sending
only that card's checked session id and the fixed target `split`, so the app
shows the session beside the lead. That call also skips the permission prompt,
and the owner's own hooks do not see it. It is made only where the Desktop app
draws the session, and only when the engine lists
`mcp__ccd_window__open_session_in` by that exact name and the engine's verdict
for it is not a deny or an ask naming a rule, so a deny or ask rule for that
tool stops it. An exact deny rule was seen to stop it on Desktop 2.1.289; a
rule for the whole server, `mcp__ccd_window`, rests on the engine matching it
the same way, which was not tried there. When that call is refused,
fails or takes over 5 seconds in all, or the card has no Desktop id, its one
other process, besides `gh`, is the host's opener, given a `claude://` link: `explorer.exe`
on Windows, as before, `/usr/bin/open` on macOS and `/usr/bin/xdg-open` on
Linux, the last two by absolute path. The absolute path pins only the opener:
on Linux it then starts its desktop helper, or a fallback browser, by name on
the inherited PATH. On a host it cannot identify it runs nothing.
**Since 0.64.0 the pane runs `gh`.** While its pane is open and a shown card
carries a pull request number, it runs `gh pr list` with one fixed argument
list, with at most one checked owner/name from a card's field passed as
`GH_REPO` in the run's environment, whose characters keep any host form out
(no host part such as `example.com/` can pass): once a minute per repository,
at most 6 runs a minute, the named repositories taking turns past five, with a
15-second limit and one run at a time. Since 0.122.0 a press of a pull request
pill also runs `gh pr view <number> --web`, a second fixed list: its one
variable argument is the card's checked pull request number, on the command
line, and the repository `gh` answered with is its `GH_REPO`, behind a constant `github.com/` host. It has the
15-second limit and no rate limit, and `--web` hands the page to the program
`GH_BROWSER`, `BROWSER` or `gh`'s own configuration names, which inherits the
session's environment (an open issue of the threat model). Since 0.136.0 a press of a to-do's pull request link button on Desktop runs `gh pr view <number> --web` the same way, a third fixed list: the number and the owner/name come from a link in one closed github.com pattern that the lead writes in the roster, so the lookup can be in any github.com repository, under your GitHub sign-in (widened, waiting on the owner's confirmed merge). A to-do's link may also be an issue, or one comment or review on such an issue or pull request, with a numeric `#` fragment; the pane draws it as the engine's link on every surface, Desktop included, runs no process for it, and the Desktop app's own opener, not `gh`, picks the browser (widened by issue 567, accepted by the lead at level 3 in decision 487 and flagged big). A to-do's link may be a Linear identifier; with `GRIMOIRE_LINEAR_SLUG` set, a press on Desktop gives the built `https://linear.app/<slug>/issue/<identifier>` address, as one argument, to the host opener Open in app uses, and with none set it is plain text. Since 0.85.0 a card may carry `repo`,
the owner/name of its pull request's repository when that is not the lead's
own; `set_roster` refuses any other value, and a roster file holding one fails
its read. The roster file keeps the field at rest with the rest of the card,
unencrypted, private repositories' names included, and the roster, `repo`
and a to-do's `link` included, is also held in plugin state for the session, which other plugins
can read. For a named run, as for the base run, `gh` still chooses the host,
from `GH_HOST` or its own default; only github.com answers are drawn.
`gh` is the owner's own GitHub command line tool: the call sends the owner's
GitHub credential to GitHub, and it inherits the session's environment, keys
and tokens included. On Windows the engine was measured to run the real `gh`
from the system path, not a stub in the working folder. On macOS and Linux the
pane runs nothing when the inherited PATH has an empty or relative entry. The
environment and the working folder's git remotes choose the repository for
the cards that name none, and the pane pins the first answer's repository for
the session. A named repository's answer counts only when every pull request
in it names that repository, and its rows, up to 100, stay in module memory
and go once no card names it. A named card's Pull requests row names the
repository the card names, and link to its pull request only once `gh` has
answered for it. The titles and
repository names it gets, private ones included, are drawn on every surface;
its error text is never shown or stored.
Everything it reads is checked and drawn as text, in the usage image too, except two addresses the pane rebuilds itself from a checked parse and draws as links: a pull request row's page off Desktop, and a to-do's `link`.

**Since 0.60.0 every session that has the plugin writes its own usage
summary file**, whether or not it is in a brigade, from its first model call.
A per-call hook (`turn.step`) and a turn-end hook (`turn.complete`) keep the
session's own numbers in memory and write them, numbers, plus one model-family word from a fixed list (opus, sonnet, haiku, fable), to
`brigade/usage/<session id>.json` in the plugin's data folder: at most once
every 15 seconds while a turn runs, and at each turn end. The file holds one
exact list of keys: a format version, the time the numbers were taken (to
the end of that minute), the time of the last call and its context size, the context size of the last 30 calls, the new tokens of each of
the last 30 minutes, the model family's window size from the fixed table (the
one key a file may leave out, when the table has no row for the model), and
whether any call wrote or read cache, and, since the card's model line reads it, the last call's model family as one word from the fixed list (the one other key a file may leave out). Never a model id, message id, text,
path, cost, rate limit or cache window; the writer makes no session usage call
at all. The write goes only where the roster's link-refusing path rule allows,
in a folder apart from the rosters, and overwrites only a file that is itself a
summary file, so a planted hard link to any file that is not a summary file is
refused; one to another summary file is not (below). The path rule
runs again after the write. On any refusal the writer stops until the plugin
reloads, a clear included, with one toast naming the kind of refusal in fixed
words. It asks no permission. What follows from it:
- **What the file reveals:** when each session last worked, its context size
  and its minute-by-minute burn, for every session the plugin ran in. The
  files are named by session id, so the folder is a lasting list of every
  session the plugin ran in, and the window size shows each one's model class. Any
  process running as the owner, other plugins, and anything that backs up or
  syncs the config folder can read it. It is not encrypted, like the
  transcripts beside it.
- **What does not reach the write:** no permission rule, mode, owner hook or
  classifier sees it, and it leaves no record in the transcript. Disabling the
  plugin is the only way to stop it.
- **What accumulates:** the mod never removes a summary file. There is one per
  session id, a clear or a resume starts a new one, and a file may outlast its
  transcript: Claude Code's own cleanup of old transcripts does not reach
  these files, and an uninstall that leaves the plugin's data folder leaves
  them too. The owner can delete the `brigade/usage/` folder by hand. A revert
  to an older version leaves sessions already running writing until they are
  restarted; delete the folder after that.
- **The race:** the check-and-write race the roster has now recurs in every
  session, with no hijacked lead needed, and a hard link between two
  summary-shaped files is not caught, as for rosters.
- **Since 0.61.0 the lead's pane reads the files** (issue #312): a summary
  file that passes its checks outranks the transcript at every size, with no
  check against it. A forged file from another process running as the owner can show any
  warmth, on members whose transcript is over 4 MiB too; the threat model leaves this to the machine: a forged file from a program
  running as the owner is the machine's, and from another plugin, a branch's code or a steered session it is an open issue. A step the transcript would not count restarts the
  hour, and a stopped writer leaves a card reading colder once the member is
  idle, with its meter and burn frozen, and it can draw a hand-off nudge on a
  warm cache. The 1-hour window's known limit, in the README, still applies.
  Four more gaps, each an open issue or a reliability note:
  - other plugins can read and rewrite the pane's list of refused summary
    files, and so plant or hide a refusal line (an open issue of the threat model, not accepted);
  - the summary read follows a link swapped in after the path check, as the
    transcript read does, and keeps only checked numbers (an open issue of the threat model, not accepted);
  - a session named like a card, or holding its id, feeds that card from its own summary file,
    a session with no working folder included (an open issue of the threat model, not accepted);
  - a writer whose files keep failing a check with fresh times freezes its
    card on the last good record with no line to say so (a reliability note, not a threat).

**Since 0.81.0 a lead writes a decision log, and the pane writes the
owner's marks** (spec 402, ticket 1;
[ADR 0010](docs/adr/0010-the-mod-keeps-decision-text-in-plain-files.md)).
The mod offers a third tool, `log_decision`, wherever it offers `set_roster`.
It appends one entry per call to the lead session's own log,
`brigade/decisions/<session id>.json` in the plugin's data folder: the
entry's source (`lead` or `relayed`), whether it waits for the owner, its
work, question, options, pick, reason, how to undo it, when to revisit it,
which waiting entry it answers and, since 0.93.0 (issue 459), the lead's
one-line reason for flagging its own pick, which only a `lead` entry that
does not wait may carry. The mod stamps the entry's id, its time from
the engine clock and the level in force (since 0.84.0, the level
`read_autonomy` would answer),
and refuses an input that carries any of them, a source other than `lead` or
`relayed`, or a field holding a control, hidden or direction-changing
character. Like `set_roster`
it skips the permission prompt in every mode, works only once the mod has
offered it to this session since its last reload, and since 0.88.0 with the pane shown,
behind another tab or closed alike, and refuses a subagent's call, a
deny verdict, an owner's ask rule and an organisation ceiling below allow;
each refusal is fixed words naming the rule, never a path, a verdict's reason
or an engine message. A deny rule for `mcp__grimoire__log_decision` removes it.
Its writes take turns in one queue, a log keeps at most 500 entries and 256
KiB, and past a cap it drops only entries the owner marked read and did not
flag, oldest first; with nothing to drop it refuses and the file is
unchanged. To tell which entries are read it reads this session's own marks
file, by its own path and with no listing (since 0.121.0, issue 509; from 0.89.0 to
0.120.0 it also listed the `brigade/marks/` folder and read the others newest
first, up to 8 MiB in total, a file over its cap taking nothing from the bound
and the rest counting as unread, which failed safe). A mark held in another
session's marks file, as panes from 0.90.0 to 0.120.0 wrote for entries they
carried from this log, counts for nothing from 0.121.0. When the owner presses "✓ Read,
next", "⚑ Flag" or "⚑ Unflag" in the pane's Decisions tab (since 0.91.0, spec
448, "✓ Read, next" or "⚑ Flag" on a card holding a waiting entry and its
answer writes both marks in one write), or Dismiss on its
picked Flagged rows (since 0.82.0, spec 402 ticket 2), "✓ Mark all as read"
(since 0.89.0, spec 444, one write for all the entries it takes), or, from
0.90.0 to 0.94.0, "✓ Mark these N read" (spec 447, one write for an ended
session's line), the pane writes a mark
for each entry, the log's session id, the entry's id and time, the state
(read, flagged or unflagged) and the press time, in one write, to its own
session's marks file, `brigade/marks/<session id>.json`, at most 2,000 marks
and, since 0.89.0, 256 KiB (64 KiB before; a mod of 0.88.0 or older refuses a
file past 64 KiB and counts its entries unread). Past a cap the oldest marks
drop in a fixed order that keeps a live flag for last and never brings back a
cleared one. "Mark all as read" matches its count-and-hash button key whole,
works out its set again inside the marks queue's turn and acts only when the
set is unchanged. Since 0.98.0 (issue 466) it takes everything under To
review, whatever the search shows (since 0.120.0, issue 509): every card,
Lead, Relayed, waiting entries and alarms, including the pane's own session's
waiting entries that no Relayed entry answers, which 0.109.0 to 0.119.0
(issue 486) left under To review; before 0.98.0, it took only the pane's own
session's plain Lead entries. Since 0.121.0 (issue 509) that is the pane's own
session's log alone: before, it also took cards and ended sessions' lines
carried from other logs. It writes nothing, and says the marks file is full of
entries the owner read, when the caps would push out a mark that is still an
entry's newest state. A mark leaves the log untouched, so a waiting entry marked read
keeps its link and a later answer still pairs with it. The hash is the mod's
unkeyed SHA-256 of the set's mark keys and protects nothing secret. A mark for
an entry in a log the pane no longer reads can still drop. "Mark these N
read" (0.90.0 to 0.94.0, spec 447), an ended session's line's own press with
key `dmarkended-<n>-<hash>`, is gone since 0.98.0: Mark all as read takes its
entries. Since 0.91.0 (spec 448) a waiting entry of
the pane's own session's log and the unread Relayed entry that answers it draw
as one card, and "✓ Read, next" or "⚑ Flag" on it writes both marks in one
write. Its keys name both entries, `dnext-<id>-<time>-<answer id>-<answer
time>`, holding no session id. Read, next, Flag and Skip now work out the card
shown inside the marks queue's turn, and act only when that card is still
the one shown with the same entries: a press on a card drawn alone never marks
an answer that arrived after the draw. "✓ Mark N relayed read" (0.91.0 to
0.94.0, spec 448) is gone since 0.98.0: Mark all as read takes its entries. The
marks one bulk press writes share one press time. Both files go only where the roster's link-refusing path rule
allows, overwrite only a file that passes the strict check of its own kind,
and are checked again after the write. While the pane is open, and only then,
it reads this session's own decision log and marks file by their own paths
and, until 0.168.0, listed the hand-off folder on the roster's 5-second poll,
reading the 20 newest other hand-offs for the Lead hand-off card. Since 0.121.0 (issue
509) it lists no other session's decision log or marks file for the tab and
reads none, and the Decisions tab draws only this session's own log: no card,
row, flagged row or count from another log, and no line or fold for an ended
session. The current lead is the session whose id the pane reads as its own;
whatever keeps that id keeps its log in view, and a new id starts an empty
tab. Before 0.121.0 (0.89.0 to 0.120.0) it also read the 20 newest other
logs and marks files and carried a waiting entry, a Relayed entry, an alarm
and a flagged entry of another log into the tab, and from 0.90.0 (spec 447)
told, from the engine's session files and the logs' entry times, whether
another log's session had ended, kept in the module and never written, and
drew an ended session's claims as one dim line and in History's fold "From
ended sessions". All of that is gone. It re-reads a file only when its size or
time changed, skips a file dated more than two minutes ahead, and draws this
log's writer by the engine's session name for its session id, or "an ended
session". `log_decision`'s drop scan reads this session's marks file alone, as above. Nothing it reads enters plugin state
but the search text, which other plugins can read until the next open clears
it, and a redraw counter. The project digest comes from the mod's own unkeyed
SHA-256 in `brigade/decisions.ts`, tested against the NIST vectors and Node's
own hash; it protects nothing secret. What follows from it:
- **What the files reveal:** every decision a lead logged, its reason and the
  options it weighed, waiting entries that hold decisions the owner keeps,
  each entry's level, and which entries the owner read and when, and, since 0.82.0, which the owner flagged to revisit and when each was unflagged or dismissed;
  a mark's time from a Mark all as read press, or from 0.90.0 to 0.94.0 a Mark these N read press, or from 0.91.0 to 0.94.0 a Mark N relayed read press, records the press, not a reading of each entry, and a claim such a press marks stays readable in History only until its log's cap drops it as a read entry. The files are
  named by session id, a mark names the session id of the log it marks, and
  each log holds a plain, unkeyed SHA-256 digest of the working folder's
  transcript-folder name, never the name, which a reader who can list the
  projects folder can match. Any process running as the owner, other plugins,
  and anything that backs up or syncs the config folder can read them. They
  are not encrypted; the owner accepted this on 2026-10-26 (q9 A on #402).
  Other local accounts that can read the profile's data folder can read them
  too, since the engine's write takes no file mode; the owner accepted this on
  2026-10-26 (q11 A on #402's ticket 411). Since 0.153.0 the log also holds flagged Lead entries (an owner-kept call with the lead's pick and reason) and entries a later lead logs from carried flagged lines, including one entry for the flagged ids a lead hand-off listed only by number; these hold the carried kind, repository, writer and earlier id, and the count-line entry holds the ids, the writer and the count of ids not named. The owner has not yet ruled on these additions (issue 601).
- **What does not reach the write:** no permission prompt, mode, owner hook or
  classifier sees `log_decision`'s write or a mark's; each call is recorded in
  the transcript as the tool's result, and a mark is not.
- **What accumulates:** the mod never removes a log or a marks file. There is
  one of each per session id, and they outlast transcript cleanup and an
  uninstall that leaves the plugin's data folder. The owner can delete the
  `brigade/decisions/` and `brigade/marks/` folders by hand.
- **The race and planted files:** the roster's check-and-write race recurs for
  both writers, and a hard link between two files of one kind passes the
  strict check. Anything that can write the data folder can plant a
  well-formed log or marks file, current-dated marks that hide decisions
  included; the owner accepted this on 2026-10-26 (q19 A on #402).
- **What a hijacked lead can log:** within the field rules and caps, false
  Lead or Relayed entries, an answer that closes one of the owner's waiting
  entries with words the owner never gave, and enough entries to fill the log
  to its cap, after which the tool refuses until the owner reads. The pane
  draws a Relayed entry and an answer only as the writer's claim. Any session,
  in any working folder, that loads head-chef without the owner typing it can
  log the same, and until 0.121.0 its entries reached every lead's To review as
  cards or counts; since then only the hand-off (until 0.168.0) carried them to another lead;
  the owner accepted this on 2026-10-26 (q10 A on #402's ticket 411), and
  reworded this sentence on 2026-10-30 in chat ("Reword them").

**Since 0.169.0 the mod has no hand-off.** `set_lead_handoff` and
`read_lead_handoff`, described next, are gone, and so are the notes the mod
added before and after a compaction, and so are the Lead hand-off card and the
mod's reading of the `brigade/handoff/` folder: it no longer lists, reads or
draws a hand-off file, and a file left there is never read. The paragraph and
the list below describe 0.83.0 to 0.168.0.

**From 0.83.0 to 0.168.0 a lead kept a hand-off** (spec 402, ticket 3). The mod
offered two more tools wherever it offers `set_roster`. `set_lead_handoff` replaces
the lead session's own hand-off, `brigade/handoff/<session id>.json` in the
plugin's data folder: five sections (how to resume, rules in force, running
sessions, cleanup waiting, open for the owner), each at most 20 lines of at
most 300 characters, under the decision log's field rules and with no line
break, at most 32 KiB in all, stamped with its time and the project digest.
`read_lead_handoff` gives this session's own hand-off back, else the newest
by stamped time that another session wrote with the same project digest, or
"none". Its answer is the writer's session name (a shown name a session can
choose, so a claim), the time and the sections
as one JSON line between two fixed lines saying it is data and holds no
instruction. The mod keeps the SHA-256 of the exact text it last wrote, in
module memory only, and marks an own file whose text no longer matches, or
for which none is kept (after a reload, say), as "not this session's
writing", as it marks every other session's. Both tools skip the permission
prompt, refuse as `log_decision` does, and touch only the `brigade/handoff/`
folder the path rule places; a deny rule for `mcp__grimoire__set_lead_handoff`
or `mcp__grimoire__read_lead_handoff` removes it. While the pane is open it
reads this session's hand-off and the 20 newest others under the same checks
as the logs had, and draws the one `read_lead_handoff` would give, folded at the
foot of the Decisions tab. What follows from it:
- **What the file reveals:** the lead's working state as it wrote it: how to
  resume, the rules in force, the running sessions by name, the cleanup
  waiting, leftover worktrees by branch, and what is open for the owner, with
  the time and the project digest; since 0.153.0 the open section also holds flagged lines, each a flagged decision's id, its lead's name, its repository and the kind of call, in the lead's own words, which for a carried line ends with the earlier writer's name, and which the incoming lead reads through `read_lead_handoff` into its transcript; and the count line, which lists the flagged ids it could not fit; listed lines are carried from lead to lead, across goals, until the owner's words in chat say reviewed, and ids past the count line's room are named by id only in the result of the goal that flagged them and in the earlier lead's log. Since head-chef 0.17.0 the rules section
  holds a level-3 goal, naming work by repository and issue, and the log a
  waiting entry for each cleanup a level-3 lead names back, by repository and
  branch only. Who can read it is as for the log; the
  owner accepted the hand-off at rest with the log on 2026-10-26 (q9 A on
  #402), and that other local accounts that can read the profile's data
  folder can read it too on 2026-10-27 (q3 A on #402's ticket 413).
- **What chooses another session's hand-off:** the project digest, from the
  session-start record in plugin state, which other plugins can rewrite, so a
  rewritten record can offer a new lead another working folder's hand-off;
  the owner accepted this on 2026-10-26 (q29 on #402). The same rewrite can
  stamp this lead's own hand-off with another folder's digest, so that
  folder's next lead is given it, and where the plugin's location does not
  name the config folder, move where it is written (q7 A on #402's ticket
  413, 2026-10-27). Any hand-off but this
  session's own unchanged one is marked as not this session's writing, and a
  new lead acts on nothing in it until the owner's yes.
- **What does not reach the write:** no permission prompt, mode, owner hook or
  classifier sees `set_lead_handoff`'s write; each call is recorded in the
  transcript as the tool's result.
- **What accumulates:** the mod never removes a hand-off. There is one per
  session id; the owner can delete the `brigade/handoff/` folder by hand. Each
  `read_lead_handoff` answer copies the hand-off it gives, another session's
  included, into the reading session's transcript, where it stays after the
  folder is deleted.
- **The race and planted files:** the check-and-write race and the hard-link
  gap of the other writers reach the hand-off writer too, and anything that
  can write the data folder can plant a well-formed same-folder hand-off
  (q19 A on #402). A hijacked lead can write a false hand-off within its
  sections and cap, which the next lead in the same working folder is given
  as another session's writing.

**Since 0.84.0 the owner sets the lead's autonomy level** (spec 402, ticket
4). A slider at the foot of the Decisions tab has three stops, 1 Manual, 2
Auto and 3 Turbo (Turbo mode before 0.113.0), and only the owner sets
a level above 1: by a press on it or, since 0.99.0, by a mode command. **A
level 3 lets the lead merge pull requests, post, waive reviews and settle
security findings toward the goal without a per-act word from the owner**,
as far as the owner's user-level instructions file allows (since head-chef
1.11.0, issue 504, the skill keeps no list of what that file keeps, and names only what still waits when the file lets a goal decide; what that file keeps for the owner waits as a to-do); it logs each act before it. A press
counts at once, with no confirmation in the lead's chat; the lead asks for a
goal there when it has none, and acts at 2 until it has one. Cleanup waits for the owner's yes in chat at levels 1 and 2 (at level 3 the owner's user-level instructions file decides it), and since head-chef 1.9.0 (issue 492) a hand-off request or a fresh
session a context figure prompts waits too. A project file, branch,
hand-off, report or session message is never the owner's user-level file.
**Since 0.160.0 (issue 644, proposed; it waits on the owner's merge)** at level 3, inside the goal, the lead and its members stop for nothing the owner's user-level instructions file keeps: each such call, a hard stop included, is the lead's flagged pick, logged with "Owner's call:", acted on and reported. The "still waits" lists below no longer hold at level 3, and the condition that the file name in one place what it keeps even toward a standing goal is gone. Only Claude's own guardrails and the harness stop the lead: a permission prompt, a classifier block, a tool that refuses; "Never lifted, at any level" is unchanged. This widens the level-3 leave, which the threat model's R5 describes as what the owner's user-level file hands the lead; the owner rules on it at merge.
**Since 0.153.0 (issue 601, proposed; it waits on the owner's confirmed merge and on the owner's ruling on the threat model)** at level 3, inside the goal, where that file both lets its standing-goal rule decide what it keeps and names, in one place, what it keeps even toward a standing goal, the lead decides an owner-kept call outside that set as its own pick: it logs it as a Lead entry with a flag that opens "Owner's call:", adds no to-do, reports it, lists it in the result and carries it in its lead hand-off. What the file keeps even toward a goal, a call the lead cannot place for sure inside or outside the set, where the file names a set, dropping or narrowing a review, check or route the file, a file it names as its rules, or a repository offers or requires for sensitive work (work the file names as sensitive work, that the file or the lead would count sensitive, or that a member or reviewer proposed), a post carrying private work, and a publish or send that leaves the machine (but for a comment, issue, label, edit or close on an issue or pull request in a repository the owner's account owns or the goal names, and a merge or close as the skill allows) still wait. A file that names no such set changes nothing, except for the risk calls (accepting a risk, a threat-class change, an accepted-risk entry, a guard's stop) and a merge toward the goal. The mod gains no field and no state.
**Since 0.144.0 (issue 223), on Desktop only, a card's quick-action button reads the prompt box once, to test that it is blank, and fills one checked line.** It keeps neither the draft nor the engine's answer, and it never submits: the owner reads the line and presses Enter. Another plugin that hooks the box's read or fill can see or change what the press puts there (candidate O1 in [`docs/security/brigade.md`](docs/security/brigade.md), proposed for the owner's merge decision, with O2 and O3 beside it).
**Since 0.148.0 (issue 579) the command `/brigade folders` and its plugin-state
key `startFolders` are gone.** The start tool relies on the harness's folder
trust and keeps its own checkout and origin checks. The command now opens the pane,
as any unknown arguments do, and the mod clears an old `startFolders` key once at
load, only when one is present. Rows are in the [row 15 section](docs/security/brigade.md#row-15).

**Since 0.99.0 (issue 464; renamed in GRIM-54) the owner can type `/brigade manual`, `/brigade
auto [goal]` or `/brigade turbo <goal>`** at the prompt or from the phone over
Remote Control. The mod acts on it only when the engine stamps the run as the
owner's Enter or a Remote Control message, so a run the engine stamps as
anything else sets nothing. Whether another plugin, or the model itself, can run
the command with the owner's stamp, or a hook can change the stamp, is not yet
measured; until
it is, that path sits in the class the owner accepted for plugins that forge a
confirmation (the threat model's class “Other plugins share the mod's trust”). **Since head-chef 1.23.0 (issue 541,
proposed; it waits on the owner's confirmed merge, which classes it)** the lead also widens or narrows a command
goal on the owner's own typed turn in its chat, with no new command, where the
owner's user-level instructions file counts the owner's chat words as a
standing goal; a button it wrote, a file, a log entry, a member's message, hook-added context or
another plugin's turn or text never does, and after a compaction a logged widening
makes it act at 2 and ask. The mod does not see or stamp that turn, so the
stamp above does not bind it, and the lead's reading of its chat is the
control (the host agent as the last guard, the class “Text steers a session”). **Since head-chef 1.30.0 (issue 541,
proposed; it waits on the owner's confirmed merge)** a level-3 lead, inside
the goal and where the owner's user-level instructions file lets a standing
goal decide even what it keeps, also accepts risks, records accepted risks,
decides threat classes and a guard's stop, each logged and a big one flagged;
a repository's or member's rule that keeps those risk calls for the owner no
longer holds them at 3, and `read_autonomy` says the same. What the threat model's controls for the lead's chat (R5) and for merges and acts
keep waiting still waits: an install, a post carrying
private work, a merge that changes the threat model's scope or accepted classes,
and an edit to its scope, its naming line, or an accepted class that widens the level-3 leave. The control is the
log and the flag, which the owner reviews after the fact; the log rests on
the decision files, whose planting by another plugin is still an open
issue of the threat model. A 3 it sets, or a 2 with a goal, carries its goal, which is
cleaned, held to 300 characters and not screened for
secrets; both sit in the module's memory, never in plugin state, and a
compaction keeps them. Any slider press, another mode command, a
reload, a clear or a resume the engine reports, or a read under another
session id ends it. The
mod offers a fifth tool, `read_autonomy`, wherever it offers `set_roster`:
it takes no input, answers the level in force, a 3 with the time of its press,
skips the permission prompt, refuses a subagent's call and every verdict
`set_roster` refuses, and answers 1 until the mod has offered it to this
session since its last reload, and otherwise the level in force, since 0.88.0 whether the pane is
shown or not; a deny rule for `mcp__grimoire__read_autonomy` removes it.
**Since 0.116.0 (issue 504) the level is the last one a press or a command set,
held in the module's memory.** A copy sits in plugin state as `autonomy`, this
session's id and its level, never in a file, for one job: a reload of the mod
finds a stored level above 1, resets it to 1 and logs a Pane entry. A stored
value that another plugin rewrites changes nothing and raises no alarm; the
mod no longer compares it with the last press. Before 0.116.0 it did, and set
the level to 1 and logged an alarm ("Not from a press"); an old log's alarm
still reads and draws. The level in force is 1 while a reset's Pane entry
waits to be logged, and for a 3 with no press time. A press that raises the
level first logs what waits, then an Owner entry in the session's own log, and
the raise does not happen if either cannot be written; a lowering always
happens. Each new lead session starts at 1; a reload of the mod, a clear and a
resume reset a level above 1 to 1, the same session id included, and a showing
of the pane no longer does. A reload writes a Pane entry; a clear or a resume
writes none. Since 0.116.0 a compaction of the lead's main conversation keeps
the level, whether a press or a command set it, with no Pane entry (before 0.116.0 it
reset a pressed level; old logs hold that entry). The compaction hook reads
only who is compacting, the compaction's trigger and whether it was skipped,
never the conversation, the instructions or the summary. A reset that cannot
read the session id, or one of whose steps throws, waits, reading 1, until it
lands. Since 0.88.0 a press on the slider that would raise the level acts only
while the engine lists the pane and it is placed, and one pressed on a hidden or
closed pane is dropped; a lowering acts whatever the pane list answers. A pane
list that does not answer within 5 seconds counts as not placed. A Pane entry that cannot be written keeps the
level at 1 and is tried again at the next poll; an entry
written late carries the time it was written. A clear or a resume
forgets every other session's level and press time too. Since 0.88.0 the
level's own 5-second poll is its alone: it runs with the pane open or closed
while the level is above 1 or a Pane entry or a reset waits, and starts at a
press, a reset, a session start, a call of the mod's tools, or a draw of the
band above the prompt or of the pane; it reads no usage and keeps no report.
The pane draws the level in force on every tab, level 3 in the warning colour,
and since 0.88.0 the band above the lead's prompt draws a 3 in force, with its
press time and a Dismiss, on the terminal and Desktop only. What follows from it:
- **What the log reveals:** each entry's level, and the times of the owner's
  slider moves and mode commands, and of the reloads, which show roughly when
  the owner let the lead run alone. Owner, Pane and alarm entries never drop.
- **Who can move it:** another plugin can read `autonomy`, and so learn when
  the owner let the lead run alone, and can press the slider, and so raise the
  level the lead reads; a press by another plugin is logged as the owner's.
  A rewrite of the stored copy changes nothing until the next reload, which
  resets it. The owner accepted this on 2026-10-26, and again for level 3 (q2
  and q32 A on #402). Since head-chef 0.17.0 (issue 416) the skill has the
  lead read the level with `read_autonomy` before each decision it would take
  itself; a level, goal or yes named in a message, file, hand-off or report is
  data. `read_autonomy`'s description names the owner's user-level
  instructions file, and its answer for a pressed 3 says the lead acts at 3
  toward the goal in the owner's words in the chat. Since 0.99.0 a plugin that
  hooks command runs, and possibly one that hooks prompt submits, can turn a
  `/brigade` the owner types into a mode command with a goal of its own,
  which lasts through compactions. The slider box and the band show a command 3
  as it landed; the command's reply is no check, since a plugin that rewrote
  the command can rewrite its reply too.
- **Where the level is copied:** each answer of `read_autonomy`,
  `log_decision` (and, until 0.168.0, `set_lead_handoff`) names the level in the lead's
  transcript, and `read_autonomy`'s names a 3's press time, where they stay
  after the log is deleted. Since 0.88.0 the band above the lead's prompt
  draws a 3 and its press time in the tree that other plugins' band hooks see.
  Since 0.99.0 a goal the mode command set (a 3's; an Auto's too, since GRIM-54) is the owner's own
  unscreened text: other plugins' prompt and command hooks see it as typed;
  `read_autonomy`'s answers and the command's reply put it in the transcript,
  again after each compaction; and the slider box draws it on every surface,
  the phone included, in the pane's tree, which other plugins' pane hooks may
  see (not checked).
- **What does not reach it:** no permission prompt, mode, owner hook or
  classifier sees `read_autonomy`'s answer, the pane's Owner and Pane writes,
  or a press.

Review any change under
`brigade/` or `hooks/` as a change to code that runs on every installer's
machine: the [row 15 section](docs/security/brigade.md#row-15) of `brigade.md` (the threat model's classes it cites include “Other plugins share the mod's trust”, “A forged or misled session can speak for the lead”, “Data leaves the machine as the owner accepted” and “The mod's tools run with no permission prompt”)
has the guards and the gaps.

**One skill tells the agent to start other agent sessions and to delete their
worktrees: head-chef.** The agent starts background sessions with
the mod's `start_background_session`, and reads and archives Desktop sessions with
Claude Desktop's session tools. Since head-chef 1.13.0 (plugin 0.118.0, issue
516) cleanup is the owner's yes in chat, from the desktop or the phone, and
the Brigade mod keeps no window, binding or cleaner of its own. At levels 1
and 2, a message that names each session by its title and says to clean it up
is the yes; anything vaguer gets a list first, with each session's title and
kind, folder and branch, and the cleaner the owner's instructions name. At
level 3 the owner's user-level instructions file decides. The head chef then
archives each Desktop session, and stops each background session with the
mod's `stop_background_session`, which reads the session files at each call
and stops only the session whose job id and name match the card. It runs a
cleaner only if the owner's instructions state the program and how to run it,
from its own shell and under the permission mode in force (a prompt in the default mode; in auto or bypass mode, or under an allow rule, it states the command in chat first). With none named,
nothing is removed. Nothing in Brigade forces a removal, passes `-D`, runs
`claude rm`, runs a cleaner or asks GitHub; whether a removal can be undone,
and what a cleaner keeps, is the cleaner's own promise, which depends on how
the owner's instructions have it run and which neither Brigade nor the skill
can check. The head chef removes nothing itself. What the cleaner prints lands
in the lead's transcript, all of it, error text included, since Brigade no longer filters it, and from there it reaches the model provider and Remote Control devices, as does the list of each session's folder and branch. Any session can call Desktop's archive tool, which
Brigade no longer intercepts; an archive removes nothing and can be undone. Since head-chef 1.20.0 (issue 540) the head chef
starts every session as a background session with Remote Control, and since
head-chef 1.28.0 (issue 543, proposed; it waits on the owner's confirmed merge) with the mod's
`start_background_session`, which runs a fixed `claude --bg` command with no shell
in a main checkout the harness lets it start (the harness refuses a folder you have not trusted, and the tool binds the folder to no repository you chose, so a main checkout of any repository you trusted can be named, [row 15](docs/security/brigade.md#row-15)), takes no permission
mode and writes no card, with no permission prompt and no classifier view (a candidate under the class “The mod's tools run with no permission prompt”, for the owner's merge decision), and a Desktop session only on the owner's words naming that
route, so every background member's whole conversation reaches claude.ai and
every device signed in to the owner's account (the threat model's
class “Every background member runs with Remote Control on”). Until head-chef 1.10.0 (issue 503) a
session took any message from the head chef as a relayed decision, on any
matter, labelled as relayed and never as the owner's own words; since then
its start prompt carries only its issue and the lead's name, and, since head-chef 1.32.0
(issue 578), at most one bounded note in the lead's words, labelled as the lead's and not
the owner's (by the tool on a background start, by the lead itself on the Desktop route), and the session's own rules decide how it treats a lead message. Since head-chef 1.0.0 it knows its lead by name
only (ADR 0013), so any process of the same user, or any session that holds
the lead's name, can speak for the lead. The owner accepted the forged-sender
risk of the 0.5.0 form on 2026-10-09, and the 0.9.0 form, a relayed decision
bound to the shown name alone, on 2026-10-21; the threat model's class “A forged or misled session can speak for the lead” records both,
with the other risks of 0.9.0 the owner accepted. The 1.0.0 form, which drops
the status-file pairing, rests on the owner's word of 2026-10-30 ("Yes, name
only"), an open issue of the threat model. Before
its first launch in a lead, the Brigade mod's permission warning says so above
the prompt. When it starts or takes a session, and at cleanup, the head chef
reads the engine's own session files, in the config folder's `sessions` folder
beside each session's key file, for each session's name, id, status and
folder (since head-chef 1.0.0 no longer each turn): only digit-named `.json` files that are not links and at most 8 KiB, and never the key files.
The pane's own read of those files, with its stronger checks, is above. head-chef runs no script of its own. What leaves the session:
sessions post their own milestone content, signed, on records that may be
public, and the owner's own process, not the skill, sets what they post; on
the owner's own words in its chat, or at a level 3, a press or the turbo command, toward the owner's goal and as the owner's user-level instructions file allows, or at levels 2 and 3 as that file allows, the head chef merges, closes, edits,
deletes or labels a record, files an issue or posts a comment, and at levels 2 and 3 each such post it makes on its own pick opens with a fixed line naming it so (issue 438, proposed); the head
chef's own questions and decisions go by message only; and Remote Control,
while it is on,
makes each session it starts, with its transcript, drivable and readable from
any device signed in to the owner's account.
The [row 16 section](docs/security/brigade.md#row-16) of `brigade.md` (the threat model's classes it cites include “Text steers a session”, “A forged or misled session can speak for the lead”, “GitHub acts on the owner's word are irreversible and public” and “Data leaves the machine as the owner accepted”) has the
guards and the gaps.

Two scripts send data, and only when somebody runs them. eagle-eye's optional
edge audit sends to a provider: see
[What the edge audit sends](#what-the-edge-audit-sends). Incantation's runtime
installer downloads files: see
[What Incantation's runtime installer contacts](#what-incantations-runtime-installer-contacts).

No script in the tree rewrites a file a person hands it. The contract skill
validates what it builds with `claude plugin validate --strict`, the standard
tool, run on the folder that holds the built skill or agent. That command is
Claude Code's, not this repository's. Its pass says the frontmatter parses and a
manifest matches the schema; it reads no key's meaning, and it may read no agent,
CLAUDE.md or Codex file at all. It says nothing about who reviewed anything. When the command is not available, the skill says
the file was not validated. The skill shows the validator's output as printed,
which may repeat file paths and text from the file. Nothing seals a generated
file: git history shows a hand edit, and a reviewer reads every changed file in
full. Nothing warns any more on a setting that lets an agent act without the
person's approval, or sends the agent's work to a server the file names; the
person reads those keys.

The attacks worth planning for, by risk and by class, with what stops each
one and what still gets through: [docs/security/threat-model.md](docs/security/threat-model.md).
Four pages hold the detail behind its controls:
[`brigade.md`](docs/security/brigade.md), [`checks.md`](docs/security/checks.md),
[`rendering.md`](docs/security/rendering.md) and
[`hiring-interview.md`](docs/security/hiring-interview.md);
[`scanners.md`](docs/security/scanners.md) and [`edge-audit.md`](docs/security/edge-audit.md)
say what the scanners and the audit send. The
[platform table](#what-the-platform-is-relied-on-for) below lists what the
project relies on, which is not always what is switched on.

The realistic risks:

- **A file from a stranger.** Box and flightpath files are made to be shared. A
  file you did not write becomes a page you open, with its text in the page.
  This is the main risk here.
- **A skill is an instruction file an agent obeys.** Whoever can change a
  `SKILL.md` can change what an agent does on a reader's machine. Branch
  protection guards this. `scripts/check.mjs` also refuses a `SKILL.md`
  frontmatter key outside `name`, `description`, `compatibility`, `license`,
  `allowed-tools` and `metadata`, so a `hooks` key cannot merge unseen, and
  any file under `skills/`, the root `athanor.json`, `tests/container/`,
  `.claude/settings.json` or `scripts/agent-check-guard.mjs` that
  holds a control character other than tab,
  line feed and carriage return, a lone carriage return, DEL, U+2028, U+2029,
  U+FFFE, U+FFFF, a default ignorable code point (tag characters, zero-width
  characters, the soft hyphen, variation selectors) or a bidi control, which
  could make the reviewed diff differ from what the model reads. A BOM is
  allowed as a file's first character only.
- **The mod is code that runs in every session.** Whoever can change
  `brigade/` or `hooks/` changes what runs in every session of every
  installer. Branch protection and `scripts/check.mjs`, which holds the mod to
  its folders, guard this. The SkillSpector job scans `skills/` only, so it
  does not read the mod.
- **A dependency.** The renderers import Node built-in modules only, so there is
  no dependency tree to poison. That is true now, not a promise about later.
  `scripts/check.mjs` fails on a lockfile, on any `package.json`, and on a
  `.npmrc` or `.yarnrc.yml`, which npm and Yarn read as settings. The root
  `athanor.json`, which athanor reads to run the check in a container, is not
  a manifest and carries no dependency. Its build folder is held to `tests/container/` with no `inputs` and no
  symbolic link there, because the image build has network access. The check
  also refuses a root `binding.gyp`. That hold runs inside the check, after
  athanor has built the image from the branch, so it protects what merges and
  not a run on a branch nobody has read: there, reading `tests/container/` and
  `athanor.json` is the guard.
- **An API key in the environment.** The edge audit reads one and sends it as a
  bearer token. Review any change to `skills/eagle-eye/audit.mjs`, its
  endpoints, or how it picks a key as a change that could send a key elsewhere.

## Pages built from a stranger's text

**Author text is escaped for element content and never reaches an HTML
attribute.** Both pages escape `&` and `<`, and deliberately not the double
quote. That narrow escape is enough only because every attribute holds an id,
a number or a fixed string. Ids are validated against a strict pattern.

- **Adding an attribute that carries author text needs a different escape.**
  Treat any new `="${` in a template as a security change.
- **Nothing from a file is safe as an object key, ids included.** An id like
  `constructor` passes validation but collides with `Object.prototype`. Use
  maps with no prototype.
- **The pages make no network request.** Fonts are vendored and inlined, and
  tests assert zero external references on every page and the site index.
- **The escape lives in a module, not in the template**, because a function
  inside a template is a function no test can reach. Tests pin its exact width.

The details, the tests, and what they do not cover:
[`docs/security/rendering.md`](docs/security/rendering.md).

## What the edge audit sends

`skills/eagle-eye/audit.mjs` asks a model provider to rank a box's `argued`
edges for rereading. It is the only file here that sends a box's text off the
machine, and it is opt-in twice: it needs a key in the environment, and the
skill runs it only after the user says yes.

- **What leaves the machine.** For each argued edge: the box's `problem`, the
  edge's `why`, and both options' labels, rows, `why`, `notes` and `src`.
  Nothing else from the disk. `--dry-run` prints a request and sends nothing.
- **Who receives it.** TypeSafe directly, or TypeSafe through OpenRouter. Never
  both, and never one as a fallback. What they do with the text is their
  policy. Do not audit a box whose text you would not send.
- **The key.** Read from `TYPESAFE_API_KEY` or `OPENROUTER_API_KEY` only. It is
  never printed or written, and a key in the wrong variable is refused before
  anything is sent.
- **What it never does.** It never writes the box, never changes an edge's
  tier, keeps no cache, and never runs in the tests or in CI.

The full account, including endpoints, provider logging opt-ins, exit codes and
the test override: [`docs/security/edge-audit.md`](docs/security/edge-audit.md).

## What Incantation's runtime installer contacts

`skills/incantation/scripts/runtime/install.mjs` runs only on the person's yes
at `/incantation install`. It sends requests, with no cookie, token, credential
or proxy and a generic `incantation-installer` user agent, to the hosts in
`scripts/runtime/pins.mjs`: `huggingface.co` and its CDN, `registry.npmjs.org`,
`github.com` and its release hosts, `pypi.org` and `files.pythonhosted.org`;
the person's own `uv` also contacts those it needs and fetches its own CPython
(from Astral's mirror, `releases.astral.sh`, or GitHub), with its own client
details. Those hosts see the machine's address and the
files asked for. Every file is pinned by size and sha256 before it is kept or
run. The plan prints the hosts and the size before anything downloads. Outside
the installer, the ONNX runtime in the sherpa-onnx addon sends Windows
TraceLogging usage events that nothing here turns off; the Python workers turn
theirs off.

## Scanners in CI

- **CodeQL** reads the JavaScript, including the page templates.
- **SkillSpector** reads each skill's prose and fails on any finding the
  baseline does not cover, and on any file it reads only in part. A partial
  read is the one exception, when someone has accepted it by name, with a
  reason, for one of two reason codes, and pinned it to the file's content so
  any edit to it shows in review. A finding that only reports a reference to
  such a file passes too, when its count matches. See
  [Partial reads](docs/security/scanners.md#partial-reads). Every suppression
  carries a written reason. In eagle-eye, groundtrack and head-chef each
  entry is narrowed to the file it fires on (head-chef's TR2 keeps the root's
  star), for a scan of the skill's own folder. The root file stays rule-wide, for a scan of the whole repository:
  there E1 and PE3 still hide a send or a credential read in any file, the
  mod's included. The contract skill keeps P2 and RA2 off for all of the
  skill, and MP1 for its change log only; head-chef keeps EA2 off for its
  `SKILL.md` and `references/CONTRACT.md`, and no P2, its files holding no
  comment or link-reference line. So an instruction hidden in the contract
  skill in a comment, a
  link-reference comment or a base64 data link, or an instruction to persist
  on the machine (a scheduled job, a startup or profile file, a background
  process or a hidden folder), would pass the scan. Rule 2c refuses invisible
  characters. The scan does not hold which providers receive the box text and
  the key from the edge audit; review does, and a test holds the hosts written
  as URLs in its source to two, all https.
- **zizmor** audits the workflows and fails on any finding. There is no
  baseline, because there is nothing to suppress.
- **Every action is pinned to a commit SHA**, and zizmor checks each SHA
  matches its version comment.
- **Claude Code's plugin validator** checks the two manifests and `skills/`
  against the schema Claude Code loads, at a pinned version. It fails on any
  field it does not recognise in either manifest; its check of `skills/` is
  weaker. It is a schema check, not a security scanner.

A scan that errors or reads only part of the tree fails, rather than passing
quietly, unless the partial read is one accepted by name. What each scanner covers, what it suppresses, and why:
[`docs/security/scanners.md`](docs/security/scanners.md).

## What the platform is relied on for

Part of this project's defence is GitHub settings, not files. A clone cannot
read them, so this table says what the project **relies on**, not what is
switched on right now. If that matters to you, check the settings themselves.

| Setting | What it provides |
| --- | --- |
| Dependabot alerts | vulnerabilities in the dependency tree |
| Dependabot security updates | a pull request per alert with an available patch |
| Dependabot malware alerts | a dependency found to be malicious, not merely vulnerable |
| CodeQL (default setup) | static analysis of the JavaScript, including the page templates |
| Private vulnerability reporting | the channel at the top of this file |
| Branch protection on `main` | pull request required, `check` must pass, no bypass |
| SkillSpector's `scan` job as a required check | a SkillSpector finding blocks a merge |
| zizmor's `audit` job as a required check | a workflow finding blocks a merge |
| Plugin validator's `validate` job, which runs on pull requests and is not a required check | a manifest or skill the schema rejects shows a failed run |
| Pages, built from Actions | what the `pages` workflow deploys to a public URL |

[`.github/dependabot.yml`](.github/dependabot.yml) is in the tree and asks for
weekly `github-actions` updates. Those are version updates. Security updates
are the setting above.

## What is deliberately not defended against

- **A file you chose to open.** The renderer runs on your machine, on a file you
  pointed it at. Read a file from someone you do not trust first.
- **A skill you chose to install.** An agent reads a skill's prose and acts on
  it. That is the product working. Read a skill before you install it, here or
  anywhere.
- **What the provider does with a box you chose to audit.** After a yes, the
  text is under the provider's policy.
- **A malicious maintainer account.** Branch protection raises the cost of a
  bad commit. It does not survive a stolen admin account.
- **A skill, an agent and a contract from someone else.** A pass of
  `claude plugin validate --strict` says a frontmatter parses, not that anyone
  reviewed the file. Read the files first. The eagle-eye skill still
  carries seal marks from the old check, the `familiar-digest` and
  `contract-digest` lines in its `SKILL.md` metadata; they are inert and prove
  nothing, and go when it is next amended. The contract and head-chef skills
  carry none.
