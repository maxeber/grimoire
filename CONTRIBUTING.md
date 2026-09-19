# Contributing

`grimoire` is a marketplace of Claude Code skills. A skill is mostly prose that
an agent obeys, so a patch here changes what a machine does on somebody else's
computer. That is the reason for the rules below, and it is the only reason.

## The short version

```bash
node scripts/check.mjs
```

That is the contract, and it is still one command. It validates every
artifact in the tree with the renderer its registry row names, checks that no
file a skill ships has grown a fixed path back, fails on a code fence that declares no
language, fails on a dependency, fails when the two SkillSpector baselines
disagree, and runs the test suite in `tests/`. CI runs it as a required check
called `check`. `main` takes no direct pushes.

Two more workflows scan things the command above does not. One runs SkillSpector
over the skill prose and fails on any finding the baselines do not cover. The
other runs zizmor over `.github/workflows/` and fails on any finding at all —
there is no baseline for it, because there is nothing to suppress. Both install
their scanner on the runner and never on your machine, so the command above
stays the only one you need. See [`SECURITY.md`](SECURITY.md) for what each one
covers, what it suppresses, and why.

It walks what `.gitignore` does not exclude, so a worktree under
`.claude/worktrees/` is not descended into and not checked. Only the root
`.gitignore` is read.

You need Node 20 or later and nothing else. There is no install step, because
there are no dependencies.

## Tests

The tests run on `node --test`, which ships with Node. That is the whole reason
they exist: a test runner from npm would be the dependency this repository does
not take, and `SECURITY.md` explains why that matters more than it looks.

`node scripts/check.mjs` runs them, so there is no second command to forget. To
run only the suite while you work on it:

```bash
node --test tests/esc.test.mjs tests/render.test.mjs tests/check.test.mjs tests/build-pages.test.mjs tests/skillspector-gate.test.mjs tests/groundtrack-fold.test.mjs tests/groundtrack-render.test.mjs tests/registry.test.mjs tests/audit.test.mjs
```

**The suite never reaches the network.** eagle-eye's edge audit is the one
script in the tree that sends anything, and `tests/audit.test.mjs` runs it
against a fake service bound to `127.0.0.1` inside the test process. It clears
any real key from the child's environment first, so a key in your shell is
never used. CI never calls the provider. A test that did would spend money and
hand a key to a runner. A new test that needs the service uses the fake.

Two rules about what goes in there:

**Never commit an artifact as a fixture.** `scripts/check.mjs` and
`scripts/build-pages.mjs` both walk the whole tree for every suffix
`scripts/lib/registry.mjs` names — `*.box.json` and `*.flightpath.json` today.
A broken fixture fails the check, and a valid one is rendered and published to
the public site. Read the artifact the skill already ships, or write the
malformed one to a temporary directory at run time. `tests/render.test.mjs` and
`tests/groundtrack-render.test.mjs` both do this.

**Test at the seam a reader uses.** The renderer's seam is its command line, and
the check's seam is its exit code and its output. A test that reaches inside
either one breaks on a refactor that changed no behaviour.

That is also why a `git worktree` needs no setup here. Add one and run the
check; there is nothing to install, link, or copy first.

## What a good patch looks like

**One change, one reason.** A pull request that fixes a typo and rewrites a
procedure is two reviews wearing one hat.

**Say what you tested.** "Ran `node scripts/check.mjs`, green" is enough for a
prose change. For a renderer change, say which box file you rendered and what
you looked at on the page.

**A behaviour change carries a test.** Not a coverage target — there is none.
The rule is narrower: if the patch changes what the renderer or the check does,
the pull request shows the test that fails without it.

**Do not add a dependency.** The renderer is deliberately zero-dependency: it
imports node built-in modules and nothing else. A patch that adds a package
needs to argue for itself in the pull request body before anybody reads the
diff. See [`SECURITY.md`](SECURITY.md) for why this matters more than it looks.

`node scripts/check.mjs` enforces this. It fails on a `package.json`, a
lockfile, and any `.mjs` or `.js` file importing a bare specifier — an import
path that is not relative, not absolute, and not a `node:` builtin. It reads
code and not prose, so a comment is skipped. Until this check existed the rule
held only because the tree gave it nowhere to land.

**Give every artifact a page name no other artifact wants.**
`scripts/build-pages.mjs` names each published page after the artifact's path
from the repository root, with the separators flattened:
`docs/decisions/x.box.json` becomes `docs-decisions-x.html`. Two artifacts
sharing a basename in different directories are both legal and both publish —
that is what path keying is for. Flattening a path onto one name is not
injective, though, so `grid/one.box.json` and `grid-one.box.json` both ask for
`grid-one.html`. The build refuses and names both files rather than publishing
one over the other, and it refuses before it renders anything. Rename one.

The comparison folds case, because the filesystem this site is built from folds
case and two names differing only in case silently became one file there.

**Give every code fence a language.** `node scripts/check.mjs` fails on a fence
that declares none, and names the file and the line. Use `text` for a block
that is neither code nor markup — a typed command, a plain example.

This is a hand-written rule and not markdownlint, on purpose. A linter is a
dependency wherever it runs, including an unpinned `npx` in a workflow, and
adopting one would start with a decision about its line-length rule that nobody
has taken. The rule catches a bare fence and nothing else.

## Rules that are specific to skills

**Never write a fixed path to a file inside a skill.** A skill can be installed
as a plugin, copied by hand, or vendored into a project, and each lands in a
different directory. Reference the skill base directory the harness supplies.
`scripts/check.mjs` fails on `~/.claude/` appearing in any file under `skills/`
— the prose, the library, the reference pages, the renderer and the schema. A
block-quoted line in a markdown file is exempt, because a quoted example is not
an instruction. Only markdown is exempted: `>` is quotation in prose and is
nothing in JavaScript, JSON or HTML.

**Keep the frontmatter `name`.** Claude Code takes the skill's invocation name
from it, so the name survives whatever the install directory is called.

**Write to the skill's own rules.** eagle-eye's prose follows ASD-STE100 tested
against ISO 24495-1: active voice, present tense, one instruction per sentence,
twenty words or fewer, no idiom. See
[`skills/eagle-eye/reference/writing-edges.md`](skills/eagle-eye/reference/writing-edges.md).
A patch that breaks the rule the skill teaches is the worst kind of patch here.
groundtrack's prose follows the same controlled English.

**A skill names no vocabulary this repository does not own.** Not in its
description, not in its body, not in its examples. No outside skill name,
command name, or tool-specific noun.

The test is one question a stranger can run: *does this sentence stay true and
checkable for a reader who has only this repository?* A borrowed name fails it
twice — the reader cannot resolve it, and the sentence asserts something about
a tool they do not have.

**The test is per sentence, not per word.** Ordinary English that collides with
an outside name is fine: *during brainstorming* costs the reader nothing. A
sentence built on a named tool's behaviour is not, even when every word in it
is ordinary — *"Brainstorming has the clarifying questions answered and has not
yet proposed approaches"* asserts a phase sequence only one tool has.

**A citation is not vocabulary.** A `src` field records where a claim came
from, so it points outside this repository by definition — a chat turn, a
document, an earlier artifact, a runtime's manual. Genericise it and it cites
nothing, and the renderer refuses a `sourced` edge that names no `src` anyway.
This is scope, not an exception: the rule governs the words a reader must
resolve to use the skill, and a citation is a pointer for somebody checking the
claim. It covers the field only. The `why` beside it obeys the rule.

State a skill's occasion as a bare fact instead: *for a plan already made or
work already done*, or *any walk through a plan one decision at a time*. A
skill that couples itself to vocabulary the reader may not have is a skill that
stops working when they do not have it. Why this test and not a narrower one:
[`docs/adr/0001-skills-own-their-vocabulary.md`](docs/adr/0001-skills-own-their-vocabulary.md).

**Changing the export format touches three places.** The page writes it,
`SKILL.md` specifies it, and the agent reads it back. All three in one commit,
or none.

## Adding a new skill

1. Put it at `skills/<name>/SKILL.md`, with a frontmatter `name` and
   `description`.
2. If it ships an `examples/` directory, add a row to
   `scripts/lib/registry.mjs` naming the artifact's file suffix and the
   renderer that owns it. The check fails on such a skill with no row, because
   a gate that quietly does nothing reads as a gate that passed. A prose-only
   skill produces no artifact and needs no row.
3. Bump `version` in `.claude-plugin/plugin.json`. The check fails without it,
   because Claude Code ships an update only when that field moves. It also
   fails when `main` already carries the version you bumped to, which is what
   happens when a sibling branch lands first. Rebase and bump again.

   That second comparison reads the `origin/main` on your disk, so run
   `git fetch origin` first. Without it you are compared against a base that
   may have moved hours ago.
4. Run `node scripts/check.mjs`.

There is no per-skill manifest. The repository is one plugin and every skill
lives under it. A skill nested deeper than `skills/<name>/` needs an explicit
`skills` array in `plugin.json`; the check says so if you try.

Open an issue first if the skill is large. It is easier to agree on scope before
you write ten pages than after.

## Reporting a security problem

Do not open a public issue. See [`SECURITY.md`](SECURITY.md).

## Conduct

By taking part you agree to the
[Code of Conduct](CODE_OF_CONDUCT.md).
