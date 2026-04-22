/*
Handoff note for Mr. Smith:
- File: `src/lib/eventRegistrationForm.ts`
- What this is: Frontend shared helper module.
- What it does: Holds reusable client logic, types, and config used across the web app.
- Connections: Imported by pages/components and often mirrors backend contracts.
- Main content type: Logic/config/data-shaping (not page layout).
- Safe edits here: Additive helpers and text constants.
- Be careful with: Changing exported behavior/types that many files consume.
- Useful context: If a bug appears across multiple pages, this shared layer is a likely source.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

export type EventRegistrationFieldType =
  | 'short_text'
  | 'long_text'
  | 'email'
  | 'phone'
  | 'number'
  | 'date'
  | 'dropdown'
  | 'multi_select'
  | 'checkbox'
  | 'radio_yes_no'
  | 'repeatable_person_list'
  | 'signature_typed';

export type EventRegistrationSectionType = 'single' | 'repeating_child';
export type EventRegistrationPolicyType = 'required_checkbox' | 'yes_no' | 'info_only';
export type EventRegistrationChildCountSource = 'ticket_quantity' | 'field_value';

export type EventRegistrationFieldDefinition = {
  id: string;
  type: EventRegistrationFieldType;
  label: string;
  required?: boolean;
  hidden?: boolean;
  helpText?: string;
  placeholder?: string;
  options?: string[];
  showWhen?: {
    fieldId: string;
    equals: string | number | boolean;
  };
};

export type EventRegistrationSectionDefinition = {
  id: string;
  title: string;
  description?: string;
  type: EventRegistrationSectionType;
  hidden?: boolean;
  fields: EventRegistrationFieldDefinition[];
};

export type EventRegistrationPolicyDefinition = {
  id: string;
  title: string;
  body?: string;
  type: EventRegistrationPolicyType;
  required?: boolean;
  label?: string;
};

export type EventRegistrationDefinition = {
  schemaVersion: string;
  sections: EventRegistrationSectionDefinition[];
  policies: EventRegistrationPolicyDefinition[];
  signature?: {
    enabled?: boolean;
    legalText?: string;
    requireNameMatch?: boolean;
  };
};

export type EventRegistrationSettings = {
  enabled: boolean;
  requireSignature: boolean;
  requireAcknowledgments: boolean;
  childCountSource: EventRegistrationChildCountSource;
  childCountSectionId?: string;
  childCountFieldId?: string;
};

export type EventRegistrationAdminFormResponse = {
  performance: {
    id: string;
    title: string;
    isFundraiser: boolean;
  };
  form: {
    id: string;
    performanceId: string;
    formName: string;
    internalDescription?: string | null;
    status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
    settings: EventRegistrationSettings;
    definition: EventRegistrationDefinition;
    createdAt: string;
    updatedAt: string;
    archivedAt?: string | null;
    publishedVersion?: {
      id: string;
      versionNumber: number;
      formName: string;
      settings: EventRegistrationSettings;
      definition: EventRegistrationDefinition;
      publishedAt: string;
    } | null;
  } | null;
  defaults: {
    formName: string;
    internalDescription?: string;
    settings: EventRegistrationSettings;
    definition: EventRegistrationDefinition;
  };
};

export type EventRegistrationPublicFormResponse =
  | {
      enabled: false;
    }
  | {
      enabled: true;
      formId: string;
      performanceId: string;
      formName: string;
      settings: EventRegistrationSettings;
      definition: EventRegistrationDefinition;
      versionId: string;
      versionNumber: number;
      publishedAt: string;
    };

export type EventRegistrationSubmissionPayload = {
  formVersionId: string;
  sections: Record<string, Record<string, unknown> | Array<Record<string, unknown>>>;
  policies: Record<string, unknown>;
  acknowledgments: {
    infoAccurate: boolean;
    policiesRead: boolean;
    emergencyCare: boolean;
    participationRules: boolean;
  };
  signature: {
    typedName: string;
    printedName: string;
  };
};

export type EventRegistrationFieldErrors = Record<string, string>;

export function createBuilderId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 12)}`;
}

export function normalizeOptions(value: string): string[] {
  return Array.from(new Set(value.split('\n').map((item) => item.trim()).filter(Boolean)));
}

export function fieldDefaultValue(type: EventRegistrationFieldType): unknown {
  if (type === 'checkbox') return false;
  if (type === 'multi_select') return [];
  if (type === 'number') return '';
  if (type === 'radio_yes_no') return '';
  return '';
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => asRecord(entry));
}

export function isFieldVisible(field: EventRegistrationFieldDefinition, currentValues: Record<string, unknown>): boolean {
  if (!field.showWhen) return true;
  const actual = currentValues[field.showWhen.fieldId];
  if (typeof actual === 'string') {
    return actual.toLowerCase() === String(field.showWhen.equals).toLowerCase();
  }
  return actual === field.showWhen.equals;
}

export function normalizeYesNo(value: unknown): 'yes' | 'no' | '' {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'yes' || normalized === 'no') return normalized;
  return '';
}

export function resolveChildCount(params: {
  settings: EventRegistrationSettings;
  sections: Record<string, Record<string, unknown> | Array<Record<string, unknown>>>;
  ticketQuantity: number;
}): number {
  if (params.settings.childCountSource === 'ticket_quantity') {
    return Math.max(0, params.ticketQuantity);
  }

  if (!params.settings.childCountSectionId || !params.settings.childCountFieldId) {
    return Math.max(0, params.ticketQuantity);
  }

  const source = asRecord(params.sections[params.settings.childCountSectionId]);
  const value = Number(String(source[params.settings.childCountFieldId] ?? '').trim());
  if (!Number.isFinite(value)) return Math.max(0, params.ticketQuantity);
  return Math.max(0, Math.floor(value));
}
