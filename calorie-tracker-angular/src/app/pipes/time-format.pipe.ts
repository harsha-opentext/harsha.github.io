import { Pipe, PipeTransform } from '@angular/core';
import { Config } from '../services/config';

@Pipe({
  name: 'timeFormat',
  standalone: true,
  pure: false // Make impure so it updates when config changes
})
export class TimeFormatPipe implements PipeTransform {
  constructor(private config: Config) {}

  transform(timestamp: number | Date, format?: '12h' | '24h'): string {
    const timeFormat = format || this.config.getConfig('timeFormat');
    const date = typeof timestamp === 'number' ? new Date(timestamp) : timestamp;
    
    if (isNaN(date.getTime())) {
      return 'Invalid date';
    }

    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();

    if (timeFormat === '12h') {
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;
      const displayMinutes = minutes.toString().padStart(2, '0');
      return `${displayHours}:${displayMinutes} ${ampm}`;
    } else {
      const displayHours = hours.toString().padStart(2, '0');
      const displayMinutes = minutes.toString().padStart(2, '0');
      return `${displayHours}:${displayMinutes}`;
    }
  }
}
