import { useColorScheme } from 'react-native';

export interface ThemeColors {
  background: string;
  surface: string;
  text: string;
  secondaryText: string;
  border: string;
  accent: string;
  accentText: string;
  danger: string;
  cancelBackground: string;
  cancelText: string;
  placeholder: string;
}

export const lightColors: ThemeColors = {
  background: '#ffffff',
  surface: '#ffffff',
  text: '#111111',
  secondaryText: '#666666',
  border: '#dddddd',
  accent: '#2563eb',
  accentText: '#ffffff',
  danger: '#dc2626',
  cancelBackground: '#f0f0f0',
  cancelText: '#333333',
  placeholder: '#999999',
};

export const darkColors: ThemeColors = {
  background: '#000000',
  surface: '#1c1c1e',
  text: '#f2f2f7',
  secondaryText: '#a1a1a6',
  border: '#3a3a3c',
  accent: '#3b82f6',
  accentText: '#ffffff',
  danger: '#f87171',
  cancelBackground: '#2c2c2e',
  cancelText: '#f2f2f7',
  placeholder: '#8e8e93',
};

/** Reads the system appearance setting and returns the matching color set. */
export function useAppTheme(): { colors: ThemeColors; scheme: 'light' | 'dark' } {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { colors: scheme === 'dark' ? darkColors : lightColors, scheme };
}