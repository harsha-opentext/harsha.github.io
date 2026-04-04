import { Component, inject, OnInit, computed } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { CommonModule } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs/operators';
import { SchemaService } from './core/services/schema.service';
import { ThemeService } from './core/services/theme.service';
import { ConfigService } from './core/services/config.service';
import { LoggingService } from './core/services/logging.service';
import { NotificationService } from './core/services/notification.service';
import { StateService } from './core/services/state.service';
import { ConfirmModalComponent } from './shared/components/confirm-modal/confirm-modal.component';
import { NotificationToastComponent } from './shared/components/notification-toast/notification-toast.component';
import { CsvExportModalComponent } from './shared/components/csv-export-modal/csv-export-modal.component';
import { CsvExportService } from './shared/components/csv-export-modal/csv-export.service';
import { EntryPreviewModalComponent } from './shared/components/entry-preview-modal/entry-preview-modal.component';
import { FeedbackModalComponent } from './shared/components/feedback-modal/feedback-modal.component';
import { FeedbackService } from './core/services/feedback.service';
import { GithubApiService } from './core/services/github-api.service';
import { WorkoutGithubApiService } from './core/services/workout-github-api.service';
import { StreakData } from './core/models/streak.model';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    ConfirmModalComponent,
    NotificationToastComponent,
    CsvExportModalComponent,
    EntryPreviewModalComponent,
    FeedbackModalComponent,
  ],
  template: `
    <div class="app-shell">
      <!-- Main content -->
      <main class="page-content no-nav">
        <router-outlet />
      </main>



      <!-- Global modals -->
      <app-confirm-modal />
      <app-notification-toast />
      <app-entry-preview-modal />
      @if (csvExportSvc.state().open) {
        <app-csv-export-modal />
      }

      <!-- Feedback FAB -->
      <button class="feedback-fab" (click)="feedbackSvc.openModal()" title="Send Feedback" aria-label="Send Feedback">
        💬
      </button>
      <app-feedback-modal />
    </div>
  `,
  styleUrl: './app.scss',
})
export class App implements OnInit {
  private readonly schema = inject(SchemaService);
  private readonly theme = inject(ThemeService);
  private readonly config = inject(ConfigService);
  private readonly log = inject(LoggingService);
  private readonly state = inject(StateService);
  private readonly github = inject(GithubApiService);
  private readonly workoutGithub = inject(WorkoutGithubApiService);
  private readonly router = inject(Router);
  readonly csvExportSvc = inject(CsvExportService);
  readonly feedbackSvc = inject(FeedbackService);

  private readonly routerEvents = toSignal(
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      map(() => this.router.url)
    ),
    { initialValue: this.router.url }
  );

  readonly isWorkoutContext = computed(() =>
    this.routerEvents().startsWith('/workout')
  );

  readonly isHomePage = computed(() =>
    this.routerEvents() === '/home' || this.routerEvents() === ''
  );

  switchTracker(): void {
    localStorage.removeItem('lastUsedTracker');
  }

  ngOnInit(): void {
    this.theme.initTheme();

    // Load schema
    this.schema.loadSchema();

    // Load streak from localStorage cache
    try {
      const raw = localStorage.getItem('streak_cache');
      if (raw) {
        const cached = JSON.parse(raw) as Partial<StreakData>;
        this.state.streak.update(s => ({ ...s, ...cached }));
      }
    } catch { /* ignore */ }

    // Set log level from config
    // (logLevel is not in AppConfig — use logRetentionMinutes)

    // Auto-fetch today if credentials present
    const token = localStorage.getItem('gt_token');
    const repo = localStorage.getItem('gt_repo');
    if (token && repo) {
      this.github.fetchFromGit(true).catch(err =>
        this.log.dbg('Auto-fetch on load failed: ' + String(err), 'warn')
      );
      this.workoutGithub.loadWorkouts().catch(err =>
        this.log.dbg('Auto-load workouts failed: ' + String(err), 'warn')
      );
      this.workoutGithub.loadWorkoutConfig().catch(err =>
        this.log.dbg('Auto-load workout config failed: ' + String(err), 'warn')
      );
    }
  }
}
