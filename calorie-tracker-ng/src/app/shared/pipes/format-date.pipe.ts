import { Pipe, PipeTransform } from '@angular/core';
import { formatDateReadable } from '../utils/date.utils';

@Pipe({ name: 'formatDateReadable', standalone: true })
export class FormatDateReadablePipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (!value) return '—';
    return formatDateReadable(value);
  }
}
