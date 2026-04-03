export interface SchemaField {
  name: string;
  type: 'text' | 'number' | 'date' | 'time' | 'select' | 'hidden';
  label?: string;
  required?: boolean;
  placeholder?: string;
  default?: string | number;
  autoCapture?: boolean;
  min?: number;
  max?: number;
  options?: string[];
}

export interface Schema {
  name: string;
  displayName: string;
  fields: SchemaField[];
  totalField: string;
  displayFormat?: string;
}
