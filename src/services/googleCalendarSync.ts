/**
 * GOOGLE CALENDAR SYNC
 * =====================
 *
 * Turns a prioritized assignment list into time-blocked events on the
 * user's primary Google Calendar. Because this writes to the real
 * Google Calendar (via the Calendar API), the blocks show up wherever
 * that Google account's calendar is viewed — the Google Calendar iOS
 * app, or the built-in iOS Calendar app IF the Google account has also
 * been added there as a mail/calendar account. This module doesn't care
 * which client the user reads it in; it only talks to Google's API.
 *
 * AUTH
 * ----
 * OAuth 2.0 / PKCE via `expo-auth-session`. The actual sign-in UI (the
 * `useAuthRequest` hook + browser popup) has to live in a React
 * component, since it needs to drive a screen — see the
 * `useGoogleAuth` hook below, used from a screen like
 * AssignmentListScreen.tsx. Everything else in this file is plain
 * functions that take an already-valid access token, so they're easy
 * to unit test and reuse outside of any particular screen.
 *
 * Required scope: https://www.googleapis.com/auth/calendar.events
 * (write access to events, without full account-wide calendar scope).
 *
 * IDEMPOTENT SYNC
 * ----------------
 * Every event this module creates is tagged with
 * extendedProperties.private.assignmentTrackerId = assignment.id.
 * On each sync we store the resulting Google event id back onto the
 * assignment (`googleCalendarEventId`), so a later sync PATCHes the
 * existing event instead of creating a duplicate.
 *
 * SCHEDULING ALGORITHM (MVP — greedy, single calendar's freebusy)
 * -----------------------------------------------------------------
 * Given the priority-sorted assignment list:
 *   1. Fetch busy intervals for the sync window via calendar
 *      `freebusy.query` (this already accounts for existing events,
 *      including manually-added ones).
 *   2. Walk the assignments in priority order. For each one, find the
 *      next open slot of >= estimatedMinutes within configured working
 *      hours (default 9am–9pm), skipping busy intervals and skipping
 *      the assignment's own due date/time (don't schedule work AFTER
 *      it's due).
 *   3. Mark that slot as busy in our in-memory copy (so the next
 *      assignment doesn't get double-booked into the same slot) and
 *      create/patch the calendar event.
 *
 * This is intentionally simple — it does not do multi-day lookahead
 * tuning, doesn't split a long task across multiple days if it doesn't
 * fit in one day's remaining working hours (it just rolls the whole
 * block to the next working day), and doesn't factor in the user's
 * OTHER commitments beyond "busy/free." All good candidates for
 * Copilot-assisted iteration — the seams (`findNextAvailableSlot`,
 * `WORKING_HOURS`) are deliberately small, isolated functions.
 */

import * as AuthSession from 'expo-auth-session';
import Constants from 'expo-constants';
import { Assignment } from '@/models/Assignment';

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
const DISCOVERY = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

/**
 * React hook wrapping expo-auth-session for Google sign-in.
 * Usage in a screen:
 *   const { accessToken, promptAsync, request } = useGoogleAuth();
 *   <Button disabled={!request} title="Connect Google Calendar" onPress={() => promptAsync()} />
 */
export function useGoogleAuth() {
  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'assignmenttracker' });
  const clientId = Constants.expoConfig?.extra?.googleClientIdIOS as string;

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId,
      redirectUri,
      scopes: ['https://www.googleapis.com/auth/calendar.events'],
      responseType: AuthSession.ResponseType.Token, // implicit flow; simplest for a client-only app
    },
    DISCOVERY
  );

  const accessToken =
    response?.type === 'success' ? (response.authentication?.accessToken ?? null) : null;

  return { request, response, promptAsync, accessToken };
}

interface BusyInterval {
  start: string; // ISO
  end: string; // ISO
}

/** Queries Google's freebusy endpoint for the given window on the primary calendar. */
async function fetchBusyIntervals(
  accessToken: string,
  timeMin: Date,
  timeMax: Date
): Promise<BusyInterval[]> {
  const res = await fetch(`${CALENDAR_API_BASE}/freeBusy`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: 'primary' }],
    }),
  });
  if (!res.ok) {
    throw new Error(`freeBusy query failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.calendars?.primary?.busy ?? [];
}

const WORKING_HOURS = { startHour: 9, endHour: 21 }; // 9am–9pm local time. Tune to taste.

/**
 * Finds the next slot of at least `durationMinutes`, starting the search
 * at `searchStart`, that doesn't overlap any interval in `busy` and
 * falls within WORKING_HOURS on whatever day it lands on. Very simple
 * O(n) walk — fine for a personal app's event volume.
 */
function findNextAvailableSlot(
  busy: BusyInterval[],
  durationMinutes: number,
  searchStart: Date,
  notAfter: Date
): { start: Date; end: Date } | null {
  const sortedBusy = [...busy]
    .map((b) => ({ start: new Date(b.start), end: new Date(b.end) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  let cursor = clampToWorkingHours(new Date(searchStart));

  while (cursor < notAfter) {
    const candidateEnd = new Date(cursor.getTime() + durationMinutes * 60_000);
    const dayEnd = new Date(cursor);
    dayEnd.setHours(WORKING_HOURS.endHour, 0, 0, 0);

    if (candidateEnd > dayEnd) {
      // Doesn't fit before the end of the working day — roll to tomorrow.
      cursor = clampToWorkingHours(addDays(cursor, 1));
      continue;
    }

    const conflict = sortedBusy.find((b) => overlaps(cursor, candidateEnd, b.start, b.end));
    if (!conflict) {
      if (candidateEnd > notAfter) return null; // would land after the assignment's due date
      return { start: cursor, end: candidateEnd };
    }
    // Jump past the conflicting event and try again.
    cursor = conflict.end;
    if (cursor.getHours() >= WORKING_HOURS.endHour) {
      cursor = clampToWorkingHours(addDays(cursor, 1));
    }
  }
  return null;
}

function clampToWorkingHours(date: Date): Date {
  const d = new Date(date);
  if (d.getHours() < WORKING_HOURS.startHour) d.setHours(WORKING_HOURS.startHour, 0, 0, 0);
  if (d.getHours() >= WORKING_HOURS.endHour) {
    d.setDate(d.getDate() + 1);
    d.setHours(WORKING_HOURS.startHour, 0, 0, 0);
  }
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Creates or updates the Google Calendar event for a single assignment.
 * Returns the Google event id (store this back onto the assignment).
 */
async function upsertCalendarEvent(
  accessToken: string,
  assignment: Assignment,
  slot: { start: Date; end: Date }
): Promise<string> {
  const eventBody = {
    summary: `📚 ${assignment.title}`,
    description: [
      assignment.subject ? `Subject: ${assignment.subject}` : null,
      `Difficulty: ${assignment.difficulty}/5`,
      `Due: ${new Date(assignment.dueDate).toLocaleString()}`,
      assignment.notes ? `Notes: ${assignment.notes}` : null,
      '',
      '(Auto-scheduled by Assignment Tracker)',
    ]
      .filter(Boolean)
      .join('\n'),
    start: { dateTime: slot.start.toISOString() },
    end: { dateTime: slot.end.toISOString() },
    extendedProperties: {
      private: {
        assignmentTrackerId: assignment.id,
        managedBy: 'assignment-tracker',
      },
    },
  };

  const isUpdate = !!assignment.googleCalendarEventId;
  const url = isUpdate
    ? `${CALENDAR_API_BASE}/calendars/primary/events/${assignment.googleCalendarEventId}`
    : `${CALENDAR_API_BASE}/calendars/primary/events`;

  const res = await fetch(url, {
    method: isUpdate ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(eventBody),
  });

  if (!res.ok) {
    throw new Error(`Calendar event upsert failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.id;
}

/**
 * Main entry point: syncs a PRIORITY-SORTED list of incomplete
 * assignments to Google Calendar, scheduling each into the next
 * available working-hours slot before its due date, then calls
 * `onEventLinked` for each so the caller can persist the returned
 * googleCalendarEventId (see storage/database.ts's updateAssignment).
 *
 * Pass assignments already sorted via `sortByPriority` from
 * priorityScoring.ts — this function does not re-sort, so it stays
 * decoupled from the scoring logic and easy to test independently.
 */
export async function syncAssignmentsToCalendar(
  accessToken: string,
  prioritizedAssignments: Assignment[],
  onEventLinked: (assignmentId: string, googleCalendarEventId: string) => void,
  now: Date = new Date()
): Promise<void> {
  if (prioritizedAssignments.length === 0) return;

  const horizonEnd = new Date(
    Math.max(...prioritizedAssignments.map((a) => new Date(a.dueDate).getTime()))
  );
  const busy = await fetchBusyIntervals(accessToken, now, horizonEnd);
  const busyWorkingCopy = [...busy];

  for (const assignment of prioritizedAssignments) {
    const dueDate = new Date(assignment.dueDate);
    const slot = findNextAvailableSlot(
      busyWorkingCopy,
      assignment.estimatedMinutes,
      now,
      dueDate
    );
    if (!slot) {
      // No room before the due date — skip rather than schedule work
      // after it's due. Surface this to the user in the UI layer.
      console.warn(`No available slot for "${assignment.title}" before its due date.`);
      continue;
    }
    const eventId = await upsertCalendarEvent(accessToken, assignment, slot);
    onEventLinked(assignment.id, eventId);
    busyWorkingCopy.push({ start: slot.start.toISOString(), end: slot.end.toISOString() });
  }
}
