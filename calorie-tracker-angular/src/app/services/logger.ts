import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { LogEntry, LogLevel, LOG_LEVELS } from '../models/log.model';

@Injectable({
  providedIn: 'root',
})
export class Logger {
  private logs: LogEntry[] = [];
  private logsSubject = new BehaviorSubject<LogEntry[]>([]);
  private logLevel: LogLevel = 'info';
  private retentionMinutes = 5;

  logs$: Observable<LogEntry[]> = this.logsSubject.asObservable();

  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  setRetention(minutes: number): void {
    this.retentionMinutes = minutes;
  }

  debug(message: string, raw?: any): void {
    this.log(message, 'debug', raw);
  }

  info(message: string, raw?: any): void {
    this.log(message, 'info', raw);
  }

  warn(message: string, raw?: any): void {
    this.log(message, 'warn', raw);
  }

  error(message: string, raw?: any): void {
    this.log(message, 'error', raw);
  }

  private log(message: string, level: LogLevel, raw?: any): void {
    const currentLevel = LOG_LEVELS[this.logLevel];
    const messageLevel = LOG_LEVELS[level];

    if (messageLevel < currentLevel) return;

    const timestamp = Date.now();
    let text = `[${new Date(timestamp).toLocaleTimeString()}] [${level.toUpperCase()}] ${message}`;
    
    if (raw) {
      text += `\nRAW: ${JSON.stringify(raw, null, 2)}`;
    }

    const entry: LogEntry = { 
      timestamp, 
      text, 
      message: text, // Alias
      level, 
      type: level // Alias
    };
    this.logs.unshift(entry);
    this.pruneLogs();
    this.logsSubject.next([...this.logs]);
  }

  private pruneLogs(): void {
    const cutoff = Date.now() - this.retentionMinutes * 60 * 1000;
    this.logs = this.logs.filter(log => log.timestamp > cutoff);
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  clearLogs(): void {
    this.logs = [];
    this.logsSubject.next([]);
  }
}

