import { Component, OnInit, inject } from '@angular/core';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { filter } from 'rxjs/operators';
import { Schema } from './services/schema';
import { State } from './services/state';
import { Logger } from './services/logger';
import { Config } from './services/config';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  private router = inject(Router);
  private schemaService = inject(Schema);
  private state = inject(State);
  private logger = inject(Logger);
  private config = inject(Config);

  currentRoute = '/tracker';
  
  pages = [
    { route: '/tracker', label: 'Tracker', icon: '📝' },
    { route: '/history', label: 'History', icon: '📅' },
    { route: '/analytics', label: 'Analytics', icon: '📈' },
    { route: '/settings', label: 'Settings', icon: '⚙️' },
    { route: '/logs', label: 'Logs', icon: '📋' }
  ];

  ngOnInit(): void {
    // Track current route
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event: any) => {
        this.currentRoute = event.url;
      });

    // Load schema on startup
    this.loadSchema();
  }

  async loadSchema(): Promise<void> {
    try {
      this.logger.info('App initializing, loading schema...');
      const schemaFile = this.config.getConfig('schemaFile');
      this.logger.debug(`Schema file path: ${schemaFile}`);
      const schema = await this.schemaService.loadSchema(schemaFile);
      this.state.setSchema(schema);
    } catch (error) {
      this.logger.error('Failed to load schema on startup', error);
    }
  }

  navigateTo(route: string): void {
    this.router.navigate([route]);
  }
}

