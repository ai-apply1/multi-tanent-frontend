export type TemplateChannel = "email" | "sms"

/** A purpose/scenario from the admin-managed registry. */
export interface TemplatePurposeEntry {
  id: string
  key: string
  label: string
  /** Wired-to-code scenario: locked (no delete, key immutable). */
  isSystem: boolean
  isActive: boolean
  sortOrder: number
}

/**
 * Fallback display label for a purpose key when the registry isn't loaded in
 * a given surface (e.g. a dropdown suffix). Humanizes the slug.
 */
export function humanizePurpose(key: string): string {
  if (!key) return ""
  return key
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

/**
 * A reusable admin-authored email / SMS template. The `body` (and email
 * `subject`) may contain `{{token}}` placeholders that are substituted from
 * the candidate's data at send time, see `templateVariables.ts`.
 */
export interface MessageTemplate {
  id: string
  channel: TemplateChannel
  /** Registry key (scenario) this template binds to. */
  purpose: string
  /** The single active template for its (channel, purpose); drives sends. */
  isDefault: boolean
  name: string
  /** Email subject line; always "" for SMS templates. */
  subject: string
  body: string
  isActive: boolean
  createdByName: string
  createdAt: string
  updatedAt: string
}

export interface ListTemplatesParams {
  channel?: TemplateChannel
  purpose?: string
  activeOnly?: boolean
}

export interface ListTemplatesResponse {
  data: MessageTemplate[]
  count: number
}

export interface CreateTemplatePayload {
  channel: TemplateChannel
  purpose: string
  name: string
  subject?: string
  body: string
  isActive?: boolean
  isDefault?: boolean
}

export interface UpdateTemplatePayload {
  name?: string
  purpose?: string
  subject?: string
  body?: string
  isActive?: boolean
  isDefault?: boolean
}

export interface CreatePurposePayload {
  label: string
  isActive?: boolean
}

export interface UpdatePurposePayload {
  label?: string
  isActive?: boolean
}

/** A `{{token}}` placeholder from the admin-managed variable registry. */
export interface TemplateVariableEntry {
  id: string
  token: string
  label: string
  /** Resolved from candidate/context in code (locked) vs admin constant. */
  isSystem: boolean
  /** Constant value for custom variables; "" for system. */
  value: string
  /** Example used in the editor preview. */
  sampleValue: string
  isActive: boolean
  sortOrder: number
}

export interface CreateVariablePayload {
  label: string
  value?: string
  isActive?: boolean
}

export interface UpdateVariablePayload {
  label?: string
  value?: string
  isActive?: boolean
}
