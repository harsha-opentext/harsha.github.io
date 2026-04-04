import { Injectable, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { WorkoutGithubApiService } from '../../../core/services/workout-github-api.service';
import { WorkoutStateService } from '../../../core/services/workout-state.service';
import { AuthService } from '../../../core/services/auth.service';
import { LoggingService } from '../../../core/services/logging.service';
import { NotificationService } from '../../../core/services/notification.service';
import { WorkoutConfig } from '../../../core/models/workout-config.model';

@Injectable({ providedIn: 'root' })
export class WorkoutSettingsService {
  private readonly workoutGithub = inject(WorkoutGithubApiService);
  private readonly workoutState = inject(WorkoutStateService);
  private readonly auth = inject(AuthService);
  private readonly log = inject(LoggingService);
  private readonly notify = inject(NotificationService);

  readonly saving = signal(false);

  private configSaveSubject = new Subject<WorkoutConfig>();

  constructor() {
    this.configSaveSubject.pipe(debounceTime(250)).subscribe(cfg => {
      this.workoutGithub.saveWorkoutConfig(cfg).catch(err =>
        this.log.dbg('Workout config save (debounced) failed: ' + String(err), 'error')
      );
    });
  }

  enqueueConfigSave(cfg: WorkoutConfig): void {
    this.workoutState.config.set(cfg);
    if (this.auth.hasCredentials()) {
      this.configSaveSubject.next(cfg);
    }
  }

  async loadFromRepo(): Promise<void> {
    await this.workoutGithub.loadWorkoutConfig();
  }
}
