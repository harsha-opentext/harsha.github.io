import { Injectable, signal } from '@angular/core';
import { inject } from '@angular/core';
import { ConfigService } from './config.service';

export type NotificationType = 'info' | 'write' | 'read' | 'error' | 'delete' | 'success';

export interface Toast {
  id: number;
  message: string;
  type: NotificationType;
}

export interface NotificationDot {
  id: number;
  color: string;
  title: string;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly config = inject(ConfigService);
  readonly toasts = signal<Toast[]>([]);
  readonly dots = signal<NotificationDot[]>([]);
  private nextId = 0;

  showNotification(message: string, type: NotificationType = 'info', forceFull = false): void {
    const alwaysFull = type === 'error';
    const enabled = !!this.config.getConfig('showToasts');
    if (enabled || forceFull || alwaysFull) {
      this.showFullNotification(message, type);
    } else {
      this.showDot(message, type);
    }
  }

  showFullNotification(message: string, type: NotificationType = 'info'): void {
    const id = this.nextId++;
    const toast: Toast = { id, message, type };
    this.toasts.update(prev => [...prev, toast]);
    setTimeout(() => {
      this.toasts.update(prev => prev.filter(t => t.id !== id));
    }, 2800);
  }

  private showDot(title: string, type: NotificationType): void {
    const colorMap: Record<NotificationType, string> = {
      error:   '#ff453a',
      delete:  '#ff453a',
      write:   '#30d158',
      success: '#30d158',
      read:    '#0a84ff',
      info:    '#0a84ff',
    };
    const id = this.nextId++;
    const dot: NotificationDot = { id, color: colorMap[type] ?? '#0a84ff', title };
    this.dots.update(prev => [...prev, dot]);
    setTimeout(() => {
      this.dots.update(prev => prev.filter(d => d.id !== id));
    }, 2200);
  }

  removeToast(id: number): void {
    this.toasts.update(prev => prev.filter(t => t.id !== id));
  }
}
