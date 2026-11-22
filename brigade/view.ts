import { AHEAD_MS, PR_NUMBER, PR_STATES, REPO, SESSION_ID, foldsCase, linearUrl, linkUrl, oneLine, parseLinear, parseLink, pathKey, placeSummary, projectFolder, sepOf, sessionRow, statRejection } from './roster.ts'
import type { GhPr, LinkParts, Move, SessionRow, StatAnswer } from './roster.ts'
import { sha256Hex } from './decisions.ts'
import type { Meter, Pair, Sample, UsageCategory, UsageLimit, UsageSnapshot, Warmth } from './types'

// What the Brigade pane draws, worked out from plain values: the render hook
// in register.tsx only turns these results into elements. Plain TypeScript
// with erasable syntax only and no engine import, so `node --test` imports
// this file as it is.
//
// The to-dos: a tick that can be undone for a grace period, then moves the
// to-do to done.
//
// The cache warmth: each card's ◆ line, read from the last real model call in
// its session's summary file or transcript, and which of them the live poll
// reads.
//
// The call series and the context meter: what one read of a transcript gives
// beyond the last call, stored as each card's meters record, and the meter
// drawn from it under the cache bar.
//
// Burn rate and card tabs: the burn sparkline drawn from the stored meter, in a
// tab of its own beside the Context trend tab (the context outlook), and which
// tab each card shows.
//
// The usage summary writer: which steps count, the numbers kept in module
// memory, the summary file's shape and strict check, its byte cap, and the
// throttle and single-flight decision; brigade/writer.ts feeds them.
//
// The transcript finder: where a member's transcript is, from its working
// directory or, after it moved into a worktree, from the worktree folders of
// its launch folder, each checked to lie where its name says before a read.
//
// The usage section: this session's own rate limits and context fill, at the
// bottom of the pane. On the terminal it is rows of text bars. Everywhere else
// it is an SVG image, built here as a string. Every piece of text in that
// string goes through `svgText`, and every attribute value is a number or
// percentage this module worked out (`num`, `pct`), or a fixed name: a class
// from `STYLE`, a clip id (`cb` for the usage image, `st` for the status
// strip), `end`, the one gap transform. The test's attribute allowlist holds
// every image this module builds to those forms: the usage image, the status
// strip, the to-do bar, the cache bar, the context meter and the two
// sparklines.

/** A snapshot before the first reading: what the pane holds until one comes. */
export const EMPTY_USAGE: UsageSnapshot = { limits: [], context: {} }

// What a stored snapshot may hold. A reading comes from the engine, and a
// rate limit's kind may come from a gateway, so each field is checked and cut
// here as well as where it is drawn. Plugin state is readable by other
// plugins, so only the fields the view draws are kept.
const MAX_LIMITS = 20
const MAX_CATEGORIES = 50
const MAX_STORED_TEXT = 200
const MAX_PERCENT = 100000
const MAX_TOKENS = 1e10

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const inRange = (v: unknown, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max
const storedText = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_STORED_TEXT

// One rate limit, one context and one list of breakdown rows, each checked.
// A reading names a limit's percent `percentUsed`; a stored snapshot, `percent`.
function limitsFrom(rows: unknown, percentKey: 'percentUsed' | 'percent'): UsageLimit[] {
  const out: UsageLimit[] = []
  if (!Array.isArray(rows)) return out
  for (const r of rows.slice(0, MAX_LIMITS)) {
    if (!isRecord(r) || !storedText(r.kind) || !inRange(r[percentKey], MAX_PERCENT)) continue
    const limit: UsageLimit = { kind: r.kind, percent: r[percentKey] as number }
    if (typeof r.resetsAt === 'string' && r.resetsAt.length <= 40) limit.resetsAt = r.resetsAt
    out.push(limit)
  }
  return out
}

function contextFrom(ctx: unknown): UsageSnapshot['context'] {
  const out: UsageSnapshot['context'] = {}
  if (!isRecord(ctx)) return out
  if (inRange(ctx.percent, MAX_PERCENT)) out.percent = ctx.percent
  if (inRange(ctx.tokens, MAX_TOKENS)) out.tokens = ctx.tokens
  if (inRange(ctx.window, MAX_TOKENS)) out.window = ctx.window
  return out
}

function categoriesFrom(rows: unknown[]): UsageCategory[] {
  const out: UsageCategory[] = []
  for (const c of rows.slice(0, MAX_CATEGORIES)) {
    if (!isRecord(c) || !storedText(c.name) || typeof c.kind !== 'string' || !KINDS.has(c.kind) || !inRange(c.tokens, MAX_TOKENS)) continue
    out.push({ name: c.name, kind: c.kind, tokens: c.tokens })
  }
  return out
}

/** The fields the view draws from a `$.session.usage()` reading, each checked:
 *  per rate limit its kind, percent and reset time; the context's percent,
 *  tokens and window; per breakdown row its name, kind and tokens. A field
 *  that fails its check is left out, and a row whose kind or number fails is
 *  dropped. */
export function snapshotFrom(reading: unknown): UsageSnapshot {
  if (!isRecord(reading)) return { limits: [], context: {} }
  const out: UsageSnapshot = { limits: limitsFrom(reading.rateLimits, 'percentUsed'), context: contextFrom(reading.context) }
  const b = isRecord(reading.context) ? reading.context.breakdown : undefined
  if (isRecord(b) && Array.isArray(b.categories)) out.categories = categoriesFrom(b.categories)
  return out
}

/** A stored snapshot checked again before it is drawn, by the same rules.
 *  Only `snapshotFrom` writes it, but plugin state is the engine's, and the
 *  engine lets another plugin rewrite a value as it is set: a value of the
 *  wrong shape draws as far as it checks, and never throws. */
export function storedSnapshot(stored: unknown): UsageSnapshot {
  if (!isRecord(stored)) return { limits: [], context: {} }
  const out: UsageSnapshot = { limits: limitsFrom(stored.limits, 'percent'), context: contextFrom(stored.context) }
  if (Array.isArray(stored.categories)) out.categories = categoriesFrom(stored.categories)
  return out
}
const KINDS = new Set(['used', 'free', 'buffer', 'deferred'])

// The names the app gives its own windows. Looked up in a Map, never a plain
// object: a kind is free text, and on a plain object `constructor` or
// `toString` would answer with a function.
const LIMIT_NAMES = new Map([
  ['five_hour', 'Current session'],
  ['seven_day', 'Weekly limit'],
  ['spend_limit', 'Spend limit'],
])
const MAX_KIND = 30
const MAX_CATEGORY = 60

/** A rate limit's name as drawn: the app's own for a window it knows, else
 *  its kind made safe to draw on one line and cut to 30 characters. */
export const limitName = (kind: string): string => LIMIT_NAMES.get(kind) ?? oneLine(kind, MAX_KIND)

// An ISO 8601 time with seconds and either Z or an offset, read by hand so
// every engine reads it alike.
const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/

function isoTime(text: string): number | undefined {
  const m = ISO.exec(text)
  if (m === null) return undefined
  const [, y, mo, d, h, mi, s, frac, zone] = m
  const month = Number(mo)
  const day = Number(d)
  const hour = Number(h)
  const minute = Number(mi)
  const second = Number(s)
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return undefined
  const ms = frac === undefined ? 0 : Number(frac.padEnd(3, '0').slice(0, 3))
  let at = Date.UTC(Number(y), month - 1, day, hour, minute, second, ms)
  if (zone !== undefined && zone !== 'Z') {
    const sign = zone.startsWith('-') ? -1 : 1
    const zh = Number(zone.slice(1, 3))
    const zm = Number(zone.slice(4, 6))
    if (zh > 23 || zm > 59) return undefined
    at -= sign * (zh * 60 + zm) * 60000
  }
  // Date.UTC rolls 31 April over to 1 May; a day that rolled is refused.
  return new Date(Date.UTC(Number(y), month - 1, day)).getUTCDate() === day && Number.isFinite(at) ? at : undefined
}

/** "Resets in N d N hr", "Resets in N hr N min" or "Resets in N min", or
 *  undefined when the time is missing or not a valid ISO time. A time in the
 *  past reads as 0 min. */
export function resetsIn(iso: string | undefined, now: number): string | undefined {
  if (iso === undefined) return undefined
  const at = isoTime(iso)
  if (at === undefined || !Number.isFinite(now)) return undefined
  const mins = Math.max(0, Math.round((at - now) / 60000))
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  return `Resets in ${d > 0 ? `${d} d ${h} hr` : h > 0 ? `${h} hr ${m} min` : `${m} min`}`
}

/** A token count as the pane draws it: "Nk" from 10,000, "N.Nk" from 1,000,
 *  and "N" below that. */
export function tokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0'
  if (n >= 10000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(Math.floor(n / 100) / 10).toFixed(1)}k`
  return `${Math.round(n)}`
}

const percentText = (p: number) => `${Math.round(p)}%`

// From 75% a bar is amber, from 90% red.
const level = (p: number) => (p >= 90 ? 'hot' : p >= 75 ? 'warn' : 'ok')
const TONE = new Map([
  ['ok', 'success'],
  ['warn', 'warning'],
  ['hot', 'error'],
])

/** One row of the terminal's text bars. `tone` is a theme colour key, for
 *  `bar`. `ahead` is drawn dim after it: the projection's ░ cells, then the
 *  blanks; the two together are always 20 cells, and with no projection
 *  `bar` is all 20 and `ahead` is empty. `noteTone` is a theme colour key for
 *  the note, or empty for a dim note. */
export type UsageRow = { name: string; bar: string; ahead: string; percent: string; note: string; tone: string; noteTone: string }

/** What the usage section draws: nothing yet, text bars, or an SVG image.
 *  The image has a fixed height and no width: it is placed in percentages,
 *  so it takes the width of the box it is drawn in. */
export type UsageView =
  | { kind: 'none' }
  | { kind: 'text'; rows: UsageRow[] }
  | { kind: 'svg'; source: string; alt: string; height: number }

const BAR_CELLS = 20

// The partial cells, one to seven eighths full.
const EIGHTHS = ['▏', '▎', '▍', '▌', '▋', '▊', '▉']

/** A terminal bar of `cells` cells: full blocks, one partial block to the
 *  nearest eighth of a cell, then blanks. The fraction is clamped to between
 *  0 and 1, and one that is not a finite number is 0. It never throws and
 *  always returns exactly `cells` characters, the end marks left to the
 *  caller; a cell count that is not a positive whole number gives an empty
 *  string. */
export function eighthBar(fraction: number, cells: number): string {
  const n = Number.isInteger(cells) && cells > 0 ? cells : 0
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0
  const eighths = Math.round(f * n * 8)
  const full = Math.floor(eighths / 8)
  const part = EIGHTHS[(eighths % 8) - 1] ?? ''
  const drawn = '█'.repeat(full) + part
  return drawn + ' '.repeat(n - [...drawn].length)
}

/** The engine's cap on an SVG's source. */
export const SVG_MAX = 131072
/** The most breakdown rows the legend lists. */
export const LEGEND_MAX = 12

/** The breakdown rows the context bar draws: not the tools loaded on demand,
 *  which sit outside the window, and not a row with no tokens. */
const drawnCategories = (s: UsageSnapshot) =>
  (s.categories ?? []).filter(c => c.kind !== 'deferred' && Number.isFinite(c.tokens) && c.tokens > 0)

/** The usage section for one surface at one moment, from the stored snapshot,
 *  checked again here. With no rate limit, no breakdown and no context reading
 *  it is nothing yet, on every surface. The terminal gets text bars: a Context
 *  row from the context's percent and tokens, then a row per rate limit. Every
 *  other surface gets the SVG, or the text bars when there is no rate limit
 *  and no breakdown to draw or the SVG would pass the engine's cap. max is
 *  that cap; the stored caps keep a real snapshot far below it, so a test
 *  passes a smaller one to reach the fallback. `samples` is the stored
 *  sample buffer, checked again here, for the session limit's projection. */
export function usageView(stored: unknown, surface: string, now: number, max = SVG_MAX, samples: unknown = []): UsageView {
  const s = storedSnapshot(stored)
  if (s.limits.length === 0 && drawnCategories(s).length === 0 && s.context.percent === undefined) return { kind: 'none' }
  const kept = samplesFrom(samples)
  if (surface !== 'terminal') {
    const svg = usageSvg(s, now, kept)
    if (svg !== undefined && svg.source.length <= max) return svg
  }
  const rows = textRows(s, now, kept)
  return rows.length === 0 ? { kind: 'none' } : { kind: 'text', rows }
}

function textRows(s: UsageSnapshot, now: number, samples: readonly Sample[]): UsageRow[] {
  const rows: Omit<UsageRow, 'name'>[] = []
  const names: string[] = []
  const cells = (p: number) => eighthBar(p / 100, BAR_CELLS)
  const { percent, tokens: used, window } = s.context
  if (percent !== undefined && Number.isFinite(percent)) {
    names.push('Context')
    rows.push({
      bar: cells(percent),
      ahead: '',
      percent: percentText(percent),
      note: used !== undefined && window !== undefined ? `${tokens(used)} of ${tokens(window)}` : '',
      tone: TONE.get(level(percent)) ?? 'success',
      noteTone: '',
    })
  }
  for (const limit of s.limits) {
    if (!Number.isFinite(limit.percent)) continue
    names.push(limitName(limit.kind))
    const p = projection(limit, samples, now)
    rows.push({
      ...projectedCells(limit.percent, p),
      percent: percentText(limit.percent),
      note: p?.earlyMs !== undefined ? earlyText(p.earlyMs) : (resetsIn(limit.resetsAt, now) ?? ''),
      tone: TONE.get(level(limit.percent)) ?? 'success',
      noteTone: p?.earlyMs !== undefined ? 'error' : '',
    })
  }
  const width = Math.max(0, ...names.map(n => [...n].length))
  return rows.map((r, i) => ({ name: (names[i] ?? '').padEnd(width), ...r }))
}

// The image cannot read the app's theme, so it carries a palette of its own
// that only approximates the app's, with a dark-mode rule. The class names
// here are the only ones the SVG uses. Exported so the allowlist test can
// hold every image's style block to exactly this text.
export const STYLE = [
  "text{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:12px;fill:#3d3d3a}",
  '.muted{fill:#73726c}',
  '.track{fill:#e8e6dc}',
  '.ok{fill:#2c84db}.warn{fill:#c27c0e}.hot{fill:#c6413a}',
  // An idle session: a paler amber than warn's in each theme, so the two segments read as two.
  '.idle{fill:#e8c98a}',
  // The usage projection: a faint form of ok's blue.
  '.proj{fill:#a9cdf0}',
  '.done{fill:#3f8f4f}.stopped{fill:#9c9a92}',
  '.free{fill:#e8e6dc}.buffer{fill:#d6d3c8}',
  // The hairline between cards.
  '.rule{fill:#e0ded6}',
  // A PR pill, as Desktop draws its own: a tint of the state and its ink.
  '.tint-open{fill:#dff3e4}.tint-draft{fill:#e8e6dc}.tint-merged{fill:#ece6fb}.tint-closed{fill:#fbe3e1}',
  '.ink-open,.ink-draft,.ink-merged,.ink-closed{font-size:11px;font-weight:500}.ink-open{fill:#2f7d3f}.ink-draft{fill:#6b6a64}.ink-merged{fill:#6f4fc9}.ink-closed{fill:#c6413a}',
  '.c0{fill:#d97757}.c1{fill:#6a9bcc}.c2{fill:#788c5d}.c3{fill:#c46686}.c4{fill:#8b7fc7}.c5{fill:#c9a227}.c6{fill:#5fa8a0}',
  '@media (prefers-color-scheme: dark){text{fill:#e8e6e1}.muted{fill:#9c9a92}.track,.free{fill:#3a3935}.buffer{fill:#4a4944}.ok{fill:#5aa2ef}.proj{fill:#2f5f8f}.warn{fill:#e8a23a}.idle{fill:#8f6a24}.hot{fill:#ef6b62}.done{fill:#62b56f}.stopped{fill:#6b6a64}.tint-open{fill:#1f3a26}.tint-draft{fill:#3a3935}.tint-merged{fill:#2e2547}.tint-closed{fill:#3a1f1f}.ink-open{fill:#62b56f}.ink-draft{fill:#9c9a92}.ink-merged{fill:#a48be0}.ink-closed{fill:#ef6b62}.rule{fill:#333331}}',
].join('')

const XMLNS = 'http://www.w3.org/2000/svg'

// Code points XML forbids even escaped: a lone surrogate, U+FFFE and U+FFFF.
// One of them makes the whole image fail to draw. The controls XML forbids
// are gone already: the one-line cleaner makes them spaces.
const XML_INVALID = /[\u{D800}-\u{DFFF}\u{FFFE}\u{FFFF}]/gu
const XML_ESCAPE = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
])

/** Text made safe for the SVG's element content: the one-line cleaner, cut to
 *  `max`, then the code points XML forbids removed, then the XML escape. */
export function svgText(text: string, max: number): string {
  return oneLine(text, max)
    .replace(XML_INVALID, '')
    .replace(/[&<>"']/g, ch => XML_ESCAPE.get(ch) ?? '')
}

/** A number as an attribute value: finite, clamped to the drawing's range and
 *  rounded to two places, so no NaN or Infinity is ever written. */
export function num(v: number, max = 100000): string {
  const n = Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : 0
  return String(Math.round(n * 100) / 100)
}

/** A number as a percentage attribute value: `num` up to 100, then `%`. */
export const pct = (v: number): string => `${num(v, 100)}%`

// A name on the left, a note on the right, and a thin rounded bar beneath,
// placed in percentages so the row spans the image's width. A projection is a
// faint bar from 0 to the projected percent, capped at 100%, drawn under the
// fill: the fill covers it up to the bar's end, so what shows is the part from
// the bar's end to the projected percent. An early note is red, else muted.
function barRow(y: number, name: string, right: string, percent: number, projected?: number, early = false): string {
  return (
    `<text x="0" y="${num(y + 12)}">${svgText(name, MAX_KIND)}</text>` +
    `<text class="${early ? 'hot' : 'muted'}" x="100%" y="${num(y + 12)}" text-anchor="end">${svgText(right, 80)}</text>` +
    `<rect class="track" x="0" y="${num(y + 20)}" width="100%" height="6" rx="3"/>` +
    (projected !== undefined ? `<rect class="proj" x="0" y="${num(y + 20)}" width="${pct(Math.min(100, projected))}" height="6" rx="3"/>` : '') +
    // A fill never narrower than 6 px: a pixel minimum cannot be written as
    // a percentage, so a fixed 6 px stub sits under the percentage fill, and
    // the two cover whichever is wider.
    (percent > 0
      ? `<rect class="${level(percent)}" x="0" y="${num(y + 20)}" width="6" height="6" rx="3"/>` +
        `<rect class="${level(percent)}" x="0" y="${num(y + 20)}" width="${pct(percent)}" height="6" rx="3"/>`
      : '')
  )
}

function usageSvg(s: UsageSnapshot, now: number, samples: readonly Sample[]): Extract<UsageView, { kind: 'svg' }> | undefined {
  const parts: string[] = []
  const alt: string[] = []
  let y = 0

  for (const limit of s.limits) {
    if (!Number.isFinite(limit.percent)) continue
    const name = limitName(limit.kind)
    const p = projection(limit, samples, now)
    const earlyNote = p?.earlyMs !== undefined ? earlyText(p.earlyMs) : undefined
    const when = earlyNote ?? resetsIn(limit.resetsAt, now)
    parts.push(barRow(y, name, when === undefined ? percentText(limit.percent) : `${when} · ${percentText(limit.percent)}`, limit.percent, p?.percent, earlyNote !== undefined))
    alt.push(
      `${name} ${percentText(limit.percent)}` +
        (p === undefined ? '' : `, on pace for ${percentText(p.percent)} at reset`) +
        (earlyNote === undefined ? '' : `, ${earlyNote}`),
    )
    y += 38
  }

  const shown = drawnCategories(s)
  if (shown.length > 0) {
    // The bar's segments are the breakdown's rows, free space and buffer
    // included. The figures beside it are the engine's own context reading,
    // the ones the terminal's Context row shows, so one reading shows one
    // figure everywhere; only without that reading are they summed from the
    // rows: used is the rows of kind `used`, the window every row drawn.
    const total = shown.reduce((sum, c) => sum + c.tokens, 0)
    const used = shown.filter(c => c.kind === 'used')
    const { percent: ctxPercent, tokens: ctxTokens, window: ctxWindow } = s.context
    const engine = ctxPercent !== undefined && ctxTokens !== undefined && ctxWindow !== undefined
    const usedTokens = engine ? ctxTokens : used.reduce((sum, c) => sum + c.tokens, 0)
    const windowTokens = engine ? ctxWindow : total
    const usedPercent = engine ? ctxPercent : total > 0 ? (usedTokens / total) * 100 : 0
    const cls = (c: UsageCategory) => (c.kind === 'free' ? 'free' : c.kind === 'buffer' ? 'buffer' : `c${Math.max(0, used.indexOf(c)) % 7}`)

    parts.push(`<text x="0" y="${num(y + 12)}">${svgText('Context', MAX_KIND)}</text>`)
    parts.push(
      `<text class="muted" x="100%" y="${num(y + 12)}" text-anchor="end">${svgText(`${tokens(usedTokens)} / ${tokens(windowTokens)} · ${percentText(usedPercent)}`, 80)}</text>`,
    )
    parts.push(`<clipPath id="cb"><rect x="0" y="${num(y + 20)}" width="100%" height="8" rx="4"/></clipPath>`)
    parts.push(`<rect class="track" x="0" y="${num(y + 20)}" width="100%" height="8" rx="4"/>`)
    const segments: string[] = []
    let x = 0
    for (const c of shown) {
      const w = total > 0 ? (c.tokens / total) * 100 : 0
      // A gap between used segments, as the app's segmented bar has. A gap
      // in pixels cannot be written in percentages, so the segment sits in a
      // nested <svg> and its rect moves 2 px left: the nested <svg> cuts off
      // what spills, leaving 2 px clear at its right edge at any width. `w`
      // is the segment's percentage of the bar; at 1% or less the 2 px gap
      // would eat most of it on a narrow pane, so it gets none.
      if (c.kind === 'used' && w > 1) {
        segments.push(
          `<svg x="${pct(x)}" y="${num(y + 20)}" width="${pct(w)}" height="8"><rect class="${cls(c)}" width="100%" height="8" transform="translate(-2 0)"/></svg>`,
        )
      } else {
        segments.push(`<rect class="${cls(c)}" x="${pct(x)}" y="${num(y + 20)}" width="${pct(w)}" height="8"/>`)
      }
      x += w
    }
    parts.push(`<g clip-path="url(#cb)">${segments.join('')}</g>`)
    y += 40

    // The legend: two columns of dot, name and tokens, at most LEGEND_MAX
    // rows. Each entry is a nested <svg> half the image wide, at 0 or 50%,
    // so its dot and name can sit a fixed number of pixels in; the right
    // column's entries sit 10 px further in, clear of the left column's
    // tokens.
    const legend = shown.slice(0, LEGEND_MAX)
    legend.forEach((c, i) => {
      const inset = (i % 2) * 10
      parts.push(
        `<svg x="${i % 2 === 0 ? '0' : '50%'}" y="${num(y + Math.floor(i / 2) * 18)}" width="50%" height="18">` +
          `<circle class="${cls(c)}" cx="${num(inset + 4)}" cy="8" r="4"/>` +
          `<text x="${num(inset + 14)}" y="12">${svgText(c.name, MAX_CATEGORY)}</text>` +
          `<text class="muted" x="100%" y="12" text-anchor="end">${svgText(tokens(c.tokens), 20)}</text>` +
          '</svg>',
      )
    })
    y += Math.ceil(legend.length / 2) * 18
    alt.push(`Context ${percentText(usedPercent)}: ${legend.map(c => `${oneLine(c.name, MAX_CATEGORY)} ${tokens(c.tokens)}`).join(', ')}`)
  }

  if (y === 0) return undefined
  // No viewBox: nothing is scaled, so text keeps its size, and the image
  // takes its box's width. Only the height is fixed.
  const height = num(y)
  const source = `<svg xmlns="${XMLNS}" width="100%" height="${height}">` + `<style>${STYLE}</style>${parts.join('')}</svg>`
  return { kind: 'svg', source, alt: oneLine(`Usage: ${alt.join('; ')}`, 2000), height: Number(height) }
}

// --- Usage projection --------------------------------------------------------
//
// Where the session limit and the weekly limit will be at reset if the
// current pace holds. Only `five_hour` and `seven_day` get one, each with a
// reset time `isoTime` reads; a kind a gateway names gets none. The session
// limit's pace is recent: the change across the samples the pane took of it
// in the last 30 minutes. The weekly limit's is its average since the week
// began, so it takes no samples. The samples are plugin state, which another
// plugin can rewrite, so every read goes through `samplesFrom`.

/** The least time between two samples of the session limit. */
export const SAMPLE_MS = 30000
/** The most samples kept: an hour at one every 30 s. */
export const MAX_SAMPLES = 120
const RECENT_MS = 30 * 60000
const MIN_SPAN_MS = 5 * 60000
const WEEK_MS = 7 * 24 * 3600000
const MIN_WEEK_MS = 3600000

/** The stored sample buffer, checked again: a list of at most 120 samples,
 *  each `at` a finite number and `percent` from 0 to 100, times increasing.
 *  A buffer that fails any check is treated as empty, whole: a buffer cut
 *  down to its good samples could hold a pace nobody measured. Each field is
 *  read once, and a read that throws counts as a failed check, so a value
 *  that changes or throws as it is read cannot pass or break it. */
export function samplesFrom(stored: unknown): Sample[] {
  try {
    if (!Array.isArray(stored)) return []
    // The length is read once and the list walked by position up to it,
    // never by its own walker, which could yield more than it reports.
    const length = stored.length
    if (typeof length !== 'number' || length > MAX_SAMPLES) return []
    const out: Sample[] = []
    for (let i = 0; i < length; i++) {
      const s: unknown = stored[i]
      if (!isRecord(s)) return []
      const at = s.at
      const percent = s.percent
      if (typeof at !== 'number' || !Number.isFinite(at) || !inRange(percent, 100)) return []
      const last = out[out.length - 1]
      if (last !== undefined && at <= last.at) return []
      out.push({ at, percent })
    }
    return out
  } catch {
    return []
  }
}

/** The buffer after a usage reading: the session limit's percent at `now`
 *  appended, at most one sample every 30 s and at most 120 kept. A percent
 *  lower than the last sample's means the window reset, and a last sample
 *  dated after `now` means the clock went back or the value was rewritten:
 *  either way the buffer starts over at this sample. A reading with no
 *  session limit, or one over 100%, which the check would refuse, adds
 *  nothing. */
export function addSample(stored: unknown, s: UsageSnapshot, now: number): Sample[] {
  const kept = samplesFrom(stored)
  const limit = s.limits.find(l => l.kind === 'five_hour')
  if (limit === undefined || !inRange(limit.percent, 100) || !Number.isFinite(now)) return kept
  const next = { at: now, percent: limit.percent }
  const last = kept[kept.length - 1]
  if (last === undefined || limit.percent < last.percent || now < last.at) return [next]
  if (now - last.at < SAMPLE_MS) return kept
  return [...kept, next].slice(-MAX_SAMPLES)
}

// Percent a millisecond, from the oldest sample in the last 30 minutes to the
// newest, or undefined when they are under 5 minutes apart. A sample dated
// after `now` is left out.
function recentPace(samples: readonly Sample[], now: number): number | undefined {
  const recent = samples.filter(x => x.at >= now - RECENT_MS && x.at <= now)
  const first = recent[0]
  const last = recent[recent.length - 1]
  if (first === undefined || last === undefined || last.at - first.at < MIN_SPAN_MS) return undefined
  return (last.percent - first.percent) / (last.at - first.at)
}

/** A limit's projection: the percent it will be at reset at the current
 *  pace, and past 100% how many milliseconds before the reset it runs out. */
export type Projection = { percent: number; earlyMs?: number }

/** The projection for one limit, or undefined: for a kind other than
 *  `five_hour` and `seven_day`, for a limit already run out, with no reset
 *  time to read or none still ahead, with too little to measure a pace from
 *  (under 5 minutes between
 *  the session limit's samples, under an hour since the weekly limit's week
 *  began), or when the pace is 0 or less. */
export function projection(limit: UsageLimit, samples: readonly Sample[], now: number): Projection | undefined {
  if (limit.kind !== 'five_hour' && limit.kind !== 'seven_day') return undefined
  // A limit at or over 100%, as its row draws it rounded, has run out: no
  // projection, so its row keeps the reset time, when it comes back (owner
  // decision q1 A).
  if (Math.round(limit.percent) >= 100) return undefined
  const reset = limit.resetsAt === undefined ? undefined : isoTime(limit.resetsAt)
  if (reset === undefined || !Number.isFinite(now) || !Number.isFinite(limit.percent) || reset <= now) return undefined
  let pace: number | undefined
  if (limit.kind === 'five_hour') {
    pace = recentPace(samples, now)
  } else {
    const since = now - (reset - WEEK_MS)
    pace = since >= MIN_WEEK_MS ? limit.percent / since : undefined
  }
  if (pace === undefined || !Number.isFinite(pace) || pace <= 0) return undefined
  const percent = limit.percent + pace * (reset - now)
  if (!Number.isFinite(percent)) return undefined
  if (percent <= 100) return { percent }
  const earlyMs = reset - (now + (100 - limit.percent) / pace)
  return Number.isFinite(earlyMs) ? { percent, earlyMs } : { percent }
}

/** A span as the early note reads it: minutes under an hour, hours under a
 *  day, then days, each rounded, and never under 1 minute. A span that is not
 *  a finite number reads as 1 minute. */
export function roughTime(ms: number): string {
  const mins = Number.isFinite(ms) ? Math.max(1, Math.round(ms / 60000)) : 1
  if (mins >= 1440) return `${Math.round(mins / 1440)} d`
  if (mins >= 60) return `${Math.round(mins / 60)} hr`
  return `${mins} min`
}

const earlyText = (ms: number) => `runs out about ${roughTime(ms)} early`

// A limit's terminal cells: its bar, then with a projection the ░ cells from
// the bar's end to the projected percent, capped at 20 cells, then blanks.
function projectedCells(percent: number, p: Projection | undefined): { bar: string; ahead: string } {
  const full = eighthBar(percent / 100, BAR_CELLS)
  if (p === undefined) return { bar: full, ahead: '' }
  const bar = full.trimEnd()
  const used = [...bar].length
  const to = Math.round((Math.min(100, Math.max(0, p.percent)) / 100) * BAR_CELLS)
  const cells = Math.max(0, to - used)
  return { bar, ahead: '░'.repeat(cells) + ' '.repeat(BAR_CELLS - used - cells) }
}

// --- Tick and undo ---------------------------------------------------------
//
// A press on a to-do's box ticks it: the to-do stays, crossed out, for the
// grace period, and a second press inside it undoes the tick. The roster
// timer's sweep then moves it to done. `ticking` holds pairs of to-do id and
// tick time, in epoch ms as text.

/** How long a ticked to-do stays, crossed out, before the sweep moves it. */
export const GRACE_MS = 30000
const MAX_TICKS = 50

/** The stored ticks, checked again: a list of pairs whose name is text within
 *  the stored cap, the first of a repeated name kept, at most 50. A value
 *  that is not text is kept as an empty value, which the sweep counts as due.
 *  Plugin state is the engine's, and another plugin may rewrite it. */
export function ticksFrom(stored: unknown): Pair[] {
  const out: Pair[] = []
  if (!Array.isArray(stored)) return out
  const names = new Set<string>()
  for (const p of stored) {
    if (out.length >= MAX_TICKS) break
    if (!isRecord(p) || typeof p.name !== 'string' || p.name === '' || p.name.length > MAX_STORED_TEXT || names.has(p.name)) continue
    names.add(p.name)
    out.push({ name: p.name, value: typeof p.value === 'string' ? p.value : '' })
  }
  return out
}

/** The stored done list, checked again: the text entries of a list, and
 *  nothing from any other shape, so a value another plugin wrote cannot make
 *  the render throw. */
export function idsFrom(stored: unknown): string[] {
  return Array.isArray(stored) ? stored.filter((v): v is string => typeof v === 'string') : []
}

/** A press: tick the to-do with the press time, or undo its tick. */
export function toggleTick(stored: unknown, id: string, now: number): Pair[] {
  const ticking = ticksFrom(stored)
  return ticking.some(p => p.name === id) ? ticking.filter(p => p.name !== id) : [...ticking, { name: id, value: String(now) }]
}

// Due: the grace period has passed, the time is not a number, or the time is
// more than a grace period ahead of the clock, so a planted far-future time
// cannot keep a to-do crossed out for good.
const isDue = (p: Pair, now: number) => {
  const age = now - Number(p.value)
  return !Number.isFinite(age) || age >= GRACE_MS || age <= -GRACE_MS
}

/** The sweep: a tick whose to-do is no longer in the roster is dropped, a due
 *  one moves to `done`, and the rest stay. `todoIds` is undefined when the
 *  roster load failed or found no file: then every tick stays, due ones too,
 *  so a brief miss cannot silently undo a tick. */
export function sweepTicks(stored: unknown, now: number, todoIds: readonly string[] | undefined): { ticking: Pair[]; done: string[] } {
  const ticking = ticksFrom(stored)
  if (todoIds === undefined) return { ticking, done: [] }
  const present = new Set(todoIds)
  const kept: Pair[] = []
  const done: string[] = []
  for (const p of ticking) {
    if (!present.has(p.name)) continue
    if (isDue(p, now)) done.push(p.name)
    else kept.push(p)
  }
  return { ticking: kept, done }
}

/** One write to a stored value, as the engine's `update` makes it: the
 *  function may run more than once, and the last run's result is written. */
export type Updater<T> = (fn: (value: T) => T) => Promise<unknown>

/** The roster timer's sweep, carried out. The due ids are worked out inside
 *  the `ticking` update, from the value that update writes over, so an undo
 *  that lands between a read and a write cannot be lost to a stale read. Then
 *  those ids, and no others, are added to `doneTodos`, each once. With no
 *  roster load to go by (`todoIds` undefined) nothing is written. Resolves the
 *  ids it moved. */
export async function settleTicks(
  ticking: Updater<Pair[]>,
  doneTodos: Updater<string[]>,
  now: number,
  todoIds: readonly string[] | undefined,
): Promise<string[]> {
  if (todoIds === undefined) return []
  let due: string[] = []
  await ticking(list => {
    const swept = sweepTicks(list, now, todoIds)
    due = swept.done
    return swept.ticking
  })
  if (due.length > 0) {
    const moved = due
    await doneTodos(list => {
      const had = idsFrom(list)
      const seen = new Set(had)
      return [...had, ...moved.filter(id => !seen.has(id))]
    })
  }
  return due
}

// --- Severity groups --------------------------------------------------------
//
// The cards sit in two groups by the status the head chef wrote: Working
// (working and idle) and Done · stopped. Any group folds on a press, and
// STARTS_FOLDED in register.tsx says which start folded. The stored
// roster is drawn as stored, and another plugin can rewrite it, so a status is
// read only through the fixed Map below: one outside the four words, or one
// that names a prototype key, has no look and counts nowhere. No key, class or
// text is ever built from the status text.

/** How a status draws: its glyph, word, theme colour key, SVG class and
 *  group. Colour is never the only signal: the glyph and word go with it. */
export type StatusLook = {
  glyph: string
  word: string
  color: string
  cls: string
  group: 'working' | 'finished'
}

/** The four stored statuses: working, idle, done, stopped, in the strip's and
 *  legend's display order (`LOOK_ORDER`). An older roster's `needs-you` is
 *  read as `idle` before it gets here (`card()` in roster.ts). */
export const STATUS: ReadonlyMap<string, StatusLook> = new Map([
  ['working', { glyph: '◐', word: 'working', color: 'suggestion', cls: 'ok', group: 'working' }],
  ['idle', { glyph: '○', word: 'idle', color: 'warning', cls: 'idle', group: 'working' }],
  ['done', { glyph: '✓', word: 'done', color: 'success', cls: 'done', group: 'finished' }],
  ['stopped', { glyph: '–', word: 'stopped', color: 'inactive', cls: 'stopped', group: 'finished' }],
] as const)

/** The look of an idle card: a stored `idle` and a working card whose session
 *  is idle or waiting (see `movedLook`) draw the same. */
export const IDLE_LOOK: StatusLook = STATUS.get('idle') as StatusLook

/** The looks in the strip's and legend's display order: working, idle, done,
 *  stopped. */
export const LOOK_ORDER: readonly StatusLook[] = [...STATUS.values()]

/** A stored status's look, or undefined for anything but the four words. */
export const statusOf = (status: unknown): StatusLook | undefined =>
  typeof status === 'string' ? STATUS.get(status) : undefined

/** A card and its place in the roster. Every button a card draws keys on that
 *  place, never its place inside a group: the press handler finds a card by
 *  roster place and title slug, and the slug folds many titles to one. */
export type Placed<T> = { c: T; i: number }
export type Groups<T> = { working: Placed<T>[]; finished: Placed<T>[] }

/** The stored cards in their groups, each in roster order. A card whose title
 *  is in `hidden`, the dismissed ones, is in none unless it is drawn idle,
 *  and a card that is not a record or has no look is in none; cards that are
 *  not a list give two empty groups. A working card the poll moved (see
 *  `movedLook`) is in the group of its move. */
export function groupCards<T>(cards: readonly T[], hidden: ReadonlySet<unknown>, moves?: Moves, waitHidden?: ReadonlySet<unknown>): Groups<T> {
  const out: Groups<T> = { working: [], finished: [] }
  if (!Array.isArray(cards)) return out
  cards.forEach((c, i) => {
    const look = shownLook(c, hidden, moves, waitHidden)
    if (look !== undefined) out[look.group].push({ c, i })
  })
  return out
}

/** Where the live poll moved cards, by card title. */
export type Moves = ReadonlyMap<string, Move>

/** The moves the stored live entries hold, by card title. */
export function movesFrom(list: readonly Live[]): Moves {
  return new Map(list.flatMap(l => (l.move === undefined ? [] : [[l.name, l.move] as const])))
}

/** The look a card's move gives it, or undefined: a move applies only while
 *  the card's own status is `working`, so a status the head chef wrote since
 *  the poll holds. A move to `waiting` or `idle` draws as `IDLE_LOOK`. */
export function movedLook(c: unknown, moves: Moves | undefined): StatusLook | undefined {
  if (moves === undefined || !isRecord(c) || c.status !== 'working' || typeof c.title !== 'string') return undefined
  const move = moves.get(c.title)
  return move === 'waiting' || move === 'idle' ? IDLE_LOOK : undefined
}

/** Whether a card draws idle: a stored `idle`, or a working card the poll
 *  moved to `waiting` or `idle`. Dismiss, Ask and the checkbox all ask this. */
export const isIdle = (c: unknown, moves: Moves | undefined): boolean =>
  isRecord(c) && (movedLook(c, moves) ?? statusOf(c.status)) === IDLE_LOOK

/** A stored card's look when the pane shows it: a record with one of the four
 *  statuses, or a working card's moved look (see `movedLook`), that is not
 *  dismissed, or is drawn idle; else undefined. The groups, the heading and the
 *  status strip all count cards by this one rule. */
function shownLook(c: unknown, hidden: ReadonlySet<unknown>, moves?: Moves, waitHidden?: ReadonlySet<unknown>): StatusLook | undefined {
  if (!isRecord(c)) return undefined
  const look = movedLook(c, moves) ?? statusOf(c.status)
  if (look === undefined) return undefined
  // A card drawn idle is never hidden by `hidden`, whatever was dismissed. Only
  // `waitHidden`, which the pane keeps in its own memory for one wait (issue
  // 513, S9), hides an idle card.
  if (look === IDLE_LOOK) return waitHidden?.has(c.title) === true ? undefined : look
  return hidden.has(c.title) ? undefined : look
}

// --- views, folds, selection and the redesigned pane -----------------------------
//
// The pane's own values are plugin state another plugin can rewrite, so each is
// read through a fixed set or a fixed shape and a length cap, and a value that
// fails reads as empty.

/** The groups that fold, in the order the pane draws them: the Sessions
 *  view's three, the Pull requests view's three and the Decisions tab's
 *  Flagged to revisit, History and Lead hand-off. The tab's To review takes
 *  a name and a hint here, and never folds. */
export const GROUP_KEYS: readonly string[] = ['waiting', 'working', 'finished', 'pr-open', 'pr-draft', 'pr-merged', 'pr-closed', 'd-flagged', 'd-history', 'd-handoff']

/** A group's name on its section bar. */
export const GROUP_NAMES: ReadonlyMap<string, string> = new Map([
  ['waiting', 'Waiting on you'],
  ['working', 'Working'],
  ['finished', 'Done · stopped'],
  ['pr-open', 'Open'],
  ['pr-draft', 'Draft'],
  ['pr-merged', 'Merged'],
  ['pr-closed', 'Closed'],
  ['d-review', 'To review'],
  ['d-flagged', 'Flagged to revisit'],
  ['d-history', 'History'],
  ['d-handoff', 'Lead hand-off'],
])

/** The quiet line an empty group shows. */
export const GROUP_HINTS: ReadonlyMap<string, string> = new Map([
  ['waiting', 'Decisions and reviews.'],
  ['working', 'No session is working.'],
  ['finished', 'Sessions the owner closed.'],
  ['pr-open', 'No open pull requests.'],
  ['pr-draft', 'No draft pull requests.'],
  ['pr-merged', 'Nothing merged yet.'],
  ['pr-closed', 'No closed pull requests.'],
  ['d-review', 'All caught up. New decisions land here.'],
  ['d-flagged', 'Nothing flagged.'],
  ['d-history', 'No decision logged yet.'],
  ['d-handoff', 'No hand-off from this session or this working folder yet.'],
])

const MAX_SCAN = 200
const MAX_KEPT = 50
const MAX_PICK_TITLE = 80
/** The most cards selected at once. */
export const MAX_PICKED = 50

/** The chosen view: `prs` or `decisions` only when exactly that word, else `sessions`. */
export const viewFrom = (stored: unknown): 'sessions' | 'prs' | 'decisions' => (stored === 'prs' || stored === 'decisions' ? stored : 'sessions')

/** The folded groups: names from the fixed set only, no repeat, from the
 *  first 200 entries, at most 50 kept. Anything else reads as none. */
export function foldedFrom(stored: unknown): string[] {
  if (!Array.isArray(stored)) return []
  const out: string[] = []
  for (const g of stored.slice(0, MAX_SCAN)) {
    if (typeof g === 'string' && GROUP_KEYS.includes(g) && !out.includes(g) && out.length < MAX_KEPT) out.push(g)
  }
  return out
}

/** The selected cards' titles: text within the title cap, no repeat, from the
 *  first 200 entries, at most 50 kept. Anything else reads as none. */
export function pickedFrom(stored: unknown): string[] {
  if (!Array.isArray(stored)) return []
  const out: string[] = []
  for (const t of stored.slice(0, MAX_SCAN)) {
    if (typeof t === 'string' && [...t].length <= MAX_PICK_TITLE && !out.includes(t) && out.length < MAX_PICKED) out.push(t)
  }
  return out
}

/** The count a section bar adds after its name: the reports its cards sent
 *  since the pane opened, when there are any. */
export const reportNote = (reports: number): string => (reports > 0 ? ` · ${reports} ${reports === 1 ? 'report' : 'reports'}` : '')

/** A time on the engine clock as an age: `now` under a minute, then whole
 *  minutes, hours and days. A time that is not a whole number from 0 to
 *  2^53 - 1, or is more than 2 minutes ahead of the clock, has no age. */
export function ageText(since: unknown, now: number): string | undefined {
  if (typeof since !== 'number' || !Number.isSafeInteger(since) || since < 0 || !Number.isFinite(now)) return undefined
  const gap = now - since
  if (gap < -AHEAD_MS) return undefined
  if (gap < MIN_MS) return 'now'
  if (gap < 3600000) return `${Math.floor(gap / MIN_MS)}m`
  if (gap < 86400000) return `${Math.floor(gap / 3600000)}h`
  return `${Math.floor(gap / 86400000)}d`
}

const EFFORT_MARKS: ReadonlyMap<string, string> = new Map([
  ['low', 'L'],
  ['medium', 'M'],
  ['high', 'H'],
  ['xhigh', 'X'],
  ['max', '∞'],
])

/** A card's settings line as one character for the model and one for the
 *  effort, joined by `·` (`O·H`), and the line itself, cleaned and cut to 80,
 *  for the tooltip. */
export function compactSettings(settings: unknown): { text: string; full: string } {
  const line = typeof settings === 'string' ? settings : ''
  const words = oneLine(line, 80).split(/[\s,]+/).filter(w => w !== '')
  const model = [...(words[0] ?? '')][0]?.toUpperCase() ?? ''
  const effortWord = words.slice(1).find(w => EFFORT_MARKS.has(w.toLowerCase()))
  const effort = effortWord === undefined ? '' : (EFFORT_MARKS.get(effortWord.toLowerCase()) ?? '')
  const text = [model, effort].filter(x => x !== '').join('·')
  return { text: text === '' ? '?' : text, full: oneLine(line, 80) || 'No settings on the card.' }
}

/** A card's settings line, or when the card holds none the model family its
 *  member's own summary names (`sonnet`), so the card
 *  never shows `?` for a model the member itself reported (issue 598). The
 *  card's own line always wins. */
export function settingsOrModel(settings: unknown, model: unknown): string {
  const line = typeof settings === 'string' ? settings : ''
  if (oneLine(line, 80) !== '' || typeof model !== 'string' || !MODEL_FAMILIES.includes(model)) return line
  return model
}

/** The settings popover's words (issue 513, S8): the card's settings split on
 *  commas, each part cleaned and trimmed with its first letter capital, joined
 *  by ` - ` and cut to fit; `No settings on the card.` with none. */
export function settingsPopover(settings: unknown): string {
  const line = typeof settings === 'string' ? settings : ''
  const parts = line
    .split(',')
    .map(p => oneLine(p, 40).trim())
    .filter(p => p !== '')
    .map(p => `${[...p][0]?.toUpperCase() ?? ''}${[...p].slice(1).join('')}`)
  return parts.length === 0 ? 'No settings on the card.' : oneLine(parts.join(' - '), 80)
}

/** The PR pill's theme key by state, never looked up in a plain object. */
export const PILLS: ReadonlyMap<string, string> = new Map([
  ['open', 'success'],
  ['draft', 'inactive'],
  ['merged', 'merged'],
  ['closed', 'error'],
])

/** The pill's theme key, or undefined for a state the Map does not hold. */
export const pillColor = (state: unknown): string | undefined => (typeof state === 'string' ? PILLS.get(state) : undefined)

/** A card's PR state as the pill draws it: `gh`'s answer, else the card's own,
 *  else open. The card's is passed on as stored; the Map decides its colour. */
export const pillState = (gh: string | undefined, card: unknown): string => gh ?? (typeof card === 'string' ? card : 'open')

/** The PR chip's link: GitHub's page for the card's number in the repository
 *  `gh` answered with, each held again to the shape `gh`'s answer is read to,
 *  so no card text reaches the URL. Anything else: no link. */
export const prUrl = (repo: string, n: string): string | undefined =>
  /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/.test(repo) && !['.', '..'].includes(repo.split('/')[1] ?? '') && /^[1-9][0-9]{0,6}$/.test(n) ? `https://github.com/${repo}/pull/${n}` : undefined

/** The key part that binds a to-do's link button to the address it was drawn
 *  for (issue 560): the first 16 hex digits of SHA-256 over the rebuilt address.
 *  It has no hyphen, so it survives the key's split, and it is not folded to
 *  letters and digits as an id's slug is, so two addresses that fold to the same
 *  slug still differ. */
export const linkDigest = (url: string): string => sha256Hex(url).slice(0, 16)

/** A link button's press: the to-do's link parsed again from the roster as it
 *  is now, and kept only if the button's digest is the one of that address.
 *  A link changed since the draw, to anything, gives undefined. A link with an
 *  anchor (issue 567) or to an issue (the-pact#580) is never a button's: no `gh`
 *  command takes the anchor, and none opens an issue, so each is drawn as the
 *  engine's Link and a press here, forged or real, gives undefined. */
export function linkPress(link: unknown, word: unknown): LinkParts | undefined {
  const parts = parseLink(link)
  if (parts === undefined || parts.anchor !== undefined || parts.kind !== 'pr') return undefined
  return word === linkDigest(linkUrl(parts)) ? parts : undefined
}

/** A button's key part: a title or id folded to letters and digits. */
export const slug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 40)

/** A link button's whole press: the to-do at the pressed place, found only if
 *  its id still folds to the slug the button was drawn with, and its link
 *  still matching the digest the button carries. A to-do that moved, was
 *  renamed or was relinked gives undefined. */
export function visitPress(todos: ReadonlyArray<{ id: string; link?: unknown }>, place: number, slugged: string, word: unknown): LinkParts | undefined {
  const item = todos[place]
  if (item === undefined || slug(item.id) !== slugged) return undefined
  return linkPress(item.link, word)
}

/** A Linear link button's press (the-pact#580): the to-do's identifier parsed again
 *  from the roster as it is now, and the page address built from the checked
 *  slug and that parse alone, kept only if the button's digest is the one of
 *  that address. A link or slug changed since the draw, a slug that is not the
 *  checked shape and a link that is not a bare identifier give undefined. */
export function linearPress(link: unknown, slugValue: unknown, word: unknown): string | undefined {
  const address = linearUrl(parseLinear(link), slugValue)
  return address !== undefined && word === linkDigest(address) ? address : undefined
}

/** A Linear link button's whole press: the to-do found as `visitPress` finds it,
 *  then `linearPress`. The address is returned, never taken from stored text. */
export function visitLinear(todos: ReadonlyArray<{ id: string; link?: unknown }>, place: number, slugged: string, slugValue: unknown, word: unknown): string | undefined {
  const item = todos[place]
  if (item === undefined || slug(item.id) !== slugged) return undefined
  return linearPress(item.link, slugValue, word)
}

/** A pull request row: the card it comes from, its place in the roster, its
 *  number, the state it is grouped by, its title and the dim line's parts. */
export type PrRow = {
  c: Record<string, unknown>
  i: number
  number: string
  state: string
  title: string
  detail: { cardTitle: string; counts?: string; repo?: string; age?: string }
  /** The PR's page, built only from `gh`'s answer; absent without one. */
  href?: string
}

/** A stored card's PR number as text, or undefined: the card must be a record
 *  and `pr` text of 1 to 7 digits, by the roster module's own pattern. */
export const prNumber = (c: unknown): string | undefined => (isRecord(c) && typeof c.pr === 'string' && PR_NUMBER.test(c.pr) ? c.pr : undefined)

/** A stored card's repository, in lower case, the key its answers are kept
 *  under; undefined for a card that names none or a value that fails `REPO`. */
export const cardRepo = (c: unknown): string | undefined => (isRecord(c) && typeof c.repo === 'string' && REPO.test(c.repo) ? c.repo.toLowerCase() : undefined)

/** `gh`'s answer for a card's PR: from its own repository's answers when the
 *  card names one, else from the base answers. A card whose `repo` fails the
 *  check takes no answer, so `#n` in one repository never takes another's. */
export function prAnswer(c: unknown, answers: ReadonlyMap<number, GhPr>, named?: ReadonlyMap<string, ReadonlyMap<number, GhPr>>): GhPr | undefined {
  const number = prNumber(c)
  if (number === undefined || !isRecord(c)) return undefined
  if (c.repo === undefined) return answers.get(Number(number))
  const repo = cardRepo(c)
  return repo === undefined ? undefined : named?.get(repo)?.get(Number(number))
}

/** The dim line under the Pull requests view when some repositories had no
 *  answer: the base repository alone keeps the words it had; once a named one
 *  failed, the line counts them all. */
export function unavailableLine(base: boolean, named: number): string | undefined {
  const n = (base ? 1 : 0) + named
  if (n === 0) return undefined
  return named === 0 ? 'PR details unavailable' : `PR details unavailable for ${n} ${n === 1 ? 'repository' : 'repositories'}`
}

/** The pull requests the shown cards carry, grouped Open, Merged and Closed:
 *  one row per card, `gh`'s state when it answered for the number in the
 *  card's repository (`prAnswer`), else the card's, else open. With an answer
 *  a row has the PR's title, counts, repository and age; without one, the
 *  card's title alone, and the repository the card names, if any, with no
 *  link: a row links only from an answer. */
export function prRows(cards: unknown, hidden: ReadonlySet<unknown>, answers: ReadonlyMap<number, GhPr>, now: number, moves?: Moves, named?: ReadonlyMap<string, ReadonlyMap<number, GhPr>>, waitHidden?: ReadonlySet<unknown>): { open: PrRow[]; draft: PrRow[]; merged: PrRow[]; closed: PrRow[] } {
  const out = { open: [] as PrRow[], draft: [] as PrRow[], merged: [] as PrRow[], closed: [] as PrRow[] }
  if (!Array.isArray(cards)) return out
  cards.forEach((c, i) => {
    const number = prNumber(c)
    if (!isRecord(c) || number === undefined || shownLook(c, hidden, moves, waitHidden) === undefined) return
    const answer = prAnswer(c, answers, named)
    const own = typeof c.prState === 'string' && (PR_STATES as readonly string[]).includes(c.prState) ? c.prState : 'open'
    const state = answer?.state ?? own
    const cardTitle = drawnTitle(String(c.title))
    const detail: PrRow['detail'] = { cardTitle }
    if (answer !== undefined) {
      detail.counts = `+${num(answer.additions)} −${num(answer.deletions)}`
      detail.repo = answer.repo
      const age = ageText(answer.updatedAt, now)
      if (age !== undefined) detail.age = age
    } else if (cardRepo(c) !== undefined) {
      detail.repo = String(c.repo)
    }
    const row: PrRow = { c, i, number, state, title: answer?.title ?? cardTitle, detail }
    const href = answer === undefined ? undefined : prUrl(answer.repo, number)
    if (href !== undefined) row.href = href
    if (state === 'draft') out.draft.push(row)
    else if (state === 'merged') out.merged.push(row)
    else if (state === 'closed') out.closed.push(row)
    else out.open.push(row)
  })
  return out
}

/** The hairline between cards: one rect in the rule class, across the width. */
export function hairlineSvg(): BarImage {
  return { source: `${svgOpen(9)}<rect class="rule" x="0" y="4" width="100%" height="1"/></svg>`, alt: 'divider', height: 9 }
}

/** The autonomy slider's track (spec 402, S5.4): three rounded segments
 *  across the image, one a level, each up to the level in force lit, grey
 *  at 1, the brand orange at 2 and the warning amber at 3; the rest in the
 *  track's class. A level other than 2 or 3 draws as 1. */
export function levelTrackSvg(level: number): BarImage {
  const l = level === 2 || level === 3 ? level : 1
  const lit = l === 3 ? 'warn' : l === 2 ? 'c0' : 'stopped'
  const segments = [0, 34, 68].map((x, i) => `<rect class="${i < l ? lit : 'track'}" x="${x}%" y="4" width="32%" height="6" rx="3"/>`).join('')
  return { source: `${svgOpen(14)}${segments}</svg>`, alt: `Autonomy level ${l} of 3`, height: 14 }
}

// A PR pill's class suffix and mark by state, read only through this Map.
const PILL_LOOKS: ReadonlyMap<string, { cls: string; mark: string }> = new Map([
  ['open', { cls: 'open', mark: '⇄' }],
  ['draft', { cls: 'draft', mark: '◌' }],
  ['merged', { cls: 'merged', mark: '⎇' }],
  ['closed', { cls: 'closed', mark: '⊘' }],
])
const PILL_HEIGHT = 18

/** A PR pill as Desktop draws its own: a rounded tint of the state, its mark
 *  and `#` with the number in the state's ink, 18 px high and as wide as its
 *  text, by an estimate of the font's widths. Undefined for a number that is
 *  not 1 to 7 digits or a state the Map does not hold, `constructor` included. */
export function pillSvg(n: string, state: string): (BarImage & { width: number }) | undefined {
  const look = PILL_LOOKS.get(state)
  if (look === undefined || !/^[0-9]{1,7}$/.test(n)) return undefined
  const width = Math.round(36 + 6.3 * n.length)
  const source =
    `<svg xmlns="${XMLNS}" width="${num(width)}" height="${num(PILL_HEIGHT)}"><style>${STYLE}</style>` +
    `<rect class="tint-${look.cls}" x="0" y="0" width="100%" height="${num(PILL_HEIGHT)}" rx="${num(PILL_HEIGHT / 2)}"/>` +
    `<text class="ink-${look.cls}" x="7" y="12.5">${look.mark}</text>` +
    `<text class="ink-${look.cls}" x="22" y="12.5">#${svgText(n, 8)}</text></svg>`
  return { source, alt: `#${n}, ${state}`, height: PILL_HEIGHT, width }
}

/** A card's title as drawn and as a report's sender is kept: cleaned and cut
 *  to 80. A report belongs to the card whose drawn title is its sender, both
 *  for the card's report line and for the toggle's count. */
export const drawnTitle = (title: string): string => oneLine(title, 80)

/** The reports since the pane opened whose sender is one of `titles`, matched
 *  by `drawnTitle`. Every report counts, not one per card. An inbox entry of the wrong shape
 *  counts nothing, and no shape throws. */
export function reportCount(titles: readonly string[], inbox: unknown): number {
  if (!Array.isArray(inbox)) return 0
  const drawn = new Set(titles.map(drawnTitle))
  return inbox.filter(r => isRecord(r) && typeof r.from === 'string' && drawn.has(r.from)).length
}

/** The count beside "Waiting on you": the to-dos that are neither done nor
 *  ticking. Cards never count: what the owner owes lives in the to-dos. */
export function waitingCount(todos: readonly { id: string }[], done: unknown, ticking: unknown): number {
  const out = doneOrTicking(done, ticking)
  return todos.filter(t => !out.has(t.id)).length
}

/** The to-do ids that count as done: those in the done list or ticking. The
 *  Waiting on you count and the to-do bar both read this one set. */
function doneOrTicking(done: unknown, ticking: unknown): Set<string> {
  return new Set([...idsFrom(done), ...ticksFrom(ticking).map(p => p.name)])
}

// --- The status strip and the to-do bar ---------------------------------------
//
// Under the top row: a strip with one segment per status, its legend,
// and a bar of the to-dos done. Both are drawn from counts alone. Each builder
// takes the stored roster and lists as they are, reads a card only through
// the status Map and a to-do only by its id, and writes only numbers, fixed
// words and fixed class names: no title, to-do text, report or usage text
// reaches either image or its alt.

/** The strip's cells on the terminal. */
export const STRIP_CELLS = 32
/** The to-do bar's cells on the terminal. */
export const TODO_CELLS = 20

const STRIP_HEIGHT = 8
const TODO_HEIGHT = 12

// A count as the drawing takes it: a finite number above 0, floored, else 0.
const whole = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)

/** One look's count among the shown cards. */
export type StatusCount = { look: StatusLook; count: number }

/** The shown cards' count per look, in `LOOK_ORDER`, with no entry for a
 *  status with no cards. Shown is as `groupCards` has it: a record, not
 *  dismissed, and one of the four statuses, by the rule groupCards uses, so
 *  the strip, its legend, the heading and the groups count the same cards. */
export function statusCounts(cards: unknown, hidden: ReadonlySet<unknown>, moves?: Moves, waitHidden?: ReadonlySet<unknown>): StatusCount[] {
  const counts = new Map<StatusLook, number>()
  if (Array.isArray(cards)) {
    for (const c of cards) {
      const look = shownLook(c, hidden, moves, waitHidden)
      if (look !== undefined) counts.set(look, (counts.get(look) ?? 0) + 1)
    }
  }
  return LOOK_ORDER.flatMap(look => {
    const count = counts.get(look) ?? 0
    return count > 0 ? [{ look, count }] : []
  })
}

/** The terminal strip's run lengths, one per count, in the same order. The
 *  cells go by largest remainder of each count's share, a tie to the earlier
 *  count; then each count above 0 that got no cell takes one from the
 *  longest run, the earliest of equal ones. A count that is not a
 *  finite number above 0 is 0. The runs sum to exactly `cells` whenever a
 *  count is above 0; with none, or a cell count that is not a positive whole
 *  number, every run is 0 and there is nothing to draw. Never throws. */
export function stripRuns(counts: readonly unknown[], cells: number): number[] {
  const c = counts.map(whole)
  const total = c.reduce((s, n) => s + n, 0)
  const n = Number.isInteger(cells) && cells > 0 ? cells : 0
  if (total === 0 || n === 0) return c.map(() => 0)
  const quota = c.map(v => (v / total) * n)
  const runs = quota.map(Math.floor)
  const remainder = quota.map((q, i) => q - (runs[i] ?? 0))
  let left = n - runs.reduce((s, r) => s + r, 0)
  const byRemainder = remainder.map((_, i) => i).sort((a, b) => (remainder[b] ?? 0) - (remainder[a] ?? 0) || a - b)
  for (const i of byRemainder) {
    if (left <= 0) break
    runs[i] = (runs[i] ?? 0) + 1
    left -= 1
  }
  c.forEach((v, i) => {
    if (v === 0 || (runs[i] ?? 0) > 0) return
    const longest = runs.reduce((best, r, j) => (r > (runs[best] ?? 0) ? j : best), 0)
    // A run of one cell gives none away: with more counts than cells, the
    // later ones draw nothing rather than break the sum.
    if ((runs[longest] ?? 0) <= 1) return
    runs[longest] = (runs[longest] ?? 0) - 1
    runs[i] = 1
  })
  return runs
}

/** An SVG image of fixed words, numbers and class names, and its alt text. */
export type BarImage = { source: string; alt: string; height: number }

const svgOpen = (height: number) => `<svg xmlns="${XMLNS}" width="100%" height="${num(height)}"><style>${STYLE}</style>`

/** The strip as an SVG: one segment per count above 0, in the order given,
 *  each as wide as its share, under one rounded clip, id `st`. Each segment
 *  but the last sits in a nested <svg> with its rect moved 2 px left, so a
 *  2 px gap follows it at any width. A count that is not a finite number
 *  above 0 draws nothing. The alt text is the legend's words and numbers. */
export function stripSvg(entries: readonly StatusCount[]): BarImage {
  const shown = entries.map(e => ({ look: e.look, count: whole(e.count) })).filter(e => e.count > 0)
  const total = shown.reduce((s, e) => s + e.count, 0)
  const h = num(STRIP_HEIGHT)
  let x = 0
  const segments = shown.map((e, i) => {
    const w = (e.count / total) * 100
    const at = x
    x += w
    return i < shown.length - 1
      ? `<svg x="${pct(at)}" width="${pct(w)}" height="${h}"><rect class="${e.look.cls}" width="100%" height="${h}" transform="translate(-2 0)"/></svg>`
      : `<rect class="${e.look.cls}" x="${pct(at)}" y="0" width="${pct(w)}" height="${h}"/>`
  })
  const source =
    svgOpen(STRIP_HEIGHT) +
    `<clipPath id="st"><rect x="0" y="0" width="100%" height="${h}" rx="${num(STRIP_HEIGHT / 2)}"/></clipPath>` +
    `<g clip-path="url(#st)">${segments.join('')}</g></svg>`
  const alt = shown.length === 0 ? 'none' : shown.map(e => `${e.count} ${e.look.word}`).join(', ')
  return { source, alt: `Status: ${alt}`, height: STRIP_HEIGHT }
}

/** What the strip draws: the shown cards' total, the legend's entries, the
 *  terminal's runs of `█` in each status's theme colour, summing to 32, and
 *  the SVG. Undefined when no shown card has one of the four statuses. */
export type StripView = {
  total: number
  legend: { text: string; color: string }[]
  runs: { text: string; color: string }[]
  svg: BarImage
}

export function statusStrip(cards: unknown, hidden: ReadonlySet<unknown>, moves?: Moves, waitHidden?: ReadonlySet<unknown>): StripView | undefined {
  const counts = statusCounts(cards, hidden, moves, waitHidden)
  const total = counts.reduce((s, e) => s + e.count, 0)
  if (total === 0) return undefined
  const runs = stripRuns(
    counts.map(e => e.count),
    STRIP_CELLS,
  )
  return {
    total,
    legend: counts.map(e => ({ text: `${e.look.glyph} ${e.count} ${e.look.word}`, color: e.look.color })),
    runs: counts.flatMap((e, i) => ((runs[i] ?? 0) > 0 ? [{ text: '█'.repeat(runs[i] ?? 0), color: e.look.color }] : [])),
    svg: stripSvg(counts),
  }
}

/** The roster's to-dos and how many of them are done: a to-do counts as done
 *  when its id is in the done list or ticking, once whichever holds it, so
 *  the bar agrees with the "Waiting on you" count. Lists of the wrong shape
 *  count as empty, and a to-do that is not a record with a text id counts
 *  nowhere. */
export function todoCounts(todos: unknown, done: unknown, ticking: unknown): { done: number; total: number } {
  const list = Array.isArray(todos) ? todos.filter((t): t is { id: string } => isRecord(t) && typeof t.id === 'string') : []
  const out = doneOrTicking(done, ticking)
  return { done: list.filter(t => out.has(t.id)).length, total: list.length }
}

/** The to-do bar as an SVG: a rounded track and a rounded green fill, class
 *  `done`, with no clip and no id. A count that is not a finite number above
 *  0 is 0, and done past the total is the total. The fill is never narrower
 *  than 6 px, as the usage bars' is. The alt text is `To-dos N of M done`. */
export function todoSvg(done: number, total: number): BarImage {
  const m = whole(total)
  const n = Math.min(whole(done), m)
  const fraction = m > 0 ? n / m : 0
  const rect = (cls: string, width: string) => `<rect class="${cls}" x="0" y="3" width="${width}" height="6" rx="3"/>`
  const source =
    svgOpen(TODO_HEIGHT) +
    rect('track', '100%') +
    (fraction > 0 ? rect('done', '6') + rect('done', pct(fraction * 100)) : '') +
    '</svg>'
  return { source, alt: `To-dos ${n} of ${m} done`, height: TODO_HEIGHT }
}

/** What the to-do bar draws: "N of M done", the terminal's 20 eighth-block
 *  cells, and the SVG. Undefined when the roster has no to-dos. */
export function todoBar(
  todos: unknown,
  done: unknown,
  ticking: unknown,
): { text: string; cells: string; svg: BarImage } | undefined {
  const c = todoCounts(todos, done, ticking)
  if (c.total === 0) return undefined
  return { text: `${c.done} of ${c.total} done`, cells: eighthBar(c.done / c.total, TODO_CELLS), svg: todoSvg(c.done, c.total) }
}

// --- Cache warmth ----------------------------------------------------------
//
// A session's prompt cache lasts for the window its last cache write asked
// for, one hour or five minutes, from its last model call. The ◆ line says
// how long the session has been idle, when it goes cold, and how big its
// context is. All of it comes from the session's own transcript, text another
// session wrote, so every row is checked for shape and size before it counts.

/** The engine refuses to read a file over 4 MiB, so the pane does not try. */
export const MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024
const MIN_MS = 60000
const HOUR_MS = 60 * MIN_MS
const SHORT_MS = 5 * MIN_MS
const AMBER_MS = 15 * MIN_MS
// A row may claim a time up to this much past the file's modified time, for
// the clock's slack; a later one claims to be newer than the file it is in.
const SLACK_MS = 2 * MIN_MS
const MAX_COUNT = 10000000
// The most entries a stored list of warmth records or live entries keeps.
const MAX_ENTRIES = 50
/** The cap on a card's title and on a session's name as kept in the live state. */
export const MAX_NAME = 300
const MAX_LIVE = 40

/** The last real model call in a transcript: its time, its context tokens,
 *  and its cache window when a call that wrote cache says it. */
export type LastCall = { at: number; tokens: number; windowMs?: number }

// The time Claude Code writes, ISO in UTC: an offset is refused.
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/

// A token count as a row may give it: absent counts as 0, else a whole
// number from 0 to 10,000,000. Anything else spoils the row.
const count = (v: unknown): number | undefined =>
  v === undefined ? 0 : typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_COUNT ? v : undefined

// A call's message id as Claude Code writes it: every real call row carries
// one, and a call's rows all carry the same.
const MESSAGE_ID = /^[A-Za-z0-9_-]{1,100}$/

// One transcript line as a model call, with its message id, its new tokens
// (input, cache writes and output, not cache reads) and its model as the row
// gives it, read only to look up the window. Undefined when it is not a real
// one or fails a check: a `<synthetic>` row, an API error, a sidechain, no
// well-formed message id, an offset or unreadable time, a time past
// `latest`, a count out of range, or no context at all. Claude Code writes an
// assistant-shaped row with zero usage when a turn ends on an error, and
// taking it would show a cold session warm.
type CallRow = LastCall & { id: string; fresh: number; model: unknown }
function callRow(line: string, latest: number): CallRow | undefined {
  let r: unknown
  try {
    r = JSON.parse(line)
  } catch {
    return undefined
  }
  if (!isRecord(r) || r.type !== 'assistant' || typeof r.timestamp !== 'string') return undefined
  if (r.isApiErrorMessage === true || r.isSidechain === true) return undefined
  const m = r.message
  if (!isRecord(m) || !isRecord(m.usage) || m.model === '<synthetic>') return undefined
  if (typeof m.id !== 'string' || !MESSAGE_ID.test(m.id)) return undefined
  if (!UTC.test(r.timestamp)) return undefined
  const at = isoTime(r.timestamp)
  if (at === undefined || at > latest) return undefined
  const u = m.usage
  const input = count(u.input_tokens)
  const made = count(u.cache_creation_input_tokens)
  const cached = count(u.cache_read_input_tokens)
  const output = count(u.output_tokens)
  if (input === undefined || made === undefined || cached === undefined || output === undefined) return undefined
  let short: number | undefined = 0
  let long: number | undefined = 0
  if (u.cache_creation !== undefined) {
    if (!isRecord(u.cache_creation)) return undefined
    short = count(u.cache_creation.ephemeral_5m_input_tokens)
    long = count(u.cache_creation.ephemeral_1h_input_tokens)
    if (short === undefined || long === undefined) return undefined
  }
  const tokens = input + made + cached
  if (tokens === 0) return undefined
  const call: CallRow = { at, tokens, id: m.id, fresh: input + made + output, model: m.model }
  if (long > 0) call.windowMs = HOUR_MS
  else if (short > 0) call.windowMs = SHORT_MS
  return call
}

// --- The call series ---------------------------------------------------------
//
// A read gives more than the last call: the window the session's model family
// has, from a fixed table, and two series, the new tokens of each of the last
// 30 minutes and the context size of each of the last 30 calls. Claude Code
// writes one row per content block, each with the call's whole usage, so a
// call counts once by its message id. All of it is numbers: no model text or
// message id leaves the parse.

/** The burn buckets: one a minute, for the last 30 minutes. */
export const BURN_BUCKETS = 30
/** The most calls the context series keeps. */
export const SERIES_CALLS = 30
/** The most a burn bucket or a context value holds: three counts at their
 *  top, so one call never passes it, and a bucket is clamped to it. */
export const MAX_SERIES = 3 * MAX_COUNT
const BURN_SPAN_MS = BURN_BUCKETS * MIN_MS

/** What one read of a transcript gives: the last call as the cache bar reads
 *  it, the context window its model family has, in tokens (absent when the
 *  table gives none),
 *  the 30 burn buckets ending at the read time, oldest first, and the context
 *  size of each of the last 30 calls, oldest first. */
export type CallSeries = { last: LastCall; window?: number; burn: number[]; context: number[] }

// The model id a window is looked up for, and the table, matched from the
// start in order. A fixed list, never a lookup keyed by the file's text.
const MODEL_ID = /^claude-[a-z0-9-]{1,60}$/
/** The model families a summary names (issue 598): one word from this fixed list, so no free text reaches the pane. */
export const MODEL_FAMILIES: readonly string[] = ['opus', 'sonnet', 'haiku', 'fable']
/** The family word of a model id (`claude-sonnet-5-5` gives `sonnet`), from the fixed list, or undefined. */
export function familyOf(model: unknown): string | undefined {
  if (typeof model !== 'string' || !MODEL_ID.test(model)) return undefined
  return MODEL_FAMILIES.find(f => model.startsWith(`claude-${f}-`))
}
const WINDOW_TABLE: readonly (readonly [string, number])[] = [
  ['claude-opus-5', 1000000],
  ['claude-sonnet-5', 1000000],
  ['claude-fable-5', 1000000],
  ['claude-opus-4-8', 1000000],
  ['claude-haiku-5', 1000000],
  ['claude-haiku-', 200000],
]

/** A model's context window from the fixed table, or undefined: a model id
 *  that is not `claude-` and 1 to 60 of a-z, 0-9 and `-`, or one no row of the
 *  table starts it, has none. */
export function windowOf(model: unknown): number | undefined {
  if (typeof model !== 'string' || !MODEL_ID.test(model)) return undefined
  return WINDOW_TABLE.find(([family]) => model.startsWith(family))?.[1]
}

/** The end of the clock minute a time falls in, where a call series' burn
 *  buckets end: a time on a whole minute is its own end. */
export const burnEnd = (now: number): number => Math.ceil(now / MIN_MS) * MIN_MS

/** A transcript's call series, or undefined when it has no counted call.
 *
 *  One pass over the lines from the end. A line that does not parse is
 *  skipped and the pass goes on, so a half-written last line costs nothing.
 *  A row counts only when it passes every check `callRow` makes, and only
 *  once per message id: an id counts when its newest passing row does, and
 *  later rows with it are skipped. The first counted row is the last call,
 *  and its model alone gives the context window; the cache's window, a span
 *  of time, is taken from the newest counted call that wrote cache, as before. The burn
 *  buckets span the 30 clock minutes ending where `now`'s minute ends
 *  (`burnEnd`), as the summary writer keys them. A call goes in a bucket
 *  only when its time is after the span's start and no later than `now`:
 *  bucket i holds the calls in minute i of that span, and
 *  each is clamped to 30,000,000. The pass stops once it has the last call,
 *  the last cache-writing call and 30 counted calls, and has passed 30
 *  minutes before `now`. `mtimeMs` is the file's modified time, used only to
 *  refuse a row that claims a time more than 2 minutes after it, never as
 *  the call's time. Never throws. */
export function callSeries(text: string, mtimeMs: number, now: number): CallSeries | undefined {
  if (!Number.isFinite(mtimeMs)) return undefined
  const latest = mtimeMs + SLACK_MS
  // The buckets end on the clock minute `now` falls in, as the summary
  // writer's do, so both sources draw the same burn (#312).
  const start = burnEnd(now) - BURN_SPAN_MS
  const lines = text.split('\n')
  const seen = new Set<string>()
  const burn: number[] = Array.from({ length: BURN_BUCKETS }, () => 0)
  // Newest first, turned at the end.
  const context: number[] = []
  let last: LastCall | undefined
  let window: number | undefined
  let cacheKnown = false
  let passed = false
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? ''
    if (!line.includes('"assistant"')) continue
    const call = callRow(line, latest)
    if (call === undefined || seen.has(call.id)) continue
    seen.add(call.id)
    if (last === undefined) {
      last = { at: call.at, tokens: call.tokens }
      window = windowOf(call.model)
    }
    if (!cacheKnown && call.windowMs !== undefined) {
      last.windowMs = call.windowMs
      cacheKnown = true
    }
    if (context.length < SERIES_CALLS) context.push(call.tokens)
    if (call.at > start && call.at <= now) {
      const b = Math.min(BURN_BUCKETS - 1, Math.max(0, Math.ceil((call.at - start) / MIN_MS) - 1))
      burn[b] = Math.min(MAX_SERIES, (burn[b] ?? 0) + call.fresh)
    } else if (call.at <= start) {
      passed = true
    }
    if (cacheKnown && passed && context.length >= SERIES_CALLS) break
  }
  if (last === undefined) return undefined
  const out: CallSeries = { last, burn, context: context.reverse() }
  if (window !== undefined) out.window = window
  return out
}

/** A live state that means the session is working: its cache is warm. */
// A background row with no `status` says it in `state`, which reads `working`
// while it works.
export const isWorking = (state: string | undefined) => state === 'busy' || state === 'running' || state === 'working'

/** A live state as the card draws it, with its theme colour: `busy`,
 *  `running` and `working` success, `idle`, `blocked` and `waiting` (with
 *  or without its reason) warning, anything else inactive. */
export function liveState(state: string | undefined): { text: string; color: string } {
  if (state === undefined) return { text: 'not running', color: 'inactive' }
  return { text: state, color: isWorking(state) ? 'success' : state === 'idle' || state === 'blocked' || state === 'waiting' || state.startsWith('waiting · ') ? 'warning' : 'inactive' }
}

const KINDS_OF_WARMTH = new Set(['call', 'too-large', 'shared', 'unread', 'not-found'])
const OTHER_KINDS = new Map<string, 'too-large' | 'shared' | 'unread' | 'not-found'>([
  ['too-large', 'too-large'],
  ['shared', 'shared'],
  ['unread', 'unread'],
  ['not-found', 'not-found'],
])
const WINDOWS = new Set([SHORT_MS, HOUR_MS])

/** One live entry: a roster card's title, its session's live word, the
 *  session's own name and what the poll did to the card (see `Move`). */
export type Live = { name: string; value: string; shown?: string; move?: Move }

/** The stored live entries, checked again: a name, value or shown name that
 *  is not text within its cap is dropped (a bad shown name leaves the entry
 *  with none), a move outside its two words reads as absent, an entry of
 *  today's two-field shape reads as no engine name and no move, and at most
 *  50 stay. */
export function liveFrom(stored: unknown): Live[] {
  const out: Live[] = []
  if (!Array.isArray(stored)) return out
  for (const e of stored) {
    if (out.length >= MAX_ENTRIES) break
    if (!isRecord(e) || typeof e.name !== 'string' || e.name === '' || e.name.length > MAX_NAME) continue
    if (typeof e.value !== 'string' || e.value.length > MAX_LIVE) continue
    const live: Live = { name: e.name, value: e.value }
    if (typeof e.shown === 'string' && e.shown !== '' && e.shown.length <= MAX_NAME) live.shown = e.shown
    if (e.move === 'waiting' || e.move === 'idle') live.move = e.move
    out.push(live)
  }
  return out
}

/** The stored warmth records, checked again: plugin state is the engine's,
 *  and another plugin may rewrite it. A record of the wrong shape goes, a
 *  repeated name keeps the first, and at most 50 stay. */
export function warmthFrom(stored: unknown): Warmth[] {
  const out: Warmth[] = []
  if (!Array.isArray(stored)) return out
  const names = new Set<string>()
  for (const w of stored) {
    if (out.length >= MAX_ENTRIES) break
    if (!isRecord(w) || typeof w.name !== 'string' || w.name === '' || w.name.length > MAX_NAME || names.has(w.name)) continue
    if (typeof w.kind !== 'string' || !KINDS_OF_WARMTH.has(w.kind)) continue
    if (w.kind === 'call') {
      if (typeof w.at !== 'number' || !Number.isFinite(w.at)) continue
      if (typeof w.tokens !== 'number' || !Number.isInteger(w.tokens) || w.tokens < 0 || w.tokens > 3 * MAX_COUNT) continue
      if (w.windowMs !== undefined && (typeof w.windowMs !== 'number' || !WINDOWS.has(w.windowMs))) continue
      const call: Warmth = { name: w.name, kind: 'call', at: w.at, tokens: w.tokens }
      if (w.windowMs !== undefined) call.windowMs = w.windowMs
      out.push(call)
    } else {
      const kind = OTHER_KINDS.get(w.kind)
      if (kind === undefined) continue
      out.push({ name: w.name, kind })
    }
    names.add(w.name)
  }
  return out
}

// "N min" under an hour, "N hr N min" from an hour.
const span = (mins: number) => (mins >= 60 ? `${Math.floor(mins / 60)} hr ${mins % 60} min` : `${mins} min`)

/** One card's ◆ line: its tone (`dim` or a theme colour) and its text, or
 *  undefined with no record. A transcript too large to read and a name two
 *  sessions share read unknown, and a transcript the finder found nowhere
 *  reads not found, whatever the live state. A working session is warm, with
 *  no size when its transcript has not been read yet. Else the idle time sets
 *  the band: more than 15 min left green, 15 min or less amber, none left
 *  red; with no known window, no countdown. The line carries no nudge to
 *  reply or hand off (issue 581). */
export function warmthLine(
  w: Warmth | undefined,
  state: string | undefined,
  now: number,
): { tone: 'dim' | 'success' | 'warning' | 'error'; text: string } | undefined {
  if (w === undefined) return undefined
  if (w.kind === 'too-large') return { tone: 'dim', text: '◆ cache unknown · transcript too large to read' }
  if (w.kind === 'shared') return { tone: 'dim', text: '◆ cache unknown · two sessions share this name' }
  if (w.kind === 'not-found') return { tone: 'dim', text: '◆ transcript not found' }
  if (w.kind === 'unread') return isWorking(state) ? { tone: 'dim', text: '◆ cache warm (working)' } : undefined
  const size = `${tokens(w.tokens)} context`
  if (isWorking(state)) return { tone: 'dim', text: `◆ cache warm (working) · ${size}` }
  const idle = Math.max(0, now - w.at)
  const idleText = span(Math.floor(idle / MIN_MS))
  if (w.windowMs === undefined) return { tone: 'dim', text: `◆ cache window unknown · idle ${idleText} · ${size}` }
  const left = w.windowMs - idle
  if (left <= 0) return { tone: 'error', text: `◆ cache cold · idle ${idleText} · ${size}` }
  const leftText = span(Math.ceil(left / MIN_MS))
  const text = `◆ cache warm · idle ${idleText} · cold in ${leftText} · ${size}`
  return { tone: left > AMBER_MS ? 'success' : 'warning', text }
}

/** A warmth line with its trailing "· Nk context" dropped, for a card whose
 *  context meter already shows the size (#287). Any other text is kept. */
export const withoutSize = (text: string): string => text.replace(/ · [^·]* context$/, '')
// --- The cache bar -----------------------------------------------------------
//
// A working or idle card draws its ◆ line as a bar that drains over the
// cache window, with short text beside it and a dim line under it. The bar is
// worked out here from the warmth record's numbers alone: no title, to-do,
// report or usage text reaches it, and its alt text is fixed words and numbers.

/** The terminal width in cells of the cache bar and the context meter. */
export const CACHE_CELLS = 16

/** A card's cache bar: how full it is, from 0 to 1, its theme colour key and
 *  SVG class, and its short text. The context size is the context meter's
 *  to show, so the bar carries none (#287). */
export type CacheBar = {
  fraction: number
  tone: 'success' | 'warning' | 'error'
  cls: 'done' | 'warn' | 'hot'
  text: string
}

// A fraction as a bar draws it: one that is not a finite number is 0, and any
// other is clamped to between 0 and 1.
const unit = (f: number) => (Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : 0)

/** One card's cache bar, or undefined for no bar. A working session is warm:
 *  a full green bar, whether its record is a call or not read yet, and
 *  whatever its window. Otherwise only a call with a known window has a bar:
 *  the time left over the window, green with more than 15 min left, amber at
 *  15 or less, and empty and red with none left, the same bands as
 *  `warmthLine`. A transcript too large to read, a name two sessions share,
 *  a transcript not found, an unknown window and no record have none. Idle
 *  time is floored at 0, so a call time ahead of the clock gives a full bar;
 *  an idle time that is not a finite number gives no bar. */
export function cacheBar(w: Warmth | undefined, state: string | undefined, now: number): CacheBar | undefined {
  if (w === undefined || w.kind === 'too-large' || w.kind === 'shared' || w.kind === 'not-found') return undefined
  if (isWorking(state)) return { fraction: 1, tone: 'success', cls: 'done', text: 'warm (working)' }
  if (w.kind !== 'call' || w.windowMs === undefined) return undefined
  const idle = Math.max(0, now - w.at)
  if (!Number.isFinite(idle)) return undefined
  const left = w.windowMs - idle
  // Only the time left: the card's header already says idle, so the bar
  // carries no idle time (owner, from chat, reversing q2 on #287).
  if (left <= 0) return { fraction: 0, tone: 'error', cls: 'hot', text: 'cold' }
  const text = `cold in ${span(Math.ceil(left / MIN_MS))}`
  const fraction = unit(left / w.windowMs)
  return left > AMBER_MS ? { fraction, tone: 'success', cls: 'done', text } : { fraction, tone: 'warning', cls: 'warn', text }
}

/** The terminal's cache bar: 16 eighth-block cells, the end marks left to
 *  the caller. A cold bar, empty, keeps a one-eighth cell at its start, as
 *  the image keeps its stub, so it still reads red. */
export function cacheCells(b: CacheBar): string {
  const cells = eighthBar(b.fraction, CACHE_CELLS)
  return b.cls === 'hot' && cells.trim() === '' ? `${EIGHTHS[0]}${' '.repeat(CACHE_CELLS - 1)}` : cells
}

// The three classes the fill of the cache bar or the context meter may take.
// Any other class it is handed draws no fill. `done` is the shared green: a
// done session's colour, a warm cache's and a context meter's under 70%.
const CACHE_CLASSES = new Set(['done', 'warn', 'hot'])
// The image's height, the bar's top, and the bar's thickness, which is also
// the stub's width, for both bars.
const CACHE_HEIGHT = 16
const CACHE_Y = 5
const CACHE_THICKNESS = 6

/** The cache bar as an image for the surfaces with Svg, built from the bar's
 *  fraction and class alone. A rounded track the image's full width, a fixed
 *  6 px stub in the bar's class, and over it a rounded fill in percentages,
 *  so a sliver stays seen; at 0 the stub alone. A class other than the three
 *  tones' draws the track alone. No clipPath and no id, so many cache bars on
 *  one pane share none. The fraction is clamped here too. The alt text is
 *  "Cache" and the bar's text, cleaned to one line. */
export function cacheBarSvg(b: CacheBar): Extract<UsageView, { kind: 'svg' }> {
  return thinBar(b.fraction, b.cls, `Cache ${b.text}`)
}

// The thin bar the cache bar and the context meter share, from a fraction, a
// class and an alt text alone.
function thinBar(fraction: number, cls: string, alt: string, over = ''): Extract<UsageView, { kind: 'svg' }> {
  const f = unit(fraction)
  const y = num(CACHE_Y)
  const h = num(CACHE_THICKNESS)
  const r = num(CACHE_THICKNESS / 2)
  // The stub is drawn at 0 too, so an empty bar still shows its class's
  // colour: a cold cache bar still reads red.
  const fill = CACHE_CLASSES.has(cls)
    ? `<rect class="${cls}" x="0" y="${y}" width="${h}" height="${h}" rx="${r}"/>` +
      (f > 0 ? `<rect class="${cls}" x="0" y="${y}" width="${pct(f * 100)}" height="${h}" rx="${r}"/>` : '')
    : ''
  const source =
    `<svg xmlns="${XMLNS}" width="100%" height="${num(CACHE_HEIGHT)}"><style>${STYLE}</style>` +
    `<rect class="track" x="0" y="${y}" width="100%" height="${h}" rx="${r}"/>${fill}${over}</svg>`
  return { kind: 'svg', source, alt: oneLine(alt, 80), height: CACHE_HEIGHT }
}

// --- The context meter -------------------------------------------------------
//
// Under the cache bar, how full the session's context is: the newest call's
// context over its model family's window, from the stored `meters` record.
// Drawn from that record's numbers alone, as the cache bar is: no title, path,
// model or message id reaches it, and its alt text is fixed words and numbers.

const MAX_METERS = 50
const WINDOW_SIZES = new Set([200000, 1000000])

// A stored series checked again: a list of whole numbers from 0 to
// 30,000,000, exactly 30 of them or at most 30, copied into a new list. A
// gap in the list, or any other shape, fails it.
function seriesFrom(v: unknown, exact: boolean): number[] | undefined {
  if (!Array.isArray(v) || (exact ? v.length !== BURN_BUCKETS : v.length > SERIES_CALLS)) return undefined
  const out: number[] = []
  for (let i = 0; i < v.length; i++) {
    const n: unknown = v[i]
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > MAX_SERIES) return undefined
    out.push(n)
  }
  return out
}

/** The stored meters, checked again before they are drawn: plugin state is
 *  the engine's, and another plugin may rewrite it. A record goes unless its
 *  name is text of 1 to 300 characters not seen before, `at` a finite
 *  number, `window` absent or exactly 200,000 or 1,000,000, `burn` absent or
 *  exactly 30 whole numbers from 0 to 30,000,000, and `context` absent or at
 *  most 30 such numbers. At most 50 stay, each copied field by field into a
 *  new record, so no other field and no shared list comes with it. */
export function metersFrom(stored: unknown): Meter[] {
  const out: Meter[] = []
  if (!Array.isArray(stored)) return out
  const names = new Set<string>()
  for (const r of stored) {
    if (out.length >= MAX_METERS) break
    if (!isRecord(r) || typeof r.name !== 'string' || r.name === '' || r.name.length > MAX_NAME || names.has(r.name)) continue
    if (typeof r.at !== 'number' || !Number.isFinite(r.at)) continue
    if (r.window !== undefined && (typeof r.window !== 'number' || !WINDOW_SIZES.has(r.window))) continue
    const burn = r.burn === undefined ? undefined : seriesFrom(r.burn, true)
    const context = r.context === undefined ? undefined : seriesFrom(r.context, false)
    if ((r.burn !== undefined && burn === undefined) || (r.context !== undefined && context === undefined)) continue
    const m: Meter = { name: r.name, at: r.at }
    if (r.window !== undefined) m.window = r.window
    if (burn !== undefined) m.burn = burn
    if (context !== undefined) m.context = context
    out.push(m)
    names.add(r.name)
  }
  return out
}

/** A token count as the context meter draws it: "N.NM" from 999,500, a
 *  trailing ".0" dropped, else as `tokens` draws it. */
export function sizeText(n: number): string {
  return Number.isFinite(n) && n >= 999500 ? `${(n / 1000000).toFixed(1).replace(/\.0$/, '')}M` : tokens(n)
}

/** A card's context meter: how full it is, from 0 to 1, its theme colour key
 *  and SVG class, the text beside it and the image's alt text. */
export type ContextMeter = {
  fraction: number
  tone: 'success' | 'warning' | 'error'
  cls: 'done' | 'warn' | 'hot'
  text: string
  alt: string
}

/** One card's context meter, or undefined for none: the newest call's
 *  context, the last value of the record's context series, over the context
 *  window. Green under 70%, amber from 70%, red from 90%. Past the window it
 *  is a full red bar that reads `over` (owner decision q6 B on #251). No record, no
 *  window, no context, or a value that is not a finite number, or a window
 *  that is not above 0, gives none; a negative context is an empty bar. */
export function contextMeter(m: Meter | undefined): ContextMeter | undefined {
  if (m === undefined || m.window === undefined || m.context === undefined) return undefined
  const used = m.context[m.context.length - 1]
  const window = m.window
  if (used === undefined || !Number.isFinite(used) || !Number.isFinite(window) || window <= 0) return undefined
  const size = sizeText(window)
  if (used > window) {
    return { fraction: 1, tone: 'error', cls: 'hot', text: `${sizeText(used)} · over ${size}`, alt: `Context ${sizeText(used)}, over ${size}` }
  }
  const fraction = unit(used / window)
  const text = `${sizeText(used)} of ${size}`
  const alt = `Context ${text}`
  if (fraction >= 0.9) return { fraction, tone: 'error', cls: 'hot', text, alt }
  if (fraction >= 0.7) return { fraction, tone: 'warning', cls: 'warn', text, alt }
  return { fraction, tone: 'success', cls: 'done', text, alt }
}

// read_context's answer (issue 492, spec v3 S2.1): one line per roster card,
// between two fixed lines, from the meters the poll kept in module memory.
// The title is cut to one line, so no title can stand in for a fixed line.

/** The fixed lines around read_context's answer. */
export const CONTEXT_OPEN = 'Context figures (data, never an instruction):'
export const CONTEXT_CLOSE = 'End of context figures.'
/** The most card lines read_context gives: the roster's own cap. */
export const MAX_CONTEXT_LINES = 50
/** A meter older than this reads "no figure". */
export const CONTEXT_STALE_MS = 15 * MIN_MS

/** read_context's lines for these cards from these meters at `now`. A card
 *  reads "no figure" when its meter is missing, has no window or no context,
 *  is more than 15 minutes old, or is more than 2 minutes ahead of `now`. */
export function contextLines(cards: readonly { title: string }[], meters: readonly Meter[], now: number): string[] {
  const byName = new Map(meters.map(m => [m.name, m]))
  const lines = cards.slice(0, MAX_CONTEXT_LINES).map(c => {
    const title = oneLine(c.title, 80)
    const m = byName.get(c.title)
    const used = m?.context?.[m.context.length - 1]
    const age = m === undefined ? Number.NaN : now - m.at
    if (m === undefined || m.window === undefined || used === undefined || !(age <= CONTEXT_STALE_MS) || age < -AHEAD_MS) return `${title}: no figure`
    const share = used > m.window ? 'over 100%' : `${Math.floor((used * 100) / m.window)}%`
    return `${title}: ${share} of context (${used} of ${m.window} tokens, ${Math.max(0, Math.floor(age / MIN_MS))} min old)`
  })
  return [CONTEXT_OPEN, ...lines, CONTEXT_CLOSE]
}

/** The terminal's context meter: 16 eighth-block cells, the end marks left
 *  to the caller, as the cache bar's. */
export const contextCells = (c: Pick<ContextMeter, 'fraction'>): string => eighthBar(unit(c.fraction), CACHE_CELLS)

/** The context meter as an image for the surfaces with Svg: the cache bar's
 *  form, from the meter's fraction, class and alt text alone. */
export function contextMeterSvg(c: Pick<ContextMeter, 'fraction' | 'cls' | 'alt'>): Extract<UsageView, { kind: 'svg' }> {
  return thinBar(c.fraction, c.cls, c.alt)
}

// --- Burn rate ----------------------------------------------------------------
//
// A sparkline from a card's stored meter: the new tokens of each of the 30
// minutes up to the read, shifted left by the whole minutes since it at draw
// time, so an idle session's burn falls to 0 without another read. Drawn from
// the meter's numbers alone: no title, path, model or message id reaches it,
// and the alt text is fixed words and numbers.

/** The columns of a sparkline: the burn's minutes, and the most calls the
 *  context outlook reads. */
export const SPARK_COLUMNS = 30
// The sparkline image's height, and the least height of a column: an empty
// one draws the flat baseline, and one above 0 never draws as short.
const SPARK_HEIGHT = 40
const BASELINE = 1
const LEAST = 2
// The part of its slot a column fills, leaving a gap on its right.
const COLUMN = 0.7
// The eight column heights the terminal draws, one to eight eighths.
const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

// A series value as the views take it: a finite number from 0 to the stored
// cap, else 0.
const seriesValue = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(MAX_SERIES, v) : 0)

/** The burn buckets shifted left by the whole minutes from `at` to `now`,
 *  clamped to 0 to 30, with zeros coming in on the right: always exactly 30
 *  values. A time that is not a number shifts nothing, and an `at` ahead of
 *  the clock shifts nothing; a list of another length is cut to its first 30
 *  or padded with zeros. Never throws. */
export function shiftBurn(burn: readonly number[], at: number, now: number): number[] {
  const minutes = Math.floor((now - at) / MIN_MS)
  const shift = Number.isNaN(minutes) ? 0 : Math.min(SPARK_COLUMNS, Math.max(0, minutes))
  const list = Array.isArray(burn) ? burn : []
  return Array.from({ length: SPARK_COLUMNS }, (_, i) => (i + shift < SPARK_COLUMNS ? seriesValue(list[i + shift]) : 0))
}

/** A sparkline: each column's height from 0 to 1, oldest first, whether each
 *  is marked (none is today; the burn marks nothing), the text beside it and the image's alt text. */
export type Spark = { columns: number[]; marks: boolean[]; text: string; alt: string }

/** A card's burn rate at `now`, or undefined with no record or no burn
 *  series: the 30 shifted buckets, each over the largest, and the sum over
 *  30 as `N/min`, so the number falls with the sparkline. All zero draws a
 *  flat baseline and reads `0/min`. */
export function burnRate(m: Meter | undefined, now: number): Spark | undefined {
  if (m === undefined || m.burn === undefined) return undefined
  const shifted = shiftBurn(m.burn, m.at, now)
  const top = Math.max(0, ...shifted)
  const rate = tokens(shifted.reduce((s, v) => s + v, 0) / SPARK_COLUMNS)
  return {
    columns: shifted.map(v => (top > 0 ? v / top : 0)),
    marks: shifted.map(() => false),
    text: `${rate}/min · last 30 min`,
    alt: `Burn rate ${rate} tokens per minute over the last 30 min`,
  }
}

// --- The context outlook (issue 545, row 8; issue 581) ---------------------------
//
// A session grows a few thousand tokens a turn, so a line of its context against a
// 0 to 1M window is flat. The outlook is a
// bar of context against the window with a tick where auto-compaction fires,
// an estimate of the turns left and the large turns as dots. It is the one
// context bar: the Cache · context tab's context row and the Context trend
// tab both draw it. Drawn from the meter's numbers and the owner's one
// `autoCompactWindow` figure alone.

/** Where auto-compaction fires when the owner has set no `autoCompactWindow`:
 *  the window less this buffer, never under half the window. An estimate. */
export const COMPACT_BUFFER = 33000
/** A turn that adds more than this is a large one. */
export const LARGE_TURN = 20000
const MAX_DOTS = 5
// The settings file's cap: 1 MiB as a stat size in bytes, and as a text length in
// UTF-16 units (never smaller than the bytes it came from).
const MAX_SETTINGS_BYTES = 1024 * 1024
const LEAST_COMPACT_WINDOW = 50000

/** The owner's `autoCompactWindow` out of their settings text, or undefined:
 *  text of at most 1 MiB holding a JSON object with that own key as a whole
 *  number from 50,000 to the stored cap. The whole text is parsed, but only that
 *  figure leaves the function, and it never throws. */
export function compactWindowFrom(text: unknown): number | undefined {
  if (typeof text !== 'string' || text.length > MAX_SETTINGS_BYTES) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isRecord(parsed) || !Object.prototype.hasOwnProperty.call(parsed, 'autoCompactWindow')) return undefined
  const v = parsed.autoCompactWindow
  return typeof v === 'number' && Number.isInteger(v) && v >= LEAST_COMPACT_WINDOW && v <= MAX_SERIES ? v : undefined
}

/** The owner's `autoCompactWindow`, read from `<config>/settings.json` through
 *  the poll's own reads: a file of at most 1 MiB (a link is followed, since
 *  only the one number is kept), else undefined. Only
 *  the one figure leaves `compactWindowFrom`; the text is kept nowhere. Never
 *  rejects. */
export async function readCompactWindow(config: string, io: { stat: (p: string) => Promise<unknown>; read: (p: string) => Promise<string> }): Promise<number | undefined> {
  const path = `${config}${sepOf(config)}settings.json`
  const s = await io.stat(path).catch(() => undefined)
  if (!isRecord(s) || s.kind !== 'file' || typeof s.size !== 'number' || s.size > MAX_SETTINGS_BYTES) return undefined
  return compactWindowFrom(await io.read(path).catch(() => undefined))
}

/** A card's context outlook. `tick` and the dots' `at` are fractions of the
 *  window; `text` is `<used> of <window>` alone, `compacts` and `turns` are
 *  its parts that the Context trend tab joins on its second line as `second`,
 *  and `dotsText` is fixed words and numbers. */
export type ContextOutlook = {
  fraction: number
  tick: number
  cls: 'done' | 'warn' | 'hot'
  dots: { at: number; added: number }[]
  text: string
  alt: string
  compacts: string
  second: string
  turns?: string
  dotsText?: string
}

/** One card's outlook, or undefined with no window or fewer than 2 calls.
 *  `compactAt` is the owner's `autoCompactWindow` when set: used as the tick
 *  only if a whole number from 50,000 up and under the window, else the
 *  estimate stands. Turns left: the average growth per turn since the last
 *  compaction, over the tokens still to the tick, rounded up; none when the
 *  stretch is flat, shrinking or one call long. */
export function contextOutlook(m: Meter | undefined, compactAt?: unknown): ContextOutlook | undefined {
  if (m === undefined || !Array.isArray(m.context) || m.context.length < 2) return undefined
  const window = m.window
  if (window === undefined || !Number.isFinite(window) || window <= 0) return undefined
  const values = m.context.slice(-SPARK_COLUMNS).map(seriesValue)
  const used = values[values.length - 1] ?? 0
  const set = typeof compactAt === 'number' && Number.isInteger(compactAt) && compactAt >= LEAST_COMPACT_WINDOW && compactAt < window
  const line = set ? (compactAt as number) : Math.max(window - COMPACT_BUFFER, window / 2)
  const marks = values.map((v, i) => i > 0 && v < (values[i - 1] ?? 0) / 2)
  const start = marks.lastIndexOf(true) === -1 ? 0 : marks.lastIndexOf(true)
  const dots: { at: number; added: number }[] = []
  for (let i = start + 1; i < values.length; i++) {
    const added = (values[i] ?? 0) - (values[i - 1] ?? 0)
    if (added > LARGE_TURN) dots.push({ at: unit((values[i] ?? 0) / window), added })
  }
  const shown = dots.slice(-MAX_DOTS)
  const since = values.slice(start)
  const growth = since.length < 2 ? 0 : ((since[since.length - 1] ?? 0) - (since[0] ?? 0)) / (since.length - 1)
  const left = Math.ceil((line - used) / growth)
  const turns = used >= line ? 'at the compaction line' : growth > 0 && Number.isFinite(left) ? `about ${left} ${left === 1 ? 'turn' : 'turns'} to compaction` : undefined
  const share = used / line
  const at = sizeText(line)
  const compacts = `compacts at ${set ? '' : '~'}${at}`
  const out: ContextOutlook = {
    fraction: unit(used / window),
    tick: unit(line / window),
    cls: share >= 0.9 ? 'hot' : share >= 0.7 ? 'warn' : 'done',
    dots: shown,
    // Past the window it reads `over`, as the plain meter does (owner decision q6 B on #251).
    text: used > window ? `${sizeText(used)} · over ${sizeText(window)}` : `${sizeText(used)} of ${sizeText(window)}`,
    alt: `Context ${used > window ? `${sizeText(used)}, over ${sizeText(window)}` : `${sizeText(used)} of ${sizeText(window)}`}, compacts at ${set ? '' : 'about '}${at}`,
    compacts,
    second: turns === undefined ? compacts : `${compacts} · ${turns}`,
  }
  if (turns !== undefined) out.turns = turns
  if (shown.length > 0) out.dotsText = `large turns: ${shown.map(d => `+${sizeText(d.added)}`).join(', ')}`
  return out
}

/** The outlook as an image: the context bar, a tick where compaction fires
 *  and one circle per large turn. Only the fraction, the tick, the dots' `at`
 *  and the class are read, each checked again, so a value of the wrong shape
 *  draws as far as it checks and never throws. */
export function contextOutlookSvg(o: Partial<ContextOutlook>): Extract<UsageView, { kind: 'svg' }> {
  const tick = `<rect class="muted" x="${pct(unit(o.tick ?? Number.NaN) * 100)}" y="${num(3)}" width="${num(2)}" height="${num(CACHE_HEIGHT - 6)}"/>`
  const dots = (Array.isArray(o.dots) ? o.dots : [])
    .slice(0, MAX_DOTS)
    .flatMap(d => (isRecord(d) && typeof d.at === 'number' ? [`<circle class="warn" cx="${pct(unit(d.at) * 100)}" cy="${num(CACHE_Y + CACHE_THICKNESS / 2)}" r="${num(3)}"/>`] : []))
  return thinBar(o.fraction ?? Number.NaN, typeof o.cls === 'string' ? o.cls : '', typeof o.alt === 'string' ? o.alt : '', tick + dots.join(''))
}

// The columns and marks a sparkline builder draws: the newest 30, each column
// clamped to 0 to 1, each mark exactly true or not, so a value of the wrong
// shape draws as far as it checks and never throws.
function sparkColumns(s: Partial<Pick<Spark, 'columns' | 'marks'>>): { column: number; mark: boolean }[] {
  const columns = Array.isArray(s.columns) ? s.columns.slice(-SPARK_COLUMNS) : []
  const marks = Array.isArray(s.marks) ? s.marks.slice(-columns.length) : []
  return columns.map((c, i) => ({ column: unit(c), mark: marks[i] === true }))
}

/** The terminal's sparkline: 30 cells, right-aligned, so the newest column
 *  sits at the right end; a column of 0 is a space and any other one of
 *  `▁` to `█`, never a space. Runs of cells with their theme colour key:
 *  `suggestion`, the blue of class `ok`, and `warning` for a marked one. */
export function sparkRuns(s: Partial<Pick<Spark, 'columns' | 'marks'>>): { text: string; tone: 'suggestion' | 'warning' }[] {
  const cells = sparkColumns(s)
  const runs: { text: string; tone: 'suggestion' | 'warning' }[] = []
  const add = (text: string, tone: 'suggestion' | 'warning') => {
    const last = runs[runs.length - 1]
    if (last !== undefined && last.tone === tone) last.text += text
    else runs.push({ text, tone })
  }
  add(' '.repeat(SPARK_COLUMNS - cells.length), 'suggestion')
  for (const { column, mark } of cells) {
    const block = column > 0 ? (BLOCKS[Math.min(7, Math.max(0, Math.ceil(column * 8) - 1))] ?? '█') : ' '
    add(block, mark ? 'warning' : 'suggestion')
  }
  return runs.filter(r => r.text !== '')
}

/** A sparkline as an image for the surfaces with Svg: one `rect` per column
 *  in 30 slots, right-aligned, each bottom-aligned, `x` and `width` in
 *  percentages from `pct`, `y` and `height` in pixels from `num`, class `ok`,
 *  or `warn` for a marked column. A column of 0 draws the 1 px baseline, and
 *  any other at least 2 px. No text, clip or id. */
export function sparkSvg(s: Partial<Spark>): Extract<UsageView, { kind: 'svg' }> {
  const cells = sparkColumns(s)
  const slot = 100 / SPARK_COLUMNS
  const from = SPARK_COLUMNS - cells.length
  const rects = cells.map(({ column, mark }, i) => {
    const h = column > 0 ? Math.max(LEAST, column * SPARK_HEIGHT) : BASELINE
    return `<rect class="${mark ? 'warn' : 'ok'}" x="${pct((from + i) * slot)}" y="${num(SPARK_HEIGHT - h)}" width="${pct(slot * COLUMN)}" height="${num(h)}"/>`
  })
  const source = `<svg xmlns="${XMLNS}" width="100%" height="${num(SPARK_HEIGHT)}"><style>${STYLE}</style>${rects.join('')}</svg>`
  return { kind: 'svg', source, alt: oneLine(typeof s.alt === 'string' ? s.alt : '', 120), height: SPARK_HEIGHT }
}

// --- Card tabs -----------------------------------------------------------------
//
// A working or idle card has up to three views, each a tab: the cache
// bar and context bar, the burn rate, and the context outlook (the Context trend
// tab). The tab row
// shows only with two or more. The choice is kept per card for the session in
// the `tabs` atom, card title to view word, and read only through
// `VIEW_WORDS` below: an unknown or unavailable word reads as the default. A
// view word holds no hyphen, since a press key is split on one.

/** The tab labels, in tab order, keyed by view word. */
export const VIEW_LABELS: ReadonlyMap<string, string> = new Map([
  ['cache', 'Cache · context'],
  ['burn', 'Burn rate'],
  ['trend', 'Context trend'],
])

/** A view word. */
export type View = 'cache' | 'burn' | 'trend'
// The fixed set every stored or pressed view word is read through.
const VIEW_WORDS: ReadonlyMap<unknown, View> = new Map<unknown, View>([
  ['cache', 'cache'],
  ['burn', 'burn'],
  ['trend', 'trend'],
])

/** A view word read through the fixed set, or undefined for anything else. */
export const viewOf = (word: unknown): View | undefined => VIEW_WORDS.get(word)

const REASONS = new Set(['too-large', 'shared', 'not-found'])

/** Whether a warmth record is one whose reason line the burn rate tab shows
 *  in place of a sparkline, as the cache line does: a transcript too large
 *  to read, a name two sessions share, or a transcript not found. */
export const isReason = (w: Warmth | undefined): boolean => w !== undefined && REASONS.has(w.kind)

/** A card's views, in tab order: the default always; the burn rate when its
 *  meter has a burn series or its warmth is a reason line; the Context trend tab
 *  only when the card has a context outlook (a known window and 2 or more
 *  calls). */
export function cardViews(w: Warmth | undefined, m: Meter | undefined): View[] {
  const views: View[] = ['cache']
  if (m?.burn !== undefined || isReason(w)) views.push('burn')
  if (contextOutlook(m) !== undefined) views.push('trend')
  return views
}

const MAX_TABS = 50

/** The stored tab choices, checked again: pairs of a card title, text of 1
 *  to 300 characters not seen before, and a view word from the fixed set.
 *  Others go, and at most 50 stay, each copied into a new pair. */
export function tabsFrom(stored: unknown): Pair[] {
  const out: Pair[] = []
  if (!Array.isArray(stored)) return out
  const names = new Set<string>()
  for (const p of stored) {
    if (out.length >= MAX_TABS) break
    if (!isRecord(p) || typeof p.name !== 'string' || p.name === '' || p.name.length > MAX_NAME || names.has(p.name)) continue
    const view = viewOf(p.value)
    if (view === undefined) continue
    names.add(p.name)
    out.push({ name: p.name, value: view })
  }
  return out
}

/** The view a card shows: its stored word when the card offers that view,
 *  else the default. */
export function chosenView(stored: unknown, title: string, views: readonly View[]): View {
  const word = viewOf(tabsFrom(stored).find(p => p.name === title)?.value)
  return word !== undefined && views.includes(word) ? word : 'cache'
}

/** The stored choices after a press: the card's last choice replaced by the
 *  new one, at the end, and at most 50 kept, the newest. A word outside the
 *  fixed set changes nothing. */
export function chooseTab(stored: unknown, title: string, word: unknown): Pair[] {
  const kept = tabsFrom(stored)
  const view = viewOf(word)
  if (view === undefined) return kept
  return [...kept.filter(p => p.name !== title), { name: title, value: view }].slice(-MAX_TABS)
}

/** What the live poll remembers of each transcript it read, keyed by path:
 *  its modified time at that read, the engine's clock at that read, and the
 *  call series parsed from it. */
export type ReadMemory = Map<string, { mtimeMs: number; readAt: number; series: CallSeries | undefined }>

// --- The transcript finder ---------------------------------------------------
//
// A session that moved into a worktree after it started writes its transcript
// under the worktree's projects folder, not its launch folder's, while its
// row may still name the launch folder. So the path from `cwd` is
// tried first, then the worktree folders of the launch folder, found by
// listing the projects folder at most once a minute. Every path either step
// gives is taken only when a resolving `stat` finds a regular file, not
// itself a link, whose real path is the expected file inside the real
// projects folder: a link at the file or at any folder above it inside
// `projects`, swapped in at any time, fails at the next check. The check and
// the read are two engine calls, and the read follows links, so a swap between
// them, or a hard link, is not caught: `docs/security/brigade.md` row 15 names that gap.
// Nothing found is never an error: a rejection counts as no hit and its
// message is dropped.

/** A listing of more entries than this is not looked at. */
export const MAX_LISTING = 5000
/** More candidate folders than this for one launch folder is not a brigade. */
export const MAX_CANDIDATES = 20
/** The projects folder is listed at most this often. */
export const LIST_EVERY_MS = 60000
// The longest folder name a candidate may have.
const MAX_FOLDER = 255
// What a worktree folder's projects name holds after its launch folder's:
// `<launch>\.claude\worktrees\<name>` made into a name.
const WORKTREES = '--claude-worktrees-'

/** A resolving `stat`'s answer, as far as the finder reads it. */
export type FoundStat = { kind: string; size: number; mtimeMs: number; isLink?: boolean; realPath?: string }

/** The file system and clock as the finder reaches them, and whether the
 *  pane is still open. `stat` resolves, so it gives a real path. `stat`,
 *  `list` and `now` may reject, and an engine with no `list` has none. */
export type FinderIo = {
  live: () => boolean
  now: () => Promise<number>
  stat: (path: string) => Promise<FoundStat>
  list?: (path: string) => Promise<unknown>
}

/** A transcript the finder placed: its path, and its size and modified time
 *  from the `stat` that placed it. */
export type Found = { path: string; size: number; mtimeMs: number }

/** What the finder keeps between polls, in module memory and never in plugin
 *  state, since it holds paths and listed names. */
export type Finder = {
  /** The real projects folder, asked once per poll; undefined when it does
   *  not resolve to a folder, and then nothing is found that poll. */
  real: string | undefined
  /** When the projects folder was last listed, on the engine's clock. */
  listedAt: number | undefined
  /** That listing's folder names, or undefined when it was rejected, over
   *  the cap or not a list. */
  names: string[] | undefined
  /** By session id, the worktree folder a search found, or undefined for a
   *  miss: kept until the next listing, so at most a minute. */
  remembered: Map<string, string | undefined>
  /** This poll's result by member name, for the link reads: the transcript
   *  found, or undefined when the finder found none. A name the finder did
   *  not look for this poll is absent. */
  byName: Map<string, Found | undefined>
}

/** A finder with nothing known yet. */
export const newFinder = (): Finder => ({ real: undefined, listedAt: undefined, names: undefined, remembered: new Map(), byName: new Map() })

/** Asks the real projects folder once for the poll, and keeps it in the
 *  finder: the resolving `stat`'s real path, when it finds a folder. */
export async function readProjects(config: string, io: FinderIo, finder: Finder): Promise<void> {
  const s = await io.stat(`${config}${sepOf(config)}projects`).catch(() => undefined)
  finder.real = isRecord(s) && s.kind === 'dir' && typeof s.realPath === 'string' && s.realPath !== '' ? s.realPath : undefined
}

// The place check: the file at <config>/projects/<folder>/<id>.jsonl, taken
// only when a resolving `stat` finds a regular file that is not itself a
// link, whose real path is the real projects folder, then the folder, then
// the file, compared as the roster path rule compares. Never rejects.
async function placed(config: string, folder: string, sessionId: string, io: FinderIo, real: string): Promise<Found | undefined> {
  const sep = sepOf(config)
  const path = `${config}${sep}projects${sep}${folder}${sep}${sessionId}.jsonl`
  const s = await io.stat(path).catch(() => undefined)
  if (!isRecord(s) || s.kind !== 'file' || s.isLink !== false || typeof s.realPath !== 'string') return undefined
  const fold = foldsCase(config)
  if (pathKey(s.realPath, fold) !== pathKey(`${real}/${folder}/${sessionId}.jsonl`, fold)) return undefined
  return { path, size: s.size, mtimeMs: s.mtimeMs }
}

// The projects folder's listing, as the folder names a worktree folder could
// have: folders that are not links, with a name of at most 255 characters,
// no separator and `--claude-worktrees-` in it. No other name is kept. A listing of more than 5,000 entries, one that is not a
// list, or a rejected one is no names at all.
async function listNames(config: string, io: FinderIo): Promise<string[] | undefined> {
  let entries: unknown
  try {
    if (io.list === undefined) return undefined
    entries = await io.list(`${config}${sepOf(config)}projects`)
  } catch {
    return undefined
  }
  if (!Array.isArray(entries) || entries.length > MAX_LISTING) return undefined
  const fold = foldsCase(config)
  const marker = pathKey(WORKTREES, fold)
  const names: string[] = []
  for (const e of entries) {
    if (!isRecord(e) || e.kind !== 'dir' || e.isLink !== false || typeof e.name !== 'string') continue
    if (e.name === '' || e.name.length > MAX_FOLDER || /[\\/]/.test(e.name) || !pathKey(e.name, fold).includes(marker)) continue
    names.push(e.name)
  }
  return names
}

/** A member's transcript, or undefined when none is found.
 *
 *  First the path from `cwd`. Else the worktree folders of the launch
 *  folder: the projects folder is listed at most once a minute, the last
 *  listing reused between, and a folder whose name starts with the launch
 *  folder's name and `--claude-worktrees-` is a candidate. Exactly one
 *  candidate holding the session's transcript is it; more than 20
 *  candidates, two hits or none give none. That result, hit or miss, is
 *  remembered by session id until the next listing, and a remembered hit
 *  passes the place check again before each use. Every path passes the
 *  place check. Call `readProjects` once per poll first. Never rejects. */
export async function findTranscript(config: string, row: SessionRow, io: FinderIo, finder: Finder): Promise<Found | undefined> {
  const { sessionId, cwd } = row
  const real = finder.real
  if (sessionId === undefined || cwd === undefined || !SESSION_ID.test(sessionId) || real === undefined) return undefined
  const home = projectFolder(cwd)
  if (home === '') return undefined
  const first = await placed(config, home, sessionId, io, real)
  if (first !== undefined || !io.live()) return first
  try {
    const now = await io.now()
    if (!io.live()) return undefined
    const last = finder.listedAt
    // A clock answer that is not a number lists nothing and is never kept:
    // the last listing and the memory stand until a real time comes.
    if (Number.isFinite(now) && (last === undefined || now < last || now - last >= LIST_EVERY_MS)) {
      finder.listedAt = now
      finder.remembered.clear()
      finder.names = await listNames(config, io)
      if (!io.live()) return undefined
    }
    if (finder.remembered.has(sessionId)) {
      const folder = finder.remembered.get(sessionId)
      return folder === undefined ? undefined : await placed(config, folder, sessionId, io, real)
    }
    const fold = foldsCase(config)
    const prefix = pathKey(`${home}${WORKTREES}`, fold)
    const candidates = (finder.names ?? []).filter(n => pathKey(n, fold).startsWith(prefix))
    let hit: { folder: string; found: Found } | undefined
    if (candidates.length <= MAX_CANDIDATES) {
      let hits = 0
      for (const folder of candidates) {
        const found = await placed(config, folder, sessionId, io, real)
        if (!io.live()) return undefined
        if (found === undefined) continue
        hits += 1
        hit = { folder, found }
      }
      if (hits !== 1) hit = undefined
    }
    finder.remembered.set(sessionId, hit?.folder)
    return hit?.found
  } catch {
    return undefined
  }
}

/** A working member's transcript is read at most this often. */
export const WORKING_EVERY_MS = 60000
/** At most this many working members' transcripts are read in one poll. */
export const WORKING_PER_POLL = 5

// A working member's read is due unless its last read is less than a minute
// before `now`. A read time that is not a number, or one ahead of the clock,
// is due, so a clock that went back cannot hold a member unread.
const readDue = (readAt: number | undefined, now: number) =>
  readAt === undefined || !Number.isFinite(readAt) || !(now >= readAt && now - readAt < WORKING_EVERY_MS)
// For the order of working reads: never read, or read at no known time, first.
const readOrder = (readAt: number | undefined) => (readAt !== undefined && Number.isFinite(readAt) ? readAt : -Infinity)

// --- The summary reader ------------------------------------------------------
//
// A member's summary file, which its own session writes (see "The usage
// summary writer" below), feeds its card whenever one passes its checks, at
// every transcript size, and is never compared with the transcript (spec
// revision 5 on #304, S4 "The reader"). The file is found by the session row's
// session id in the lead's own plugin data folder and in the data folder of
// every other install of this plugin (issue 507), each under the roster's
// path rule, read every poll, and checked from its stat size before any read.

/** A file-fed card's cache window: a fixed hour, since a step's usage does
 *  not say whether a call cached for 5 minutes or an hour. */
export const HOUR_SUMMARY_MS = HOUR_MS

/** What the summary reads remember of each member, by data folder and the
 *  session row's session id (`<folder>/<session id>`), in module memory
 *  only: the last summary that passed its checks, and the modified time of
 *  the file that last failed one. One folder's file never clears or holds
 *  another's. */
export type SummaryMemory = Map<string, { good?: Summary; failedAt?: number }>

/** Nothing remembered yet. */
export const newSummaryMemory = (): SummaryMemory => new Map()

/** The summary reads a poll makes: the lead's own plugin data id, which names
 *  the first folder the files are looked for in (the other installs' folders
 *  come from `listInstalls`), and what the reads remember between polls. */
export type SummaryReads = { plugin: string; held: SummaryMemory }

// The other installs' data folders a poll reads (issue 507): a member started
// from another install of this plugin writes its summary there. Only a plain
// folder named `grimoire-` and an id of 1 to 80 characters is taken, the lead's own never
// counted, and at most seven of them, in sorted order.
const INSTALL_NAME = /^grimoire-[A-Za-z0-9_-]{1,80}$/
const MAX_OTHER_INSTALLS = 7

/** The other installs' data folder names under `<config>/plugins/data`, at
 *  most seven, sorted. A listing that rejects, is not a list or is over
 *  `MAX_LISTING` entries gives none, and so does an engine with no listing.
 *  An entry that is not a plain folder (a link included) is skipped; each
 *  folder named still passes the roster path rule, folder by folder, when its
 *  summary is placed. Never rejects. */
export async function listInstalls(config: string, own: string, io: FinderIo): Promise<string[]> {
  let entries: unknown
  try {
    if (io.list === undefined) return []
    const sep = sepOf(config)
    entries = await io.list(`${config}${sep}plugins${sep}data`)
  } catch {
    return []
  }
  if (!Array.isArray(entries) || entries.length > MAX_LISTING) return []
  const names = new Set<string>()
  for (const e of entries) {
    if (!isRecord(e) || e.kind !== 'dir' || e.isLink !== false || typeof e.name !== 'string') continue
    if (e.name !== own && INSTALL_NAME.test(e.name)) names.add(e.name)
  }
  return [...names].sort().slice(0, MAX_OTHER_INSTALLS)
}

// The two kinds of refusal a card can draw, and their lines. A stored word
// outside these draws nothing. No ◆: the ◆ line is the cache warmth's.
const REFUSAL_LINES: ReadonlyMap<unknown, string> = new Map<unknown, string>([
  ['path', 'summary path refused'],
  ['file', 'not a summary file'],
])
const MAX_REFUSALS = 50
// At most this many stored entries are looked at, kept or not, so a list
// another plugin rewrote costs a bounded walk.
const MAX_REFUSALS_LOOKED = 200

/** The stored refusal pairs, checked again: plugin state is the engine's, and
 *  another plugin may rewrite it. A pair goes unless its name is text of 1 to
 *  300 characters not seen before and its value one of the two kind words;
 *  at most 50 stay, each copied into a new pair, and at most the first 200
 *  entries are looked at. */
export function refusalsFrom(stored: unknown): Pair[] {
  const out: Pair[] = []
  if (!Array.isArray(stored)) return out
  const names = new Set<string>()
  for (const p of stored.slice(0, MAX_REFUSALS_LOOKED)) {
    if (out.length >= MAX_REFUSALS) break
    if (!isRecord(p) || typeof p.name !== 'string' || p.name === '' || p.name.length > MAX_NAME || names.has(p.name)) continue
    if (typeof p.value !== 'string' || !REFUSAL_LINES.has(p.value)) continue
    out.push({ name: p.name, value: p.value })
    names.add(p.name)
  }
  return out
}

/** The cards' dim refusal lines, by card title, read once per render and only
 *  through the two kind words: "summary path refused" or "not a summary
 *  file". */
export function refusalLines(stored: unknown): Map<string, string> {
  const out = new Map<string, string>()
  for (const p of refusalsFrom(stored)) {
    const line = REFUSAL_LINES.get(p.value)
    if (line !== undefined) out.set(p.name, line)
  }
  return out
}

/** The members' model ids from their summary files, by card title, read once per
 *  render, from the stored name and family pairs; only a family from the fixed list counts (issue 598). */
export function modelLines(stored: unknown): Map<string, string> {
  const out = new Map<string, string>()
  if (!Array.isArray(stored)) return out
  for (const p of stored.slice(0, MAX_REFUSALS_LOOKED)) {
    if (!isRecord(p) || typeof p.name !== 'string' || typeof p.value !== 'string' || !MODEL_FAMILIES.includes(p.value)) continue
    out.set(p.name, p.value)
  }
  return out
}

// What one member's summary read decided: a summary to draw from; none, so
// the card comes from the transcript; or a refusal line, and the card from
// the transcript.
type SummarySource = { summary: Summary } | { none: true } | { refused: 'path' | 'file' }

// The path rule's `stat`, from the poll's: a rejection sorted into missing or
// failed by its message, a link anything but an answer of exactly false, and
// the file's modified time kept in `seen`, for `readSummaryIn`, from the same
// `stat` that placed it.
function ruleStat(io: FinderIo, seen: Map<string, number>): (path: string) => Promise<StatAnswer> {
  return path =>
    io.stat(path).then(
      s => {
        if (!isRecord(s)) return { failed: 'not a stat' }
        seen.set(path, s.mtimeMs)
        const kind = s.kind === 'file' || s.kind === 'dir' ? s.kind : 'other'
        const found = { kind, size: s.size, isLink: s.isLink !== false } as const
        return { found: typeof s.realPath === 'string' ? { ...found, realPath: s.realPath } : found }
      },
      err => statRejection(String(err instanceof Error ? err.message : err)),
    )
}

/** One member's summary file, by the rule for each kind of failure (spec S4):
 *  - the path rule refuses: the "path" refusal, nothing held;
 *  - no file there: none, nothing held;
 *  - a format version this plugin does not know: none, nothing held;
 *  - a passing file: drawn from, and held;
 *  - any other failure (the stat size or the text over the cap, a read that
 *    rejects, the strict check, a last call or a meter time more than
 *    2 minutes after the file's modified time or ahead of `now`): the held
 *    summary, or none with
 *    nothing held; the same file, by its modified time, failing two polls
 *    running gives the "file" refusal, with nothing held after.
 *  With no clock (`now` not a number) the file is not read: the held summary,
 *  or none, and no failure is counted. Never rejects. */
async function readSummaryIn(config: string, folder: string, sessionId: string, io: PollIo, now: number, held: SummaryMemory): Promise<SummarySource> {
  const key = `${folder}/${sessionId}`
  const seen = new Map<string, number>()
  const placed = await placeSummary(config, folder, sessionId, ruleStat(io, seen)).catch(() => ({ refused: '' }))
  if ('refused' in placed) {
    held.delete(key)
    return { refused: 'path' }
  }
  const existing = placed.existing
  if (existing === undefined) {
    held.delete(key)
    return { none: true }
  }
  const had = held.get(key)
  const keep = (): SummarySource => (had?.good === undefined ? { none: true } : { summary: had.good })
  if (!Number.isFinite(now)) return keep()
  const mtimeMs = seen.get(placed.file)
  const checked = await checkedSummary(placed.file, existing.size, mtimeMs, now, io)
  if (checked === UNKNOWN_SUMMARY_VERSION) {
    held.delete(key)
    return { none: true }
  }
  if (typeof checked !== 'string') {
    held.set(key, { good: checked })
    return { summary: checked }
  }
  // A failure. The same file failing again, by its modified time, is not a
  // summary file; a time that is not a number is never the same.
  if (had?.failedAt !== undefined && had.failedAt === mtimeMs) {
    held.set(key, { failedAt: mtimeMs })
    return { refused: 'file' }
  }
  held.set(key, { ...(had?.good === undefined ? {} : { good: had.good }), ...(typeof mtimeMs === 'number' && Number.isFinite(mtimeMs) ? { failedAt: mtimeMs } : {}) })
  return keep()
}

/** One member's summary across the folders, the lead's own first: each
 *  folder by `readSummaryIn`'s rules, and then
 *  - the passing summary with the newest last call feeds the card, the
 *    earlier folder winning a tie; a refusal in any folder never hides it;
 *  - with none passing, the lead's own folder's refusal is drawn, and a
 *    refusal in any other folder draws nothing;
 *  - else none. Never rejects. */
async function readSummary(config: string, folders: readonly string[], sessionId: string, io: PollIo, now: number, held: SummaryMemory): Promise<SummarySource> {
  let best: Summary | undefined
  let own: SummarySource = { none: true }
  for (const [n, folder] of folders.entries()) {
    const source = await readSummaryIn(config, folder, sessionId, io, now, held)
    if (n === 0) own = source
    if ('summary' in source && (best === undefined || source.summary.lastAt > best.lastAt)) best = source.summary
  }
  if (best !== undefined) return { summary: best }
  return 'refused' in own ? own : { none: true }
}

// The summary at `file`, or why not, in fixed words: the stat size against
// the cap before any read, the text's own size after it, the strict check,
// then the last call and the meter time against the file's modified time and
// the pane's clock.
async function checkedSummary(file: string, size: number, mtimeMs: number | undefined, now: number, io: PollIo): Promise<Summary | string> {
  if (!(size <= MAX_SUMMARY_BYTES)) return 'over the cap'
  const text = await io.read(file).then(String, () => undefined)
  if (text === undefined) return 'not read'
  if (new TextEncoder().encode(text).length > MAX_SUMMARY_BYTES) return 'over the cap'
  const checked = checkSummary(text)
  if ('error' in checked) return checked.error
  const s = checked.value
  if (typeof mtimeMs !== 'number' || !Number.isFinite(mtimeMs) || s.lastAt > mtimeMs + SLACK_MS) return 'after its file'
  if (s.lastAt > now + SLACK_MS) return 'ahead of the clock'
  // The meter time is the end of the minute the write fell in, so at most a
  // minute past the write: one further ahead would keep its burn from ever
  // draining.
  if (s.at > mtimeMs + SLACK_MS || s.at > now + SLACK_MS) return 'meter time ahead'
  return s
}

// A summary as the card's two records: the warmth record, its window the
// fixed hour when a call wrote or read cache and unknown otherwise, and the
// meter record, through the meter check, its window left out when the file
// has none.
function summaryRecords(name: string, s: Summary): { warmth: Warmth; meter?: Meter; model?: Pair } {
  const warmth: Warmth = { name, kind: 'call', at: s.lastAt, tokens: s.lastTokens }
  if (s.cache === 1) warmth.windowMs = HOUR_SUMMARY_MS
  const meter = metersFrom([{ name, at: s.at, window: s.window, burn: s.burn, context: s.context }])[0]
  const model = s.model === undefined ? {} : { model: { name, value: s.model } }
  return meter === undefined ? { warmth, ...model } : { warmth, meter, ...model }
}

/** The live poll's summary and transcript reads, and the records they
 *  give: the warmth records, the meters and the summary refusal pairs.
 *  Undefined when the pane closed on the way, so nothing is stored.
 *
 *  Only a roster member is read, through the finder, which asks the real
 *  projects folder once for the poll and keeps each member's result in
 *  `finder.byName` for the link reads. A name on rows with two or more
 *  session ids, or on two rows one of which has none, is shared: neither
 *  its summary file nor its transcript is looked for. With `summaries`, each
 *  other member's summary files are read by `readSummary`'s rules, in the
 *  lead's own data folder and the other installs' (`listInstalls`): one that
 *  passes gives its card's records at any transcript size, with no
 *  transcript read for them, and a refusal adds a pair, the member's name
 *  and `path` or `file`. A member with no summary to draw from is read from
 *  its transcript, as follows. A member the finder finds nowhere records "not
 *  found". Each found transcript has passed the finder's place check, and
 *  one over 4 MiB is not read and records "too large". A transcript is read
 *  only when its modified time differs from the one `memory` holds for its
 *  path, or its last read had no clock to go by. An idle member is read then,
 *  every poll. A working member (`busy`, `running` or `working`) is read at
 *  most once a minute, and at most 5 working members a poll, those read
 *  longest ago first, never-read ones before all, then in roster order; with
 *  no clock this poll, none is. The clock is asked once a poll, and a read's
 *  series is cut at it. `memory` gets an entry only after a read that
 *  succeeded, so a failed read is tried again; the record is then the last
 *  good one. A working member with no known call records `unread`. A member
 *  with a call series gets a meter: the end of the clock minute of the read
 *  that gave it, where its burn buckets end, and its numbers. Paths no member's transcript is found at leave `memory`, and
 *  session ids no member has leave the finder's memory. */
export async function readCalls(
  rows: readonly SessionRow[],
  titles: readonly string[],
  config: string,
  memory: ReadMemory,
  io: PollIo,
  finder: Finder = newFinder(),
  summaries?: SummaryReads,
): Promise<{ warmth: Warmth[]; meters: Meter[]; refusals: Pair[]; models: Pair[] } | undefined> {
  const members = new Set(titles)
  const byName = new Map<string, SessionRow[]>()
  for (const r of rows) {
    if (members.has(r.name)) byName.set(r.name, [...(byName.get(r.name) ?? []), r])
  }
  // Each member's place in the output, in roster order: a record already
  // known, with a meter when a summary file gave it, or a transcript to read
  // from.
  type Slot = { warmth: Warmth; meter?: Meter; model?: Pair } | { name: string; working: boolean; path: string; mtimeMs: number }
  const slots: Slot[] = []
  const refusals: Pair[] = []
  const named = new Set<string>()
  const ids = new Set<string>()
  let asked = false
  // The data folders the summaries are looked for in, listed once a poll and
  // only when a member's summary is read: the lead's own, then the others.
  let folders: string[] | undefined
  // The clock, asked once a poll, before the summary reads need it.
  let now = Number.NaN
  let clocked = false
  const clock = async () => {
    if (clocked) return now
    clocked = true
    try {
      now = await io.now()
    } catch {
      // No clock this poll: idle members are still read, none gets a meter,
      // and no new summary record is taken.
    }
    return now
  }
  finder.byName.clear()
  for (const [name, list] of byName) {
    // Rows that all hold one session id are one session seen twice, as when
    // a Desktop session is resumed in the CLI; the row with a working folder
    // is read. Two different ids, or a row with none, make the name shared.
    const one = list.length === 1 || list.every(r => r.sessionId !== undefined && r.sessionId === list[0]?.sessionId)
    const row = one ? (list.find(r => r.cwd !== undefined) ?? list[0]) : undefined
    if (row === undefined) {
      slots.push({ warmth: { name, kind: 'shared' } })
      continue
    }
    if (row.sessionId === undefined) continue
    ids.add(row.sessionId)
    if (!io.live()) return undefined
    // The transcript is looked for only from a working folder; the summary
    // file by the session id alone.
    let found: Found | undefined
    if (row.cwd !== undefined) {
      if (!asked) {
        await readProjects(config, io, finder)
        asked = true
        if (!io.live()) return undefined
      }
      found = await findTranscript(config, row, io, finder)
      if (!io.live()) return undefined
      finder.byName.set(name, found)
      if (found !== undefined) named.add(found.path)
    }
    // A passing summary file feeds the card at any transcript size; the
    // transcript stays found for the link read.
    if (summaries !== undefined && SESSION_ID.test(row.sessionId)) {
      folders ??= [summaries.plugin, ...(await listInstalls(config, summaries.plugin, io))]
      if (!io.live()) return undefined
      const source = await readSummary(config, folders, row.sessionId, io, await clock(), summaries.held)
      if (!io.live()) return undefined
      if ('refused' in source) refusals.push({ name, value: source.refused })
      if ('summary' in source) {
        slots.push(summaryRecords(name, source.summary))
        continue
      }
    }
    if (row.cwd === undefined) continue
    if (found === undefined) {
      slots.push({ warmth: { name, kind: 'not-found' } })
      continue
    }
    if (!Number.isFinite(found.mtimeMs)) continue
    if (!Number.isFinite(found.size) || found.size > MAX_TRANSCRIPT_BYTES) {
      slots.push({ warmth: { name, kind: 'too-large' } })
      continue
    }
    // One session on two rows is working when either row says so.
    slots.push({ name, working: list.some(r => isWorking(r.status)), path: found.path, mtimeMs: found.mtimeMs })
  }

  // Which transcripts to read: every changed one of an idle member, and of
  // the changed ones of working members that are due, the 5 read longest
  // ago. A clock that rejects or is not a number reads no working member.
  await clock()
  if (!io.live()) return undefined
  const files = slots.flatMap(s => ('warmth' in s ? [] : [s]))
  const changed = files.filter(f => {
    const had = memory.get(f.path)
    return had === undefined || had.mtimeMs !== f.mtimeMs || !Number.isFinite(had.readAt)
  })
  const working = Number.isFinite(now)
    ? changed
        .filter(f => f.working && readDue(memory.get(f.path)?.readAt, now))
        .sort((a, b) => readOrder(memory.get(a.path)?.readAt) - readOrder(memory.get(b.path)?.readAt))
        .slice(0, WORKING_PER_POLL)
    : []
  const chosen = new Set([...changed.filter(f => !f.working), ...working])
  for (const f of files) {
    if (!chosen.has(f)) continue
    const text = await io.read(f.path).catch(() => undefined)
    if (!io.live()) return undefined
    if (text !== undefined) memory.set(f.path, { mtimeMs: f.mtimeMs, readAt: now, series: callSeries(text, f.mtimeMs, now) })
  }

  const warmth: Warmth[] = []
  const meters: Meter[] = []
  const models: Pair[] = []
  for (const s of slots) {
    if ('warmth' in s) {
      warmth.push(s.warmth)
      if (s.meter !== undefined) meters.push(s.meter)
      if (s.model !== undefined) models.push(s.model)
      continue
    }
    const had = memory.get(s.path)
    const series = had?.series
    if (series !== undefined) {
      warmth.push({ name: s.name, kind: 'call', ...series.last })
      if (had !== undefined && Number.isFinite(had.readAt)) {
        const meter: Meter = { name: s.name, at: burnEnd(had.readAt), burn: series.burn, context: series.context }
        if (series.window !== undefined) meter.window = series.window
        meters.push(meter)
      }
    }
    // Working with no known call: not read yet, or read before its first
    // model call. Its card says it is working, with no size.
    else if (s.working) warmth.push({ name: s.name, kind: 'unread' })
  }
  for (const path of [...memory.keys()]) if (!named.has(path)) memory.delete(path)
  for (const id of [...finder.remembered.keys()]) if (!ids.has(id)) finder.remembered.delete(id)
  // A held key is `<folder>/<session id>` (see `SummaryMemory`); a folder name holds no `/`.
  if (summaries !== undefined) for (const key of [...summaries.held.keys()]) if (!ids.has(key.slice(key.indexOf('/') + 1))) summaries.held.delete(key)
  return { warmth, meters, refusals, models }
}

/** What the link read does for a member the finder looked for this poll,
 *  from the path it found (`found`), the path the link was last read from
 *  (`from`) and whether a link is stored for the member: `read` a found
 *  path the link was not read from, `skip` one it was, and with none found
 *  `drop` the stored link, even one whose path this module no longer holds,
 *  as after a reload; with no link either, `skip`. A found path not read
 *  from whose transcript's `size` is over 4 MiB, or not a number, is
 *  `keep`: the engine would refuse the read, and a session's Remote Control
 *  link does not change, so the stored link stays as it is, after a reload
 *  and on a moved path of the same session too (q3 A and q4 A on #308). A
 *  remembered path of another session, by its file name, is `read`
 *  instead: the engine refuses the read, and the old session's link goes.
 *  With no `size`, as before. */
export function linkStep(found: string | undefined, from: string | undefined, stored: boolean, size?: number): 'read' | 'drop' | 'skip' | 'keep' {
  if (found !== undefined) {
    if (found === from) return 'skip'
    const large = size !== undefined && !(size <= MAX_TRANSCRIPT_BYTES)
    return large && (from === undefined || sameFile(found, from)) ? 'keep' : 'read'
  }
  return from !== undefined || stored ? 'drop' : 'skip'
}

/** The stored links whose name is a card on the roster: a link for a card
 *  that left the roster goes (#281). The same list when none goes. */
export function linksOnRoster<T extends { name: string }>(list: readonly T[], titles: readonly string[]): readonly T[] {
  const kept = list.filter(p => titles.includes(p.name))
  return kept.length === list.length ? list : kept
}

// Whether two transcript paths end in the same file name, the session id,
// compared as the path rule compares.
const sameFile = (a: string, b: string): boolean => {
  const name = (p: string) => p.split(/[\\/]/).pop() ?? ''
  const fold = foldsCase(a)
  return pathKey(name(a), fold) === pathKey(name(b), fold)
}

/** The file system and clock as the poll's reads reach them, and whether the
 *  pane is still open: the finder's, and the read. `read` may reject. */
export type PollIo = FinderIo & { read: (path: string) => Promise<string> }

// --- The engine's session files -------------------------------------------------
//
// The engine keeps one small file for each running session,
// <config>/sessions/<pid>.json, holding the fields `claude agents --json`
// prints; that command also reaches every live session, which makes each of
// them do work at once (#347). So the live state is read from the files
// alone, which costs no process, and the pane never runs it. Only a `<digits>.json` the listing names as a
// plain file is opened, so the `.key` file beside each is never opened by
// name. Each file passes the same place check as the finder's (`placed`),
// repeated here for the sessions folder, so a change to one needs the other:
// a regular file, not itself a link, whose real path is the expected file in
// the real sessions folder, and at most 8 KiB at its stat and once read (they
// are under 1 KiB). A hard link is not caught, as in the finder; nothing from
// a file that is not a session row is kept.

/** The one line the pane draws when a session file fails its check or the
 *  sessions folder cannot be read. Fixed words: never a path or a reason. */
export const SESSIONS_UNREAD = 'Cannot read the session files.'
/** A session file larger than this is not read. */
export const MAX_SESSION_FILE_BYTES = 8192
// The engine names each session's file by its process id.
const SESSION_FILE = /^\d{1,10}\.json$/
// More session files than this is not a brigade.
const MAX_SESSION_FILES = 500

/** What one read of the session files found: the rows, whether every file
 *  the listing named was read and passed its checks, and whether a file went
 *  after the listing, which counts as a read that is not complete: the stop's
 *  name check refuses on it. */
export type SessionsRead = { rows: SessionRow[]; complete: boolean; fileGone: boolean }

// A rejection that says the file is not there: a session that ended after
// the listing took its file with it.
const gone = (err: unknown): boolean => /\bENOENT\b/.test(String(err instanceof Error ? err.message : err))

/** Reads the engine's session files as rows, or undefined when the sessions
 *  folder is missing, is not a folder, is a link, has no real path or one
 *  other than the real config folder's `sessions`, or cannot be listed as a
 *  list of at most `MAX_LISTING` entries. A file that fails a check or a
 *  read is skipped, and the read is then not complete; a file gone since the
 *  listing is skipped too, the read stays complete, and `fileGone` is set.
 *  Never rejects. */
export async function readSessions(config: string, io: PollIo): Promise<SessionsRead | undefined> {
  const sep = sepOf(config)
  const dir = `${config}${sep}sessions`
  const fold = foldsCase(config)
  const d = await io.stat(dir).catch(() => undefined)
  if (!isRecord(d) || d.kind !== 'dir' || d.isLink !== false || typeof d.realPath !== 'string' || d.realPath === '') return undefined
  // The folder's real path is the real config folder's `sessions`, as the
  // roster path rule compares, so a link the stat does not report is caught.
  const c = await io.stat(config).catch(() => undefined)
  if (!isRecord(c) || typeof c.realPath !== 'string' || c.realPath === '') return undefined
  if (pathKey(d.realPath, fold) !== pathKey(`${c.realPath}/sessions`, fold)) return undefined
  const real = d.realPath
  let entries: unknown
  try {
    if (io.list === undefined) return undefined
    entries = await io.list(dir)
  } catch {
    return undefined
  }
  if (!Array.isArray(entries) || entries.length > MAX_LISTING) return undefined
  const rows: SessionRow[] = []
  let complete = true
  let fileGone = false
  let taken = 0
  for (const e of entries) {
    if (!isRecord(e) || typeof e.name !== 'string' || !SESSION_FILE.test(e.name)) continue
    if (e.kind !== 'file' || e.isLink !== false || taken >= MAX_SESSION_FILES) {
      complete = false
      continue
    }
    taken += 1
    const path = `${dir}${sep}${e.name}`
    try {
      const s = await io.stat(path)
      if (!isRecord(s) || s.kind !== 'file' || s.isLink !== false || typeof s.realPath !== 'string') throw new Error('place')
      if (pathKey(s.realPath, fold) !== pathKey(`${real}/${e.name}`, fold)) throw new Error('place')
      if (!(s.size <= MAX_SESSION_FILE_BYTES)) throw new Error('size')
      const text = String(await io.read(path))
      // The cap again on what was read: a file swapped after the stat.
      if (new TextEncoder().encode(text).length > MAX_SESSION_FILE_BYTES) throw new Error('size')
      const row = sessionRow(text)
      if (row === undefined) throw new Error('shape')
      rows.push(row)
    } catch (err) {
      if (gone(err)) fileGone = true
      else complete = false
    }
  }
  return { rows, complete, fileGone }
}

// --- The usage summary writer -------------------------------------------------
//
// Every session keeps its own usage numbers from its `turn.step` hook and
// writes them, numbers only, to a summary file of its own, which the lead's
// pane draws its card from (see "The summary reader" above). These are the
// writer's decisions; brigade/writer.ts only feeds them, stats and writes.
// A step is counted exactly as `callSeries` counts a transcript row, so the
// numbers mean the same from either source.

/** One counted step: its context tokens (input, cache writes and cache
 *  reads), its new tokens (input, cache writes and output), whether it wrote
 *  or read cache, and its model's window from the fixed table (undefined when
 *  the table has none), and its model family from the fixed list (issue 598). */
export type StepCall = { tokens: number; fresh: number; cache: boolean; window: number | undefined; model: string | undefined }

/** The step as the writer counts it, or undefined when it records nothing.
 *  `input` is the step's input, `result` the step's result. A step outside
 *  the main loop (any `agentId`) records nothing, nor does one whose usage is
 *  null or not an object, one with a count that is not a whole number from 0
 *  to 10,000,000 (absent reads as 0, as in a transcript row), or one with no
 *  context at all. The stop reason never excludes a step. Never throws. */
export function stepCall(input: { agentId?: unknown }, result: { usage?: unknown }): StepCall | undefined {
  try {
    return countStep(input, result)
  } catch {
    // A field that throws when read is not a step to count.
    return undefined
  }
}

function countStep(input: { agentId?: unknown }, result: { usage?: unknown }): StepCall | undefined {
  if (!isRecord(input) || input.agentId !== undefined || !isRecord(result)) return undefined
  const u = result.usage
  if (!isRecord(u)) return undefined
  const input_ = count(u.input_tokens)
  const made = count(u.cache_creation_input_tokens)
  const cached = count(u.cache_read_input_tokens)
  const output = count(u.output_tokens)
  if (input_ === undefined || made === undefined || cached === undefined || output === undefined) return undefined
  const tokens = input_ + made + cached
  if (tokens === 0) return undefined
  const model = familyOf(u.model)
  return { tokens, fresh: input_ + made + output, cache: made > 0 || cached > 0, window: windowOf(u.model), model }
}

/** What the writer remembers of the calls it counted since the module
 *  loaded, in module memory only: how many, the last one's time and context,
 *  its window, the last 30 contexts (oldest first), the new tokens of each
 *  minute it saw in the last 30 (keyed as `callSeries` buckets them, by the
 *  minute a call's time ends), and whether any call wrote or read cache. */
export type UsageMemory = {
  calls: number
  last: { at: number; tokens: number } | undefined
  window: number | undefined
  model: string | undefined
  context: number[]
  burn: { minute: number; sum: number }[]
  cache: boolean
}

/** Memory with no call counted: what a module load starts from. */
export const newUsageMemory = (): UsageMemory => ({ calls: 0, last: undefined, window: undefined, model: undefined, context: [], burn: [], cache: false })

// The minute a time falls in, as `callSeries` buckets it: minute m holds the
// times after (m - 1) minutes and up to m minutes.
const minuteOf = (at: number) => Math.ceil(at / MIN_MS)

/** The memory with one more counted call, stamped `at` by the module's clock,
 *  in whole milliseconds. Only the call's own minute and the 29 before it
 *  stay, and a minute's sum is clamped to 30,000,000. A new object: the
 *  memory passed in is not changed. */
export function recordCall(mem: UsageMemory, call: StepCall, at: number): UsageMemory {
  const stamp = Math.round(at)
  const minute = minuteOf(stamp)
  const burn = mem.burn.filter(b => b.minute > minute - BURN_BUCKETS && b.minute !== minute)
  const sum = (mem.burn.find(b => b.minute === minute)?.sum ?? 0) + call.fresh
  burn.push({ minute, sum: Math.min(MAX_SERIES, sum) })
  return {
    calls: mem.calls + 1,
    last: { at: stamp, tokens: call.tokens },
    window: call.window,
    model: call.model,
    context: [...mem.context, call.tokens].slice(-SERIES_CALLS),
    burn,
    cache: mem.cache || call.cache,
  }
}

/** The summary file's format version: the one the pane knows. Any change to
 *  `SUMMARY_KEYS`, to a range `checkSummary` holds or to the window set
 *  raises it, so an older pane reads a newer file as an unknown version and
 *  falls back cleanly, rather than as a broken file. */
export const SUMMARY_VERSION = 1

/** The summary file's keys, the one exact list: the format version; the
 *  meter record the pane stores for a card (its time, its window, its 30 burn
 *  buckets lined up to that time, oldest first, and up to 30 context sizes,
 *  oldest first); the last call's time and context tokens; and whether any
 *  counted call since the module loaded wrote or read cache, 1 or 0. `window`
 *  is the one optional key: it is left out when the fixed table has no row
 *  for the model, as the pane's own meter record leaves it out (q4 B on #311),
 *  so the reader passes the file's meter to `metersFrom` as it is. Every other
 *  key is always there. `at` is the end of the minute the write fell in, up
 *  to 60 s after it. */
export const SUMMARY_KEYS = ['version', 'at', 'window', 'model', 'burn', 'context', 'lastAt', 'lastTokens', 'cache'] as const

// The one key a summary may leave out.
// The keys a summary may leave out: `window`, and `model` (issue 598), the last call's model family word.
const OPTIONAL_KEYS: ReadonlySet<string> = new Set(['window', 'model'])

/** One summary file, as the writer builds it and the pane reads it. */
export type Summary = {
  version: number
  at: number
  window?: number
  model?: string
  burn: number[]
  context: number[]
  lastAt: number
  lastTokens: number
  cache: number
}

/** The summary of the memory at `now`, by the module's clock, or undefined
 *  when no call was counted since the module loaded: a turn end with none
 *  writes nothing. Its time is the end of the minute `now` falls in, so its
 *  30 burn buckets line up exactly with the minutes the memory keyed: bucket
 *  29 is that minute, bucket 0 the one 29 minutes before it. Built key by
 *  key from `SUMMARY_KEYS`, numbers only. */
export function summaryFrom(mem: UsageMemory, now: number): Summary | undefined {
  if (mem.calls === 0 || mem.last === undefined) return undefined
  const end = minuteOf(Math.round(now))
  const burn = Array.from({ length: BURN_BUCKETS }, (_, i) => mem.burn.find(b => b.minute === end - (BURN_BUCKETS - 1) + i)?.sum ?? 0)
  const values: Summary = {
    version: SUMMARY_VERSION,
    at: end * MIN_MS,
    window: mem.window,
    model: mem.model,
    burn,
    context: [...mem.context],
    lastAt: mem.last.at,
    lastTokens: mem.last.tokens,
    cache: mem.cache ? 1 : 0,
  }
  const out = {} as Record<string, unknown>
  for (const k of SUMMARY_KEYS) if (values[k] !== undefined) out[k] = values[k]
  return out as Summary
}

/** The cap on a summary file, in bytes: the writer saves no larger file and
 *  overwrites none, and the pane reads none. The worst case, every field at
 *  its top value (times at 8,640,000,000,000,000 ms, 60 values of
 *  30,000,000), measures 671 bytes; the cap leaves 353 bytes of headroom
 *  over it, about half again (ADR 0004). */
export const MAX_SUMMARY_BYTES = 1024

/** The refusal of a file whose format version is not `SUMMARY_VERSION`: a
 *  newer plugin's file, which the pane treats as no file. */
export const UNKNOWN_SUMMARY_VERSION = 'the summary file has a format version this plugin does not know'

// The latest time a file may hold, Date's own limit, in whole milliseconds.
const MAX_TIME = 8.64e15
const wholeIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max

/** A summary file's text, checked strictly: JSON, an object whose own keys
 *  are exactly `SUMMARY_KEYS`, with `window` the one that may be absent, the version `SUMMARY_VERSION` (any other
 *  version refuses with `UNKNOWN_SUMMARY_VERSION`), times in whole
 *  milliseconds from 0 to Date's limit with the last call no later than the
 *  record, the window, when there, 200,000 or 1,000,000, exactly 30 burn buckets and 1
 *  to 30 context sizes, each a whole number from 0 to 30,000,000, the last
 *  call's tokens from 1 to 30,000,000, and the cache flag 0 or 1. The series
 *  are held by the meter's own check, `seriesFrom`. The refusal names the
 *  rule in fixed words and never echoes the file's text. It reads the text
 *  alone, so it cannot hold the last call against the file's modified time or
 *  the pane's clock; the reader does (spec S4 on #304). Never throws. */
export function checkSummary(raw: string): { value: Summary } | { error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { error: 'the summary file is not JSON' }
  }
  if (!isRecord(parsed)) return { error: 'the summary file is not an object' }
  if (Object.hasOwn(parsed, 'version') && parsed.version !== SUMMARY_VERSION) return { error: UNKNOWN_SUMMARY_VERSION }
  const keys = Object.keys(parsed)
  const known: readonly string[] = SUMMARY_KEYS
  if (!keys.every(k => known.includes(k)) || !SUMMARY_KEYS.every(k => OPTIONAL_KEYS.has(k) || Object.hasOwn(parsed, k))) {
    return { error: 'the summary file does not hold exactly the summary keys' }
  }
  const p = parsed
  if (!wholeIn(p.at, 0, MAX_TIME) || !wholeIn(p.lastAt, 0, MAX_TIME) || p.lastAt > p.at) {
    return { error: 'a summary time is out of range' }
  }
  const hasWindow = Object.hasOwn(p, 'window')
  if (hasWindow && (typeof p.window !== 'number' || !WINDOW_SIZES.has(p.window))) return { error: 'the summary window is not one the table gives' }
  const hasModel = Object.hasOwn(p, 'model')
  if (hasModel && (typeof p.model !== 'string' || !MODEL_FAMILIES.includes(p.model))) return { error: 'the summary model is not a model family' }
  const burn = seriesFrom(p.burn, true)
  const context = seriesFrom(p.context, false)
  if (burn === undefined || context === undefined || context.length === 0) {
    return { error: 'a summary series is out of range' }
  }
  if (!wholeIn(p.lastTokens, 1, MAX_SERIES)) return { error: 'the summary\'s last call is out of range' }
  if (p.cache !== 0 && p.cache !== 1) return { error: 'the summary\'s cache flag is not 0 or 1' }
  return {
    value: {
      version: SUMMARY_VERSION,
      at: p.at,
      ...(hasWindow ? { window: p.window as number } : {}),
      ...(hasModel ? { model: p.model as string } : {}),
      burn,
      context,
      lastAt: p.lastAt,
      lastTokens: p.lastTokens,
      cache: p.cache,
    },
  }
}

/** A summary as the text the writer saves: refused unless that exact text
 *  passes `checkSummary` and fits the cap in UTF-8 bytes, so what is
 *  measured and checked is what is written. */
export function serializeSummary(s: Summary): { value: string } | { error: string } {
  const text = JSON.stringify(s)
  const bytes = new TextEncoder().encode(text).length
  if (bytes > MAX_SUMMARY_BYTES) return { error: `the summary is ${bytes} bytes, over the cap of ${MAX_SUMMARY_BYTES}` }
  const checked = checkSummary(text)
  return 'error' in checked ? checked : { value: text }
}

/** Whether a file already at the summary place may be overwritten: only when
 *  its stat size and its text are both within the cap and the text passes
 *  `checkSummary`. An empty object, a roster or any other JSON is refused,
 *  which stops a planted hard link to another file. `text` is undefined when
 *  the writer read nothing, as for a stat size over the cap. */
export function isSummaryFile(size: number, text: string | undefined): boolean {
  if (!(size <= MAX_SUMMARY_BYTES) || text === undefined) return false
  if (new TextEncoder().encode(text).length > MAX_SUMMARY_BYTES) return false
  return 'value' in checkSummary(text)
}

/** The throttle: while a turn runs, a write starts at most this often. */
export const WRITE_EVERY_MS = 15000

/** The writer's writes, as far as the throttle and single-flight decision
 *  reads them: one in flight, a turn-end write waiting behind it, and when
 *  the last write started, by the module's clock. */
export type Flight = { inFlight: boolean; queued: boolean; lastStart: number }

/** No write yet. */
export const newFlight = (): Flight => ({ inFlight: false, queued: false, lastStart: Number.NEGATIVE_INFINITY })

/** A request for a write at `now`: from a counted step (`turnEnd` false) or
 *  from a turn end. With a write in flight, a step's request is dropped and
 *  a turn end's waits for it. With none, a turn end starts one, and a step
 *  starts one when 15 s have passed since the last started, or the clock went
 *  back past it. `start` says whether to start a write now; the write takes
 *  its numbers when it starts, so a waiting turn end writes the newest. */
export function askWrite(f: Flight, now: number, turnEnd: boolean): { flight: Flight; start: boolean } {
  if (f.inFlight) return { flight: turnEnd ? { ...f, queued: true } : f, start: false }
  const due = turnEnd || now - f.lastStart >= WRITE_EVERY_MS || now < f.lastStart
  return due ? { flight: { inFlight: true, queued: false, lastStart: now }, start: true } : { flight: f, start: false }
}

/** The write in flight ended at `now`, however it ended: a turn end waiting
 *  behind it starts now. */
export function writeDone(f: Flight, now: number): { flight: Flight; start: boolean } {
  if (f.queued) return { flight: { inFlight: true, queued: false, lastStart: now }, start: true }
  return { flight: { ...f, inFlight: false }, start: false }
}
