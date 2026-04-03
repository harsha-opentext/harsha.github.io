import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConfirmService } from './confirm.service';

@Component({
  selector: 'app-confirm-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (svc.state().open) {
      <div class="modal-backdrop" (click)="onBackdropClick($event)">
        <div class="modal-box" role="dialog" aria-modal="true">
          <h3 id="confirm-title">{{ svc.state().title }}</h3>
          <p id="confirm-message">{{ svc.state().message }}</p>
          @if (svc.state().details) {
            <div id="confirm-details" [innerHTML]="svc.state().details"></div>
          }
          <div class="modal-actions">
            <button
              class="btn-danger"
              [disabled]="svc.state().yesDisabled"
              (click)="svc.confirm()"
            >{{ svc.state().yesLabel }}</button>
            <button
              class="btn-secondary"
              [disabled]="svc.state().noDisabled"
              (click)="svc.cancel()"
            >Cancel</button>
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
      max-width: 480px; width: 90%; box-shadow: 0 20px 40px rgba(0,0,0,0.3);
      max-height: 80vh; overflow-y: auto;
    }
    h3 { margin: 0 0 12px; font-size: 18px; color: var(--text); }
    p { margin: 0 0 16px; color: var(--text); }
    #confirm-details { margin-bottom: 16px; font-size: 13px; max-height: 200px; overflow-y: auto; }
    .modal-actions { display: flex; gap: 10px; justify-content: flex-end; }
    .btn-danger { background: #ff3b30; color: white; border: none; padding: 10px 18px; border-radius: 10px; cursor: pointer; font-weight: 600; }
    .btn-danger:disabled { opacity: 0.6; cursor: not-allowed; }
    .btn-secondary { background: var(--card-bg); color: var(--text); border: 1px solid var(--border); padding: 10px 18px; border-radius: 10px; cursor: pointer; }
    .btn-secondary:disabled { opacity: 0.6; cursor: not-allowed; }
  `],
})
export class ConfirmModalComponent {
  readonly svc = inject(ConfirmService);

  onBackdropClick(e: Event): void {
    if (e.target === e.currentTarget) this.svc.cancel();
  }
}
