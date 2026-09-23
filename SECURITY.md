# Security

## What this project is, in threat terms

`grimoire` is a marketplace of Claude Code skills. A skill is prose plus, in
eagle-eye's case, a renderer: `render.mjs` reads a box file — JSON — and writes
one self-contained HTML page. There is no server, no account and no database.
Node runs the renderer locally, the reader opens the page in a browser, and
neither the renderer nor the page makes a network request.

**One script does send something, and only when somebody runs it.** eagle-eye
ships an optional edge audit, `skills/eagle-eye/audit.mjs`. It posts a box's
text to a model provider, with a key it reads from the environment. What it
sends, when, to whom, and what guards the key are in
[What the edge audit sends](#what-the-edge-audit-sends). Until version 0.20.0
this paragraph said nothing was uploaded anywhere, and that was true.

So the realistic risks are narrow, and worth naming precisely:

- **A box file is input from a stranger.** The point of eagle-eye is that
  people share configurations. A `.box.json` you did not write becomes an HTML
  page you open, and its text lands in the page. That is the main risk in this
  repository.
- **A skill is an instruction file an agent obeys.** Anybody who can change a
  `SKILL.md` here can change what Claude does on a reader's machine. That is
  what branch protection is for, below.
- **A dependency reaching a reader.** The renderer imports node built-in
  modules only, so there is no dependency tree to poison today. That is a fact
  about now, not a guarantee about later.
- **A credential in the environment that a script in the tree reads.**
  `audit.mjs` reads `TYPESAFE_API_KEY` and sends it as a bearer token. A change
  to that script, or to the endpoint it posts to, is a change that could send
  the key somewhere else. A reviewer should read any diff to that file as a
  change to this one.

## What the renderer actually does with box text

Stated with line numbers, because "it escapes things" is not a threat model:

- **`skills/eagle-eye/render.mjs:196` escapes `</` before it writes the box JSON into a
  `<script>` block**, so a `why` string that contains `</script>` cannot close
  the block.
- **`skills/eagle-eye/lib/eagle-eye.js:17` escapes `&` and `<`** before box text reaches
  `innerHTML`. **It does not escape the double quote.** The template calls it at
  `skills/eagle-eye/lib/template.html:270`; `render.mjs` inlines the module into the page,
  so the page and the test run the same function.
- **The six findings escape the same way.** They are built in
  `skills/eagle-eye/lib/eagle-eye.js`, not in the template, and the page assigns their
  text to `innerHTML` at `skills/eagle-eye/lib/template.html:355`. Every row name,
  option name and `why` a finding prints goes through the escape. Until
  version 0.3.5 they did not, and a row name containing a tag reached the page
  as markup.
- **No box text reaches an HTML attribute today.** Every interpolated attribute
  in the template holds an option id, a number, or a fixed class name, and ids
  are validated against `^[a-z0-9][a-z0-9-]*$` at `skills/eagle-eye/render.mjs:41`.
  One attribute is written by the module rather than the template — the tier
  name in `class="tier …"` on the *weakest edge* finding — and the module
  reduces anything that is not `measured`, `sourced` or `argued` to `argued`
  before it writes it. `render.mjs` refuses such a box anyway; the module does
  not lean on that.

Those two facts hold together. The escape is narrow, and it is enough only
because nothing puts box text where a quote would matter. **If somebody adds an
attribute that interpolates a label, a `why`, or a `note`, the escape stops
being enough.** A reviewer should treat any new `="${` in the template as a
change to this file.

**Both escapes are now covered by tests, and the tests pin the width rather
than only the behaviour.** [`tests/esc.test.mjs`](tests/esc.test.mjs) asserts
that `&` and `<` are escaped **and** that the double quote passes through, so
widening the escape and narrowing it back are each a visible test change rather
than a silent one. [`tests/render.test.mjs`](tests/render.test.mjs) renders a
box whose `why` carries `</script><script>…</script>`, and asserts the payload
reaches the page with the slash escaped and closes no script block. The escape
lives in `lib/eagle-eye.js`, and not beside the markup that calls it, for
exactly this reason: a function inside a 49 KB template is a function no test
can reach.

An earlier version of this file recorded the opposite — "No test covers the
escape function" — which was true when it was written and is the reason the
tests exist.

`tests/esc.test.mjs` also runs one box whose row names, option names and `why`
all carry `<img …>`, fires all six findings on it, and asserts that none of
them writes the tag and that the names still appear as text. That test is at
the module and not at the command line, because the findings are built in the
browser: the payload never reaches the file `render.mjs` writes, and
`--check` strips every tag before it prints.

**What the tests do not cover.** They exercise the escape and the text the
findings build, not the `innerHTML` calls that consume it. A test that asserted
"no box text reaches an attribute" would need to parse the rendered page, and
nothing here does that yet. That claim is still read by a reviewer, not by a
machine.

## What the groundtrack renderer does with author text

The same pairing, stated again rather than inherited in silence. groundtrack
has a field the incumbent has not got — a node's `loc`, which is a path or a
URL — and a URL is the thing most likely to be reached for as an attribute.

The page shows a great deal more author text than the incumbent does:
expressions, step remarks, effect descriptions, error messages, run blurbs,
layer tokens, file paths and their reasons, ambient value names, run input
names, and a node's location. All of it is a stranger's text.

- **`skills/groundtrack/scripts/render.mjs` escapes `</` before it writes the
  flightpath JSON into a `<script>` block**, so no author string can close the
  block.
- **`skills/groundtrack/scripts/groundtrack.js` escapes `&` and `<`** before
  author text reaches `innerHTML`. **It does not escape the double quote.** The
  module lives apart from the markup that calls it so a test can reach it, and
  `render.mjs` inlines it into the page, so the page and the test run the same
  function.
- **Author text goes into element content, never into an attribute.** Every
  interpolated attribute on the page holds a node id, an index, a fixed class
  name, or one of the page's own fixed help strings — the `data-help` text the
  page's tooltip reads off the channel keys, the holds and the stamps, which
  is written in the template and never comes from the file. The tooltip sets
  it as text content, never as markup.
- **Ids are validated rather than escaped.** A node id that does not match
  `^[A-Za-z0-9][A-Za-z0-9-]*$` is refused by the validator, so an id reaching
  an attribute is a known-safe string by the time the page sees it.

**Three rules follow, and they are a decision rather than a note.**

1. Author text goes into element content, never into an attribute.
2. **If an attribute must ever carry author text, the narrow escape does not
   cover it.** A URL wants percent-encoding, which is what
   `scripts/build-pages.mjs` already uses for the one `href` it writes.
   Widening the shared escape to cover the double quote instead is a change to
   this file, and is reviewed as one.
3. **Nothing out of the file is safe as an object key, ids included.** Use
   `Groundtrack.bare()` — `Object.create(null)` — for any map keyed by text a
   flightpath file supplies, and `Object.hasOwn` where a membership test is
   what is wanted.
   **A parsed file is hardened at the boundary**: `Groundtrack.hardenKeys`
   rebuilds `nodes`, `env`, `layers`, a layer's `nodes` and a run's `input`
   with no prototype, because `JSON.parse` builds those and builds them plain.
   Both the renderer and the page call it on the file before asking it
   anything.

**The third rule is here because the first two invite the opposite
conclusion.** *Ids are validated rather than escaped* is true, and validation
is genuinely what makes an id safe **in an attribute**. It says nothing about
keys, and there validation buys nothing:
`^[A-Za-z0-9][A-Za-z0-9-]*$` admits `constructor`, `toString`, `valueOf`,
`hasOwnProperty` and `isPrototypeOf`. Only `__proto__` fails, and only over its
underscore. Labels, file paths, failure tags, run names and layer tokens are
not validated at all. **"Validated" means attribute-safe, not key-safe** — two
different properties wearing one word.

A plain `{}` inherits from `Object.prototype`, so a key nobody set still
answers. `t[k] || fallback` never falls back; `t[k] === undefined` never
guards. Neither throws where it happens, so the damage surfaces elsewhere. The
worked example is not a crash but a **wrong diagnosis**: a `goto` naming a
label no step carries is refused as *to "nowhere" is not a label in greet*,
pointing at the step — but spell the same missing label `constructor` and the
"is not a label" check silently passes, and the file is refused twice as *no
edge from 4 (goto) to 6*, pointing at the walks. The author is told their walk
is wrong when their node is wrong.

This is worth a rule rather than a fix alone because it recurred: three
separate changes in one afternoon each introduced or inherited an instance,
and one of them was written by someone who had just read the paragraph above
and concluded ids were safe.

`tests/groundtrack-fold.test.mjs` and `tests/groundtrack-render.test.mjs` pin
it, with fixtures whose field **is** the bare name — `src/constructor` and
`constructor.ts` are ordinary keys and reproduce nothing, so a fixture that
decorates the name passes while testing nothing.

**The tests pin the width and the reference count.**
[`tests/groundtrack-fold.test.mjs`](tests/groundtrack-fold.test.mjs) asserts
that `&` and `<` are escaped **and** that the double quote passes through.
[`tests/groundtrack-render.test.mjs`](tests/groundtrack-render.test.mjs)
renders a file that carries `<`, `&`, a double quote and a closing script tag
in **every** author-written field the page shows — one field left out of that
fixture is one field with no coverage — and asserts the page still closes no
block. It also pins the page's external reference count at **zero**: no link,
no external `src` or `href`, no `@import`, no `fetch`, and six `@font-face`
rules whose sources are inlined data URIs. The faces are vendored under
`skills/groundtrack/assets/` for that reason; a font served from a content
delivery network is a dependency on somebody else's uptime.

**What the tests do not cover.** The same limit as above. Proving "no author
text reaches an attribute" needs a parse of the rendered page, and nothing here
parses one. What is machine-checked is the narrower shape: no `esc(...)` call
appears inside an attribute value in the template. The full claim is still read
by a reviewer, and a new `="${` there is a change to this file.

## What the edge audit sends

eagle-eye's step 4 checks every `argued` edge against eight weakness patterns.
`skills/eagle-eye/audit.mjs` can do a first pass: it asks a small decision
model, Jev from TypeSafe, eight yes/no questions per edge, and ranks the edges
for rereading. It is the only file in this repository that opens a connection,
and it is opt-in twice over.

- **When.** Only when somebody runs it with a box path and a key in the
  environment. The skill tells the agent to probe for a key, offer the audit in
  one sentence that says the box's text leaves the machine, and run it only on
  a yes. Nothing else in the tree calls it: not the renderer, not the page, not
  `scripts/check.mjs`, not CI. **The test suite never reaches the network.** It
  runs the script against a fake bound to `127.0.0.1` in the test process, and
  clears any real key from the child's environment first.
- **What.** One `POST` per argued edge, and one per shuffled control, to
  `https://api.typesafe.ai/v1/systemone`. Each body carries the box's
  `problem`; the edge's `why` and the relation it claims; and, for both of its
  options, the label, the row name and question, the option's own `why`,
  `notes` and `src`. Nothing else from the disk is read into a request.
  `--dry-run` prints one body and sends nothing, so a reader can see exactly
  this before any of it leaves. It also states how many requests a real run
  sends, their rough size, and that each is charged to the key; the skill's
  offer repeats all three. It names no price: the provider sets the price and
  can change it, and a count stays true. A real run ends by saying how many
  requests the service received and which model version answered them.
- **To whom.** TypeSafe. What the provider does with the text is its policy,
  not this repository's. A box holds whatever its author wrote into it, so do
  not audit a box whose text you would not send.
- **The key.** Read from `TYPESAFE_API_KEY` and nowhere else: not a flag, not a
  file. It is never printed and never written. With no key the script sends
  nothing, exits `3` and prints how to set one: the variable, the two places a
  key persists across sessions, that a project `.env` is not read, and never
  to paste the key into a chat. The skill tells the agent to pass those steps
  on, only when the user asks for the audit, and never to ask for the key or
  write it into a file. A key typed into a chat lands in the transcript. `--probe` answers
  `yes` or `no`, never the value, and opens no connection. The tests hold all
  four, with a fake key they look for in every stream.
- **The override.** `EAGLE_EYE_AUDIT_ENDPOINT` exists so the tests can point
  the script at the fake. Whatever URL it names receives the key and the box
  text, so it accepts only an address in `127.0.0.0/8`, or `::1`. Not the name
  `localhost`, which a hosts file can point anywhere. It is checked before the
  key is read. Anything else exits `5` with nothing read and
  nothing sent.
- **No cache.** Nothing from a response is written to disk, except the
  `--json` ranking a user asks for. Every run asks for every edge again, so a
  second run is charged again. A cache used to live under the system temporary
  directory; it went because the model alias it keyed on moves (#106). Whether
  one should come back is #107.
- **What it cannot change.** It never writes the box file, and a test compares
  the bytes before and after. A score never moves a tier, because `measured`
  means somebody ran something and a probability ran nothing.
- **What it refuses.** The request and response shapes are pinned in the
  script against the provider's documented HTTP contract. A response without
  an `answers` field, with an answer that is not a probability, or naming no
  model, is refused with a message and exit `4`, never guessed at. So is a
  run whose answers name two models, because its scores do not compare
  (#104). A network error or a `5xx` is retried once; a second one fails the
  same way.

**The provider's name appears in that script and nowhere else under
`skills/`.** The prose says *the model provider*. Why code may name a service
and prose may not is argued in
[`docs/adr/0001-skills-own-their-vocabulary.md`](docs/adr/0001-skills-own-their-vocabulary.md).

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** — the "Report a
vulnerability" button under this repository's Security tab. It goes to the
maintainer and nobody else.

Do not open a public issue for anything above, or for anything that would let a
crafted box file run script in a reader's browser or change what an agent does.

This is a personal project maintained by one person. There is no SLA and no
bounty. What you will get is an honest answer and, if the finding is real, a
fix and a line in this file that records it.

## Scope

**In scope:** anything in this repository — both manifests, every `SKILL.md`,
the renderer, the template, the edge audit, the check scripts, and the CI
workflows.

**Out of scope:** Claude Code itself, your own box files and what you choose to
put in them, and wherever you host a page the renderer wrote.

## What the platform is relied on for

Some of this project's defence is a GitHub setting rather than a file in this
repository, and that distinction matters more than it looks:

| | |
| --- | --- |
| Dependabot alerts | vulnerabilities in the dependency tree |
| Dependabot security updates | a pull request per alert with an available patch |
| Dependabot malware alerts | a dependency found to be malicious, not merely vulnerable |
| CodeQL (default setup) | static analysis of the JavaScript, including `lib/template.html` |
| Private vulnerability reporting | the channel this file points at |
| Branch protection on `main` | pull request required, `check` must pass, no bypass |
| `skillspector` as a required status check | a SkillSpector finding blocking a merge, rather than being merged over |
| `zizmor` as a required status check | a workflow-security finding blocking a merge, rather than being merged over |
| Pages, built from Actions | what the `pages` workflow deploys to a public URL |

One line of dependency defence is **in** the tree and does go red:
[`.github/dependabot.yml`](.github/dependabot.yml) asks for weekly
`github-actions` updates. Version updates are that file; **security** updates
are the setting above. Both exist, and they are not the same thing.

**Nothing in this repository can check that any of them is switched on.** They
live in repository settings, outside the tree, so a clone cannot read them. This
section is a statement of what the project **relies on**, not a claim about what
is currently true. If you are auditing this repo and that distinction matters to
you, check the settings themselves; the file cannot tell you.

**CodeQL is enabled, and the first version of this file argued that it should
not be.** That argument counted one `.mjs` file and one `.js` file and called
the finding rate too low to justify a check. It was wrong, and the way it was
wrong is worth recording. CodeQL's JavaScript extractor processes `.html`, and
`lib/template.html` holds about 49 KB of inline script — every `innerHTML` sink
in this project, and the `esc` function above. The one place in this repository
where a scanner has something to say is the one place the argument did not
count.

**It is not a required check yet.** A check that blocks on an untriaged ratio is
one people learn to route around.

**Its first scan raised two alerts, both `js/incomplete-multi-character-
sanitization`, both rated high, and both the same one-line function copied into
two files.** `strip` removed HTML tags from an option label in one pass, at
`render.mjs:161` and `lib/template.html:485`. Here is the triage, because "we
fixed it" tells an auditor nothing:

- **The output never reaches HTML.** `strip` feeds a Markdown export that lands
  in a `<textarea>` `.value` and the clipboard, and a console line. Neither is
  an HTML sink, so no bypass of it becomes script.
- **A bypass is hard to build against this regex anyway.** `<[^>]+>` matches
  from the first `<` to the first `>`, so a nested `<scr<script>ipt>` is
  consumed whole rather than reassembled into a tag.
- **It was fixed regardless**, because the safe form is one line: repeat the
  replacement until the string stops changing. `scripts/check.mjs` fails if the
  single-pass form returns.

So: a real pattern, not a reachable vulnerability, fixed and guarded. **CodeQL
did not flag the sink this file was most worried about** — the `esc` function
and the five `innerHTML` calls above. That is worth knowing. A clean scan there
is not evidence the escape is right; it is evidence the query set had nothing
to say about it.

**Every action is pinned to a commit SHA**, with a version-shaped comment beside
it. The pins were resolved from the GitHub API at the time of writing, not from
memory.

**An earlier version of this paragraph said no check here holds whether the
comment is true. One does now.** That `3d3c42e…` really is `v7.0.1` of
`actions/checkout` is a fact living at GitHub and actions have no lockfile, so a
hand-edit swapping in a different valid SHA under an unchanged comment used to
pass. zizmor's `ref-version-mismatch` resolves the SHA at GitHub and reports the
mismatch, and the section below gates on it. It is an **online** audit: measured
on a workflow whose comment was deliberately wrong, it fires with a token and
fires at no persona offline. That is why the workflow passes one.

What is still not held: whether a SHA that matches its comment points at code
worth trusting. A pin is a statement about identity, not about content.

## The skill prose is scanned, and the scan gates

CodeQL reads the JavaScript. Nothing read the prose, which is the part of this
repository an agent obeys — the risk this file opens with.
[SkillSpector](https://github.com/NVIDIA/SkillSpector) does, and
[`.github/workflows/skillspector.yml`](.github/workflows/skillspector.yml) runs
it on every pull request and every push to `main`.

**Pinned to `b7241089d7ec15d8b30df980dacbb428214732b9`, which is `v2.11.0` in
the `NVIDIA` repository.** The owner is part of the pin: a fork of this scanner
exists elsewhere. The pin is a commit, matching the convention every `uses:`
line here follows — and unlike those, **Dependabot does not watch it.** Its
`github-actions` ecosystem reads `uses:` lines and the scanner arrives through
a `run:` line, and there is no pip manifest to read instead. So this pin rots
silently and a bump is a reviewed pull request. The workflow says so in a
comment.

**A finding fails the build, at any severity.** Not the scanner's exit code and
not its risk score. Both answer "should I install this whole skill" against a
fifty-point threshold, and this was measured rather than assumed: a file
carrying an instruction override and a credential read was added to the skill
tree during triage, the scanner found both and rated them high, and it exited
`0` — two findings across thirty files score 42. An advisory check would have
shipped that green, which is the failure this repository already wrote a commit
about. [`scripts/skillspector-gate.mjs`](scripts/skillspector-gate.mjs) reads
the report's `issues` array instead, and
[`tests/skillspector-gate.test.mjs`](tests/skillspector-gate.test.mjs) drives it
with reports written by hand — one per rule it applies, including the shapes it
refuses to judge. **A scan that errored, did not complete, or read only part of
the tree fails as well**, because a broken scan must not read as a clean one.

**Incompleteness is read from the counts, not from the report's own
`is_complete` flag**, and that is a trade worth stating. The scanner downgrades
a run to `partial` when its reference pass meets a relative link it did not
follow, and this file and `CONTRIBUTING.md` are full of those. Gating on the
flag would make the workflow red on arrival for a reason that is not "the
scanner missed something". So the gate fails on a component left unscanned, a
file read partly or not at all, an exception recorded while reading, an
execution the scanner does not call successful, or a status of `failed` — and a
`partial` run with every count clean passes with the status printed. On the
first CI run the scanner reported the analysis complete, so the `partial` path
has been reasoned about and not yet observed. The three semantic analyzers skip
with a logged warning under `--no-llm`, and that skip does not make the run
partial.

**Static analysis only.** `--no-llm`: patterns, AST and YARA, no model call, no
API key, no login, no secret in the workflow. The semantic pass — which
compares a skill's behaviour against its stated purpose, and is arguably the
failure this repository could actually ship — needs a provider credential and
is a separate decision nobody has taken.

**Seven rules were baselined first, and every finding from them is wrong.** The numbers
move, and watching them move is the point. Triage counted fifteen findings from
six rules at an earlier commit. The first run of this workflow counted
twenty-two from five, on a tree that had grown a workflow, two baselines, a gate
script, its tests and this section:

```text
by rule: AR2×7, AS3×6, MP3×1, RA2×2, RP1×6
```

`AR2` went from one to seven, and the six new ones are this section and the
comments around it — prose about anti-refusal reads to a pattern matcher exactly
like anti-refusal. `EA2` fired at triage and does not fire here; its entry stays,
because the `why` text it matched is unchanged and a scan rooted at the skill
may still see it. **An entry that suppresses nothing today costs a line and
keeps an argument that was made once.**

**Then a seventh rule arrived.** The `groundtrack` skill vendors three weights of
IBM Plex Mono, the SIL Open Font Licence requires its text to travel beside them,
and `EA3` reads the warranty disclaimer's *not limited to* as scope creep. It
turned the gate red on a legal text nobody here is allowed to reword, and it cost
one entry with a reason — which is the paragraph below working rather than a hole
in it. `AS3` lost one over the same stretch. The tally on `main` at the time of
writing:

```text
by rule: AR2×7, AS3×5, EA3×2, MP3×1, RA2×2, RP1×6
```

**Then the edge audit brought three more, and two of them are right.** A
script that reads a key and posts a box's text to a model provider is exactly
what this scanner exists to see, and it saw it. `E1` fires on the endpoint in
`audit.mjs` and on its quotation in this file: data does leave for that URL, on
purpose, after a yes, as [What the edge audit sends](#what-the-edge-audit-sends)
states. `LP3` fires only when the skill directory is scanned on its own: the
skill declares no permission list, and a permission list is one host's format
that the portable skill text does not carry. Both are **accepted rather than
reasoned away**, and their reasons say so. The third, `PE3`, is wrong: it reads
the string `.env` in the setup message that tells a user a project `.env` is
*not* read. Measured with the pinned scanner on this branch, at the root:

```text
by rule: AR2×7, AS3×7, E1×2, EA3×5, MP3×1, PE3×4, RA2×2, RP1×6
```

So: **the counts drift as prose is edited, and the rule identifiers do not.**
That is the whole case for keying the baseline on the rule rather than on the
text a fingerprint would bind to. A new rule cannot appear quietly — it fails
the build, and costs one more entry below with a written reason, never a
rewording. The gate prints the tally on every run, so drift is visible in the
log rather than discovered later.
[`.skillspector-baseline.yaml`](.skillspector-baseline.yaml) suppresses the
ten by rule identifier, with a reason per entry:

| Rule | | Why it is suppressed |
| --- | --- | --- |
| `AR2` | Anti-Refusal Statement | `SKILL.md` tells the agent that a preview pane may render the page without script, so do not judge it from one. It adds a caveat; it does not suppress one. |
| `AS3` | Skill Enumeration | A `README.md` line naming the one skill this repository ships, and the decision records quoting it. Naming your own product is not enumerating somebody else's. |
| `EA2` | Autonomous Decision Making | The `why` text on an edge in the example box file. It is content the renderer prints for a reader. |
| `EA3` | Scope Creep | The warranty disclaimer of the SIL Open Font Licence, which ships beside `groundtrack`'s vendored font faces. A legal text the licence requires us to carry verbatim, not an instruction an agent obeys, and its wording is not ours to change. |
| `MP3` | Memory Manipulation | A comment in the page template describing how **Reset** discards the reader's overrides and **Undo** offers them back. It documents a button. |
| `RA2` | Session Persistence | The `CONTRIBUTING.md` rule forbidding a fixed path inside a skill, and the test proving that rule fires. A guard and its test, reported as the risk they prevent. |
| `RP1` | Unpinned MCP server | The `README.md` install command and quotations of it. `skills` is the Vercel Labs installer run through `npx`, not an MCP server. |
| `PE3` | Credential Access | The string `.env` in the edge audit's setup message and its test, which tell a user a project `.env` is **not** read. The script reads its key from the environment only. |
| `E1` | External Transmission | **Not a false positive; accepted.** The edge audit posts a box's text to the model provider's endpoint, only when run with a key after a yes. See [What the edge audit sends](#what-the-edge-audit-sends). |
| `LP3` | MCP Least Privilege | **Accepted.** The skill declares no permission list, because that list is one host's format and the skill text runs in agents that read none. Fires only on a scan of the skill directory. |

**Keyed by rule identifier and not by fingerprint**, which is a trade stated
rather than hidden. A fingerprint is bound to the text it was taken from and
reactivates whenever that text or the scanner version changes; on prose this
repository rewrites constantly it would expire without telling anybody. A rule
key survives a rewording, and it also suppresses that rule everywhere. The
reasons above are what that breadth is paid for with.

**Nothing was reworded to satisfy a pattern matcher.** Two of these findings sit
on a security rule in `CONTRIBUTING.md` and on the test that proves it works.
Letting a regex edit that prose is the trap, and refusing it is a decision.

**There is one baseline file per scannable directory, so three.** The scanner
finds a baseline only at the top of the directory it was pointed at, and a
reader scanning a skill is pointed at the skill. So
[`skills/eagle-eye/.skillspector-baseline.yaml`](skills/eagle-eye/.skillspector-baseline.yaml)
repeats the seven rules that fire inside it, and
[`skills/groundtrack/.skillspector-baseline.yaml`](skills/groundtrack/.skillspector-baseline.yaml)
the one that fires inside it. `node scripts/check.mjs` fails when a skill file
disagrees with the root — same rule, same words, same scope — so a suppression
cannot be argued one way in one file and another way in another. What that check
does not hold is that every skill has a file of its own: it fails when `skills/`
carries no baseline at all, not when one skill under it is missing one.

**Scanning this repository yourself gets the reasons, not silence.** With no
flags the scanner reports the unchanged score and tells you a baseline was
shipped; `--use-shipped-baseline` applies it, and `--show-suppressed` lists
every suppression with the reason above beside it. Opting in stays your choice,
which is why publishing one costs no honesty.

**The Security tab gets the findings and not the suppressions, because GitHub
does not read a suppression.** A second scan writes SARIF, and a push to `main`
uploads it. SkillSpector keeps a baselined finding in that file and marks it
`suppressions: [{kind: "external", justification: <the reason>}]`, which is what
SARIF says a consumer should exclude from its counts. GitHub code scanning does
not act on the property — it is absent from the supported-properties page — and
this was measured rather than inferred: fetching the uploaded report back from
the analyses API shows GitHub had **stored** it, re-serialised as
`{"state": "accepted"}`, beside an alert it opened anyway. **Twenty-three alerts
sat open, every one of them a rule
[`.skillspector-baseline.yaml`](.skillspector-baseline.yaml) argues away by
name, while every run of the workflow was green.** A tab full of findings this
project has
already reasoned about is a tab nobody reads.

So [`scripts/skillspector-strip-suppressed.mjs`](scripts/skillspector-strip-suppressed.mjs)
drops the suppressed results between the scan and the upload, and
[`tests/skillspector-strip-suppressed.test.mjs`](tests/skillspector-strip-suppressed.test.mjs)
drives it with reports written by hand. It removes results and nothing else: the
rule and artifact arrays are referenced by index from the results that stay, so
renumbering them would point a kept finding at the wrong rule. **It never drops
what it cannot read** — a result it cannot judge is kept and printed, because a
silent removal is the one mistake it can make — and a report it cannot parse
fails the step. The upload runs even when the strip left nothing, because an
empty `results` array under an unchanged `category` is exactly what marks the
last upload's alerts fixed. **The reasons are still published**, in the baseline
above and under `--show-suppressed`; what changed is that they are no longer
published as unresolved alerts.

**SkillSpector also reaches this repository through CodeRabbit**, which ran
2.8.2 against pull request 9. That finding arrived inside a collapsed block
while the check reported `pass`, and that run cannot be configured, baselined,
or made to fail anything. It is outside this repository's control and is not
what the table above relies on.

## The workflows are audited, and the audit gates

The section above scans the prose this repository ships. This one scans the
thing that runs it. **Scope, at the top of this file, puts the CI workflows in
by name, and until [`.github/workflows/zizmor.yml`](.github/workflows/zizmor.yml)
existed nothing in the tree audited them.**

[zizmor](https://docs.zizmor.sh) already reached this repository from outside.
It found `artipacked` on all three checkouts that existed then, and that finding
arrived inside a CodeRabbit review whose status check reported `pass` beside the
words *"Review skipped: automatic reviews are disabled"*. One of the three was
fixed in the pull request that added `skillspector.yml`; **the other two were
still open when this section was written**, which is why the table below has two
`artipacked` rows and not three. That run cannot be configured, cannot be
baselined, and cannot fail anything. **A check that reports and changes nothing
reads as a check that passed.** This one is a gate.

**Pinned to `zizmor==1.30.0`, and that is a weaker pin than the one beside
it.** SkillSpector installs from a git commit, so its pin names exact bytes.
zizmor is Rust and reaches PyPI as a prebuilt wheel: a git install would need a
Rust toolchain on the runner, and hash-pinning the wheel needs a requirements
file, which is the dependency manifest this tree refuses. A PyPI version cannot
be re-uploaded under the same number, so this is close to a content pin and is
not one. Like SkillSpector's, **Dependabot does not watch it** — the scanner
arrives through a `run:` line, not a `uses:` line — so it rots silently and a
bump is a reviewed pull request.

**An official action exists and is not used.** `zizmorcore/zizmor-action` was
published after the issue that asked for this said none was documented. It
defaults to `version: latest`, it uploads SARIF unconditionally — which fails on
a fork pull request, where the token is read-only — and its `version:` input is
an action input, so Dependabot would not watch the scanner version through it
either. The one thing a `uses:` line would buy is the one it does not buy.

**A finding fails the build, at any severity, at the default persona.** Same
rule as the SkillSpector gate beside it, for the same reason: a severity floor
is a number to defend at every review. The gate is shell rather than a Node
script, and **that difference is the whole reason the other one is a script.**
SkillSpector's exit code answers "should I install this whole skill", against a
risk-score threshold that once shipped a real finding as a `0`. zizmor's exit
code answers exactly the question a pull request asks, and answers it precisely
— a documented code per highest severity. Reading a report to rediscover it
would be machinery with no measured reason behind it.

**A broken audit fails too, and there is no `|| true`.** `1` is an error during
the audit, including an input path that is not there; `2` is a bad argument;
`3` is a path that exists and collects no workflow. All three are named and all
three go red. The last is the one worth having: it is the shape of a gate that
quietly checks nothing.

**`--strict-collection`, because the default is that exact failure in its
quietest form.** Measured: a workflow zizmor cannot parse is reported as a
warning on stderr, dropped from the run, and the files beside it are audited
normally — so four good workflows next to one broken one print *"No findings to
report. Good job!"* and exit `0`. **A file nobody audited must not read as a
file with nothing wrong.** With the flag the same tree exits `1`. This is the
same rule the SkillSpector gate applies when it reads the scan's coverage counts
rather than trusting a clean-looking report, arrived at from the other end.

**The audit runs online, with the job's own `contents: read` token.** That is a
decision with a measured payoff, and it is the opposite direction from the
change that removed the persisted credential from the SkillSpector job's working
tree. The two are not the same credential and not the same risk. That change
stopped a token being written into `.git/config`, where a scanner pointed at the
whole tree would read it as a file. This one hands a token to a scanner through
an environment variable, on purpose, to do public API reads:

- **`ref-version-mismatch` is online-only, and it closes the gap named above.**
  Measured on a workflow whose version comment was deliberately wrong: it fires
  online at the default persona, and at no persona offline.
- **`unpinned-uses` is not lost offline**, which the issue that asked for this
  expected it to be. Measured on a workflow carrying `actions/checkout@v4`: it
  fires at high offline and online alike. Only its auto-fix needs the network,
  because writing the SHA in means resolving the tag first.
- **Going online moves one severity downward.** `artipacked` is medium offline
  and low online on this same tree. It changes nothing, because the gate fails
  on a finding at any severity.
- **The cost is a dependency on the GitHub API.** An outage exits `1`, and the
  gate reports that as an errored audit rather than a clean one. An honest red,
  and a re-run.

**What it audits, and what it cannot see.** It reads `.github/workflows/` and
nothing else. Rooted at the repository instead, it also collects
`.github/dependabot.yml` and raises `dependabot-cooldown` — an opinion about how
long to wait before taking a dependency update, which is a policy decision
nobody here has taken. It reads workflow definitions statically: it cannot see
what `scripts/check.mjs` or `scripts/build-pages.mjs` do once a `run:` step
starts them, it cannot see a repository setting, and it does not know whether a
correctly-pinned action is worth trusting.

**No configuration file exists, and no `# zizmor: ignore` comment appears
anywhere**, because there is nothing to suppress. zizmor reads its configuration
from `zizmor.yml` at the repository root or from `.github/zizmor.yml`, and
neither is present. Measured on this tree at this version: the default persona
reports no finding at all.

**`.github/workflows/zizmor.yml` shares that name and is not that file.** It is
the workflow, named after the tool the way `skillspector.yml` is. Config
discovery is anchored at the repository root rather than at the directory passed
as input — measured with `-v`, which reports no config candidates and then
registers the file as a workflow input and audits it like any other.

That absence is load-bearing. **zizmor has no per-entry reason field** — a
suppression would carry its argument only as a YAML comment the tool never
reads, and no check here could require one, which is the opposite of what
`.skillspector-baseline.yaml` gets for the same job. If a suppression is ever
needed, `scripts/check.mjs` has to grow the rule that every entry carries a
reason, the way it already holds the two SkillSpector baselines to the same
words. That cost is stated here before it is paid, and it is not paid yet.

**What the audit changed on arrival.** Four findings on the tree it was pointed
at, and all four were fixed rather than suppressed:

| Finding | Where | What was done |
| --- | --- | --- |
| `artipacked` | `check.yml` | `persist-credentials: false`. Every git command it runs is a local read of an already-fetched history, and `fetch-depth: 0` puts `origin/main` on disk before any later step needs it. |
| `artipacked` | `pages.yml` | `persist-credentials: false`. No step after the checkout talks to git. |
| `excessive-permissions` | `pages.yml` | `pages: write` moved off the workflow and onto the `deploy` job. |
| `excessive-permissions` | `pages.yml` | `id-token: write`, the same way. |

The permissions move is worth stating plainly, because the issue that asked for
this put narrowing permissions out of scope on the ground that **nobody had
measured what each job actually needs**. zizmor measured it, and these were the
only *high* findings in the tree. Nothing the `deploy` job can do changed. The
`build` job lost two grants it never used and keeps `pages: read`, which is what
`actions/configure-pages` needs for the `GET /repos/{owner}/{repo}/pages` it
makes — its `enablement` input defaults to `false`, so it takes the read path
and never the create path.

**The default persona, and the pedantic delta measured rather than guessed.**
`--persona=pedantic` adds twelve findings, all style: five informational
`anonymous-definition` for unnamed jobs, four low `undocumented-permissions`,
three low `concurrency-limits`. `--persona=auditor` finds nothing pedantic does
not. Adopting them is a decision about workflow style that nobody has taken, and
one of them asks for a behaviour change — a concurrency group cancels runs in
flight.

**actionlint is deliberately not adopted.** It checks workflow syntax and shell,
and that class of error fails loudly on its own when the workflow runs. No
`${{ }}` appears inside any `run:` block in this tree, which is the finding both
tools would catch and the one that would actually matter, so what actionlint
would add today is shellcheck over a handful of short blocks. That is the
linting `CONTRIBUTING.md` argues against installing a dependency for. If a
`${{ }}` ever lands in a `run:`, reopen it.

## What is deliberately not defended against

Stated plainly, because a threat model that claims everything is defended is not
a threat model:

- **A box file you chose to open.** The renderer runs on your machine, on a file
  you pointed it at. The escape above is the guard, and this file states its
  exact width. A box file from somebody you do not trust deserves a read first.
- **A skill you chose to install.** Installing a plugin means an agent reads its
  prose and acts on it. That is the product working as intended. Read a skill
  before you install it, here or anywhere.
- **What the provider does with a box you chose to audit.** The audit sends the
  text listed above, and only after a yes. Past that point the text is under
  the provider's policy. This repository cannot see or change it.
- **A malicious maintainer account.** Branch protection raises the cost of a bad
  commit. It does not survive a stolen account with admin rights.
- ~~**The one request the page makes when you open it.**~~ **Closed.** This
  entry used to say that "self-contained" meant every line of script and style
  was in the file, but not "makes no network request" — because every page
  linked one Google Fonts stylesheet, and so opening a page told Google you had
  opened it. The generated `site/index.html` linked the same stylesheet, so the
  landing page every visitor hits made the request too.

  **It is now literally no network request.** The faces are vendored — IBM's
  own IBM Plex Mono subsets, unmodified, under the SIL Open Font Licence — and
  inlined into every page as `data:` URIs. Both skills carry their own copy
  next to their template, and the index reads the same files. See
  `skills/groundtrack/assets/FONTS.md` and `skills/eagle-eye/assets/FONTS.md`
  for why they are IBM's cuts rather than ones we made.

  The tests moved with it, and widened while they were being rewritten.
  `tests/render.test.mjs`, `tests/groundtrack-render.test.mjs` and
  `tests/build-pages.test.mjs` each now assert **zero** external references,
  and each reads more than the old pair did: `src` and `href` anywhere rather
  than only on a `script`, `link` or `img`, plus a CSS `@import`, a `url()`,
  and `XMLHttpRequest` / `WebSocket` / `EventSource` / `sendBeacon`. An
  `iframe` with a `src` is caught by the `src` rule. They bound what the page
  **loads on its own**; a link the reader clicks is not that, and the index
  carries one to GitHub, named explicitly in the test rather than exempted by
  a wildcard.
