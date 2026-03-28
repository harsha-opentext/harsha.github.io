import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';
import { Schema as SchemaModel } from '../models/schema.model';
import { Logger } from './logger';
import * as jsyaml from 'js-yaml';

@Injectable({
  providedIn: 'root',
})
export class Schema {
  private http = inject(HttpClient);
  private logger = inject(Logger);

  async loadSchema(schemaFile: string): Promise<SchemaModel> {
    try {
      this.logger.info(`Loading schema from ${schemaFile}`);
      const response = await firstValueFrom(this.http.get(schemaFile, { responseType: 'text' }));
      const parsed = jsyaml.load(response) as { schema: SchemaModel };
      
      if (!parsed.schema) {
        throw new Error('Invalid schema format: missing "schema" key');
      }
      
      this.logger.info('Schema loaded successfully', parsed.schema);
      return parsed.schema;
    } catch (error) {
      this.logger.error('Failed to load schema', error);
      throw error;
    }
  }
}

