import { expect, it } from 'vitest';
import { logbookText } from './logbook-text';

it('mengubah URL HTTP(S) menjadi tautan dan mempertahankan sisa teks', () => {
  const input = 'Dari <script>\n(https://rein.example/x?a=1&b=2).\njavascript:alert(1)';
  const parts = logbookText(input);
  expect(parts.map((part) => part.text).join('')).toBe(input);
  expect(parts.filter((part) => part.href).map((part) => part.href)).toEqual([
    'https://rein.example/x?a=1&b=2',
  ]);
});
