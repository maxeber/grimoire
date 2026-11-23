import { AHEAD_MS, SESSION_ID, oneLine } from './roster.ts'
import type { SessionRow } from './roster.ts'

// The decision log's rules (spec 402, S5.1 and S5.2): what a log_decision
// call may carry, what each file kind must hold, how an append is stamped and
// capped and which entries it may drop, how the owner's marks merge, and what
// the Decisions tab draws from them. The log, the marks and the tab's queue
// are text other processes can write, so each is held to a shape before use.
// Nothing here calls the engine: register.tsx reads and writes the files and
// hands the text over, and tests/brigade-decisions.test.mjs tests these
// rules as they are.

/** The sources an entry may carry. Only `lead` and `relayed` come from the
 *  tool; the pane writes the other three, for the autonomy slider. */
export type Source = 'owner' | 'pane' | 'alarm' | 'lead' | 'relayed'
const SOURCES: readonly string[] = ['owner', 'pane', 'alarm', 'lead', 'relayed']
// The tool's sources, and the only ones an append may drop.
const TOOL_SOURCES: readonly string[] = ['lead', 'relayed']

/** One decision, as the log keeps it (S5.2). `id`, `at` and `level` are the mod's. */
export type DecisionEntry = {
  id: string
  at: number
  level: 1 | 2 | 3
  source: Source
  waiting: boolean
  work: string
  question: string
  options: string[]
  pick: string
  why: string
  undo: string
  revisit: string
  answers: string
  /** Since issue 459: the lead's one-line reason for flagging its own pick.
   *  Only a Lead entry that does not wait carries one, and only when sent. */
  flag?: string
}

/** A session's decision log file. `next` only ever goes up, so an id is never reused. */
export type DecisionLog = { kind: 'decisions'; v: 1; next: number; project: string | null; entries: DecisionEntry[] }

/** A mark's state: read, flagged (and so read), or unflagged (read, not flagged). */
export type MarkState = 'read' | 'flagged' | 'unflagged'
/** One mark the owner made: which log's entry, by its id and its own time, and when. */
export type Mark = { log: string; id: string; entryAt: number; state: MarkState; at: number }
/** A session's marks file. */
export type MarksFile = { kind: 'marks'; v: 1; marks: Mark[] }

export const MAX_ENTRIES = 500
export const MAX_LOG_BYTES = 256 * 1024
export const MAX_MARKS = 2000
// 256 KiB since 0.89.0 (spec 444 q14): one Mark all as read press adds up to 500
// marks, and the 2,000-mark count fits beside them for the entry ids that
// occur (ids run in sequence, so a mark is about 115 to 122 bytes). At the
// widest id the format allows, a mark is 133 bytes and the cap holds fewer old
// marks than the count; the order of the drops still holds.
export const MAX_MARKS_BYTES = 256 * 1024
/** History's page: the rows it draws before, and for each, "Show more". */
export const HISTORY_PAGE = 50
// The most one entry can take as JSON: 5,316 characters of text at six bytes
// each, the escape of an unpaired surrogate (issue 459, Test round 1, q8 A),
// with its keys. The dim line reads a log this close to the byte cap as one
// the cap rule may have dropped from.
const MAX_ENTRY_BYTES = 32 * 1024

type Checked<T> = { value: T } | { error: string }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isWhole = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const bytes = (text: string) => new TextEncoder().encode(text).length

// --- the text rules (S5.2) ----------------------------------------------------
//
// Every field refuses a control character other than a line break and each
// hidden or direction-changing character the roster's HIDDEN set names, and
// nothing else (issue 486). These copies carry no `g` flag: a global
// pattern's `test` keeps its place between calls.

const CONTROL = /[\u{0}-\u{9}\u{B}-\u{1F}\u{7F}-\u{9F}\u{2028}\u{2029}]/u
const HIDDEN = /[\p{Default_Ignorable_Code_Point}\u{61C}\u{200E}\u{200F}\u{202A}-\u{202E}\u{2066}-\u{2069}]/u
const ENTRY_ID = /^[1-9][0-9]{0,15}$/
const DIGEST = /^[0-9a-f]{64}$/

function text(where: string, v: unknown, min: number, max: number): Checked<string> {
  if (typeof v !== 'string') return { error: `${where} is not text` }
  if (min > 0 && v.trim() === '') return { error: `${where} is empty` }
  if ([...v].length > max) return { error: `${where} is over ${max} characters` }
  if (CONTROL.test(v)) return { error: `${where} holds a control character other than a line break` }
  if (HIDDEN.test(v)) return { error: `${where} holds a hidden or direction-changing character` }
  return { value: v }
}

/** An entry's fields other than the three the mod stamps. */
export type EntryInput = Omit<DecisionEntry, 'id' | 'at' | 'level'>

const INPUT_KEYS = ['source', 'waiting', 'work', 'question', 'options', 'pick', 'why', 'undo', 'revisit', 'answers', 'flag']
const STAMPED = ['id', 'at', 'level'] as const

// The fields both checks share. `sources` is what this caller may write.
function fieldsOf(o: Record<string, unknown>, sources: readonly string[], required: boolean): Checked<EntryInput> {
  if (typeof o.source !== 'string' || !sources.includes(o.source)) {
    return { error: sources === TOOL_SOURCES ? 'source is not lead or relayed' : 'source is not one of the five sources' }
  }
  const source = o.source as Source
  if (o.waiting !== undefined && typeof o.waiting !== 'boolean') return { error: 'waiting is not true or false' }
  if (required && typeof o.waiting !== 'boolean') return { error: 'waiting is not true or false' }
  const waiting = o.waiting === true
  const out: EntryInput = { source, waiting, work: '', question: '', options: [], pick: '', why: '', undo: '', revisit: '', answers: '' }
  const limits = [
    ['work', 1, 300],
    ['question', 1, 1000],
    ['why', 1, 1000],
    ['undo', 1, 300],
    ['revisit', 0, 300],
  ] as const
  for (const [k, min, max] of limits) {
    const t = text(k, o[k] === undefined && !required && k === 'revisit' ? '' : o[k], min, max)
    if ('error' in t) return t
    out[k] = t.value
  }
  if (!Array.isArray(o.options) || o.options.length < 1 || o.options.length > 6) return { error: 'options is not a list of 1 to 6 items' }
  const folded = new Set<string>()
  for (const [i, v] of o.options.entries()) {
    const t = text(`option ${i + 1}`, v, 1, 300)
    if ('error' in t) return t
    // Full case folding: upper case first, so ß and SS meet.
    const f = t.value.toUpperCase().toLowerCase()
    if (folded.has(f)) return { error: `options repeat an option once case is folded (option ${i + 1})` }
    folded.add(f)
    out.options.push(t.value)
  }
  const pick = o.pick === undefined && waiting && !required ? '' : o.pick
  if (typeof pick !== 'string') return { error: 'pick is not text' }
  if (waiting) {
    if (pick !== '') return { error: 'pick: a waiting entry has no pick; send an empty pick' }
  } else if (!out.options.includes(pick)) {
    return { error: 'pick is not one of the options' }
  }
  out.pick = pick
  const answers = o.answers === undefined && !required ? '' : o.answers
  if (typeof answers !== 'string' || (answers !== '' && !ENTRY_ID.test(answers))) return { error: 'answers is not empty or an entry id' }
  if (answers !== '' && (source !== 'relayed' || waiting)) return { error: 'answers: only a relayed entry that is not waiting may answer one' }
  if (waiting && (source !== 'lead' || answers !== '')) return { error: 'waiting: only a lead entry that answers none may wait' }
  out.answers = answers
  // Issue 459: an empty flag from the tool is no flag; the log never holds one.
  if (o.flag !== undefined && (o.flag !== '' || required)) {
    if (typeof o.flag === 'string' && o.flag.includes('\n')) return { error: 'flag holds a line break' }
    const t = text('flag', o.flag, 1, 300)
    if ('error' in t) return t
    if (source !== 'lead' || waiting) return { error: 'flag: only a Lead entry that does not wait may carry one' }
    out.flag = t.value
  }
  return { value: out }
}

/** A log_decision call's input, checked: own keys only, of the shape S5.2
 *  sets, with no `id`, `at` or `level` and a source of `lead` or `relayed`.
 *  `waiting`, `revisit`, `answers` and `flag` may be left out; a waiting
 *  entry may leave out its pick. */
export function checkInput(v: unknown): Checked<EntryInput> {
  if (!isRecord(v)) return { error: 'the entry is not an object' }
  for (const k of STAMPED) if (Object.hasOwn(v, k)) return { error: `${k} is stamped by the mod, not sent by the tool` }
  if (!Object.hasOwn(v, 'source') || !TOOL_SOURCES.includes(String(v.source))) return { error: 'source is not lead or relayed' }
  const extra = Object.keys(v).filter(k => !INPUT_KEYS.includes(k) && !TOOL_ONLY_KEYS.includes(k))
  if (extra.length > 0) return { error: `the entry has a field the decision log does not use: ${oneLine(extra[0] ?? '', 40)}` }
  return fieldsOf(v, TOOL_SOURCES, false)
}

// --- the ask type and stop (618, S3) -------------------------------------------
//
// `ask` and `stop` are tool-only keys: checkInput lets them through and never
// judges them, the returned entry holds neither, and no log stores them (a log
// that holds one fails checkLog, as it holds no key but INPUT_KEYS). checkAsk
// alone judges them.

export const ASK_TYPES = ['question', 'review', 'notify'] as const
/** The kinds of wait this tool accepts, one each (S4). */
export const STOP_KINDS = [
  'owner-file-keeps', 'owner-words', 'carried', 'blocked', 'owner-hands', 'install', 'private-post',
  'leaves-machine', 'sensitive-route', 'merge', 'threat-model', 'never-lifted', 'outside-goal',
] as const
export const TOOL_ONLY_KEYS: readonly string[] = ['ask', 'stop']

// --- the call as a record (630) -------------------------------------------------
//
// The log is a record of what the lead decided, not a gate on how it asks. A call
// is mapped before `checkInput` judges it, so the entry written is always valid:
// only a field over its limit, or more than six options, is left for the check to
// refuse. `ask` and `stop` pass through for `checkAsk`, which stays the gate on
// waits.

/** The words a refusal for a field over its limit ends with: no "act at level 1", the step stays held. */
export const SHAPE_TAIL =
  "The decision log is unchanged; shorten it and log it again. The step stays held until it is logged; if you can't log it, say so in chat."

const NOT_GIVEN = 'not given'
const KNOWN_KEYS: readonly string[] = [...INPUT_KEYS, ...TOOL_ONLY_KEYS]
const CONTROL_ALL = new RegExp(CONTROL.source, 'gu')
const HIDDEN_ALL = new RegExp(HIDDEN.source, 'gu')

// A value as text with control and hidden characters taken out, or undefined for a value that is not text.
function plain(v: unknown): string | undefined {
  if (typeof v === 'number' || typeof v === 'boolean') v = String(v)
  if (typeof v !== 'string') return undefined
  return v.replace(CONTROL_ALL, ' ').replace(HIDDEN_ALL, '').trim()
}
const folded = (s: string) => s.toUpperCase().toLowerCase()

/** What `log_decision` does with its input before `checkInput` (issue 630): a known field in any case is
 *  taken; a stamped or unused field is dropped; `source` is `relayed` only when it says so, else `lead`, so
 *  a call never claims the owner's authority; missing text becomes "not given"; a missing pick or options is
 *  filled from the other; repeated options merge; a waiting entry is a lead entry with an empty pick;
 *  `answers` stays only on a relayed entry that does not wait, `flag` only on a lead entry that does not. */
export function mapInput(v: unknown): Record<string, unknown> {
  const raw: Record<string, unknown> = {}
  if (isRecord(v)) {
    for (const k of Object.keys(v)) {
      const key = k.trim().toLowerCase()
      if (KNOWN_KEYS.includes(key) && (!(key in raw) || k === key)) raw[key] = v[k]
    }
  }
  const waiting = raw.waiting === true || ['true', 'yes', '1'].includes(folded(String(raw.waiting).trim()))
  const source = !waiting && folded(plain(raw.source) ?? '') === 'relayed' ? 'relayed' : 'lead'
  const given = (k: string): string => {
    const t = plain(raw[k])
    return t === undefined || t === '' ? NOT_GIVEN : t
  }
  const options: string[] = []
  const list = Array.isArray(raw.options) ? raw.options : typeof raw.options === 'string' ? [raw.options] : []
  const seen = new Set<string>()
  for (const o of list) {
    const t = plain(o)
    if (t === undefined || t === '' || seen.has(folded(t))) continue
    seen.add(folded(t))
    options.push(t)
  }
  let pick = plain(raw.pick) ?? ''
  if (waiting) {
    pick = ''
    if (options.length === 0) options.push(NOT_GIVEN)
  } else {
    if (pick === '') pick = options[0] ?? NOT_GIVEN
    const same = options.find(x => folded(x) === folded(pick))
    if (same === undefined) options.push(pick)
    else pick = same
  }
  const out: Record<string, unknown> = {
    source,
    waiting,
    work: given('work'),
    question: given('question'),
    options,
    pick,
    why: given('why'),
    undo: given('undo'),
    revisit: plain(raw.revisit) ?? '',
    answers: '',
  }
  const answers = plain(raw.answers) ?? ''
  if (source === 'relayed' && ENTRY_ID.test(answers)) out.answers = answers
  const flag = plain(raw.flag)?.replace(/\n+/g, ' ')
  if (flag !== undefined && flag !== '' && source === 'lead' && !waiting) out.flag = flag
  for (const k of TOOL_ONLY_KEYS) if (k in raw) out[k] = raw[k]
  return out
}

/** The two fixed answers: neither echoes input, and neither takes the refusal's "act at level 1". */
export const ASK_FORM =
  "Fix the entry's ask, stop or question and log it again: ask is question, review or notify, notify never waits, stop is one of this tool's kinds and only on a wait, and at level 3 a wait needs both and a one-line question. The step stays held until it is logged; if you can't log it, say so in chat."
export const ASK_NO_STOP =
  "At level 3 a wait needs one stop from this tool's kinds. At level 3 only blocked, owner-hands, owner-words, never-lifted and outside-goal fit a wait. A call that fits none of them is yours: log it with source lead and your pick, flag it, act, and tell the owner what you took."

// --- the to-do gate (618, S5) ---------------------------------------------------

/** What set_roster refuses with when a level-3 to-do starts from no open waiting entry. */
export const TODO_WAIT_RULE = 'At level 3 a new or changed to-do needs the id w<n> of an open waiting entry; log the wait first'
type TodoShape = { id: string; text: string; session?: string; link?: string }
const WAIT_TODO_ID = /^w([1-9][0-9]{0,15})$/

/** The to-dos of `next` that are new (an id not in the stored roster) or changed
 *  (a stored id with its text, session or link different). */
export function changedTodos(previous: readonly TodoShape[] | undefined, next: readonly TodoShape[]): TodoShape[] {
  const stored = new Map((previous ?? []).map(t => [t.id, t]))
  return next.filter(t => {
    const was = stored.get(t.id)
    return was === undefined || was.text !== t.text || was.session !== t.session || was.link !== t.link
  })
}

/** The ids of the waiting entries in a log that no entry answers; none for no log. */
export function openWaitIds(log: DecisionLog | undefined): ReadonlySet<string> {
  const open = new Set<string>()
  for (const e of log?.entries ?? []) if (e.waiting) open.add(e.id)
  for (const e of log?.entries ?? []) if (e.answers !== '') open.delete(e.answers)
  return open
}

/** Whether every changed to-do has the id `w<n>` of an open waiting entry. */
export const todosHaveOpenWaits = (changed: readonly TodoShape[], open: ReadonlySet<string>): boolean =>
  changed.every(t => {
    const m = WAIT_TODO_ID.exec(t.id)
    return m !== null && open.has(m[1] ?? '')
  })

/** A log_decision call's `ask` and `stop` at the level in force: the fixed answer
 *  that refuses it, or undefined when it is accepted. The first row that fits
 *  gives the answer. The stop is the lead's own claim; nothing here verifies it. */
export function checkAsk(v: unknown, level: Level): string | undefined {
  if (!isRecord(v)) return ASK_FORM
  const has = (k: string) => Object.hasOwn(v, k)
  const ask = v.ask
  const stop = v.stop
  if (has('ask') && !(typeof ask === 'string' && (ASK_TYPES as readonly string[]).includes(ask))) return ASK_FORM
  if (has('stop') && !(typeof stop === 'string' && (STOP_KINDS as readonly string[]).includes(stop))) return ASK_FORM
  const waiting = v.waiting === true
  if (ask === 'notify' && waiting) return ASK_FORM
  if (has('stop') && !waiting) return ASK_FORM
  if ((ask === 'question' || ask === 'review') && !waiting) return ASK_FORM
  if (level !== 3 || !waiting) return undefined
  if (typeof v.question === 'string' && v.question.includes('\n')) return ASK_FORM
  if (!has('ask')) return ASK_FORM
  if (!has('stop')) return ASK_NO_STOP
  return undefined
}

// The pane's own fixed entries (ticket 4) take the same rules with any source.
function checkFixed(v: unknown): Checked<EntryInput> {
  if (!isRecord(v)) return { error: 'the entry is not an object' }
  return fieldsOf(v, SOURCES, false)
}

function checkEntry(i: number, v: unknown): Checked<DecisionEntry> {
  const where = `entry ${i + 1}`
  if (!isRecord(v)) return { error: `${where} is not an object` }
  const keys = [...STAMPED, ...INPUT_KEYS]
  const extra = Object.keys(v).filter(k => !keys.includes(k))
  if (extra.length > 0) return { error: `${where} has a field the decision log does not use` }
  if (typeof v.id !== 'string' || !ENTRY_ID.test(v.id)) return { error: `${where} id is not an entry id` }
  if (!isWhole(v.at)) return { error: `${where} at is not a whole number` }
  if (v.level !== 1 && v.level !== 2 && v.level !== 3) return { error: `${where} level is not 1, 2 or 3` }
  const f = fieldsOf(v, SOURCES, true)
  if ('error' in f) return { error: `${where} ${f.error}` }
  return { value: { id: v.id, at: v.at, level: v.level, ...f.value } }
}

/** A log file's text, checked strictly, as the pane reads it and as the
 *  writer does before it overwrites one: exactly the five keys, kind
 *  `decisions`, version 1, every entry of its shape, ids rising and below
 *  `next`, and an `answers` that names an earlier entry, waiting if it is
 *  still there, and answered by no other. */
export function checkLog(raw: string): Checked<DecisionLog> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { error: 'the decision log is not JSON' }
  }
  if (!isRecord(parsed)) return { error: 'the decision log is not an object' }
  const keys = Object.keys(parsed)
  if (keys.length !== 5 || !['kind', 'v', 'next', 'project', 'entries'].every(k => keys.includes(k))) return { error: 'the decision log does not have exactly its five fields' }
  if (parsed.kind !== 'decisions' || parsed.v !== 1) return { error: 'the file is not a decision log of version 1' }
  if (!isWhole(parsed.next) || parsed.next < 1) return { error: 'the decision log\'s next is not a whole number from 1' }
  if (parsed.project !== null && (typeof parsed.project !== 'string' || !DIGEST.test(parsed.project))) return { error: 'the decision log\'s project is not a digest or null' }
  if (!Array.isArray(parsed.entries)) return { error: 'the decision log\'s entries is not a list' }
  const entries: DecisionEntry[] = []
  const byId = new Map<string, DecisionEntry>()
  const answered = new Set<string>()
  let last = 0
  for (const [i, v] of parsed.entries.entries()) {
    const e = checkEntry(i, v)
    if ('error' in e) return e
    const n = Number(e.value.id)
    if (n <= last || n >= parsed.next) return { error: `entry ${i + 1} id is out of order or not below next` }
    last = n
    const a = e.value.answers
    if (a !== '') {
      const target = byId.get(a)
      if (Number(a) >= n || (target !== undefined && !target.waiting) || answered.has(a)) return { error: `entry ${i + 1} answers no open waiting entry` }
      answered.add(a)
    }
    byId.set(e.value.id, e.value)
    entries.push(e.value)
  }
  return { value: { kind: 'decisions', v: 1, next: parsed.next, project: parsed.project as string | null, entries } }
}

/** A log with no entries yet. */
export const emptyLog = (project: string | null): DecisionLog => ({ kind: 'decisions', v: 1, next: 1, project, entries: [] })

/** A log as the text the writer saves, measured in UTF-8 bytes against the cap. */
export function serializeLog(log: DecisionLog): Checked<string> {
  const t = JSON.stringify(log)
  return bytes(t) > MAX_LOG_BYTES ? { error: 'the decision log is over its byte cap' } : { value: t }
}

// --- the append (S5.1's caps) ---------------------------------------------------

/** One entry's mark key: its log's session id, its id and its own time, so a
 *  mark never lands on another entry. */
export const markKey = (log: string, id: string, at: number) => `${log} ${id} ${at}`

const isRead = (s: MarkState | undefined) => s !== undefined

/** What an append needs from outside: the engine clock's time, the level in
 *  force, the merged marks (`read`, keyed by `markKey`) and this log's session
 *  id. `fixed` is the pane's own Owner, Pane and alarm entries: written past
 *  the entry cap and never past the byte cap, which alone drops entries for
 *  them, so a log that log_decision keeps full still takes them (#497). */
export type AppendOptions = { at: number; level: 1 | 2 | 3; read: ReadonlyMap<string, MarkState>; sid?: string; fixed?: boolean }

/** Appends one entry, stamping its id from `next`, its time and its level.
 *  Past 500 entries or 256 KiB, entries the owner has marked read and not
 *  flagged drop first, oldest first: never an unread or flagged one, a
 *  waiting one no entry answers, or an Owner, Pane or alarm one. With nothing
 *  left to drop it refuses, and the log given is never changed. */
export function appendEntry(log: DecisionLog, raw: unknown, o: AppendOptions): Checked<{ log: DecisionLog; entry: DecisionEntry }> {
  const c = o.fixed === true ? checkFixed(raw) : checkInput(raw)
  if ('error' in c) return c
  const f = c.value
  if (f.answers !== '') {
    if (!log.entries.some(e => e.id === f.answers && e.waiting)) return { error: 'answers no waiting entry in this log' }
    if (log.entries.some(e => e.answers === f.answers)) return { error: 'answers a waiting entry already answered' }
  }
  if (!isWhole(o.at)) return { error: 'clock: the engine clock gave no whole number of milliseconds' }
  if (!Number.isSafeInteger(log.next + 1)) return { error: 'the decision log has no id left' }
  const entry: DecisionEntry = {
    id: String(log.next),
    at: o.at,
    level: o.level,
    source: f.source,
    waiting: f.waiting,
    work: f.work,
    question: f.question,
    options: f.options,
    pick: f.pick,
    why: f.why,
    undo: f.undo,
    revisit: f.revisit,
    answers: f.answers,
    ...(f.flag === undefined ? {} : { flag: f.flag }),
  }
  const kept = [...log.entries, entry]
  // The text's size, kept up to date as entries drop: the frame, each entry,
  // and a comma between two.
  const frame = bytes(JSON.stringify({ ...log, next: log.next + 1, entries: [] }))
  const sizes = kept.map(e => bytes(JSON.stringify(e)))
  let total = frame + sizes.reduce((a, b) => a + b, 0) + Math.max(kept.length - 1, 0)
  const fits = () => (o.fixed === true || kept.length <= MAX_ENTRIES) && total <= MAX_LOG_BYTES
  if (!fits()) {
    const answered = new Set(kept.map(e => e.answers).filter(a => a !== ''))
    const sid = o.sid ?? ''
    for (let i = 0; i < kept.length - 1 && !fits(); ) {
      const e = kept[i]
      const state = o.read.get(markKey(sid, e.id, e.at))
      // An answer stays while the waiting entry it answers does, so that
      // entry is never drawn as waiting again nor answered twice.
      const answering = e.answers !== '' && kept.some(x => x.id === e.answers)
      const drops = TOOL_SOURCES.includes(e.source) && (state === 'read' || state === 'unflagged') && (!e.waiting || answered.has(e.id)) && !answering
      if (!drops) {
        i++
        continue
      }
      total -= (sizes[i] ?? 0) + 1
      kept.splice(i, 1)
      sizes.splice(i, 1)
    }
  }
  if (!fits()) return { error: FULL }
  const next: DecisionLog = { ...log, next: log.next + 1, entries: kept }
  return 'error' in serializeLog(next) ? { error: FULL } : { value: { log: next, entry } }
}

/** An append's refusal when nothing can drop: fixed words the tool answers with. */
export const FULL = 'the decision log is full: no entry can drop'

/** The ids missing below `next` that the cap rule does not explain: none when
 *  the log sits at a cap, where drops happen; else every gap. */
export function missingIds(log: DecisionLog): number {
  const missing = log.next - 1 - log.entries.length
  if (missing <= 0) return 0
  const nearCap = log.entries.length >= MAX_ENTRIES || bytes(JSON.stringify(log)) > MAX_LOG_BYTES - MAX_ENTRY_BYTES
  return nearCap ? 0 : missing
}

// --- marks (S5.4) -----------------------------------------------------------------

function checkMark(i: number, v: unknown): Checked<Mark> {
  const where = `mark ${i + 1}`
  if (!isRecord(v)) return { error: `${where} is not an object` }
  const keys = Object.keys(v)
  if (keys.length !== 5 || !['log', 'id', 'entryAt', 'state', 'at'].every(k => keys.includes(k))) return { error: `${where} does not have exactly its five fields` }
  if (typeof v.log !== 'string' || !SESSION_ID.test(v.log)) return { error: `${where} log is not a session id` }
  if (typeof v.id !== 'string' || !ENTRY_ID.test(v.id)) return { error: `${where} id is not an entry id` }
  if (!isWhole(v.entryAt) || !isWhole(v.at)) return { error: `${where} time is not a whole number` }
  if (v.state !== 'read' && v.state !== 'flagged' && v.state !== 'unflagged') return { error: `${where} state is not read, flagged or unflagged` }
  return { value: { log: v.log, id: v.id, entryAt: v.entryAt, state: v.state, at: v.at } }
}

/** A marks file's text, checked strictly: exactly its three keys, kind
 *  `marks`, version 1, at most 2,000 marks, each of its shape. */
export function checkMarks(raw: string): Checked<MarksFile> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { error: 'the marks file is not JSON' }
  }
  if (!isRecord(parsed)) return { error: 'the marks file is not an object' }
  const keys = Object.keys(parsed)
  if (keys.length !== 3 || !['kind', 'v', 'marks'].every(k => keys.includes(k))) return { error: 'the marks file does not have exactly its three fields' }
  if (parsed.kind !== 'marks' || parsed.v !== 1) return { error: 'the file is not a marks file of version 1' }
  if (!Array.isArray(parsed.marks) || parsed.marks.length > MAX_MARKS) return { error: `the marks file's marks is not a list of at most ${MAX_MARKS}` }
  const marks: Mark[] = []
  for (const [i, v] of parsed.marks.entries()) {
    const m = checkMark(i, v)
    if ('error' in m) return m
    marks.push(m.value)
  }
  return { value: { kind: 'marks', v: 1, marks } }
}

/** A marks file as the text the writer saves, measured against the byte cap. */
export function serializeMarks(file: MarksFile): Checked<string> {
  const t = JSON.stringify(file)
  return bytes(t) > MAX_MARKS_BYTES || file.marks.length > MAX_MARKS ? { error: 'the marks file is over its cap' } : { value: t }
}

/** Each entry's state, keyed by `markKey`: the latest mark for it by mark
 *  time across the files given. A mark dated more than two minutes ahead of
 *  the engine clock is ignored. An entry with no mark has none. */
export function mergeMarks(files: readonly MarksFile[], now: number): Map<string, MarkState> {
  const best = new Map<string, Mark>()
  for (const f of files) {
    for (const m of f.marks) {
      if (m.at > now + AHEAD_MS) continue
      const k = markKey(m.log, m.id, m.entryAt)
      const was = best.get(k)
      if (was === undefined || m.at > was.at) best.set(k, m)
    }
  }
  return new Map([...best].map(([k, m]) => [k, m.state]))
}

/** The file with one mark added. Past 2,000 marks or 256 KiB, marks drop in
 *  `addMarks`'s order. The new mark never drops. */
export const addMark = (file: MarksFile | undefined, mark: Mark, known: ReadonlySet<string>): MarksFile => addMarks(file, [mark], known)

/** The file with several marks added at once, as Dismiss and Mark all as read
 *  write them. None of the new marks drops. Past the caps, the old marks drop
 *  one at a time in this order (spec 444 S4), until the file fits:
 *  1. a mark for an entry in no log the pane read (not in `known`);
 *  2. a mark a newer counted mark for the same entry supersedes, in this file
 *     or in `others`, the other marks files read;
 *  3. a mark whose entry's newest counted state is not flagged, unless it is
 *     its entry's newest counted mark while an older flag stays in `others`,
 *     or the entry carries a lead flag (`leadFlags`, issue 459), since
 *     dropping it would bring that flag back;
 *  4. any mark left.
 *  Each step goes oldest first. "Counted" is as `mergeMarks` counts at `now`;
 *  the merge is worked out once for the write. */
export function addMarks(
  file: MarksFile | undefined,
  added: readonly Mark[],
  known: ReadonlySet<string>,
  others: readonly MarksFile[] = [],
  now = Number.POSITIVE_INFINITY,
  leadFlags: ReadonlySet<string> = new Set(),
): MarksFile {
  const marks = [...(file?.marks ?? []), ...added]
  const sizes = marks.map(m => bytes(JSON.stringify(m)))
  let total = bytes('{"kind":"marks","v":1,"marks":[]}') + sizes.reduce((a, b) => a + b, 0) + marks.length - 1
  const old = marks.length - added.length
  if (marks.length <= MAX_MARKS && total <= MAX_MARKS_BYTES) return { kind: 'marks', v: 1, marks }
  // The newest counted mark of each entry, this file first so a tie keeps the
  // mark the file holds; and the entries an older flag in another file covers.
  const counted = (m: Mark) => m.at <= now + AHEAD_MS
  const best = new Map<string, Mark>()
  for (const m of [...marks, ...others.flatMap(f => f.marks)]) {
    if (!counted(m)) continue
    const k = markKey(m.log, m.id, m.entryAt)
    const was = best.get(k)
    if (was === undefined || m.at > was.at) best.set(k, m)
  }
  const flaggedElsewhere = new Set<string>(leadFlags)
  for (const f of others) for (const m of f.marks) if (counted(m) && m.state === 'flagged') flaggedElsewhere.add(markKey(m.log, m.id, m.entryAt))
  const rank = (m: Mark): number => {
    const k = markKey(m.log, m.id, m.entryAt)
    if (!known.has(k)) return 1
    const b = best.get(k)
    if (b !== undefined && b !== m) return 2
    if (b?.state !== 'flagged' && !(b === m && flaggedElsewhere.has(k))) return 3
    return 4
  }
  const order = marks
    .slice(0, old)
    .map((m, i) => ({ i, at: m.at, r: rank(m) }))
    .sort((a, b) => a.r - b.r || a.at - b.at || a.i - b.i)
  const dropped = new Set<number>()
  for (const o of order) {
    if (marks.length - dropped.size <= MAX_MARKS && total <= MAX_MARKS_BYTES) break
    dropped.add(o.i)
    total -= (sizes[o.i] ?? 0) + 1
  }
  return { kind: 'marks', v: 1, marks: marks.filter((_, i) => !dropped.has(i)) }
}

/** Whether writing `after` in place of `before` changes the counted state of
 *  an entry in a log read (`known`) other than the entries the write marks
 *  (`marked`): that is, whether the caps pushed out a mark that was still its
 *  entry's newest counted state, so the entry would read as it did before
 *  that mark. Mark all as read writes nothing when this holds (spec 447,
 *  Test round 1, q3 A), so a bulk press never undoes the owner's own reads.
 *  Since issue 509 only this session's log is read, which holds at most 500
 *  entries the tool wrote, so the pane's own press cannot push out a mark for one of them; marks
 *  the file already holds for entries of other logs are no longer known and go
 *  first when the caps bite. The guard stays. */
export function dropsLiveMark(
  before: MarksFile | undefined,
  after: MarksFile,
  others: readonly MarksFile[],
  known: ReadonlySet<string>,
  marked: ReadonlySet<string>,
  now: number,
): boolean {
  const was = mergeMarks([...(before === undefined ? [] : [before]), ...others], now)
  const is = mergeMarks([after, ...others], now)
  for (const k of known) if (!marked.has(k) && was.get(k) !== is.get(k)) return true
  return false
}

// --- what the tab draws (S5.4) --------------------------------------------------

/** One log as the pane read it: its session id, the writer's drawn name and the log. */
export type ReadLog = { sid: string; writer: string; log: DecisionLog }
/** One entry in the tab, with its log's session id and writer. */
export type Row = { sid: string; writer: string; entry: DecisionEntry }

/** The writer of a log: the engine's session name for that session id, from
 *  the session files the cards are matched against, or "an ended session". */
export function writerName(rows: readonly SessionRow[], sid: string): string {
  const row = rows.find(r => r.sessionId === sid)
  return row === undefined ? 'an ended session' : oneLine(row.name, 80)
}

/** A field's lines, each made safe to draw: its line breaks kept, and each
 *  line cleaned as the roster's one-line text is. */
export const cleanLines = (text: string): string[] => text.split(/\n/).map(l => oneLine(l, 1000))

/** The words of a search, folded: each must appear in an entry. */
export const searchWords = (query: string): string[] =>
  [...query].slice(0, 200).join('').toLowerCase().split(/\s+/).filter(w => w !== '')

/** Whether every word appears in the entry's writer name, id, work, question,
 *  options, pick, why, undo, revisit or the lead's flag, in any case. */
export function matchesSearch(e: DecisionEntry, writer: string, words: readonly string[]): boolean {
  if (words.length === 0) return true
  const hay = [writer, e.id, e.work, e.question, ...e.options, e.pick, e.why, e.undo, e.revisit, e.flag ?? ''].join('\n').toLowerCase()
  return words.every(w => hay.includes(w))
}

const rowKey = (r: Row) => markKey(r.sid, r.entry.id, r.entry.at)
const rowsOf = (logs: readonly ReadLog[]): Row[] => logs.flatMap(l => l.log.entries.map(entry => ({ sid: l.sid, writer: l.writer, entry })))
const oldestFirst = (a: Row, b: Row) => a.entry.at - b.entry.at || (a.sid < b.sid ? -1 : a.sid > b.sid ? 1 : 0) || Number(a.entry.id) - Number(b.entry.id)

/** To review: every unread entry across the logs read that matches the
 *  search, oldest first (Owner and Pane entries count as read by their
 *  source), and the one shown, the first not skipped in this pane's life, or
 *  the first again once all were skipped, with its place as "n of N". */
export function reviewQueue(logs: readonly ReadLog[], states: ReadonlyMap<string, MarkState>, skipped: ReadonlySet<string>, words: readonly string[]) {
  const order = rowsOf(logs)
    .filter(r => r.entry.source !== 'owner' && r.entry.source !== 'pane' && !isRead(states.get(rowKey(r))) && matchesSearch(r.entry, r.writer, words))
    .sort(oldestFirst)
  const at = order.findIndex(r => !skipped.has(rowKey(r)))
  const i = at < 0 ? 0 : at
  return { order, head: order[i] as Row | undefined, n: i + 1, total: order.length }
}

/** One card in To review: an entry alone, or, since spec 448, a waiting entry
 *  of this session's own log with the unread Relayed entry that answers it. */
export type ReviewCard = { row: Row; answer: Row | undefined }

/** To review as cards (spec 448 S4): `reviewQueue`'s unread entries, with an
 *  unread waiting entry of this session's own log (`sid`) and the unread
 *  Relayed entry that answers it on one card, at the waiting entry's place.
 *  A card shows when either of its entries matches the search, and then both
 *  are in `shown`, oldest first, which the presses that work from To review's
 *  order take. A pair counts as skipped when its waiting entry is. `head` and
 *  `answer` are the card shown, with its place as "n of N" in cards. */
export function reviewCards(logs: readonly ReadLog[], sid: string, states: ReadonlyMap<string, MarkState>, skipped: ReadonlySet<string>, words: readonly string[]) {
  const unread = reviewQueue(logs, states, new Set(), []).order
  const own = new Map(unread.filter(r => r.sid === sid && r.entry.waiting).map(r => [r.entry.id, r]))
  const answerOf = new Map<Row, Row>()
  for (const r of unread) {
    const w = r.sid === sid && r.entry.source === 'relayed' && r.entry.answers !== '' ? own.get(r.entry.answers) : undefined
    if (w !== undefined) answerOf.set(w, r)
  }
  const answers = new Set(answerOf.values())
  const cards: ReviewCard[] = unread
    .filter(r => !answers.has(r))
    .map(row => ({ row, answer: answerOf.get(row) }))
    .filter(c => matchesSearch(c.row.entry, c.row.writer, words) || (c.answer !== undefined && matchesSearch(c.answer.entry, c.answer.writer, words)))
  const shown = cards.flatMap(c => (c.answer === undefined ? [c.row] : [c.row, c.answer])).sort(oldestFirst)
  const at = cards.findIndex(c => !skipped.has(rowKey(c.row)))
  const i = at < 0 ? 0 : at
  const card = cards[i]
  return { cards, shown, head: card?.row, answer: card?.answer, n: i + 1, total: cards.length }
}

const PAIR_KEY = /^(dnext|dflag|dskip)-([1-9][0-9]{0,15})-([0-9]{1,16})-([1-9][0-9]{0,15})-([0-9]{1,16})$/
/** A pair card's Read, next, Flag or Skip key, matched whole: the verb, then
 *  the waiting entry's id and time, then its answer's (spec 448 S4). */
export function parsePairKey(key: string): { verb: string; id: string; at: number; answerId: string; answerAt: number } | undefined {
  const m = PAIR_KEY.exec(key)
  if (m === null) return undefined
  return { verb: m[1] as string, id: m[2] as string, at: Number(m[3]), answerId: m[4] as string, answerAt: Number(m[5]) }
}

/** This lead's flagged entries' mark keys (issue 459): only the log of this
 *  pane's session id `sid` carries them, so another log's flag is only
 *  counted, as its plain picks are (Test round 1, q5 A). */
export const leadFlagKeys = (logs: readonly ReadLog[], sid: string): Set<string> =>
  new Set(rowsOf(logs.filter(l => l.sid === sid)).filter(r => r.entry.flag !== undefined).map(rowKey))

/** The states with this lead's own flags (issue 459): an entry it logged with
 *  a flag, and that has no mark, reads as flagged, so it sits in Flagged to
 *  revisit and never in To review. The owner's latest mark wins, so Unflag and
 *  Dismiss take it out. The states given are not changed. */
export function withLeadFlags(states: ReadonlyMap<string, MarkState>, logs: readonly ReadLog[], sid: string): Map<string, MarkState> {
  const out = new Map(states)
  for (const k of leadFlagKeys(logs, sid)) if (!out.has(k)) out.set(k, 'flagged')
  return out
}

/** Flagged to revisit: every entry across the logs read whose latest mark is
 *  flagged and that matches the search, oldest first, as To review is. */
export function flaggedRows(logs: readonly ReadLog[], states: ReadonlyMap<string, MarkState>, words: readonly string[]): Row[] {
  return rowsOf(logs)
    .filter(r => states.get(rowKey(r)) === 'flagged' && matchesSearch(r.entry, r.writer, words))
    .sort(oldestFirst)
}

/** History: every entry across the logs read that matches the search, newest
 *  first, 50 a page for the pages shown. */
export function historyRows(logs: readonly ReadLog[], words: readonly string[], pages: number) {
  const all = rowsOf(logs)
    .filter(r => matchesSearch(r.entry, r.writer, words))
    .sort((a, b) => oldestFirst(b, a))
  const rows = all.slice(0, Math.max(1, pages) * HISTORY_PAGE)
  return { rows, total: all.length, more: rows.length < all.length }
}

// --- the logs the tab draws (issue 509, ADR 0017) -------------------------------------
//
// The Decisions tab draws this session's decision log and nothing from any
// other log: no carried card, no ended session's line, no fold, no count of
// another log's entries. Other logs stay on disk, untouched, in their own pane.

/** The logs as each view of the tab draws them, for the pane's session id
 *  `sid`: this session's own log alone, whole in To review, Flagged to
 *  revisit and History alike. Whatever else is handed in is left out, so no
 *  other log reaches a draw or a press even if one was read. */
export function drawnLogs(logs: readonly ReadLog[], sid: string): ReadLog[] {
  return logs.filter(l => l.sid === sid)
}

/** The entries Mark all as read takes (issue 466, issue 509): everything under
 *  To review, every card of this session's own log, whatever the search is,
 *  taken whole up to 500 entries so its key stays in range. A lead's appends
 *  keep the log's unread Lead and Relayed entries within that, so one press
 *  empties To review; past it the heading draws again and a second press takes
 *  the rest. `n` counts what leaves To review and `total` all that is under
 *  it, as To review's heading counts it: each card once, a pair as one.
 *  `hash` is the first 16 hex digits of SHA-256 over the set's mark keys,
 *  sorted and joined by line breaks: a staleness check on the press, not a
 *  secret. */
export function markAllSet(cards: readonly ReviewCard[]) {
  const fromCards = cards.map(c => (c.answer === undefined ? [c.row] : [c.row, c.answer]))
  const total = fromCards.length
  let size = 0
  let n = 0
  const take = (units: Row[][]) => {
    const out: Row[] = []
    for (const u of units) {
      // A unit over the cap on its own is taken in part.
      const part = size === 0 ? u.slice(0, MAX_ENTRIES) : u
      if (size + part.length > MAX_ENTRIES) break
      out.push(...part)
      size += part.length
      n++
    }
    return out
  }
  const rows = take(fromCards).sort(oldestFirst)
  if (rows.length === 0) return { rows, n: 0, total, hash: '' }
  return { rows, n, total, hash: setHash(rows) }
}

// A press's staleness check: the first 16 hex digits of SHA-256 over the
// set's mark keys, sorted and joined by line breaks.
const setHash = (rows: readonly Row[]) => sha256Hex(rows.map(rowKey).sort().join('\n')).slice(0, 16)

const MARK_ALL_KEY = /^dmarkall-([1-9][0-9]{0,2})-([0-9a-f]{16})$/
/** A Mark all as read button's key, matched whole: its count (1 to 500) and hash. */
export function parseMarkAllKey(key: string): { n: number; hash: string } | undefined {
  const m = MARK_ALL_KEY.exec(key)
  const n = Number(m?.[1])
  return m === null || n > MAX_ENTRIES ? undefined : { n, hash: m[2] as string }
}

/** The source as the tab draws it. An Owner entry draws plain "Owner" only
 *  when `mine` says this pane wrote it in this module's life, by its id, time
 *  and pick; any other draws "as recorded". */
export function sourceLabel(e: DecisionEntry, writer: string, mine = false): string {
  if (e.source === 'lead') return 'Lead'
  if (e.source === 'relayed') return `Relayed by ${writer}`
  if (e.source === 'owner') return mine ? 'Owner' : 'Owner (as recorded)'
  if (e.source === 'pane') return 'Pane'
  return 'Not from a press'
}

// --- the autonomy level (S5.1, S5.2 and S5.4) ------------------------------------
//
// The level a lead reads, set only by a press on the Decisions tab's slider or
// the owner's level command. register.tsx keeps the last level set and a 3's
// press time in its own module memory; these rules read them. A copy in plugin
// state, which other plugins can rewrite, serves a reload alone (issue 504).
// The pane's own log entries, Owner, Pane and alarm, each have one fixed
// shape, built and checked from the same words, so an entry in any other
// shape is skipped. The pane no longer writes an alarm; an old log's stays
// readable.

export type Level = 1 | 2 | 3
// Level 3 was "Full throttle" until issue 464 renamed it "Turbo mode", and
// "Turbo mode" until issue 496 renamed it "Turbo".
export const LEVEL_NAMES: Readonly<Record<Level, string>> = { 1: 'Manual', 2: 'Auto', 3: 'Turbo' }
/** A level as an option of the pane's entries: "1 Manual", "2 Auto", "3 Turbo". */
export const levelOption = (l: Level) => `${l} ${LEVEL_NAMES[l]}`
const LEVEL_OPTIONS = ([1, 2, 3] as const).map(levelOption)
// The options as logs written before each rename hold them, read and never
// written: the first name's from before the level command existed, so with no
// command entry, and Turbo mode, from 0.99.0 to 0.112.0, with one.
const OLD_LEVEL_OPTIONS = [
  { options: ['1 Manual', '2 Auto', '3 Full throttle'], command: false },
  { options: ['1 Manual', '2 Auto', '3 Turbo mode'], command: true },
]

/** A stored level: the number 1, 2 or 3, and 1 for anything else. */
export const levelFrom = (v: unknown): Level => (v === 2 || v === 3 ? v : 1)

/** This session's stored level from the plugin state's list of
 *  `{ session, level }`: 1 when the list or its entry is not of that shape. */
export function storedLevel(stored: unknown, sid: string): Level {
  if (!Array.isArray(stored)) return 1
  const own = stored.find(s => isRecord(s) && s.session === sid)
  return isRecord(own) ? levelFrom(own.level) : 1
}

/** Whether any session's stored level is above 1. */
export const anyStoredAbove1 = (stored: unknown): boolean => Array.isArray(stored) && stored.some(s => isRecord(s) && levelFrom(s.level) > 1)

/** Whether a clock answer is a time the band can name: a whole number of
 *  milliseconds inside the Date range (#430's C12, from Test round 1's q3g). Any other is no time. */
export const clockTime = (t: unknown): t is number => typeof t === 'number' && Number.isSafeInteger(t) && Math.abs(t) <= 8.64e15

/** The level in force: the last level set, and 1 while a reset's Pane entry
 *  waits to be logged or a reset waits to land, and for a 3 with no live press
 *  time. The stored copy in plugin state is never compared (issue 504). */
export function levelInForce(o: { pressed: Level; pressAt: number | undefined; waiting: boolean }): Level {
  if (o.waiting) return 1
  if (o.pressed === 3 && o.pressAt === undefined) return 1
  return o.pressed
}

const SLIDER_WORK = 'Autonomy slider'
const SLIDER_QUESTION = 'Autonomy level'
const OWNER_WHY = 'Moved in the pane'
const OWNER_UNDO = 'Move the slider back'
const PANE_UNDO = 'Move the slider in the pane'
// "Shown again" is no longer written since 0.88.0 (spec 402 rev 6.2), nor a compaction's since 0.116.0 (issue 504), but both stay readable in older logs.
const PANE_WHYS = { shown: 'The pane was shown again', reload: 'The Brigade mod was reloaded', compact: "The lead's context was compacted" } as const
type PaneWhy = keyof typeof PANE_WHYS
const ALARM_WHY = 'Changed, not from a press'
const COMMAND_WHY = "Set by the owner's command"
const COMMAND_UNDO = 'Type /brigade level 1, or move the slider'

const fixedEntry = (source: Source, pick: string, why: string, undo: string): EntryInput => ({
  source, waiting: false, work: SLIDER_WORK, question: SLIDER_QUESTION, options: [...LEVEL_OPTIONS], pick, why, undo, revisit: '', answers: '',
})
/** A slider press's Owner entry, with the new level as pick. */
export const ownerEntry = (l: Level) => fixedEntry('owner', levelOption(l), OWNER_WHY, OWNER_UNDO)
/** A level command's Owner entry (issue 464), with the new level as pick. It holds no goal. */
export const commandEntry = (l: Level) => fixedEntry('owner', levelOption(l), COMMAND_WHY, COMMAND_UNDO)
/** A reset's Pane entry: at a module reload or, in a log written before
 *  0.116.0 (issue 504), a compaction of the lead, or, in a log written before
 *  0.88.0 (spec 402 rev 6.2), at a new showing of the pane. */
export const paneEntry = (why: PaneWhy) => fixedEntry('pane', levelOption(1), PANE_WHYS[why], PANE_UNDO)
/** An alarm's entry, with the level found as pick. The pane stopped writing
 *  these in issue 504; the shape stays so an old log's alarm still reads. */
export const alarmEntry = (found: Level) => fixedEntry('alarm', levelOption(found), ALARM_WHY, PANE_UNDO)

/** Whether an entry is in its source's fixed shape: always true for a Lead
 *  or Relayed entry, which the tool's own check holds. A log written before
 *  a rename holds that name's options throughout, and only a whole old shape
 *  reads as one: never a mix, and never a command entry under the first old
 *  name, which no build wrote. */
export function inFixedShape(e: DecisionEntry): boolean {
  if (e.source === 'lead' || e.source === 'relayed') return true
  const old = OLD_LEVEL_OPTIONS.find(s => e.options.length === s.options.length && e.options.every((o, i) => o === s.options[i]))
  const options = old?.options ?? LEVEL_OPTIONS
  const picked = levelFrom(options.indexOf(e.pick) + 1)
  const built =
    e.source === 'owner'
      ? (e.why === COMMAND_WHY && (old?.command ?? true) ? commandEntry : ownerEntry)(picked)
      : e.source === 'pane'
        ? paneEntry((Object.keys(PANE_WHYS) as PaneWhy[]).find(k => PANE_WHYS[k] === e.why) ?? 'shown')
        : alarmEntry(picked)
  const want = { ...built, options, pick: options[levelFrom(LEVEL_OPTIONS.indexOf(built.pick) + 1) - 1] }
  return (
    options.includes(e.pick) &&
    e.pick === want.pick &&
    // Only an Owner entry carries a level above 1; the pane writes Pane and alarm entries at 1.
    (e.source === 'owner' || e.level === 1) &&
    e.waiting === want.waiting &&
    e.work === want.work &&
    e.question === want.question &&
    e.options.length === want.options.length &&
    e.options.every((o, i) => o === want.options[i]) &&
    e.why === want.why &&
    e.undo === want.undo &&
    e.revisit === want.revisit &&
    e.answers === want.answers
  )
}

// --- the level command (issue 464, spec v5 S4.2) --------------------------------
//
// `/brigade level 1`, `/brigade level 2` or `/brigade level 3 <goal>`, which
// acts only on a run the engine stamps as the owner's Enter at the prompt or
// a message through the Remote Control bridge. A 3 it sets counts as
// confirmed, with its goal, while its time is the press time. Each refusal is
// a fixed line holding nothing the owner typed.

export const GOAL_MAX = 300
export const LEVEL_REPLIES = {
  notTyped: 'Not set: /brigade level counts only when the owner types it at the prompt or sends it from the phone.',
  needsGoal: 'Not set: a 3 needs a goal: /brigade level 3 <the goal, by repository and issue>',
  goalLong: `Not set: a goal holds at most ${GOAL_MAX} characters`,
  usage: 'Not set: type /brigade level 1, /brigade level 2 or /brigade level 3 <goal>',
  notLogged: 'Not set: the decision log could not be written',
  overtaken: 'Not set: the level changed while the command was logged',
  failed: 'Not set: the level command failed',
  notOffered: ' The lead cannot read it until the Brigade pane opens: type /brigade.',
} as const

const LEVEL_ARGS = /^level(?:\s+([\s\S]*))?$/i
/** Whether `/brigade`'s args are the level command: the word `level`, alone
 *  or before a space. Read before the origin gate, and nothing more of the args. */
export const isLevelCommand = (args: unknown): boolean => typeof args === 'string' && LEVEL_ARGS.test(args.trim())

/** The level command in `/brigade`'s args, or undefined when the args are not
 *  one (today's path, which opens the pane). The goal is cleaned as `oneLine`
 *  cleans, with nothing cut: one past GOAL_MAX characters refuses. */
export function parseLevelCommand(args: string): { level: Level; goal?: string } | { refused: string } | undefined {
  const m = LEVEL_ARGS.exec(args.trim())
  if (m === null) return undefined
  const w = /^(\S+)(?:\s+([\s\S]*))?$/.exec(m[1] ?? '')
  if (w === null) return { refused: LEVEL_REPLIES.usage }
  const after = w[2] ?? ''
  if (w[1] === '1' || w[1] === '2') return after === '' ? { level: w[1] === '1' ? 1 : 2 } : { refused: LEVEL_REPLIES.usage }
  if (w[1] !== '3') return { refused: LEVEL_REPLIES.usage }
  const goal = oneLine(after, Number.MAX_SAFE_INTEGER)
  if (goal === '') return { refused: LEVEL_REPLIES.needsGoal }
  if ([...goal].length > GOAL_MAX) return { refused: LEVEL_REPLIES.goalLong }
  return { level: 3, goal }
}

/** Whether a run's origin is the owner's own: their Enter at the prompt, or a
 *  message through the Remote Control bridge. Anything else, none included, is not. */
export const levelOriginAllowed = (origin: unknown): boolean => isRecord(origin) && (origin.kind === 'composer' || origin.kind === 'bridge')

/** Whether a 3 counts as set by the command (S4.1): its time is the live press
 *  time, the level in force is 3, and no raise is in flight. Read every time, never kept. */
export const commandHolds = (o: { commanded: { at: number; goal: string } | undefined; pressAt: number | undefined; level: Level; raising: boolean }): boolean =>
  o.commanded !== undefined && o.pressAt !== undefined && o.commanded.at === o.pressAt && o.level === 3 && !o.raising

// --- the project digest (S5.1) -------------------------------------------------

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]

/** The SHA-256 of a text's UTF-8 bytes, in hex: plain and unkeyed. */
export function sha256Hex(input: string): string {
  const data = new TextEncoder().encode(input)
  const len = data.length
  const blocks = Math.ceil((len + 9) / 64)
  const buf = new Uint8Array(blocks * 64)
  buf.set(data)
  buf[len] = 0x80
  const view = new DataView(buf.buffer)
  view.setUint32(buf.length - 8, Math.floor(len / 0x20000000))
  view.setUint32(buf.length - 4, (len * 8) >>> 0)
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
  const w = new Uint32Array(64)
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  for (let b = 0; b < blocks; b++) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(b * 64 + i * 4)
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15] ?? 0
      const c = w[i - 2] ?? 0
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)
      const s1 = rotr(c, 17) ^ rotr(c, 19) ^ (c >>> 10)
      w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) >>> 0
    }
    let [a, bb, c, d, e, f, g, hh] = h as [number, number, number, number, number, number, number, number]
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + s1 + ch + (K[i] ?? 0) + (w[i] ?? 0)) >>> 0
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & bb) ^ (a & c) ^ (bb & c)
      const t2 = (s0 + maj) >>> 0
      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = bb
      bb = a
      a = (t1 + t2) >>> 0
    }
    const add = [a, bb, c, d, e, f, g, hh]
    for (let i = 0; i < 8; i++) h[i] = ((h[i] ?? 0) + (add[i] ?? 0)) >>> 0
  }
  return h.map(x => x.toString(16).padStart(8, '0')).join('')
}

/** The project digest: the SHA-256 of the name of the folder that holds this
 *  session's transcript, from the session-start record the mod keeps, only
 *  when that record's session id is the current one; else null. The name is
 *  never stored. */
export function projectDigest(start: { sessionId: unknown; transcript: unknown }, sessionId: string): string | null {
  if (typeof start.sessionId !== 'string' || typeof start.transcript !== 'string' || start.sessionId !== sessionId || !SESSION_ID.test(sessionId)) return null
  const m = /^.+[\\/]projects[\\/]([^\\/]+)[\\/]([^\\/]+)\.jsonl$/.exec(start.transcript)
  return m !== null && m[2] === sessionId && m[1] !== undefined ? sha256Hex(m[1]) : null
}
