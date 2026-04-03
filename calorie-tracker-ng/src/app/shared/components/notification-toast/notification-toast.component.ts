import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NotificationService, Toast } from '../../../core/services/notification.service';

@Component({
  selector: 'app-notification-toast',
  standalone: true,
  imports: [CommonModule],
  template: `
    <!-- Full toasts -->
    <div class="toast-container">
      @for (toast of notify.toasts(); track toast.id; let i = $index) {
        <div
          class="gt-notification"
          [class]="'gt-notification--' + toast.type"
          [style.top.px]="16 + i * 56"
          (click)="notify.removeToast(toast.id)"
        >
          {{ toast.message }}
        </div>
      }
    </div>
    <!-- Compact dots (when toasts are disabled) -->
    <div class="dot-container">
      @for (dot of notify.dots(); track dot.id; let i = $index) {
        <div
          class="gt-notification-dot"
          [style.background]="dot.color"
          [style.top.px]="16 + i * 20"
          [title]="dot.title"
          [attr.aria-label]="dot.title"
        ></div>
      }
    </div>
  `,
  styles: [`
    .toast-container { position: fixed; top: 0; right: 16px; z-index: 10001; pointer-events: none; }
    .gt-notification {
      position: fixed; right: 16px; background: var(--card-bg); color: var(--text);
      padding: 10px 14px; border-radius: 10px; box-shadow: 0 6px 20px rgba(0,0,0,0.12);
      font-size: 13px; font-weight: 600; opacity: 1; cursor: pointer; pointer-events: auto;
      transition: opacity 0.25s; min-width: 200px; max-width: 320px;
    }
    .gt-notification--error, .gt-notification--delete {
      background: #ff3b30; color: #fff;
    }
    .gt-notification--write, .gt-notification--success {
      background: linear-gradient(90deg, #34c759 0%, #30d158 100%); color: #fff;
    }
    .gt-notification--read {
      background: #007aff; color: #fff;
    }
    /* Compact dots */
    .dot-container { position: fixed; top: 0; right: 16px; z-index: 10001; pointer-events: none; }
    .gt-notification-dot {
      position: fixed; right: 16px; width: 10px; height: 10px;
      border-radius: 50%; opacity: 1; transition: opacity .3s;
      box-shadow: 0 1px 4px rgba(0,0,0,0.25);
    }
  `],
})
export class NotificationToastComponent {
  readonly notify = inject(NotificationService);
}
