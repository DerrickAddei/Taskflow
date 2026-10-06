import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, Alert, StyleSheet, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { getTimeBlocks, addTimeBlock, deleteTimeBlock } from '@/storage/database';
import { TimeBlock } from '@/models/TimeBlock';
import { useAppTheme, ThemeColors } from '@/theme/colors';

interface TimeBlockSettingsScreenProps {
  onBack: () => void;
}

const DAY_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'Daily' },
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

function minutesToDate(minutes: number): Date {
  const d = new Date();
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
}

function dateToMinutes(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function formatMinutes(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function dayLabel(dayOfWeek: number | null): string {
  return DAY_OPTIONS.find((d) => d.value === dayOfWeek)?.label ?? 'Daily';
}

export default function TimeBlockSettingsScreen({ onBack }: TimeBlockSettingsScreenProps) {
  const { colors, scheme } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [blocks, setBlocks] = useState<TimeBlock[]>([]);
  const [dayOfWeek, setDayOfWeek] = useState<number | null>(null);
  const [startMinute, setStartMinute] = useState(9 * 60); // 9:00 AM
  const [endMinute, setEndMinute] = useState(10 * 60); // 10:00 AM
  const [label, setLabel] = useState('');
  const [pickerOpen, setPickerOpen] = useState<'start' | 'end' | null>(null);

  const reload = useCallback(() => {
    setBlocks(getTimeBlocks());
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleAdd = () => {
    try {
      addTimeBlock({
        dayOfWeek,
        startMinute,
        endMinute,
        label: label.trim() || undefined,
      });
      setLabel('');
      reload();
    } catch (e: any) {
      Alert.alert('Could not save', e.message ?? String(e));
    }
  };

  const handleDelete = (block: TimeBlock) => {
    Alert.alert(
      'Delete this block?',
      `${dayLabel(block.dayOfWeek)}, ${formatMinutes(block.startMinute)}–${formatMinutes(block.endMinute)}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteTimeBlock(block.id);
            reload();
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.header}>Do Not Disturb</Text>
        <View style={styles.headerSpacer} />
      </View>

      <Text style={styles.sectionLabel}>Day</Text>
      <View style={styles.dayRow}>
        {DAY_OPTIONS.map((option) => (
          <TouchableOpacity
            key={option.label}
            style={[styles.dayChip, dayOfWeek === option.value && styles.dayChipSelected]}
            onPress={() => setDayOfWeek(option.value)}
          >
            <Text style={[styles.dayChipText, dayOfWeek === option.value && styles.dayChipTextSelected]}>
              {option.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.timeRow}>
        <View style={styles.timeField}>
          <Text style={styles.sectionLabel}>Start</Text>
          <TouchableOpacity style={styles.input} onPress={() => setPickerOpen('start')}>
            <Text style={styles.inputText}>{formatMinutes(startMinute)}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.timeField}>
          <Text style={styles.sectionLabel}>End</Text>
          <TouchableOpacity style={styles.input} onPress={() => setPickerOpen('end')}>
            <Text style={styles.inputText}>{formatMinutes(endMinute)}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {pickerOpen && (
        <DateTimePicker
          value={minutesToDate(pickerOpen === 'start' ? startMinute : endMinute)}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          themeVariant={scheme}
          onChange={(_event: any, selected?: Date) => {
            setPickerOpen(Platform.OS === 'ios' ? pickerOpen : null);
            if (selected) {
              const minutes = dateToMinutes(selected);
              if (pickerOpen === 'start') setStartMinute(minutes);
              else setEndMinute(minutes);
            }
          }}
        />
      )}
      {Platform.OS === 'ios' && pickerOpen && (
        <TouchableOpacity style={styles.doneButton} onPress={() => setPickerOpen(null)}>
          <Text style={styles.doneButtonText}>Done</Text>
        </TouchableOpacity>
      )}

      <Text style={styles.sectionLabel}>Label (optional)</Text>
      <TextInput
        style={styles.input}
        value={label}
        onChangeText={setLabel}
        placeholder="e.g. Church, Sleep"
        placeholderTextColor={colors.placeholder}
      />

      <TouchableOpacity style={styles.addButton} onPress={handleAdd}>
        <Text style={styles.addButtonText}>+ Add Block</Text>
      </TouchableOpacity>

      <Text style={styles.listHeader}>Current blocks</Text>
      <FlatList
        data={blocks}
        keyExtractor={(b) => b.id}
        ListEmptyComponent={<Text style={styles.emptyText}>No blocks yet.</Text>}
        renderItem={({ item }) => (
          <View style={styles.blockRow}>
            <View style={styles.blockMain}>
              <Text style={styles.blockTitle}>
                {dayLabel(item.dayOfWeek)} · {formatMinutes(item.startMinute)}–{formatMinutes(item.endMinute)}
              </Text>
              {item.label ? <Text style={styles.blockLabel}>{item.label}</Text> : null}
            </View>
            <TouchableOpacity onPress={() => handleDelete(item)} style={styles.deleteButton}>
              <Text style={styles.deleteText}>Delete</Text>
            </TouchableOpacity>
          </View>
        )}
      />
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, paddingTop: 60, paddingHorizontal: 16, backgroundColor: colors.background },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
    backText: { color: colors.accent, fontSize: 16, fontWeight: '600' },
    header: { fontSize: 20, fontWeight: '700', color: colors.text },
    headerSpacer: { width: 50 },
    sectionLabel: { fontSize: 13, fontWeight: '600', color: colors.secondaryText, marginTop: 14, marginBottom: 6 },
    dayRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    dayChip: {
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    dayChipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
    dayChipText: { color: colors.text, fontWeight: '600', fontSize: 13 },
    dayChipTextSelected: { color: colors.accentText },
    timeRow: { flexDirection: 'row', gap: 12 },
    timeField: { flex: 1 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 16,
      justifyContent: 'center',
      color: colors.text,
      backgroundColor: colors.surface,
    },
    inputText: { color: colors.text, fontSize: 16 },
    doneButton: { alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 4 },
    doneButtonText: { color: colors.accent, fontWeight: '600' },
    addButton: {
      backgroundColor: colors.accent,
      borderRadius: 8,
      paddingVertical: 12,
      alignItems: 'center',
      marginTop: 18,
    },
    addButtonText: { color: colors.accentText, fontWeight: '600', fontSize: 15 },
    listHeader: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 24, marginBottom: 8 },
    emptyText: { color: colors.secondaryText, fontSize: 13 },
    blockRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    blockMain: { flex: 1 },
    blockTitle: { fontSize: 15, fontWeight: '500', color: colors.text },
    blockLabel: { fontSize: 12, color: colors.secondaryText, marginTop: 2 },
    deleteButton: { paddingVertical: 4, paddingHorizontal: 6 },
    deleteText: { color: colors.danger, fontWeight: '600', fontSize: 13 },
  });
}