// The Incantation mic band: what its levels file says, and how the band draws
// it. Pure text and numbers, so the plain tests can drive every line of it.
//
// The listener (skills/incantation) writes ~/.grimoire/incantation/run/levels:
// one line, `<epoch ms> <state word> <24 digits>`. The digits are the mic's
// loudness, 0 to 8, one per quarter second: no audio and no text. The band
// reads that line and run/voice (`muted` or `on`), and a click on a button
// writes one of four words, `mute`, `unmute`, `mute-voice` or `unmute-voice`,
// to run/command, which the listener reads once and removes. The band holds no
// path of the plugin and runs no process: it only reads and writes those
// files in the person's own folder.

export type MicWord = 'listening' | 'hearing' | 'thinking' | 'working' | 'speaking' | 'muted'
export type MicFrame = { stamp: number; word: MicWord; digits: string }

export const WORDS: readonly MicWord[] = ['listening', 'hearing', 'thinking', 'working', 'speaking', 'muted']
export const BARS = 24
const LINE = /^(\d{1,16}) (listening|hearing|thinking|working|speaking|muted) ([0-8]{24})\r?\n?$/

/** A reading older than this is no reading: the listener has gone. */
export const FRESH_MS = 10_000
/** The band polls this often while a listener is writing, and this often
 *  again at a slow beat while none is. */
export const TICK_MS = 250
export const SLOW_EVERY = 8
/** The colour of a new state takes this many steps, this far apart. */
export const EASE_STEPS = 4
export const EASE_MS = 75

/** The file's text as a frame, or null: any other shape, or a stamp more than
 *  FRESH_MS from `now` either way. */
export function parseLevels(text: unknown, now: number): MicFrame | null {
  if (typeof text !== 'string' || text.length > 80) return null
  const m = LINE.exec(text)
  if (m === null) return null
  const stamp = Number(m[1])
  if (!Number.isFinite(now) || Math.abs(now - stamp) > FRESH_MS) return null
  return { stamp, word: m[2] as MicWord, digits: m[3] }
}

const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█', '█']
/** One block per digit, lightly smoothed with its neighbours so the row moves
 *  as a wave and not as steps; a muted mic is a flat line of dots. */
export function bars(digits: string, word: MicWord): string {
  if (word === 'muted') return '·'.repeat(BARS)
  const d = [...digits].map(c => Number(c))
  return d
    .map((v, i) => {
      const a = d[i - 1] ?? v
      const b = d[i + 1] ?? v
      return BLOCKS[Math.min(8, Math.max(0, Math.round((a + 2 * v + b) / 4)))]
    })
    .join('')
}

export const HUES: Record<MicWord, string> = {
  listening: '#6f9bd1',
  hearing: '#7ec27e',
  thinking: '#d9b25b',
  working: '#e09a5b',
  speaking: '#b490e0',
  muted: '#8a8f9c',
}

const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
/** The colour k of the way from one hex colour to another, k from 0 to 1. */
export function mix(a: string, b: string, k: number): string {
  const t = Math.min(1, Math.max(0, k))
  return `#${[0, 1, 2].map(i => Math.round(channel(a, i) + (channel(b, i) - channel(a, i)) * t).toString(16).padStart(2, '0')).join('')}`
}

/** The word's colour at a step of the change from the word before it. */
export const colorAt = (from: MicWord, to: MicWord, step: number): string => mix(HUES[from], HUES[to], step / EASE_STEPS)

export const labelOf = (word: MicWord): string => `mic: ${word}`
/** What the button says, and the one word a click writes. */
export const toggleFor = (word: MicWord): { label: string; command: 'mute' | 'unmute' } =>
  word === 'muted' ? { label: 'Unmute mic', command: 'unmute' } : { label: 'Mute mic', command: 'mute' }
/** The second button: the listener's own voice, apart from the mic. */
export const voiceToggleFor = (muted: boolean): { label: string; command: 'mute-voice' | 'unmute-voice' } =>
  muted ? { label: 'Unmute voice', command: 'unmute-voice' } : { label: 'Mute voice', command: 'mute-voice' }

const sepOf = (dir: string): string => (dir.includes('\\') ? '\\' : '/')
const runFile = (home: string, name: string): string => {
  const s = sepOf(home)
  return [home.replace(/[\\/]+$/, ''), '.grimoire', 'incantation', 'run', name].join(s)
}
export const levelsFile = (home: string): string => runFile(home, 'levels')
export const commandFile = (home: string): string => runFile(home, 'command')
/** `muted` or `on`: whether the listener's voice is muted, written by the listener. */
export const voiceFile = (home: string): string => runFile(home, 'voice')

/** The person's home folder from the engine's environment: an absolute path
 *  of sane length, else undefined. */
export function homeFrom(profile: unknown, home: unknown): string | undefined {
  for (const v of [profile, home]) {
    if (typeof v !== 'string' || v.length === 0 || v.length > 260 || /[\0\r\n]/.test(v)) continue
    if (/^[A-Za-z]:[\\/]/.test(v) || v.startsWith('/')) return v
  }
  return undefined
}

const UP = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█', '█']
const DOWN = ['▔', '▔', '▀', '▀', '▀', '█', '█', '█', '█']
/** The terminal's wave: two mirrored rows of blocks meeting at a centre line,
 *  the 24 readings stretched with a cosine blend to `cols` columns, so the rows
 *  are as wide as the terminal (8 to 2000). A muted mic is a flat line. */
export function fullWidth(digits: string, word: MicWord, cols: number): [string, string] {
  const n = Math.max(8, Math.min(2000, Math.trunc(cols) || 80))
  if (word === 'muted') return ['▁'.repeat(n), '▔'.repeat(n)]
  const d = [...digits].map(c => Number(c) || 0)
  const m = d.length || 1
  const s = Array.from({ length: n }, (_, i) => {
    const x = (i / (n - 1)) * (m - 1)
    const a = d[Math.floor(x)] ?? 0
    const b = d[Math.min(m - 1, Math.floor(x) + 1)] ?? 0
    const v = a + (b - a) * ((1 - Math.cos(Math.PI * (x - Math.floor(x)))) / 2)
    return Math.min(8, Math.max(0, Math.round(v)))
  })
  return [s.map(v => UP[v]).join(''), s.map(v => DOWN[v]).join('')]
}

/** The newest reading's moment as the mod keeps it. The listener's stamp is
 *  when it wrote the file, which can be a reading early or late, and that slid
 *  the whole loudness outline by a reading against the wave. Instead, match the
 *  new readings against the last ones to see how many places they moved, and
 *  advance by exactly that many readings (the stamp's expected shift weighs the
 *  match). The stamp only resets the count when it drifts by more than two
 *  readings. Returns the new line; its `t` is the moment. */
export type Line = { t: number; stamp: number; digits: string }
export function advanceLine(line: Line, stamp: number, digits: string, ms: number): Line {
  if (line.t < 0 || line.digits.length !== digits.length) return { t: stamp, stamp, digits }
  const n = digits.length
  const expected = (stamp - line.stamp) / ms
  let best = 0
  let bestScore = Infinity
  for (let k = 0; k <= Math.min(8, n - 4); k++) {
    let miss = 0
    for (let i = 0; i < n - k; i++) if (digits[i] !== line.digits[i + k]) miss++
    const score = miss / (n - k) + 0.15 * Math.abs(k - expected)
    if (score < bestScore) {
      bestScore = score
      best = k
    }
  }
  let t = line.t + best * ms
  if (Math.abs(t - stamp) > 2 * ms) t = stamp
  return { t, stamp, digits }
}
