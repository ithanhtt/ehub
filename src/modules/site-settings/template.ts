/**
 * The variables an Administrator may write into the corner note and the
 * maintenance message — "{{appName}} v{{version}} · © {{year}}" — filled in
 * when shown. Nothing here is server-only: the Settings page previews with it.
 */

export const TEMPLATE_VARIABLES = ['version', 'year', 'appName'] as const

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number]

export type TemplateValues = Partial<Record<TemplateVariable, string | null>>

const PATTERN = /\{\{\s*([A-Za-z]+)\s*\}\}/g

/** The text with every known variable filled in (empty when it has no value); an unknown one is left as written. */
export function fillTemplate(text: string, values: TemplateValues): string {
  return text.replace(PATTERN, (whole, name: string) => {
    if (!(TEMPLATE_VARIABLES as readonly string[]).includes(name)) return whole
    return values[name as TemplateVariable] ?? ''
  })
}
