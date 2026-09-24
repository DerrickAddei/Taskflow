/**
 * Minimal screen wiring the pieces together end-to-end:
 *   storage -> priorityScoring -> render list -> Google Calendar sync -> digest notification
 *
 * This is intentionally bare-bones (no styling polish, no add/edit form
 * beyond a couple of hardcoded quick-add buttons) — it exists to prove
 * the pipeline works, and to give Copilot a clear, small surface to
 * build a real UI on top of.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Button, FlatList, Alert, StyleSheet } from 'react-native';
import {
  initDatabase,
  getIncompleteAssignments,
  createAssignment,
  updateAssignment,
} from '@/storage/database';
import { Assignment } from '@/models/Assignment';
import { sortByPriority, computeDisplayPriorityScore } from '@/services/priorityScoring';
import { useGoogleAuth, syncAssignmentsToCalendar } from '@/services/googleCalendarSync';
import {
  requestNotificationPermissions,
  refreshDailyDigest,
  registerBackgroundDigestRefresh,
} from '@/services/notificationService';

export default function AssignmentListScreen() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [syncing, setSyncing] = useState(false);
  const { request, promptAsync, accessToken } = useGoogleAuth();

  const reload = useCallback(() => {
    setAssignments(sortByPriority(getIncompleteAssignments()));
  }, []);

  useEffect(() => {
    initDatabase();
    reload();
    requestNotificationPermissions().then((granted) => {
      if (granted) {
        refreshDailyDigest(getIncompleteAssignments);
        registerBackgroundDigestRefresh(getIncompleteAssignments);
      }
    });
  }, [reload]);

  const handleAddSample = () => {
    createAssignment({
      title: 'Sample assignment',
      dueDate: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      estimatedMinutes: 90,
      difficulty: 4,
    });
    reload();
  };

  const handleSyncToCalendar = async () => {
    if (!accessToken) {
      Alert.alert('Connect Google Calendar first.');
      return;
    }
    setSyncing(true);
    try {
      await syncAssignmentsToCalendar(accessToken, assignments, (assignmentId, eventId) => {
        updateAssignment(assignmentId, { googleCalendarEventId: eventId });
      });
      reload();
      Alert.alert('Synced to Google Calendar.');
    } catch (e: any) {
      Alert.alert('Sync failed', e.message ?? String(e));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Assignments</Text>
      <Button title="+ Add sample assignment" onPress={handleAddSample} />
      <Button
        title={accessToken ? 'Re-sync to Google Calendar' : 'Connect Google Calendar'}
        disabled={!request || syncing}
        onPress={() => (accessToken ? handleSyncToCalendar() : promptAsync())}
      />
      <FlatList
        data={assignments}
        keyExtractor={(a) => a.id}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.meta}>
              Due {new Date(item.dueDate).toLocaleDateString()} · Difficulty {item.difficulty}/5 ·{' '}
              {item.estimatedMinutes}m · priority {computeDisplayPriorityScore(item).toFixed(2)}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60, paddingHorizontal: 16 },
  header: { fontSize: 24, fontWeight: '600', marginBottom: 12 },
  row: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ccc' },
  title: { fontSize: 16, fontWeight: '500' },
  meta: { fontSize: 12, color: '#666', marginTop: 2 },
});
