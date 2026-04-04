import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FeedbackService } from '../../../core/services/feedback.service';

@Component({
  selector: 'app-feedback-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (svc.open()) {
      <div class="feedback-overlay" (click)="onOverlayClick($event)">
        <div class="feedback-modal" role="dialog" aria-label="Send Feedback">

          @if (svc.submitted()) {
            <div class="submitted-view">
              <div class="submitted-icon">🎉</div>
              <p class="submitted-text">Thanks for your feedback!</p>
            </div>
          } @else {
            <div class="modal-header">
              <h3 class="modal-title">Send Feedback</h3>
              <button class="close-btn" (click)="svc.closeModal()">✕</button>
            </div>
            <div class="modal-body">
              <p class="modal-hint">Rate your experience:</p>
              <div class="star-row">
                @for (r of starValues; track r) {
                  <button
                    class="star-btn"
                    [class.lit]="localRating !== null && r <= localRating"
                    (click)="localRating = r"
                    [attr.aria-label]="r + ' star'"
                  >★</button>
                }
              </div>
              <textarea
                class="feedback-textarea"
                [(ngModel)]="localComments"
                placeholder="Optional: what could we improve?"
                rows="3"
              ></textarea>
            </div>
            <div class="modal-footer">
              <button class="btn-secondary" (click)="svc.closeModal()">Cancel</button>
              <button class="btn-primary" [disabled]="localRating === null" (click)="submit()">Submit</button>
            </div>
          }

        </div>
      </div>
    }
  `,
  styles: [`
    .feedback-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.55); display: flex; align-items: flex-end; justify-content: center; z-index: 300; }
    .feedback-modal { background: var(--card-bg); border-radius: 20px 20px 0 0; width: 100%; max-width: 480px; padding-bottom: env(safe-area-inset-bottom, 12px); }
    .modal-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px 10px; }
    .modal-title { font-size: 17px; font-weight: 700; margin: 0; }
    .close-btn { background: none; border: none; font-size: 20px; color: var(--text-muted); cursor: pointer; padding: 4px 8px; }
    .modal-body { padding: 0 18px 12px; display: flex; flex-direction: column; gap: 12px; }
    .modal-hint { font-size: 14px; color: var(--text-muted); margin: 0; }
    .star-row { display: flex; gap: 8px; }
    .star-btn { background: none; border: none; font-size: 32px; cursor: pointer; color: var(--border); padding: 0; transition: color .12s; line-height: 1; }
    .star-btn.lit { color: #f59e0b; }
    .feedback-textarea { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1.5px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--text); font-size: 14px; font-family: inherit; resize: vertical; }
    .feedback-textarea:focus { outline: none; border-color: var(--primary); }
    .modal-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 10px 18px 16px; border-top: 1px solid var(--border); }
    .submitted-view { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 40px 18px 48px; }
    .submitted-icon { font-size: 48px; }
    .submitted-text { font-size: 18px; font-weight: 700; color: var(--text); margin: 0; }
  `],
})
export class FeedbackModalComponent {
  readonly svc = inject(FeedbackService);
  readonly starValues = [1, 2, 3, 4, 5] as const;

  localRating: 1 | 2 | 3 | 4 | 5 | null = null;
  localComments = '';

  onOverlayClick(e: Event): void {
    if ((e.target as HTMLElement).classList.contains('feedback-overlay')) {
      this.svc.closeModal();
    }
  }

  submit(): void {
    if (this.localRating !== null) {
      this.svc.submit(this.localRating, this.localComments);
    }
  }
}
