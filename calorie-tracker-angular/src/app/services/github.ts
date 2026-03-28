import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Entry, DailyData } from '../models/entry.model';
import { Logger } from './logger';
import { Config } from './config';

interface GitHubFileResponse {
  content: string;
  sha: string;
  name: string;
  path: string;
}

@Injectable({
  providedIn: 'root',
})
export class Github {
  private http = inject(HttpClient);
  private logger = inject(Logger);
  private config = inject(Config);

  private getHeaders(): HttpHeaders {
    const token = this.config.getGitHubToken();
    if (!token) {
      throw new Error('GitHub token not configured');
    }
    return new HttpHeaders({
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json'
    });
  }

  async fetchDailyData(date: string): Promise<DailyData | null> {
    try {
      const repo = this.config.getGitHubRepo();
      if (!repo) throw new Error('GitHub repo not configured');

      const dataFolder = this.config.getConfig('dataFolder');
      const filePath = `${dataFolder}/${date}.json`;
      const url = `https://api.github.com/repos/${repo}/contents/${filePath}`;

      this.logger.debug(`Fetching daily data for ${date} from ${url}`);

      const response = await firstValueFrom(
        this.http.get<GitHubFileResponse>(url, { headers: this.getHeaders() })
      );

      const content = atob(response.content);
      const entries = JSON.parse(content) as Entry[];

      this.logger.info(`Fetched ${entries.length} entries for ${date}`);

      return {
        date,
        entries,
        sha: response.sha
      };
    } catch (error: any) {
      if (error.status === 404) {
        this.logger.debug(`No data file found for ${date}`);
        return null;
      }
      this.logger.error(`Failed to fetch data for ${date}`, error);
      throw error;
    }
  }

  async listDataFiles(): Promise<Set<string>> {
    try {
      const repo = this.config.getGitHubRepo();
      if (!repo) throw new Error('GitHub repo not configured');

      const dataFolder = this.config.getConfig('dataFolder');
      const url = `https://api.github.com/repos/${repo}/contents/${dataFolder}`;

      this.logger.debug(`Listing files in ${dataFolder} from ${url}`);

      // Note: listing a directory returns an array of file objects
      const response = await firstValueFrom(
        this.http.get<any[]>(url, { headers: this.getHeaders() })
      );

      const files = new Set<string>();
      response.forEach(item => {
        if (item.type === 'file' && item.name.endsWith('.json')) {
          files.add(item.name.replace('.json', '')); // Store just the date part "2026-01-27"
        }
      });
      
      this.logger.info(`Found ${files.size} data files in repo`);
      return files;
    } catch (error: any) {
      this.logger.error(`Failed to list files`, error);
      // Fallback to empty set, meaning we'll have to try individual fetches or assume empty
      return new Set();
    }
  }

  async fetchMultipleDays(dates: string[]): Promise<Map<string, DailyData>> {
    this.logger.info(`Fetching ${dates.length} days of data`);
    const results = new Map<string, DailyData>();
    
    let datesToFetch = [...dates];
    
    // Optimization: If fetching many days, list files first to avoid 404s
    if (dates.length > 5) {
      this.logger.info('Optimizing fetch: Listing files first to filter out missing dates');
      const availableFiles = await this.listDataFiles();
      
      // Identify missing dates immediately and cache them as empty
      const missingDates = dates.filter(d => !availableFiles.has(d));
      missingDates.forEach(date => {
        results.set(date, { date, entries: [], sha: undefined });
      });
      
      this.logger.info(`Skipping ${missingDates.length} missing days, fetching ${datesToFetch.length - missingDates.length} existing files`);
      
      // Only fetch files that actually exist
      datesToFetch = dates.filter(d => availableFiles.has(d));
    }

    // Fetch in parallel but with some rate limiting
    const batchSize = 5;
    for (let i = 0; i < datesToFetch.length; i += batchSize) {
      const batch = datesToFetch.slice(i, i + batchSize);
      const promises = batch.map(date => 
        this.fetchDailyData(date).catch(err => {
          this.logger.warn(`Failed to fetch ${date}: ${err.message}`);
          return null;
        })
      );

      const batchResults = await Promise.all(promises);
      batchResults.forEach((data, index) => {
        if (data) {
          results.set(data.date, data);
        } else {
             // For small requests where we didn't list files, 
             // if fetch fails (404), cache it as empty so we don't retry.
             // Note: batch[index] matches the promise/data order
             const date = batch[index];
             results.set(date, { date, entries: [], sha: undefined });
        }
      });
    }

    this.logger.info(`Successfully fetched ${results.size}/${dates.length} days`);
    return results;
  }

  async pushDailyData(date: string, entries: Entry[], sha?: string): Promise<string> {
    try {
      const repo = this.config.getGitHubRepo();
      if (!repo) throw new Error('GitHub repo not configured');

      const dataFolder = this.config.getConfig('dataFolder');
      const filePath = `${dataFolder}/${date}.json`;
      const url = `https://api.github.com/repos/${repo}/contents/${filePath}`;

      const content = btoa(JSON.stringify(entries, null, 2));
      const body: any = {
        message: `Update ${date} entries (${entries.length} entries)`,
        content
      };

      if (sha) {
        body.sha = sha;
      }

      this.logger.debug(`Pushing ${entries.length} entries for ${date}`);

      const response = await firstValueFrom(
        this.http.put<{ content: { sha: string } }>(url, body, { headers: this.getHeaders() })
      );

      const newSha = response.content.sha;
      this.logger.info(`Successfully pushed data for ${date}, new SHA: ${newSha}`);
      
      return newSha;
    } catch (error) {
      this.logger.error(`Failed to push data for ${date}`, error);
      throw error;
    }
  }

  async deleteDailyData(date: string, sha: string): Promise<void> {
    try {
      const repo = this.config.getGitHubRepo();
      if (!repo) throw new Error('GitHub repo not configured');

      const dataFolder = this.config.getConfig('dataFolder');
      const filePath = `${dataFolder}/${date}.json`;
      const url = `https://api.github.com/repos/${repo}/contents/${filePath}`;

      const body = {
        message: `Delete ${date} entries`,
        sha
      };

      this.logger.debug(`Deleting data file for ${date}`);

      await firstValueFrom(
        this.http.request('DELETE', url, { 
          headers: this.getHeaders(),
          body 
        })
      );

      this.logger.info(`Successfully deleted data for ${date}`);
    } catch (error) {
      this.logger.error(`Failed to delete data for ${date}`, error);
      throw error;
    }
  }
}

