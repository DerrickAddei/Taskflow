/**
 * TIERED PRIORITY SCORING
 * ========================
 *
 * Design goal: due date urgency is the DOMINANT, near-absolute sort key
 * (Tier 1). Difficulty and estimated time are SECONDARY NUDGE factors
 * (Tier 2) that only reorder assignments whose due dates are close to
 * each other — they never let a low-urgency task jump ahead of a
 * high-urgency one. Subject/notes (Tier 3) never affect order at all.
 *
 * This is a genuinely TIERED (lexicographic) system, not a flat weighted
 * average. A flat weighted average (e.g. score = 0.7*urgency + 0.3*difficulty)
 * would let a very hard, long, but distant assignment outrank something
 * due tomorrow — which is explicitly NOT what was asked for.
 *
 * -----------------------------------------------------------------------
 * HOW IT WORKS
 * -----------------------------------------------------------------------
 * 1. Tier 1 — Urgency bucket:
 *    Each assignment is placed into an integer "bucket" based on how many
 *    days away its due date is, using `urgencyBucketDays` as the bucket
 *    width (default 1 day = each calendar day is its own bucket).
 *    Overdue assignments get NEGATIVE buckets (more overdue = more
 *    negative = sorts first), so overdue work always leads.
 *
 * 2. Tier 2 — Secondary score (only used to break ties WITHIN a bucket):
 *    secondaryScore = normalizedDifficulty * difficultyWeight
 *                    + normalizedEstimatedTime * estimatedTimeWeight
 *    Both normalized components are in [0, 1]; higher = harder/longer =
 *    ranked earlier within the bucket.
 *
 * 3. Tier 3 — subject/notes are never read by this module. They're
 *    display-only fields on the Assignment type.
 *
 * The canonical ordering function is `comparePriority` / `sortByPriority`,
 * which compares bucket first and ONLY falls back to secondaryScore on an
 * exact bucket tie. This avoids floating point edge cases entirely.
 *
 * `computeDisplayPriorityScore` additionally collapses this into a single
 * sortable number (bucket minus a sub-1 fraction of the secondary score)
 * for convenience — e.g. showing "Priority: 2.35" in a UI, or as a rough
 * ordering key when talking to the Google Calendar sync module. It is
 * mathematically consistent with `comparePriority` but is NOT the
 * authoritative comparator; always sort with `sortByPriority` in code.
 *
 * -----------------------------------------------------------------------
 * TRADEOFFS / TUNING KNOBS
 * -----------------------------------------------------------------------
 * - `urgencyBucketDays` (default 1): the width of a Tier-1 bucket.
 *     - Smaller (e.g. 1 day, the default): due date is nearly absolute —
 *       difficulty/time only break ties between assignments due on the
 *       SAME day. Safest interpretation of "due date is dominant."
 *     - Larger (e.g. 2–3 days): assignments due within that window get
 *       grouped together and reordered by difficulty/time. This is more
 *       aggressive — it can push a harder task due in 3 days ahead of an
 *       easier task due in 2 days. Better for "high-load week" batching,
 *       but starts to erode strict due-date dominance. Tune per feel;
 *       this is intentionally exposed as a config value rather than
 *       hardcoded so it's easy to Copilot-iterate on.
 * - `difficultyWeight` / `estimatedTimeWeight` (default 0.5 / 0.5):
 *     Relative influence of "hardness" vs. "length" within a bucket.
 *     Must sum to 1 for `computeDisplayPriorityScore`'s bucket-safety
 *     guarantee to hold as documented; `comparePriority` itself doesn't
 *     require that (it only needs the relative order of secondaryScore).
 * - `maxEstimatedMinutesForNormalization` (default 240 = 4 hours):
 *     Caps estimated-time normalization so one outlier (e.g. a 20-hour
 *     term paper) doesn't make every other assignment's time component
 *     round to ~0. Anything at/above the cap normalizes to 1.0. Consider
 *     a log-scale normalization instead if your assignments vary wildly
 *     in size (e.g. 15-minute readings alongside multi-week projects).
 * - Overdue handling: currently overdue items are bucketed by how
 *   overdue they are (more overdue = earlier), then still broken by
 *   difficulty/time within that. An alternative is to dump ALL overdue
 *   items into a single "bucket -1" so a 1-day-late easy task and a
 *   10-day-late easy task are treated as equally urgent and only
 *   separated by difficulty. Swap in `Math.min(daysUntilDue, 0) === 0
 *   ? ... : -1` in `urgencyBucket` if you prefer that behavior.
 * - Recompute cadence: `daysUntilDue` changes as calendar days pass, so
 *   the whole list's ordering should be recomputed at least once per day
 *   (e.g. on app foreground, and in the daily digest job) — it is cheap
 *   (O(n log n) sort) so there's no reason to cache it across days.
 */

import { Assignment } from '@/models/Assignment';

export interface PriorityConfig {
  /** Width, in days, of a single Tier-1 urgency bucket. Default 1. */
  urgencyBucketDays: number;
  /** Tier-2 weight for difficulty, 0–1. Should sum to 1 with estimatedTimeWeight. */
  difficultyWeight: number;
  /** Tier-2 weight for estimated time, 0–1. Should sum to 1 with difficultyWeight. */
  estimatedTimeWeight: number;
  /** Cap, in minutes, used to normalize estimated time into [0, 1]. */
  maxEstimatedMinutesForNormalization: number;
}

export const DEFAULT_PRIORITY_CONFIG: PriorityConfig = {
  urgencyBucketDays: 1,
  difficultyWeight: 0.5,
  estimatedTimeWeight: 0.5,
  maxEstimatedMinutesForNormalization: 240,
};

/** Whole days between `now` and the assignment's due date. Negative = overdue. */
export function daysUntilDue(dueDate: string, now: Date = new Date()): number {
  const due = new Date(dueDate);
  const msPerDay = 1000 * 60 * 60 * 24;
  // Ceiling so "due in 30 minutes" and "due in 23 hours" both count as
  // "due today" (0) rather than one rounding down to overdue.
  return Math.ceil((due.getTime() - now.getTime()) / msPerDay);
}

/** Tier 1: integer urgency bucket. Lower = more urgent = sorts first. */
export function urgencyBucket(
  assignment: Assignment,
  config: PriorityConfig = DEFAULT_PRIORITY_CONFIG,
  now: Date = new Date()
): number {
  const days = daysUntilDue(assignment.dueDate, now);
  if (days < 0) {
    // Overdue: more overdue -> more negative -> sorts even earlier.
    return days;
  }
  return Math.floor(days / Math.max(config.urgencyBucketDays, 1));
}

/** Tier 2: secondary "how taxing is this" score in [0, 1]. Higher = more taxing. */
export function secondaryScore(
  assignment: Assignment,
  config: PriorityConfig = DEFAULT_PRIORITY_CONFIG
): number {
  const normalizedDifficulty = (assignment.difficulty - 1) / 4; // 1..5 -> 0..1
  const cappedMinutes = Math.min(
    assignment.estimatedMinutes,
    config.maxEstimatedMinutesForNormalization
  );
  const normalizedTime = cappedMinutes / config.maxEstimatedMinutesForNormalization; // 0..1
  return (
    normalizedDifficulty * config.difficultyWeight +
    normalizedTime * config.estimatedTimeWeight
  );
}

/**
 * Canonical comparator: bucket first (ascending), secondaryScore as
 * tie-breaker (descending — harder/longer first) ONLY within a bucket.
 * Use with Array.prototype.sort, or via `sortByPriority` below.
 */
export function comparePriority(
  a: Assignment,
  b: Assignment,
  config: PriorityConfig = DEFAULT_PRIORITY_CONFIG,
  now: Date = new Date()
): number {
  const bucketA = urgencyBucket(a, config, now);
  const bucketB = urgencyBucket(b, config, now);
  if (bucketA !== bucketB) return bucketA - bucketB;
  return secondaryScore(b, config) - secondaryScore(a, config);
}

/** Returns a NEW array sorted most-urgent/most-taxing first. Does not mutate input. */
export function sortByPriority(
  assignments: Assignment[],
  config: PriorityConfig = DEFAULT_PRIORITY_CONFIG,
  now: Date = new Date()
): Assignment[] {
  return [...assignments].sort((a, b) => comparePriority(a, b, config, now));
}

/**
 * Single-number convenience score for display or as a rough sort key
 * outside this module (e.g. logging). Bucket is the integer part;
 * secondaryScore is folded in as a sub-1 fraction so it can never push
 * an item across a bucket boundary. NOT the authoritative comparator —
 * use `sortByPriority` for actual ordering.
 */
export function computeDisplayPriorityScore(
  assignment: Assignment,
  config: PriorityConfig = DEFAULT_PRIORITY_CONFIG,
  now: Date = new Date()
): number {
  const bucket = urgencyBucket(assignment, config, now);
  const secondary = secondaryScore(assignment, config); // 0..1
  // Multiply by 0.999 (not 1.0) so a perfect secondaryScore of 1 can
  // never round into the next bucket down due to float rounding.
  return bucket - secondary * 0.999;
}
