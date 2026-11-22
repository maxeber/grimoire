import type { Card, Pair, PrState, Roster, Status, Todo } from './types'

// What the Brigade pane reads from outside itself, checked before it is drawn
// or used: the roster, the engine's session files, the transcript
// paths the engine reports and the reports other sessions send. Every one is
// text another process wrote, so each is held to a shape, cut to a length and
// shown as text only. Nothing here runs, and nothing here builds a command or
// a path from roster text.
//
// The roster has two users, and both take their rules from here so the two
// cannot drift: the pane, which reads the file, and the set_roster tool, which
// writes it. The shape check, the byte cap and the decision whether a roster
// path may be read or written are each one function below.

export const STATUSES: readonly Status[] = ['working', 'idle', 'done', 'stopped']

/** An older word for `idle` (issue 581). A roster file or a `set_roster` call
 *  that holds it is read as `idle`, and the pane writes `idle`: a lead running
 *  an older skill text still sends it, and rosters already on disk hold it. */
export const OLD_IDLE = 'needs-you'

// The caps a roster is held to. A roster over them is refused with an error in
// the pane rather than drawn in part.
const MAX_CARDS = 50
const MAX_TODOS = 50
const MAX_TITLE = 80
/** The cap on a card's or to-do's text field; the pane draws a wrapped field
 *  whole up to it. */
export const MAX_TEXT = 300
const MAX_ID = 100

// The engine's session ids, and so the roster files' names.
export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// C0 and C1 controls, and the characters that reorder or hide text: every
// default-ignorable code point (the zero-width ones, the variation selectors,
// the tag block, the soft hyphen and the rest), and the bidi marks,
// embeddings, overrides and isolates, some of which are not in that set.
const CONTROL = /[\u{0}-\u{1F}\u{7F}-\u{9F}\u{2028}\u{2029}]/gu
const HIDDEN = /[\p{Default_Ignorable_Code_Point}\u{61C}\u{200E}\u{200F}\u{202A}-\u{202E}\u{2066}-\u{2069}]/gu

/** Text made safe to draw on one line: controls become spaces, hidden
 *  characters go, runs of space fold, and it is cut to `max` with an ellipsis. */
export function oneLine(text: string, max: number): string {
  const flat = text.replace(CONTROL, ' ').replace(HIDDEN, '').replace(/\s+/g, ' ').trim()
  const chars = [...flat]
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : flat
}

type Checked<T> = { value: T } | { error: string }

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

// Own keys only, and only the ones named: a key the shape does not know is a
// typo or a field nobody reads, and either way the file is refused.
function fields(where: string, v: unknown, allowed: readonly string[]): Checked<Record<string, unknown>> {
  if (!isRecord(v)) return { error: `${where} is not an object` }
  const extra = Object.keys(v).filter(k => !allowed.includes(k))
  if (extra.length > 0) return { error: `${where} has a field the roster does not use: ${oneLine(extra[0] ?? '', 40)}` }
  return { value: v }
}

function text(where: string, v: unknown, max: number, required: boolean): Checked<string | undefined> {
  if (v === undefined && !required) return { value: undefined }
  if (typeof v !== 'string') return { error: `${where} is not text` }
  if (required && v.trim() === '') return { error: `${where} is empty` }
  if ([...v].length > max) return { error: `${where} is over ${max} characters` }
  return { value: v }
}

/** Where a roster came from. The file may hold a card's `since`; the tool's
 *  input may not, since the tool stamps it. */
export type Source = 'file' | 'tool'

/** The three states a card's PR can be in, as the card keeps them. */
export const PR_STATES: readonly PrState[] = ['open', 'draft', 'merged', 'closed']

/** A PR number as text: 1 to 7 digits. The tool's schema and the view module take this one pattern. */
export const PR_NUMBER = /^[0-9]{1,7}$/

/** A card's repository, owner/name and nothing else (spec 402, S5.6): the owner
 *  1 to 39 letters, digits and hyphens, not starting with a hyphen; the name 1
 *  to 100 letters, digits, `.`, `_` and `-`, not starting with `.` or `-`, so
 *  never `.` or `..`. The whole value must match, so a host part (a third
 *  segment, or a dotted owner) never passes. The tool's schema takes this one
 *  pattern, and the run builder checks it again. */
export const REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/

/** A to-do's link (issues 560 and 567): an issue or a pull request on github.com,
 *  or a comment on one, as the whole string and nothing else. The owner is
 *  `REPO`'s owner set, the name is `REPO`'s name set (so the Desktop run, which
 *  holds the repository to `REPO`, never refuses an accepted link), and the
 *  number is 1 to 7 digits with no leading zero. Behind an issue or a pull
 *  request comes at most one fragment: `#issuecomment-C` on either; on a pull
 *  request also `#pullrequestreview-C` or `#discussion_rC`. `C` is 1 to 12
 *  digits with no leading zero. The pattern allows `..` in the name; `parseLink`
 *  refuses it after the pattern (the tool's schema, built from
 *  `TODO_LINK.source`, does not). No scheme but https, no other host, no
 *  userinfo, port or query, and no other fragment. The groups are the owner, the
 *  name, then the issue form (3 to 6) and the pull form (7 to 12). */
export const TODO_LINK = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_][A-Za-z0-9._-]{0,99})\/(?:(issues)\/([1-9][0-9]{0,6})(?:#(issuecomment)-([1-9][0-9]{0,11}))?|(pull)\/([1-9][0-9]{0,6})(?:#(issuecomment|pullrequestreview)-([1-9][0-9]{0,11})|#(discussion_r)([1-9][0-9]{0,11}))?)$/

/** A Linear identifier (the-pact#580): a team key of 2 to 10 characters (a capital
 *  letter, then capitals and digits), a hyphen, and a number of 1 to 9 digits
 *  with no leading zero, as the whole string and nothing else. The start tool's
 *  `issue` input and a to-do's `link` both take it. The groups are the key and
 *  the number. */
export const LINEAR_ID = /^([A-Z][A-Z0-9]{1,9})-([1-9][0-9]{0,8})$/

/** What the to-do tool's `link` schema takes: a github.com link (`TODO_LINK`) or a
 *  Linear identifier (`LINEAR_ID`), each anchored on its own, so the whole value
 *  must be one of the two. `parseLink` and `parseLinear` hold the same checks. */
export const TODO_LINK_ANY = `${TODO_LINK.source}|${LINEAR_ID.source}`

/** A Linear workspace's URL slug (the-pact#580), read from the environment and
 *  checked here, case-sensitively: 1 to 64 lower-case letters, digits and
 *  hyphens, not starting with a hyphen. No slash, dot, colon, query or fragment
 *  can pass, so the slug cannot move the address off linear.app or add a path. */
export const LINEAR_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/

/** The longest link the pattern allows is 203 characters (a pull request review
 *  with a 39-character owner, a 100-character name, a 7-digit number and a
 *  12-digit id); the field's cap is a little above it. */
export const MAX_LINK = 210

/** What a link's fragment points at: a comment, a review, or a review comment. */
export type LinkAnchor = { kind: 'comment' | 'review' | 'reviewcomment'; id: string }

/** What a link parses to: the repository, the kind of page, its number, and the
 *  anchor when the link has a fragment. */
export type LinkParts = { repo: string; kind: 'issue' | 'pr'; number: string; anchor?: LinkAnchor }

const ANCHOR_KIND: Record<string, LinkAnchor['kind']> = { issuecomment: 'comment', pullrequestreview: 'review', discussion_r: 'reviewcomment' }
const ANCHOR_WORD: Record<LinkAnchor['kind'], string> = { comment: 'issuecomment-', review: 'pullrequestreview-', reviewcomment: 'discussion_r' }

/** A link's parts, or undefined for anything the pattern does not hold whole. */
export function parseLink(v: unknown): LinkParts | undefined {
  if (typeof v !== 'string' || [...v].length > MAX_LINK) return undefined
  const m = TODO_LINK.exec(v)
  if (m === null) return undefined
  const [, owner, name] = m
  const pr = m[7] !== undefined
  const number = pr ? m[8] : m[4]
  const word = pr ? (m[9] ?? m[11]) : m[5]
  const id = pr ? (m[10] ?? m[12]) : m[6]
  if (owner === undefined || name === undefined || number === undefined || name.includes('..')) return undefined
  const parts: LinkParts = { repo: `${owner}/${name}`, kind: pr ? 'pr' : 'issue', number }
  if (word !== undefined && id !== undefined) {
    const kind = ANCHOR_KIND[word]
    if (kind === undefined) return undefined
    parts.anchor = { kind, id }
  }
  return parts
}

/** The address a link parses to, rebuilt from its parts behind the constant
 *  prefix, the anchor included: the stored string is never what is drawn or passed on. */
export function linkUrl(p: LinkParts): string {
  const base = `https://github.com/${p.repo}/${p.kind === 'pr' ? 'pull' : 'issues'}/${p.number}`
  return p.anchor === undefined ? base : `${base}#${ANCHOR_WORD[p.anchor.kind]}${p.anchor.id}`
}

/** A link's label, from its parts alone: the number, what the link points at
 *  when it has an anchor, then the repository, so the repository is named
 *  wherever the label is drawn. It names no author and holds no id. */
export function linkLabel(p: LinkParts): string {
  const what = p.anchor === undefined ? '' : p.anchor.kind === 'comment' ? 'comment ' : p.anchor.kind === 'review' ? 'review ' : 'review comment '
  return `${p.kind === 'pr' ? 'PR ' : '#'}${p.number} ${what}${p.repo}`
}

/** What a Linear identifier parses to: its team key and its number. */
export type LinearParts = { key: string; number: string }

/** A Linear identifier's parts, or undefined for anything `LINEAR_ID` does not hold whole. */
export function parseLinear(v: unknown): LinearParts | undefined {
  if (typeof v !== 'string') return undefined
  const m = LINEAR_ID.exec(v)
  if (m === null || m[1] === undefined || m[2] === undefined) return undefined
  return { key: m[1], number: m[2] }
}

/** The workspace slug an environment read gave, or undefined for no slug: an unset
 *  variable, a value that is not text and a value `LINEAR_SLUG` does not hold whole. */
export function linearSlug(v: unknown): string | undefined {
  return typeof v === 'string' && LINEAR_SLUG.test(v) ? v : undefined
}

/** A Linear item's page: the constant host, the checked slug and the parsed
 *  identifier, and nothing taken from stored text. Parts that do not pass
 *  `LINEAR_ID` again, or a slug that does not pass `LINEAR_SLUG`, build no address. */
export function linearUrl(p: LinearParts | undefined, slug: unknown): string | undefined {
  if (p === undefined || linearSlug(slug) === undefined || parseLinear(`${p.key}-${p.number}`) === undefined) return undefined
  return `https://linear.app/${slug}/issue/${p.key}-${p.number}`
}

/** A Linear link's label: the identifier alone, with no workspace. */
export function linearLabel(p: LinearParts): string {
  return `${p.key}-${p.number}`
}

/** Whether a value is a whole number from 0 to 2^53 - 1. */
const isWhole = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0

function card(i: number, v: unknown, source: Source): Checked<Card> {
  const where = `card ${i + 1}`
  if (source === 'tool' && isRecord(v) && Object.hasOwn(v, 'since')) {
    return { error: `${where} since is stamped by the pane, not sent by the tool` }
  }
  // `phase` is gone (issue 504): a tool call that holds it is refused in words
  // that say so, and a roster file that holds it loads with the key dropped.
  let given = v
  if (isRecord(v) && Object.hasOwn(v, 'phase')) {
    if (source === 'tool') return { error: 'phase is gone: send the cards without it' }
    const { phase: _dropped, ...rest } = v
    given = rest
  }
  const f = fields(where, given, ['title', 'work', 'settings', 'status', 'desktopId', 'bgId', 'url', 'pr', 'prState', 'repo', 'since'])
  if ('error' in f) return f
  const o = f.value
  const title = text(`${where} title`, o.title, MAX_TITLE, true)
  if ('error' in title) return title
  const out: Card = { title: title.value ?? '', work: '', settings: '', status: 'working' }
  for (const k of ['work', 'settings'] as const) {
    const t = text(`${where} ${k}`, o[k], MAX_TEXT, false)
    if ('error' in t) return t
    out[k] = t.value ?? ''
  }
  if (typeof o.status !== 'string' || !([...STATUSES, OLD_IDLE] as readonly string[]).includes(o.status)) {
    return { error: `${where} status is not one of ${STATUSES.join(', ')}` }
  }
  out.status = o.status === OLD_IDLE ? 'idle' : (o.status as Status)
  for (const k of ['desktopId', 'bgId', 'url'] as const) {
    const t = text(`${where} ${k}`, o[k], MAX_ID, false)
    if ('error' in t) return t
    if (t.value !== undefined) out[k] = t.value
  }
  if (o.pr !== undefined) {
    if (typeof o.pr !== 'string' || !PR_NUMBER.test(o.pr)) return { error: `${where} pr is not 1 to 7 digits` }
    out.pr = o.pr
  }
  if (o.prState !== undefined) {
    if (typeof o.prState !== 'string' || !(PR_STATES as readonly string[]).includes(o.prState)) {
      return { error: `${where} prState is not one of ${PR_STATES.join(', ')}` }
    }
    out.prState = o.prState as PrState
  }
  // Fixed words: the value is never echoed.
  if (o.repo !== undefined) {
    if (typeof o.repo !== 'string' || !REPO.test(o.repo)) return { error: `${where} repo is not a plain owner/name` }
    out.repo = o.repo
  }
  if (o.since !== undefined) {
    if (!isWhole(o.since)) return { error: `${where} since is not a whole number from 0 to ${Number.MAX_SAFE_INTEGER}` }
    out.since = o.since
  }
  return { value: out }
}

function todo(i: number, v: unknown): Checked<Todo> {
  const where = `to-do ${i + 1}`
  const f = fields(where, v, ['id', 'text', 'session', 'link'])
  if ('error' in f) return f
  const id = text(`${where} id`, f.value.id, 40, true)
  if ('error' in id) return id
  const body = text(`${where} text`, f.value.text, MAX_TEXT, true)
  if ('error' in body) return body
  const session = text(`${where} session`, f.value.session, MAX_TITLE, false)
  if ('error' in session) return session
  const out: Todo = { id: id.value ?? '', text: body.value ?? '' }
  if (session.value !== undefined) out.session = session.value
  // Fixed words: the value is never echoed.
  if (f.value.link !== undefined) {
    if (parseLink(f.value.link) === undefined && parseLinear(f.value.link) === undefined) return { error: `${where} link is not a github.com issue, pull request or comment link, or a Linear identifier` }
    out.link = f.value.link as string
  }
  return { value: out }
}

/** The roster's text, checked: `{ cards, todos }` with every field a string
 *  of its length, the status from the fixed set, no title twice and no to-do
 *  id twice. The pane reads a missing list as empty. `strict` requires both
 *  lists, as the writer does of a file it would overwrite: `{}` is then no
 *  roster, so a hard link to some other JSON file is not taken for one. */
export function checkRoster(raw: string, strict = false, source: Source = 'file'): Checked<Roster> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { error: 'the roster is not JSON' }
  }
  const f = fields('the roster', parsed, ['cards', 'todos'])
  if ('error' in f) return f
  if (strict) {
    for (const k of ['cards', 'todos'] as const) {
      if (!Object.hasOwn(f.value, k)) return { error: `the roster has no "${k}" list` }
    }
  }
  const cards = f.value.cards ?? []
  const todos = f.value.todos ?? []
  if (!Array.isArray(cards)) return { error: 'the roster\'s "cards" is not a list' }
  if (!Array.isArray(todos)) return { error: 'the roster\'s "todos" is not a list' }
  if (cards.length > MAX_CARDS) return { error: `the roster has over ${MAX_CARDS} cards` }
  if (todos.length > MAX_TODOS) return { error: `the roster has over ${MAX_TODOS} to-dos` }
  const out: Roster = { cards: [], todos: [] }
  const titles = new Set<string>()
  for (const [i, v] of cards.entries()) {
    const c = card(i, v, source)
    if ('error' in c) return c
    // Compared as drawn, so two titles that differ only in a hidden
    // character cannot pose as one card.
    const drawn = oneLine(c.value.title, MAX_TITLE)
    if (drawn === '') return { error: `card ${i + 1} title is empty once hidden characters go` }
    if (titles.has(drawn)) return { error: `card ${i + 1} repeats the title of an earlier card` }
    titles.add(drawn)
    out.cards.push(c.value)
  }
  const ids = new Set<string>()
  for (const [i, v] of todos.entries()) {
    const t = todo(i, v)
    if ('error' in t) return t
    if (ids.has(t.value.id)) return { error: `to-do ${i + 1} repeats the id of an earlier to-do` }
    ids.add(t.value.id)
    out.todos.push(t.value)
  }
  return { value: out }
}

/** The cap on a roster file, in bytes: the pane reads no larger file, and the
 *  writer saves none. */
export const MAX_ROSTER_BYTES = 256 * 1024

/** A checked roster as the text the writer saves, measured in UTF-8 bytes
 *  against the cap: what is measured is what is written. */
export function serialize(roster: Roster): Checked<string> {
  const text = JSON.stringify(roster)
  const bytes = new TextEncoder().encode(text).length
  return bytes > MAX_ROSTER_BYTES ? { error: `the roster is ${bytes} bytes, over the cap of ${MAX_ROSTER_BYTES}` } : { value: text }
}

// --- the card's age ------------------------------------------------------------
//
// A card's `since` is when it entered its current status. The
// set_roster tool stamps it from the engine clock, inside its queue, and the
// model never sends one. A `since` written to the file by anything else is
// drawn as written.

/** How far ahead of the clock a kept or drawn time may be: 2 minutes. */
export const AHEAD_MS = 120000

/** The cards with `since` set: kept from the previous roster's card of the
 *  same drawn title and status when that value passes the file check
 *  and is at most 2 minutes ahead of the clock, else the clock's answer. A
 *  clock answer that is not a whole number from 0 to 2^53 - 1 refuses. */
export function stampSince(previous: Roster | undefined, cards: readonly Card[], clock: unknown): Checked<Card[]> {
  if (!isWhole(clock)) return { error: 'clock: the engine clock gave no whole number of milliseconds' }
  const before = new Map<string, Card>()
  for (const c of previous?.cards ?? []) before.set(oneLine(c.title, MAX_TITLE), c)
  return {
    value: cards.map(c => {
      const was = before.get(oneLine(c.title, MAX_TITLE))
      const keep = was !== undefined && was.status === c.status && isWhole(was.since) && was.since <= clock + AHEAD_MS
      return { ...c, since: keep ? was.since : clock }
    }),
  }
}

// --- the gh answer ---------------------------------------------------------------
//
// The pane asks `gh pr list` for the brigade's PRs. The output is text another
// process wrote, so it is read as untrusted: held to a size, a count and a
// shape per entry, and kept in a Map keyed by number.

/** The cap on `gh`'s output, in UTF-8 bytes. */
export const MAX_GH_BYTES = 1024 * 1024
const MAX_GH_ENTRIES = 100
const MAX_GH_TITLE = 1000
const MAX_COUNT = 100000000
const MAX_PR = 9999999

/** The argument list the pane's poll runs. No roster text reaches it: a run for
 *  a card's repository passes the checked owner/name as GH_REPO in the run's
 *  environment, never on the command line (`ghRun`). The pill press runs a
 *  second list, `gh pr view <number> --web` (`ghViewRun`), whose one variable
 *  argument is a card's checked pull request number; a to-do pull request link
 *  press (issues 560 and the-pact#580) builds the same list. */
export const GH_ARGV: readonly string[] = [
  'gh',
  'pr',
  'list',
  '--state',
  'all',
  '--limit',
  '100',
  '--json',
  'number,title,state,isDraft,additions,deletions,updatedAt,url,isCrossRepository',
]

/** A `gh` run: the fixed argument list and its options, the 15-second limit
 *  and, for a card's repository, that owner/name as GH_REPO, the only
 *  variable set. The base run, with no repository, sets none. A repository
 *  that fails `REPO` here builds no run. */
export type GhRun = { argv: readonly string[]; init: { timeoutMs: number; env?: { GH_REPO: string } } }
export function ghRun(repo?: unknown): GhRun | undefined {
  if (repo === undefined) return { argv: GH_ARGV, init: { timeoutMs: 15000 } }
  if (typeof repo !== 'string' || !REPO.test(repo)) return undefined
  return { argv: GH_ARGV, init: { timeoutMs: 15000, env: { GH_REPO: repo } } }
}

/** A pill press (issue 513, S2) or a to-do's pull request link press (issues 560
 *  and the-pact#580): the second fixed list, `gh pr view <number> --web`, with the
 *  repository always set as GH_REPO, behind a constant github.com host, and the
 *  same 15-second limit. The repository is the pill's `gh` answer or the to-do
 *  link's parse. The number is on the command line and has passed `PR_NUMBER`
 *  here; the repository has passed `REPO`. Either failing builds no run. The
 *  kind is the one word `pr`: no run opens an issue. */
export function ghViewRun(number: unknown, repo: unknown, kind: unknown = 'pr'): GhRun | undefined {
  if (typeof number !== 'string' || !PR_NUMBER.test(number)) return undefined
  if (typeof repo !== 'string' || !REPO.test(repo)) return undefined
  if (kind !== 'pr') return undefined
  // The host is pinned: gh takes `[HOST/]OWNER/REPO`, so GH_HOST and gh's own
  // default cannot move the page off github.com (the only host an answer draws for).
  return { argv: ['gh', 'pr', 'view', number, '--web'], init: { timeoutMs: 15000, env: { GH_REPO: `github.com/${repo}` } } }
}

/** One PR `gh` answered for, after its checks. `updatedAt` is epoch ms. */
export type GhPr = { number: number; title: string; state: PrState; additions: number; deletions: number; updatedAt: number; repo: string }

const GH_STATES: ReadonlyMap<string, PrState> = new Map([
  ['OPEN', 'open'],
  ['MERGED', 'merged'],
  ['CLOSED', 'closed'],
])
const GH_URL = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100})\/pull\/([0-9]{1,7})$/
const GH_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/

const wholeBetween = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max

/** The PRs `gh pr list` printed, by number. Only an entry of the stated shape
 *  counts, among the first 100; a fork's PR counts as no answer. Output over
 *  1 MiB, or no JSON list, is an error whose words carry none of the output. */
export function parsePrList(stdout: string): Checked<Map<number, GhPr>> {
  if (new TextEncoder().encode(stdout).length > MAX_GH_BYTES) return { error: 'gh printed more than the pane reads' }
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return { error: 'gh printed no JSON' }
  }
  if (!Array.isArray(parsed)) return { error: 'gh printed no list' }
  const out = new Map<number, GhPr>()
  for (const e of parsed.slice(0, MAX_GH_ENTRIES)) {
    if (!isRecord(e)) continue
    const listed = typeof e.state === 'string' ? GH_STATES.get(e.state) : undefined
    // Only an open pull request can be a draft; `isDraft` must be exactly true.
    const state = listed === 'open' && e.isDraft === true ? 'draft' : listed
    const url = typeof e.url === 'string' ? GH_URL.exec(e.url) : null
    if (
      !wholeBetween(e.number, 1, MAX_PR) ||
      typeof e.title !== 'string' ||
      [...e.title].length > MAX_GH_TITLE ||
      state === undefined ||
      !wholeBetween(e.additions, 0, MAX_COUNT) ||
      !wholeBetween(e.deletions, 0, MAX_COUNT) ||
      typeof e.updatedAt !== 'string' ||
      !GH_TIME.test(e.updatedAt) ||
      url === null ||
      Number(url[2]) !== e.number ||
      e.isCrossRepository !== false
    ) {
      continue
    }
    const updatedAt = Date.parse(e.updatedAt)
    if (!Number.isFinite(updatedAt) || out.has(e.number)) continue
    out.set(e.number, { number: e.number, title: oneLine(e.title, 80), state, additions: e.additions, deletions: e.deletions, updatedAt, repo: url[1] ?? '' })
  }
  return { value: out }
}

/** The answer for a named repository: the parsed rows when every one's URL
 *  names that repository, compared in lower case; else undefined, no answer,
 *  since `gh` then answered for some other repository. */
export function answerFor(repo: string, found: ReadonlyMap<number, GhPr>): ReadonlyMap<number, GhPr> | undefined {
  const want = repo.toLowerCase()
  for (const a of found.values()) if (a.repo.toLowerCase() !== want) return undefined
  return found
}

/** The named repositories that run this minute: at most `max` of them, in
 *  sorted order, starting after `last`, the last one run, and wrapping round.
 *  A `last` no card names any more starts at the next name after it. */
export function rotate(repos: readonly string[], last: string | undefined, max: number): string[] {
  const sorted = [...new Set(repos)].sort()
  const from = last === undefined ? 0 : sorted.findIndex(r => r > last)
  const start = from === -1 ? 0 : from
  return [...sorted.slice(start), ...sorted.slice(0, start)].slice(0, max)
}

// --- the roster path ---------------------------------------------------------
//
// Whether a roster path may be read or written, decided from `stat` answers
// alone. The engine offers no write that refuses a link, and a write follows
// one: through a broken file link it creates the link's target, and through a
// hard link it replaces the other file's text. So before each write, and each
// read, every folder from the config folder down is looked at, then the file.
//
// The answers come from the caller, so the rule runs the same against the
// engine and against recorded answers in a test. A `stat` the engine rejects
// reaches a mod as a message alone, with no error code: a missing path's ends
// "failed: ENOENT" (measured on 2.1.292), and only that one means missing.

/** What `$.fs.stat(path, { resolve: true })` answered, as far as the rule
 *  reads it. `isLink` is the path's own; `kind` and `realPath` are where it
 *  leads, `realPath` absent when it leads nowhere. */
export type StatFound = { kind: 'file' | 'dir' | 'other'; size: number; isLink: boolean; realPath?: string }

/** One `stat`: found, missing, or refused for any other reason. */
export type StatAnswer = { found: StatFound } | { missing: true } | { failed: string }

/** A rejected `stat`'s message, sorted: missing only for ENOENT. */
export function statRejection(message: string): StatAnswer {
  return /(?:^|[\s:])ENOENT$/.test(message.trim()) ? { missing: true } : { failed: oneLine(message, 200) }
}

/** Where the file may go: `existing` is the file there now, which a writer
 *  must still find to be its own kind, a roster or a summary, before it
 *  overwrites it. */
export type Placed = { file: string; existing?: { size: number } } | { refused: string }

// The folders below the config folder, in order, for each kind of file the
// mod writes: the lead's roster, and each session's usage summary in a folder
// apart from the rosters. `plugins` is the engine's own and must be there;
// the mod may create the rest.
// The decision log, the owner's marks and the lead hand-off (spec 402) each
// take a folder of their own beside `usage`.
type Place = 'roster' | 'summary' | 'decisions' | 'marks' | 'handoff'
const FOLDERS = (plugin: string, place: Place) =>
  place === 'roster' ? ['plugins', 'data', plugin, 'brigade'] : ['plugins', 'data', plugin, 'brigade', place === 'summary' ? 'usage' : place]

/** A path as the real-path compare reads it: one separator, no trailing one,
 *  and case folded where the file system ignores it. The roster path rule and
 *  the transcript finder's place check both compare by it. */
export const pathKey = (path: string, fold: boolean): string => {
  const flat = path.replace(/[\\/]+/g, '/').replace(/(.)\/$/, '$1')
  return fold ? flat.toLowerCase() : flat
}

/** Whether the file system under this path ignores case: Windows' and,
 *  by its default home and volumes, macOS'. Elsewhere the compare is exact,
 *  which can only refuse more. */
export function foldsCase(path: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|[\\/]{2})/.test(path) || /^\/(?:Users|Volumes)\//.test(path)
}

/** Decides whether this session's roster file under the config folder may be
 *  read or written, asking `stat` (resolving) of each folder on the way and
 *  then of the file.
 *
 *  Refused: a session id or data id not of their shape; a config folder that
 *  does not resolve; `plugins` missing; any folder that is a link, broken or
 *  not, or is not a folder; any `stat` that fails other than as missing, or
 *  finds a path with no real path; any folder whose real path is not the
 *  config folder's real path joined with the same names, which is the
 *  decisive control, since only junctions and file links were measured for
 *  `isLink`; and a file that is a link, is not a plain file, or lands
 *  anywhere but in the checked folder. A missing folder below `plugins` ends
 *  the walk: the write creates it and everything below it. */
export function placeRoster(
  config: string,
  plugin: string,
  sessionId: string,
  stat: (path: string) => Promise<StatAnswer>,
): Promise<Placed> {
  return placeFile(config, plugin, sessionId, stat, 'roster')
}

/** Decides whether this session's usage summary file under the config
 *  folder may be read or written: `placeRoster`'s rule, word for word, with
 *  the walk going one folder further, into `usage`, so a summary never lands
 *  where a roster does. */
export function placeSummary(
  config: string,
  plugin: string,
  sessionId: string,
  stat: (path: string) => Promise<StatAnswer>,
): Promise<Placed> {
  return placeFile(config, plugin, sessionId, stat, 'summary')
}

/** Decides whether a session's decision log file may be read or written:
 *  the same rule, with the walk going into `decisions`. */
export function placeDecisions(config: string, plugin: string, sessionId: string, stat: (path: string) => Promise<StatAnswer>): Promise<Placed> {
  return placeFile(config, plugin, sessionId, stat, 'decisions')
}

/** Decides whether a session's marks file may be read or written: the same
 *  rule, with the walk going into `marks`. */
export function placeMarks(config: string, plugin: string, sessionId: string, stat: (path: string) => Promise<StatAnswer>): Promise<Placed> {
  return placeFile(config, plugin, sessionId, stat, 'marks')
}

/** Decides whether a session's hand-off file may be read or written: the
 *  same rule, with the walk going into `handoff`. */
export function placeHandoff(config: string, plugin: string, sessionId: string, stat: (path: string) => Promise<StatAnswer>): Promise<Placed> {
  return placeFile(config, plugin, sessionId, stat, 'handoff')
}

async function placeFile(
  config: string,
  plugin: string,
  sessionId: string,
  stat: (path: string) => Promise<StatAnswer>,
  place: Place,
): Promise<Placed> {
  const leaf = `${sessionId}.json`
  if (!SESSION_ID.test(sessionId)) return { refused: 'path: the session id is not the engine\'s shape' }
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(plugin)) return { refused: 'path: the plugin\'s data id is not of its shape' }
  const sep = sepOf(config)
  const fold = foldsCase(config)
  const top = await stat(config)
  if (!('found' in top) || top.found.kind !== 'dir' || top.found.realPath === undefined) {
    return { refused: 'path: the config folder does not resolve to a folder' }
  }
  const real = pathKey(top.found.realPath, fold)
  let at = config
  let expected = real
  const folders = FOLDERS(plugin, place)
  for (const name of folders) {
    at = `${at}${sep}${name}`
    expected = `${expected}/${fold ? name.toLowerCase() : name}`
    const s = await stat(at)
    if ('missing' in s) {
      if (name === 'plugins') return { refused: 'path: the config folder has no plugins folder' }
      return { file: `${config}${sep}${folders.join(sep)}${sep}${leaf}` }
    }
    if ('failed' in s) return { refused: `path: ${name} could not be read (${s.failed})` }
    if (s.found.isLink) return { refused: `link: ${name} is a link` }
    if (s.found.kind !== 'dir') return { refused: `path: ${name} is not a folder` }
    if (s.found.realPath === undefined || pathKey(s.found.realPath, fold) !== expected) {
      return { refused: `link: ${name} does not lead where its name says` }
    }
  }
  const file = `${at}${sep}${leaf}`
  const s = await stat(file)
  if ('missing' in s) return { file }
  if ('failed' in s) return { refused: `path: the ${place} file could not be read (${s.failed})` }
  if (s.found.isLink) return { refused: `link: the ${place} file is a link` }
  if (s.found.kind !== 'file') return { refused: `path: the ${place} path is not a plain file` }
  if (s.found.realPath === undefined || pathKey(s.found.realPath, fold) !== `${expected}/${fold ? leaf.toLowerCase() : leaf}`) {
    return { refused: `link: the ${place} file does not lead where its name says` }
  }
  return { file, existing: { size: s.found.size } }
}

// The config folder and the marketplace from where the plugin was installed:
// the engine keeps an installed plugin under
// <config>/plugins/cache/<marketplace>/... or reads it from
// <config>/plugins/marketplaces/<marketplace>. The last such segment wins, so
// a config folder whose own path holds the words still resolves.
const INSTALLED = /^(.+)[\\/]plugins[\\/](?:cache|marketplaces)[\\/]([^\\/]+)(?:[\\/]|$)/

/** The config folder the plugin's own location names, or undefined. */
export function configFromRoot(root: string): string | undefined {
  return INSTALLED.exec(root)?.[1]
}

/** The marketplace the plugin's own location names, or undefined: a plugin
 *  loaded from a folder of its own (`--plugin-dir`) has none. */
export function marketplaceFromRoot(root: string): string | undefined {
  return INSTALLED.exec(root)?.[2]
}

/** The plugin's data folder id, by the plugin-manifest reference's rule: the
 *  identifier `<name>@<marketplace>`, or `<name>@inline` for a plugin loaded
 *  from a folder, with every character but a letter, digit, `_` or `-` made
 *  `-`. */
export function dataId(name: string, marketplace: string | undefined): string {
  return `${name}@${marketplace ?? 'inline'}`.replace(/[^A-Za-z0-9_-]/g, '-')
}

/** The plugin's data folder under a config folder, built from the config
 *  folder alone: `CLAUDE_PLUGIN_DATA` is not read, since a mod's environment
 *  usually lacks it and another plugin can set it. */
export function dataFolder(config: string, id: string): string {
  const sep = sepOf(config)
  return `${config}${sep}plugins${sep}data${sep}${id}`
}

/** The config folder above Desktop's synced install of this plugin:
 *  <config>/plugins/synced/<one folder>/<name>, or the name with `~g` and
 *  digits after it (Desktop keeps such a copy beside it; seen on Windows). Exactly one folder sits between `synced` and the plugin's
 *  folder, which is the last part of the root. It names a config folder only,
 *  never a marketplace. */
export function configFromSynced(root: string, name: string): string | undefined {
  const m = /^(.+)[\\/]plugins[\\/]synced[\\/][^\\/]+[\\/]([^\\/]+)$/.exec(root)
  if (m === null) return undefined
  const tail = m[2].startsWith(`${name}~g`) ? m[2].slice(name.length + 2) : undefined
  return m[2] === name || (tail !== undefined && /^\d+$/.test(tail)) ? m[1] : undefined
}

/** The config folder and the plugin's data id for this session, by one rule
 *  the roster and the usage summary writer share, in order: the config folder
 *  from where the plugin was installed; else from the transcript path the
 *  engine reported at a session's start, whatever session that record holds
 *  (a clear does not change the config folder), when its id is of the
 *  engine's shape, both fields are text and the transcript's file name is its
 *  own id; else from Desktop's synced install folder. `config` is undefined
 *  with none. The data id never takes a marketplace from the synced form. */
export function dataPlace(root: string, name: string, start: { sessionId: string; transcript: string }): { config: string | undefined; plugin: string } {
  const config =
    configFromRoot(root) ??
    (typeof start.sessionId === 'string' && typeof start.transcript === 'string' ? configFromTranscript(start.transcript, start.sessionId) : undefined) ??
    configFromSynced(root, name)
  return { config, plugin: dataId(name, marketplaceFromRoot(root)) }
}

/** The config folder above the engine's transcript path for the given session id:
 *  <config>/projects/<folder>/<session id>.jsonl, or undefined. */
export function configFromTranscript(transcript: string, sessionId: string): string | undefined {
  if (!SESSION_ID.test(sessionId)) return undefined
  const m = /^(.+)[\\/]projects[\\/][^\\/]+[\\/]([^\\/]+)\.jsonl$/.exec(transcript)
  return m !== null && m[2] === sessionId ? m[1] : undefined
}

/** The separator a folder's own path uses: `\` if it holds one, else `/`. */
export const sepOf = (dir: string): string => (dir.includes('\\') ? '\\' : '/')

/** The roster file of one lead session in the plugin's data folder, named by
 *  its checked session id. */
export function rosterFile(data: string, sessionId: string): string {
  const sep = sepOf(data)
  return `${data}${sep}brigade${sep}${sessionId}.json`
}

/** A running session, as far as the pane uses it: its name, its live state
 *  (`busy`, `idle`, `waiting`; a background session's `state` when it has no
 *  `status`), its session id and its folder. Besides those, for matching a
 *  card and for the groups only: the Desktop id, the job id, the waiting
 *  reason and the update time, each kept only
 *  in its fixed shape. None of them is ever stored. */
export type SessionRow = {
  name: string
  status: string
  sessionId?: string
  cwd?: string
  hostId?: string
  jobId?: string
  waitingFor?: string
  updatedAt?: number
}

// The shapes the fields keep: a Desktop id as the link route takes it, a job
// id of letters, digits and dashes, and fixed words for the rest.
const HOST_ID = /^local_[0-9a-f-]{1,80}$/
// The job id as the engine writes it (probed on 2.1.302): 8 hex digits.
const JOB_ID = /^[0-9a-f]{8}$/
const WAITING_REASONS: ReadonlySet<string> = new Set(['permission prompt', 'input needed', 'sandbox request', 'worker request', 'goal proposal', 'dialog open'])

/** One of the engine's session files, `<config>/sessions/<pid>.json`, as a
 *  row: the name, the status (`?` while a new session has none yet), the
 *  session id and the folder, and for matching and grouping the Desktop id,
 *  job id, background state, waiting reason and update time. Every other
 *  field the engine writes there (its messaging socket, bridge id, process
 *  start, former names) is never taken. A file that is not one JSON object,
 *  or has no name of at most 300 characters or no session id of the engine's
 *  shape, gives none; the status is cut to one line of 20 characters, a
 *  folder over 1,000 characters is dropped, and a field outside its shape is
 *  dropped with the row kept. */
export function sessionRow(text: string): SessionRow | undefined {
  let r: unknown
  try {
    r = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isRecord(r) || typeof r.name !== 'string' || r.name === '' || r.name.length > MAX_TEXT) return undefined
  if (typeof r.sessionId !== 'string' || !SESSION_ID.test(r.sessionId)) return undefined
  const state = typeof r.status === 'string' ? r.status : typeof r.state === 'string' ? r.state : undefined
  const row: SessionRow = { name: r.name, status: state === undefined ? '?' : oneLine(state, 20), sessionId: r.sessionId }
  if (typeof r.cwd === 'string' && r.cwd.length <= 1000) row.cwd = r.cwd
  if (typeof r.hostSessionId === 'string' && HOST_ID.test(r.hostSessionId)) row.hostId = r.hostSessionId
  if (typeof r.jobId === 'string' && JOB_ID.test(r.jobId)) row.jobId = r.jobId
  if (typeof r.waitingFor === 'string' && WAITING_REASONS.has(r.waitingFor)) row.waitingFor = r.waitingFor
  if (typeof r.statusUpdatedAt === 'number' && Number.isFinite(r.statusUpdatedAt)) row.updatedAt = r.statusUpdatedAt
  return row
}

/** What the poll does to a working card: `waiting` moves it to Waiting on you;
 *  `idle` keeps it under Working with the idle look. */
export type Move = 'waiting' | 'idle'

/** Each card's rows at one poll, by card title: a card with a Desktop id takes
 *  the one row holding it, and falls back to its title only when no file
 *  carries any Desktop id; else a card with a bg id takes the row with that
 *  job id; else the card matches by title. Two rows with one id: the later
 *  update time wins and one with a time beats one without. A card with
 *  several rows left (two sessions sharing a name, or sharing an id with no
 *  usable time) gets all of them, as the title match always did, so the poll
 *  draws it as shared. An update time more than 2 minutes ahead of `now`
 *  (the engine clock, when it answered) is no usable time, so a file that
 *  writes itself a far-future time does not win. A card with no row has no
 *  entry. */
export function matchRows(cards: readonly Card[], rows: readonly SessionRow[], now = Number.NaN): Map<string, SessionRow[]> {
  const out = new Map<string, SessionRow[]>()
  const anyHost = rows.some(r => r.hostId !== undefined)
  const byTitle = (title: string): SessionRow[] => rows.filter(r => r.name === title)
  const byId = (same: SessionRow[]): SessionRow[] => {
    if (same.length <= 1) return same
    const timed = same.filter(r => r.updatedAt !== undefined && !(r.updatedAt > now + AHEAD_MS))
    if (timed.length === 0) return same
    const best = Math.max(...timed.map(r => r.updatedAt ?? 0))
    const top = timed.filter(r => r.updatedAt === best)
    return top.length === 1 ? top : same
  }
  for (const c of cards) {
    let found: SessionRow[]
    if (c.desktopId !== undefined) {
      found = anyHost ? byId(rows.filter(r => r.hostId === c.desktopId)) : byTitle(c.title)
    } else if (c.bgId !== undefined) {
      found = byId(rows.filter(r => r.jobId === c.bgId))
    } else {
      found = byTitle(c.title)
    }
    if (found.length > 0) out.set(c.title, found)
  }
  return out
}

/** Where the pane moves a card, or undefined for no move: only a card the
 *  head chef marked `working` moves, to `waiting` while its session's status
 *  is `waiting` (a permission prompt or input), or to `idle` while it is
 *  `idle` (no turn running). Any other status gives no move. The head chef's
 *  idle, done and stopped always hold. The pane takes no background
 *  `state` from a session file (a real one carries none, and a forged one
 *  must not move a card; see #370). */
export function rowMove(status: string, row: SessionRow | undefined): Move | undefined {
  if (status !== 'working' || row === undefined) return undefined
  if (row.status === 'waiting') return 'waiting'
  return row.status === 'idle' ? 'idle' : undefined
}

/** A row's live word, at most 40 characters: `waiting · <reason>` for a
 *  waiting session with a reason, `busy` for a shell, else its status. */
export function liveWord(row: SessionRow): string {
  if (row.status === 'shell') return 'busy'
  if (row.status === 'waiting' && row.waitingFor !== undefined) return oneLine(`waiting · ${row.waitingFor}`, 40)
  return oneLine(row.status, 40)
}

/** The projects folder name of a working directory: every separator, colon
 *  and dot made a dash, which leaves no separator in it. */
export const projectFolder = (cwd: string): string => cwd.replace(/[:\\/.]/g, '-')

// A Remote Control session's link, whole.
const WEB_LINK = /^https:\/\/claude\.ai\/code\/session_[A-Za-z0-9]{1,80}$/

/** A Remote Control session's link from its transcript, or undefined: only
 *  from a row the engine itself writes when Remote Control starts, a system
 *  row of subtype `bridge_status` carrying `url`, the last one in the file.
 *  A link quoted in a prompt, a brief or a relayed message sits inside another
 *  row's text and is never read. */
export function remoteLink(transcript: string): string | undefined {
  let found: string | undefined
  for (const line of transcript.split('\n')) {
    if (!line.includes('"bridge_status"')) continue
    let row: unknown
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (isRecord(row) && row.type === 'system' && row.subtype === 'bridge_status' && typeof row.url === 'string' && WEB_LINK.test(row.url)) {
      found = row.url
    }
  }
  return found
}

// A Desktop session's local id, whole: the one shape both routes of Open in
// app take from a card.
const DESKTOP_ID = /^local_[0-9a-f-]{1,80}$/

/** The app's own link to a card's session, of one of the two known shapes,
 *  or undefined: a Desktop session by its local id, or a Remote Control
 *  session by its claude.ai path under the app's scheme. */
export function appLink(c: Card, found: string | undefined): string | undefined {
  if (c.desktopId !== undefined && DESKTOP_ID.test(c.desktopId)) {
    return `claude://claude.ai/epitaxy/${c.desktopId}`
  }
  const web = c.url ?? found
  return web !== undefined && WEB_LINK.test(web)
    ? `claude://claude.ai/code/${web.slice('https://claude.ai/code/'.length)}`
    : undefined
}

/** The host systems the link route has an opener for. */
export type HostOs = 'windows' | 'macos' | 'linux'

// The link route's programs. Windows' is looked up by name, as measured in
// `docs/security/brigade.md` row 15. The other two are absolute, root-owned on a normal
// install, so neither the user's PATH nor the project folder can supply a
// stand-in for the opener itself. On Linux the opener then starts its desktop
// helper, or a fallback browser, by name on the inherited PATH, from the
// session's working folder.
export const EXPLORER = 'explorer.exe'
export const MAC_OPEN = '/usr/bin/open'
export const XDG_OPEN = '/usr/bin/xdg-open'

/** The command the link route runs on a host: its program and the link, as
 *  one argument with no shell. The link is always one of `appLink`'s two
 *  shapes, so it never starts with `-`. */
export function openerArgv(os: HostOs, link: string): string[] {
  return [os === 'windows' ? EXPLORER : os === 'macos' ? MAC_OPEN : XDG_OPEN, link]
}

/** Whether a probe's real path, exactly as the engine returned it, is a Unix
 *  one: one `/`, then a character that is not a separator, and no `\`
 *  anywhere. A Windows real path carries a drive letter or a share root
 *  (`\\server\…`), so it fails. Never pass it through a separator helper
 *  first: one that folds `\\server` to `//server` would let a share pass. */
export function unixRealPath(path: string): boolean {
  return /^\/[^\\/]/.test(path) && !path.includes('\\')
}

/** The files that prove a Unix host, in order: macOS' own version file, which
 *  System Integrity Protection guards, then Linux's opener itself. */
export const HOST_PROBES = [
  ['macos', '/System/Library/CoreServices/SystemVersion.plist'],
  ['linux', XDG_OPEN],
] as const

/** Whether one of Windows' own environment names, read on its own, names a
 *  Windows host: `OS` is `Windows_NT`, or `SystemRoot` or `windir` is set.
 *  Callers read them in that order and stop at the first that does, so a
 *  later read that fails cannot undo a known answer. Windows is known by its
 *  environment only, never by a file: on Windows an absolute Unix path
 *  resolves under the drive's root, where any local user can plant it. */
export function windowsEnv(name: 'OS' | 'SystemRoot' | 'windir', value: unknown): boolean {
  return name === 'OS' ? value === 'Windows_NT' : value !== undefined
}

/** What one probe's `stat` answer says about the host: its Unix host, `next`
 *  when the probe file is missing so the next probe is asked, or undefined
 *  for no host. A Unix answer needs the probe to be a file whose raw real
 *  path is a Unix one; any other answer, a failed read included, is no host. */
export function probeHost(os: 'macos' | 'linux', s: StatAnswer): HostOs | 'next' | undefined {
  if ('missing' in s) return 'next'
  if ('failed' in s || s.found.kind !== 'file' || s.found.realPath === undefined) return undefined
  return unixRealPath(s.found.realPath) ? os : undefined
}

// Open in app through the Desktop app's own tool, which shows a session this
// lead started beside it. The tool, its server and the target are constants:
// no roster text names any of them, and only a checked Desktop id is sent.
export const OPEN_TOOL = 'mcp__ccd_window__open_session_in'
export const OPEN_SERVER = 'ccd_window'
export const OPEN_NAME = 'open_session_in'
export const OPEN_TARGET = 'split'
export const OPEN_WAIT_MS = 5000
export const OPENED = 'Opened in the app.'
export const NOT_OPENED = 'The app did not open it: '

/** The session id a press asks the Desktop app's tool to show, or undefined
 *  when the card takes the link route alone: only a Desktop id of the checked
 *  shape. A background card, a Remote Control link or any other text in the
 *  card never reaches the tool. */
export function toolSession(c: Card): string | undefined {
  return c.desktopId !== undefined && DESKTOP_ID.test(c.desktopId) ? c.desktopId : undefined
}

/** Whether the engine lists the Desktop app's tool by exactly its name. The
 *  owner's rules are matched on that name, so the press asks about no other;
 *  the terminal lists none. The list is read as untrusted. */
export function listsOpenTool(tools: unknown): boolean {
  return Array.isArray(tools) && tools.some(t => isRecord(t) && t.name === OPEN_TOOL)
}

/** Whether the owner's rules let a press call the tool, from the engine's
 *  verdict, read as untrusted: `allow`, or an `ask` that names no rule, which
 *  is a mode's; and an organisation's ceiling, where the engine reports one, of
 *  `allow`. A `deny`, an `ask` naming a rule, a lower ceiling or anything else
 *  keeps the press on the link route. */
export function rulesAllowTool(verdict: unknown): boolean {
  if (!isRecord(verdict)) return false
  if (verdict.ceiling !== undefined && verdict.ceiling !== 'allow') return false
  if (verdict.decision === 'allow') return true
  return verdict.decision === 'ask' && verdict.rule === undefined
}

// The first line of a text block, made safe to draw and cut to the pane's
// one-line length. The line is taken before cleaning, which folds breaks.
const firstLine = (text: string) => oneLine(text.split(/\r\n|[\n\r\u{2028}\u{2029}]/u)[0] ?? '', 200)

/** What the Desktop app's answer means, read as untrusted, since another
 *  plugin can answer in the app's place. Exactly one of three outcomes:
 *  opened with the answer's first line to show; opened with no text, shown as
 *  a fixed line; or not opened, with the app's own reason when it gave one as
 *  text. Nothing in it throws. */
export function readOpenAnswer(answer: unknown): { opened: true; toast: string } | { opened: false; reason?: string } {
  try {
    if (!isRecord(answer) || !Array.isArray(answer.content) || typeof answer.isError !== 'boolean') return { opened: false }
    const first: unknown = answer.content[0]
    const text = isRecord(first) && first.type === 'text' && typeof first.text === 'string' ? firstLine(first.text) : ''
    if (answer.isError === false) return { opened: true, toast: text === '' ? OPENED : text }
    return text === '' ? { opened: false } : { opened: false, reason: `${NOT_OPENED}${text}` }
  } catch {
    // A field that throws when read is not an answer.
    return { opened: false }
  }
}

// The wrapper the engine puts round a message from another session. Only a
// wrapper that opens the delivery counts, so a body quoting one names nobody.
const WRAPPER = /^\s*<cross-session-message\s+from="([^"]{1,200})"[^>]*>/

/** A report's claimed sender and its first line of text, both made safe to
 *  draw. The sender is the wrapper's claim, never a credential. */
export function report(raw: string): { from: string; line: string } {
  const m = WRAPPER.exec(raw)
  const body = (m === null ? raw : raw.slice(m[0].length)).replace(/<\/cross-session-message>\s*$/, '')
  const line = body.split('\n').find(l => l.trim() !== '') ?? ''
  return { from: oneLine(m?.[1] ?? 'a session', MAX_TITLE), line: oneLine(line, 200) }
}

/** A lookup over pairs that never reaches a prototype: a Map, built per read. */
export const lookup = (pairs: readonly Pair[]) => new Map(pairs.map(p => [p.name, p.value]))

// --- a head-chef load where the security default is seated (#380) -----------
//
// Where a user plugin's skill.prompt hook never runs, a head-chef load is seen
// through the call around it. These say whether that load ran, and whether
// the session's local skill listing shows the loaded copy is ours.

/** A typed load ran only when core answered it with its `ref`: a hook that
 *  answers the command in core's place expanded no skill. */
export function typedLoadRan(answer: unknown): boolean {
  return isRecord(answer) && !('deny' in answer) && answer.ref !== undefined
}

/** A model's Skill load ran only when the Skill tool says it succeeded. */
export function skillLoadRan(answer: unknown): boolean {
  if (!isRecord(answer) || 'deny' in answer || answer.isError === true) return false
  return isRecord(answer.result) && answer.result.success === true
}

type ListedSkill = { name?: unknown; source?: unknown; pluginName?: unknown }
type SkillListing = { totalSkills?: unknown; includedSkills?: unknown; skillFrontmatter?: readonly ListedSkill[] }

/** Whether the listing shows the loaded copy is ours: for `grimoire:head-chef`,
 *  one copy of the name and it is grimoire's own; for `head-chef`, every copy
 *  of the name is the owner's own. A listing that left skills out, or gives
 *  no counts, confirms nothing. */
export function listedAsOurs(skills: SkillListing | undefined, name: string): boolean {
  if (skills === undefined || typeof skills.totalSkills !== 'number' || skills.includedSkills !== skills.totalSkills) return false
  const copies = (skills.skillFrontmatter ?? []).filter(s => s.name === name)
  if (copies.length === 0) return false
  return name === 'grimoire:head-chef'
    ? copies.length === 1 && copies[0].source === 'plugin' && copies[0].pluginName === 'grimoire'
    : copies.every(s => s.source === 'userSettings')
}
