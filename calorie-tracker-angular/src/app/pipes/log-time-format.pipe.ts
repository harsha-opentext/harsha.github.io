import { Pipe, PipeTransform } from '@angular/core';
import { Config } from '../services/config';

@Pipe({
  name: 'logTimeFormat',
  standalone: true,
  pure: false // Make impure so it updates when config changes
})
export class LogTimeFormatPipe implements PipeTransform {
  constructor(private config: Config) {}

  transform(timestamp: number | Date): string {
    const timeFormat = this.config.getConfig('timeFormat');
    const date = typeof timestamp === 'number' ? new Date(timestamp) : timestamp;
    
    if (isNaN(date.getTime())) {
      return 'Invalid date';
    }

    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();
    const milliseconds = date.getMilliseconds();

    if (timeFormat === '12h') {
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;
      const displayMinutes = minutes.toString().padStart(2, '0');
      const displaySeconds = seconds.toString().padStart(2, '0');
      const displayMs = milliseconds.toString().padStart(3, '0');
      return `${displayHours}:${displayMinutes}:${displaySeconds}.${displayMs} ${ampm}`;
    } else {
      const displayHours = hours.toString().padStart(2, '0');
      const displayMinutes = minutes.toString().padStart(2, '0');
      const displaySeconds = seconds.toString().padStart(2, '0');
      const displayMs = milliseconds.toString().padStart(3, '0');
      return `${displayHours}:${displayMinutes}:${displaySeconds}.${displayMs}`;
    }
  }
}
