import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Button, FlatList, Alert, StyleSheet, TouchableOpacity } from 'react-native';
import { initDatabase, getIncompleteAssignments, updateAssignment, deleteAssignment } from '@/storage/database';
import { Assignment } from '@/models/Assignment';
import { sortByPriority, computeDisplayPriorityScore } from '@/services/priorityScoring';
import { useGoogleAuth, syncAssignmentsToCalendar, removeAssignmentFromCalendar } from '@/services/googleCalendarSync';
import {
  requestNotificationPermissions,
  refreshDailyDigest,
  registerBackgroundDigestRefresh,
} from '@/services/notificationService';
import AssignmentForm from './AssignmentForm';
import { useAppTheme, ThemeColors } from '@/theme/colors';

export default function AssignmentListScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [formVisible, setFormVisible] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean | null>(null);
  const { request, promptAsync, accessToken } = useGoogleAuth();

  const reload = useCallback(() => {
    setAssignments(sortByPriority(getIncompleteAssignments()));
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
    removeAssignmentFromCalendar(assignmentId).catch((e) =>
      console.warn('Background calendar cleanup failed for', assignmentId, e)
    );
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

  const handleSyncToCalendar = async () => {
    if (!accessToken) {
      Alert.alert('Connect Google Calendar first.');
      return;
    }
    setSyncing(true);
    try {
      const { results, removed } = await syncAssignmentsToCalendar(
        assignments,
        (assignmentId, eventId) => {
          updateAssignment(assignmentId, { googleCalendarEventId: eventId });
        }
      );
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
      Alert.alert('Sync failed', e.message ?? String(e));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Assignments</Text>
      <Button title="+ Add Assignment" onPress={handleAddPress} color={colors.accent} />
      <Button
        title={accessToken ? 'Re-sync to Google Calendar' : 'Connect Google Calendar'}
        disabled={!request || syncing}
        onPress={() => (accessToken ? handleSyncToCalendar() : promptAsync())}
        color={colors.accent}
      />
      <FlatList
        data={assignments}
        keyExtractor={(a) => a.id}
        renderItem={({ item }) => (
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
        )}
      />
      <AssignmentForm visible={formVisible} assignment={editingAssignment} onClose={() => setFormVisible(false)} onSaved={reload} />
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, paddingTop: 60, paddingHorizontal: 16, backgroundColor: colors.background },
    header: { fontSize: 24, fontWeight: '600', marginBottom: 12, color: colors.text },
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
  });
}