import { Pipe, PipeTransform } from '@angular/core';
import { Config } from '../services/config';

@Pipe({
  name: 'dateTimeFormat',
  standalone: true,
  pure: false // Make impure so it updates when config changes
})
export class DateTimeFormatPipe implements PipeTransform {
  constructor(private config: Config) {}

  transform(timestamp: number | Date): string {
    const timeFormat = this.config.getConfig('timeFormat');
    const date = typeof timestamp === 'number' ? new Date(timestamp) : timestamp;
    
    if (isNaN(date.getTime())) {
      return 'Invalid date';
    }

    // Format date part
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const datePart = `${month}/${day}/${year}`;

    // Format time part
    const hours = date.getHours();
    const minutes = date.getMinutes();

    let timePart: string;
    if (timeFormat === '12h') {
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;
      const displayMinutes = minutes.toString().padStart(2, '0');
      timePart = `${displayHours}:${displayMinutes} ${ampm}`;
    } else {
      const displayHours = hours.toString().padStart(2, '0');
      const displayMinutes = minutes.toString().padStart(2, '0');
      timePart = `${displayHours}:${displayMinutes}`;
    }

    return `${datePart}, ${timePart}`;
  }
}
