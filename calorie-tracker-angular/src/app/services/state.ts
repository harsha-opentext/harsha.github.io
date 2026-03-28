import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Entry, DailyData } from '../models/entry.model';
import { Schema } from '../models/schema.model';

export interface AppState {
  entries: Entry[];
  dailyDataMap: Map<string, DailyData>; // date -> DailyData
  schema: Schema | null;
  loading: boolean;
  hasUnsavedChanges: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class State {
  private state: AppState = {
    entries: [],
    dailyDataMap: new Map(),
    schema: null,
    loading: false,
    hasUnsavedChanges: false
  };

  private stateSubject = new BehaviorSubject<AppState>(this.state);
  state$: Observable<AppState> = this.stateSubject.asObservable();

  getState(): AppState {
    return { ...this.state, dailyDataMap: new Map(this.state.dailyDataMap) };
  }

  setSchema(schema: Schema): void {
    this.state.schema = schema;
    this.emit();
  }

  setEntries(entries: Entry[]): void {
    this.state.entries = entries;
    this.emit();
  }

  addEntry(entry: Entry): void {
    this.state.entries.push(entry);
    this.state.hasUnsavedChanges = true;
    this.emit();
  }

  updateEntry(index: number, entry: Entry): void {
    this.state.entries[index] = entry;
    this.state.hasUnsavedChanges = true;
    this.emit();
  }

  deleteEntry(index: number): void {
    this.state.entries.splice(index, 1);
    this.state.hasUnsavedChanges = true;
    this.emit();
  }

  setDailyData(date: string, data: DailyData): void {
    this.state.dailyDataMap.set(date, data);
    this.emit();
  }

  getDailyData(date: string): DailyData | undefined {
    return this.state.dailyDataMap.get(date);
  }

  setLoading(loading: boolean): void {
    this.state.loading = loading;
    this.emit();
  }

  clearUnsavedChanges(): void {
    this.state.hasUnsavedChanges = false;
    this.emit();
  }

  private emit(): void {
    this.stateSubject.next(this.getState());
  }

  reset(): void {
    this.state = {
      entries: [],
      dailyDataMap: new Map(),
      schema: null,
      loading: false,
      hasUnsavedChanges: false
    };
    this.emit();
  }
}

