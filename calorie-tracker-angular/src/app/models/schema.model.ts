export interface SchemaField {
  name: string;
  type: 'text' | 'number' | 'date' | 'select' | 'hidden';
  label: string;
  required?: boolean;
  autoCapture?: boolean;
  default?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  options?: string[];
}

export interface Schema {
  name: string;
  displayName: string;
  fields: SchemaField[];
}
