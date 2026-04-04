import { Component, inject, signal, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { WorkoutGithubApiService } from '../../../core/services/workout-github-api.service';
import { NotificationService } from '../../../core/services/notification.service';
import { BodyMeasurement } from '../../../core/models/body-measurement.model';
import { getTodayString } from '../../../shared/utils/date.utils';
import { generateUUID } from '../../../shared/utils/uuid.utils';

@Component({
  selector: 'app-measurements',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="meas-page">
      <div class="page-header">
        <button class="hub-back-btn" (click)="goHub()">← Hub</button>
        <h2 class="page-title">Body Measurements</h2>
        <button class="btn-primary btn-sm" (click)="openForm()">+ Log</button>
      </div>

      @if (loading()) {
        <div class="loading-state card"><p>Loading…</p></div>
      }

      <!-- Log form -->
      @if (formOpen()) {
        <div class="form-card card">
          <h3>{{ editId ? 'Edit Entry' : 'New Entry' }}</h3>
          <div class="field-row">
            <div class="field">
              <label class="field-label">Date</label>
              <input type="date" class="form-input" [(ngModel)]="form.date" />
            </div>
          </div>
          <div class="field-row two-col">
            <div class="field">
              <label class="field-label">Weight (kg)</label>
              <input type="number" class="form-input" [(ngModel)]="form.weightKg" min="0" step="0.1" placeholder="—" />
            </div>
            <div class="field">
              <label class="field-label">Body Fat (%)</label>
              <input type="number" class="form-input" [(ngModel)]="form.bodyFatPct" min="0" step="0.1" placeholder="—" />
            </div>
          </div>
          <div class="field-row two-col">
            <div class="field">
              <label class="field-label">Chest (cm)</label>
              <input type="number" class="form-input" [(ngModel)]="form.chestCm" min="0" step="0.5" placeholder="—" />
            </div>
            <div class="field">
              <label class="field-label">Waist (cm)</label>
              <input type="number" class="form-input" [(ngModel)]="form.waistCm" min="0" step="0.5" placeholder="—" />
            </div>
          </div>
          <div class="field-row two-col">
            <div class="field">
              <label class="field-label">Hips (cm)</label>
              <input type="number" class="form-input" [(ngModel)]="form.hipsCm" min="0" step="0.5" placeholder="—" />
            </div>
            <div class="field">
              <label class="field-label">Bicep (cm)</label>
              <input type="number" class="form-input" [(ngModel)]="form.bicepCm" min="0" step="0.5" placeholder="—" />
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label class="field-label">Thigh (cm)</label>
              <input type="number" class="form-input" [(ngModel)]="form.thighCm" min="0" step="0.5" placeholder="—" />
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label class="field-label">Notes</label>
              <textarea class="form-input notes-input" [(ngModel)]="form.notes" placeholder="Optional notes…" rows="2"></textarea>
            </div>
          </div>
          <div class="btn-row">
            <button class="btn-primary" [class.loading]="saving()" (click)="save()">{{ saving() ? '⏳ Saving…' : '💾 Save' }}</button>
            <button class="btn-secondary" (click)="closeForm()">Cancel</button>
          </div>
        </div>
      }

      <!-- Entries list -->
      @if (!loading() && measurements().length === 0) {
        <div class="empty-state card">
          <div class="empty-icon">📏</div>
          <p>No measurements yet.</p>
          <p class="text-muted">Tap + Log to record your first measurement.</p>
        </div>
      }

      @for (m of sortedMeasurements(); track m.date) {
        <div class="meas-card card">
          <div class="meas-header">
            <span class="meas-date">{{ m.date }}</span>
            <div class="meas-actions">
              <button class="btn-ghost btn-xs" (click)="startEdit(m)">✏️</button>
              <button class="btn-ghost btn-xs danger-btn" (click)="deleteEntry(m)">🗑️</button>
            </div>
          </div>
          <div class="meas-chips">
            @if (m.weightKg != null) { <span class="chip">⚖️ {{ m.weightKg }} kg</span> }
            @if (m.bodyFatPct != null) { <span class="chip">🔥 {{ m.bodyFatPct }}% fat</span> }
            @if (m.chestCm != null) { <span class="chip">💪 chest {{ m.chestCm }} cm</span> }
            @if (m.waistCm != null) { <span class="chip">waist {{ m.waistCm }} cm</span> }
            @if (m.hipsCm != null) { <span class="chip">hips {{ m.hipsCm }} cm</span> }
            @if (m.bicepCm != null) { <span class="chip">bicep {{ m.bicepCm }} cm</span> }
            @if (m.thighCm != null) { <span class="chip">thigh {{ m.thighCm }} cm</span> }
          </div>
          @if (m.notes) {
            <p class="meas-notes">{{ m.notes }}</p>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .meas-page { display: flex; flex-direction: column; gap: 14px; padding-bottom: 32px; }
    .page-header { display: flex; align-items: center; gap: 12px; }
    .page-title { font-size: 20px; font-weight: 700; margin: 0; flex: 1; }
    .loading-state { padding: 24px; text-align: center; color: var(--text-muted); }
    .form-card { padding: 18px; display: flex; flex-direction: column; gap: 12px; }
    .form-card h3 { font-size: 16px; font-weight: 700; margin: 0; }
    .field-row { display: flex; flex-direction: column; gap: 6px; }
    .field-row.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .field { display: flex; flex-direction: column; gap: 4px; }
    .field-label { font-size: 12px; font-weight: 600; color: var(--text-muted); }
    .form-input { padding: 9px 12px; border: 1.5px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--text); font-size: 14px; width: 100%; box-sizing: border-box; }
    .form-input:focus { outline: none; border-color: var(--primary); }
    .notes-input { resize: vertical; font-family: inherit; }
    .btn-row { display: flex; gap: 10px; }
    .btn-sm { font-size: 13px; padding: 8px 14px; }
    .btn-xs { font-size: 12px; padding: 4px 8px; min-height: 28px; }
    .btn-ghost { background: var(--surface-2); border: 1.5px solid var(--border); border-radius: 8px; cursor: pointer; color: var(--text); font-weight: 600; }
    .danger-btn { color: var(--danger); border-color: transparent; }
    .empty-state { padding: 36px 24px; text-align: center; }
    .empty-icon { font-size: 40px; margin-bottom: 10px; }
    .empty-state p { margin: 0 0 6px; color: var(--text); font-size: 16px; font-weight: 600; }
    .text-muted { font-size: 13px; color: var(--text-muted) !important; font-weight: 400 !important; }
    .meas-card { padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
    .meas-header { display: flex; align-items: center; justify-content: space-between; }
    .meas-date { font-size: 16px; font-weight: 700; }
    .meas-actions { display: flex; gap: 6px; }
    .meas-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { background: var(--surface-2); border-radius: 10px; padding: 3px 9px; font-size: 12px; color: var(--text); }
    .meas-notes { font-size: 13px; color: var(--text-muted); margin: 0; font-style: italic; }
  `],
})
export class MeasurementsComponent implements OnInit {
  private readonly workoutGithub = inject(WorkoutGithubApiService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly formOpen = signal(false);
  readonly measurements = signal<BodyMeasurement[]>([]);

  readonly sortedMeasurements = computed(() =>
    this.measurements().slice().sort((a, b) => b.date.localeCompare(a.date))
  );

  form: Partial<BodyMeasurement> = {};
  editId: string | null = null;

  async ngOnInit(): Promise<void> {
    const data = await this.workoutGithub.loadMeasurements();
    this.measurements.set(data);
    this.loading.set(false);
  }

  goHub(): void { this.router.navigate(['/workout/hub']); }

  openForm(): void {
    this.editId = null;
    this.form = { date: getTodayString() };
    this.formOpen.set(true);
  }

  closeForm(): void {
    this.formOpen.set(false);
    this.editId = null;
  }

  startEdit(m: BodyMeasurement): void {
    this.editId = m.date;
    this.form = { ...m };
    this.formOpen.set(true);
  }

  async save(): Promise<void> {
    if (!this.form.date) { this.notify.showNotification('Date required', 'error'); return; }
    this.saving.set(true);
    try {
      const all = this.measurements().slice();
      const entry: BodyMeasurement = {
        date: this.form.date,
        weightKg: this.form.weightKg ?? undefined,
        bodyFatPct: this.form.bodyFatPct ?? undefined,
        chestCm: this.form.chestCm ?? undefined,
        waistCm: this.form.waistCm ?? undefined,
        hipsCm: this.form.hipsCm ?? undefined,
        bicepCm: this.form.bicepCm ?? undefined,
        thighCm: this.form.thighCm ?? undefined,
        notes: this.form.notes?.trim() || undefined,
        createdAt: new Date().toISOString(),
      };
      if (this.editId) {
        const idx = all.findIndex(m => m.date === this.editId);
        if (idx !== -1) all[idx] = entry; else all.push(entry);
      } else {
        const existing = all.findIndex(m => m.date === entry.date);
        if (existing !== -1) all[existing] = entry; else all.push(entry);
      }
      const ok = await this.workoutGithub.saveMeasurements(all);
      if (ok) {
        this.measurements.set(all);
        this.notify.showNotification('Measurement saved', 'success');
        this.closeForm();
      }
    } finally {
      this.saving.set(false);
    }
  }

  async deleteEntry(m: BodyMeasurement): Promise<void> {
    const updated = this.measurements().filter(x => x.date !== m.date);
    const ok = await this.workoutGithub.saveMeasurements(updated);
    if (ok) {
      this.measurements.set(updated);
      this.notify.showNotification('Entry deleted', 'delete');
    }
  }
}
