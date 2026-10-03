/**
 * A recurring "do not disturb" window — a chunk of the week the scheduler
 * should never place an assignment block into. Phase 2, data layer only:
 * nothing reads these yet to actually affect scheduling.
 */

export interface TimeBlock {
  id: string;
  /** 0 = Sunday ... 6 = Saturday. null = applies every day of the week. */
  dayOfWeek: number | null;
  /** Minutes since midnight, 0–1439. */
  startMinute: number;
  /** Minutes since midnight, 1–1440. Must be greater than startMinute. */
  endMinute: number;
  /** Optional label, e.g. "Church", "Sleep". */
  label?: string;
  createdAt: string;
  updatedAt: string;
}

export type NewTimeBlockInput = Omit<TimeBlock, 'id' | 'createdAt' | 'updatedAt'>;

export function validateNewTimeBlock(input: NewTimeBlockInput): string[] {
  const errors: string[] = [];
  if (
    input.dayOfWeek !== null &&
    (input.dayOfWeek < 0 || input.dayOfWeek > 6 || !Number.isInteger(input.dayOfWeek))
  ) {
    errors.push('Day of week must be 0–6 (Sunday–Saturday), or null for every day.');
  }
  if (!Number.isInteger(input.startMinute) || input.startMinute < 0 || input.startMinute > 1439) {
    errors.push('Start time must be a whole number of minutes between 0 and 1439.');
  }
  if (!Number.isInteger(input.endMinute) || input.endMinute < 1 || input.endMinute > 1440) {
    errors.push('End time must be a whole number of minutes between 1 and 1440.');
  }
  if (input.startMinute >= input.endMinute) {
    errors.push('End time must be after start time.');
  }
  return errors;
}