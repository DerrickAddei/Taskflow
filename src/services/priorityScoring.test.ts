import { Assignment } from '@/models/Assignment';
import {
  sortByPriority,
  DEFAULT_PRIORITY_CONFIG,
  PriorityConfig,
} from './priorityScoring';

const NOW = new Date('2026-10-01T09:00:00');

function makeAssignment(overrides: Partial<Assignment>): Assignment {
  return {
    id: overrides.id ?? Math.random().toString(36),
    title: overrides.title ?? 'Untitled',
    dueDate: overrides.dueDate ?? '2026-10-05T23:59:00',
    estimatedMinutes: overrides.estimatedMinutes ?? 60,
    difficulty: overrides.difficulty ?? 3,
    completed: false,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

describe('priorityScoring', () => {
  test('due date dominates across different buckets, regardless of difficulty', () => {
    const dueSoonEasy = makeAssignment({
      id: 'a',
      dueDate: '2026-10-02T23:59:00', // 1 day out
      difficulty: 1,
      estimatedMinutes: 15,
    });
    const dueLaterHard = makeAssignment({
      id: 'b',
      dueDate: '2026-10-10T23:59:00', // 9 days out
      difficulty: 5,
      estimatedMinutes: 240,
    });
    const sorted = sortByPriority([dueLaterHard, dueSoonEasy], DEFAULT_PRIORITY_CONFIG, NOW);
    expect(sorted[0].id).toBe('a'); // near due date wins even though it's easy/short
  });

  test('within the same due-date bucket, harder/longer sorts first', () => {
    const sameDayEasy = makeAssignment({
      id: 'easy',
      dueDate: '2026-10-02T09:00:00',
      difficulty: 1,
      estimatedMinutes: 20,
    });
    const sameDayHard = makeAssignment({
      id: 'hard',
      dueDate: '2026-10-02T20:00:00', // still bucket 1 with default 1-day bucket width
      difficulty: 5,
      estimatedMinutes: 200,
    });
    const sorted = sortByPriority([sameDayEasy, sameDayHard], DEFAULT_PRIORITY_CONFIG, NOW);
    expect(sorted[0].id).toBe('hard');
  });

  test('overdue assignments sort before everything due today or later', () => {
    const overdue = makeAssignment({ id: 'overdue', dueDate: '2026-09-28T23:59:00' });
    const dueToday = makeAssignment({ id: 'today', dueDate: '2026-10-01T23:59:00' });
    const sorted = sortByPriority([dueToday, overdue], DEFAULT_PRIORITY_CONFIG, NOW);
    expect(sorted[0].id).toBe('overdue');
  });

  test('a wider urgencyBucketDays groups nearby due dates for difficulty reordering', () => {
    const dueTomorrowEasy = makeAssignment({
      id: 'tomorrow-easy',
      dueDate: '2026-10-02T23:59:00',
      difficulty: 1,
      estimatedMinutes: 15,
    });
    const dueIn3DaysHard = makeAssignment({
      id: 'plus3-hard',
      dueDate: '2026-10-04T23:59:00',
      difficulty: 5,
      estimatedMinutes: 240,
    });
    const wideConfig: PriorityConfig = { ...DEFAULT_PRIORITY_CONFIG, urgencyBucketDays: 4 };
    const sorted = sortByPriority([dueTomorrowEasy, dueIn3DaysHard], wideConfig, NOW);
    // With a 4-day bucket both fall in the same bucket, so difficulty breaks the tie.
    expect(sorted[0].id).toBe('plus3-hard');
  });
});
