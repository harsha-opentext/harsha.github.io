import { Injectable, signal } from '@angular/core';
import { AnyEntry } from '../../../core/models/entry.model';

export interface EntryPreviewState {
  open: boolean;
  title: string;
  confirmLabel?: string;
  entry: AnyEntry | null;
}

@Injectable({ providedIn: 'root' })
export class EntryPreviewService {
  readonly state = signal<EntryPreviewState>({ open: false, title: '', entry: null });

  private _resolve: ((entry: AnyEntry) => void) | null = null;
  private _reject: (() => void) | null = null;

  /** Opens the modal and resolves with the edited entry, or null if cancelled */
  prompt(entry: AnyEntry, title = 'Review & Edit Entry', confirmLabel = 'Add to Today'): Promise<AnyEntry | null> {
    return new Promise(resolve => {
      this._resolve = (e) => resolve(e);
      this._reject = () => resolve(null);
      this.state.set({ open: true, title, confirmLabel, entry });
    });
  }

  resolve(entry: AnyEntry): void {
    const cb = this._resolve;
    this._cleanup();
    cb?.(entry);
  }

  reject(): void {
    const cb = this._reject;
    this._cleanup();
    cb?.();
  }

  private _cleanup(): void {
    this._resolve = null;
    this._reject = null;
    this.state.set({ open: false, title: '', entry: null });
  }
}
