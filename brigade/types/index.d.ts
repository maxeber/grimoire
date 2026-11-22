/** The status the head chef writes on a card, from a fixed set. */
export type Status = 'working' | 'idle' | 'done' | 'stopped'

/** One session the lead started, as its roster card says. */
export type Card = {
  title: string
  work: string
  settings: string
  status: Status
  /** A Desktop session's local id (local_...). */
  desktopId?: string
  /** A background session's id. */
  bgId?: string
  /** The session's https link on claude.ai, when the head chef knows it. */
  url?: string
  /** The session's PR number as text, 1 to 7 digits. */
  pr?: string
  /** The head chef's last-known state of that PR, used when `gh` has no answer. */
  prState?: PrState
  /** The PR's repository as owner/name, when it is not the lead's own
   *  working folder's; checked against `REPO` wherever it is read. */
  repo?: string
  /** When the card entered its current status, in milliseconds on
   *  the engine clock. The tool stamps it; the file may hold it. */
  since?: number
}

/** A PR's state, as the card keeps it and as `gh`'s answer is read. */
export type PrState = 'open' | 'draft' | 'merged' | 'closed'

/** Something waiting on the owner that no card already shows. */
export type Todo = { id: string; text: string; session?: string; link?: string }

/** A lead session's roster file, after its shape check. */
export type Roster = { cards: Card[]; todos: Todo[] }

/** A report from another session: its claimed sender and first line. */
export type Report = { from: string; line: string; at: string }

/** A pair from a lookup, kept as a list so no key reaches a prototype. */
export type Pair = { name: string; value: string }

/** Where the roster file is, and the one before a clear or a resume. */
export type Files = { current: string; previous: string }

/** What the engine said at session start: the id and its transcript path. */
export type Start = { sessionId: string; transcript: string }

/** One rate-limit window: its kind, how much of it is used, when it resets. */
export type UsageLimit = { kind: string; percent: number; resetsAt?: string }

/** One row of the context breakdown: its name, what it is, its tokens. */
export type UsageCategory = { name: string; kind: string; tokens: number }

/** This session's usage as the pane last read it: only the fields it draws.
 *  `categories` is absent when no breakdown was asked for. */
export type UsageSnapshot = {
  limits: UsageLimit[]
  context: { percent?: number; tokens?: number; window?: number }
  categories?: UsageCategory[]
}

/** One reading of this session's own session limit (`five_hour`): when it
 *  was taken, in epoch ms, and the percent used. */
export type Sample = { at: number; percent: number }

/** One card's cache warmth, from its session's summary file or its
 *  transcript: the last real model call's time, its context tokens and its
 *  cache window (from a transcript, absent when no call that wrote cache says
 *  it; from a summary file, a fixed hour, absent when no call wrote or read
 *  cache); or unknown, because the transcript is too
 *  large to read or two sessions share the card's name; or not read yet,
 *  because the session has been working since the pane first saw it; or not
 *  found, because no transcript passed the finder's checks. No path is kept. */
export type Warmth =
  | { name: string; kind: 'call'; at: number; tokens: number; windowMs?: number }
  | { name: string; kind: 'too-large' | 'shared' | 'unread' | 'not-found' }

/** One card's call series, from its session's summary file or its
 *  transcript: the time its burn buckets end, the end of the clock minute
 *  of the read or the write that gave it; the context window of its model's
 *  family, in tokens, from a fixed table (absent when the table has none);
 *  the new tokens of each of the 30 clock minutes up to that time, oldest
 *  first; and the context size of each of the last 30 calls, oldest first. Numbers only: no path, model or message
 *  id is kept. */
export type Meter = { name: string; at: number; window?: number; burn?: number[]; context?: number[] }

declare module 'claude-code' {
  interface PluginState {
    grimoire: {
      /** True while the pane is open. Nothing in the mod gates on it: the
       *  hooks read the open pane from the module's own timers. */
      armed: boolean
      start: Start
      files: Files
      roster: Roster
      rosterError: string
      live: { name: string; value: string; shown?: string; move?: 'waiting' }[]
      liveError: string
      links: Pair[]
      reports: Report[]
      dismissed: string[]
      doneTodos: string[]
      /** Ticked to-dos still inside their grace period: the to-do's id and
       *  the tick's time in epoch ms, as text. A second press removes one;
       *  the roster timer's sweep moves a due one to `doneTodos`. */
      ticking: Pair[]
      /** This session's last usage reading, read while the pane is open. */
      usage: UsageSnapshot
      /** This session's own session-limit percent, sampled from the usage
       *  readings while the pane is open, for its projection: at most one
       *  every 30 s, at most 120. Checked again before use. */
      samples: Sample[]
      /** Each roster member's cache warmth, from the agents poll while the
       *  pane is open. Checked again before it is drawn. */
      warmth: Warmth[]
      /** Each roster member's call series, from the same reads as its
       *  warmth. Checked again before it is drawn. */
      meters: Meter[]
      /** Each roster member whose summary file the agents poll refused: its
       *  name and a kind word, `path` (the path rule refused it) or `file`
       *  (the same file failed its checks two polls running). Read only
       *  through those two words. */
      refusals: Pair[]
      /** Each roster member's model family from its own summary file: its name and one word
       *  from the fixed list (opus, sonnet, haiku, fable). Read again through that list. */
      models: Pair[]
      /** Each card's chosen tab: its title and a view word, `cache`, `burn`
       *  or `trend`, kept for the session and not reset when the pane opens.
       *  Read only through the fixed set of view words. */
      tabs: Pair[]
      /** The chosen view, `sessions`, `prs` or `decisions`: set to `sessions`
       *  each time /brigade or a skill load that opens the pane does. Read only through the fixed set. */
      view: string
      /** The Decisions tab's search text, cleared each time the pane opens.
       *  Read only through its 200-character cap. */
      query: string
      /** A counter the decision reads move so the pane redraws. It carries
       *  no decision, mark or session id: those stay in module memory. */
      decisionsSeen: number
      /** The autonomy level a slider press set, keyed by this session's
       *  checked id and holding only its own. Read only through
       *  storedLevel: anything but the number 1, 2 or 3 reads as 1, and a
       *  value that differs from the last press this module saw raises an
       *  alarm and reads as 1. */
      autonomy: { session: string; level: number }[]
      /** The selected cards' titles, at most 50. Cleared when /brigade or a skill load
       *  opens the pane. Checked again before use. */
      picked: string[]
      /** The folded groups, from the fixed set of group keys: set to the
       *  finished group and the Decisions tab's Flagged, History and Lead
       *  hand-off each time the pane opens, and flipped by a press.
       *  Checked again before use. */
      folded: string[]
      /** The open popover (issue 513): `menu-<place>` or `set-<place>`, else
       *  an empty string. Read again through a fixed pattern before use; any
       *  other value draws nothing. */
      popover: string
      /** The permission warning is shown in this session: set by its tool. */
      warningShown: boolean
      /** "I understand" hid the permission warning for this session. */
      warningHidden: boolean
      /** The warning's "Don't show again" box is ticked, for this session. */
      warningTicked: boolean
      /** The owner's "Don't show again", as the store holds it: when, and the
       *  version of the wording. Checked again before use. */
      warningAck: { at: string; version: string } | null
      /** The Incantation mic band's last reading of the listener's levels
       *  file: the file's stamp, a state word and 24 digits, 0 to 8. Numbers
       *  only. Checked again by the file's own pattern before it is drawn;
       *  null when no listener is writing. */
      micFrame: { stamp: number; word: string; digits: string } | null
      /** The colour change of the state word: the word before, the word now
       *  and the step of the change, 0 to 4. Read through the fixed word list. */
      micEase: { from: string; to: string; step: number }
      /** The 24 digits of the reading before micFrame's, or '' with none: the
       *  desktop picture draws the move from one to the other. Numbers only. */
      micPrev: string
      /** Whether the listener's voice is muted, as run/voice says (`muted`
       *  or `on`): a flag. A missing or unreadable file is a voice that is on. */
      micVoiceMuted: boolean    }
  }
}
