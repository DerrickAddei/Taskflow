import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Button, FlatList, Alert, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import {
  initDatabase,
  getIncompleteAssignments,
  getCompletedAssignments,
  updateAssignment,
  deleteAssignment,
  createAssignment,
} from '@/storage/database';
import { Assignment, Difficulty, NewAssignmentInput, validateNewAssignment } from '@/models/Assignment';
import { parseAssignment } from '@/services/geminiParser';
import { sortByPriority, computeDisplayPriorityScore } from '@/services/priorityScoring';
import {
  useGoogleAuth,
  syncAssignmentsToCalendar,
  removeAssignmentFromCalendar,
  GoogleReauthRequiredError,
} from '@/services/googleCalendarSync';
import {
  requestNotificationPermissions,
  refreshDailyDigest,
  registerBackgroundDigestRefresh,
} from '@/services/notificationService';
import AssignmentForm from './AssignmentForm';
import { useAppTheme, ThemeColors } from '@/theme/colors';

interface AssignmentListScreenProps {
  onOpenTimeBlocks?: () => void;
}

type ViewMode = 'active' | 'completed';

export default function AssignmentListScreen({ onOpenTimeBlocks }: AssignmentListScreenProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [viewMode, setViewMode] = useState<ViewMode>('active');
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [completedAssignments, setCompletedAssignments] = useState<Assignment[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [formVisible, setFormVisible] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean | null>(null);
  const [voiceText, setVoiceText] = useState('');
  const [parsing, setParsing] = useState(false);
  const { request, promptAsync, accessToken, signOut } = useGoogleAuth();

  // Keeps both lists (active + completed) in sync with the database on every
  // reload, so no call site has to remember which one it affected.
  const reload = useCallback(() => {
    setAssignments(sortByPriority(getIncompleteAssignments()));
    setCompletedAssignments(getCompletedAssignments());
  }, []);

  useEffect(() => {
    initDatabase();
    reload();
    requestNotificationPermissions().then((granted) => {
      setNotificationsEnabled(granted);
      if (granted) {
        refreshDailyDigest(getIncompleteAssignments);
        registerBackgroundDigestRefresh(getIncompleteAssignments);
      } else {
        Alert.alert(
          'Notifications are off',
          'The 1pm daily digest needs notification permission. You can turn it on in Settings → Notifications → Assignment Tracker.'
        );
      }
    });
  }, [reload]);

  const handleAddPress = () => {
    setEditingAssignment(null);
    setFormVisible(true);
  };

  const handleEditPress = (assignment: Assignment) => {
    setEditingAssignment(assignment);
    setFormVisible(true);
  };

  const cleanUpCalendarFor = (assignmentId: string) => {
    if (!accessToken) return;
    removeAssignmentFromCalendar(assignmentId).catch(async (e) => {
      if (e instanceof GoogleReauthRequiredError) {
        await signOut();
        Alert.alert('Google Calendar disconnected', 'Please reconnect to keep syncing.');
        return;
      }
      console.warn('Background calendar cleanup failed for', assignmentId, e);
    });
  };

  const handleComplete = (assignment: Assignment) => {
    updateAssignment(assignment.id, { completed: true });
    reload();
    cleanUpCalendarFor(assignment.id);
  };

  const handleDelete = (assignment: Assignment) => {
    Alert.alert('Delete assignment?', `"${assignment.title}" will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteAssignment(assignment.id);
          reload();
          cleanUpCalendarFor(assignment.id);
        },
      },
    ]);
  };

  // Shared by the manual "Re-sync" button and by restoring a completed task —
  // always takes an explicit, freshly-read list rather than relying on
  // component state, so a restore that just changed the database can't sync
  // against a stale snapshot from before the change.
  const performSync = async (list: Assignment[]) => {
    if (!accessToken) {
      Alert.alert('Connect Google Calendar first.');
      return;
    }
    setSyncing(true);
    try {
      const { results, removed } = await syncAssignmentsToCalendar(list, (assignmentId, eventId) => {
        updateAssignment(assignmentId, { googleCalendarEventId: eventId });
      });
      reload();
      const created = results.filter((r) => r.status === 'created' || r.status === 'updated').length;
      const skipped = results.filter((r) => r.status === 'skipped');
      const failed = results.filter((r) => r.status === 'failed');
      let message = `${created} synced.`;
      if (removed) message += `\n${removed} old block(s) cleaned up.`;
      if (skipped.length) message += `\n${skipped.length} skipped: ${skipped.map((r) => r.title).join(', ')}`;
      if (failed.length) message += `\n${failed.length} failed: ${failed.map((r) => `${r.title} (${r.reason})`).join('; ')}`;
      Alert.alert('Sync complete', message);
    } catch (e: any) {
      if (e instanceof GoogleReauthRequiredError) {
        await signOut();
        Alert.alert(
          'Google Calendar disconnected',
          'Your connection expired or was revoked. Tap "Connect Google Calendar" to sign in again.'
        );
      } else {
        Alert.alert('Sync failed', e.message ?? String(e));
      }
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncToCalendar = () => performSync(sortByPriority(getIncompleteAssignments()));
  const handleVoiceSubmit = async () => {
    const text = voiceText.trim();
    if (!text) return;
    setParsing(true);
    try {
      const parsed = await parseAssignment(text);
      const input: NewAssignmentInput = {
        title: (parsed.title ?? '').trim(),
        dueDate: parsed.dueDate,
        estimatedMinutes: Math.round(Number(parsed.estimatedMinutes)),
        difficulty: Math.round(Number(parsed.difficulty)) as Difficulty,
        subject: parsed.subject?.trim() || undefined,
      };
      const errors = validateNewAssignment(input);
      if (errors.length > 0) {
        Alert.alert('Could not create assignment from that', errors.join('\n'));
        return; // keep voiceText as-is so they can edit and retry rather than re-dictate
      }
      createAssignment(input);
      setVoiceText('');
      reload();
    } catch (e: any) {
      Alert.alert('Voice parsing failed', e.message ?? String(e));
    } finally {
      setParsing(false);
    }
  };

  const handleRestore = (assignment: Assignment) => {
    updateAssignment(assignment.id, { completed: false });
    reload();
    if (accessToken) {
      performSync(sortByPriority(getIncompleteAssignments()));
    }
  };

  const listData = viewMode === 'active' ? assignments : completedAssignments;

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Assignments</Text>

      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, viewMode === 'active' && styles.tabSelected]}
          onPress={() => setViewMode('active')}
        >
          <Text style={[styles.tabText, viewMode === 'active' && styles.tabTextSelected]}>Active</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, viewMode === 'completed' && styles.tabSelected]}
          onPress={() => setViewMode('completed')}
        >
          <Text style={[styles.tabText, viewMode === 'completed' && styles.tabTextSelected]}>
            Completed ({completedAssignments.length})
          </Text>
        </TouchableOpacity>
      </View>

      {viewMode === 'active' && (
        <>
          <Button title="+ Add Assignment" onPress={handleAddPress} color={colors.accent} />
          {onOpenTimeBlocks && (
            <Button title="Do Not Disturb settings" onPress={onOpenTimeBlocks} color={colors.accent} />
          )}
          <Button
            title={accessToken ? 'Re-sync to Google Calendar' : 'Connect Google Calendar'}
            disabled={!request || syncing}
            onPress={() => (accessToken ? handleSyncToCalendar() : promptAsync())}
            color={colors.accent}
          />

          <Text style={styles.sectionLabel}>Quick Voice Add</Text>
          <TextInput
            style={styles.voiceInput}
            value={voiceText}
            onChangeText={setVoiceText}
            placeholder="Tap the mic on your keyboard and dictate, e.g. 'Physics lab report due Friday, pretty hard, maybe two hours'"
            placeholderTextColor={colors.placeholder}
            multiline
            editable={!parsing}
          />
          <TouchableOpacity
            style={[styles.parseButton, (parsing || !voiceText.trim()) && styles.parseButtonDisabled]}
            onPress={handleVoiceSubmit}
            disabled={parsing || !voiceText.trim()}
          >
            {parsing ? (
              <ActivityIndicator color={colors.accentText} />
            ) : (
              <Text style={styles.parseButtonText}>Parse & Schedule</Text>
            )}
          </TouchableOpacity>
        </>
      )}

      <FlatList
        data={listData}
        keyExtractor={(a) => a.id}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {viewMode === 'active' ? 'No active assignments.' : 'Nothing completed yet.'}
          </Text>
        }
        renderItem={({ item }) =>
          viewMode === 'active' ? (
            <View style={styles.row}>
              <View style={styles.rowMain}>
                <Text style={styles.title}>{item.title}</Text>
                <Text style={styles.meta}>
                  Due {new Date(item.dueDate).toLocaleDateString()} · Difficulty {item.difficulty}/5 ·{' '}
                  {item.estimatedMinutes}m · priority {computeDisplayPriorityScore(item).toFixed(2)}
                </Text>
              </View>
              <View style={styles.actions}>
                <TouchableOpacity onPress={() => handleComplete(item)} style={styles.actionButton}>
                  <Text style={styles.actionText}>✓</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleEditPress(item)} style={styles.actionButton}>
                  <Text style={styles.actionText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleDelete(item)} style={styles.actionButton}>
                  <Text style={[styles.actionText, styles.deleteText]}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.row}>
              <View style={styles.rowMain}>
                <Text style={styles.title}>{item.title}</Text>
                <Text style={styles.meta}>
                  Was due {new Date(item.dueDate).toLocaleDateString()} · completed{' '}
                  {new Date(item.updatedAt).toLocaleDateString()}
                </Text>
              </View>
              <View style={styles.actions}>
                <TouchableOpacity onPress={() => handleRestore(item)} style={styles.actionButton}>
                  <Text style={styles.actionText}>Restore</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleDelete(item)} style={styles.actionButton}>
                  <Text style={[styles.actionText, styles.deleteText]}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          )
        }
      />
      <AssignmentForm visible={formVisible} assignment={editingAssignment} onClose={() => setFormVisible(false)} onSaved={reload} />
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, paddingTop: 60, paddingHorizontal: 16, backgroundColor: colors.background },
    header: { fontSize: 24, fontWeight: '600', marginBottom: 12, color: colors.text },
    tabRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
    tab: {
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    tabSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
    tabText: { color: colors.text, fontWeight: '600', fontSize: 13 },
    tabTextSelected: { color: colors.accentText },
    emptyText: { color: colors.secondaryText, fontSize: 13, marginTop: 16 },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    rowMain: { flex: 1, paddingRight: 8 },
    title: { fontSize: 16, fontWeight: '500', color: colors.text },
    meta: { fontSize: 12, color: colors.secondaryText, marginTop: 2 },
    actions: { flexDirection: 'row', gap: 10 },
    actionButton: { paddingVertical: 4, paddingHorizontal: 6 },
    actionText: { color: colors.accent, fontWeight: '600', fontSize: 13 },
    deleteText: { color: colors.danger },
    sectionLabel: { fontSize: 13, fontWeight: '600', color: colors.secondaryText, marginTop: 14, marginBottom: 6 },
    voiceInput: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      minHeight: 60,
      textAlignVertical: 'top',
      color: colors.text,
      backgroundColor: colors.surface,
    },
    parseButton: {
      backgroundColor: colors.accent,
      borderRadius: 8,
      paddingVertical: 12,
      alignItems: 'center',
      marginTop: 8,
    },
    parseButtonDisabled: { opacity: 0.5 },
    parseButtonText: { color: colors.accentText, fontWeight: '600', fontSize: 15 },
  });
}