/**
 * Local persistence for assignments, using expo-sqlite.
 *
 * This is a personal, single-user app — everything lives on-device.
 * There's no backend/server component. If you later want cross-device
 * sync, the cleanest path is to swap this module for a thin wrapper
 * around Firebase/Supabase without touching callers, since they only
 * depend on the functions exported here.
 */

import { TimeBlock, NewTimeBlockInput, validateNewTimeBlock } from '@/models/TimeBlock';
import * as SQLite from 'expo-sqlite';
import { Assignment, NewAssignmentInput, validateNewAssignment } from '@/models/Assignment';

const db = SQLite.openDatabaseSync('assignment_tracker.db');

export function initDatabase(): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS assignments (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      dueDate TEXT NOT NULL,
      estimatedMinutes INTEGER NOT NULL,
      difficulty INTEGER NOT NULL,
      subject TEXT,
      notes TEXT,
      completed INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      googleCalendarEventId TEXT
    );
  `);
  db.execSync(`
    CREATE TABLE IF NOT EXISTS time_blocks (
      id TEXT PRIMARY KEY NOT NULL,
      dayOfWeek INTEGER,
      startMinute INTEGER NOT NULL,
      endMinute INTEGER NOT NULL,
      label TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
  `);
}

function rowToAssignment(row: any): Assignment {
  return {
    id: row.id,
    title: row.title,
    dueDate: row.dueDate,
    estimatedMinutes: row.estimatedMinutes,
    difficulty: row.difficulty,
    subject: row.subject ?? undefined,
    notes: row.notes ?? undefined,
    completed: !!row.completed,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    googleCalendarEventId: row.googleCalendarEventId ?? undefined,
  };
}

export function getAllAssignments(): Assignment[] {
  const rows = db.getAllSync('SELECT * FROM assignments ORDER BY dueDate ASC');
  return rows.map(rowToAssignment);
}

export function getIncompleteAssignments(): Assignment[] {
  const rows = db.getAllSync(
    'SELECT * FROM assignments WHERE completed = 0 ORDER BY dueDate ASC'
  );
  return rows.map(rowToAssignment);
}

export function createAssignment(input: NewAssignmentInput): Assignment {
  const errors = validateNewAssignment(input);
  if (errors.length > 0) {
    throw new Error(`Invalid assignment: ${errors.join(' ')}`);
  }
  const now = new Date().toISOString();
  const assignment: Assignment = {
    ...input,
    id: cryptoRandomId(),
    completed: false,
    createdAt: now,
    updatedAt: now,
  };
  db.runSync(
    `INSERT INTO assignments
      (id, title, dueDate, estimatedMinutes, difficulty, subject, notes, completed, createdAt, updatedAt, googleCalendarEventId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      assignment.id,
      assignment.title,
      assignment.dueDate,
      assignment.estimatedMinutes,
      assignment.difficulty,
      assignment.subject ?? null,
      assignment.notes ?? null,
      assignment.completed ? 1 : 0,
      assignment.createdAt,
      assignment.updatedAt,
      assignment.googleCalendarEventId ?? null,
    ]
  );
  return assignment;
}

export function updateAssignment(id: string, patch: Partial<Assignment>): void {
  const existing = getAllAssignments().find((a) => a.id === id);
  if (!existing) throw new Error(`Assignment ${id} not found`);
  const merged: Assignment = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  db.runSync(
    `UPDATE assignments SET
      title = ?, dueDate = ?, estimatedMinutes = ?, difficulty = ?, subject = ?,
      notes = ?, completed = ?, updatedAt = ?, googleCalendarEventId = ?
     WHERE id = ?`,
    [
      merged.title,
      merged.dueDate,
      merged.estimatedMinutes,
      merged.difficulty,
      merged.subject ?? null,
      merged.notes ?? null,
      merged.completed ? 1 : 0,
      merged.updatedAt,
      merged.googleCalendarEventId ?? null,
      id,
    ]
  );
}

export function deleteAssignment(id: string): void {
  db.runSync('DELETE FROM assignments WHERE id = ?', [id]);
}

function cryptoRandomId(): string {
  // Good enough for a local, single-user primary key. Swap for
  // expo-crypto's randomUUID if you want RFC4122-compliant UUIDs.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// -----------------------------------------------------------------------
// TIME BLOCKS (Phase 2, data layer only — not yet read by the scheduler)
// -----------------------------------------------------------------------

function rowToTimeBlock(row: any): TimeBlock {
  return {
    id: row.id,
    dayOfWeek: row.dayOfWeek === null || row.dayOfWeek === undefined ? null : row.dayOfWeek,
    startMinute: row.startMinute,
    endMinute: row.endMinute,
    label: row.label ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** "Every day" blocks (dayOfWeek IS NULL) sort first, then by day and start time. */
export function getTimeBlocks(): TimeBlock[] {
  const rows = db.getAllSync('SELECT * FROM time_blocks ORDER BY dayOfWeek, startMinute');
  return rows.map(rowToTimeBlock);
}

export function addTimeBlock(input: NewTimeBlockInput): TimeBlock {
  const errors = validateNewTimeBlock(input);
  if (errors.length > 0) {
    throw new Error(`Invalid time block: ${errors.join(' ')}`);
  }
  const now = new Date().toISOString();
  const block: TimeBlock = {
    ...input,
    id: cryptoRandomId(),
    createdAt: now,
    updatedAt: now,
  };
  db.runSync(
    `INSERT INTO time_blocks (id, dayOfWeek, startMinute, endMinute, label, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      block.id,
      block.dayOfWeek,
      block.startMinute,
      block.endMinute,
      block.label ?? null,
      block.createdAt,
      block.updatedAt,
    ]
  );
  return block;
}

export function deleteTimeBlock(id: string): void {
  db.runSync('DELETE FROM time_blocks WHERE id = ?', [id]);
}