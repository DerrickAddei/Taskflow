/**
 * DAILY DIGEST NOTIFICATION
 * ==========================
 *
 * A single local push notification around 1:00 PM summarizing that
 * day's remaining (incomplete, due-today) assignments. Deliberately
 * scoped to "today" only for now (see DigestScope) but structured so
 * a future "week" scope is a small addition, not a rewrite.
 *
 * IMPORTANT — iOS LOCAL NOTIFICATION CONTENT CAVEAT
 * ----------------------------------------------------
 * expo-notifications schedules LOCAL notifications: the title/body text
 * is fixed at the moment you call scheduleNotificationAsync, not
 * recomputed live at delivery time. A naive "repeats daily at 13:00"
 * trigger would therefore show the SAME stale task list every day.
 *
 * This module works around that with `refreshDailyDigest()`, which:
 *   1. Cancels any existing scheduled digest.
 *   2. Recomputes today's task list right now.
 *   3. (Rare case) If it's already past 1pm and the digest hasn't fired
 *      today, no-ops (avoids sending a stale/late alert).
 *   4. Otherwise, schedules a ONE-SHOT notification for today's 1pm
 *      with fresh content, plus registers a background task
 *      (expo-task-manager + expo-background-fetch) to call this
 *      function again periodically, so the content stays reasonably
 *      fresh even if the app isn't opened.
 *
 * iOS background fetch is OPPORTUNISTIC — the OS decides when to run
 * it based on usage patterns, and it is NOT guaranteed to fire before
 * 1pm every single day. The reliable fix, if this ever matters more
 * than "good enough," is a small server that sends a real PUSH
 * notification (via the Expo Push API or APNs directly) on a fixed
 * schedule, since remote pushes are delivered by Apple's servers, not
 * dependent on the app waking up locally. That's a bigger lift (needs
 * a always-on scheduler + push token registration) and was intentionally
 * left out of this MVP — call it out if daily reliability becomes a
 * problem in practice.
 *
 * The simplest full mitigation with zero backend: call
 * `refreshDailyDigest()` every time the app is foregrounded (see
 * App.tsx), which covers the common case of opening the app at some
 * point in the morning.
 */

import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import { Assignment } from '@/models/Assignment';

export type DigestScope = 'today'; // future: 'today' | 'week'

const DIGEST_NOTIFICATION_ID = 'daily-digest';
const BACKGROUND_TASK_NAME = 'assignment-tracker-digest-refresh';
const DIGEST_HOUR = 13; // 1:00 PM
const DIGEST_MINUTE = 0;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function requestNotificationPermissions(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Filters assignments relevant to a given digest scope. Isolated on
 * purpose: adding `case 'week':` here (return assignments due within
 * the next 7 days, still !completed) is the entire change needed to
 * support a week-scope digest later — nothing else in this file, or
 * in the scheduling/caller code, needs to know about scope internals.
 */
export function filterAssignmentsForScope(
  assignments: Assignment[],
  scope: DigestScope,
  now: Date = new Date()
): Assignment[] {
  switch (scope) {
    case 'today':
      return assignments.filter(
        (a) => !a.completed && isSameLocalDay(new Date(a.dueDate), now)
      );
    default: {
      const _exhaustive: never = scope;
      throw new Error(`Unsupported digest scope: ${_exhaustive}`);
    }
  }
}

export function buildDigestContent(
  assignments: Assignment[],
  scope: DigestScope,
  now: Date = new Date()
): { title: string; body: string } | null {
  const relevant = filterAssignmentsForScope(assignments, scope, now);
  if (relevant.length === 0) return null; // nothing due today -> skip the notification entirely

  const title =
    scope === 'today'
      ? `${relevant.length} assignment${relevant.length === 1 ? '' : 's'} due today`
      : 'Assignment digest';
  const body = relevant.map((a) => `• ${a.title}`).join('\n');
  return { title, body };
}

/**
 * Recomputes and (re)schedules today's 1pm digest based on the CURRENT
 * assignment list. Call this on app foreground, after any assignment
 * create/edit/complete, and from the background task below.
 *
 * `getAssignments` is injected (rather than importing storage directly)
 * to keep this module testable without a real SQLite database.
 */
export async function refreshDailyDigest(
  getAssignments: () => Promise<Assignment[]> | Assignment[],
  scope: DigestScope = 'today',
  now: Date = new Date()
): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(DIGEST_NOTIFICATION_ID).catch(() => {});

  const todayAt1pm = new Date(now);
  todayAt1pm.setHours(DIGEST_HOUR, DIGEST_MINUTE, 0, 0);
  if (now >= todayAt1pm) {
    // Already past 1pm — don't fire a late/stale notification today.
    // Tomorrow's refresh (background task or next app open) will
    // schedule the next one.
    return;
  }

  const assignments = await getAssignments();
  const content = buildDigestContent(assignments, scope, now);
  if (!content) return; // nothing due today: skip, don't send an empty digest

  await Notifications.scheduleNotificationAsync({
    identifier: DIGEST_NOTIFICATION_ID,
    content: { title: content.title, body: content.body },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: todayAt1pm,
    },
  });
}

/**
 * Best-effort background refresh so the digest content stays reasonably
 * fresh even when the app isn't opened before 1pm. See the reliability
 * caveat in the module doc comment above — this is opportunistic, not
 * guaranteed.
 */
export function registerBackgroundDigestRefresh(
  getAssignments: () => Promise<Assignment[]> | Assignment[]
): void {
  if (!TaskManager.isTaskDefined(BACKGROUND_TASK_NAME)) {
    TaskManager.defineTask(BACKGROUND_TASK_NAME, async () => {
      try {
        await refreshDailyDigest(getAssignments);
        return BackgroundFetch.BackgroundFetchResult.NewData;
      } catch (e) {
        console.warn('Background digest refresh failed', e);
        return BackgroundFetch.BackgroundFetchResult.Failed;
      }
    });
  }
  BackgroundFetch.registerTaskAsync(BACKGROUND_TASK_NAME, {
    minimumInterval: 60 * 60, // ask iOS for hourly-ish opportunities; iOS decides actual cadence
    stopOnTerminate: false,
    startOnBoot: true,
  }).catch((e) => console.warn('Could not register background fetch task', e));
}
