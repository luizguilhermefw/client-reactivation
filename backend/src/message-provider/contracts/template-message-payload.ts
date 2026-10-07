import type { TemplateMessagePayload } from './message-provider.types';

/** Neutral persisted payload validation; no credentials or HTTP provider fields. */
export function parseTemplateMessagePayload(
  value: unknown,
): TemplateMessagePayload | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const payload = value as Record<string, unknown>;
  const allowed = new Set(['templateName', 'languageCode', 'bodyParameters']);
  if (
    Object.keys(payload).some((field) => !allowed.has(field)) ||
    typeof payload.templateName !== 'string' ||
    !/^[a-z0-9_]+$/.test(payload.templateName) ||
    typeof payload.languageCode !== 'string' ||
    !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(payload.languageCode)
  ) {
    return undefined;
  }
  let bodyParameters: string[] | undefined;
  if (payload.bodyParameters !== undefined) {
    if (!Array.isArray(payload.bodyParameters)) return undefined;
    bodyParameters = [];
    for (const parameter of payload.bodyParameters) {
      if (typeof parameter !== 'string' || !parameter.trim()) return undefined;
      bodyParameters.push(parameter);
    }
  }
  return {
    templateName: payload.templateName,
    languageCode: payload.languageCode,
    ...(bodyParameters === undefined ? {} : { bodyParameters }),
  };
}
