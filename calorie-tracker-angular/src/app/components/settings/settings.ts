import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Config } from '../../services/config';
import { Logger } from '../../services/logger';

@Component({
  selector: 'app-settings',
  imports: [CommonModule, FormsModule],
  templateUrl: './settings.html',
  styleUrl: './settings.scss'
})
export class Settings implements OnInit {
  private configService = inject(Config);
  private logger = inject(Logger);

  githubToken = '';
  githubRepo = '';
  dailyBudget = 2000;
  timeFormat: '12h' | '24h' = '12h';
  dataFolder = 'data';
  logRetentionMinutes = 5;
  
  saved = false;

  ngOnInit(): void {
    this.loadSettings();
  }

  loadSettings(): void {
    this.githubToken = this.configService.getGitHubToken() || '';
    this.githubRepo = this.configService.getGitHubRepo() || '';
    this.dailyBudget = this.configService.getConfig('dailyBudget');
    this.timeFormat = this.configService.getConfig('timeFormat');
    this.dataFolder = this.configService.getConfig('dataFolder');
    this.logRetentionMinutes = this.configService.getConfig('logRetentionMinutes');
  }

  saveSettings(): void {
    this.configService.setGitHubToken(this.githubToken);
    this.configService.setGitHubRepo(this.githubRepo);
    this.configService.setConfig('dailyBudget', this.dailyBudget);
    this.configService.setConfig('timeFormat', this.timeFormat);
    this.configService.setConfig('dataFolder', this.dataFolder);
    this.configService.setConfig('logRetentionMinutes', this.logRetentionMinutes);
    
    this.logger.info('Settings saved successfully');
    
    this.saved = true;
    setTimeout(() => this.saved = false, 2000);
  }

  resetSettings(): void {
    if (!confirm('Are you sure you want to reset all settings to defaults?')) return;
    
    this.configService.resetConfig();
    localStorage.removeItem('github_token');
    localStorage.removeItem('github_repo');
    
    this.loadSettings();
    this.logger.info('Settings reset to defaults');
  }
}

