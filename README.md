<p align="center">
  <img src="docs/brand/grimoire/grimoire-mark.svg" width="112" alt="grimoire mark">
</p>

<h1 align="center">G R I M O I R E</h1>

<p align="center"><strong>A spellbook of agent skills for AI. Cast wisely.</strong></p>

<p align="center">
  <a href="skills/eagle-eye"><img src="docs/brand/eagle-eye/eagle-eye-mark.svg" width="40" alt="eagle-eye"></a>
  &nbsp;&nbsp;
  <a href="skills/groundtrack"><img src="docs/brand/groundtrack/groundtrack-mark.svg" width="40" alt="groundtrack"></a>
</p>

---

Two skills today, more later. Works with any agent:

```bash
npx skills@latest add mephistopheles4/grimoire
```

That is [`skills`](https://github.com/vercel-labs/skills), which installs into
Claude Code, Cursor, Codex, Gemini CLI, Copilot, Windsurf, Zed, opencode, Amp
and around seventy more. It copies the whole skill directory, renderer
included.

**Claude Code users can install the plugin instead**, if you would rather have
the marketplace handle updates:

```text
/plugin marketplace add mephistopheles4/grimoire
/plugin install grimoire@mephistopheles4
```

Plugin skills are namespaced, so that route invokes them as
`/grimoire:eagle-eye` and `/grimoire:groundtrack`. The installer route keeps the
plain `/eagle-eye` and `/groundtrack`.

Either way you get both skill directories, each with its `SKILL.md`, the
renderer that goes with it, and a README of its own. Each skill's README is
where it is documented; what follows is only enough to tell you which one you
want.

The marks, the cards and the tokens behind them are in
[`docs/brand/`](docs/brand).

---

## <img src="docs/brand/eagle-eye/eagle-eye-mark.svg" width="32" align="absmiddle" alt=""> [eagle-eye](skills/eagle-eye)

Use when a discussion holds three or more open decisions and one choice changes
what is possible in another — during brainstorming, a design review, or any
walk through a plan one decision at a time — or when you ask for an eagle-eye
view, a morphological box, or invoke `/eagle-eye`. Not for two independent
choices.

**Live example: [the decision to publish this repository][demo].** Click an
option and watch the grid recolour. That page was written by the skill, about
itself.

[demo]: https://mephistopheles4.github.io/grimoire/

The seven findings, why every edge carries an evidence tier, and the renderer's
flags: [`skills/eagle-eye/README.md`](skills/eagle-eye).

## <img src="docs/brand/groundtrack/groundtrack-mark.svg" width="32" align="absmiddle" alt=""> [groundtrack](skills/groundtrack)

Use for a plan already made or work already done, when a reader needs to see
its shape — what calls what, what each part hands back, where it breaks, and
what it needs to work. Writes one call graph with recorded traces through it,
renders a self-contained page, and prints the same graph as an indented tree on
request. Not for a conversation with nothing durable behind it.

The three channels, what a layer redraws, the page's controls, and the honesty
property's stated limit: [`skills/groundtrack/README.md`](skills/groundtrack).

---

## Install by hand

If you want neither installer, copy the directory yourself:

```bash
git clone https://github.com/mephistopheles4/grimoire.git
cp -r grimoire/skills/eagle-eye ~/.claude/skills/
cp -r grimoire/skills/groundtrack ~/.claude/skills/
```

Neither skill names a fixed path to its own renderer, so each runs from
wherever it lands. eagle-eye has been run from three directories: the author's
skills folder, the plugin install, and a copy made by `skills`.

## How the repository is put together

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

## Contributing

[`CONTRIBUTING.md`](CONTRIBUTING.md). The contract is one command:

```bash
node scripts/check.mjs
```

Security problems go through private reporting, not a public issue:
[`SECURITY.md`](SECURITY.md).

## Licence

[MIT](LICENSE). © 2026 Ayman Diab.
