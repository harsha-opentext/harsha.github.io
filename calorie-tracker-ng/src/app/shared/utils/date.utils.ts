export function getTodayString(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function formatDateLocal(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function formatDateReadable(dateStr: string): string {
  if (!dateStr) return '—';
  try {
    const [year, month, day] = dateStr.split('-').map(Number);
    const v = day % 100;
    const suffix =
      v >= 11 && v <= 13
        ? 'th'
        : ['th', 'st', 'nd', 'rd'][day % 10] || 'th';
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    return `${day}${suffix} ${months[month - 1]} ${year}`;
  } catch {
    return dateStr;
  }
}

export function addDaysToDateString(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return formatDateLocal(d);
}

export function getEntryDate(entry: Record<string, unknown>): string | null {
  if (entry['date'] && typeof entry['date'] === 'string') return entry['date'];
  if (entry['_sourceDate'] && typeof entry['_sourceDate'] === 'string') return entry['_sourceDate'];
  if (entry['timestamp'] && typeof entry['timestamp'] === 'string') {
    try { return formatDateLocal(new Date(entry['timestamp'])); } catch { /* ignore */ }
  }
  return null;
}

export function buildDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  let cur = new Date(start + 'T00:00:00');
  const endD = new Date(end + 'T00:00:00');
  while (cur <= endD) {
    dates.push(formatDateLocal(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
