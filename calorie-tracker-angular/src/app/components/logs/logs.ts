import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Logger } from '../../services/logger';
import { LogEntry } from '../../models/log.model';
import { LogTimeFormatPipe } from '../../pipes/log-time-format.pipe';

@Component({
  selector: 'app-logs',
  imports: [CommonModule, FormsModule, LogTimeFormatPipe],
  templateUrl: './logs.html',
  styleUrl: './logs.scss'
})
export class Logs implements OnInit {
  private logger = inject(Logger);
  
  logs: LogEntry[] = [];
  filteredLogs: LogEntry[] = [];
  logLevel = 'all';
  copySuccess = false;
  
  ngOnInit(): void {
    this.logger.logs$.subscribe(logs => {
      this.logs = logs;
      this.filterLogs();
    });
  }
  
  filterLogs(): void {
    if (this.logLevel === 'all') {
      this.filteredLogs = this.logs;
    } else {
      this.filteredLogs = this.logs.filter(log => log.type === this.logLevel);
    }
  }
  
  clearLogs(): void {
    if (confirm('Clear all logs?')) {
      this.logger.clearLogs();
    }
  }
  
  copyLogs(): void {
    const logsText = this.filteredLogs
      .map(log => `[${new Date(log.timestamp).toISOString()}] ${log.level.toUpperCase()}: ${log.text}`)
      .join('\n');
    
    navigator.clipboard.writeText(logsText).then(
      () => {
        this.copySuccess = true;
        setTimeout(() => this.copySuccess = false, 2000);
      },
      (err) => console.error('Failed to copy logs:', err)
    );
  }
}
