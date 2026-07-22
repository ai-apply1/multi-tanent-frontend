import api from "@/lib/api"

/** A merge field an email template may use, e.g. `{{candidateName}}`. */
export interface EmailTemplateVariable {
  token: string
  label: string
}

/** One candidate-facing email's effective copy + metadata. */
export interface EmailTemplateItem {
  purpose: string
  label: string
  description: string
  /** Effective copy: the org's override if set, else the default. */
  subject: string
  body: string
  /** True when the org has saved an override for this email. */
  isCustom: boolean
  /** The shipped default, so the editor can offer "reset to default". */
  default: { subject: string; body: string }
  /** The `{{tokens}}` valid in this template. */
  variables: EmailTemplateVariable[]
}

export interface EmailTemplatesResponse {
  templates: EmailTemplateItem[]
}

export interface EmailPreviewResult {
  subject: string
  html: string
}

/** Every editable email with its effective + default copy. */
export async function fetchEmailTemplates(): Promise<EmailTemplatesResponse> {
  const { data } = await api.get<EmailTemplatesResponse>(
    "/admin/organization/email-templates",
  )
  return data
}

/** Save an override for one email. Returns the refreshed list. */
export async function saveEmailTemplate(
  purpose: string,
  payload: { subject: string; body: string },
): Promise<EmailTemplatesResponse> {
  const { data } = await api.put<EmailTemplatesResponse>(
    `/admin/organization/email-templates/${purpose}`,
    payload,
  )
  return data
}

/** Reset one email to the shipped default (drops the override). */
export async function resetEmailTemplate(
  purpose: string,
): Promise<EmailTemplatesResponse> {
  const { data } = await api.delete<EmailTemplatesResponse>(
    `/admin/organization/email-templates/${purpose}`,
  )
  return data
}

/** Render a draft with sample data + the org's brand for the live preview. */
export async function previewEmailTemplate(payload: {
  purpose: string
  subject: string
  body: string
}): Promise<EmailPreviewResult> {
  const { data } = await api.post<EmailPreviewResult>(
    "/admin/organization/email-templates/preview",
    payload,
  )
  return data
}
