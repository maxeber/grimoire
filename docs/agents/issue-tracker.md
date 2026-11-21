# Issue tracker: GitHub

Issues live on GitHub; specs in force live in `docs/spec/`. Use the `gh` CLI for all operations.

## A vulnerability goes somewhere else

A security finding is reported through GitHub's **private vulnerability
reporting** — the "Report a vulnerability" button under the repository's
Security tab. It reaches the maintainer and nobody else.

Every convention below describes ordinary work. A public issue is the wrong
surface for a vulnerability, and `gh issue create` publishes one, so hand the
finding to the human and let them file it privately. See
[`SECURITY.md`](../../SECURITY.md). Before ruling on security here, read the [threat model](../security/threat-model.md), boundaries first.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v`; `gh` does this automatically in a clone.

## Assign the issue to yourself before you work it

**`gh issue edit <n> --add-assignee @me`, before the first edit to a file.** This
holds for any issue anybody starts work on, not only a `/wayfinder` ticket.

The reason is that the issue is the only place the work is visible. A session
that opens a branch and starts editing has told nobody, so a second session
reads the same open, unassigned issue and starts the same work. An assignee is
what makes an issue look taken.

Assign it first, not at the end. An assignee added when the pull request opens
records history; an assignee added at the start prevents a collision.

**An assignee is a signal, not a lock.** Several agent sessions authenticate as
the same GitHub user here, so `assignees` cannot tell "mine, claimed a minute
ago" from "free to take". Two rules follow, and both matter more than the
assignee field:

- **Name the issue when you start a session.** A session told which issue to
  work never self-selects, so it cannot collide.
- **Treat an issue assigned in the last hour as live.** Ask when the assignment
  happened, not when the issue was made:

  ```bash
  gh api --paginate repos/<owner>/<repo>/issues/<n>/events --jq '.[] | select(.event == "assigned") | {created_at, assignee: .assignee.login, assigner: .assigner.login}'
  ```

  `--paginate` because the endpoint returns thirty events a page, and the
  assignment you care about is the most recent one. On a long-running issue,
  the page you get without it is the oldest thirty events, which is the wrong
  end of the list.

  `gh issue list --json number,createdAt,assignees` cannot answer this. It
  returns the issue's creation time and its current assignees, and those are
  different questions: an issue opened last week and claimed a minute ago looks
  old by `createdAt` and is the one you must not touch. The events endpoint
  carries a timestamp per assignment, so it dates the claim itself.

  Inside that hour, treat the issue as belonging to whoever holds it. Ask that
  session whether it is finished rather than inferring from an idle-looking
  process.

**Unassign yourself when you stop without finishing**, with a comment saying
where you got to. An assignee on abandoned work is worse than none: it reads as
taken forever.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either — resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Cut a spec into tickets: one issue each, linked to the parent

The parent issue keeps the spec. A ticket never lives only as a section of the
parent's body or a comment on it.

- **One issue per ticket, linked as a sub-issue.** When a spec is cut into
  tickets, file each ticket as its own issue and link it to the parent as a
  GitHub sub-issue. The ticket's body names its parent, its claims and what it
  depends on.
- **Link it with `gh api`**, on the parent's `sub_issues` endpoint. The call
  takes the child's numeric **database id**, not its `#number`:

  ```bash
  child_id=$(gh api repos/<owner>/<repo>/issues/<child> --jq .id)
  gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id="$child_id"
  ```

  `-F`, not `-f`, so `gh` sends the id as a number. A parent in another
  repository takes the same call; use that repository's `<owner>/<repo>` and
  the child's id, which is unique across GitHub.
- **A ticket's PR closes its own ticket.** The PR signs and closes the ticket
  issue (`Closes #<ticket>`, or `Closes <owner>/<repo>#<ticket>` for a ticket
  filed in another repository), never the parent. The parent closes when its
  last sub-issue closes: GitHub does not do that for you, so the session that
  merges the last ticket closes the parent with a comment.
- **Tickets that do not depend on each other start in parallel.** Two tickets
  with no dependency between them and no file in common start side by side, one
  session each. The cut says which tickets can run at once; a ticket that
  depends on another waits for it (see Blocking below).

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies** — the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only — the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me` — the session's first write. Same rule as "Assign the issue to yourself before you work it" above, and the same caution: the assignee is a signal, not a lock.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
