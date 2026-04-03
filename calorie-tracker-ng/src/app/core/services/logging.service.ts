import { Injectable, signal } from '@angular/core';
import { inject } from '@angular/core';
import { LogEntry, LogType } from '../models/log.model';

const LOG_LEVELS: Record<LogType, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

@Injectable({ providedIn: 'root' })
export class LoggingService {
  readonly logs = signal<LogEntry[]>([]);
  readonly logLevel = signal<LogType>('info');
  readonly retentionMinutes = signal<number>(5);

  dbg(msg: string, type: LogType = 'info', raw?: unknown): void {
    const currentLevel = LOG_LEVELS[this.logLevel()] ?? 1;
    const messageLevel = LOG_LEVELS[type] ?? 1;
    if (messageLevel < currentLevel) return;

    const timestamp = new Date().toLocaleTimeString();
    let text = `[${timestamp}] [${type.toUpperCase()}] ${msg}`;
    if (raw !== undefined) {
      text += `\nRAW: ${JSON.stringify(raw, null, 2)}`;
    }

    this.logs.update(prev => [{ ts: Date.now(), text, type }, ...prev]);
    this.pruneLogs();
  }

  pruneLogs(): void {
    const retention = this.retentionMinutes();
    if (!retention || retention <= 0) return;
    const cutoff = Date.now() - retention * 60 * 1000;
    this.logs.update(prev => prev.filter(l => l.ts >= cutoff));
  }

  setLogLevel(level: LogType): void {
    this.logLevel.set(level);
  }

  setRetentionMinutes(minutes: number): void {
    this.retentionMinutes.set(minutes);
    this.pruneLogs();
  }

  clearLogs(): void {
    this.logs.set([]);
  }

  async copyLogs(): Promise<void> {
    const txt = this.logs().map(l => l.text).join('\n\n');
    try {
      await navigator.clipboard.writeText(txt);
      this.dbg('Logs copied to clipboard.');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = txt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      this.dbg('Logs copied (fallback).');
    }
  }
}
