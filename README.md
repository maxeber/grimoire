<p align="center">
  <img src="docs/brand/grimoire/grimoire-mark.svg" width="128" alt="grimoire mark">
</p>

<h1 align="center">G R I M O I R E</h1>

<p align="center"><strong>A spellbook of agent skills for AI. Cast wisely.</strong></p>

<p align="center">
  <a href="skills/eagle-eye"><img src="docs/brand/eagle-eye/eagle-eye-mark.svg" width="56" alt="eagle-eye"></a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="skills/groundtrack"><img src="docs/brand/groundtrack/groundtrack-mark.svg" width="56" alt="groundtrack"></a>
  <br>
  <a href="skills/eagle-eye"><code>eagle-eye</code></a>
  &nbsp;&nbsp;&nbsp;&nbsp;
  <a href="skills/groundtrack"><code>groundtrack</code></a>
</p>

---

A **skill** is a folder of instructions your coding agent reads when the moment
calls for it — a reference book it knows when to open. Grimoire holds two, and
both do the same kind of work: they take something you can only hold in your
head and put it on a page you can look at.

**[See one before you install anything.][eagle-demo]** That page is a live
decision grid about whether to publish this repository. Click an option and
watch it recolour. eagle-eye wrote it, about itself.

## Install

Two skills today, more later. Works with any agent:

```bash
npx skills@latest add mephistopheles4/grimoire
```

That is [`skills`](https://github.com/vercel-labs/skills), which installs into
Claude Code, Cursor, Codex, Gemini CLI, Copilot, Windsurf, Zed, opencode, Amp
and around seventy more. It copies the whole skill directory, renderer
included.

<details>
<summary><strong>Other ways to install</strong></summary>

**As a Claude Code plugin**, if you would rather the marketplace handled
updates:

```text
/plugin marketplace add mephistopheles4/grimoire
/plugin install grimoire@mephistopheles4
```

Plugin skills are namespaced, so that route invokes them as
`/grimoire:eagle-eye` and `/grimoire:groundtrack`. The installer route keeps
the plain `/eagle-eye` and `/groundtrack`.

**By hand**, if you want neither installer:

```bash
git clone https://github.com/mephistopheles4/grimoire.git
cp -r grimoire/skills/eagle-eye ~/.claude/skills/
cp -r grimoire/skills/groundtrack ~/.claude/skills/
```

Neither skill names a fixed path to its own renderer, so each runs from
wherever it lands. eagle-eye has been run from three directories: the author's
skills folder, the plugin install, and a copy made by `skills`.

</details>

Every route gives you both skill directories, each with its `SKILL.md`, the
renderer that goes with it, and a README of its own. Each skill's README is
where it is documented. What follows is only enough to tell you which one you
want.

---

## <img src="docs/brand/eagle-eye/eagle-eye-mark-solid.svg" width="32" align="absmiddle" alt=""> [eagle-eye](skills/eagle-eye)

**A decision is made once it has been seen against the whole system.**

Reach for it when three or more decisions are open and one choice changes what
is possible in another: picking the cheap database changes what the deployment
can be, which changes who can be on call. Asked one at a time, those questions
hide the thing you need to see.

eagle-eye draws a **morphological box** instead — one row per decision, one
cell per option, an edge wherever two options rule each other out or require
each other — then renders a page that reads any configuration back. Not for two
independent choices.

**Live: [the decision to publish this repository][eagle-demo].**

The seven findings, why every edge carries an evidence tier, and the renderer's
flags: [`skills/eagle-eye/README.md`](skills/eagle-eye).

## <img src="docs/brand/groundtrack/groundtrack-mark-solid.svg" width="32" align="absmiddle" alt=""> [groundtrack](skills/groundtrack)

**A reader who did not write a change cannot see its shape.**

Reach for it when a plan is made or the work is done and someone else has to
understand it. A change arrives as a list of files. A plan arrives as a list of
tickets. Neither says what calls what, what each part hands back, where it can
break, or what it needs in order to work.

groundtrack writes one call graph with recorded traces through it, renders a
self-contained page you can step a cursor across, and prints the same graph as
an indented tree on request. Not for a conversation, because nothing durable
exists to check the graph against.

**Live: [a pull request, stepped through][track-demo].**
Every published page is in [the gallery][gallery].

The three channels, what a layer redraws, the page's controls, and the honesty
property's stated limit:
[`skills/groundtrack/README.md`](skills/groundtrack).

---

The marks, the cards and the tokens behind them are in
[`docs/brand/`](docs/brand).

<details>
<summary><strong>How the repository is put together</strong></summary>

The repository **is** the plugin. `.claude-plugin/plugin.json` names it
`grimoire`; `.claude-plugin/marketplace.json` is the shelf that lists it with
`"source": "./"`. Skills sit at `skills/<name>/`, which is the one level the
default scan reads and the layout the `skills` installer finds first.

The two manifests carry different names on purpose: the shelf is
`mephistopheles4`, the book is `grimoire`. The version lives in `plugin.json`
and nowhere else, because a second copy is a second place to forget.

This shape follows [mattpocock/skills](https://github.com/mattpocock/skills),
which ships a marketplace manifest and a plugin manifest side by side at the
root. The Claude Code docs describe each separately and never that pairing, so
the evidence it works is a repository that does it, plus
`claude plugin validate .` passing here.

</details>

## Contributing

[`CONTRIBUTING.md`](CONTRIBUTING.md). The contract is one command:

```bash
node scripts/check.mjs
```

Security problems go through private reporting, not a public issue:
[`SECURITY.md`](SECURITY.md).

## Licence

[MIT](LICENSE). © 2026 Ayman Diab.

[eagle-demo]: https://mephistopheles4.github.io/grimoire/docs-decisions-publish-eagle-eye.html
[track-demo]: https://mephistopheles4.github.io/grimoire/skills-groundtrack-examples-pr-313.html
[gallery]: https://mephistopheles4.github.io/grimoire/
