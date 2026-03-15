import { LED_COLOR_PALETTE } from '@/lib/led-colors';

const BANK_PRIMARY_COLOR_NAMES = [
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

const getContrastText = (hex: string) => {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return '#ffffff';
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#000000' : '#ffffff';
};

export const bankColorOptions = LED_COLOR_PALETTE
  .filter((entry) => entry.velocity > 0)
  .filter((entry, index, arr) => arr.findIndex((item) => item.hex === entry.hex) === index)
  .map((entry) => ({
    label: entry!.name,
    value: entry!.hex,
    textColor: getContrastText(entry!.hex)
  }));

export const primaryBankColorOptions = BANK_PRIMARY_COLOR_NAMES
  .map((name) => bankColorOptions.find((entry) => entry.label === name))
  .filter(Boolean) as typeof bankColorOptions;

export const extraBankColorOptions = bankColorOptions.filter(
  (entry) => !primaryBankColorOptions.some((primary) => primary.value === entry.value)
);

export const formatBankEditDate = (date: Date) => {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
};
