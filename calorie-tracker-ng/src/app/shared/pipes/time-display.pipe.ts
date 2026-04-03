import { Pipe, PipeTransform } from '@angular/core';
import { timeTo24, time24To12 } from '../utils/time.utils';

@Pipe({ name: 'timeDisplay', standalone: true })
export class TimeDisplayPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (!value) return '';
    return value;
  }
}
