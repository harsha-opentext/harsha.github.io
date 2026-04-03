import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CsvExportService } from './csv-export.service';

@Component({
  selector: 'app-csv-export-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (svc.state().open) {
      <div class="modal-backdrop" (click)="onBackdropClick($event)">
        <div class="modal-box">
          <h3>Export CSV</h3>
          <p>{{ svc.state().count }} entries ready to export.</p>
          <textarea class="csv-preview" readonly>{{ svc.state().csv }}</textarea>
          <div class="modal-actions">
            <button class="btn-primary" (click)="svc.download()">⬇ Download</button>
            <button class="btn-secondary" (click)="copy()">📋 Copy</button>
            <button class="btn-secondary" (click)="svc.close()">Close</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .modal-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.5);
      display: flex; align-items: center; justify-content: center; z-index: 10000;
    }
    .modal-box {
      background: var(--card-bg); border-radius: 14px; padding: 24px;
      max-width: 540px; width: 90%; box-shadow: 0 20px 40px rgba(0,0,0,0.3);
    }
    h3 { margin: 0 0 12px; color: var(--text); }
    p { color: var(--text-muted); }
    .csv-preview { width: 100%; height: 160px; resize: vertical; font-size: 12px; margin-bottom: 16px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 8px; }
    .modal-actions { display: flex; gap: 10px; flex-wrap: wrap; }
    .btn-primary { background: #007aff; color: white; border: none; padding: 10px 18px; border-radius: 10px; cursor: pointer; font-weight: 600; }
    .btn-secondary { background: var(--card-bg); color: var(--text); border: 1px solid var(--border); padding: 10px 18px; border-radius: 10px; cursor: pointer; }
  `],
})
export class CsvExportModalComponent {
  readonly svc = inject(CsvExportService);

  onBackdropClick(e: Event): void {
    if (e.target === e.currentTarget) this.svc.close();
  }

  async copy(): Promise<void> {
    try {
      await this.svc.copyToClipboard();
    } catch { /* ignore */ }
  }
}
