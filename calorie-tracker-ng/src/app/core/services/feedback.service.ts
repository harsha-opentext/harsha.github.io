import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class FeedbackService {
  readonly open = signal(false);
  readonly submitted = signal(false);
  readonly rating = signal<1 | 2 | 3 | 4 | 5 | null>(null);
  readonly comments = signal('');

  private shakeThreshold = 15; // m/s²
  private lastShakeTime = 0;
  private listenerAttached = false;

  /** Programmatically open the feedback modal. */
  openModal(): void {
    this.submitted.set(false);
    this.rating.set(null);
    this.comments.set('');
    this.open.set(true);
  }

  closeModal(): void {
    this.open.set(false);
  }

  /** Start listening for device shake gestures. */
  startShakeDetection(): void {
    if (this.listenerAttached) return;
    if (typeof DeviceMotionEvent === 'undefined') return;

    const handler = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a) return;
      const total = Math.sqrt((a.x ?? 0) ** 2 + (a.y ?? 0) ** 2 + (a.z ?? 0) ** 2);
      const now = Date.now();
      if (total > this.shakeThreshold && now - this.lastShakeTime > 1500) {
        this.lastShakeTime = now;
        if (!this.open()) this.openModal();
      }
    };

    // iOS 13+ requires permission
    if (
      typeof (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission === 'function'
    ) {
      (DeviceMotionEvent as unknown as { requestPermission: () => Promise<string> })
        .requestPermission()
        .then(permission => {
          if (permission === 'granted') {
            window.addEventListener('devicemotion', handler);
            this.listenerAttached = true;
          }
        })
        .catch(() => { /* permission denied — silent */ });
    } else {
      window.addEventListener('devicemotion', handler);
      this.listenerAttached = true;
    }
  }

  submit(rating: 1 | 2 | 3 | 4 | 5, comments: string): void {
    // In a real app this would POST to an endpoint.
    // For now we log to console (safe, no PII sent).
    console.log('[Feedback submitted]', { rating, comments });
    this.submitted.set(true);
    setTimeout(() => this.open.set(false), 1500);
  }
}
