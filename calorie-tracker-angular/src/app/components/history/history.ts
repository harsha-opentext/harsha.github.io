import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { State } from '../../services/state';
import { Github } from '../../services/github';
import { Logger } from '../../services/logger';
import { Config } from '../../services/config';
import { Entry } from '../../models/entry.model';
import { SchemaField } from '../../models/schema.model';

@Component({
  selector: 'app-history',
  imports: [CommonModule, FormsModule],
  templateUrl: './history.html',
  styleUrl: './history.scss'
})
export class History implements OnInit {
  private state = inject(State);
  private github = inject(Github);
  private logger = inject(Logger);
  private config = inject(Config);
  private cdr = inject(ChangeDetectorRef);
  
  entries: Entry[] = [];
  filteredEntries: Entry[] = [];
  schemaFields: SchemaField[] = [];
  startDate = '';
  endDate = '';
  tempStartDate = '';
  tempEndDate = '';
  averageCalories = 0;
  totalCalories = 0;
  daysInRange = 0;
  loading = false;
  hasCredentials = false;
  
  ngOnInit(): void {
    this.hasCredentials = this.config.hasCredentials();
    
    // Set default to today
    const today = this.getTodayString();
    this.startDate = today;
    this.endDate = today;
    this.tempStartDate = today;
    this.tempEndDate = today;
    
    this.state.state$.subscribe(state => {
      this.logger.debug(`History: State updated. Entries count: ${state.entries.length}`);
      this.entries = [...state.entries].sort((a, b) => b.timestamp - a.timestamp);
      this.schemaFields = state.schema?.fields.filter(f => f.type !== 'hidden') || [];
      this.filterEntries();
    });
    
    // Load data for last 7 days by default
    if (this.hasCredentials) {
      this.loadDataForRange();
    }
  }
  
  async loadDataForRange(): Promise<void> {
    if (this.loading) {
      this.logger.warn('Already loading data, skipping duplicate request');
      return;
    }
    
    try {
      this.loading = true;
      this.logger.info(`⏳ Loading history data for range: ${this.startDate} to ${this.endDate}`);
      this.logger.debug(`Loading state set to true`);
      
      // Generate dates to fetch
      const datesToFetch: string[] = [];
      const start = new Date(this.startDate);
      const end = new Date(this.endDate);
      const currentState = this.state.getState();
      
      this.logger.debug(`Start date object: ${start}, End date object: ${end}`);
      
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = this.formatDate(d);
        if (!currentState.dailyDataMap.has(dateStr)) {
          datesToFetch.push(dateStr);
        } else {
            this.logger.debug(`Data for ${dateStr} already in cache, skipping fetch`);
        }
      }
      
      if (datesToFetch.length === 0) {
        this.logger.info('All dates in range already loaded. Skipping network request.');
        this.loading = false;
        this.cdr.markForCheck(); // Ensure UI updates
        return;
      }

      this.logger.info(`Fetching ${datesToFetch.length} days of data: ${datesToFetch.join(', ')}`);
      const dataMap = await this.github.fetchMultipleDays(datesToFetch);
      this.logger.info(`Fetch completed. Received data for ${dataMap.size} days`);
      
      // Update state with fetched data
      const allEntries: Entry[] = [];
      this.logger.debug('Processing fetched data...');
      dataMap.forEach((data) => {
        this.logger.debug(`Processing date ${data.date}: ${data.entries.length} entries`);
        allEntries.push(...data.entries);
        this.state.setDailyData(data.date, data);
      });
      
      this.logger.debug(`Total entries from fetch: ${allEntries.length}`);
      
      // Merge with existing entries (avoid duplicates)
      const existingTimestamps = new Set(this.state.getState().entries.map(e => e.timestamp));
      const newEntries = allEntries.filter(e => !existingTimestamps.has(e.timestamp));
      
      this.logger.debug(`New entries to add: ${newEntries.length}, Existing: ${existingTimestamps.size}`);
      
      if (newEntries.length > 0) {
        this.state.setEntries([...this.state.getState().entries, ...newEntries]);
        this.logger.info(`Added ${newEntries.length} new entries to state`);
      } else {
        this.logger.info('No new entries to add (all already in state)');
      }
      
      this.logger.info(`✓ Loaded ${allEntries.length} entries from ${dataMap.size} days`);
    } catch (error: any) {
      this.logger.error(`Failed to load history data: ${error?.message || error}`, error);
    } finally {
      this.loading = false;
      this.logger.info('✓ Loading complete, loading flag set to false');
      this.cdr.markForCheck(); // Ensure UI updates
    }
  }
  
  filterEntries(): void {
    if (!this.entries || this.entries.length === 0) {
      this.logger.debug('No entries to filter yet');
      this.filteredEntries = [];
      this.calculateStatistics();
      return;
    }
    
    let filtered = this.entries;
    
    this.logger.info(`Filtering ${this.entries.length} entries. Date range: ${this.startDate} to ${this.endDate}`);
    
    // Log first few entries to see their date values
    if (this.entries.length > 0) {
      this.entries.slice(0, 5).forEach((entry, i) => {
        this.logger.info(`Entry ${i}: date='${entry.date}', food='${entry['food']}', calories=${entry['calories']}`);
      });
    }
    
    if (this.startDate && this.endDate) {
      // Use the entry's date field to filter, not the timestamp
      // This matches how the legacy app works
      const startDate = this.startDate;
      const endDate = this.endDate;
      
      this.logger.info(`Filtering by entry.date field: '${startDate}' to '${endDate}'`);
      
      filtered = filtered.filter(e => {
        const entryDate = e.date || (e.timestamp ? new Date(typeof e.timestamp === 'string' ? e.timestamp : e.timestamp).toISOString().split('T')[0] : '');
        const inRange = entryDate >= startDate && entryDate <= endDate;
        if (!inRange && filtered.length < 20) {
          this.logger.debug(`Entry excluded: date='${entryDate}' not in range '${startDate}' to '${endDate}'`);
        }
        return inRange;
      });
      
      this.logger.info(`After date field filter: ${filtered.length} entries (from ${this.entries.length})`);
    }
    
    this.filteredEntries = filtered;
    this.logger.info(`✓ Filtered to ${filtered.length} entries`);
    this.calculateStatistics();
  }
  
  calculateStatistics(): void {
    this.totalCalories = this.filteredEntries.reduce((sum, entry) => {
      const calories = entry['calories'] || entry['kcal'] || 0;
      return sum + Number(calories);
    }, 0);
    
    // Calculate days in range
    if (this.startDate && this.endDate) {
      const start = new Date(this.startDate);
      const end = new Date(this.endDate);
      this.daysInRange = Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1;
      this.averageCalories = this.daysInRange > 0 ? Math.round(this.totalCalories / this.daysInRange) : 0;
    } else {
      this.daysInRange = 0;
      this.averageCalories = 0;
    }
  }
  
  applyFilter(): void {
    this.startDate = this.tempStartDate;
    this.endDate = this.tempEndDate;
    this.filterEntries();
    
    // Fetch data for the new range if credentials are available
    if (this.hasCredentials) {
      this.loadDataForRange();
    }
  }
  
  setQuickFilter(days: number): void {
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - days + 1);
    
    this.tempStartDate = this.formatDate(startDate);
    this.tempEndDate = this.formatDate(today);
    this.applyFilter();
  }
  
  setYesterday(): void {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    this.tempStartDate = this.formatDate(yesterday);
    this.tempEndDate = this.formatDate(yesterday);
    this.applyFilter();
  }
  
  formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }
  
  getTodayString(): string {
    return this.formatDate(new Date());
  }
  
  clearFilters(): void {
    const today = this.getTodayString();
    this.tempStartDate = today;
    this.tempEndDate = today;
    this.startDate = today;
    this.endDate = today;
    this.filterEntries();
  }
  
  get dateTimeFormat(): string {
    const timeFormat = this.config.getConfig('timeFormat');
    return timeFormat === '12h' ? 'M/d/yy, h:mm a' : 'M/d/yy, HH:mm';
  }
  
  deleteEntry(entry: Entry): void {
    if (confirm('Delete this entry?')) {
      // TODO: Implement delete via GitHub service
      console.log('Delete entry:', entry);
    }
  }
}
