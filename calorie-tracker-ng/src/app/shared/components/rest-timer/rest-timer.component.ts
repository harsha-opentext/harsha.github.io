import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RestTimerService } from '../../../core/services/rest-timer.service';

@Component({
  selector: 'app-rest-timer',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (timer.secondsRemaining() > 0 || timer.active()) {
      <div class="rest-timer-bar" [class.done]="!timer.active() && timer.secondsRemaining() === 0">
        <div class="timer-progress" [style.width.%]="timer.progress()"></div>
        <div class="timer-content">
          <span class="timer-label">Rest</span>
          <span class="timer-time">{{ timer.formattedTime() }}</span>
          <div class="timer-actions">
            @if (timer.active()) {
              <button class="timer-btn" (click)="timer.pause()" title="Pause">⏸</button>
            } @else {
              <button class="timer-btn" (click)="timer.resume()" title="Resume">▶</button>
            }
            <button class="timer-btn" (click)="timer.reset()" title="Dismiss">✕</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .rest-timer-bar {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 150;
      background: var(--card-bg);
      border-top: 2px solid var(--primary);
      overflow: hidden;
    }
    .rest-timer-bar.done {
      border-top-color: var(--success);
    }
    .timer-progress {
      position: absolute;
      top: 0;
      left: 0;
      height: 3px;
      background: var(--primary);
      transition: width 1s linear;
    }
    .done .timer-progress {
      background: var(--success);
    }
    .timer-content {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 16px;
    }
    .timer-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .timer-time {
      font-size: 22px;
      font-weight: 800;
      color: var(--primary);
      font-variant-numeric: tabular-nums;
      flex: 1;
    }
    .done .timer-time {
      color: var(--success);
    }
    .timer-actions {
      display: flex;
      gap: 6px;
    }
    .timer-btn {
      background: var(--surface-2);
      border: 1.5px solid var(--border);
      border-radius: 8px;
      width: 34px;
      height: 34px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      cursor: pointer;
      color: var(--text);
      -webkit-tap-highlight-color: transparent;
    }
    .timer-btn:active {
      transform: scale(0.93);
    }
  `],
})
export class RestTimerComponent {
  readonly timer = inject(RestTimerService);
}
