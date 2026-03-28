import { Injectable } from '@angular/core';
import { AppConfig, DEFAULT_CONFIG } from '../models/config.model';

@Injectable({
  providedIn: 'root',
})
export class Config {
  private readonly CONFIG_PREFIX = 'config_';

  getConfig<K extends keyof AppConfig>(key: K): AppConfig[K] {
    const stored = localStorage.getItem(`${this.CONFIG_PREFIX}${key}`);
    return stored !== null ? JSON.parse(stored) : DEFAULT_CONFIG[key];
  }

  setConfig<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    localStorage.setItem(`${this.CONFIG_PREFIX}${key}`, JSON.stringify(value));
  }

  getAllConfig(): AppConfig {
    const config = { ...DEFAULT_CONFIG } as AppConfig;
    (Object.keys(DEFAULT_CONFIG) as Array<keyof AppConfig>).forEach(key => {
      const stored = localStorage.getItem(`${this.CONFIG_PREFIX}${key}`);
      if (stored !== null) {
        (config as any)[key] = JSON.parse(stored);
      }
    });
    return config;
  }

  resetConfig(): void {
    (Object.keys(DEFAULT_CONFIG) as Array<keyof AppConfig>).forEach(key => {
      localStorage.removeItem(`${this.CONFIG_PREFIX}${key}`);
    });
  }

  // GitHub credentials
  getGitHubToken(): string | null {
    return localStorage.getItem('github_token');
  }

  setGitHubToken(token: string): void {
    localStorage.setItem('github_token', token);
  }

  getGitHubRepo(): string | null {
    return localStorage.getItem('github_repo');
  }

  setGitHubRepo(repo: string): void {
    localStorage.setItem('github_repo', repo);
  }

  hasCredentials(): boolean {
    return !!this.getGitHubToken() && !!this.getGitHubRepo();
  }
}

