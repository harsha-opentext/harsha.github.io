import { Injectable, signal } from '@angular/core';

export interface ConfirmState {
  open: boolean;
  title: string;
  message: string;
  details: string | null;
  yesLabel: string;
  yesDisabled: boolean;
  noDisabled: boolean;
}

type Resolver = (value: boolean) => void;

@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly state = signal<ConfirmState>({
    open: false,
    title: 'Confirm',
    message: '',
    details: null,
    yesLabel: 'Delete',
    yesDisabled: false,
    noDisabled: false,
  });

  private resolver: Resolver | null = null;

  show(message: string, title = 'Confirm', details: string | null = null): Promise<boolean> {
    return new Promise(resolve => {
      this.resolver = resolve;
      this.state.set({ open: true, title, message, details, yesLabel: 'Delete', yesDisabled: false, noDisabled: false });
    });
  }

  confirm(): void {
    this.state.update(s => ({ ...s, yesDisabled: true, noDisabled: true, yesLabel: 'Deleting...' }));
    this.resolver?.(true);
    this.resolver = null;
  }

  cancel(): void {
    this.close();
    this.resolver?.(false);
    this.resolver = null;
  }

  close(): void {
    this.state.update(s => ({ ...s, open: false, details: null, yesLabel: 'Delete', yesDisabled: false, noDisabled: false }));
  }
}
