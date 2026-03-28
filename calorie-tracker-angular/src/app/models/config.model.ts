export interface AppConfig {
  // GitHub repository settings
  dataFolder: string;
  schemaFile: string;
  logFile: string;
  maxLogFileSize: number;
  fetchDays: number;
  
  // Application settings
  dateFormat: string;
  timeFormat: '12h' | '24h';
  autoFetch: boolean;
  autoSave: boolean;
  dailyBudget: number;
  
  // UI settings
  theme: 'light' | 'dark';
  showLogs: boolean;
  logRetentionMinutes: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  dataFolder: 'data',
  schemaFile: '/schema.yaml',
  logFile: 'logs.txt',
  maxLogFileSize: 1048576,
  fetchDays: 90,
  
  dateFormat: 'YYYY-MM-DD',
  timeFormat: '12h',
  autoFetch: true,
  autoSave: true,
  dailyBudget: 2000,
  
  theme: 'dark',
  showLogs: false,
  logRetentionMinutes: 5
};
