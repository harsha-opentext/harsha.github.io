import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import * as jsyaml from 'js-yaml';
import { Schema, SchemaField } from '../models/schema.model';
import { StateService } from './state.service';
import { ConfigService } from './config.service';
import { LoggingService } from './logging.service';

@Injectable({ providedIn: 'root' })
export class SchemaService {
  private readonly http = inject(HttpClient);
  private readonly state = inject(StateService);
  private readonly config = inject(ConfigService);
  private readonly log = inject(LoggingService);

  async loadSchema(): Promise<boolean> {
    try {
      const schemaFile = this.config.getConfig('schemaFile') || 'schema.yaml';
      this.log.dbg('Attempting to load schema.yaml', 'debug');
      const yamlText = await firstValueFrom(
        this.http.get(schemaFile, { responseType: 'text' })
      );
      this.log.dbg('Schema file fetched successfully', 'debug');
      const parsed = jsyaml.load(yamlText) as { schema?: Schema };
      if (!parsed || !parsed.schema) {
        throw new Error('Invalid schema format: missing "schema" key');
      }
      const schema = parsed.schema;
      // Inject healthScore if missing
      if (!schema.fields.some((f: SchemaField) => f.name === 'healthScore')) {
        schema.fields.push({
          name: 'healthScore',
          type: 'number',
          label: 'Health Score (1-10)',
          required: false,
          min: 1,
          max: 10,
          placeholder: 'Optional - 1 (poor) .. 10 (excellent)',
        });
        this.log.dbg('Runtime: injected healthScore into schema.fields', 'debug');
      }
      this.state.schema.set(schema);
      this.log.dbg(`Schema loaded: ${schema.displayName} (${schema.fields.length} fields)`, 'info');
      return true;
    } catch (err: unknown) {
      const e = err as { message?: string };
      this.log.dbg(`Failed to load schema: ${e?.message ?? String(err)}`, 'error');
      return false;
    }
  }
}
