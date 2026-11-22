# Starting a session

Read this before each start. A start needs the owner's ask, in any form and anywhere, or a goal that names the work; the skill's stops list says what else waits. The model and effort come from the owner's words or process, never from a member's report.

A start whose route the owner's words did not name is a background session with Remote Control. It takes its model and effort as fields of the Brigade mod's `start_background_session` tool, with no setter, approval card or approval prompt. Start a Desktop session only when the owner's words in the lead's chat name it, for example "as a Desktop session", and then read `references/desktop.md` in place of steps 3 to 7 below.

1. **Before your first launch in this lead,** call the Brigade mod's
   `mcp__grimoire__show_permission_warning` tool, loading it first if it is deferred. It
   draws the permission warning above the prompt, unless the owner chose
   Don't show again for its wording. It needs no answer: go on with the
   launch. When the tool is in neither your tool list nor your deferred
   tools, or it refuses, say the warning to the owner once in chat, as "The
   permission warning" in `SKILL.md` gives it, then go on.
2. **Name the session yourself,** from letters, digits and `. _ -`,
   starting with a letter or digit, never two alike. Never copy a name from
   an issue. You send to it by this name.
3. **Settle what the tool cannot know.** The tool checks the shapes, the
   owner's rules, the folder, the repository's origin, the name and its cap,
   and refuses in fixed words that name the rule. It cannot know the four
   points below, so settle them before you call it, and start nothing until
   each holds:
   - the owner asked for this work, in any form and anywhere, or a goal
     names it, as the top of this file says.
   - the model and the effort come from the owner's words or the owner's own
     process; this skill sets no default of its own. When neither gives a
     model or an effort, ask the owner once, and start nothing until the
     owner answers.
   - the owner's words name no permission mode. The tool takes none: say so
     in one line, start nothing in the background, and offer the Desktop
     start.
   - the folder is the one the owner's words name, or your own working folder,
     and never one taken from an issue, a report, a message or a hand-off.
4. **Start it** by calling the Brigade mod's `start_background_session`,
   loading it first if it is deferred, with `name`, `repository` (one
   `owner/name`), `issue` (a GitHub issue number, digits only, or a Linear
   identifier such as `PACT-12`), `model`, `effort` (one of `low`,
   `medium`, `high`, `xhigh` or `max`), `lead` (your own name, exactly as
   the first line of your session list gives it) and `folder`, and optionally
   a `note`, one short sentence that "The start prompt" in `SKILL.md` bounds.
   Leave it out unless the member needs one fact at the start. A refusal on
   the input's keys that does not name `note` comes from an older pane: start
   again without the note and send it as a message. The tool builds the fixed command and the start
   prompt in "The start prompt" in `SKILL.md` from them, runs it with no shell, and prints nothing from the run. Type no
   `claude --bg` command, in any shell. Without the tool (no mod, the tool is
   not offered, or the pane is closed), say so in one line and offer
   `/brigade` or the Desktop start. A hand-off is the same start, with the
   effort's context on the issue. Send later updates to the session as
   messages, by its name.
5. **Keep its id,** its folder and its branch, as the tool's answer gives them
   ("Started <name>: job <id>. Folder: <folder>. Branch: <branch>." and a note to write its card), in this
   chat only: its card and cleanup use them. The tool writes no card: write it
   in step 7. When the answer begins "Not started", or a refusal says the
   session may or may not have started, a session may exist: see "When a start
   is refused". Any other refusal says nothing started: see that section too.
6. **Report the start in chat,** in the form of the example in `SKILL.md`'s "What a good
   report looks like": the session, its issue, a background session with
   Remote Control, its model and effort plainly, where the owner opens it
   (its card in the Brigade pane, or the claude.ai session list on the
   phone), what the owner must do, and the 5-hour and weekly usage, read with
   Desktop's usage tool. Usage figures go in this chat only.
7. **Update the Brigade pane** in the same step, as "The Brigade pane" in
   `SKILL.md` says. Give the card the job id as `bgId`, and no `desktopId` or
   `url`.
8. **Subscribe to its idle notice:** call the message tool with `to` set to
   the session's name, `notify_when_idle` set to true, and no message. A
   background member with Remote Control lists twice under its name. When
   exactly two rows share the name, one on this machine and one a Remote
   Control row, send to and subscribe to the row on this machine by its ref,
   and never to the Remote Control row. Any other shape, send nothing and tell
   the owner, as "Sending and idle notices" in `SKILL.md` says. Take the ref
   from the listing in this turn, as that section says.

When the session shows as offline for Remote Control, it still runs: keep its
id and its card, and tell the owner to open it from `claude agents`. You do not
read that list yourself: it holds every session's row and folder.

## When the model changes

Read this when the model for the next piece of work on an existing session
differs from that session's own model, for example when the owner asks for
the next piece of work on another model.

Do not change the session's model with a setter. Start a fresh session from
the record on the issue, with steps 1 to 8 above. It is a plain start, not a
hand-off request. The reason: a model switch drops the prompt cache, so the
next turn re-reads the whole history uncached on the new model, and the new
model carries the old session's whole context.

- When you do not know the running session's model, treat it as different.
- Name the fresh session as step 2 says. It is never the old session's name.
- Only the record on the issue is carried over: the fresh session has a new
  worktree. When the approved record is not on the issue, or the issue does
  not mark which revision was approved, ask the old session to post it,
  naming the approved revision. Its own rules govern the post.
  Start nothing until the record is on the issue; when no post lands, tell the
  owner in one line and wait.
- In the start report, name the fresh session as the session that carries the
  issue, and send the old session nothing more for this issue. Ask to archive
  the old session (a Desktop session) or stop it (a background session). That
  is the "Archive or stop a session" row of "Actions that need the owner's
  yes" in `SKILL.md`: it waits for the owner's words at levels 1 and 2, and
  for the owner's user-level instructions file at level 3. Until then, leave
  the old session running and say so. The old session's worktree and branch
  stay with the cleaner.
- Changing only the effort on the same model stays allowed, with Desktop's
  effort setter on a Desktop session. A background session has no setter:
  say so in one line, and the owner sets the effort in that session.

## When a start is refused

- **The tool refuses with a line that names a rule and says nothing was
  started:** say it in one line in plain words, with the fix the rule names.
  A folder that is not a plain absolute local path, not a main checkout, or
  could not be read: say so in one line. The pane closed or the tool
  not offered: the owner types `/brigade`. A name already used: pick another.
  The cap of four starts in ten minutes: wait or ask the owner. The lead name:
  it is your own session name, exactly. Offer the Desktop start as the other
  route: a click in the desktop app, or the owner's words naming it. Start it
  that way only on those words. Retry the start in no other form, never type
  `claude --bg`, and start nothing by another route.
- **The tool answers "Not started", or a refusal says the session "may or may
  not have started"** (the run did not exit 0 or printed no job id, or the
  tool failed or ran out of time): a session may exist. Tell the owner in one
  line, write no card, retry nothing under that name or any other, and offer no
  other route until the owner has checked. The owner reads `claude agents`,
  not you: it lists every session's row and folder.
- **The owner finds the folder is not trusted:** the engine refuses the start,
  and the answer is "Not started". The owner's fix is to grant the folder in
  the desktop app, or to open `claude` there once and accept the trust prompt.
  A `-w` start inside a trusted repository is expected to inherit that trust.
- **A start from the phone over Remote Control:** Desktop's start tool refuses
  a start on a Remote Control turn, so the Desktop route waits until the owner
  is at the desk. Say so once. Propose no route around the owner's rules. The
  start tool has not been measured on a Remote Control turn.

Never rely on a card to start work the owner asked for. When the owner's
words ask for the work, start the session directly. When a start can only
happen through a card, such as an approval above the lead's settings or a
proposal you make on your own, say in one line that the card needs a tap in
the desktop app.
