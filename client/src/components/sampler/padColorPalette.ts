import { LED_COLOR_PALETTE } from '@/lib/led-colors';

const PAD_PRIMARY_COLOR_NAMES = [
  'Dim Gray',
  'Gray',
  'White',
  'Red',
  'Amber',
  'Orange',
  'Light Yellow',
  'Yellow',
  'Green',
  'Aqua',
  'Blue',
  'Pure Blue',
  'Violet',
  'Purple',
  'Hot Pink',
  'Hot Pink 2',
  'Deep Magenta',
  'Deep Brown 2'
];

export const PAD_COLOR_OPTIONS = LED_COLOR_PALETTE
  .filter((entry) => entry.velocity > 0)
  .filter((entry, index, arr) => arr.findIndex((item) => item.hex === entry.hex) === index)
  .map((entry) => ({ label: entry.name, value: entry.hex }));

export const PRIMARY_PAD_COLORS = PAD_PRIMARY_COLOR_NAMES
  .map((name) => PAD_COLOR_OPTIONS.find((entry) => entry.label === name))
  .filter(Boolean) as Array<{ label: string; value: string }>;

export const EXTRA_PAD_COLORS = PAD_COLOR_OPTIONS.filter(
  (entry) => !PRIMARY_PAD_COLORS.some((primary) => primary.value === entry.value)
);

export const getPadColorOptionLabel = (value: string | null | undefined): string => {
  if (!value) return 'Custom';
  const normalized = value.trim().toLowerCase();
  return PAD_COLOR_OPTIONS.find((entry) => entry.value.toLowerCase() === normalized)?.label || 'Custom';
};
