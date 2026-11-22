<p align="center">
  <img src="../../docs/brand/incantation-card.svg" width="100%" alt="incantation — a familiar at your shoulder; think out loud together">
</p>

# incantation

**A familiar at your shoulder. Think out loud together.**

A voice pair-programming partner for Claude Code. `/incantation` turns a session
into one you talk with: it greets you, speaks short plain turns, one fact at a
time, listens at all times, says a request back before it changes anything, and
speaks unasked only when something needs you. You can talk over it, and it
stops.

By default the speaking and the transcribing run on your machine, in the
listener's own process, from a runtime that `/incantation install` downloads
(Parakeet hears, Kokoro speaks, nothing opens a port). [Voicebox](https://voicebox.sh)
stays as a second engine, on its own port, 17493, which Incantation does not let
you change. Incantation adds a setup check (the guard), a setup script that
`/incantation install` runs for you, an always-on listener, and a skill with a
speak policy. It declares no dependency in the repository: the runtime is
fetched on your yes, pinned file by file, and the guard checks the setup at each
start and says what to do.

incantation is a skill of the grimoire plugin, so `grimoire@mephistopheles4` is
the one install that gives you `/incantation` and the mic band. The plugin's mod
(the same one that draws the band) is required too: it carries each heard turn
into the chat and nudges you at a permission prompt (see "Hearing through the
mod"). If you installed the earlier `incantation@mephistopheles4` plugin,
uninstall it: the skill now comes with grimoire. Only your own typed
`/incantation` starts it; the skill never starts the mic on its own.

## Platforms

| Platform | What you get | Status |
|---|---|---|
| Windows 11 | the whole runtime, with `uv` for the Python layer | Tested with a real mic and a headset: the owner's trial. |
| Windows 11 without `uv` | the core: hearing, speaking, the speech detector, the steady player, the loopback reference and the text echo guard; no echo canceller (so use a headset), no end-of-turn hold, no Phonon voice | Same trial, core only. |
| Linux | the core, and the Python layer with `uv` | Claimed only. Unit tests run on Linux with fakes; no real-mic run. |
| macOS, Apple Silicon | the core. The Python layer has no lock file here: ONNX Runtime has no wheel for the macOS target `uv` uses, so there is no echo canceller, end-of-turn hold or Phonon voice | Claimed only. No check runs on macOS. |
| Any other platform (macOS on Intel, Linux on ARM) | no pinned addon: `setup.mjs runtime plan` says so; choose Voicebox | |

The runtime is CPU only, on every machine.

The code is the same everywhere. These places differ by platform:

| Place | Windows | macOS and Linux |
|---|---|---|
| Capture input and device list | `dshow` | `avfoundation`, `pulse` or `alsa` |
| Finding ffmpeg | fully qualified drive folders on PATH | absolute PATH entries, owned by root or you, writable by no one else |
| The `~/.grimoire/incantation` folder's privacy | your profile folder's default access | 0700 folders and 0600 files, refused when looser |
| The OS mic permission | Settings, Privacy, Microphone, "Let desktop apps access your microphone" | macOS: give the terminal or app that runs Claude Code Microphone access; Linux: none beyond the sound server |

## 1. Install Node, ffmpeg and, optionally, uv

- Node 24 or later.
- ffmpeg, on your PATH, with its `ffplay` beside it (step 2). On macOS and Linux it must sit in a folder owned by
  root or by you that no other account can write; a shared Homebrew prefix
  owned by another account is refused.
- [`uv`](https://docs.astral.sh/uv/), your own install, for the runtime's Python
  layer (echo cancelling, the end-of-turn hold, the Phonon voice). It is found
  the way ffmpeg is: absolute PATH entries only, never the working folder.
  Without it the core still installs, and the plan says what is lost.
- Only if you choose the Voicebox engine: Voicebox 0.5.0 or later, from its site
  (Linux: build it from source as its README says). Start it, and keep it on
  this machine only. At each start, Incantation's guard refuses to go on when
  Voicebox answers on any of the machine's other addresses at that moment; a
  network that comes up later is not checked until the next start.

## 2. A player for the replies

Nothing is registered in Claude Code. The listener makes each reply as audio
(from the local engine, or from Voicebox's stream route, which generates without
playing) and plays it itself, so it knows when a reply starts and ends and kills
it the moment you talk over it. Voicebox's own speaking is not used, and its MCP
tools are not needed. With the local engine the player is one `ffplay` kept open
for the session and fed silence between lines, so the speaker's delay stays the
same, which the echo canceller needs.

The player is `ffplay`, which comes with most ffmpeg builds, found in the same
folder as the ffmpeg that install pinned, never by searching PATH. When that
folder has no `ffplay`, the listener falls back to one system player: `afplay` on
macOS, `paplay` or `aplay` on Linux, Windows PowerShell's sound player on Windows.
These play from a file, so the listener writes one private file for the length of
a reply and deletes it when the reply ends or is cut. With none of them, the
first line fails with `say-no-player`: install an ffmpeg build that includes
`ffplay` and run `/incantation install` again. The player is started with no
shell, and the reply's text never reaches it: it gets audio only.

The session hands the listener each line in a small file it writes under
`~/.grimoire/incantation/observe/`, which the listener reads once and deletes, so
what the session says never passes through a command line.

## 3. Install, in a session

Type `/incantation install`. It runs the whole setup in the chat. First the
**runtime** (below): the session shows the plan, with its size and the hosts it
will contact, and downloads only on your clear yes. Then it lists your
microphones and asks you to type the number of yours, lists the engine's voices
and asks you to type the id of the one you want (the local engine's default is
Kokoro's Bella; on Voicebox pick a preset on Kokoro: a heavier engine costs
seconds a line), saves them, checks the setup, and offers a mic indicator for
your status line.

Your microphone's and voice's names appear in the chat while it does this, so
they reach the model provider. The settings file, `~/.grimoire/incantation/settings.json`,
is written by Incantation's own script. A session may read it, for example to
troubleshoot: it holds no secret, but it holds the full path to ffmpeg, which can
include your account name, and the mic's id and name as keyed digests (HMAC-SHA-256
with a random key made at your first choice and kept in
`~/.grimoire/incantation/key`), not the text. The file also keeps a plain hash
of the whole device list, which could confirm a guessed list, so do not have a
session read `key` or the settings without need. At each start the listener finds your mic by those, wherever
it now sits in the device list. If your microphones change, run
`/incantation install` again. A settings file with no `engine` key means
`voicebox`, as before; a fresh install writes `sherpa`.

### The runtime

`setup.mjs runtime plan` lists each part, whether it is there and its download
size, whether `uv` was found, the total, the peak disk use (download plus
unpacked) and the time at 10 MB/s, and every host it will contact. `setup.mjs
runtime install` then fetches what is missing, as a background command printing
one line per file and one result per part (`ok`, `skipped <why>`, `failed
<file>`); it refuses to start when the free space on your home drive is short.
`setup.mjs runtime verify` re-hashes every installed file; at each start the guard
checks only that each file is there at its pinned size, and its line names
`/incantation install`, which fetches only the parts whose pins changed. The
runtime lives under `~/.grimoire/incantation/runtime/` and nowhere else.

| Part | About | Licence |
|---|---|---|
| The addon: `sherpa-onnx-node` 1.13.8 and its platform package, CPU build | 30 MB order | Apache-2.0 |
| Hearing: Parakeet TDT 0.6b v2, int8 | 660 MB | CC-BY-4.0, see below |
| Speaking: Kokoro 1.0 multi-lang, fp32, with its lexicon | 393 MB | Apache-2.0 |
| Speaking: `espeak-ng-data/`, and the espeak-ng code the addon carries | with Kokoro | GPL-3.0-or-later |
| The speech detector: Silero VAD | 0.6 MB | MIT |
| The Python layer, one venv from `uv` (CPython 3.12): `livekit`, `onnxruntime`, `numpy`, `ptts` and their dependencies | 190 MB | Apache-2.0, MIT, BSD |
| End of turn: Smart Turn v3.2 (CPU) | 9 MB | BSD-2-Clause |
| The Phonon voice, Everly, loaded by `ptts` | 104 MB | Apache-2.0 |

**Attribution.** The hearing model is NVIDIA's Parakeet TDT 0.6b v2, licensed
[CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/), here as the int8 ONNX
conversion the sherpa-onnx project publishes. It is not changed beyond that.

**Where it comes from.** From `huggingface.co` and its CDN, `registry.npmjs.org`,
`github.com` and its release hosts (`release-assets.githubusercontent.com`,
`objects.githubusercontent.com`), and, for the Python layer, `pypi.org` and
`files.pythonhosted.org`; `uv` also fetches its own CPython, from Astral's mirror (`releases.astral.sh`)
or GitHub, and checks it. The
sources and redirect hosts are fixed in code and no proxy variable is read. Every
file has a size and a sha256 in `scripts/runtime/pins.mjs` and is checked before
it is kept, loaded or run; an archive is checked whole before it is opened and
unpacked with no links or escapes; Python packages install by hash only, no
build step. Two pins are trust on first use, taken from the files the owner ran
and not from a published hash: Silero VAD and the Hugging Face files that are
not in LFS. The downloader sends no cookie, token or Authorization header. A
program on your account that changes a file after the install is the machine's
own business, as with ffmpeg. The ONNX runtime inside the addon sends Microsoft
usage telemetry on Windows (TraceLogging); nothing here turns it off.

**Removing the runtime.** Delete `~/.grimoire/incantation/runtime/`; Voicebox
works without it. `uv` keeps its own cache and the CPython it fetched: clean them
with `uv cache clean` and `uv python uninstall`.

Earlier drafts kept their files in `~/.incantation/`. The first run of the guard,
setup or the listener moves that folder to `~/.grimoire/incantation/`, beside
eagle-eye's. A link in its place is never moved, and neither is a folder when the
new one already exists.

### The mic band (Claude Desktop, VS Code, the mobile app and the terminal)

With the grimoire plugin installed, a row above the prompt shows the listener's
state, `mic: listening`, `hearing`, `thinking`, `speaking` or `muted`, in a colour
that eases from one state's to the next (`working` too, while the session works), with a wave of what the mic hears, and two buttons: Mute or
Unmute for the mic, and Mute voice or Unmute voice for the session's voice. In the terminal the wave is two rows of blocks, as wide as
the terminal up to 2000 columns. On the desktop, in VS Code and in the mobile app it
is one image: an orb with the wave flowing out of both sides and ripples while you
talk, a breathing orb while Claude speaks, drawn four times a second and laid out
100 ms ahead of the clock, since the apps start a picture a moment after they draw
it. Both numbers are fixed; there is no setting for them. The band draws nothing when
no listener runs. It lives in grimoire's own mod, beside Brigade, since a skill
cannot carry one here. It reads `~/.grimoire/incantation/run/levels` four times a
second while a listener writes it, and about once every two seconds while none does,
and it reads `run/voice` (one word, `muted` or `on`) the same way.
A click writes one of the four words `mute`, `unmute`, `mute-voice` or
`unmute-voice` to `run/command`, which the listener reads once and removes.
Nothing else in the run folder is read or written by it.

`levels` holds numbers only: a stamp, the state word and 24 digits, 0 to 8, one a
quarter second, the loudest frame of each. It holds no audio and no text, but it
does show when you were talking. The listener writes it at most four times a second
(about 0.1 ms each) and removes it when it stops. Anything with access to the run folder can click for you, which it could
already do by reading the listener's channel token in the same folder.

### The mic indicator, for a terminal status line

Claude Desktop does not draw a status line; a terminal does. `/incantation install` offers a status line segment that reads `mic: listening`,
`mic: hearing`, `mic: thinking`, `mic: working`, `mic: speaking` or `mic: muted`,
with ` voice: muted` after it while the voice is muted. It is the script `skills/incantation/scripts/statusline.mjs`, which prints nothing when no
listener runs. To add it yourself, set this in your Claude Code user settings
file:

```json
{ "statusLine": { "type": "command", "command": "node <skill base>/scripts/statusline.mjs", "refreshInterval": 1 } }
```

If you already have a status line, add the script's output to yours instead.
`<skill base>` is the installed plugin's `skills/incantation` folder, which a
plugin update moves, so repeat the entry after an update.

## 4. Give the OS mic permission

As the platform table says. With the permission off, the mic gives only
silence, and the listener stops with `listener error mic`.

## 5. Start

Type `/incantation` in a session, the lead session of a brigade included. It
checks the setup, starts the listener, prints `Listening, always on.`, warms the
engine, and greets you (naming the mic when it is a fallback). It prints `Stopped listening.`
whenever it stops.

- **If your mic is gone.** The listener finds your saved mic by its id, then its
  name. If neither is there it opens the first input that is not a loopback
  device (a name that looks like a loopback or "monitor of" is skipped; that
  list is tested on Windows only) and says so by name in the greeting, so a mic
  you did not pick is never silent. Another input may carry other sound or hear
  the room. With only loopback devices it stops with `listener error device`.
- **Hearing through the mod.** The listener holds one `wait`, and grimoire's mod
  holds it for the session: each heard turn arrives as a `[voice]` message, between
  your turns as a prompt, or, while the session works, on the next tool result,
  ending `(heard while you worked)`. The session never runs `listen.mjs wait`
  itself. Without the mod, no waiter connects within 60 s of `ready` and the
  listener stops with `listener error relay`. The mod acts only in the session
  whose own typed `/incantation` started the listener; elsewhere it spawns nothing.
  A second session that starts it gets `listener error busy`: stop voice in the
  first one.
- **The sound of it.** A heard turn gets a short spinner word at once ("One sec",
  "Looking into it" and eight more), never the same one twice running; it plays
  nothing while the mic or the voice is muted, and it is cut short when the words
  prove to be a stop word, a mute word or a fragment. It plays when you finish
  speaking, even over a line or right after one. While
  the session works it says one short line on what it is doing about every 90 s,
  and the mod says a fixed "Still working on it." when one long call carries no
  line. When Claude Code stops on a permission prompt, the mod says "I need your OK
  on screen." at most once in 20 s. It never answers the prompt; that stays yours.
- **Use a headset.** The mic stays open while a reply plays, so the session can
  hear you talk over it, and the listener stops the reply it was playing. A mic that picks up
  the speakers will hear the session's own voice, though the echo layers (below)
  drop most of it. Sound from other programs (a browser, a call, media) can still be
  heard as speech.
- **The echo layers.** Each is used when its part of the runtime is installed and
  skipped when not: an echo canceller (WebRTC AEC3) that takes what the speaker
  plays out of the mic; a loopback reference, on Windows, of everything the default
  speaker plays; a steady player; the Silero speech detector, so typing or a cough
  makes no turn; Smart Turn, which holds a turn that sounds unfinished for up to
  2.5 s more, at most three times, and never ends one sooner; and a text guard that
  drops a turn made of words the session just spoke, unless it is a stop word.
- **Barge-in stops the player.** The listener plays each reply itself, so it ends the
  player when you talk over it, drops the replies queued behind it and tells the
  session the reply was cut. How fast the sound stops on your machine is not
  measured.
- **Mute is yours alone.** Say "mute" or "unmute" as a whole turn, or type
  `/incantation mute` or `/incantation unmute`. The session never mutes you. While
  muted, the listener still transcribes on this machine, only to catch "unmute",
  and nothing reaches the session. The session's voice mutes apart from the mic:
  `/incantation mute-voice` and `unmute-voice`, or the band's voice button. With
  the voice muted the session still speaks into the chat and the listener plays
  nothing.
- **Noise.** A quiet headset can make breaths look like speech, and the transcriber
  turns them into words such as "you". The gate is loose on purpose and leaves
  the noise to your own cancelling (NVIDIA Broadcast, your headset's, the OS's): a
  frame counts as voice at 6 dB over the floor and at least -55 dBFS, and a turn
  holds 120 ms of voice, so a short "yes" is heard. More turns open than before, in
  a noisy room too. A turn that is only a filler word is dropped. Raise
  `voiceDb`, `minVoiceDbfs` and `minVoiceMs` in `gate.mjs` if your room needs it.
- **Long turns.** A turn ends after 1.5 s of quiet (`endOfSpeechMs` in the settings,
  300 to 3000), and one that stops mid-sentence is held and joined to the next; a
  turn that runs past 25 s is cut and joined the same way. Heard text over 500
  characters is split before it reaches the session.
- **Say yes aloud.** A request that changes anything is said back, and a spoken
  clear yes is enough: the first turn after the say-back, which opens with "yes",
  "go ahead", "do it" or the like and agrees outright, with none of "no", "not",
  "don't", "wait", "stop", "instead" or "actually" in it ("but" is allowed). A yes
  that narrows the act, or a bare "okay" or "sure", is not one: the session says
  the act back again or asks. A clear yes stands in for typing at a checkpoint,
  including the head chef's gates, and for the runtime install. It never answers a
  permission prompt on screen.
- You may add allow rules so turns don't stop on a prompt. Add them yourself;
  Incantation adds none:
  - exactly `node <skill base>/scripts/listen.mjs working`, `node <skill base>/scripts/listen.mjs idle`,
    and `node <skill base>/scripts/listen.mjs say` followed by 8 hex digits, and the
    rule `Write(~/.grimoire/incantation/observe/say-*.txt)`;
  - in observe-only mode, exactly `node <skill base>/scripts/observe.mjs add`
    followed by 8 hex digits, and the rule `Write(~/.grimoire/incantation/observe/inbox-*.json)`.
    Never allow a wider path in that folder: a session could then
    change your settings or the eval set with no prompt shown to you.
  Never add an allow rule for `listen.mjs start` or `stop`, or for `setup.mjs`.

## 6. Who hears

While Incantation runs, the mic is open at all times, muted or not. Everything said
within its reach, by anyone, reaches the model provider as chat, not only replies to
the session, and with Remote Control on, claude.ai and every signed-in device. A
muted mic sends nothing. **Tell people within the mic's reach that it is always
listening.**

Say "stop" or type to end it. It also stops after 30 minutes with nothing heard
(not while the mic is muted: a muted mic stays open until you stop it), and when the Claude Code session it belongs to ends.

`listen.mjs` keeps no audio and no heard text. It writes one word, the listening
state, to `~/.grimoire/incantation/run/status`, and one word, `muted` or `on`, to
`run/voice`; `run/nudge.stamp`, the time of the last permission nudge, stays after
a stop. It passes the microphone's
device id, which can name the hardware, to ffmpeg on its command line, so
anything that reads or reports this machine's command lines sees it. The mod
sends each heard turn into the chat as a user-role prompt, so every prompt hook
and Remote Control sees it as if you had typed it (other plugins' tool-call hooks
see the mid-turn route, and the Desktop app's store and phone sync keep the
transcript), and the session treats a clear yes in it as yours; anyone or anything the mic hears can therefore raise a request
or confirm one that was said back. The mod writes no heard text anywhere. Claude
Code keeps every heard line in the session transcript. A mic that is not yours
(see "If your mic is gone") is named in the chat when it is used.

While the listener runs, everything the speakers play, a call's far side
included, is read into memory for the echo canceller on Windows, the mic muted
too: at most 100 ms of it is kept, and none is written or sent. The Python
workers read audio from pipes only, run from the runtime's own interpreter with
no shell, and open no network connection themselves; the listener and its
workers start in the state folder, not the session's.

With the Voicebox engine, the listener asks Voicebox for each reply through its stream
route, and Voicebox may keep each reply's text and audio in its History, in plain
files in your profile folder. Voicebox's own dictation keeps its transcripts the
same way. Clear both from Voicebox's History and Captures tabs. The local engine
keeps nothing of the kind.

In observe-only mode (`/incantation observe`), the session's unspoken candidates,
which can repeat what was said near the mic, go to `~/.grimoire/incantation/observe/`. Day
files are dropped after 30 days, and an inbox file never logged after a day,
the next time it runs. A frozen sample stays until
you delete it. Delete the folder to clear both.

## Stopping and removing it

`node <skill base>/scripts/listen.mjs stop` first, then delete `~/.grimoire/incantation/`,
in that order; that folder holds the runtime and the key for the settings' digests.
`uv`'s own cache and CPython stay (see "The runtime"). Incantation changes none of
Voicebox's settings.

## Tuning

How often it speaks unasked is set in
`skills/incantation/references/tuning.md`, a file of starting points. Edit it and
start a new session. The listener's own numbers are at the top of
`skills/incantation/scripts/gate.mjs`.
