export type LogType = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: number;
  text: string;
  type: LogType;
}
