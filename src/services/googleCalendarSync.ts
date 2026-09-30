import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useState } from 'react';
import { Assignment } from '@/models/Assignment';

WebBrowser.maybeCompleteAuthSession();

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
const DISCOVERY = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

const CLIENT_ID_WEB = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB as string;
const CLIENT_SECRET_WEB = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_SECRET_WEB as string;
const PROXY_REDIRECT_URI = process.env.EXPO_PUBLIC_GOOGLE_AUTH_PROXY_URL as string;

function parseQueryParams(url: string): Record<string, string> {
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return {};
  const params: Record<string, string> = {};
  for (const pair of url.slice(queryStart + 1).split('&')) {
    const [key, value] = pair.split('=');
    if (key) params[decodeURIComponent(key)] = decodeURIComponent(value ?? '');
  }
  return params;
}

const SECURE_STORE_KEY = 'google_oauth_tokens';

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

let cachedTokens: StoredTokens | null = null;

async function saveTokens(tokens: StoredTokens): Promise<void> {
  cachedTokens = tokens;
  await SecureStore.setItemAsync(SECURE_STORE_KEY, JSON.stringify(tokens));
}

async function loadTokens(): Promise<StoredTokens | null> {
  if (cachedTokens) return cachedTokens;
  const raw = await SecureStore.getItemAsync(SECURE_STORE_KEY);
  if (!raw) return null;
  cachedTokens = JSON.parse(raw);
  return cachedTokens;
}

export async function refreshGoogleToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const res = await fetch(DISCOVERY.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID_WEB,
      client_secret: CLIENT_SECRET_WEB,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return { accessToken: data.access_token, expiresInSeconds: data.expires_in ?? 3600 };
}

async function ensureFreshAccessToken(): Promise<string | null> {
  const tokens = await loadTokens();
  if (!tokens) return null;
  if (Date.now() < tokens.expiresAt - 60_000) return tokens.accessToken;
  const refreshed = await refreshGoogleToken(tokens.refreshToken);
  const updated: StoredTokens = {
    accessToken: refreshed.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: Date.now() + refreshed.expiresInSeconds * 1000,
  };
  await saveTokens(updated);
  return updated.accessToken;
}

async function calendarFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await ensureFreshAccessToken();
  if (!token) throw new Error('Not signed in to Google Calendar.');

  const doFetch = (t: string) =>
    fetch(`${CALENDAR_API_BASE}${path}`, {
      ...options,
      headers: { ...(options.headers ?? {}), Authorization: `Bearer ${t}` },
    });

  let res = await doFetch(token);
  if (res.status === 401) {
    const tokens = await loadTokens();
    if (!tokens) throw new Error('Not signed in to Google Calendar.');
    const refreshed = await refreshGoogleToken(tokens.refreshToken);
    const updated: StoredTokens = {
      accessToken: refreshed.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: Date.now() + refreshed.expiresInSeconds * 1000,
    };
    await saveTokens(updated);
    res = await doFetch(updated.accessToken);
  }
  return res;
}

export function useGoogleAuth() {
  const appRedirectUri = AuthSession.makeRedirectUri({ scheme: 'assignmenttracker' });
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authRequest, setAuthRequest] = useState<AuthSession.AuthRequest | null>(null);

  useEffect(() => {
    loadTokens().then((tokens) => {
      if (tokens) setAccessToken(tokens.accessToken);
    });
  }, []);

  useEffect(() => {
    const request = new AuthSession.AuthRequest({
      clientId: CLIENT_ID_WEB,
      redirectUri: PROXY_REDIRECT_URI,
      scopes: ['https://www.googleapis.com/auth/calendar'],
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true,
      state: appRedirectUri,
      extraParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    });
    request.makeAuthUrlAsync(DISCOVERY).then(() => setAuthRequest(request));
  }, [appRedirectUri]);

  const promptAsync = useCallback(async () => {
    if (!authRequest?.url) return;
    const result = await WebBrowser.openAuthSessionAsync(authRequest.url, appRedirectUri);
    if (result.type !== 'success' || !result.url) return;

    const { code, error } = parseQueryParams(result.url);
    if (error || !code || !authRequest.codeVerifier) {
      console.warn('Google sign-in did not return a usable code', error);
      return;
    }

    const tokenResponse = await AuthSession.exchangeCodeAsync(
      {
        clientId: CLIENT_ID_WEB,
        clientSecret: CLIENT_SECRET_WEB,
        code,
        redirectUri: PROXY_REDIRECT_URI,
        extraParams: { code_verifier: authRequest.codeVerifier },
      },
      DISCOVERY
    );

    if (!tokenResponse.refreshToken) {
      console.warn('Google did not return a refresh_token — sign-in may expire again in about an hour.');
    }
    await saveTokens({
      accessToken: tokenResponse.accessToken,
      refreshToken: tokenResponse.refreshToken ?? '',
      expiresAt: Date.now() + (tokenResponse.expiresIn ?? 3600) * 1000,
    });
    setAccessToken(tokenResponse.accessToken);
  }, [authRequest, appRedirectUri]);

  return { request: authRequest, promptAsync, accessToken };
}

interface BusyInterval {
  start: string;
  end: string;
}

const MINUTE_MS = 60 * 1000;
const QUARTER_HOUR_MS = 15 * MINUTE_MS;
const DAY_MS = 24 * 60 * MINUTE_MS;
const MANAGED_BY = 'assignment-tracker';

const BREAK_MINUTES = 15;

interface CalendarEvent {
  id: string;
  status?: string;
  transparency?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
  extendedProperties?: { private?: Record<string, string> };
}

function toQueryString(params: Record<string, string>): string {
  return Object.keys(params)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
}

async function listCalendarEvents(
  timeMin: Date,
  timeMax: Date,
  onlyOurs = false,
  extraPrivateProperty?: string
): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = [];
  let pageToken = '';
  do {
    const params: Record<string, string> = {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: 'true',
      maxResults: '250',
    };
    if (pageToken) params.pageToken = pageToken;
    let query = toQueryString(params);
    if (onlyOurs) query += `&privateExtendedProperty=${encodeURIComponent(`managedBy=${MANAGED_BY}`)}`;
    if (extraPrivateProperty) query += `&privateExtendedProperty=${encodeURIComponent(extraPrivateProperty)}`;

    const res = await calendarFetch(`/calendars/primary/events?${query}`);
    if (!res.ok) {
      throw new Error(`Listing calendar events failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    events.push(...(data.items ?? []));
    pageToken = data.nextPageToken ?? '';
  } while (pageToken);
  return events;
}

function eventsToBusyIntervals(events: CalendarEvent[]): BusyInterval[] {
  return events
    .filter((e) => {
      if (e.status === 'cancelled') return false;
      if (e.transparency === 'transparent') return false;
      if (!e.start?.dateTime || !e.end?.dateTime) return false;
      if (e.extendedProperties?.private?.managedBy === MANAGED_BY) return false;
      if (e.attendees?.some((a) => a.self && a.responseStatus === 'declined')) return false;
      return true;
    })
    .map((e) => ({ start: e.start!.dateTime as string, end: e.end!.dateTime as string }));
}

function isMovedByUser(event: CalendarEvent, now: Date): boolean {
  const props = event.extendedProperties?.private;
  if (!props?.plannedStart || !props?.plannedEnd) return false;
  if (!event.start?.dateTime || !event.end?.dateTime) return false;
  const start = new Date(event.start.dateTime).getTime();
  const end = new Date(event.end.dateTime).getTime();
  const moved =
    Math.abs(start - new Date(props.plannedStart).getTime()) > MINUTE_MS ||
    Math.abs(end - new Date(props.plannedEnd).getTime()) > MINUTE_MS;
  return moved && end > now.getTime();
}

const WORKING_HOURS = { startHour: 9, endHour: 21 };

function findNextAvailableSlot(
  busy: BusyInterval[],
  durationMinutes: number,
  searchStart: Date,
  notAfter: Date
): { start: Date; end: Date } | null {
  const sortedBusy = [...busy]
    .map((b) => ({ start: new Date(b.start), end: new Date(b.end) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  let cursor = clampToWorkingHours(roundUpToQuarterHour(searchStart));

  while (cursor < notAfter) {
    const candidateEnd = new Date(cursor.getTime() + durationMinutes * MINUTE_MS);
    const dayEnd = new Date(cursor);
    dayEnd.setHours(WORKING_HOURS.endHour, 0, 0, 0);

    if (candidateEnd > dayEnd) {
      cursor = startOfNextWorkingDay(cursor);
      continue;
    }

    const conflict = sortedBusy.find((b) => overlaps(cursor, candidateEnd, b.start, b.end));
    if (!conflict) {
      if (candidateEnd > notAfter) return null;
      return { start: cursor, end: candidateEnd };
    }
    cursor = clampToWorkingHours(roundUpToQuarterHour(conflict.end));
  }
  return null;
}

function roundUpToQuarterHour(date: Date): Date {
  return new Date(Math.ceil(date.getTime() / QUARTER_HOUR_MS) * QUARTER_HOUR_MS);
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

function startOfNextWorkingDay(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + 1);
  d.setHours(WORKING_HOURS.startHour, 0, 0, 0);
  return d;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function toLocalDateString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function buildBlockEvent(assignment: Assignment, slot: { start: Date; end: Date }) {
  return {
    summary: `📚 ${assignment.title}`,
    description: [
      assignment.subject ? `Subject: ${assignment.subject}` : null,
      `Difficulty: ${assignment.difficulty}/5`,
      `Due: ${new Date(assignment.dueDate).toLocaleString()}`,
      assignment.notes ? `Notes: ${assignment.notes}` : null,
      '',
      '(Auto-scheduled by Assignment Tracker. Drag it to a new time and the app will leave it there.)',
    ]
      .filter((line) => line !== null)
      .join('\n'),
    start: { dateTime: slot.start.toISOString() },
    end: { dateTime: slot.end.toISOString() },
    extendedProperties: {
      private: {
        assignmentTrackerId: assignment.id,
        managedBy: MANAGED_BY,
        kind: 'block',
        plannedStart: slot.start.toISOString(),
        plannedEnd: slot.end.toISOString(),
      },
    },
  };
}

function buildWarningEvent(assignment: Assignment, now: Date, reason: string) {
  const due = new Date(assignment.dueDate);
  const markerDay = due > now ? due : now;
  const nextDay = new Date(markerDay);
  nextDay.setDate(nextDay.getDate() + 1);
  return {
    summary: `⚠️ Couldn't schedule: ${assignment.title}`,
    description: [
      reason,
      `Due: ${due.toLocaleString()}`,
      `Estimated time: ${assignment.estimatedMinutes} min`,
      '',
      '(Auto-added by Assignment Tracker. This goes away once the assignment fits on your calendar.)',
    ].join('\n'),
    start: { date: toLocalDateString(markerDay) },
    end: { date: toLocalDateString(nextDay) },
    transparency: 'transparent',
    colorId: '11',
    extendedProperties: {
      private: { assignmentTrackerId: assignment.id, managedBy: MANAGED_BY, kind: 'warning' },
    },
  };
}

async function saveCalendarEvent(
  body: object,
  existingEventId?: string
): Promise<{ id: string; created: boolean }> {
  const headers = { 'Content-Type': 'application/json' };

  if (existingEventId) {
    const patchRes = await calendarFetch(`/calendars/primary/events/${existingEventId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    });
    if (patchRes.ok) {
      const data = await patchRes.json();
      if (data.status !== 'cancelled') return { id: data.id, created: false };
    } else if (patchRes.status !== 404 && patchRes.status !== 410) {
      throw new Error(`Calendar event update failed: ${patchRes.status} ${await patchRes.text()}`);
    }
  }

  const createRes = await calendarFetch(`/calendars/primary/events`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!createRes.ok) {
    throw new Error(`Calendar event create failed: ${createRes.status} ${await createRes.text()}`);
  }
  const data = await createRes.json();
  return { id: data.id, created: true };
}

async function deleteCalendarEvent(eventId: string): Promise<void> {
  const res = await calendarFetch(`/calendars/primary/events/${eventId}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Calendar event delete failed: ${res.status} ${await res.text()}`);
  }
}

export interface SyncResult {
  title: string;
  status: 'created' | 'updated' | 'kept' | 'skipped' | 'failed';
  reason?: string;
}

export interface SyncSummary {
  results: SyncResult[];
  removed: number;
}

export async function syncAssignmentsToCalendar(
  prioritizedAssignments: Assignment[],
  onEventLinked: (assignmentId: string, googleCalendarEventId: string) => void,
  now: Date = new Date()
): Promise<SyncSummary> {
  const results: SyncResult[] = [];
  const idsBeingSynced = new Set(prioritizedAssignments.map((a) => a.id));

  const latestDue =
    prioritizedAssignments.length > 0
      ? Math.max(...prioritizedAssignments.map((a) => new Date(a.dueDate).getTime()))
      : 0;
  const windowEnd = new Date(Math.max(latestDue, now.getTime() + DAY_MS));

  const upcomingEvents = await listCalendarEvents(now, windowEnd);
  const busyWorkingCopy = eventsToBusyIntervals(upcomingEvents);

  const ourEvents = await listCalendarEvents(
    new Date(now.getTime() - 90 * DAY_MS),
    new Date(now.getTime() + 365 * DAY_MS),
    true
  );
  const blockByAssignment = new Map<string, CalendarEvent>();
  const warningIdByAssignment = new Map<string, string>();
  const pinnedByAssignment = new Map<string, CalendarEvent>();
  const orphans: CalendarEvent[] = [];

  for (const event of ourEvents) {
    const props = event.extendedProperties?.private;
    if (props?.managedBy !== MANAGED_BY || !props.assignmentTrackerId) continue;
    const assignmentId = props.assignmentTrackerId;
    if (!idsBeingSynced.has(assignmentId)) {
      orphans.push(event);
    } else if (props.kind === 'warning') {
      warningIdByAssignment.set(assignmentId, event.id);
    } else {
      blockByAssignment.set(assignmentId, event);
      if (isMovedByUser(event, now)) pinnedByAssignment.set(assignmentId, event);
    }
  }

  for (const event of pinnedByAssignment.values()) {
    busyWorkingCopy.push({
      start: event.start!.dateTime as string,
      end: new Date(
        new Date(event.end!.dateTime as string).getTime() + BREAK_MINUTES * MINUTE_MS
      ).toISOString(),
    });
  }

  for (const assignment of prioritizedAssignments) {
    try {
      const staleWarningId = warningIdByAssignment.get(assignment.id);
      const existingBlock = blockByAssignment.get(assignment.id);

      const pinned = pinnedByAssignment.get(assignment.id);
      if (pinned) {
        onEventLinked(assignment.id, pinned.id);
        if (staleWarningId) await deleteCalendarEvent(staleWarningId).catch(() => {});
        results.push({
          title: assignment.title,
          status: 'kept',
          reason: 'You moved this block, so it stays where you put it.',
        });
        continue;
      }

      const dueDate = new Date(assignment.dueDate);
      const slot = findNextAvailableSlot(busyWorkingCopy, assignment.estimatedMinutes, now, dueDate);

      if (slot) {
        const { id, created } = await saveCalendarEvent(buildBlockEvent(assignment, slot), existingBlock?.id);
        onEventLinked(assignment.id, id);
        busyWorkingCopy.push({
          start: slot.start.toISOString(),
          end: new Date(slot.end.getTime() + BREAK_MINUTES * MINUTE_MS).toISOString(),
        });
        if (staleWarningId) await deleteCalendarEvent(staleWarningId).catch(() => {});
        results.push({ title: assignment.title, status: created ? 'created' : 'updated' });
      } else {
        const reason =
          dueDate <= now ? 'Already past its due time.' : 'No open time before the due date.';
        await saveCalendarEvent(buildWarningEvent(assignment, now, reason), staleWarningId);
        if (existingBlock?.end?.dateTime && new Date(existingBlock.end.dateTime) > now) {
          await deleteCalendarEvent(existingBlock.id).catch(() => {});
        }
        results.push({ title: assignment.title, status: 'skipped', reason });
      }
    } catch (e: any) {
      results.push({ title: assignment.title, status: 'failed', reason: e.message ?? String(e) });
    }
  }

  let removed = 0;
  for (const event of orphans) {
    const isWarning = event.extendedProperties?.private?.kind === 'warning';
    const endsInFuture = !!event.end?.dateTime && new Date(event.end.dateTime) > now;
    if (!isWarning && !endsInFuture) continue;
    try {
      await deleteCalendarEvent(event.id);
      removed++;
    } catch {
      // Best effort: the next sync will try again.
    }
  }

  return { results, removed };
}

export async function removeAssignmentFromCalendar(assignmentId: string): Promise<void> {
  const events = await listCalendarEvents(
    new Date(Date.now() - 365 * DAY_MS),
    new Date(Date.now() + 365 * DAY_MS),
    true,
    `assignmentTrackerId=${assignmentId}`
  );
  await Promise.all(events.map((e) => deleteCalendarEvent(e.id).catch(() => {})));
}