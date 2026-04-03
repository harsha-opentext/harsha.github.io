import { Injectable } from '@angular/core';
import { AppConfig, DEFAULT_CONFIG } from '../models/config.model';

@Injectable({ providedIn: 'root' })
export class ConfigService {
  getConfig<K extends keyof AppConfig>(key: K): AppConfig[K] {
    const stored = localStorage.getItem(`config_${key}`);
    return stored !== null ? (JSON.parse(stored) as AppConfig[K]) : DEFAULT_CONFIG[key];
  }

  setConfig<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    localStorage.setItem(`config_${key}`, JSON.stringify(value));
  }

  getAllConfig(): AppConfig {
    const config = { ...DEFAULT_CONFIG };
    (Object.keys(DEFAULT_CONFIG) as (keyof AppConfig)[]).forEach(key => {
      const stored = localStorage.getItem(`config_${key}`);
      if (stored !== null) {
        (config as Record<string, unknown>)[key] = JSON.parse(stored);
      }
    });
    return config;
  }
}
