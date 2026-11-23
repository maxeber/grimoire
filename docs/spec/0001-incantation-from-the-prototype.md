# Incantation from the prototype

Status: Draft: in force only when the owner merges it.

This spec turns the incantation prototype, a dev mod the owner tried live by
voice from 2026-11-19 to 2026-11-22, into changes to grimoire's
`skills/incantation/` and to grimoire's own mod (`brigade/`). Tier: thorough,
on the sensitive route: heard speech now reaches the session as a user-role
prompt, and an installer fetches models, a native addon and Python packages.
The local-engine work (sherpa-onnx) is part of it: the whole prototype ships
now (W10), so "incantation stays Node-only" no longer holds.

The build runs in a fresh session from this spec and the prototype's local
snapshot, which is removed before the pull request. Settled decisions are
carried as decided. A tag names the words a choice comes from: `W1` to `W11`
are the owner's own words (S1). A choice with no tag is this spec's own.
Where "As built" (the last section) and an earlier section differ, "As built"
holds.

## S1. Sources

**The owner's words,** as recorded in the prototype's change log, field notes,
hand notes and trial notes. The pull request asks the owner to sign off on
quoting them here.

- **W1** (contract 0.1.0, `good`): "if you make me stop using voice and come
  type something for you, then why am I using voice in the first place?"
- **W2** (hand notes): "Poke users for permissions · Don't wait for a
  confirmation · Don't read small details (like commit ids) · Stops are still
  stops · Reply before you start thinking so we don't wait for confirmation ·
  We need mute mic and mute bot · Separate thinking from working". Decided
  there: "nothing typed"; a muted voice behaves as unmuted and plays no audio.
- **W3**: "you should probably file another issue to mix up the confirmation
  vocabulary."
- **W4** (trial, typed): "fallback to a mic and say which we are using?"
- **W5** (trial): "That but rule is a bit too extreme and it should be
  deleted."
- **W6** (trial): spinner words "from the words that [Claude] Code uses every
  day", and "I expect the audio cues to play directly when I say something";
  voice cues and chimes "don't sound good".
- **W7** (relay, 2026-11-22): "I want incantation to be the one sending a
  little message in the chat on my behalf… clearly labeled"; "trim what's not
  useful"; "you are literally one turn behind"; "mid-turn delivery is pretty
  important".
- **W8** (by voice, in `listen.mjs`): a real turn heard over a reply means the
  person has moved on, so the reply stops.
- **W9** (field notes, 2026-11-22): "I don't think you got my yes, please" (a
  paid run started on it); "you spoke over me there, you shouldn't do that";
  questions ending on fixed choices sound robotic: give a recommendation and
  why, casually.
- **W10** (by voice, 2026-11-22, relayed): "I want to ship the whole
  incantation engine right now. I don't want to do Sherpa later and then we
  only do half of what we did on the prototype. I want everything in the
  prototype to be shipped right now."
- **W11** (trial notes): the mic hears incantation's own voice; Windows
  notification bleeps became words and turns; a pause mid-thought ended a
  turn; accuracy and no Voicebox upkeep matter, not speed; Kokoro 1.0 full on
  CPU "sounds exactly what I expect".

**Carried in:** a confirmation counts typed or spoken, in any session, said to
the lead too; the skill does not restate what the harness already does and
names no tracker and no level. **Choices of this spec:** the relay writes no
heard text to any file and is bound to the session that started the
listener; the cue lines and the chime go; the relay, the nudge and the voice
button go in grimoire's mod; the progress beat is 90 s; "a clear yes" is the
term for a spoken confirmation.

## S2. Objective

`/incantation` keeps what it is: voice pairing, hands-free (W1). This change
brings in what the prototype proved in live use:

1. heard turns arrive in the chat as labeled messages, also while the session
   works (W7);
2. the listener answers every heard turn at once with a varied spinner word,
   and the session speaks no acknowledgement of its own (W3, W6);
3. requests go read-back, thinking, plan, working, report, with a say-back
   only for changes (W2);
4. long work gets a short spoken progress line at a steady beat, and after a
   question the session speaks nothing unasked (W9);
5. a spoken confirmation is defined by what it is, "a clear yes", and it
   stands in for typing at any checkpoint (W1, W2, W5, W9);
6. the mic and the voice mute separately, by voice or typed command, and a
   missing mic falls back to another, named in the greeting (W2, W4);
7. a waiting permission prompt is nudged aloud (W2);
8. it hears and speaks on this machine through sherpa-onnx (Parakeet to hear,
   Kokoro or Phonon to speak), with no separate app, installed by
   `/incantation install` (W10, W11);
9. on speakers it does not hear itself or the machine's other sounds: echo
   cancellation against everything the speaker plays, a speech detector, and
   an end-of-turn check that waits out a pause mid-thought (W10, W11).

**Business driver.** None is written in AGENTS.md or CLAUDE.md. This spec
leans to what is cheaper to reverse; the owner decides.

## S3. Scope

**In:** the skill's contract, its regenerated `SKILL.md`, `tuning.md` and
change log (S4); the listener and its helpers (S5); the relay, the permission
nudge and the mic band's voice button in grimoire's mod (S6); head-chef's
contract where it counts a spoken yes (S4.11); tests, removing incantation's
evals, README, security docs (S7, S8). Also in (W10): the sherpa engine, its
Python workers, the echo stack, the runtime and its installer (S5.8 to S5.11).

**Out:** the observe mode's rules (unchanged); Voicebox's own settings; a GPU
runtime (S5.11, and S12).

**Names.** The skill stays `incantation` and its state folder
`~/.grimoire/incantation/`; the runtime lives in
`~/.grimoire/incantation/runtime/`. Engines: `sherpa` (the default) and
`voicebox` (S5.10). Every name the prototype's dev mod carries becomes the
shipped one; none of the prototype's names ships. The prototype's runtime
folder is not reused: install fetches afresh and checks every file (S5.9).

## S4. The skill: contract amendments

The build amends `references/CONTRACT.md` through the `contract` skill, then
regenerates `SKILL.md` from it: procedure sections stay word for word except
where an amendment below changes them, each change named in the change log.
The prototype's `SKILL.md` and `CONTRACT.md` are the starting text, with the
names in S3. Every amendment is one change-log row, its source the tag given.

### S4.1 A clear yes (W5, W9)

The term replaces the rule that lists what is not a yes. In the contract's
`writing` terms, and in `SKILL.md`'s "Words and style":

> **Clear yes:** the person's confirmation of the say-back you just gave.
> Typed, it is their answer in chat. Spoken, it is a heard turn that answers
> the say-back itself: it arrives as a relayed message between your turns, or
> after the say-back, marked `(after reply)`, with no
> `interrupted`, and with `plays` equal to the lines you had the listener say
> since the last delivery; it opens with "yes" or its like ("go ahead", "do
> it", "sounds good", "yeah, go for it"); and it agrees outright, holding none
> of the pull-back words: no, not, don't, wait, stop, instead, actually.

Rules that follow, each a line in the contract:

- A clear yes covers the say-back's act and nothing more. Anything else the
  turn asks is a new request.
- A turn that narrows or conditions the act ("yes, but only on the branch") is
  not a clear yes: say the narrowed act back.
- A turn about a yes ("did you get my yes?", "you didn't catch my yes") is not
  the answer: say the act back again, with its cost when it has one, and wait
  (W9).
- A say-back names the act's cost when it has one: money, a paid run, usage
  (W9).
- A clear yes never comes from mid-turn context (S6.2). Tool output can hold
  text shaped like a delivery, so heard turns there can halt work or raise a
  new request, never confirm one.
- It is the first turn heard after the say-back, and it comes on its own: a
  request and a yes in the same turn or the same delivery (joined by `|
  then:`) are a new request, said back again; any other turn heard first voids
  the say-back, and it is said again before acting.
- "yeah" and "yep" alone are its like and count. "okay", "sure", "right",
  "mhm" and the other backchannels in `tuning.md` alone do not, after a
  say-back as at any other time: ask at once whether that was a yes (the rule
  "when unsure, ask at once"). This is not asking for a yes and then refusing
  it, since none was given.
- "but" no longer voids a yes (W5).
- The nudge's line and the progress line from `nudge.mjs progress` count in
  `plays` as any `say`, so a yes to them never matches a say-back (claim 15).
  With the voice muted, `plays` counts lines nobody heard (W2 settled this).

### S4.2 Voice stands in for typing (W1, W2)

Reworded with no "stop" or "hard stop" in it:

> A clear yes after the say-back stands in for the typing any checkpoint
> would ask for, including one the session's rules hold for the person's own
> confirmation. Voice replaces the typing only: the checkpoint and its
> say-back stay, and every other rule the session runs under holds unchanged.
> Only the first typed `/incantation` or `/incantation install` stays typed,
> since no mic is open before it.

The "confirm or answer by voice anything typing could" action row stays as the
prototype has it. A permission prompt on screen is still never answered by
voice.

### S4.3 The request flow (W2)

Kept from the prototype: read-back, thinking, plan, working, report. The
say-back is only for a change; a read-only request needs none. `listen.mjs
working` when acting starts. **A say-back ends the turn:** the `say` that
speaks it is the turn's last tool call, so the answer always arrives between
turns, as a relayed prompt, never as mid-turn context (S4.1); this keeps
"never ask for a spoken yes and then say the yes does not count" true under
the mid-turn rule. The listener's spinner word is the acknowledgement (S4.4);
the session's first say is the answer, the say-back or a short line on what it
is doing.

**Questions.** A question, or a read-only request, is answered directly, also
when it arrived mid-turn; say-backs are only for actions. No rule text is
added for questions.

### S4.4 Acknowledgement and progress (W3, W6, W9)

- The house rule becomes: after anything heard, the listener itself plays a
  spinner word at once, never the same twice running; speak no acknowledgement
  of your own on top of it.
- **Progress.** While you work, when a delivery carries `progress-due`, speak
  one short line on what you are doing now, in everyday words, with no id,
  then run `listen.mjs working` again. It is exempt from the speak gate. The
  beat, 90 s, is a starting point in `tuning.md` ("The progress beat");
  `listen.mjs` holds the number (S5.3). With the voice muted, the line goes to
  chat only. During one long tool call nothing reaches the session, so the
  mod speaks a fixed line for it (S6.3).
- **After a question.** After a line that asks the person something, speak
  nothing unasked until a heard or typed turn arrives; put the rest in chat
  (W9). A progress line is not due then, since you are not working.

### S4.5 How it speaks (W2, W9)

Kept from the prototype, each already a contract rule: one topic per turn,
short plain lines, everyday words first then why; never speak an id, hash,
issue or pull request number or path (say what it is, the id goes to chat);
never end a line on a list of options. Added from W9: when the session needs a
choice, give a recommendation and why, casually, and let the person agree or
push back. `tuning.md`'s example phrases follow it.

### S4.6 Mute (W2)

Kept: the mic and the voice mute separately, each by voice or by typed
`/incantation mute`, `unmute`, `mute-voice`, `unmute-voice`; "mute" or
"unmute" said alone goes to the listener at once.

### S4.7 Hearing through the relay (W7)

The prototype's "The relay" paragraph, with the shipped names and S6's rules:
a `[voice]` message sent by grimoire's mod is a delivery from your own wait;
start no `listen.mjs wait` of your own while the relay holds it; a heard turn
that arrives as context after a tool result, ending `(heard while you
worked)`, is a delivery too, and a whole-turn "wait" there halts you before
your next tool call. Turns joined by `| then:` are several turns, in order.

The relay is the only route: the session never runs `listen.mjs wait`, and
the prototype's leftover lines that say to start the next wait after each
delivery go. When the mod is not running, no waiter connects within
`relayWaitMs` (60 s) of `ready`, and the listener ends with `listener error
relay`; its background command ends, and the skill shows the line, prints
`Stopped listening.` and the README's line on the mod. This drops main's
session-held wait loop, so the skill needs grimoire's mod (S12).

On `listener error busy` the skill shows the line and says to stop voice in
the session that has it; it never runs `stop` itself.

**Typing still ends voice mode,** as the shipped Stop rule says: a message the
person types, other than a reply to a pending say-back or "are you there?",
stops the loop. A `[voice]` message from the relay is heard speech, never a
typed message, though it arrives in the user's role.

### S4.8 Trims

- Install's step 1 ("Who asked") is cut: the Stops already hold that only a
  typed slash command starts or installs.
- Lines that restate the harness go, leaving one: "A permission prompt on
  screen is the person's; voice never answers it." "Claude Code's permission
  mode checks each tool call" is cut.
- No tracker is named anywhere in the skill; no level is named.
- The **Stops** block keeps the contract template's heading: none of its rows
  waits for a confirmation.

### S4.9 Fences

The contract's **Fences** line is reworded:

> The built `SKILL.md` carries no `contract:begin` or `contract:end` lines:
> the repository's scan reads an HTML comment in a skill as a hidden
> instruction, and no suppression is added for it. This is a recorded
> exception to the `contract` skill's rule that a contract without schedules
> keeps its fences. An amendment finds each part by its heading in `SKILL.md`
> and keeps the rest word for word. Moving the procedure into schedules, which
> would make the no-fence build the rule's own case, stays open.

The old reason ("as head-chef's carries none") goes: head-chef has none
because its procedure lives in schedules, not as a precedent.

### S4.10 Other contract changes

- `rules` row for the relay: the prototype's, with the dev mod's name read as
  grimoire's mod, and its guards against: a spoken ask prompt hooks never see.
- The field notes are folded into the change log as rows with a field signal;
  `field-notes.md` does not ship. The prototype's rows dated 2026-11-19 to
  2026-11-22, numbered 0.1.0, keep their dates and are renumbered 0.2.0.
- The `open` row stays: "whether a heard yes is safe enough for every act,
  when the listener cannot tell voices apart", settled by "a month of use with
  no act taken on a yes the person did not give". Its clock restarts on
  2026-11-22. The
  month is counted without heard text: the practice record and the owner's own
  word count acts the owner disowns.
- `tuning.md` edits: "progress" leaves "Kinds that never pass it" (the
  progress line is exempt, S4.4), and the contract's gate row guards against
  crying wolf "with status" only; the acknowledgement example phrases go (the
  listener's spinner is the acknowledgement); the decision example becomes a
  recommendation ("I'd merge now, since the review is in. OK?"); "The progress
  beat: 90 s" is added; the backchannel list says it holds after a say-back
  too (S4.1).
- Version: the contract goes to 0.2.0.

### S4.11 Head-chef's gates

The owner decided that a spoken clear yes counts at head-chef's gates too. So
in this change head-chef's `CONTRACT.md` is amended through the contract skill
and its `SKILL.md` regenerated. Each rule that counts only the owner's own
typed turn (accepting a pick, each GitHub act, a start, cleanup's yes, a
member's blocked act, eval spend, the Desktop route, a hand-off or fresh
session, a pressed top level's goal) also counts a clear yes heard after a
say-back that names the act and its cost (S4.1). A heard turn that sets or
widens a goal is said back and holds only after a clear yes. A permission
prompt is still never answered by voice. No head-chef gate is left out; claim
1 checks head-chef's regenerated `SKILL.md` for the rule.

`docs/security/brigade.md` and `docs/security/threat-model.md` are edited to
match (S8). The merge edits a threat model and head-chef's gates, so it waits
for the owner's own confirmation.

## S5. The listener

Every change is in the prototype's `listen.mjs`, `gate.mjs`, `lib.mjs`,
`setup.mjs`, `capture/ffmpeg.mjs` and `statusline.mjs` unless a line says it is
new; the build ports it with the shipped names. The listener and every worker
start with the state folder as their working folder, never the session's.

### S5.1 Commands

New on the channel and the command line, each answered by one fixed line:

| Command | Does | Answers |
|---|---|---|
| `working` | sets the status word `working` until the next line spoken or turn heard, at most `workingMs` (10 min) | `working` |
| `mute-voice`, `unmute-voice` | the voice switch: while muted a `say` counts as played (so `plays` and the reply mark stay true) and makes and plays no audio | `voice-muted`, `voice-unmuted` |

A listener older than a command closes the connection; the client then prints
`listener: restart needed for this command` when `ping` answers, else
`listener: not running`. The `cue` command and the `CUES` table do not ship.

### S5.2 Spinner words (W3, W6)

- The ten words, `SPINNERS` in `listen.mjs`: Combobulating, One sec, Looking
  into it, Percolating, Noodling on it, Pondering, Clauding, Julienning, Let me
  see, On it (W6).
- Synthesized once by the engine after `ready`, in the background, each with
  150 ms of silence before it. Until they exist, nothing plays: the chime does
  not ship.
- One plays when the gate hears a turn end, before the turn is transcribed, so
  it is not heard seconds late where it would sound like a reply; chosen by
  `pickSpinner`, never the one before while there is another. It always plays
  when a turn ends: for a quick answer inside the echo window, for talk over a
  line playing or waiting, and for a turn the gate cut (the owner never asked
  for a rule that skips it: "I never asked for that"). It is skipped only while
  the mic is muted (and the voice, which plays nothing). When the text says the
  turn was a stop word, a mute word, a fragment, or our own sound heard back, or
  the transcript failed, the cue is stopped where it stands.
- Not counted in `plays`, so a say-back alone is `plays 1`.

### S5.3 Progress beat

- New: `progressMs` in `KNOBS`, 90 000. While the status word is `working`
  and no line has been spoken and no turn heard for `progressMs`, the listener
  raises `progress-due` once, then again every `progressMs` while that holds.
- `progress-due` ends a `wait` (a notice the session acts on, like `ready`);
  #208's rule T14, that a wait ends only on a real turn, gains this one
  exception.
- It joins `wait`'s output grammar, so the relay passes it.

### S5.4 A heard turn moves on (W8)

When a turn is kept, a line still playing stops and every queued `say` is
dropped (its caller gets `say-held`); the next delivery carries
`interrupted`. As the prototype has it, with `speechEpoch`. A `say` that lands
while a kept turn waits for its delivery, or while a held part of one waits for
its rest, is answered `say-held` and plays nothing: the session wrote the line
without that turn. The word is `say-failed` only when the line fails for another
reason, as a barge-in or a stop.

### S5.5 Mic fallback and the settings (W4)

- `setup.mjs choose` saves the chosen device's `index` and `stamp` and, beside
  them, keyed digests of its id and name: HMAC-SHA-256 with a random key made
  at the first `choose` and kept in `~/.grimoire/incantation/key`, so the
  digests cannot be reversed by guessing device names. `lib.mjs` accepts
  them. No device id or name is kept as text, so #208's rule that no device
  name or id is kept in a file holds; the README says the settings hold
  digests.
- At start, `pickDevice` hashes each listed device and finds the saved mic by
  id digest, then by name digest, wherever it sits; settings from before (no
  digests) match by stamp and index. Gone: the first device that is not a
  loopback opens. The prototype's `LOOPBACK` pattern knows Windows names; it
  gains the common macOS and Linux ones (`blackhole`, `soundflower`, `loopback
  audio`, `monitor of`, `.monitor`), and since those platforms are claimed
  only (S5.11) the README says the fallback is tested on Windows.
- On a fallback the first delivery carries `mic-fallback "<name>"` before
  `ready`. The name reaching the chat is kept to letters, digits, spaces and
  `()-_.`, cut at 64. The README's "Who hears" says the fallback name goes to
  the chat.
- The fallback skips only a device whose name matches the loopback list;
  another input may carry other sound or hear the room. The README says so.
  A loopback device is never opened. No device at all: `listener error
  device`.
- The greeting says which mic it is using, in plain words (prototype Start
  step 5).

### S5.6 Status and the status line

The status words gain `working`; the listener writes `run/voice` (`muted` or
`on`), removed at stop; `statusline.mjs` appends ` voice: muted`.

### S5.7 Kept small changes

`preRollFrames` 3 to 20 (about 0.6 s kept before a voice is confirmed, so a
first word is not lost). A field note of a turn cut mid-sentence (its tail
never arrived) is a different gap from a pause: the end-of-turn hold (S5.8)
addresses a pause, and whether the split or the transcriber lost the tail is
not known; the practice run checks it. The gate's `overlap` flag marks a turn
begun during a reply or within `echoHoldMs` (1.5 s) after one.

### S5.8 The echo stack (W10, W11)

All of the prototype's, ported as it is, each layer optional: when its part
of the runtime is missing or its worker fails, frames and turns pass through
as before, and the listener goes on.

| Layer | Module | What it does | Needs |
|---|---|---|---|
| Echo canceller | `echo.mjs` `makeAec`, `engines/aec-worker.py` | WebRTC AEC3 (`livekit` package) takes what the speaker plays out of each 30 ms mic frame | the Python layer |
| Loopback reference | `echo.mjs` `makeLoopback`, `engines/loopback.ps1` | on Windows, everything the default speaker plays (system sounds included) is the canceller's reference, kept at most 100 ms ahead; elsewhere, or when it fails, the player's own samples are | Windows PowerShell, nothing installed |
| Steady player | `stream.mjs` `makeStreamPlayer` | one ffplay for the session, paced by the mic's frames, fed silence between lines, so the speaker delay stays put; every sample written is the reference | ffplay beside the pinned recorder; else the old player |
| Speech detector | `stream.mjs` `makeSpeech` | Silero VAD through the sherpa addon: a frame counts as voice only when it is speech, so typing and a cough make no turn | the core runtime |
| End of turn | `turn.mjs`, `engines/turn-worker.py` | Smart Turn v3.2: a turn that sounds unfinished is held while quiet lasts under 2.5 s more, and what follows joins it, at most 3 joins; it never ends a turn sooner | the Python layer |
| Text echo guard | `echo.mjs` `isEcho` | a turn with the `overlap` flag whose words are 70% or more from lines spoken in the last 30 s is dropped, unless it is a stop word; the last three lines are kept in memory only | nothing |

Knobs, as the prototype has them in `KNOBS`: `bargeGraceMs` 1500,
`bargeExtraDb` 10, `bargeRemovedDb` 9, `bargeWarmMs` 3000, `echoHoldMs` 1500;
on Windows the capture adds `-audio_buffer_size 50`.

Every worker runs with no shell, `-I` for Python, from the runtime's own
interpreter, with stdin and stdout pipes only and stderr discarded; it exits
when its stdin closes. A worker's environment is built from a named list
(`PATH`, `SYSTEMROOT`, `TEMP`/`TMP`, `HOME`/`USERPROFILE`, `LOCALAPPDATA`)
plus `HF_HUB_OFFLINE=1` and `HF_HOME=<runtime>/hf`; no token passes. No worker
opens a network connection; the tests assert the spawn shapes and the
environment, and the practice run checks that no worker opens an outbound
connection. Every Python worker imports `onnxruntime` and calls
`onnxruntime.disable_telemetry_events()` before importing anything else, and
before its first session. The build also checks whether the ONNX runtime
inside the sherpa addon sends usage events and how to turn them off; if they
cannot be turned off, the build stops and asks the owner.

`loopback.ps1` runs as `powershell.exe -NoProfile -NonInteractive
-ExecutionPolicy Bypass -File <skill base>/scripts/engines/loopback.ps1`, by
the absolute path of Windows PowerShell in the system folder, never one found
on PATH. The relay's and the nudge's spawns of `node` follow the pane's PATH
rule in `docs/security/brigade.md`.

Trial evidence, not claims: the bleep test went from 3 false turns to 0; the
speaker delay held at 155 to 168 ms; Smart Turn called 55 of 77 finished turns
finished, 15 ms a check on CPU. Not tested: NVIDIA Broadcast with noise
removal on; a change of output device mid-session (loopback follows the
default at start only); macOS and Linux.

### S5.9 The runtime and its install (W10)

**What it holds,** under `~/.grimoire/incantation/runtime/`, held to the state
folder's rules (inside the real home, no link or junction, 0700 and 0600 on
POSIX):

| Part | Files | About | Licence |
|---|---|---|---|
| Core: the addon | `sherpa-onnx-node` 1.13.8 and its platform package (`sherpa-onnx-win-x64` 1.13.8 on Windows), CPU build | 30 MB order | Apache-2.0 |
| Core: hearing | Parakeet TDT 0.6b v2, int8: encoder, decoder, joiner, tokens | 660 MB | CC-BY-4.0 (README attributes it) |
| Core: speaking | Kokoro 1.0 multi-lang, full fp32: model, voices, tokens, `lexicon-us-en.txt`, `espeak-ng-data/`, `dict/` | 393 MB | Apache-2.0; `espeak-ng-data/` and the espeak-ng code the addon carries are GPL-3.0-or-later |
| Core: speech detector | `silero_vad.onnx` | 0.6 MB | MIT |
| Python layer | one venv `py/` from `uv`, CPython 3.12: `livekit` 1.3.0, `onnxruntime` 1.32.0 (1.23.2 on Intel Macs, the last release with an Intel Mac wheel, with `coloredlogs`, `humanfriendly`, `sympy` and `mpmath`), `numpy` 2.5.5, `ptts` 0.7.1 and their dependencies | 190 MB | Apache-2.0, MIT, BSD |
| Python layer: end of turn | `smart-turn-v3.2-cpu.onnx`, from `pipecat-ai/smart-turn-v3` at commit `f766f81d` (the build records the full hash) | 9 MB | BSD-2-Clause |
| Python layer: Phonon | the Everly voice and model `ptts` loads, kept under `runtime/hf/` | 104 MB | as its model card says |

The README states each licence, including the GPL part. Phonon's model licence
is read from its model card at build time and recorded; one that forbids this
use puts Phonon out. The prototype ran two venvs with the same numpy; the
shipped runtime has one. The test wavs that ship in Parakeet's folder are not
fetched.

**The pins.** One table in code, `scripts/runtime/pins.mjs`, lists for each
file its source URL and its size and sha256. The build fills it from the files
the owner ran in the trial; the ten sha256 values below are those files'
hashes.

| File (under `runtime/`) | sha256 |
|---|---|
| `kokoro/model.onnx` | `b40f62b166ac8164b0627ef48a0b358eda0985e272fb03ef5252e7206305da11` |
| `kokoro/voices.bin` | `1c5a5b983d3d50d8586d437a51f3faa2da7919ce76a013c081e65671a3447c29` |
| `kokoro/tokens.txt` | `6ebb6bb288f20f3ae8d004d3c2ca27697da27c037d75e81a60e2a6a663f95425` |
| `kokoro/lexicon-us-en.txt` | `7daaab53a181be9885b853a8582bf1838186317e5dadacbcef9c426d6fa0da14` |
| `parakeet/encoder.int8.onnx` | `92a10bd9c23936ea0566c29f963bc57c2a5df4261b6a8921c39abea66557ca8b` |
| `parakeet/decoder.int8.onnx` | `4d097bae3bac5c96018d5293ba39f1b657296102b142affda40378f38b020f41` |
| `parakeet/joiner.int8.onnx` | `77a29f3e5ac7d37074e0af465391b80f314015d5b97f0f90c6c7767f1d56f428` |
| `parakeet/tokens.txt` | `ec182b70dd42113aff6c5372c75cac58c952443eb22322f57bbd7f53977d497d` |
| `vad/silero_vad.onnx` | `9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6` |
| `smart-turn/smart-turn-v3.2-cpu.onnx` | `2bb026316b14a660486a75b1733cd3fbab8c2fd0314dc9af7be49f8cca967e4f` |

The rows with no hash above (`kokoro/espeak-ng-data/`, `kokoro/dict/`, the
addon packages, Phonon's model) are hashed from the owner's trial folder, file
by file. Each pin is matched against its source's own published hash where the
source shows one: npm's `integrity` field for `sherpa-onnx-node@1.13.8` and
its platform package, Hugging Face's file hash for the rest. A mismatch, or a
file with no source match, stops the build and goes to the owner; the build
lists each pin it could not cross-check against a published hash.

- **Sources are fixed:** `huggingface.co/<repo>/resolve/<full commit>/<path>`
  for each model file, one file at a time (Kokoro multi-lang 1.0 and Parakeet
  TDT 0.6b v2 int8 from the sherpa-onnx model repos, and `pipecat-ai/
  smart-turn-v3`); `registry.npmjs.org` tarballs; and
  `github.com/k2-fsa/sherpa-onnx/releases` only where no per-file source
  exists. Models are never fetched as release `.tar.bz2`: no pin ends in
  `.bz2`. Redirects are followed only to the hosts those sources hand out,
  each named in the table, over https, with Node's own `https` module and no
  proxy read from the environment. The downloader sends no Authorization
  header, cookie or token.
- A file is fetched whole into `runtime.partial/`, checked against its size
  and sha256, and only then kept. An archive (an npm `.tgz`) is checked whole
  before it is opened; it is unpacked with `zlib` and a tar reader in the
  repo, which refuse links, absolute paths and `..`; every file it yields is
  checked against the table too. No new dependency. Anything not in the table
  is not kept.
- Nothing fetched is loaded or run before every pin of its part has passed.
  When all of a part's pins pass, `runtime.partial/<part>` is renamed into
  place; a failure deletes the partial part and says which file failed, never
  the URL's query or a path.
- **Python packages** install with `uv pip install --require-hashes
  --only-binary :all: --no-deps -r <lock>`, into the venv at `runtime/py`, from
  a lock file per platform in `scripts/runtime/`, made with `uv pip compile
  --generate-hashes --python-version 3.12 --python-platform <p>`, on macOS
  with `MACOSX_DEPLOYMENT_TARGET` set to the platform's wheel floor
  (`PYTHON_FLOOR` in `pins.mjs`). A package
  with no wheel for a platform means that platform runs without the Python
  layer; there is no source build. `uv` is the person's own install, found
  like the recorder (absolute PATH entries, never the working folder or the
  folder Claude Code started in); its CPython download is uv's own, checked by
  uv. The interpreter venv is made by `uv venv --managed-python` into
  `runtime/py`, so no `.python-version` or `pyproject.toml` in the session's
  folder changes anything.
- **uv isolation.** Every uv call runs with `--no-config`; the venv and install calls add `--index-url
  https://pypi.org/simple` and a managed-interpreter flag (`--managed-python`
  on the venv, `--python-preference only-managed` on the install, since uv
  refuses both together), its working
  folder set to `runtime/`, and an environment built from the named list
  above plus `UV_CACHE_DIR`, which the installer sets. No other `UV_*`,
  `PIP_*` or proxy variable passes. `setup.mjs runtime plan` names every host
  it will contact.
- **Phonon's model** is fetched by the pinned downloader into `runtime/hf/`,
  in the layout `ptts` reads offline. If `ptts` cannot be pointed at a pinned
  local copy, or does not load with the network off, Phonon is out (or another
  route, at the owner's choice).

**The install flow.** `/incantation install` gains one step, before the
microphone: **Runtime.** `setup.mjs runtime plan` prints, per part, whether it
is there and its download size, the peak disk use (download plus unpacked),
the expected time at 10 MB/s, every host it will contact, and whether `uv` was
found (no `uv`: the Python layer is skipped and the line says what is lost:
echo cancelling, the end-of-turn hold, Phonon). The install refuses to start when
free space on the home drive is short. The session says the plan back with its size, and on
a clear yes runs `setup.mjs runtime install` as a background command (core,
then the Python layer when `uv` is there), which prints a progress line per
file and then one line per part (`ok`, `skipped <why>`, `failed <file>`). A
later `setup.mjs runtime verify` re-hashes everything and prints the same
lines. The download never starts from a heard turn alone: the say-back is
spoken and shown in chat, and a clear yes answers it.

**At start,** `scripts/guard.mjs` checks that each installed part's files are
present with their pinned sizes (not their hashes: 1 GB is too slow for every
start); `verify` is the full check. A program of the person's account can
change a file after install; that is the machine's own, as with ffmpeg.

**Update.** When a release changes the pins, the guard's line names
`/incantation install`, which fetches only the parts whose pins changed and
deletes files no longer in the table (the exact rule is in "As built").

**Uninstall.** Deleting `runtime/` removes the runtime; it leaves uv's cache
and its CPython, which the README names with uv's own clean command.

### S5.10 The engines, and Voicebox's place

- `engines/sherpa.mjs` from the prototype: Parakeet hears (int8, CPU); Kokoro
  (`bella`) or Phonon (`everly`) speaks, both kept loaded; `warm()` loads both
  and runs each once; `playback()` only opens, since no other caller speaks
  through it. Its paths come from the runtime folder above. The prototype's
  GPU paths (libraries borrowed from other programs' folders) do not ship: the
  provider is `cpu` everywhere.
- **`sherpa` is the default engine** (W10, W11). A fresh `setup.mjs choose`
  writes `engine: "sherpa"`; a settings file with no `engine` key reads as
  `voicebox`. `setup.mjs profiles` lists the voices; install recommends
  Kokoro's Bella, the voice the owner chose.
- **Voicebox stays as a second engine,** chosen at install or by the
  settings' `engine`, never switched to on its own. It is already built and
  tested, it is the route on a machine where the sherpa runtime cannot
  install, and dropping it later is a one-row change; the owner said
  Voicebox's upkeep is the cost, so removing it is the alternative (S12). With
  `voicebox`, the echo stack still runs where its parts are installed.
- The settings' `port` applies to `voicebox` only; `sherpa` opens no port.

### S5.11 What each machine gets

| Machine | Gets |
|---|---|
| Windows 11 with `uv` | everything; tested in the trial on the owner's machine |
| Windows without `uv` | the core: Parakeet, Kokoro, the speech detector, the steady player, loopback and the text guard; no echo canceller (so a headset), no end-of-turn hold, no Phonon |
| Any machine without a GPU | the same as with one: the runtime is CPU only |
| Linux | claimed only: the core with that platform's addon package, the Python layer with `uv`, no loopback reference (the player's samples are the reference); nothing runs there in this change, so the README says untested |
| macOS | claimed only: the core with that platform's addon package; the Python layer is skipped (see "As built"); the README says untested |
| A platform with no pinned addon | `setup.mjs runtime plan` says so; the person can choose Voicebox |

## S6. Grimoire's mod

Three additions to `brigade/`, called from `register.tsx` beside the mic band.
None draws in the pane, and no lead tool reads them.

### S6.1 Binding

The relay and the nudge act only in a **bound** session, and only on main-thread
events: every hook acts only on events with `e.agentId === undefined`
(binding, `turn.start`, `turn.complete` and `turn.abort` for the `busy` flag,
and the mid-turn `tool.call` that carries a batch). A subagent's tool result
never carries heard text. In an unbound session the mod spawns nothing and
holds no wait.

- **Tied to a typed start.** The mod watches `command.run` for `incantation`
  and `grimoire:incantation` (typed by the person, main thread). A `tool.call`
  that runs `listen.mjs start` binds only inside the turn that command opened.
  Outside such a turn the mod denies a `tool.call` that runs `listen.mjs
  start`, with a fixed reason ("Type /incantation to start voice"). `stop` is
  never denied. The deny is a speed bump against a typo, not a control: a
  steered shell can record audio on its own, and `docs/security/brigade.md`
  says so.
- **The match.** Tools `Bash` and `PowerShell`, the event's `command` field.
  Before matching, backslashes become `/` and quotes are dropped; the text must
  hold `skills/incantation/scripts/listen.mjs` then whitespace and `start` as
  its own word, prefixed by `$.plugin.root` normalised the same way. It binds
  only when `next(e)` returned without `deny`. The mod reads each main-thread
  shell command's text and keeps only a flag.
- **Not when another listener lives.** Before passing the start call on, the
  mod reads `run/status`; touched in the last 10 s, it does not bind. A bound
  relay that gets `listener error waiting` three times in a row unbinds. A
  second session that runs `start` gets `listener error busy` and is not bound.
- **A start grace.** `listener error ended` is ignored until the first
  delivery after binding or 90 s, whichever comes first (the measured warm
  time plus 30 s, if 90 s proves short).
- **Ending.** The binding ends on a delivery of `stopped`, any `listener
  error` other than `waiting`, or `listener error ended`, and on the
  session's end.

Its limit: after a mod reload the binding is gone; the person types
`/incantation` again, and a live listener from before answers `busy` until it
is stopped.

### S6.2 The relay (W7)

`brigade/voice-relay.ts`, from the prototype's, with:

- **Holds the wait.** While bound, one `listen.mjs wait` at a time, through
  `$.process.spawn`, stdout only; backoff 2 s doubling to 30 s when nothing
  worth a turn came back.
- **What passes.** `worthATurn`: a `Heard` line, `interrupted`,
  `stt-dropped`, `say-failed`, `dropped`, `mic-muted`, `mic-unmuted`, `ready`,
  `mic-fallback`, `progress-due`, `stopped`, or a `listener error` other than
  `waiting` and `ended`. `relayText`: one line, `[voice] ` and the delivery's
  lines joined by ` · `, `timing:` left out, `plays` kept. The relay drops
  `progress-due` when no main-thread turn runs.
- **Between turns:** `$.prompt.submit({ text, asUser: true })`. Piled-up
  deliveries go joined by ` | then: `. A refused submit is retried every 1 s,
  up to 20 tries, in order; after that the batch is dropped and the next
  delivery carries a fixed `[voice] dropped <n>` line the relay adds.
- **Mid-turn:** between `turn.start` and `turn.complete` or `turn.abort`, a
  pending batch rides on the next allowed `tool.call` result as `context`,
  ending `(heard while you worked)`. What is left at the turn's end goes as a
  prompt.
- **No log:** no heard text is written anywhere. A count of turns relayed,
  submits refused and deliveries dropped is kept in memory for the session and
  never written.
- Only the listener's grammar passes (`wait` already filters it); the relay
  adds the tag and joins, nothing else.

### S6.3 The permission nudge (W2)

**Progress during one long call.** When the relay holds a `progress-due` and
no `tool.call` has come to carry it for 10 s, the mod drops it and runs
`nudge.mjs progress`, which speaks the fixed line "Still working on it." the
same way as the nudge below, at most once per `progress-due`. The status word
`working` lapses after `workingMs` (10 min) with no new `working` call, so a
single call longer than that gets beats for its first 10 minutes only; a
stated limit.

**The permission nudge.** On `classic.PermissionRequest` in a bound session,
the mod runs `skills/incantation/scripts/nudge.mjs` (new, from the prototype)
without waiting on it: it speaks the fixed line "I need your OK on screen."
through a say file and `listen.mjs say`, at most once every 20 s, only while
the listener's status file is fresh, and never answers the prompt. It passes
the event on unchanged and passes no event field on. With the voice muted it
plays nothing, as any say.

### S6.4 The mic band's voice button (W2)

`brigade/mic-band.tsx`, `mic-view.ts`, `mic-svg.ts` gain the prototype's second
button (Mute voice or Unmute voice), the `working` state word, the voice file
read (`run/voice`), and the prototype's fix that stops redrawing the picture
while Claude speaks. The click file's whole text may now be `mute`, `unmute`,
`mute-voice` or `unmute-voice`; #208's command-file rule (T16) is otherwise
unchanged.

## S7. Acceptance claims

Node tests with a fake engine and recorder, and the mod's plugin tests, unless
a claim says otherwise.

1. A clear yes (S4.1) holds in the regenerated `SKILL.md` and the contract,
   with the pull-back words and no "but"; `tests/incantation-skill.test.mjs`
   fails if "but" returns to the list or if the term is missing. Head-chef's
   regenerated `SKILL.md` carries the rule of S4.11.
2. The skill names no tracker, no level, no "hard stop", holds one harness
   line about permission prompts (S4.8), and never tells the session to run
   `listen.mjs wait` (S4.7); the skill test checks each.
3. `working`, `mute-voice` and `unmute-voice` answer their fixed lines; a muted
   voice makes no synthesis call and plays nothing, and `plays` still counts the
   say; an old listener yields `restart needed`.
4. A kept turn plays one spinner word within 100 ms on the fake player, never
   the same twice running over 50 turns; none plays on a stop word, a mute
   word, a fragment, a muted voice or during a line; `plays` does not count it.
5. With the status `working` and no line or turn for `progressMs`, a `wait`
   ends with `progress-due`, again after another `progressMs`, and not after a
   line was spoken or a turn heard (fake clock).
6. A kept turn during a line stops it, drops queued says with `say-held`, and
   the next delivery says `interrupted`.
7. `pickDevice` finds the saved mic by id digest, by name digest, by stamp and
   index for old settings, and falls back to a non-loopback device with
   `mic-fallback "<name>"` before `ready`; with only loopback devices,
   `listener error device`; made-up device lists per platform row include a
   loopback name each that is never picked. `setup.mjs choose` writes keyed
   digests of id and name, never the text, and the key file; `lib.mjs` refuses
   a value that is not a digest; the fallback name is cut to the allowed
   characters and 64.
8. `statusline.mjs` prints `mic: working` and ` voice: muted` from the files.
9. The echo stack (S5.8), with fake workers: each layer is used when present
   and passed through when missing or failing (a worker that exits, a missing
   interpreter, a missing model), and the listener goes on; the barge knobs
   and the text echo guard drop a fake echo turn and keep a stop word; the
   turn hold joins a turn judged unfinished and never ends one sooner; every
   worker spawn has no shell, `-I`, the runtime's own interpreter, the named
   environment, the state folder as its working folder, and PowerShell by its
   absolute system path; every Python worker imports `onnxruntime` and calls
   `disable_telemetry_events()` before importing anything else.
10. The installer (S5.9), against a fake server: a file whose size or sha256
    differs from its pin is not kept and the part fails naming that file; an
    archive is checked before it is opened; an archive entry that is a link,
    absolute or holds `..` is refused; a file not in the table is not kept; no
    pin ends in `.bz2`; a redirect to a host not in the table is refused; the
    downloader sends no Authorization header or cookie; with `HTTP_PROXY` set,
    the fake proxy receives nothing; nothing in `runtime.partial/` is imported
    or spawned; a passing part is renamed into place; `uv` from a relative PATH
    entry or the working folder is never run; the `uv pip install` command
    line holds `--require-hashes`, `--only-binary :all:` and `--no-deps`, and
    each uv call holds `--no-config`; the install call also holds the index
    flag, `--python-preference only-managed` and `--python <runtime>/py`; the
    venv is made with `--managed-python`; a `uv.toml` and a `UV_INDEX_URL`
    planted in the working folder and the environment change no request, and
    neither does a `.python-version` or `pyproject.toml` in the session's
    folder.
11. `setup.mjs runtime plan` prints each part's state and size, peak disk use,
    every host, and whether `uv` was found, and with no `uv` names what is
    lost; `install` refuses when disk is short; `verify` re-hashes; the guard fails
    with a fixed line naming `/incantation install` when an installed part's
    file is missing or the wrong size.
12. `engines/sherpa.mjs` with a fake addon and worker: `warm()` loads and runs
    each model once; `transcribe` and `synthesize` return text and a WAV;
    `profiles()` lists `bella` and, when Phonon is installed, `everly`; no
    provider but `cpu` is ever passed; no PATH is changed.
13. The engine table holds `sherpa` and `voicebox`; a fresh `choose` writes
    `sherpa`, a settings file with no `engine` key reads as `voicebox`; a
    `voicebox` setting still passes every #208 claim.
14. Relay: `relayText` and `worthATurn` as S6.2 says; an unbound session spawns
    no process and holds no wait; binding follows a `listen.mjs start` tool
    call made inside a typed start's turn and ends on `stopped` or a listener
    error; a start outside such a turn is denied and `stop` never is; a
    subagent's event binds nothing and carries nothing; piled deliveries join;
    a refused submit retries and then drops with a `dropped` line; mid-turn
    batches ride on a tool result's context and the rest go at the turn's end;
    no file is written by the relay (a fake `$.fs` records none).
15. Nudge: runs only in a bound session, never more than once in 20 s, passes
    the event on unchanged and passes no event field on, and with no fresh
    status file does nothing. A `progress-due` held 10 s with no tool call runs
    `nudge.mjs progress` once and is dropped. With no waiter within
    `relayWaitMs` of `ready`, the listener ends with `listener error relay`.
16. The band draws the voice button and the `working` word, and a press writes
    `mute-voice` or `unmute-voice` to the click file, which the listener
    accepts.
17. No shipped file (code, `SKILL.md`, the README, tests) carries a name from
    the prototype: its dev-mod name, its two virtual-environment folder names,
    a folder of another program's GPU libraries, the `cue` command, or a
    scratch path; the change log is exempt. `scratch/` is gone
    from the pull request, and `git log main..HEAD -- scratch/` is empty.

**No evals (the owner, 2026-11-22, spoken after a say-back):** "Yes, please. I
don't want any evals in incantation unless I see something that defends the
intent." `evals/incantation/` is deleted, and its entry comes out of the
BUDGET in `tests/eval-budget.test.mjs`. No eval cases are added. The checks
are the code tests above and the owner's practice run. A read-back eval is
filed separately, for later.

**Practice run** (the owner, Windows 11, after Test): heard turns arrive as
`[voice]` messages; a turn while working arrives mid-turn; spinner word on
each turn; a progress line after 90 s of work; a permission prompt nudged; mic
fallback named with the usual mic unplugged; mute voice then a spoken clear
yes counts; a fresh `/incantation install` on the owner's machine fetches and
checks the runtime, then `verify` prints `ok` for each part; on speakers, five
lines and two notification sounds make no turn; a "wait, let me see" pause
comes through as one turn; the lost tail of a cut turn is checked; RAM use,
the time to `ready`, and that no worker opens an outbound connection are
recorded. Recorded as pass or fail and counts, no heard text.

## S8. Files

- `skills/incantation/`: `SKILL.md` (regenerated), `references/CONTRACT.md`,
  `contract.changelog.md`, `tuning.md` (progress beat, example phrases),
  `README.md`, `scripts/listen.mjs`, `gate.mjs`, `lib.mjs`, `setup.mjs`,
  `statusline.mjs`, `capture/ffmpeg.mjs`, `engines/index.mjs`, and new:
  `nudge.mjs`, `echo.mjs`, `stream.mjs`, `turn.mjs`, `guard.mjs`,
  `engines/sherpa.mjs`, `engines/aec-worker.py`, `engines/turn-worker.py`,
  `engines/phonon-worker.py`, `engines/loopback.ps1`, `runtime/pins.mjs`,
  `runtime/install.mjs` (the downloader and unpacker), and the per-platform
  lock files. The prototype's `hooks/hooks.json`, `.claude-plugin/plugin.json`
  and `tsconfig.json` do not ship: grimoire's own manifest and mod hold their
  places. The repo's checks and the skill scan run on the Python and
  PowerShell files; if either refuses one, the build stops and asks rather
  than adding a suppression.
- The skill's README says: the relay's route (a user-role prompt that every
  prompt hook and Remote Control sees, in place of the prototype's
  background-output line); voice mute; the mic fallback and its limit; the
  settings hold keyed digests; the band reads `run/voice` and writes four
  words; `nudge.stamp` stays after stop; the nudge; each licence; the runtime's
  size and what uninstall leaves; the loopback text: everything the speakers
  play, including a call's far side, is read into memory for the canceller
  while the listener runs, the mic muted included, and none of it is kept;
  macOS and Linux untested.
- Tests: `tests/incantation-{echo,stream,turn,sherpa,runtime}.test.mjs`, with
  fake workers, a fake addon and a fake download server; and
  `tests/incantation-{listen,gate,capture,setup,statusline,skill,nudge}.test.mjs`;
  CONTRIBUTING.md's suite line for the new test file.
- `brigade/`: `register.tsx`, `voice-relay.ts` (new), `voice-relay.test.ts`
  (new), `mic-band.tsx`, `mic-view.ts`, `mic-svg.ts`, `mic-band.test.tsx`.
- `evals/incantation/` deleted; its BUDGET entry removed from
  `tests/eval-budget.test.mjs`.
- Head-chef's `CONTRACT.md` and regenerated `SKILL.md` (S4.11).
- `SECURITY.md` (the band's paragraph: the voice file, the relay, the nudge)
  and `docs/security/brigade.md` (one row each for `$.prompt.submit`,
  `tool.call` context, `turn.start`/`turn.complete`/`turn.abort`,
  `$.process.spawn` of `wait`, `classic.PermissionRequest` with
  `$.process.run`; the binding reads each main-thread shell command's text and
  keeps only a flag; the nudge passes no event field; the start deny is a
  speed bump). In brigade.md the row that said Brigade does not cause text to
  reach a session as the owner's now says a `[voice]` turn counts as the
  owner's at head-chef's gates.
- `docs/security/threat-model.md`: the "Text into a session" boundary says the
  owner's words include a clear yes heard by incantation's relay, and a new
  accepted-class line for ambient speech is written as the owner's decision of
  2026-11-22 (what it covers, never the steps). The model stays within its
  3,000 words, so the same edit trims the section to fit, and the trim is
  shown to the owner.
- `docs/spec/incantation.md`: a "Superseded by" note at its scope, at T14, at
  S5.4's no-device-name rule, at T16, and where it names the evals.
- `docs/spec/`: this spec as `0001-incantation-from-the-prototype.md`, and its
  line in the index.
- The plugin version, as the repo's version check asks.
- Removed: the prototype's local snapshot under `scratch/`; it is never
  pushed. The build branches from `main`, reads the snapshot from the local
  branch, and pushes no commit holding it.

## S9. Security

Heard speech is on the threat model's "Text into a session" boundary. This
change edits the model as S8 says; its classes are the owner's.

What changes, and the control for each:

- **A forged delivery mid-turn.** Tool output can hold text shaped like a
  relayed delivery. Control: a clear yes never comes from mid-turn context
  (S4.1); there, heard text can only halt or raise a new request. A
  mid-turn read-only request is answered directly under the owner's decision
  in S4.3.
- **Heard turns in the wrong session.** As prototyped, every session with the
  mod would race for the one wait. Control: binding, main thread only, tied to
  a typed start (S6.1).
- **Heard text at rest.** The prototype logged every turn. Control: no log
  (S6.2). The settings file holds keyed digests of the mic's id and name,
  never the text (S5.5); the fallback name reaches the chat, which the
  README says.
- **A spawn per permission prompt.** Bound sessions only (S6.3).
- **The fallback mic.** A fallback opens a mic the person did not pick; the
  greeting names it, and a loopback device is never opened.
- **The supply chain.** The installer brings onto the machine a native addon
  loaded into the listener, ONNX models, a Python interpreter (through `uv`)
  and Python wheels, from Hugging Face, npm, GitHub and PyPI. Controls:
  sources and redirect hosts fixed in code; every file pinned by size and
  sha256 in code, checked before it is kept, loaded or run; archives checked
  whole before opening, unpacked without links or escapes; Python by
  `--require-hashes` wheels only, no build step; uv isolated from the
  person's configuration and environment (S5.9); no credential sent; the
  owner's clear yes on the plan, with its size.
- **The loopback reference.** It records everything the speaker plays, for the
  canceller only: in memory, at most 100 ms kept, never written or sent. Its
  script runs with the execution policy bypassed for that one process, from
  the skill's own folder.
- **Workers and the addon.** Native code and Python run inside or beside the
  listener with the person's rights; they read audio from pipes only and write
  nothing but their replies. No worker opens a network connection: the tests
  assert the spawn shapes and environment, and the absence of network use
  rests on the pins, `HF_HUB_OFFLINE` and the telemetry call.
- **Usage events.** Python workers turn the ONNX runtime's telemetry off
  (S5.8).

The security pair runs on the diff at Test.

## S10. Trade-offs

- **The relay against tool-output delivery.** Prompt hooks see spoken asks and
  turns land mid-turn (W7), against heard speech arriving with the same role as
  typing. Driver: the owner's words.
- **Spinner words against silence.** An instant sound per turn (W6), against
  ten synthesis calls at start and a sound on false turns.
- **No mid-turn yes against speed.** A yes said while the session still works
  does not count (S4.1). Since a say-back ends its turn (S4.3), a yes to it
  always arrives between turns, so the rule refuses only a yes nobody asked
  for in that turn.
- **A spinner after the words against one at once.** The spinner plays when
  the turn's text is in, so a stop word gets none: from the end of speech that
  is the end-of-speech wait (1.5 s, longer under the end-of-turn hold) plus
  transcription (0.1 to 0.6 s on Parakeet in the trial). Budget: the spinner
  starts within 100 ms of the transcript (claim 4); the end-to-spinner time is
  recorded in the practice run, not claimed.
- **The mod as a requirement against two delivery routes.** One route, which
  prompt hooks see, against the skill not working without grimoire's mod
  (S4.7). Driver: W7; the owner decides (S12).
- **The whole engine now against Node only.** No separate app, a canceller
  that works on speakers, and the trial's accuracy (W10, W11), against a 1.3 GB
  download, native code and Python on the machine, and a supply-chain surface.
  Driver: the owner's words (W10). The pull request argues for the downloaded
  runtime as CONTRIBUTING asks of a patch that adds a package.
- **CPU only against speed.** No borrowed libraries and one build to pin,
  against the GPU's faster lines; the owner said speed is not the point (W11).
- **Worker environment against compatibility.** A named list of variables
  keeps the person's environment out of workers, at the cost that a worker
  needing another variable fails until the list grows.

## S11. Rollback

The pull request is a draft until the owner merges it. On a machine:
`listen.mjs stop`, reload; settings from before load as they are (the digests
are optional, and a file with no `engine` key means `voicebox`, as before), and
a settings file with digests loads in the older listener only after
`setup.mjs choose` again (S5.5). The runtime is one folder: deleting
`~/.grimoire/incantation/runtime/` removes it, and Voicebox works without it.

## S12. Open points

The owner decides these; each has the proposal this spec builds.

- **The progress beat's number,** 90 s, is a starting point.
- **A GPU runtime** is out of this change. The trial's GPU route borrowed
  libraries from other programs' folders, which cannot ship and would load
  DLLs from folders incantation does not own. A pinned GPU build of the addon
  is the route if the owner wants it.
- **Voicebox** is kept as a second engine (S5.10); removing it is the
  alternative.
- **The mod becomes a requirement** (S4.7): accept it, or keep main's
  session-held wait as a second route.
- **The contract's open row** on heard-yes safety restarts its clock on
  2026-11-22 (S4.10).
- **The lost tail of a turn** (S5.7) is checked in the practice run; a
  follow-up issue if it recurs.
- **uv's managed Python** could be brought under `verify` by setting
  `UV_PYTHON_INSTALL_DIR` under `runtime/`; not built unasked.

## S13. Build order

Five steps, each done when its claims pass and `athanor run check` passes
(else the host check, as AGENTS.md says). The last of them then runs
`athanor run plugin-test`, `claude plugin validate --strict`, the version
check, and the mod tests on a Windows host; then Test with the QA pair, the
security pair on the diff, and the standards pair if the owner takes it.

1. **Contract and skill:** S4, including head-chef's contract and `SKILL.md`
   (S4.11); claims 1, 2.
2. **Listener:** S5.1 to S5.7; claims 3 to 8.
3. **Engine, echo stack, runtime:** S5.8 to S5.11; claims 9 to 13; the
   security pair reads its diff. Done also when, on the owner's Windows
   machine, after the owner's clear yes on the size, `setup.mjs runtime
   install` then `verify` print `ok` for each part.
4. **Mod:** S6; claims 14 to 16; `claude plugin test .` and `node
   scripts/record-brigade-stats.mjs` on Windows.
5. **Docs and specs:** S8's docs, brigade.md and the threat model, and
   deleting `evals/incantation/` with its BUDGET entry; claim 17.

## As built

These changes were made while building. They supersede the text above where
they differ.

- **The update rule.** A runtime part is re-fetched when its pinned hash or
  its Python stamp differs, not when a size differs. The stamp is the SHA-256
  of the pinned Python version and the platform's lock file, recorded in the
  Python layer's manifest.
- **uv.** The interpreter venv is made with `--managed-python` and
  not `--python-preference only-managed`, which uv refuses beside it; the exact
  interpreter, 3.12.12, is named with `--python`.
- **Redirect hosts.** The list includes `objects.githubusercontent.com`
  alongside `release-assets.githubusercontent.com`.
- **The listener.**
  - `stt-dropped` ends a `wait` when it belongs to a cut-turn chain; otherwise
    it rides on the next delivery.
  - A turn cut by the end-of-speech wait is held and joined to the next one (a
    cut-turn chain), with a soft turn ceiling `softTurnMs` of 25 s.
  - Heard text over 500 characters is split.
  - The settings keep HMAC-SHA-256 digests of the mic id and name (the key is
    in `~/.grimoire/incantation/key`), not the text.
  - No spinner word plays on a turn flagged `overlap`.
- **Silero VAD** is fetched from the sherpa-onnx GitHub release `asr-models`, not
  Hugging Face, and is a trust-on-first-use pin.
- **Telemetry.** The ONNX runtime inside the sherpa-onnx addon sends Windows
  TraceLogging usage events that nothing turns off; the threat model names it as
  a data flow. The Python workers turn theirs off.
- **macOS has no Python lock file,** because ONNX Runtime has no wheel for the
  macOS target uv uses. On macOS the Python layer is skipped (the core still
  installs). The lock files are for Windows x64 and Linux x64.
