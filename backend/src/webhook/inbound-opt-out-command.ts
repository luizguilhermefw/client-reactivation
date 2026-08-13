export const INBOUND_OPT_OUT_COMMANDS = ['PARAR', 'SAIR', 'CANCELAR'] as const;

export type InboundOptOutCommand = (typeof INBOUND_OPT_OUT_COMMANDS)[number];

const inboundOptOutCommandSet = new Set<string>(INBOUND_OPT_OUT_COMMANDS);

export function normalizeInboundOptOutCommand(
  text: unknown,
): InboundOptOutCommand | null {
  if (typeof text !== 'string') {
    return null;
  }

  const normalizedText = text.trim().toUpperCase();

  return inboundOptOutCommandSet.has(normalizedText)
    ? (normalizedText as InboundOptOutCommand)
    : null;
}
