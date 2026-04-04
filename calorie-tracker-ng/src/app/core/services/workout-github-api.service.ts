import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { LoggingService } from './logging.service';
import { NotificationService } from './notification.service';
import { WorkoutStateService } from './workout-state.service';
import { GitHubFileResponse, GitHubContentsItem, GitHubPutResponse } from '../models/github.model';
import { Workout } from '../models/workout.model';
import { Session } from '../models/session.model';
import { WorkoutStreakData } from '../models/workout-streak.model';
import { WorkoutConfig } from '../models/workout-config.model';
import { SessionTemplate } from '../models/session-template.model';
import { BodyMeasurement } from '../models/body-measurement.model';
import { encodeBase64, decodeBase64 } from '../../shared/utils/base64.utils';

const TIMEOUT_MS = 15_000;
const WORKOUT_FOLDER = 'workout-data';

@Injectable({ providedIn: 'root' })
export class WorkoutGithubApiService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly log = inject(LoggingService);
  private readonly notify = inject(NotificationService);
  private readonly workoutState = inject(WorkoutStateService);

  private get base(): string {
    return environment.githubApiBaseUrl;
  }

  private headers(): HttpHeaders {
    const token = this.auth.getToken();
    return new HttpHeaders({
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    });
  }

  private jsonHeaders(): HttpHeaders {
    return this.headers().set('Content-Type', 'application/json');
  }

  private async get<T>(url: string): Promise<T> {
    return firstValueFrom(
      this.http.get<T>(url, { headers: this.headers() }).pipe(timeout(TIMEOUT_MS))
    );
  }

  private async put<T>(url: string, body: unknown): Promise<T> {
    return firstValueFrom(
      this.http.put<T>(url, body, { headers: this.jsonHeaders() }).pipe(timeout(TIMEOUT_MS))
    );
  }

  private async httpDelete<T>(url: string, body: unknown): Promise<T> {
    return firstValueFrom(
      this.http.request<T>('DELETE', url, { body, headers: this.jsonHeaders() }).pipe(timeout(TIMEOUT_MS))
    );
  }

  private repoUrl(path: string): string {
    const repo = this.auth.getRepo()!;
    return `${this.base}/repos/${repo}/contents/${WORKOUT_FOLDER}/${path}`;
  }

  // ─── Workouts ────────────────────────────────────────────────────────────────

  async loadWorkouts(): Promise<Workout[]> {
    if (!this.auth.hasCredentials()) return [];
    const url = this.repoUrl('workouts.json');
    try {
      const j = await this.get<GitHubFileResponse>(url);
      const decoded = decodeBase64(j.content || '');
      const parsed = JSON.parse(decoded || '[]');
      const workouts: Workout[] = Array.isArray(parsed) ? parsed : [];
      this.workoutState.fileIndex.update(idx => ({ ...idx, 'workouts': j.sha }));
      this.workoutState.workouts.set(workouts);
      this.workoutState.workoutsLoaded.set(true);
      this.log.dbg(`Loaded ${workouts.length} workout definitions`, 'info');
      return workouts;
    } catch (e: unknown) {
      const err = e as { status?: number };
      if (err?.status === 404) {
        this.workoutState.workouts.set([]);
        this.workoutState.workoutsLoaded.set(true);
        return [];
      }
      this.log.dbg('loadWorkouts error', 'error', e);
      return [];
    }
  }

  async saveWorkouts(workouts: Workout[]): Promise<boolean> {
    if (!this.auth.hasCredentials()) return false;
    const url = this.repoUrl('workouts.json');
    const body: Record<string, string> = {
      message: `Update workouts: ${new Date().toISOString()}`,
      content: encodeBase64(JSON.stringify(workouts, null, 2)),
    };
    const sha = this.workoutState.fileIndex()['workouts'];
    if (sha) body['sha'] = sha;
    else {
      try {
        const j = await this.get<GitHubFileResponse>(url);
        if (j.sha) body['sha'] = j.sha;
      } catch { /* new file */ }
    }
    try {
      const res = await this.put<GitHubPutResponse>(url, body);
      this.workoutState.fileIndex.update(idx => ({ ...idx, 'workouts': res.content.sha }));
      this.workoutState.workouts.set(workouts);
      this.notify.showNotification('Workouts saved', 'write');
      this.log.dbg(`Saved ${workouts.length} workouts`, 'info');
      return true;
    } catch (e: unknown) {
      const err = e as { status?: number };
      if (err?.status === 409) {
        try {
          const j = await this.get<GitHubFileResponse>(url);
          body['sha'] = j.sha;
          const res = await this.put<GitHubPutResponse>(url, body);
          this.workoutState.fileIndex.update(idx => ({ ...idx, 'workouts': res.content.sha }));
          this.workoutState.workouts.set(workouts);
          return true;
        } catch (retryErr) {
          this.log.dbg('saveWorkouts retry error', 'error', retryErr);
        }
      }
      this.log.dbg('saveWorkouts error', 'error', e);
      return false;
    }
  }

  // ─── Sessions ────────────────────────────────────────────────────────────────

  async loadSession(dateStr: string): Promise<Session | null> {
    if (!this.auth.hasCredentials()) return null;
    const url = this.repoUrl(`${dateStr}.json`);
    try {
      const j = await this.get<GitHubFileResponse>(url);
      const decoded = decodeBase64(j.content || '');
      const session = JSON.parse(decoded) as Session;
      this.workoutState.fileIndex.update(idx => ({ ...idx, [dateStr]: j.sha }));
      this.log.dbg(`Loaded session for ${dateStr}`, 'info');
      return session;
    } catch (e: unknown) {
      const err = e as { status?: number };
      if (err?.status === 404) return null;
      this.log.dbg(`loadSession error for ${dateStr}`, 'error', e);
      return null;
    }
  }

  async saveSession(dateStr: string, session: Session): Promise<boolean> {
    if (!this.auth.hasCredentials()) {
      this.log.dbg('Cannot save session: missing credentials', 'error');
      return false;
    }
    const url = this.repoUrl(`${dateStr}.json`);
    const body: Record<string, string> = {
      message: `Workout session ${dateStr}: ${new Date().toISOString()}`,
      content: encodeBase64(JSON.stringify(session, null, 2)),
    };
    const sha = this.workoutState.fileIndex()[dateStr];
    if (sha) body['sha'] = sha;
    else {
      try {
        const j = await this.get<GitHubFileResponse>(url);
        if (j.sha) body['sha'] = j.sha;
      } catch { /* new file */ }
    }
    try {
      const res = await this.put<GitHubPutResponse>(url, body);
      this.workoutState.fileIndex.update(idx => ({ ...idx, [dateStr]: res.content.sha }));
      this.notify.showNotification(`Session saved for ${dateStr}`, 'write');
      this.log.dbg(`Saved session for ${dateStr} (SHA: ${res.content.sha.substring(0, 8)})`, 'info');
      return true;
    } catch (e: unknown) {
      const err = e as { status?: number };
      if (err?.status === 409) {
        try {
          const j = await this.get<GitHubFileResponse>(url);
          body['sha'] = j.sha;
          const res = await this.put<GitHubPutResponse>(url, body);
          this.workoutState.fileIndex.update(idx => ({ ...idx, [dateStr]: res.content.sha }));
          return true;
        } catch (retryErr) {
          this.log.dbg('saveSession retry error', 'error', retryErr);
        }
      }
      this.log.dbg(`saveSession error for ${dateStr}`, 'error', e);
      return false;
    }
  }

  async deleteSession(dateStr: string): Promise<boolean> {
    if (!this.auth.hasCredentials()) return false;
    const url = this.repoUrl(`${dateStr}.json`);
    try {
      let sha = this.workoutState.fileIndex()[dateStr];
      if (!sha) {
        try {
          const j = await this.get<GitHubFileResponse>(url);
          sha = j.sha;
        } catch (e: unknown) {
          const err = e as { status?: number };
          if (err?.status === 404) return true; // already gone
          throw e;
        }
      }
      const body = { message: `Delete session ${dateStr}: ${new Date().toISOString()}`, sha };
      await this.httpDelete<unknown>(url, body);
      this.workoutState.fileIndex.update(idx => { const n = { ...idx }; delete n[dateStr]; return n; });
      this.notify.showNotification(`Session deleted for ${dateStr}`, 'delete');
      this.log.dbg(`Deleted session ${dateStr}`, 'info');
      return true;
    } catch (err) {
      this.log.dbg(`deleteSession error for ${dateStr}`, 'error', err);
      return false;
    }
  }

  async listSessionFiles(): Promise<string[]> {
    if (!this.auth.hasCredentials()) return [];
    const repo = this.auth.getRepo()!;
    // Append cache-buster so GitHub CDN doesn't serve a stale directory listing
    const url = `${this.base}/repos/${repo}/contents/${WORKOUT_FOLDER}?t=${Date.now()}`;
    try {
      const items = await this.get<GitHubContentsItem[]>(url);
      return (items || [])
        .filter(it => it.type === 'file' && /^\d{4}-\d{2}-\d{2}\.json$/.test(it.name))
        .map(it => it.name.replace('.json', ''))
        .sort();
    } catch (e: unknown) {
      const err = e as { status?: number };
      if (err?.status === 404) return []; // folder doesn't exist yet
      this.log.dbg('listSessionFiles error', 'error', e);
      return [];
    }
  }

  // ─── Workout Streak ───────────────────────────────────────────────────────────

  async loadWorkoutStreak(): Promise<WorkoutStreakData | null> {
    if (!this.auth.hasCredentials()) return null;
    const url = this.repoUrl('streak.json');
    try {
      const j = await this.get<GitHubFileResponse>(url);
      const decoded = decodeBase64(j.content || '');
      const data = JSON.parse(decoded) as WorkoutStreakData;
      this.workoutState.fileIndex.update(idx => ({ ...idx, 'w_streak': j.sha }));
      this.workoutState.streakData.set(data);
      this.log.dbg('Loaded workout streak', 'info');
      return data;
    } catch (e: unknown) {
      const err = e as { status?: number };
      if (err?.status === 404) return null;
      this.log.dbg('loadWorkoutStreak error', 'error', e);
      return null;
    }
  }

  async saveWorkoutStreak(data: WorkoutStreakData): Promise<boolean> {
    if (!this.auth.hasCredentials()) return false;
    const url = this.repoUrl('streak.json');
    const body: Record<string, string> = {
      message: `Workout streak: ${new Date().toISOString()}`,
      content: encodeBase64(JSON.stringify(data, null, 2)),
    };
    const sha = this.workoutState.fileIndex()['w_streak'];
    if (sha) body['sha'] = sha;
    else {
      try {
        const j = await this.get<GitHubFileResponse>(url);
        if (j.sha) body['sha'] = j.sha;
      } catch { /* new file */ }
    }
    try {
      const res = await this.put<GitHubPutResponse>(url, body);
      this.workoutState.fileIndex.update(idx => ({ ...idx, 'w_streak': res.content.sha }));
      this.workoutState.streakData.set(data);
      this.log.dbg('Workout streak saved', 'info');
      return true;
    } catch (e: unknown) {
      const err = e as { status?: number };
      if (err?.status === 409) {
        try {
          const j = await this.get<GitHubFileResponse>(url);
          body['sha'] = j.sha;
          const res = await this.put<GitHubPutResponse>(url, body);
          this.workoutState.fileIndex.update(idx => ({ ...idx, 'w_streak': res.content.sha }));
          return true;
        } catch (retryErr) {
          this.log.dbg('saveWorkoutStreak retry error', 'error', retryErr);
        }
      }
      this.log.dbg('saveWorkoutStreak error', 'error', e);
      return false;
    }
  }

  // ─── Workout Config ───────────────────────────────────────────────────────────

  async loadWorkoutConfig(): Promise<WorkoutConfig | null> {
    if (!this.auth.hasCredentials()) return null;
    const url = this.repoUrl('config.json');
    try {
      const j = await this.get<GitHubFileResponse>(url);
      const decoded = decodeBase64(j.content || '');
      const cfg = JSON.parse(decoded) as WorkoutConfig;
      this.workoutState.fileIndex.update(idx => ({ ...idx, 'w_config': j.sha }));
      this.workoutState.config.set(cfg);
      this.log.dbg('Loaded workout config', 'info');
      return cfg;
    } catch (e: unknown) {
      const err = e as { status?: number };
      if (err?.status === 404) return null;
      this.log.dbg('loadWorkoutConfig error', 'error', e);
      return null;
    }
  }

  async saveWorkoutConfig(cfg: WorkoutConfig): Promise<boolean> {
    if (!this.auth.hasCredentials()) {
      this.log.dbg('Cannot save workout config: missing credentials', 'warn');
      return false;
    }
    const url = this.repoUrl('config.json');
    const body: Record<string, string> = {
      message: `Workout config: ${new Date().toISOString()}`,
      content: encodeBase64(JSON.stringify(cfg, null, 2)),
    };
    const sha = this.workoutState.fileIndex()['w_config'];
    if (sha) body['sha'] = sha;
    else {
      try {
        const j = await this.get<GitHubFileResponse>(url);
        if (j.sha) body['sha'] = j.sha;
      } catch { /* new file */ }
    }
    try {
      const res = await this.put<GitHubPutResponse>(url, body);
      this.workoutState.fileIndex.update(idx => ({ ...idx, 'w_config': res.content.sha }));
      this.workoutState.config.set(cfg);
      this.notify.showNotification('Workout settings saved', 'write');
      this.log.dbg('Workout config saved', 'info');
      return true;
    } catch (e: unknown) {
      const err = e as { status?: number };
      if (err?.status === 409) {
        try {
          const j = await this.get<GitHubFileResponse>(url);
          body['sha'] = j.sha;
          const res = await this.put<GitHubPutResponse>(url, body);
          this.workoutState.fileIndex.update(idx => ({ ...idx, 'w_config': res.content.sha }));
          return true;
        } catch (retryErr) {
          this.log.dbg('saveWorkoutConfig retry error', 'error', retryErr);
        }
      }
      this.log.dbg('saveWorkoutConfig error', 'error', e);
      return false;
    }
  }

  // ─── Session Templates ────────────────────────────────────────────────────────

  async loadTemplates(): Promise<SessionTemplate[]> {
    if (!this.auth.hasCredentials()) return [];
    const url = this.repoUrl('templates.json');
    try {
      const j = await this.get<GitHubFileResponse>(url);
      const decoded = decodeBase64(j.content || '');
      const templates: SessionTemplate[] = JSON.parse(decoded || '[]');
      this.workoutState.fileIndex.update(idx => ({ ...idx, 'templates': j.sha }));
      this.workoutState.templates.set(templates);
      this.workoutState.templatesLoaded.set(true);
      this.log.dbg(`Loaded ${templates.length} session templates`, 'info');
      return templates;
    } catch (e: unknown) {
      const err = e as { status?: number };
      if (err?.status === 404) {
        this.workoutState.templates.set([]);
        this.workoutState.templatesLoaded.set(true);
        return [];
      }
      this.log.dbg('loadTemplates error', 'error', e);
      return [];
    }
  }

  async saveTemplates(templates: SessionTemplate[]): Promise<boolean> {
    if (!this.auth.hasCredentials()) return false;
    const url = this.repoUrl('templates.json');
    const body: Record<string, string> = {
      message: `Update session templates: ${new Date().toISOString()}`,
      content: encodeBase64(JSON.stringify(templates, null, 2)),
    };
    const sha = this.workoutState.fileIndex()['templates'];
    if (sha) body['sha'] = sha;
    else {
      try {
        const j = await this.get<GitHubFileResponse>(url);
        if (j.sha) body['sha'] = j.sha;
      } catch { /* new file */ }
    }
    try {
      const res = await this.put<GitHubPutResponse>(url, body);
      this.workoutState.fileIndex.update(idx => ({ ...idx, 'templates': res.content.sha }));
      this.workoutState.templates.set(templates);
      this.notify.showNotification('Templates saved', 'write');
      this.log.dbg(`Saved ${templates.length} session templates`, 'info');
      return true;
    } catch (e: unknown) {
      const err = e as { status?: number };
      if (err?.status === 409) {
        try {
          const j = await this.get<GitHubFileResponse>(url);
          body['sha'] = j.sha;
          const res = await this.put<GitHubPutResponse>(url, body);
          this.workoutState.fileIndex.update(idx => ({ ...idx, 'templates': res.content.sha }));
          this.workoutState.templates.set(templates);
          return true;
        } catch (retryErr) {
          this.log.dbg('saveTemplates retry error', 'error', retryErr);
        }
      }
      this.log.dbg('saveTemplates error', 'error', e);
      return false;
    }
  }

  // ─── Body Measurements ───────────────────────────────────────────────────────

  async loadMeasurements(): Promise<BodyMeasurement[]> {
    if (!this.auth.hasCredentials()) return [];
    const url = this.repoUrl('measurements.json');
    try {
      const j = await this.get<GitHubFileResponse>(url);
      const decoded = decodeBase64(j.content || '');
      const parsed = JSON.parse(decoded || '[]');
      const measurements: BodyMeasurement[] = Array.isArray(parsed) ? parsed : [];
      this.workoutState.fileIndex.update(idx => ({ ...idx, 'measurements': j.sha }));
      this.log.dbg(`Loaded ${measurements.length} measurements`, 'info');
      return measurements;
    } catch (e: unknown) {
      const err = e as { status?: number };
      if (err?.status !== 404) this.log.dbg('loadMeasurements error', 'error', e);
      return [];
    }
  }

  async saveMeasurements(measurements: BodyMeasurement[]): Promise<boolean> {
    if (!this.auth.hasCredentials()) return false;
    const url = this.repoUrl('measurements.json');
    const body: Record<string, string> = {
      message: `Update body measurements: ${new Date().toISOString()}`,
      content: encodeBase64(JSON.stringify(measurements, null, 2)),
    };
    const sha = this.workoutState.fileIndex()['measurements'];
    if (sha) body['sha'] = sha;
    else {
      try {
        const j = await this.get<GitHubFileResponse>(url);
        if (j.sha) body['sha'] = j.sha;
      } catch { /* new file */ }
    }
    try {
      const res = await this.put<GitHubPutResponse>(url, body);
      this.workoutState.fileIndex.update(idx => ({ ...idx, 'measurements': res.content.sha }));
      this.log.dbg(`Saved ${measurements.length} measurements`, 'info');
      return true;
    } catch (e: unknown) {
      const err = e as { status?: number };
      if (err?.status === 409) {
        try {
          const j = await this.get<GitHubFileResponse>(url);
          body['sha'] = j.sha;
          const res = await this.put<GitHubPutResponse>(url, body);
          this.workoutState.fileIndex.update(idx => ({ ...idx, 'measurements': res.content.sha }));
          return true;
        } catch (retryErr) {
          this.log.dbg('saveMeasurements retry error', 'error', retryErr);
        }
      }
      this.log.dbg('saveMeasurements error', 'error', e);
      return false;
    }
  }
}
