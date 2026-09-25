import React from 'react';
import { SafeAreaView } from 'react-native';
import AssignmentListScreen from '@/screens/AssignmentListScreen';

export default function App() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <AssignmentListScreen />
    </SafeAreaView>
  );
}
