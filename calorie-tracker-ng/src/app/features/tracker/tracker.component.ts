import { Component, inject, computed, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { StateService } from '../../core/services/state.service';
import { TrackerService } from './tracker.service';
import { GithubApiService } from '../../core/services/github-api.service';
import { LoggingService } from '../../core/services/logging.service';
import { NotificationService } from '../../core/services/notification.service';
import { ConfigService } from '../../core/services/config.service';
import { AnyEntry, isWeightEntry } from '../../core/models/entry.model';
import { getTodayString, getEntryDate } from '../../shared/utils/date.utils';
import { BudgetBarComponent } from './components/budget-bar/budget-bar.component';
import { EntryFormComponent } from './components/entry-form/entry-form.component';
import { EntryCardComponent } from './components/entry-card/entry-card.component';
import { CsvImportModalComponent } from './components/csv-import/csv-import-modal.component';
import { CsvImportService, CsvImportEntry } from './components/csv-import/csv-import.service';
import { EntryPreviewService } from '../../shared/components/entry-preview-modal/entry-preview.service';

type TrackerTab = 'entry' | 'weight';

@Component({
  selector: 'app-tracker',
  standalone: true,
  imports: [CommonModule, FormsModule, BudgetBarComponent, EntryFormComponent, EntryCardComponent, CsvImportModalComponent],
  template: `
    <div class="tracker-page">
      <div class="sub-nav">
        <button class="hub-back-btn" (click)="goHub()">← Hub</button>
        <h2 class="page-title">Log Entry</h2>
      </div>
      <!-- Budget bar -->
      <app-budget-bar />

      <!-- Tab Switcher -->
      <div class="form-tabs">
        <button class="tab-btn" [class.active]="activeTab() === 'entry'" (click)="setTab('entry')">📝 Add Entry</button>
        <button class="tab-btn" [class.active]="activeTab() === 'weight'" (click)="setTab('weight')">
          ⚖️ Weight
          @if (savedWeight() !== null) {
            <span class="weight-badge">{{ savedWeight() | number:'1.1-1' }} kg</span>
          }
        </button>
      </div>

      <!-- Entry Form Panel -->
      @if (activeTab() === 'entry') {
        <div class="form-panel card">
          <app-entry-form (entryAdded)="onEntryAdded($event)" />
        </div>
      }

      <!-- Weight Panel -->
      @if (activeTab() === 'weight') {
        <div class="weight-panel card">
          @if (savedWeight() !== null) {
            <div class="weight-saved-row">
              <span class="weight-label">Today's weight:</span>
              <span class="weight-value">{{ savedWeight() | number: '1.1-1' }} kg</span>
              @if (!weightEditMode()) {
                <button class="btn-secondary btn-sm" (click)="enableWeightEdit()">✏️ Edit</button>
              }
            </div>
          }
          @if (savedWeight() === null || weightEditMode()) {
            <div class="weight-input-row">
              <input
                type="number"
                class="weight-input form-input"
                [(ngModel)]="weightInputValue"
                placeholder="Weight in kg"
                step="0.1"
                min="0"
              />
              <button class="btn-primary btn-sm" [class.loading]="savingWeight()" (click)="saveWeight()">
                {{ weightEditMode() ? 'Update' : 'Save' }}
              </button>
              @if (weightEditMode()) {
                <button class="btn-secondary btn-sm" (click)="cancelWeightEdit()">Cancel</button>
              }
            </div>
          }
        </div>
      }

      <!-- Fetch button + unsaved indicator -->
      <div class="toolbar">
        <button
          class="btn-secondary"
          [class.loading]="fetching()"
          [disabled]="fetching()"
          (click)="fetchToday()"
        >
          {{ fetching() ? '⏳ Fetching…' : '🔄 Fetch from GitHub' }}
        </button>
        <button class="btn-secondary btn-sm" (click)="csvImportSvc.open()">📂 Import CSV</button>
        @if (state.hasUnsavedChanges()) {
          <span class="unsaved-indicator">● Unsaved changes</span>
        }
        @if (state.selectMode()) {
          <button class="btn-danger btn-sm" (click)="clearSelection()">✕ Cancel Select</button>
          <button class="btn-primary btn-sm" (click)="onBulkDelete()">🗑️ Delete ({{ selectedCount() }})</button>
        }
        @if (!state.selectMode() && todayEntries().length > 1) {
          <button class="btn-secondary btn-sm" (click)="state.selectMode.set(true)">☑ Select</button>
        }
      </div>

      <!-- CSV Import Modal -->
      <app-csv-import-modal (importEntries)="onCsvImport($event)" />

      <!-- Today's Entries -->
      <div class="entries-section">
        <h3 class="section-title">Today's Entries ({{ todayEntries().length }})</h3>

        @if (todayEntries().length === 0) {
          <div class="empty-state">
            <p>No entries yet today.</p>
            <p class="text-muted">Add an entry above or fetch from GitHub.</p>
          </div>
        }

        @for (item of todayEntries(); track item.globalIdx) {
          <app-entry-card
            [entry]="item.entry"
            mode="tracker"
            [selectMode]="state.selectMode()"
            [isSelected]="state.selectedEntries().has(item.globalIdx)"
            (deleteEntry)="onDeleteEntry(item.globalIdx)"
            (repeatEntry)="onRepeatEntry(item.globalIdx)"
            (saveEdited)="onSaveEdited(item.globalIdx, $event)"
            (toggleSelect)="onToggleSelect(item.globalIdx)"
          />
        }
      </div>
    </div>
  `,
  styles: [`
    .tracker-page { display: flex; flex-direction: column; gap: 14px; padding-bottom: 32px; }
    .form-tabs { display: flex; gap: 8px; }
    .tab-btn { flex: 1; padding: 12px 14px; border: 1.5px solid var(--border); border-radius: 12px; background: var(--card-bg); color: var(--text); font-size: 15px; font-weight: 500; cursor: pointer; transition: all .18s; display: flex; align-items: center; justify-content: center; gap: 6px; -webkit-tap-highlight-color: transparent; }
    .tab-btn.active { background: var(--primary); color: #fff; border-color: var(--primary); font-weight: 600; }
    .weight-badge { background: rgba(255,255,255,0.25); border-radius: 10px; padding: 1px 7px; font-size: 12px; font-weight: 700; }
    .tab-btn:not(.active) .weight-badge { background: var(--primary-light, rgba(0,122,255,.12)); color: var(--primary); }
    .form-panel, .weight-panel { padding: 16px; }
    .weight-saved-row { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
    .weight-label { font-size: 14px; color: var(--text-muted); }
    .weight-value { font-size: 26px; font-weight: 700; color: var(--primary); }
    .weight-input-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .weight-input { flex: 1; min-width: 0; max-width: 180px; font-size: 16px; -webkit-appearance: none; }
    .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .unsaved-indicator { font-size: 12px; color: #f59e0b; font-weight: 600; }
    .section-title { font-size: 15px; font-weight: 600; color: var(--text-muted); margin: 0; }
    .entries-section { display: flex; flex-direction: column; gap: 10px; }
    .empty-state { padding: 28px 16px; text-align: center; color: var(--text-muted); }
    .text-muted { font-size: 13px; color: var(--text-muted); margin-top: 6px; }
    .btn-sm { font-size: 13px; padding: 8px 12px; min-height: 36px; }
  `],
})
export class TrackerComponent implements OnInit {
  readonly state = inject(StateService);
  readonly trackerService = inject(TrackerService);
  private readonly github = inject(GithubApiService);
  private readonly log = inject(LoggingService);
  private readonly notify = inject(NotificationService);
  private readonly config = inject(ConfigService);
  readonly csvImportSvc = inject(CsvImportService);
  private readonly entryPreview = inject(EntryPreviewService);
  private readonly router = inject(Router);

  goHub(): void { this.router.navigate(['/calorie-hub']); }

  readonly activeTab = signal<TrackerTab>('entry');
  readonly fetching = signal(false);
  readonly savingWeight = signal(false);
  weightInputValue = '';

  ngOnInit(): void {
    // Nothing special; data is already in StateService from app init
  }

  setTab(tab: TrackerTab): void {
    this.activeTab.set(tab);
    if (tab === 'weight') {
      const w = this.savedWeight();
      if (w !== null) this.weightInputValue = w.toFixed(1);
    }
  }

  readonly todayEntries = computed(() => {
    const today = getTodayString();
    const all = this.state.entries();
    const result: Array<{ entry: AnyEntry; globalIdx: number }> = [];
    for (let i = 0; i < all.length; i++) {
      const e = all[i];
      const entry = e as Record<string, unknown>;
      const d = (entry['date'] || entry['_sourceDate']) as string | undefined;
      if (d === today && !isWeightEntry(e)) result.push({ entry: e, globalIdx: i });
    }
    return result;
  });

  readonly savedWeight = computed(() => {
    const today = getTodayString();
    const all = this.state.entries();
    for (const e of all) {
      if (!isWeightEntry(e)) continue;
      const entry = e as Record<string, unknown>;
      const d = (entry['date'] || entry['_sourceDate']) as string | undefined;
      if (d !== today) continue;
      const w = entry['weightKg'] !== undefined
        ? Number(entry['weightKg'])
        : entry['weight'] !== undefined ? Number(entry['weight']) : NaN;
      if (!isNaN(w)) return Math.round(w * 10) / 10;
    }
    return null;
  });

  readonly weightEditMode = this.state.weightEditMode;

  readonly selectedCount = computed(() => this.state.selectedEntries().size);

  enableWeightEdit(): void {
    this.state.weightEditMode.set(true);
    const w = this.savedWeight();
    if (w !== null) this.weightInputValue = w.toFixed(1);
  }

  cancelWeightEdit(): void {
    this.state.weightEditMode.set(false);
  }

  async saveWeight(): Promise<void> {
    const raw = parseFloat(this.weightInputValue);
    if (!isFinite(raw)) { this.notify.showNotification('Enter a valid numeric weight', 'error'); return; }
    const rounded = Math.round(raw * 10) / 10;
    const dateStr = getTodayString();
    this.savingWeight.set(true);
    try {
      // Legacy behavior: weight = 0 removes any existing weight entry for today
      if (rounded === 0) {
        const all = this.state.entries();
        const idx = all.findIndex(e => {
          if (!isWeightEntry(e)) return false;
          const entry = e as Record<string, unknown>;
          const d = (entry['date'] || entry['_sourceDate']) as string | undefined;
          return d === dateStr;
        });
        if (idx !== -1) {
          const ok = await this.trackerService.deleteEntryDirect(idx);
          if (ok) {
            this.notify.showNotification('Weight removed', 'write');
            this.weightInputValue = '';
            this.state.weightEditMode.set(false);
          } else {
            this.notify.showNotification('Failed to remove weight', 'error');
          }
        } else {
          this.notify.showNotification('No weight to remove', 'info');
        }
        return;
      }

      const existing = this.savedWeight();
      if (existing !== null && this.state.weightEditMode()) {
        // Update existing weight entry
        const all = this.state.entries();
        const idx = all.findIndex(e => {
          if (!isWeightEntry(e)) return false;
          const entry = e as Record<string, unknown>;
          const d = (entry['date'] || entry['_sourceDate']) as string | undefined;
          return d === dateStr;
        });
        if (idx !== -1) {
          const updated = { ...(all[idx] as Record<string, unknown>), weightKg: rounded } as AnyEntry;
          const ok = await this.trackerService.editEntry(idx, updated);
          if (ok) {
            this.notify.showNotification('Weight updated', 'write');
            this.state.weightEditMode.set(false);
          } else {
            this.notify.showNotification('Failed to update weight', 'error');
          }
        }
      } else if (existing === null) {
        // Create new weight entry
        const entry: AnyEntry = {
          _meta: 'dailyWeight',
          weightKg: rounded,
          timestamp: new Date().toISOString(),
          date: dateStr,
          _sourceDate: dateStr,
        } as unknown as AnyEntry;
        const ok = await this.trackerService.addEntry(entry);
        if (ok) {
          this.notify.showNotification('Weight saved', 'write');
          this.weightInputValue = '';
        } else {
          this.notify.showNotification('Failed to save weight', 'error');
        }
      } else {
        // Already saved, no edit mode — noop
        this.notify.showNotification('No weight change', 'info');
      }
    } finally {
      this.savingWeight.set(false);
    }
  }

  async fetchToday(): Promise<void> {
    this.fetching.set(true);
    try {
      await this.github.fetchFromGit(true);
      // fetchFromGit() populates state.entries directly via signals
    } catch (err) {
      this.log.dbg('Fetch error: ' + String(err), 'error');
      this.notify.showNotification('Fetch failed — see logs', 'error');
    } finally {
      this.fetching.set(false);
    }
  }

  async onEntryAdded(entry: AnyEntry): Promise<void> {
    await this.trackerService.addEntry(entry);
  }

  async onDeleteEntry(globalIdx: number): Promise<void> {
    await this.trackerService.deleteEntry(globalIdx);
  }

  async onRepeatEntry(globalIdx: number): Promise<void> {
    const entries = this.state.entries();
    const original = entries[globalIdx];
    if (!original) return;
    const edited = await this.entryPreview.prompt(original, 'Repeat Entry', 'Add to Today');
    if (!edited) return;
    await this.trackerService.addEntry(edited);
  }

  async onSaveEdited(globalIdx: number, updated: AnyEntry): Promise<void> {
    await this.trackerService.editEntry(globalIdx, updated);
  }

  onToggleSelect(globalIdx: number): void {
    this.state.selectedEntries.update(sel => {
      const next = new Set(sel);
      if (next.has(globalIdx)) next.delete(globalIdx);
      else next.add(globalIdx);
      return next;
    });
  }

  clearSelection(): void {
    this.state.selectMode.set(false);
    this.state.selectedEntries.set(new Set());
  }

  async onBulkDelete(): Promise<void> {
    const indices = Array.from(this.state.selectedEntries());
    await this.trackerService.bulkDelete(indices);
  }

  async onCsvImport(importedEntries: CsvImportEntry[]): Promise<void> {
    let imported = 0;
    for (const raw of importedEntries) {
      const entry: AnyEntry = {
        timestamp: raw.timestamp || new Date().toISOString(),
        date: raw.date,
        food: raw.food,
        calories: raw.calories,
        time: raw.time,
        ...(raw.protein != null ? { protein: raw.protein } : {}),
        ...(raw.carbs   != null ? { carbs:   raw.carbs   } : {}),
        ...(raw.fat     != null ? { fat:     raw.fat     } : {}),
        ...(raw.healthScore != null ? { healthScore: raw.healthScore } : {}),
      } as unknown as AnyEntry;
      const ok = await this.trackerService.addEntry(entry);
      if (ok) imported++;
    }
    this.notify.showNotification(`Imported ${imported} of ${importedEntries.length} entries`, 'success');
  }
}
