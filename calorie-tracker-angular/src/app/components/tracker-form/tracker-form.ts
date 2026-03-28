import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Schema } from '../../services/schema';
import { State } from '../../services/state';
import { Github } from '../../services/github';
import { Logger } from '../../services/logger';
import { Config } from '../../services/config';
import { Entry } from '../../models/entry.model';
import { SchemaField } from '../../models/schema.model';

@Component({
  selector: 'app-tracker-form',
  imports: [CommonModule, FormsModule],
  templateUrl: './tracker-form.html',
  styleUrl: './tracker-form.scss'
})
export class TrackerForm implements OnInit {
  private state = inject(State);
  private github = inject(Github);
  private logger = inject(Logger);
  private config = inject(Config);

  formData: any = {};
  schemaFields: SchemaField[] = [];
  todayEntries: Entry[] = [];
  todayDate: string = '';
  loading = false;
  initialLoading = true;
  hasCredentials = false;
  errorMessage: string | null = null;

  private schemaLoaded = false;

  ngOnInit(): void {
    this.hasCredentials = this.config.hasCredentials();
    this.todayDate = this.getTodayString();
    
    this.logger.debug('TrackerForm initializing...');
    
    // Subscribe to state changes
    this.state.state$.subscribe(state => {
      if (state.schema && !this.schemaLoaded) {
        this.schemaLoaded = true;
        this.initialLoading = false;
        this.logger.info('Schema loaded, initializing form');
        this.schemaFields = state.schema.fields.filter(f => f.type !== 'hidden');
        this.initializeFormData(state.schema.fields);
        
        // Load today's data only once after schema is ready
        if (this.hasCredentials) {
          this.loadTodayData();
        }
      }
      
      // Filter today's entries
      this.todayEntries = state.entries.filter(e => e.date === this.todayDate);
    });
  }

  initializeFormData(fields: SchemaField[]): void {
    fields.forEach(field => {
      if (field.default === 'today') {
        this.formData[field.name] = this.todayDate;
      } else if (field.default) {
        this.formData[field.name] = field.default;
      } else if (field.type === 'number') {
        this.formData[field.name] = null;
      } else {
        this.formData[field.name] = '';
      }
    });
  }

  async loadTodayData(): Promise<void> {
    if (!this.hasCredentials) {
      this.logger.warn('No GitHub credentials configured');
      return;
    }

    try {
      this.logger.info(`Loading data for ${this.todayDate}...`);
      const data = await this.github.fetchDailyData(this.todayDate);
      
      if (data) {
        this.state.setDailyData(data.date, data);
        this.state.setEntries(data.entries);
        this.logger.info(`Loaded ${data.entries.length} entries for today`);
      } else {
        this.state.setEntries([]);
        this.logger.info('No data found for today (file may not exist yet)');
      }
    } catch (error: any) {
      this.logger.error(`Failed to load today data: ${error?.message || error}`, error);
      if (error?.status !== 404) {
        this.errorMessage = 'Failed to load data. Check Settings or Logs page for details.';
      }
    }
  }

  async addEntry(): Promise<void> {
    // Validate required fields
    const schema = this.state.getState().schema;
    if (!schema) return;

    this.errorMessage = null;
    this.errorMessage = null;
    
    const requiredFields = schema.fields.filter(f => f.required);
    for (const field of requiredFields) {
      if (!this.formData[field.name]) {
        this.errorMessage = `${field.label} is required`;
        setTimeout(() => this.errorMessage = null, 3000);
        return;
      }
    }

    this.errorMessage = null;

    const entry: Entry = {
      timestamp: Date.now(),
      date: this.todayDate,
      ...this.formData
    };

    try {
      this.loading = true;
      
      // Add to local state
      this.state.addEntry(entry);
      
      // Push to GitHub
      const currentState = this.state.getState();
      const todayData = currentState.dailyDataMap.get(this.todayDate);
      const entries = currentState.entries.filter(e => e.date === this.todayDate);
      
      const newSha = await this.github.pushDailyData(
        this.todayDate,
        entries,
        todayData?.sha
      );

      // Update SHA
      this.state.setDailyData(this.todayDate, { date: this.todayDate, entries, sha: newSha });
      this.state.clearUnsavedChanges();

      this.logger.info('Entry added successfully');
      
      // Reset form
      this.initializeFormData(schema.fields);
    } catch (error) {
      this.logger.error('Failed to add entry', error);
      this.errorMessage = 'Failed to add entry. Check Logs page for details.';
      setTimeout(() => this.errorMessage = null, 5000);
    } finally {
      this.loading = false;
    }
  }

  async deleteEntry(entry: Entry): Promise<void> {
    if (!confirm('Are you sure you want to delete this entry?')) return;

    try {
      this.loading = true;
      const currentState = this.state.getState();
      const index = currentState.entries.findIndex(e => 
        e.timestamp === entry.timestamp && e.date === entry.date
      );

      if (index === -1) return;

      this.state.deleteEntry(index);

      // Push updated data to GitHub
      const todayData = currentState.dailyDataMap.get(this.todayDate);
      const entries = this.state.getState().entries.filter(e => e.date === this.todayDate);

      const newSha = await this.github.pushDailyData(
        this.todayDate,
        entries,
        todayData?.sha
      );

      this.state.setDailyData(this.todayDate, { date: this.todayDate, entries, sha: newSha });
      this.state.clearUnsavedChanges();

      this.logger.info('Entry deleted successfully');
    } catch (error) {
      this.logger.error('Failed to delete entry', error);
      alert('Failed to delete entry. Check logs for details.');
    } finally {
      this.loading = false;
    }
  }

  getTodayString(): string {
    const now = new Date();
    return now.toISOString().split('T')[0];
  }

  getTodayTotal(): number {
    return this.todayEntries.reduce((sum, e) => sum + (e.calories || 0), 0);
  }

  getDailyBudget(): number {
    return this.config.getConfig('dailyBudget');
  }

  getRemainingCalories(): number {
    return this.getDailyBudget() - this.getTodayTotal();
  }
}

