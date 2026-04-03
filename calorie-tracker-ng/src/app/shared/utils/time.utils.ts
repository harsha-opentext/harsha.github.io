// "H:MM AM/PM" → "HH:MM"
export function timeTo24(t: string): string {
  if (!t) return '';
  const m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return '';
  let h = parseInt(m[1], 10);
  const ap = m[3].toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

// "HH:MM" → "H:MM AM/PM"
export function time24To12(hhmm: string): string {
  if (!hhmm) return '';
  const parts = hhmm.split(':');
  if (parts.length < 2) return '';
  const h = parseInt(parts[0], 10);
  const min = parts[1];
  const ap = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 || 12;
  return `${h12}:${min} ${ap}`;
}
