import { Component, inject, OnInit } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
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
import { GithubApiService } from './core/services/github-api.service';
import { StreakData } from './core/models/streak.model';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    ConfirmModalComponent,
    NotificationToastComponent,
    CsvExportModalComponent,
    EntryPreviewModalComponent,
  ],
  template: `
    <div class="app-shell">
      <!-- Main content -->
      <main class="page-content">
        <router-outlet />
      </main>

      <!-- Bottom navigation -->
      <nav class="main-nav">
        <div class="nav-links">
          <a class="nav-btn" routerLink="/tracker" routerLinkActive="active">
            <span class="icon">📝</span>
            <span class="label">Tracker</span>
          </a>
          <a class="nav-btn" routerLink="/history" routerLinkActive="active">
            <span class="icon">📋</span>
            <span class="label">History</span>
          </a>
          <a class="nav-btn" routerLink="/analytics" routerLinkActive="active">
            <span class="icon">📊</span>
            <span class="label">Analytics</span>
          </a>
          <a class="nav-btn" routerLink="/settings" routerLinkActive="active">
            <span class="icon">⚙️</span>
            <span class="label">Settings</span>
          </a>
          <a class="nav-btn" routerLink="/apps" routerLinkActive="active">
            <span class="icon">🧩</span>
            <span class="label">Apps</span>
          </a>
        </div>
      </nav>

      <!-- Global modals -->
      <app-confirm-modal />
      <app-notification-toast />
      <app-entry-preview-modal />
      @if (csvExportSvc.state().open) {
        <app-csv-export-modal />
      }
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
  readonly csvExportSvc = inject(CsvExportService);

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
    }
  }
}
