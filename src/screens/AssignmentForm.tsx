import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
  Alert,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Assignment, Difficulty, NewAssignmentInput, validateNewAssignment } from '@/models/Assignment';
import { createAssignment, updateAssignment } from '@/storage/database';

interface AssignmentFormProps {
  visible: boolean;
  assignment?: Assignment | null;
  onClose: () => void;
  onSaved: () => void;
}

const DIFFICULTY_OPTIONS: Difficulty[] = [1, 2, 3, 4, 5];

export default function AssignmentForm({ visible, assignment, onClose, onSaved }: AssignmentFormProps) {
  const isEditing = !!assignment;

  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [estimatedMinutes, setEstimatedMinutes] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>(3);
  const [subject, setSubject] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    if (assignment) {
      setTitle(assignment.title);
      setDueDate(new Date(assignment.dueDate));
      setEstimatedMinutes(String(assignment.estimatedMinutes));
      setDifficulty(assignment.difficulty);
      setSubject(assignment.subject ?? '');
      setNotes(assignment.notes ?? '');
    } else {
      setTitle('');
      setDueDate(new Date());
      setEstimatedMinutes('');
      setDifficulty(3);
      setSubject('');
      setNotes('');
    }
  }, [visible, assignment]);

  const handleSave = () => {
    const parsedMinutes = parseInt(estimatedMinutes, 10);
    const input: NewAssignmentInput = {
      title: title.trim(),
      dueDate: dueDate.toISOString(),
      estimatedMinutes: parsedMinutes,
      difficulty,
      subject: subject.trim() || undefined,
      notes: notes.trim() || undefined,
    };

    const errors = validateNewAssignment(input);
    if (errors.length > 0) {
      Alert.alert('Please fix the following', errors.join('\n'));
      return;
    }

    setSaving(true);
    try {
      if (isEditing && assignment) {
        updateAssignment(assignment.id, input);
      } else {
        createAssignment(input);
      }
      onSaved();
      onClose();
    } catch (e: any) {
      Alert.alert('Could not save', e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.header}>{isEditing ? 'Edit Assignment' : 'New Assignment'}</Text>

          <Text style={styles.label}>Title *</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Chapter 4 problem set"
            returnKeyType="done"
          />

          <Text style={styles.label}>Due date & time *</Text>
          <TouchableOpacity style={styles.input} onPress={() => setShowDatePicker(true)}>
            <Text style={styles.inputText}>{dueDate.toLocaleString()}</Text>
          </TouchableOpacity>
          {showDatePicker && (
            <DateTimePicker
              value={dueDate}
              mode="datetime"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              themeVariant="light"
              onChange={(_event: any, selected?: Date) => {
                setShowDatePicker(Platform.OS === 'ios'); // iOS spinner stays open until "Done" below
                if (selected) setDueDate(selected);
              }}
            />
          )}
          {Platform.OS === 'ios' && showDatePicker && (
            <TouchableOpacity style={styles.doneButton} onPress={() => setShowDatePicker(false)}>
              <Text style={styles.doneButtonText}>Done</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.label}>Estimated time (minutes) *</Text>
          <TextInput
            style={styles.input}
            value={estimatedMinutes}
            onChangeText={setEstimatedMinutes}
            placeholder="e.g. 60"
            keyboardType="number-pad"
          />

          <Text style={styles.label}>Difficulty *</Text>
          <View style={styles.difficultyRow}>
            {DIFFICULTY_OPTIONS.map((level) => (
              <TouchableOpacity
                key={level}
                style={[styles.difficultyOption, difficulty === level && styles.difficultyOptionSelected]}
                onPress={() => setDifficulty(level)}
              >
                <Text style={[styles.difficultyText, difficulty === level && styles.difficultyTextSelected]}>
                  {level}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Subject</Text>
          <TextInput style={styles.input} value={subject} onChangeText={setSubject} placeholder="Optional" />

          <Text style={styles.label}>Notes</Text>
          <TextInput
            style={[styles.input, styles.notesInput]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Optional"
            multiline
          />

          <View style={styles.buttonRow}>
            <TouchableOpacity style={[styles.button, styles.cancelButton]} onPress={onClose} disabled={saving}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.saveButton]} onPress={handleSave} disabled={saving}>
              <Text style={styles.saveButtonText}>{saving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: 20, paddingBottom: 40 },
  header: { fontSize: 22, fontWeight: '700', marginBottom: 20 },
  label: { fontSize: 13, fontWeight: '600', color: '#555', marginTop: 16, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    justifyContent: 'center',
    color: '#111',
  },
  inputText: { color: '#111', fontSize: 16 },
  notesInput: { minHeight: 80, textAlignVertical: 'top' },
  difficultyRow: { flexDirection: 'row', justifyContent: 'space-between' },
  difficultyOption: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  difficultyOptionSelected: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  difficultyText: { fontSize: 16, fontWeight: '600', color: '#333' },
  difficultyTextSelected: { color: '#fff' },
  doneButton: { alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 4 },
  doneButtonText: { color: '#2563eb', fontWeight: '600' },
  buttonRow: { flexDirection: 'row', marginTop: 28, gap: 12 },
  button: { flex: 1, paddingVertical: 14, borderRadius: 8, alignItems: 'center' },
  cancelButton: { backgroundColor: '#f0f0f0' },
  cancelButtonText: { color: '#333', fontWeight: '600' },
  saveButton: { backgroundColor: '#2563eb' },
  saveButtonText: { color: '#fff', fontWeight: '600' },
});