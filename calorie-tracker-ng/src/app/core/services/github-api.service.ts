import { Injectable, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { ConfigService } from './config.service';
import { LoggingService } from './logging.service';
import { NotificationService } from './notification.service';
import { StateService } from './state.service';
import {
  GitHubFileResponse,
  GitHubContentsItem,
  GitHubPutResponse,
  ValidationResult,
  FetchDateResult,
} from '../models/github.model';
import { AnyEntry, isWeightEntry } from '../models/entry.model';
import { encodeBase64, decodeBase64 } from '../../shared/utils/base64.utils';
import { getTodayString, formatDateLocal } from '../../shared/utils/date.utils';

const TIMEOUT_MS = 15_000;

@Injectable({ providedIn: 'root' })
export class GithubApiService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly config = inject(ConfigService);
  private readonly log = inject(LoggingService);
  private readonly notify = inject(NotificationService);
  private readonly state = inject(StateService);

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

  private async delete<T>(url: string, body: unknown): Promise<T> {
    return firstValueFrom(
      this.http.request<T>('DELETE', url, { body, headers: this.jsonHeaders() }).pipe(timeout(TIMEOUT_MS))
    );
  }

  async validateRepoConnection(): Promise<ValidationResult> {
    const repo = this.auth.getRepo();
    if (!this.auth.hasCredentials()) return { ok: false, message: 'Missing token or repo' };
    try {
      await this.get<unknown>(`${this.base}/repos/${repo}`);
      return { ok: true };
    } catch (e: unknown) {
      const err = e as { status?: number; error?: { message?: string }; message?: string };
      const msg = err?.error?.message ?? err?.message ?? `HTTP ${err?.status ?? 'unknown'}`;
      return { ok: false, message: `${msg} (${err?.status ?? ''})` };
    }
  }

  async fetchFromGit(onlyToday = false): Promise<void> {
    this.log.dbg(`fetchFromGit start (onlyToday=${onlyToday})`, 'debug');
    if (!this.auth.hasCredentials()) {
      this.log.dbg('Missing credentials - skipping GitHub fetch', 'warn');
      this.notify.showNotification('Missing GitHub credentials. Configure in Settings first.', 'error');
      return;
    }
    if (!onlyToday) {
      this.log.dbg('fetchFromGit: full-folder fetch disabled by policy; aborting.', 'error');
      this.notify.showNotification('Full-folder fetch disabled by policy; aborting.', 'error');
      throw new Error('Full-folder fetch disabled by policy');
    }

    const repo = this.auth.getRepo()!;
    const dataFolder = this.config.getConfig('dataFolder');
    const today = getTodayString();
    const filePath = `${dataFolder}/${today}.json`;
    const fileUrl = `${this.base}/repos/${repo}/contents/${filePath}`;
    this.log.dbg(`Fetching only today's file: ${fileUrl}`, 'debug');

    try {
      const j = await this.get<GitHubFileResponse>(fileUrl);
      const b64 = j.content || '';
      let arr: AnyEntry[] = [];
      try {
        const decoded = decodeBase64(b64);
        const parsed = JSON.parse(decoded || '[]');
        arr = Array.isArray(parsed) ? parsed : [];
      } catch {
        this.log.dbg(`Invalid JSON in ${filePath}`, 'warn');
        arr = [];
      }
      arr = arr.map(e => ({ ...(e ?? {}), _sourceDate: today })) as AnyEntry[];
      this.state.fileIndex.update(idx => ({ ...idx, [today]: j.sha }));
      this.state.entries.set(arr);
      this.notify.showNotification(`Fetched 1 file (${arr.length} entries) for ${today}`, 'read');
      this.log.dbg(`Loaded ${arr.length} entries from ${filePath}`, 'info');
    } catch (e: unknown) {
      const err = e as { status?: number };
      if (err?.status === 404) {
        this.log.dbg(`Today's data file not found: ${filePath}`, 'info');
        this.state.entries.set([]);
      } else {
        this.log.dbg(`Error fetching today's file`, 'error', e);
        this.state.entries.set([]);
      }
    }
  }

  async fetchDateFromGit(dateStr: string): Promise<FetchDateResult> {
    if (!this.auth.hasCredentials()) {
      this.log.dbg('fetchDateFromGit: missing credentials', 'warn');
      return { status: 0, entries: null };
    }
    const repo = this.auth.getRepo()!;
    const dataFolder = this.config.getConfig('dataFolder') || 'data';
    const filePath = `${dataFolder}/${dateStr}.json`;
    const url = `${this.base}/repos/${repo}/contents/${filePath}`;
    this.log.dbg(`fetchDateFromGit: fetching ${filePath}`, 'info');
    try {
      const j = await this.get<GitHubFileResponse>(url);
      const b64 = j.content || '';
      let arr: AnyEntry[] = [];
      try {
        const decoded = decodeBase64(b64);
        const parsed = JSON.parse(decoded || '[]');
        arr = Array.isArray(parsed) ? parsed : [];
      } catch (err) {
        this.log.dbg(`fetchDateFromGit JSON parse error`, 'error', err);
        arr = [];
      }
      arr = arr.map(e => ({ ...(e ?? {}), _sourceDate: dateStr })) as AnyEntry[];
      this.state.fileIndex.update(idx => ({ ...idx, [dateStr]: j.sha }));
      this.log.dbg(`fetchDateFromGit: fetched ${arr.length} entries for ${dateStr}`, 'info');
      return { status: 200, entries: arr };
    } catch (e: unknown) {
      const err = e as { status?: number };
      const status = err?.status ?? 0;
      if (status === 404) {
        this.log.dbg(`fetchDateFromGit: ${filePath} not found (404)`, 'info');
        return { status: 404, entries: [] };
      }
      this.log.dbg(`fetchDateFromGit error`, 'error', e);
      return { status, entries: null };
    }
  }

  async pushEntryForDate(dateStr: string, entry: AnyEntry): Promise<boolean> {
    if (!this.auth.hasCredentials()) {
      this.log.dbg('Cannot push entry: Missing credentials', 'error');
      return false;
    }
    const repo = this.auth.getRepo()!;
    const dataFolder = this.config.getConfig('dataFolder') || 'data';
    const filePath = `${dataFolder}/${dateStr}.json`;
    const url = `${this.base}/repos/${repo}/contents/${filePath}`;
    this.log.dbg(`Pushing 1 entry to ${filePath}`, 'info');

    try {
      let existing: AnyEntry[] = [];
      let fileSha: string | undefined;
      const fileIndex = this.state.fileIndex();
      if (fileIndex[dateStr]) fileSha = fileIndex[dateStr];

      try {
        const j = await this.get<GitHubFileResponse>(url);
        fileSha = j.sha;
        const decoded = decodeBase64(j.content || '');
        const parsed = JSON.parse(decoded || '[]');
        existing = Array.isArray(parsed) ? parsed : [];
      } catch {
        this.log.dbg(`No existing ${filePath} found, creating new file`, 'debug');
      }

      const preActiveCount = existing.filter(en => !isWeightEntry(en)).length;
      existing.push(entry);
      const jsonContent = JSON.stringify(existing, null, 2);
      const body: Record<string, string> = {
        message: `Add entry ${dateStr}: ${new Date().toISOString()}`,
        content: encodeBase64(jsonContent),
      };
      if (fileSha) body['sha'] = fileSha;

      const res = await this.put<GitHubPutResponse>(url, body);
      this.state.fileIndex.update(idx => ({ ...idx, [dateStr]: res.content.sha }));
      this.log.dbg(`Pushed entry to ${filePath} (SHA: ${res.content.sha.substring(0, 8)})`, 'info');
      this.notify.showNotification(`Wrote entry to ${filePath}`, 'write');

      if (dateStr === getTodayString() && preActiveCount === 0 && !isWeightEntry(entry)) {
        this.incrementStreakOnAdd(dateStr).catch(err =>
          this.log.dbg('incrementStreakOnAdd error: ' + (err?.message ?? ''), 'warn')
        );
      }
      return true;
    } catch (err) {
      this.log.dbg(`pushEntryForDate error`, 'error', err);
      return false;
    }
  }

  async pushEntriesByDate(entries: AnyEntry[], options: { mode: 'append' | 'replace' } = { mode: 'append' }): Promise<void> {
    if (!Array.isArray(entries) || entries.length === 0) return;
    const groups: Record<string, AnyEntry[]> = {};
    entries.forEach(e => {
      let d = this.getEntryDate(e);
      if (!d && (e as AnyEntry).timestamp) {
        try {
          d = formatDateLocal(new Date((e as AnyEntry).timestamp as string));
        } catch { /* ignore */ }
      }
      if (!d) d = getTodayString();
      if (!groups[d]) groups[d] = [];
      groups[d].push(e);
    });

    for (const dateStr of Object.keys(groups)) {
      if (!this.auth.hasCredentials()) { this.log.dbg('Cannot push entries: Missing credentials', 'error'); return; }
      const repo = this.auth.getRepo()!;
      const dataFolder = this.config.getConfig('dataFolder') || 'data';
      const filePath = `${dataFolder}/${dateStr}.json`;
      const url = `${this.base}/repos/${repo}/contents/${filePath}`;
      this.log.dbg(`Pushing ${groups[dateStr].length} entries to ${filePath}`, 'info');

      try {
        let existing: AnyEntry[] = [];
        let fileSha: string | undefined;
        try {
          const j = await this.get<GitHubFileResponse>(url);
          fileSha = j.sha;
          const decoded = decodeBase64(j.content || '');
          const parsed = JSON.parse(decoded || '[]');
          existing = Array.isArray(parsed) ? parsed : [];
        } catch { /* new file */ }

        let finalArray: AnyEntry[];
        if (options.mode === 'replace') {
          finalArray = groups[dateStr];
        } else {
          const existingKeys = new Set(existing.map(x => JSON.stringify(x)));
          finalArray = existing.slice();
          groups[dateStr].forEach(item => {
            const key = JSON.stringify(item);
            if (!existingKeys.has(key)) { finalArray.push(item); existingKeys.add(key); }
          });
        }

        const jsonContent = JSON.stringify(finalArray, null, 2);
        const body: Record<string, string> = {
          message: `Import: ${dateStr} (${groups[dateStr].length} entries)`,
          content: encodeBase64(jsonContent),
        };
        if (fileSha) body['sha'] = fileSha;

        const res = await this.put<GitHubPutResponse>(url, body);
        this.state.fileIndex.update(idx => ({ ...idx, [dateStr]: res.content.sha }));
        this.log.dbg(`Imported ${groups[dateStr].length} into ${filePath}`, 'info');
        this.notify.showNotification(`Wrote ${groups[dateStr].length} entries to ${filePath}`, 'write');

        const preActiveCount = existing.filter(en => !isWeightEntry(en)).length;
        const hasActiveNow = finalArray.some(en => !isWeightEntry(en));
        if (dateStr === getTodayString() && preActiveCount === 0 && hasActiveNow) {
          this.incrementStreakOnAdd(dateStr).catch(err =>
            this.log.dbg('incrementStreakOnAdd error: ' + (err?.message ?? ''), 'warn')
          );
        }
      } catch (err) {
        this.log.dbg(`pushEntriesByDate error (${dateStr})`, 'error', err);
      }
    }
  }

  async pushDateFile(dateStr: string, finalArray: AnyEntry[]): Promise<boolean> {
    if (!this.auth.hasCredentials()) {
      this.log.dbg('Cannot push date file: Missing credentials', 'error');
      return false;
    }
    if (!Array.isArray(finalArray) || finalArray.length === 0) {
      this.log.dbg(`pushDateFile: finalArray empty for ${dateStr}; deleting file instead`, 'warn');
      return this.deleteDateFile(dateStr);
    }

    const repo = this.auth.getRepo()!;
    const dataFolder = this.config.getConfig('dataFolder') || 'data';
    const filePath = `${dataFolder}/${dateStr}.json`;
    const url = `${this.base}/repos/${repo}/contents/${filePath}`;
    this.log.dbg(`Replacing ${filePath} with ${finalArray.length} entries`, 'info');

    try {
      let fileSha: string | undefined;
      let existing: AnyEntry[] = [];
      let preActiveCount = 0;
      try {
        const j = await this.get<GitHubFileResponse>(url);
        fileSha = j.sha;
        const decoded = decodeBase64(j.content || '');
        const parsed = JSON.parse(decoded || '[]');
        existing = Array.isArray(parsed) ? parsed : [];
        preActiveCount = existing.filter(en => !isWeightEntry(en)).length;
      } catch { /* new file */ }

      const jsonContent = JSON.stringify(finalArray, null, 2);
      const body: Record<string, string> = {
        message: `Sync date ${dateStr}: ${new Date().toISOString()}`,
        content: encodeBase64(jsonContent),
      };
      if (fileSha) body['sha'] = fileSha;

      const res = await this.put<GitHubPutResponse>(url, body);
      this.state.fileIndex.update(idx => ({ ...idx, [dateStr]: res.content.sha }));
      this.log.dbg(`Wrote ${filePath} (SHA: ${res.content.sha.substring(0, 8)})`, 'info');
      this.notify.showNotification(`Saved ${filePath}`, 'write');

      const hasActiveNow = finalArray.some(en => !isWeightEntry(en));
      if (dateStr === getTodayString() && preActiveCount === 0 && hasActiveNow) {
        this.incrementStreakOnAdd(dateStr).catch(err =>
          this.log.dbg('incrementStreakOnAdd error: ' + (err?.message ?? ''), 'warn')
        );
      }
      return true;
    } catch (err) {
      this.log.dbg(`pushDateFile error (${dateStr})`, 'error', err);
      return false;
    }
  }

  async deleteDateFile(dateStr: string): Promise<boolean> {
    if (!this.auth.hasCredentials()) {
      this.log.dbg('Cannot delete date file: Missing credentials', 'error');
      return false;
    }
    const repo = this.auth.getRepo()!;
    const dataFolder = this.config.getConfig('dataFolder') || 'data';
    const filePath = `${dataFolder}/${dateStr}.json`;
    const url = `${this.base}/repos/${repo}/contents/${filePath}`;
    this.log.dbg(`Deleting ${filePath} from repo`, 'info');

    try {
      let fileSha: string | undefined;
      try {
        const j = await this.get<GitHubFileResponse>(url);
        fileSha = j.sha;
      } catch (e: unknown) {
        const err = e as { status?: number };
        if (err?.status === 404) {
          this.state.fileIndex.update(idx => { const n = { ...idx }; delete n[dateStr]; return n; });
          return true;
        }
      }
      if (!fileSha) {
        this.log.dbg(`No SHA found for ${filePath}; aborting delete`, 'warn');
        return false;
      }

      const body = { message: `Delete date ${dateStr}: ${new Date().toISOString()}`, sha: fileSha };
      await this.delete<unknown>(url, body);
      this.state.fileIndex.update(idx => { const n = { ...idx }; delete n[dateStr]; return n; });
      this.log.dbg(`Deleted ${filePath}`, 'info');
      this.notify.showNotification(`Deleted ${filePath}`, 'delete');
      return true;
    } catch (err) {
      this.log.dbg(`deleteDateFile error (${dateStr})`, 'error', err);
      return false;
    }
  }

  async saveBudgetToRepo(budget: number): Promise<boolean> {
    if (!this.auth.hasCredentials()) return false;
    const repo = this.auth.getRepo()!;
    const url = `${this.base}/repos/${repo}/contents/budget.json`;
    const body: Record<string, string> = {
      message: `Budget: ${new Date().toISOString()}`,
      content: encodeBase64(JSON.stringify({ dailyBudget: budget }, null, 2)),
    };
    try {
      const j = await this.get<GitHubFileResponse>(url);
      if (j.sha) body['sha'] = j.sha;
    } catch { /* new file */ }
    try {
      await this.put<unknown>(url, body);
      this.notify.showNotification('Budget saved to repo', 'write');
      this.log.dbg('Budget saved to GitHub', 'info');
      return true;
    } catch (err) {
      this.log.dbg('Failed to save budget', 'error', err);
      return false;
    }
  }

  async loadBudgetFromRepo(): Promise<number | false> {
    if (!this.auth.hasCredentials()) return false;
    const repo = this.auth.getRepo()!;
    const url = `${this.base}/repos/${repo}/contents/budget.json`;
    try {
      const j = await this.get<GitHubFileResponse>(url);
      if (j?.content) {
        const cfg = JSON.parse(decodeBase64(j.content));
        if (cfg && typeof cfg.dailyBudget === 'number') {
          this.log.dbg(`Loaded budget from repo: ${cfg.dailyBudget}`, 'info');
          return cfg.dailyBudget;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  async saveSettingsToRepo(configObj: Record<string, unknown>): Promise<boolean> {
    if (!this.auth.hasCredentials()) {
      this.log.dbg('Cannot save settings: missing GitHub credentials', 'warn');
      return false;
    }
    const repo = this.auth.getRepo()!;
    const url = `${this.base}/repos/${repo}/contents/settings.json`;
    const body: Record<string, string> = {
      message: `Update settings: ${new Date().toISOString()}`,
      content: encodeBase64(JSON.stringify(configObj, null, 2)),
    };

    try {
      let fileSha: string | undefined;
      try {
        const j = await this.get<GitHubFileResponse>(url);
        fileSha = j.sha;
      } catch { /* new file */ }

      if (fileSha) body['sha'] = fileSha;
      await this.put<unknown>(url, body);
      this.notify.showNotification('Settings saved to repo', 'write');
      this.log.dbg('Settings saved to GitHub', 'info');
      return true;
    } catch (e: unknown) {
      const err = e as { status?: number };
      if (err?.status === 409) {
        this.log.dbg('saveSettingsToRepo: conflict (409) — refreshing SHA and retrying', 'warn');
        try {
          const j = await this.get<GitHubFileResponse>(url);
          if (j?.sha) {
            body['sha'] = j.sha;
            await this.put<unknown>(url, body);
            this.notify.showNotification('Settings saved to repo', 'write');
            return true;
          }
        } catch (retryErr) {
          this.log.dbg('saveSettingsToRepo retry error', 'error', retryErr);
        }
      }
      this.log.dbg('Failed to save settings', 'error', e);
      this.notify.showNotification('Failed to save settings to repo', 'error', true);
      return false;
    }
  }

  async loadSettingsFromRepo(): Promise<Record<string, unknown> | false> {
    if (!this.auth.hasCredentials()) return false;
    const repo = this.auth.getRepo()!;
    const url = `${this.base}/repos/${repo}/contents/settings.json`;
    try {
      const j = await this.get<GitHubFileResponse>(url);
      if (j?.content) {
        const cfg = JSON.parse(decodeBase64(j.content));
        if (cfg && typeof cfg === 'object') {
          this.log.dbg('Loaded settings from repo', 'info');
          return cfg as Record<string, unknown>;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  async pushStreakFile(streakObj: unknown): Promise<boolean> {
    if (!this.auth.hasCredentials()) return false;
    const repo = this.auth.getRepo()!;
    const url = `${this.base}/repos/${repo}/contents/data/streak.json`;
    const body: Record<string, string> = {
      message: `Streak: ${new Date().toISOString()}`,
      content: encodeBase64(JSON.stringify(streakObj, null, 2)),
    };
    try {
      const j = await this.get<GitHubFileResponse>(url);
      if (j.sha) body['sha'] = j.sha;
    } catch { /* new file */ }
    try {
      const res = await this.put<GitHubPutResponse>(url, body);
      this.state.fileIndex.update(idx => ({ ...idx, streak: res.content.sha }));
      this.log.dbg('Streak saved to GitHub', 'info');
      this.notify.showNotification('Streak saved', 'write');
      return true;
    } catch (e: unknown) {
      const err = e as { status?: number };
      if (err?.status === 409) {
        try {
          const j = await this.get<GitHubFileResponse>(url);
          if (j?.sha) {
            body['sha'] = j.sha;
            await this.put<unknown>(url, body);
            return true;
          }
        } catch { /* ignore */ }
      }
      this.log.dbg('Failed to save streak', 'error', e);
      return false;
    }
  }

  async listLogChunks(): Promise<GitHubContentsItem[]> {
    if (!this.auth.hasCredentials()) return [];
    const repo = this.auth.getRepo()!;
    const logFolder = this.config.getConfig('logFolder') || 'logs';
    const url = `${this.base}/repos/${repo}/contents/${logFolder}`;
    try {
      const items = await this.get<GitHubContentsItem[]>(url);
      return (items || []).filter(it => it.type === 'file').sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      this.log.dbg('listLogChunks error', 'error', e);
      return [];
    }
  }

  async saveLogs(logs: string[]): Promise<boolean> {
    if (!this.auth.hasCredentials()) return false;
    const repo = this.auth.getRepo()!;
    const logFile = this.config.getConfig('logFile');
    const maxSize = this.config.getConfig('maxLogFileSize');
    const url = `${this.base}/repos/${repo}/contents/${logFile}`;
    const timestamp = new Date().toISOString();
    const newLogContent = `\n\n=== Logs saved at ${timestamp} ===\n` + logs.join('\n');

    let existingContent = '';
    let fileSha: string | undefined;
    try {
      const j = await this.get<GitHubFileResponse>(url);
      fileSha = j.sha;
      existingContent = atob(j.content);
    } catch { /* new file */ }

    let finalContent: string;
    if (existingContent && (existingContent.length + newLogContent.length) < maxSize) {
      finalContent = existingContent + newLogContent;
    } else if (existingContent && existingContent.length >= maxSize) {
      finalContent = `=== Log file reset due to size limit (${maxSize} bytes) ===\n` + newLogContent;
    } else {
      finalContent = newLogContent;
    }

    const body: Record<string, string> = { message: `Update logs: ${timestamp}`, content: btoa(finalContent) };
    if (fileSha) body['sha'] = fileSha;

    try {
      await this.put<unknown>(url, body);
      this.log.dbg(`Logs saved to ${logFile}`, 'info');
      this.notify.showNotification('Logs saved to GitHub', 'write');
      return true;
    } catch (err) {
      this.log.dbg('Failed to save logs', 'error', err);
      return false;
    }
  }

  // Streak increment on first entry of the day
  async incrementStreakOnAdd(dateStr: string): Promise<void> {
    // Load existing streak from repo (data/streak.json) and increment
    if (!this.auth.hasCredentials()) return;
    const repo = this.auth.getRepo()!;
    const url = `${this.base}/repos/${repo}/contents/data/streak.json`;
    try {
      let streakData = this.state.streak();
      try {
        const j = await this.get<GitHubFileResponse>(url);
        const decoded = decodeBase64(j.content || '');
        const parsed = JSON.parse(decoded);
        if (parsed && typeof parsed === 'object') streakData = parsed;
        this.state.fileIndex.update(idx => ({ ...idx, streak: j.sha }));
      } catch { /* no existing streak file */ }
      // Simple increment: if lastActiveDate is yesterday, increment streak; else reset to 1
      const today = getTodayString();
      const yesterday = addDays(today, -1);
      let newStreak = { ...streakData };
      if (newStreak.lastActiveDate === yesterday || newStreak.lastActiveDate === today) {
        if (newStreak.lastActiveDate !== today) {
          newStreak.currentStreak = (newStreak.currentStreak ?? 0) + 1;
          newStreak.lastActiveDate = today;
          if ((newStreak.currentStreak ?? 0) > (newStreak.longestStreak ?? 0)) {
            newStreak.longestStreak = newStreak.currentStreak;
          }
        }
      } else {
        newStreak.currentStreak = 1;
        newStreak.lastActiveDate = today;
        if ((newStreak.longestStreak ?? 0) < 1) newStreak.longestStreak = 1;
      }
      newStreak.computedAt = new Date().toISOString();
      this.state.streak.set(newStreak);
      await this.pushStreakFile(newStreak);
    } catch (err) {
      this.log.dbg('incrementStreakOnAdd error', 'error', err);
    }
  }

  private getEntryDate(e: AnyEntry): string | null {
    const entry = e as Record<string, unknown>;
    if (entry['date'] && typeof entry['date'] === 'string') return entry['date'] as string;
    if (entry['_sourceDate'] && typeof entry['_sourceDate'] === 'string') return entry['_sourceDate'] as string;
    if (entry['timestamp'] && typeof entry['timestamp'] === 'string') {
      try { return formatDateLocal(new Date(entry['timestamp'] as string)); } catch { /* ignore */ }
    }
    return null;
  }
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return formatDateLocal(d);
}
