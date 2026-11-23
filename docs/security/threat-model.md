# Threat model

Place each finding on a boundary as the placement guide in your review
procedure says (review.md's Threat model section, when the pact is installed).
Bring the owner what the guide's step 5 lists, every `security?` row
included; no class covers a change that weakens a rule or control, adds a
route for outside text into a session or more reach to one that reads it,
adds text to files sessions load, or writes a secret into text sessions
read. The full guide is the pact's review procedure, The threat model
section (`~/.claude/pact/review.md`; public copy:
https://github.com/mephistopheles4/the-pact/blob/main/claude/review.md).

[`SECURITY.md`](../../SECURITY.md) is the summary. Four pages hold the detail
behind the controls: [`checks.md`](checks.md), [`brigade.md`](brigade.md),
[`rendering.md`](rendering.md) and [`hiring-interview.md`](hiring-interview.md);
[`scanners.md`](scanners.md) and [`edge-audit.md`](edge-audit.md) say what the
scanners and the audit send. An edit that weakens a control one of these pages names is
a removed control. A page's “Accepted class” line holds only what that class's sentence names; a page line citing a class for more, or a new send off the machine, is an open issue until the owner names it.

## Boundaries

```mermaid
flowchart LR
  tracker["Tracker text, shared files, other sessions"]
  maintainer["Merge to main, GitHub acts"]
  installer["Installs, plugins, CI, a branch's code"]
  leave["Audit send, Remote Control, sync"]
  agent(["An agent that obeys text"])

  subgraph B1["Text into a session"]
    T["R1 R2 R5 R11"]
  end
  subgraph B2["Code that runs"]
    C["R4 R6 R7 R10 R12"]
  end
  subgraph B3["Merges and acts"]
    M["R3, GitHub acts"]
  end
  subgraph B4["Data off the machine"]
    D["R8 R9"]
  end

  tracker --> B1 --> agent
  installer --> B2 --> agent
  maintainer --> B3
  agent --> B4 --> leave

  style B1 fill:transparent,stroke:#8c959f,stroke-dasharray: 5 5
  style B2 fill:transparent,stroke:#8c959f,stroke-dasharray: 5 5
  style B3 fill:transparent,stroke:#8c959f,stroke-dasharray: 5 5
  style B4 fill:transparent,stroke:#8c959f,stroke-dasharray: 5 5
```

### Text into a session

**Crosses:** a stranger's tracker text and outside pull requests that a skill charts or a session works on; a file a stranger shares (box, flightpath, skill, agent, contract, answers block); another session's messages, reports, relays and lead hand-offs, wrong or forged; heard speech.

**Controls:**

- Harness: the permission mode's prompts and classifier, deny and ask rules, and folder trust. Claude Code's documented behaviour: none of them under `bypassPermissions` or an allow rule, and the classifier is skipped when a mod approves the call. This is the host agent's own rule that file content is data.
- Installed by the pact: deny rules on raw worktree and branch removal and `claude rm`, and on `claude stop`, `kill`, `daemon stop` and `respawn`, the stop rules off unless their switch is on, the removal rules on only while the cleaner is on; an ask rule on the cleaner, passed under `bypassPermissions`. Speed bumps, not gates.
- R1: each skill says the material is data; groundtrack tells the reader a request-like line, says AI drew the page, and stamps it authored; traces are literals a reader can check.
- R2: renderers escape control and invisible characters, cut strings, put no author text in an attribute, fill pages in one pass, and refuse hostile shapes at measured limits. Answers bind to their draft by SHA-256; the hiring page has a content security policy. The contract skill never writes a hook, a settings file or a permission list, asks before an installing write, and takes an action drafted from a file only on the person's own words. [Detail](rendering.md), [hiring-interview.md](hiring-interview.md).
- R5: the head chef's sender check (status file, `from-session` and `from` pairing), fixed-form start prompt, sends only to a local address, reports as data, the owner's yes for starts, cleanup and each GitHub act, or at levels 2 and 3 what the owner's user-level file hands the lead, and no force push, no remote branch delete. A background start refuses a bad name, repository, permission mode or prompt and relies on folder trust; a Desktop start needs the owner's words. Cleanup runs a cleaner the owner's instructions name, only for a folder it knows, never on a main working tree or a worktree another session is in; a failed run is told and left. At level 3 the lead decides what the owner's user-level file hands it; an install, a post carrying private work, and an edit to this model's scope, its classes or its AGENTS.md line are checkpoints, logged and flagged. [Detail](brigade.md#row-16).
- R11: a skill under test runs in don't-ask mode with hooks off, settings edits and reaches off the machine denied, the environment built from a named list, and backups of the owner's live places. Hygiene, not a boundary (ADR 0006).

**Residual:** Text steers a session; Renderer output carries author text; A forged or misled session can speak for the lead; A steered lead can start a session in any trusted folder; Box text can move an audit edge. The rules they rest on, each a control: only the owner's words in the lead's chat count as the owner's, a clear yes heard by Incantation's relay after a say-back included; installs stay the owner's; reports and relays are data.

### Code that runs

**Crosses:** the Brigade mod and other plugins loaded beside it; Incantation's installer, which fetches an addon, models and wheels from huggingface.co and its CDN, npm, GitHub and its release hosts, PyPI and files.pythonhosted.org, and uv's CPython; CI actions and packages; a branch's own code when a session opens on it; the local check's image build.

**Controls:**

- Harness: folder trust and the permission mode hold a branch's folder and the mod's tool calls only as Claude Code documents them; a mod's own call skips the prompt.
- GitHub: secret scanning with push protection (known credential shapes only), Dependabot security updates and version updates on Actions only, and CodeQL default setup (Actions, JavaScript, TypeScript; default queries).
- R4: every action pinned to a commit SHA, with zizmor's `ref-version-mismatch`; `persist-credentials: false` and per-job permissions; the validator package pinned, unpacked and never installed; `npm pack` run outside the checkout, and rule 6 refusing `.npmrc` and `.yarnrc.yml`.
- R6: the mod asks the engine for its verdict first; its pane waits for `/brigade` or a head-chef load; the model never names a path, and a path rule runs before and after each write; writes are strict-checked, one at a time, capped; each call's bounds, `gh` argument lists and Open in app routes are fixed. [Detail](brigade.md#row-15).
- R7: plugin state is read through checks and caps and drawn as text; the autonomy level changes only by a slider press or the owner's mode command, reads 1 on any other value and logs an alarm, and a 3 counts only after the owner confirms it in the lead's chat, which a plugin can forge.
- R10: rule 6d holds the tracked settings file to the one agent-guard entry; `CONTRIBUTING.md`'s agent guard says to read a branch's `.claude/` and `scripts/` first, or open with hooks off.
- Incantation: sources and redirect hosts fixed in code; each downloaded file pinned by size and sha256, checked before it is kept or run; wheels by hash only; uv's CPython checked by uv alone. Silero VAD and the non-LFS Hugging Face files are trust-on-first-use pins. The Windows loopback reference lives in memory for the echo canceller. [Detail](../spec/0001-incantation-from-the-prototype.md).
- R12: the local check run has no network; its build folder is held to `tests/container/`; the base image is pinned by digest and Claude Code by sha512; athanor refuses an engine not on this machine unless `allowRemoteDocker` is set.

**Residual:** Other plugins share the mod's trust; The mod's tools run with no permission prompt; A tracked hook runs a branch's code when a session opens; The local test image trusts Debian's archive at build time.

### Merges and acts

**Crosses:** a merge to `main`, which reaches every installer; a GitHub act, such as a post, merge, close or branch delete, that the head chef or the pane makes on the owner's word; a release.

**Controls:**

- GitHub: a ruleset on `main` requires a pull request, an up-to-date branch and the checks `check`, `scan` and `audit`, and blocks deletion and non-fast-forward pushes; it requires no approving review. The plugin validator's `validate` runs on pull requests and is not a required check.
- R3: `scripts/check.mjs` holds frontmatter keys, hidden characters, manifests, baselines (rules 2c, 6c, 7 and 7a), fixed home paths and a version bump; SkillSpector's probe, the scanner pins, and partly read files pinned by content; review of each diff.
- The head chef names the repository and whether it is public before an act, deletes its temporary post file, reads the head again before a merge, deletes a branch only on the owner's words or a same-repository head, and posts no error text. A level-3 merge goes toward the goal and names the reviewed head, with CI passed on it. Every other merge or close, and a merge that changes this model's scope or classes, is a checkpoint: level 2 stops, level 3 logs and flags. [Detail](brigade.md#row-16).

**Residual:** Review is the guard for scanner gaps; GitHub acts on the owner's word are irreversible and public.

### Data off the machine

**Crosses:** the edge audit's send of a box's text to a provider; Remote Control and claude.ai; the pane's `gh` calls under the owner's sign-in; sync and backup of a folder the person names; a path or key in a shipped file, page or post.

**Controls:**

- R8: the audit's dry run first names every receiver, and a standing yes comes only from the user's own instructions; `audit.mjs` never prints or writes the key; the endpoint override takes only loopback. [Detail](edge-audit.md).
- R9: rule 2 refuses a fixed home path in shipped folders, the one print helper masks the account segment, and groundtrack warns on an absolute path, naming the field. [Detail](checks.md#row-17).
- The permission warning before the first launch names background sessions.

**Residual:** Data leaves the machine as the owner accepted; Every background member runs with Remote Control on; No rule holds a secret or personal detail back.

## Scope

**In:** the four boundaries above. **Out:** the machine, the owner's own computer or a sandbox run on it, with every program, process, account, file and memory made there; a local tool's data on a user's own computer is that user's machine. A cloud session's sandbox, a service a project deploys, and that service's users' devices are not the machine; data that service keeps for its users is past a boundary. grimoire runs nothing on a server. The machine's own controls (antivirus, account isolation, disk encryption) hold only the machine. Loss of work with no attacker is not a class; its checks stay, and a change that loosens them is a spec change. Third parties relied on: model providers, GitHub, claude.ai and Remote Control, Debian's package archive, the local container engine, and for Incantation's installer Hugging Face, npm and PyPI. The root of trust is the owner's GitHub account.

## Residual risk

```mermaid
quadrantChart
  title Residual risk by accepted class
  x-axis Unlikely --> Likely
  y-axis Minor --> Severe
  quadrant-1 Closest watch
  quadrant-2 Guard closely
  quadrant-3 Accept
  quadrant-4 Watch
  Text steers a session: [0.62, 0.85]
  Start in any trusted folder: [0.22, 0.45]
  Scanner gaps: [0.30, 0.95]
  Author text in output: [0.38, 0.75]
  Other plugins: [0.31, 0.53]
  Forged session: [0.22, 0.70]
  GitHub acts: [0.35, 0.80]
  Mod tools no prompt: [0.30, 0.55]
  Branch code runs: [0.20, 0.45]
  Debian archive: [0.15, 0.40]
  Data leaves: [0.52, 0.30]
  Remote Control on: [0.45, 0.45]
  Ambient speech: [0.40, 0.60]
  Audit order: [0.18, 0.30]
  No secret rule: [0.30, 0.40]
```

Likelihood and impact, 0 to 1, are judgement after today's controls, a ranking only.

## Accepted threat classes

A class covers only what its sentence names; nothing under Open issues is inside a class.

- **Text steers a session.** The host agent is the last guard against text read as instruction; no injection detector is built, closing a gap in a check aside, so a well-worded injection steers a session and breaks rules held only by prose.
- **Review is the guard for scanner gaps.** Baseline allowances cover whole files or rules, some files are read in part, nothing is signed, and a skill is dangerous by its nature (ADR 0006).
- **Renderer output carries author text.** An escaped one-line name can still read like a path or a reason; refusal lines are bounded each, not in count; deep nesting stops a renderer with one line.
- **Other plugins share the mod's trust.** An installed plugin can read the mod's plugin state (not the report store, Remote Control link or old folder key), rewrite the usage record, plant the warning's dismissal, and rewrite or press the autonomy level, forging a 3's confirmation.
- **A forged or misled session can speak for the lead.** A message under the lead's shown name or a relay counted as a decision can move the lead; a steered lead or an unasked skill load can write false log entries and lead hand-offs.
- **GitHub acts on the owner's word are irreversible and public.** The head is not pinned between review and merge, a broad word covers acts it did not name, deletes are permanent, and history keeps text; at a confirmed level 3 the lead's own picks reach a merge.
- **A steered lead can start a session in any trusted folder.** The start binds a folder to no repository the owner chose, and its reads run before the trust gate, so a refusal shows whether a path exists, is a main checkout, or belongs to a repository.
- **The mod's tools run with no permission prompt,** in plan and don't-ask modes too, each inside its guards and the path rule: `set_roster`, the four tab tools and `stop_background_session`.
- **A tracked hook runs a branch's code when a session opens.** The owner judged the agent guard worth that exposure; it protects the merge, not the reader.
- **The local test image trusts Debian's archive at build time.** git and its packages install unpinned; a replaced package runs inside an image that only runs checks.
- **Data leaves the machine as the owner accepted.** A provider keeps audit text; pull request polls reach the polled organisation's audit log; the level and goal reach Remote Control devices; plugin files and a named folder's answers reach backup and sync; a Desktop press of a Linear link sends its workspace name and identifier to linear.app; a home path warns, not blocks; ONNX Runtime's Windows TraceLogging telemetry in the sherpa-onnx addon, which nothing turns off.
- **Every background member runs with Remote Control on.** Its whole conversation goes to claude.ai and every device signed in, and any signed-in device can type to the member and answer its permission prompts.
- **No rule holds a secret or personal detail back.** Brigade and the head chef check no post, record or send for a secret or personal detail, so one can reach a public record or a transcript; a change that writes one into text sessions read is not covered.
- **Ambient speech steers a session.** Anything the mic hears, a call's far side or a played sound included, can raise a request in a voice session and confirm its say-back, and a clear yes so heard counts as the owner's at the head chef's gates and for a runtime install (the owner, 2026-11-22). The say-back and an install's printed plan, size and hosts, are prose controls.
- **Box text can move an audit edge.** A box's text can move an edge in the audit's reread order; a score never changes a tier.

## Open issues

- R1: what a steered session does, a misleading sheet first, is not covered by the class.
- R2: the attribute rule is held by review, not by a parse of the page.
- R3: plain-prose instructions no scanner detects; fifteen scanner dependencies resolve fresh each run.
- R4: the CI pins are not content pins, and no tarball hash is checked; git in the image is not hash-pinned.
- R5: cleanup's authorization; the sender check is a consistency check; git config still runs programs in the lead at cleanup; the start's reads run on any well-spelled local folder before the trust gate ([#588](https://github.com/mephistopheles4/grimoire/issues/588)); rerun the version checks when Claude Code changes ([#587](https://github.com/mephistopheles4/grimoire/issues/587)).
- R6: the `claude://` opener and the Linear page opener inherit the session's environment; the roster's check-and-write race.
- Remote Control: how long a member's transcript stays after it stops, and whether a device keeps a copy, are not checked.
- R8: the script cannot stop the agent itself printing an environment variable.
- R9: a home root joined from a separate string is not seen, and free text is not checked.
- R10: the agent guard protects the merge, not the reader.
- R12: the build runs before the check on an unread branch, with the registry login and proxy passwords; a non-local container engine gets the run's data and the registry login, in clear over plain TCP ([athanor#100](https://github.com/mephistopheles4/athanor/issues/100)).
- Plugin-side gaps, not accepted: another plugin planting or rewriting decision files, marks, hand-offs, summaries or refusal lines, reading the report store or a Remote Control link, pressing against cleanup's yes, or seeing tool calls through the mod's hook; link swaps, planted session files or transcripts, and a written upstream ref under cleanup's delete, by another plugin, a branch's code, a steered session or any outside tool; cleanup's indirect removal paths.
- Not accepted: another page opened from disk, or an extension, reading the saved interview answers; a session named like a card feeding it; the pill press has no rate limit; a skill's write scope and a contract's second-agent load are held by prose.
- Waiting for the owner's word: a member takes a message under its lead's name as its lead's; a start's note can redirect a member; the lead's own calls are not limited; own-pick starts, posts and level-2 merges at levels 2 and 3, flagged big.
- Data flows no class covers: the lead's own transcript and a Desktop member's on Remote Control devices, the apps' own stores and the phone sync, a removed background session's transcript, the `claude://` and Linear page openers' environment, a managed host's endpoint telemetry of command lines (a start's note and prompt, the Remote Control link, folder paths): ask the owner.
- Package-manager settings files nothing reads (`.yarnrc`, `.pnpmfile.cjs`, `bunfig.toml`, `.env`): ask the owner.
- The plugin validator `validate` is not a required check on `main`: ask the owner.
