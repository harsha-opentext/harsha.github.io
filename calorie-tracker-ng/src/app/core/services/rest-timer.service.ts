import { Injectable, signal, computed } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class RestTimerService {
  readonly active = signal(false);
  readonly secondsRemaining = signal(0);
  readonly defaultDuration = signal(90); // seconds

  private intervalId: ReturnType<typeof setInterval> | null = null;

  start(seconds?: number): void {
    const duration = seconds ?? this.defaultDuration();
    this.secondsRemaining.set(duration);
    this.active.set(true);
    this.clearInterval();
    this.intervalId = setInterval(() => {
      const remaining = this.secondsRemaining();
      if (remaining <= 1) {
        this.secondsRemaining.set(0);
        this.active.set(false);
        this.clearInterval();
        this.playBeep();
      } else {
        this.secondsRemaining.set(remaining - 1);
      }
    }, 1000);
  }

  pause(): void {
    this.clearInterval();
    this.active.set(false);
  }

  resume(): void {
    if (this.secondsRemaining() > 0) {
      this.active.set(true);
      this.clearInterval();
      this.intervalId = setInterval(() => {
        const remaining = this.secondsRemaining();
        if (remaining <= 1) {
          this.secondsRemaining.set(0);
          this.active.set(false);
          this.clearInterval();
          this.playBeep();
        } else {
          this.secondsRemaining.set(remaining - 1);
        }
      }, 1000);
    }
  }

  reset(): void {
    this.clearInterval();
    this.active.set(false);
    this.secondsRemaining.set(0);
  }

  readonly formattedTime = computed(() => {
    const s = this.secondsRemaining();
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  });

  readonly progress = computed(() => {
    const dur = this.defaultDuration();
    if (dur <= 0) return 0;
    return ((dur - this.secondsRemaining()) / dur) * 100;
  });

  private clearInterval(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private playBeep(): void {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.4, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.6);
    } catch {
      // AudioContext not available (e.g. in tests) — ignore
    }
  }
}
