export interface AppConfig {
  dataFolder: string;
  schemaFile: string;
  logFile: string;
  maxLogFileSize: number;
  fetchDays: number;
  dateFormat: string;
  autoFetch: boolean;
  autoSave: boolean;
  dailyBudget: number;
  theme: 'auto' | 'dark' | 'light';
  showLogs: boolean;
  showToasts: boolean;
  allowEditOlderWeights: boolean;
  autoIncrementStreakOnAdd: boolean;
  logRetentionMinutes: number;
  logFolder: string;
}

export const DEFAULT_CONFIG: AppConfig = {
  dataFolder: 'data',
  schemaFile: 'schema.yaml',
  logFile: 'logs.txt',
  maxLogFileSize: 1048576,
  fetchDays: 90,
  dateFormat: 'YYYY-MM-DD',
  autoFetch: true,
  autoSave: true,
  dailyBudget: 2000,
  theme: 'dark',
  showLogs: false,
  showToasts: true,
  allowEditOlderWeights: false,
  autoIncrementStreakOnAdd: true,
  logRetentionMinutes: 5,
  logFolder: 'logs',
};
