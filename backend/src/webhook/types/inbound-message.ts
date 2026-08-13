export interface InboundMessage {
  readonly provider: 'EVOLUTION';
  readonly instanceName: string;
  readonly providerMessageId: string | null;
  readonly phone: string;
  readonly text: string | null;
  readonly fromMe: boolean;
  readonly receivedAt: Date | null;
}

export type InboundMessageProcessingResult =
  | {
      readonly status: 'accepted';
      readonly companyId: string;
      readonly message: InboundMessage;
    }
  | {
      readonly status: 'ignored';
      readonly reason:
        | 'unsupported-event'
        | 'from-me'
        | 'invalid-message'
        | 'unknown-instance';
    };
