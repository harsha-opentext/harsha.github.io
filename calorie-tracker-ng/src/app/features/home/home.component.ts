import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-home',
  standalone: true,
  template: `
    <div class="home-page">
      <div class="home-header">
        <h1 class="home-title">Health Tracker</h1>
        <p class="home-subtitle">Choose your tracker</p>
      </div>

      <div class="tracker-cards">
        <button class="tracker-card card" (click)="openCalorie()">
          <div class="tracker-icon">🥗</div>
          <div class="tracker-name">Calorie Tracker</div>
          <div class="tracker-desc">Log meals, track macros, monitor daily calories</div>
        </button>

        <button class="tracker-card card" (click)="openWorkout()">
          <div class="tracker-icon">🏋️</div>
          <div class="tracker-name">Workout Tracker</div>
          <div class="tracker-desc">Log sessions, track sets and reps, monitor progress</div>
        </button>
      </div>
    </div>
  `,
  styles: [`
    .home-page {
      display: flex;
      flex-direction: column;
      gap: 24px;
      padding: 24px 0;
      align-items: center;
    }
    .home-header {
      text-align: center;
    }
    .home-title {
      font-size: 28px;
      font-weight: 800;
      margin: 0 0 8px;
      color: var(--text);
    }
    .home-subtitle {
      font-size: 16px;
      color: var(--text-muted);
      margin: 0;
    }
    .tracker-cards {
      display: flex;
      flex-direction: column;
      gap: 16px;
      width: 100%;
    }
    .tracker-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      padding: 32px 24px;
      border: none;
      border-radius: 16px;
      cursor: pointer;
      text-align: center;
      transition: all 0.2s;
      background: var(--card-bg);
      box-shadow: var(--shadow);
      border: 1px solid var(--border);
      -webkit-tap-highlight-color: transparent;
      &:hover { transform: translateY(-2px); box-shadow: var(--shadow-lg); }
      &:active { transform: scale(0.98); }
    }
    .tracker-icon {
      font-size: 48px;
      line-height: 1;
    }
    .tracker-name {
      font-size: 20px;
      font-weight: 700;
      color: var(--text);
    }
    .tracker-desc {
      font-size: 14px;
      color: var(--text-muted);
      line-height: 1.4;
    }
  `],
})
export class HomeComponent {
  private readonly router = inject(Router);

  openCalorie(): void {
    localStorage.setItem('lastUsedTracker', 'calorie');
    this.router.navigate(['/calorie-hub']);
  }

  openWorkout(): void {
    localStorage.setItem('lastUsedTracker', 'workout');
    this.router.navigate(['/workout']);
  }
}
