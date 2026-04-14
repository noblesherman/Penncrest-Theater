import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { HttpError } from './http-error.js';

export const EVENT_REGISTRATION_SCHEMA_VERSION = 'EVENT_REGISTRATION_V1';

export const formFieldTypeSchema = z.enum([
  'short_text',
  'long_text',
  'email',
  'phone',
  'number',
  'date',
  'dropdown',
  'multi_select',
  'checkbox',
  'radio_yes_no',
  'repeatable_person_list',
  'signature_typed'
]);

export const sectionTypeSchema = z.enum(['single', 'repeating_child']);
export const policyTypeSchema = z.enum(['required_checkbox', 'yes_no', 'info_only']);
export const childCountSourceSchema = z.enum(['ticket_quantity', 'field_value']);

export type EventRegistrationFieldType = z.infer<typeof formFieldTypeSchema>;
export type EventRegistrationSectionType = z.infer<typeof sectionTypeSchema>;
export type EventRegistrationPolicyType = z.infer<typeof policyTypeSchema>;
export type EventRegistrationChildCountSource = z.infer<typeof childCountSourceSchema>;

const stringOrBooleanSchema = z.union([z.string(), z.boolean(), z.number()]);

export const eventRegistrationFieldSchema = z.object({
  id: z.string().trim().min(1).max(120),
  type: formFieldTypeSchema,
  label: z.string().trim().min(1).max(200),
  required: z.boolean().optional(),
  hidden: z.boolean().optional(),
  helpText: z.string().trim().max(1_200).optional(),
  placeholder: z.string().trim().max(300).optional(),
  options: z.array(z.string().trim().min(1).max(160)).max(100).optional(),
  showWhen: z
    .object({
      fieldId: z.string().trim().min(1).max(120),
      equals: stringOrBooleanSchema
    })
    .optional()
});

export const eventRegistrationSectionSchema = z.object({
  id: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).optional(),
  type: sectionTypeSchema,
  hidden: z.boolean().optional(),
  fields: z.array(eventRegistrationFieldSchema).max(200)
});

export const eventRegistrationPolicySchema = z.object({
  id: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().max(8_000).optional(),
  type: policyTypeSchema,
  required: z.boolean().optional(),
  label: z.string().trim().max(300).optional()
});

export const eventRegistrationSignatureConfigSchema = z.object({
  enabled: z.boolean().default(true),
  legalText: z.string().trim().max(8_000).optional(),
  requireNameMatch: z.boolean().optional()
});

export const eventRegistrationDefinitionSchema = z.object({
  schemaVersion: z.string().trim().default(EVENT_REGISTRATION_SCHEMA_VERSION),
  sections: z.array(eventRegistrationSectionSchema).max(60),
  policies: z.array(eventRegistrationPolicySchema).max(60),
  signature: eventRegistrationSignatureConfigSchema.optional()
});

export const eventRegistrationSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  requireSignature: z.boolean().default(true),
  requireAcknowledgments: z.boolean().default(true),
  childCountSource: childCountSourceSchema.default('ticket_quantity'),
  childCountSectionId: z.string().trim().min(1).max(120).optional(),
  childCountFieldId: z.string().trim().min(1).max(120).optional()
});

export const eventRegistrationSubmissionSchema = z.object({
  formVersionId: z.string().trim().min(1).max(120),
  sections: z.record(z.unknown()).optional(),
  policies: z.record(z.unknown()).optional(),
  acknowledgments: z
    .object({
      infoAccurate: z.boolean().optional(),
      policiesRead: z.boolean().optional(),
      emergencyCare: z.boolean().optional(),
      participationRules: z.boolean().optional()
    })
    .optional(),
  signature: z
    .object({
      typedName: z.string().trim().max(200).optional(),
      printedName: z.string().trim().max(200).optional()
    })
    .optional()
});

export type EventRegistrationFieldDefinition = z.infer<typeof eventRegistrationFieldSchema>;
export type EventRegistrationSectionDefinition = z.infer<typeof eventRegistrationSectionSchema>;
export type EventRegistrationPolicyDefinition = z.infer<typeof eventRegistrationPolicySchema>;
export type EventRegistrationSignatureConfig = z.infer<typeof eventRegistrationSignatureConfigSchema>;
export type EventRegistrationDefinition = z.infer<typeof eventRegistrationDefinitionSchema>;
export type EventRegistrationSettings = z.infer<typeof eventRegistrationSettingsSchema>;
export type EventRegistrationSubmissionPayload = z.infer<typeof eventRegistrationSubmissionSchema>;

export type ValidatedEventRegistrationSubmission = {
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
    dateSigned: string;
    ipAddress: string | null;
  };
};

const GRADE_OPTIONS = ['3rd Grade', '4th Grade', '5th Grade'];
const T_SHIRT_OPTIONS = ['Youth XS', 'Youth S', 'Youth M', 'Youth L', 'Youth XL', 'Adult S', 'Adult M', 'Adult L', 'Adult XL'];
const EXCITEMENT_OPTIONS = ['Acting', 'Singing', 'Dancing', 'Costumes', 'Games', 'Making Friends', 'Everything'];

const DEFAULT_SIGNATURE_LEGAL_TEXT =
  'By typing my name below, I confirm I am the parent or legal guardian of the registered child or children and I agree to the event policies and acknowledgments provided in this form.';

const DEFAULT_PARENT_CERTIFICATION_TEXT =
  'I confirm that the information submitted in this registration form is accurate to the best of my knowledge. I confirm that I am the parent or legal guardian of the child or children listed above. I acknowledge that I have read the event policies provided in this form, including pickup, lunch, medication, and emergency care information. By typing my name below, I agree to these acknowledgments and permissions for participation in this event.';

function toUniqueTrimmed(options: string[] | undefined): string[] {
  if (!options || options.length === 0) return [];
  return Array.from(new Set(options.map((option) => option.trim()).filter(Boolean)));
}

function normalizeFieldType(rawType: unknown): EventRegistrationFieldType {
  if (typeof rawType !== 'string') return 'short_text';
  const type = rawType.trim().toLowerCase();
  if (type === 'text') return 'short_text';
  if (type === 'textarea') return 'long_text';
  if (type === 'select') return 'dropdown';
  if (type === 'radio_yes_no' || type === 'yes_no') return 'radio_yes_no';
  if (type === 'signature') return 'signature_typed';
  if (formFieldTypeSchema.options.includes(type as EventRegistrationFieldType)) {
    return type as EventRegistrationFieldType;
  }
  return 'short_text';
}

function sanitizeFieldOptions(type: EventRegistrationFieldType, options: string[] | undefined): string[] {
  if (type === 'radio_yes_no') {
    return ['yes', 'no'];
  }
  if (type !== 'dropdown' && type !== 'multi_select') {
    return [];
  }
  return toUniqueTrimmed(options);
}

export function normalizeEventRegistrationDefinition(value: Prisma.JsonValue | null | undefined): EventRegistrationDefinition {
  const raw = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const rawSections = Array.isArray(raw.sections) ? raw.sections : [];
  const rawPolicies = Array.isArray(raw.policies) ? raw.policies : [];
  const seenSectionIds = new Set<string>();

  const sections: EventRegistrationSectionDefinition[] = rawSections
    .map((sectionRaw) => {
      const section = (sectionRaw && typeof sectionRaw === 'object' && !Array.isArray(sectionRaw)
        ? sectionRaw
        : {}) as Record<string, unknown>;
      const id = String(section.id || '').trim();
      const title = String(section.title || '').trim();
      const type = section.type === 'repeating_child' ? 'repeating_child' : 'single';
      if (!id || !title || seenSectionIds.has(id)) return null;
      seenSectionIds.add(id);

      const seenFieldIds = new Set<string>();
      const rawFields = Array.isArray(section.fields) ? section.fields : [];
      const fields: EventRegistrationFieldDefinition[] = rawFields
        .map((fieldRaw) => {
          const field = (fieldRaw && typeof fieldRaw === 'object' && !Array.isArray(fieldRaw)
            ? fieldRaw
            : {}) as Record<string, unknown>;
          const fieldId = String(field.id || '').trim();
          const label = String(field.label || '').trim();
          if (!fieldId || !label || seenFieldIds.has(fieldId)) return null;
          seenFieldIds.add(fieldId);

          const typeValue = normalizeFieldType(field.type);
          const options = sanitizeFieldOptions(typeValue, Array.isArray(field.options) ? field.options.map(String) : undefined);
          const showWhenRaw = field.showWhen && typeof field.showWhen === 'object' && !Array.isArray(field.showWhen)
            ? (field.showWhen as Record<string, unknown>)
            : null;

          const showWhen =
            showWhenRaw && String(showWhenRaw.fieldId || '').trim()
              ? {
                  fieldId: String(showWhenRaw.fieldId).trim(),
                  equals: (showWhenRaw.equals as string | boolean | number | undefined) ?? 'yes'
                }
              : undefined;

          const normalized: EventRegistrationFieldDefinition = {
            id: fieldId,
            type: typeValue,
            label,
            required: Boolean(field.required),
            hidden: Boolean(field.hidden),
            helpText: String(field.helpText || '').trim() || undefined,
            placeholder: String(field.placeholder || '').trim() || undefined,
            options,
            ...(showWhen ? { showWhen } : {})
          };

          return normalized;
        })
        .filter((field): field is EventRegistrationFieldDefinition => Boolean(field));

      const normalized: EventRegistrationSectionDefinition = {
        id,
        title,
        type,
        hidden: Boolean(section.hidden),
        description: String(section.description || '').trim() || undefined,
        fields
      };
      return normalized;
    })
    .filter((section): section is EventRegistrationSectionDefinition => Boolean(section));

  const seenPolicyIds = new Set<string>();
  const policies: EventRegistrationPolicyDefinition[] = rawPolicies
    .map((policyRaw) => {
      const policy = (policyRaw && typeof policyRaw === 'object' && !Array.isArray(policyRaw)
        ? policyRaw
        : {}) as Record<string, unknown>;
      const id = String(policy.id || '').trim();
      const title = String(policy.title || '').trim();
      if (!id || !title || seenPolicyIds.has(id)) return null;
      seenPolicyIds.add(id);

      const rawType = String(policy.type || 'required_checkbox').trim();
      const type: EventRegistrationPolicyType =
        rawType === 'yes_no' || rawType === 'info_only' || rawType === 'required_checkbox'
          ? (rawType as EventRegistrationPolicyType)
          : 'required_checkbox';

      const normalized: EventRegistrationPolicyDefinition = {
        id,
        title,
        body: String(policy.body || '').trim() || undefined,
        type,
        required: policy.required === undefined ? type !== 'info_only' : Boolean(policy.required),
        label: String(policy.label || '').trim() || undefined
      };
      return normalized;
    })
    .filter((policy): policy is EventRegistrationPolicyDefinition => Boolean(policy));

  const signatureRaw = raw.signature && typeof raw.signature === 'object' && !Array.isArray(raw.signature)
    ? (raw.signature as Record<string, unknown>)
    : {};

  return {
    schemaVersion: typeof raw.schemaVersion === 'string' && raw.schemaVersion.trim() ? raw.schemaVersion.trim() : EVENT_REGISTRATION_SCHEMA_VERSION,
    sections,
    policies,
    signature: {
      enabled: signatureRaw.enabled === undefined ? true : Boolean(signatureRaw.enabled),
      legalText: String(signatureRaw.legalText || '').trim() || undefined,
      requireNameMatch: Boolean(signatureRaw.requireNameMatch)
    }
  };
}

export function normalizeEventRegistrationSettings(value: Prisma.JsonValue | null | undefined): EventRegistrationSettings {
  const raw = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const childCountSource: EventRegistrationChildCountSource =
    raw.childCountSource === 'field_value' ? 'field_value' : 'ticket_quantity';

  return {
    enabled: Boolean(raw.enabled),
    requireSignature: raw.requireSignature === undefined ? true : Boolean(raw.requireSignature),
    requireAcknowledgments: raw.requireAcknowledgments === undefined ? true : Boolean(raw.requireAcknowledgments),
    childCountSource,
    childCountSectionId: String(raw.childCountSectionId || '').trim() || undefined,
    childCountFieldId: String(raw.childCountFieldId || '').trim() || undefined
  };
}

export function buildDefaultEventRegistrationDraft(): {
  formName: string;
  internalDescription: string;
  settings: EventRegistrationSettings;
  definition: EventRegistrationDefinition;
} {
  return {
    formName: 'Camp Questionnaire',
    internalDescription: 'Fundraising camp registration questionnaire',
    settings: {
      enabled: true,
      requireSignature: true,
      requireAcknowledgments: true,
      childCountSource: 'ticket_quantity',
      childCountSectionId: undefined,
      childCountFieldId: undefined
    },
    definition: {
      schemaVersion: EVENT_REGISTRATION_SCHEMA_VERSION,
      sections: [
        {
          id: 'parent_info',
          title: 'Parent or Guardian Information',
          type: 'single',
          fields: [
            { id: 'parent_name', type: 'short_text', label: 'Parent or Guardian Full Name', required: true },
            { id: 'relationship_to_child', type: 'short_text', label: 'Relationship to Child', required: false },
            { id: 'parent_email', type: 'email', label: 'Email Address', required: true },
            { id: 'parent_phone', type: 'phone', label: 'Mobile Phone Number', required: true },
            { id: 'parent_alt_phone', type: 'phone', label: 'Alternate Phone Number', required: false },
            { id: 'home_address', type: 'long_text', label: 'Home Address', required: false }
          ]
        },
        {
          id: 'emergency_contact',
          title: 'Emergency Contact',
          type: 'single',
          fields: [
            { id: 'emergency_name', type: 'short_text', label: 'Emergency Contact Full Name', required: true },
            { id: 'emergency_phone', type: 'phone', label: 'Emergency Contact Phone Number', required: true },
            { id: 'emergency_relationship', type: 'short_text', label: 'Emergency Contact Relationship', required: true }
          ]
        },
        {
          id: 'child_info',
          title: 'Child Information',
          type: 'repeating_child',
          fields: [
            { id: 'child_full_name', type: 'short_text', label: 'Child Full Name', required: true },
            { id: 'child_preferred_name', type: 'short_text', label: 'Preferred Name or Nickname', required: false },
            { id: 'child_grade', type: 'dropdown', label: 'Grade', required: true, options: GRADE_OPTIONS },
            { id: 'child_age', type: 'number', label: 'Age', required: true },
            { id: 'child_date_of_birth', type: 'date', label: 'Date of Birth', required: false },
            { id: 'child_tshirt_size', type: 'dropdown', label: 'T Shirt Size', required: false, options: T_SHIRT_OPTIONS },
            {
              id: 'has_theater_experience',
              type: 'radio_yes_no',
              label: 'Has your child participated in theater before?',
              required: false
            },
            {
              id: 'child_excited_for',
              type: 'multi_select',
              label: 'What is your child most excited for?',
              required: false,
              options: EXCITEMENT_OPTIONS
            },
            {
              id: 'child_support_notes',
              type: 'long_text',
              label: 'Anything staff should know to help your child have a successful day',
              required: false
            }
          ]
        },
        {
          id: 'health_safety',
          title: 'Health and Safety',
          type: 'repeating_child',
          fields: [
            { id: 'has_allergies', type: 'radio_yes_no', label: 'Does your child have any allergies?', required: true },
            {
              id: 'allergy_details',
              type: 'long_text',
              label: 'Allergy details',
              required: true,
              showWhen: { fieldId: 'has_allergies', equals: 'yes' }
            },
            {
              id: 'has_medical_conditions',
              type: 'radio_yes_no',
              label: 'Does your child have any medical conditions we should know about?',
              required: true
            },
            {
              id: 'medical_condition_details',
              type: 'long_text',
              label: 'Medical condition details',
              required: true,
              showWhen: { fieldId: 'has_medical_conditions', equals: 'yes' }
            },
            {
              id: 'has_medication',
              type: 'radio_yes_no',
              label: 'Is your child currently taking medication during camp hours?',
              required: true
            },
            {
              id: 'medication_details',
              type: 'long_text',
              label: 'Medication details and instructions',
              required: true,
              showWhen: { fieldId: 'has_medication', equals: 'yes' }
            },
            {
              id: 'has_inhaler_or_epipen',
              type: 'radio_yes_no',
              label: 'Does your child carry an inhaler or EpiPen?',
              required: true
            },
            {
              id: 'inhaler_or_epipen_details',
              type: 'long_text',
              label: 'Inhaler or EpiPen details',
              required: true,
              showWhen: { fieldId: 'has_inhaler_or_epipen', equals: 'yes' }
            },
            { id: 'dietary_restrictions', type: 'long_text', label: 'Any dietary restrictions', required: false },
            {
              id: 'activity_restrictions',
              type: 'long_text',
              label: 'Any activity restrictions or accommodations needed',
              required: false
            }
          ]
        },
        {
          id: 'pickup',
          title: 'Pickup Authorization',
          type: 'single',
          fields: [
            {
              id: 'authorized_pickup_names',
              type: 'long_text',
              label: 'Who is authorized to pick up your child or children?',
              required: true
            },
            { id: 'pickup_notes', type: 'long_text', label: 'Pickup Notes', required: false }
          ]
        }
      ],
      policies: [
        {
          id: 'lunch_policy',
          title: 'Lunch and Food',
          body: 'I understand my child must bring their own lunch, drink, and any snacks they may need for the day unless the event specifically says otherwise.',
          type: 'required_checkbox',
          required: true,
          label: 'I have read and understand the lunch and food policy.'
        },
        {
          id: 'pickup_policy',
          title: 'Drop Off and Pick Up',
          body: 'I understand drop off is during the listed drop off window and pick up is during the listed pick up window. I understand my child must be picked up by an authorized adult listed on this form.',
          type: 'required_checkbox',
          required: true,
          label: 'I have read and understand the drop off and pick up policy.'
        },
        {
          id: 'medication_policy',
          title: 'Medication Policy',
          body: 'I understand I must provide accurate information about my child\'s medications, allergies, and health needs. I understand camp staff are not responsible for administering medication unless the event specifically states otherwise.',
          type: 'required_checkbox',
          required: true,
          label: 'I have read and understand the medication policy.'
        },
        {
          id: 'behavior_policy',
          title: 'Behavior Expectations',
          body: 'I understand my child is expected to follow directions, treat others respectfully, and participate safely throughout the event day.',
          type: 'required_checkbox',
          required: true,
          label: 'I have read and understand the behavior expectations.'
        },
        {
          id: 'photo_permission',
          title: 'Photo and Video Permission',
          body: 'I understand photos or videos may be taken during the event for school, theater, or promotional use.',
          type: 'yes_no',
          required: true,
          label: 'Photo and Video Permission'
        },
        {
          id: 'emergency_medical_policy',
          title: 'Emergency Medical Care',
          body: 'In the event of illness or injury, I authorize event staff to contact me and seek reasonable emergency medical care for my child if I cannot be reached immediately.',
          type: 'required_checkbox',
          required: true,
          label: 'I authorize emergency medical care if needed.'
        }
      ],
      signature: {
        enabled: true,
        legalText: `${DEFAULT_PARENT_CERTIFICATION_TEXT}\n\n${DEFAULT_SIGNATURE_LEGAL_TEXT}`,
        requireNameMatch: false
      }
    }
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isTruthyCheckbox(value: unknown): boolean {
  return value === true || value === 'true' || value === 'on' || value === 'yes';
}

function normalizePrimitiveInput(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return '';
}

function normalizeFieldValue(field: EventRegistrationFieldDefinition, value: unknown): unknown {
  switch (field.type) {
    case 'checkbox':
      return isTruthyCheckbox(value);
    case 'multi_select': {
      if (!Array.isArray(value)) return [];
      const options = new Set(toUniqueTrimmed(field.options));
      return toUniqueTrimmed(value.map((entry) => normalizePrimitiveInput(entry))).filter((entry) =>
        options.size > 0 ? options.has(entry) : true
      );
    }
    case 'number': {
      const text = normalizePrimitiveInput(value);
      if (!text) return null;
      const numeric = Number(text);
      return Number.isFinite(numeric) ? numeric : null;
    }
    case 'radio_yes_no': {
      const text = normalizePrimitiveInput(value).toLowerCase();
      if (text === 'yes' || text === 'no') return text;
      return '';
    }
    default:
      return normalizePrimitiveInput(value);
  }
}

function isVisibleField(field: EventRegistrationFieldDefinition, currentRecord: Record<string, unknown>): boolean {
  if (!field.showWhen) return true;
  const dependencyValue = currentRecord[field.showWhen.fieldId];
  if (typeof dependencyValue === 'string') {
    return dependencyValue.toLowerCase() === String(field.showWhen.equals).toLowerCase();
  }
  if (typeof dependencyValue === 'number') {
    return dependencyValue === Number(field.showWhen.equals);
  }
  if (typeof dependencyValue === 'boolean') {
    if (typeof field.showWhen.equals === 'boolean') return dependencyValue === field.showWhen.equals;
    return dependencyValue === isTruthyCheckbox(field.showWhen.equals);
  }
  return false;
}

function assertRequiredField(field: EventRegistrationFieldDefinition, value: unknown, sectionTitle: string, index: number | null): void {
  if (!field.required) return;

  const locationPrefix = index === null ? sectionTitle : `${sectionTitle} (Child ${index + 1})`;
  const label = `${locationPrefix}: ${field.label}`;

  if (field.type === 'checkbox' && value !== true) {
    throw new HttpError(400, `${label} is required.`);
  }
  if (field.type === 'multi_select' && (!Array.isArray(value) || value.length === 0)) {
    throw new HttpError(400, `${label} is required.`);
  }
  if (field.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
    throw new HttpError(400, `${label} is required.`);
  }
  if (field.type !== 'checkbox' && field.type !== 'multi_select' && field.type !== 'number') {
    if (!value || (typeof value === 'string' && !value.trim())) {
      throw new HttpError(400, `${label} is required.`);
    }
  }
}

function assertFieldType(field: EventRegistrationFieldDefinition, value: unknown, sectionTitle: string, index: number | null): void {
  if (value === null || value === undefined || value === '') return;

  const locationPrefix = index === null ? sectionTitle : `${sectionTitle} (Child ${index + 1})`;
  const label = `${locationPrefix}: ${field.label}`;

  if (field.type === 'email') {
    const parsed = z.string().email().safeParse(value);
    if (!parsed.success) {
      throw new HttpError(400, `${label} must be a valid email address.`);
    }
    return;
  }

  if (field.type === 'phone') {
    const text = String(value).trim();
    if (text.length < 7) {
      throw new HttpError(400, `${label} must be a valid phone number.`);
    }
    return;
  }

  if (field.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new HttpError(400, `${label} must be a valid number.`);
    }
    return;
  }

  if (field.type === 'date') {
    const text = String(value).trim();
    if (Number.isNaN(new Date(text).getTime())) {
      throw new HttpError(400, `${label} must be a valid date.`);
    }
    return;
  }

  if (field.type === 'dropdown') {
    const options = toUniqueTrimmed(field.options);
    if (options.length > 0 && !options.includes(String(value))) {
      throw new HttpError(400, `${label} has an invalid option.`);
    }
    return;
  }

  if (field.type === 'multi_select') {
    if (!Array.isArray(value)) {
      throw new HttpError(400, `${label} has an invalid selection.`);
    }
    const options = new Set(toUniqueTrimmed(field.options));
    if (options.size > 0 && value.some((entry) => !options.has(String(entry)))) {
      throw new HttpError(400, `${label} has an invalid selection.`);
    }
    return;
  }

  if (field.type === 'radio_yes_no') {
    const text = String(value).toLowerCase();
    if (text !== 'yes' && text !== 'no') {
      throw new HttpError(400, `${label} must be Yes or No.`);
    }
  }
}

function resolveChildCount(params: {
  settings: EventRegistrationSettings;
  sectionsSubmission: Record<string, unknown>;
  ticketQuantity: number;
}): number {
  if (params.settings.childCountSource === 'ticket_quantity') {
    return Math.max(0, params.ticketQuantity);
  }

  const sectionId = params.settings.childCountSectionId || '';
  const fieldId = params.settings.childCountFieldId || '';
  if (!sectionId || !fieldId) {
    return Math.max(0, params.ticketQuantity);
  }

  const sectionEntry = asObject(params.sectionsSubmission[sectionId]);
  const value = sectionEntry[fieldId];
  const numeric = Number(normalizePrimitiveInput(value));
  if (!Number.isFinite(numeric)) {
    return Math.max(0, params.ticketQuantity);
  }

  return Math.max(0, Math.floor(numeric));
}

function validatePolicyAcknowledgments(definition: EventRegistrationDefinition, submissionPolicies: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const policy of definition.policies) {
    const value = submissionPolicies[policy.id];
    if (policy.type === 'required_checkbox') {
      const accepted = isTruthyCheckbox(value);
      if (policy.required !== false && !accepted) {
        throw new HttpError(400, `${policy.title} acknowledgment is required.`);
      }
      result[policy.id] = accepted;
      continue;
    }

    if (policy.type === 'yes_no') {
      const normalized = normalizePrimitiveInput(value).toLowerCase();
      if (policy.required !== false && normalized !== 'yes' && normalized !== 'no') {
        throw new HttpError(400, `${policy.title} acknowledgment is required.`);
      }
      result[policy.id] = normalized || null;
      continue;
    }

    result[policy.id] = normalizePrimitiveInput(value) || null;
  }

  return result;
}

export function validateEventRegistrationSubmission(params: {
  definition: EventRegistrationDefinition;
  settings: EventRegistrationSettings;
  ticketQuantity: number;
  payload: EventRegistrationSubmissionPayload;
  expectedFormVersionId: string;
  ipAddress?: string | null;
  now?: Date;
}): ValidatedEventRegistrationSubmission {
  if (params.payload.formVersionId !== params.expectedFormVersionId) {
    throw new HttpError(409, 'Registration form has changed. Refresh and submit the latest form.');
  }

  const sectionsSubmission = asObject(params.payload.sections);
  const policiesSubmission = asObject(params.payload.policies);
  const childCount = resolveChildCount({
    settings: params.settings,
    sectionsSubmission,
    ticketQuantity: params.ticketQuantity
  });

  if (params.settings.childCountSource === 'ticket_quantity' && childCount !== params.ticketQuantity) {
    throw new HttpError(400, 'Registered child count must match ticket quantity.');
  }

  const sectionsResult: Record<string, Record<string, unknown> | Array<Record<string, unknown>>> = {};

  for (const section of params.definition.sections) {
    if (section.hidden) continue;

    if (section.type === 'single') {
      const sectionInput = asObject(sectionsSubmission[section.id]);
      const resolvedRecord: Record<string, unknown> = {};

      for (const field of section.fields) {
        if (field.hidden) continue;
        const rawValue = sectionInput[field.id];
        const normalizedValue = normalizeFieldValue(field, rawValue);
        resolvedRecord[field.id] = normalizedValue;
      }

      for (const field of section.fields) {
        if (field.hidden) continue;
        if (!isVisibleField(field, resolvedRecord)) {
          resolvedRecord[field.id] = field.type === 'multi_select' ? [] : field.type === 'checkbox' ? false : '';
          continue;
        }

        assertRequiredField(field, resolvedRecord[field.id], section.title, null);
        assertFieldType(field, resolvedRecord[field.id], section.title, null);
      }

      sectionsResult[section.id] = resolvedRecord;
      continue;
    }

    const sectionInput = Array.isArray(sectionsSubmission[section.id]) ? (sectionsSubmission[section.id] as unknown[]) : [];
    if (sectionInput.length !== childCount) {
      throw new HttpError(400, `${section.title} must include ${childCount} child section${childCount === 1 ? '' : 's'}.`);
    }

    const normalizedRows: Array<Record<string, unknown>> = [];

    for (let index = 0; index < childCount; index += 1) {
      const rowInput = asObject(sectionInput[index]);
      const resolvedRecord: Record<string, unknown> = {};

      for (const field of section.fields) {
        if (field.hidden) continue;
        const normalizedValue = normalizeFieldValue(field, rowInput[field.id]);
        resolvedRecord[field.id] = normalizedValue;
      }

      for (const field of section.fields) {
        if (field.hidden) continue;
        if (!isVisibleField(field, resolvedRecord)) {
          resolvedRecord[field.id] = field.type === 'multi_select' ? [] : field.type === 'checkbox' ? false : '';
          continue;
        }

        assertRequiredField(field, resolvedRecord[field.id], section.title, index);
        assertFieldType(field, resolvedRecord[field.id], section.title, index);
      }

      normalizedRows.push(resolvedRecord);
    }

    sectionsResult[section.id] = normalizedRows;
  }

  const policyAcknowledgments = validatePolicyAcknowledgments(params.definition, policiesSubmission);

  const acknowledgments = {
    infoAccurate: Boolean(params.payload.acknowledgments?.infoAccurate),
    policiesRead: Boolean(params.payload.acknowledgments?.policiesRead),
    emergencyCare: Boolean(params.payload.acknowledgments?.emergencyCare),
    participationRules: Boolean(params.payload.acknowledgments?.participationRules)
  };

  if (params.settings.requireAcknowledgments) {
    if (!acknowledgments.infoAccurate || !acknowledgments.policiesRead || !acknowledgments.emergencyCare || !acknowledgments.participationRules) {
      throw new HttpError(400, 'All parent acknowledgments are required.');
    }
  }

  const signatureEnabled = params.settings.requireSignature || params.definition.signature?.enabled;
  const typedName = String(params.payload.signature?.typedName || '').trim();
  const printedName = String(params.payload.signature?.printedName || '').trim();

  if (signatureEnabled) {
    if (!typedName) {
      throw new HttpError(400, 'Typed signature is required.');
    }
    if (!printedName) {
      throw new HttpError(400, 'Printed parent or guardian name is required.');
    }
    if (params.definition.signature?.requireNameMatch && typedName.toLowerCase() !== printedName.toLowerCase()) {
      throw new HttpError(400, 'Printed parent name must match typed signature.');
    }
  }

  return {
    formVersionId: params.payload.formVersionId,
    sections: sectionsResult,
    policies: policyAcknowledgments,
    acknowledgments,
    signature: {
      typedName,
      printedName,
      dateSigned: (params.now || new Date()).toISOString().slice(0, 10),
      ipAddress: params.ipAddress?.trim() || null
    }
  };
}

export function assertEventRegistrationDraftPayload(payload: {
  formName: string;
  internalDescription?: string;
  settings: unknown;
  definition: unknown;
}): {
  formName: string;
  internalDescription?: string;
  settings: EventRegistrationSettings;
  definition: EventRegistrationDefinition;
} {
  const formName = payload.formName.trim();
  if (!formName) {
    throw new HttpError(400, 'Form name is required.');
  }

  const settings = normalizeEventRegistrationSettings(payload.settings as Prisma.JsonValue);
  const definition = normalizeEventRegistrationDefinition(payload.definition as Prisma.JsonValue);

  const settingsValidation = eventRegistrationSettingsSchema.safeParse(settings);
  if (!settingsValidation.success) {
    throw new HttpError(400, 'Registration form settings are invalid.');
  }

  const definitionValidation = eventRegistrationDefinitionSchema.safeParse(definition);
  if (!definitionValidation.success) {
    throw new HttpError(400, 'Registration form definition is invalid.');
  }

  return {
    formName,
    internalDescription: payload.internalDescription?.trim() || undefined,
    settings,
    definition
  };
}

export function serializeEventRegistrationPublicForm(params: {
  formId: string;
  performanceId: string;
  formName: string;
  settings: EventRegistrationSettings;
  definition: EventRegistrationDefinition;
  versionId: string;
  versionNumber: number;
  publishedAt: Date;
}) {
  return {
    formId: params.formId,
    performanceId: params.performanceId,
    formName: params.formName,
    settings: params.settings,
    definition: params.definition,
    versionId: params.versionId,
    versionNumber: params.versionNumber,
    publishedAt: params.publishedAt.toISOString()
  };
}
