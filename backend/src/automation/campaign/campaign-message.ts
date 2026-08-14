import { BadRequestException } from '@nestjs/common';
import { MAX_IMAGE_CAPTION_LENGTH } from '../../queue/dto/enqueue-message.input';

export const CAMPAIGN_OPT_OUT_FOOTER =
  'Para não receber mais mensagens, responda PARAR.';
export const MAX_CAMPAIGN_TEXT_LENGTH = 4_096;
const FOOTER_SEPARATOR = '\n\n';
const CAMPAIGN_FOOTER_LENGTH =
  FOOTER_SEPARATOR.length + CAMPAIGN_OPT_OUT_FOOTER.length;

export const MAX_CAMPAIGN_USER_TEXT_LENGTH =
  MAX_CAMPAIGN_TEXT_LENGTH - CAMPAIGN_FOOTER_LENGTH;
export const MAX_CAMPAIGN_USER_CAPTION_LENGTH =
  MAX_IMAGE_CAPTION_LENGTH - CAMPAIGN_FOOTER_LENGTH;

export function buildCampaignOutboundContent(
  userContent: string | undefined,
  customerName: string,
  maxLength: number,
): string {
  const personalized = (userContent ?? '')
    .replace(/{{\s*nome\s*}}/gi, customerName)
    .trimEnd();
  const finalContent = personalized.endsWith(CAMPAIGN_OPT_OUT_FOOTER)
    ? personalized
    : personalized
      ? `${personalized}${FOOTER_SEPARATOR}${CAMPAIGN_OPT_OUT_FOOTER}`
      : CAMPAIGN_OPT_OUT_FOOTER;

  if (finalContent.length > maxLength) {
    throw new BadRequestException(
      'Campaign content exceeds the allowed limit after personalization and opt-out footer',
    );
  }

  return finalContent;
}
