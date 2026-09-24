/**
 * Core data model for the Assignment Tracker app.
 *
 * Field notes (per spec):
 *  - title, dueDate, estimatedMinutes, difficulty are REQUIRED.
 *  - subject and notes are optional/secondary — Tier 3 in the priority
 *    system, informational only, never affect sort order.
 */

export type Difficulty = 1 | 2 | 3 | 4 | 5;

export interface Assignment {
  /** UUID, generated locally on creation (see storage/database.ts). */
  id: string;

  /** Required. */
  title: string;

  /** Required. ISO 8601 string, e.g. "2026-10-02T23:59:00". Stored in local time. */
  dueDate: string;

  /** Required. Estimated time to complete, in minutes (easier to bucket/sum than hours). */
  estimatedMinutes: number;

  /** Required. 1 = trivial, 5 = hardest. */
  difficulty: Difficulty;

  /** Optional / secondary — Tier 3, display-only. */
  subject?: string;
  notes?: string;

  /** Bookkeeping. */
  completed: boolean;
  createdAt: string;
  updatedAt: string;

  /**
   * Set once this assignment has a corresponding Google Calendar event,
   * so future syncs UPDATE the existing event instead of creating a duplicate.
   * See googleCalendarSync.ts.
   */
  googleCalendarEventId?: string;
}

/** Shape used when creating a new assignment, before id/timestamps are assigned. */
export type NewAssignmentInput = Omit<
  Assignment,
  'id' | 'completed' | 'createdAt' | 'updatedAt' | 'googleCalendarEventId'
>;

export function isValidDifficulty(value: number): value is Difficulty {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

/** Basic validation used by the storage layer before persisting. Extend as needed. */
export function validateNewAssignment(input: NewAssignmentInput): string[] {
  const errors: string[] = [];
  if (!input.title || !input.title.trim()) errors.push('Title is required.');
  if (!input.dueDate || Number.isNaN(new Date(input.dueDate).getTime())) {
    errors.push('A valid due date is required.');
  }
  if (!input.estimatedMinutes || input.estimatedMinutes <= 0) {
    errors.push('Estimated time (minutes) is required and must be > 0.');
  }
  if (!isValidDifficulty(input.difficulty)) {
    errors.push('Difficulty is required and must be an integer 1–5.');
  }
  return errors;
}
