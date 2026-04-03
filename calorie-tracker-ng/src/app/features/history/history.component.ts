import { Component, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { StateService } from '../../core/services/state.service';
import { HistoryService, HISTORY_PAGE_SIZE, GroupedDate } from './history.service';
import { GithubApiService } from '../../core/services/github-api.service';
import { NotificationService } from '../../core/services/notification.service';
import { ConfigService } from '../../core/services/config.service';
import { TrackerService } from '../tracker/tracker.service';
import { AnyEntry } from '../../core/models/entry.model';
import { getTodayString } from '../../shared/utils/date.utils';
import { FormatDateReadablePipe } from '../../shared/pipes/format-date.pipe';
import { EntryCardComponent } from '../tracker/components/entry-card/entry-card.component';
import { WeightGraphModalComponent } from './components/weight-graph-modal/weight-graph-modal.component';
import { EntryPreviewService } from '../../shared/components/entry-preview-modal/entry-preview.service';

@Component({
  selector: 'app-history',
  standalone: true,
  imports: [
    CommonModule, FormsModule, FormatDateReadablePipe,
    EntryCardComponent, WeightGraphModalComponent,
  ],
  template: `
    <div class="history-page">
      <!-- Stats header -->
      <div class="stats-bar card">
        <div class="stat-item">
          <span class="stat-val">{{ histSvc.stats().totalEntries }}</span>
          <span class="stat-label">Entries</span>
        </div>
        <div class="stat-item">
          <span class="stat-val">{{ histSvc.stats().totalCalories | number }}</span>
          <span class="stat-label">Total Cal</span>
        </div>
        <div class="stat-item">
          <span class="stat-val">{{ histSvc.stats().avgCaloriesPerDay }}</span>
          <span class="stat-label">Avg/Day</span>
        </div>
        <div class="stat-item">
          <span class="stat-val">{{ histSvc.stats().avgProtein }}g</span>
          <span class="stat-label">Avg Protein</span>
        </div>
        <div class="stat-item">
          <span class="stat-val">{{ histSvc.stats().avgCarbs }}g</span>
          <span class="stat-label">Avg Carbs</span>
        </div>
        <div class="stat-item">
          <span class="stat-val">{{ histSvc.stats().avgFat }}g</span>
          <span class="stat-label">Avg Fat</span>
        </div>
      </div>

      <!-- Filters -->
      <div class="filter-row card">
        <select class="form-input" [(ngModel)]="histSvc.rangePreset" (ngModelChange)="onPresetChange($event)">
          <option value="all">All time</option>
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="7">Last 7 days</option>
          <option value="14">Last 14 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="custom">Custom range</option>
        </select>
        @if (histSvc.rangePreset() === 'custom') {
          <input type="date" class="form-input" [(ngModel)]="customStart" (ngModelChange)="onCustomRange()" />
          <span class="sep">→</span>
          <input type="date" class="form-input" [(ngModel)]="customEnd" (ngModelChange)="onCustomRange()" />
        }
        <input
          type="text"
          class="form-input food-filter"
          placeholder="🔍 Filter by food…"
          [ngModel]="state.historyFoodFilter()"
          (ngModelChange)="state.historyFoodFilter.set($event)"
        />
      </div>

      <!-- Toolbar: select, weight graph -->
      <div class="toolbar">
        @if (isRangeView()) {
          <button class="btn-secondary" (click)="showWeightGraph.set(true)">📈 Weight Graph</button>
        }
        @if (!state.historySelectMode() && histSvc.filteredEntries().length > 1) {
          <button class="btn-secondary btn-sm" (click)="state.historySelectMode.set(true)">☑ Select</button>
        }
        @if (state.historySelectMode()) {
          <button class="btn-secondary btn-sm" (click)="clearSelection()">✕ Cancel</button>
          <button class="btn-danger btn-sm" (click)="onBulkDelete()">🗑️ Delete ({{ selectedCount() }})</button>
        }
        @if (state.historyFetchInProgress()) {
          <span class="loading-text">⏳ Fetching…</span>
        }
      </div>

      <!-- Date groups -->
      @if (histSvc.pagedDates().length === 0 && !state.historyFetchInProgress()) {
        <div class="empty-state card">
          <p>No entries found for the selected date range.</p>
          @if (!state.dateRangeStart() && !state.dateRangeEnd()) {
            <p class="text-muted">Select a date range above or add entries on the Tracker page.</p>
          }
        </div>
      }

      @for (group of histSvc.pagedDates(); track group.dateStr) {
        <div class="date-group">
          <div class="date-group-header" [class.collapsible]="useCollapsible()" (click)="useCollapsible() ? toggleGroup(group.dateStr) : null">
            <div class="date-header-left">
              @if (useCollapsible()) {
                <span class="chevron" [class.expanded]="isExpanded(group.dateStr)">›</span>
              }
              <span class="date-label">{{ group.dateStr | formatDateReadable }}</span>
              <span class="entry-count">({{ group.entries.length }})</span>
              @if (group.weight !== null) {
                <span class="weight-badge">⚖️ {{ group.weight | number: '1.1-1' }} kg</span>
              }
            </div>
            @if (!useCollapsible() && canEditWeight(group.dateStr)) {
              <button class="btn-secondary btn-sm" (click)="openWeightEdit(group.dateStr, group.weight)">
                {{ group.weight !== null ? 'Edit weight' : 'Add weight' }}
              </button>
            }
            @if (useCollapsible() && isExpanded(group.dateStr) && canEditWeight(group.dateStr)) {
              <button class="btn-secondary btn-sm" (click)="$event.stopPropagation(); openWeightEdit(group.dateStr, group.weight)">
                {{ group.weight !== null ? 'Edit weight' : 'Add weight' }}
              </button>
            }
          </div>
          @if (!useCollapsible() || isExpanded(group.dateStr)) {
            @for (item of group.entries; track item.globalIdx) {
              <app-entry-card
                [entry]="item.entry"
                mode="history"
                [selectMode]="state.historySelectMode()"
                [isSelected]="state.historySelectedEntries().has(item.globalIdx)"
                (deleteEntry)="onDeleteEntry(item.globalIdx)"
                (addToToday)="onAddToToday(item.globalIdx)"
                (saveEdited)="onSaveEdited(item.globalIdx, $event)"
                (toggleSelect)="onToggleSelect(item.globalIdx)"
              />
            }
          }
        </div>
      }

      <!-- Pagination -->
      @if (histSvc.totalPages() > 1) {
        <div class="pagination">
          <button class="btn-secondary btn-sm" [disabled]="state.historyPage() <= 1" (click)="changePage(-1)">← Prev</button>
          <span class="page-info">{{ state.historyPage() }} / {{ histSvc.totalPages() }}</span>
          <button class="btn-secondary btn-sm" [disabled]="state.historyPage() >= histSvc.totalPages()" (click)="changePage(1)">Next →</button>
        </div>
      }
    </div>

    <!-- Weight edit inline panel -->
    @if (weightEditOpen()) {
      <div class="weight-edit-panel card">
        <div class="weight-edit-header">
          <span>Edit weight for {{ weightEditDate() }}</span>
          <button class="modal-close" (click)="closeWeightEdit()">✕</button>
        </div>
        <div class="weight-edit-row">
          <input type="number" class="form-input" [(ngModel)]="weightEditValue" step="0.1" min="0" placeholder="Weight in kg" />
          <button class="btn-primary btn-sm" [class.loading]="savingWeight()" (click)="saveWeightEdit()">Save</button>
        </div>
      </div>
    }

    <!-- Weight graph modal -->
    @if (showWeightGraph()) {
      <app-weight-graph-modal
        [data]="histSvc.weightDataForGraph()"
        (close)="showWeightGraph.set(false)"
      />
    }
  `,
  styles: [`
    .history-page { display: flex; flex-direction: column; gap: 14px; padding-bottom: 32px; }
    .stats-bar { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; padding: 14px; }
    .stat-item { text-align: center; }
    .stat-val { display: block; font-size: 18px; font-weight: 700; color: var(--primary); }
    .stat-label { display: block; font-size: 11px; color: var(--text-muted); }
    .filter-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 14px; }
    .form-input { padding: 9px 12px; border: 1.5px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--text); font-size: 14px; }
    .food-filter { flex: 1; min-width: 160px; }
    .sep { color: var(--text-muted); }
    .toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .loading-text { font-size: 13px; color: var(--text-muted); }
    .date-group { display: flex; flex-direction: column; gap: 8px; }
    .date-group-header { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; }
    .date-group-header.collapsible { cursor: pointer; user-select: none; border-radius: 6px; padding: 6px 4px; margin: 0 -4px; }
    .date-group-header.collapsible:hover { background: var(--hover-bg, rgba(0,0,0,0.04)); }
    .chevron { display: inline-block; font-size: 18px; line-height: 1; color: var(--text-muted); transform: rotate(0deg); transition: transform 0.2s ease; }
    .chevron.expanded { transform: rotate(90deg); }
    .date-header-left { display: flex; align-items: center; gap: 8px; }
    .date-label { font-weight: 700; font-size: 15px; }
    .entry-count { font-size: 13px; color: var(--text-muted); }
    .weight-badge { font-size: 12px; background: var(--primary-light, #e8f0fe); color: var(--primary); border-radius: 8px; padding: 2px 8px; }
    .empty-state { padding: 24px; text-align: center; color: var(--text-muted); }
    .text-muted { font-size: 13px; color: var(--text-muted); margin-top: 4px; }
    .pagination { display: flex; align-items: center; gap: 12px; justify-content: center; }
    .page-info { font-size: 14px; color: var(--text-muted); }
    .weight-edit-panel { padding: 16px; position: sticky; bottom: 16px; z-index: 100; box-shadow: 0 4px 20px rgba(0,0,0,.12); }
    .weight-edit-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; font-weight: 600; }
    .weight-edit-row { display: flex; gap: 10px; align-items: center; }
    .modal-close { background: none; border: none; font-size: 16px; cursor: pointer; color: var(--text-muted); }
    .btn-sm { font-size: 13px; padding: 7px 12px; }
  `],
})
export class HistoryComponent {
  readonly state = inject(StateService);
  readonly histSvc = inject(HistoryService);
  private readonly trackerSvc = inject(TrackerService);
  private readonly notify = inject(NotificationService);
  private readonly config = inject(ConfigService);
  private readonly entryPreview = inject(EntryPreviewService);

  readonly showWeightGraph = signal(false);
  readonly weightEditOpen = signal(false);
  readonly weightEditDate = signal<string | null>(null);
  readonly savingWeight = signal(false);
  weightEditValue = '';
  customStart = '';
  customEnd = '';

  readonly selectedCount = computed(() => this.state.historySelectedEntries().size);

  readonly isRangeView = computed(() => {
    const start = this.state.dateRangeStart();
    const end = this.state.dateRangeEnd();
    return !!(start && end && start !== end);
  });

  // Collapsible date groups
  private expandedDates = signal<Set<string>>(new Set<string>());
  readonly useCollapsible = computed(() => {
    const p = this.histSvc.rangePreset();
    return p !== 'today' && p !== 'yesterday';
  });

  isExpanded(dateStr: string): boolean {
    return this.expandedDates().has(dateStr);
  }

  toggleGroup(dateStr: string): void {
    const current = this.expandedDates();
    const next = new Set(current);
    if (next.has(dateStr)) {
      next.delete(dateStr);
    } else {
      next.add(dateStr);
    }
    this.expandedDates.set(next);
  }

  private initExpandedDates(): void {
    const dates = this.histSvc.pagedDates();
    const first = dates.length > 0 ? dates[0].dateStr : null;
    this.expandedDates.set(first ? new Set([first]) : new Set());
  }

  onPresetChange(preset: string): void {
    if (preset !== 'custom') {
      this.state.historyUsingCalendar.set(false);
      this.histSvc.setRangePreset(preset);
      this.initExpandedDates();
    }
  }

  onCustomRange(): void {
    if (this.customStart && this.customEnd) {
      this.histSvc.setCustomRange(this.customStart, this.customEnd);
    }
  }

  changePage(delta: number): void {
    const curr = this.state.historyPage();
    const next = Math.max(1, Math.min(this.histSvc.totalPages(), curr + delta));
    this.state.historyPage.set(next);
    this.initExpandedDates();
  }

  canEditWeight(dateStr: string): boolean {
    return dateStr === getTodayString() || !!this.config.getConfig('allowEditOlderWeights');
  }

  openWeightEdit(dateStr: string, currentWeight: number | null): void {
    this.weightEditDate.set(dateStr);
    this.weightEditValue = currentWeight !== null ? String(currentWeight) : '';
    this.weightEditOpen.set(true);
  }

  closeWeightEdit(): void {
    this.weightEditOpen.set(false);
    this.weightEditDate.set(null);
  }

  async saveWeightEdit(): Promise<void> {
    const dateStr = this.weightEditDate();
    if (!dateStr) return;
    const raw = parseFloat(this.weightEditValue);
    if (!isFinite(raw)) { this.notify.showNotification('Enter a valid weight', 'error'); return; }
    this.savingWeight.set(true);
    try {
      const ok = await this.histSvc.editWeightForDate(dateStr, raw);
      if (ok) {
        this.notify.showNotification('Weight saved', 'write');
        this.closeWeightEdit();
      } else {
        this.notify.showNotification('Failed to save weight', 'error');
      }
    } finally {
      this.savingWeight.set(false);
    }
  }

  async onDeleteEntry(globalIdx: number): Promise<void> {
    await this.histSvc.deleteEntry(globalIdx);
  }

  async onAddToToday(globalIdx: number): Promise<void> {
    const entries = this.state.entries();
    const original = entries[globalIdx];
    if (!original) return;
    const edited = await this.entryPreview.prompt(original, 'Add to Today', 'Add to Today');
    if (!edited) return;
    await this.trackerSvc.addEntry(edited);
  }

  async onSaveEdited(globalIdx: number, updated: AnyEntry): Promise<void> {
    await this.trackerSvc.editEntry(globalIdx, updated);
  }

  onToggleSelect(globalIdx: number): void {
    this.state.historySelectedEntries.update(sel => {
      const next = new Set(sel);
      if (next.has(globalIdx)) next.delete(globalIdx);
      else next.add(globalIdx);
      return next;
    });
  }

  clearSelection(): void {
    this.state.historySelectMode.set(false);
    this.state.historySelectedEntries.set(new Set());
  }

  async onBulkDelete(): Promise<void> {
    const indices = Array.from(this.state.historySelectedEntries());
    await this.histSvc.bulkDelete(indices);
  }
}
