import React, { useState } from 'react';
import { SafeAreaView } from 'react-native';
import AssignmentListScreen from '@/screens/AssignmentListScreen';
import TimeBlockSettingsScreen from '@/screens/TimeBlockSettingsScreen';

type Screen = 'list' | 'timeBlocks';

export default function App() {
  const [screen, setScreen] = useState<Screen>('list');

  return (
    <SafeAreaView style={{ flex: 1 }}>
      {screen === 'list' ? (
        <AssignmentListScreen onOpenTimeBlocks={() => setScreen('timeBlocks')} />
      ) : (
        <TimeBlockSettingsScreen onBack={() => setScreen('list')} />
      )}
    </SafeAreaView>
  );
}