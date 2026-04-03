import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class AuthService {
  getToken(): string | null {
    return localStorage.getItem('gt_token');
  }

  setToken(token: string): void {
    localStorage.setItem('gt_token', token);
  }

  getRepo(): string | null {
    return localStorage.getItem('gt_repo');
  }

  setRepo(repo: string): void {
    localStorage.setItem('gt_repo', repo);
  }

  hasCredentials(): boolean {
    return !!(this.getToken() && this.getRepo());
  }
}
