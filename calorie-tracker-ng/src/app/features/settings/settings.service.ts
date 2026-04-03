import { Injectable, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { ConfigService } from '../../core/services/config.service';
import { AuthService } from '../../core/services/auth.service';
import { GithubApiService } from '../../core/services/github-api.service';
import { StateService } from '../../core/services/state.service';
import { LoggingService } from '../../core/services/logging.service';
import { NotificationService } from '../../core/services/notification.service';
import { ThemeService } from '../../core/services/theme.service';
import { AppConfig } from '../../core/models/config.model';
import { getTodayString, getEntryDate, addDaysToDateString } from '../../shared/utils/date.utils';
import { StreakData } from '../../core/models/streak.model';

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly config = inject(ConfigService);
  private readonly auth = inject(AuthService);
  private readonly github = inject(GithubApiService);
  private readonly state = inject(StateService);
  private readonly log = inject(LoggingService);
  private readonly notify = inject(NotificationService);
  private readonly theme = inject(ThemeService);

  readonly saving = signal(false);
  readonly validating = signal(false);
  readonly loadingFromRepo = signal(false);
  readonly fileCount = signal<number | null>(null);

  private settingsSaveSubject = new Subject<void>();

  constructor() {
    this.settingsSaveSubject.pipe(debounceTime(250)).subscribe(() => {
      this.persistSettingsToRepo().catch(err =>
        this.log.dbg('Settings save (debounced) failed: ' + String(err), 'error')
      );
    });
  }

  enqueueSettingsSave(): void {
    this.settingsSaveSubject.next();
  }

  async saveCredentials(token: string, repo: string, dailyBudget: number): Promise<void> {
    this.auth.setToken(token);
    this.auth.setRepo(repo);
    if (dailyBudget > 0) this.config.setConfig('dailyBudget', dailyBudget);
    this.log.dbg('Settings saved locally', 'info');

    this.validating.set(true);
    try {
      const res = await this.github.validateRepoConnection();
      if (res.ok) {
        this.notify.showNotification('GitHub repository validated', 'write');
        this.github.fetchFromGit(true).catch(err =>
          this.log.dbg('fetchFromGit after settings save failed: ' + String(err), 'warn')
        );
      } else {
        this.notify.showNotification(`GitHub validation failed: ${res.message}`, 'error');
      }
    } finally {
      this.validating.set(false);
    }
  }

  async persistSettingsToRepo(): Promise<boolean> {
    const token = this.auth.getToken();
    const repo = this.auth.getRepo();
    if (!token || !repo) return false;
    this.saving.set(true);
    try {
      const configObj = this.config.getAllConfig() as unknown as Record<string, unknown>;
      const ok = await this.github.saveSettingsToRepo(configObj);
      if (ok) this.log.dbg('Settings persisted to repo', 'info');
      return ok;
    } finally {
      this.saving.set(false);
    }
  }

  async loadFromRepo(): Promise<void> {
    this.loadingFromRepo.set(true);
    try {
      await this.github.loadSettingsFromRepo();
    } finally {
      this.loadingFromRepo.set(false);
    }
  }

  async validateConnection(): Promise<void> {
    this.validating.set(true);
    try {
      const res = await this.github.validateRepoConnection();
      if (res.ok) {
        this.notify.showNotification(`Connection valid: ${res.message}`, 'info');
      } else {
        this.notify.showNotification(`Connection failed: ${res.message}`, 'error');
      }
    } finally {
      this.validating.set(false);
    }
  }

  computeStreak(): void {
    const entries = this.state.entries();
    try {
      const uniqueDates = new Set<string>();
      for (const e of entries) {
        const d = getEntryDate(e as Record<string, unknown>);
        if (d) uniqueDates.add(d);
      }
      const sorted = Array.from(uniqueDates).sort();
      const today = getTodayString();
      const yesterday = addDaysToDateString(today, -1);

      let currentStreak = 0;
      let longestStreak = 0;
      let run = 0;
      let lastDate: string | null = null;
      for (const d of sorted) {
        if (!lastDate) { run = 1; }
        else {
          const prev = addDaysToDateString(d, -1);
          if (prev === lastDate) { run++; }
          else { run = 1; }
        }
        if (run > longestStreak) longestStreak = run;
        lastDate = d;
      }

      // Current streak: count back from today (or yesterday if today has no entry)
      const checkFrom = uniqueDates.has(today) ? today : (uniqueDates.has(yesterday) ? yesterday : null);
      if (checkFrom) {
        let d = checkFrom;
        while (uniqueDates.has(d)) {
          currentStreak++;
          d = addDaysToDateString(d, -1);
        }
      }

      this.state.streak.set({
        currentStreak,
        longestStreak,
        lastActiveDate: lastDate,
        computedAt: new Date().toISOString(),
        activeDates: sorted,
        recentActiveDates: sorted.slice(-30),
      });
    } catch (err) {
      this.log.dbg('computeStreak error: ' + String(err), 'error');
    }
  }

  async countFiles(): Promise<void> {
    try {
      const chunks = await this.github.listLogChunks();
      this.fileCount.set(chunks.length);
    } catch {
      this.fileCount.set(null);
    }
  }

  setTheme(theme: string): void {
    const validTheme = (['auto', 'dark', 'light'].includes(theme) ? theme : 'auto') as 'auto' | 'dark' | 'light';
    this.config.setConfig('theme', validTheme);
    this.theme.applyTheme(validTheme);
    this.enqueueSettingsSave();
  }

  setConfigAndSave<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    this.config.setConfig(key, value);
    this.enqueueSettingsSave();
  }
}
