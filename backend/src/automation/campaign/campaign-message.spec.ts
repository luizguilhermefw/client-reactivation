import { BadRequestException } from '@nestjs/common';
import {
  buildCampaignOutboundContent,
  CAMPAIGN_OPT_OUT_FOOTER,
  MAX_CAMPAIGN_TEXT_LENGTH,
} from './campaign-message';

describe('campaign outbound content', () => {
  it('personaliza nome e adiciona footer com uma linha em branco', () => {
    expect(
      buildCampaignOutboundContent(
        'Olá, {{ nome }}!  \n',
        'Maria',
        MAX_CAMPAIGN_TEXT_LENGTH,
      ),
    ).toBe(`Olá, Maria!\n\n${CAMPAIGN_OPT_OUT_FOOTER}`);
  });

  it('usa o footer como caption de IMAGE sem legenda', () => {
    expect(
      buildCampaignOutboundContent(undefined, 'Maria', 1_024),
    ).toBe(CAMPAIGN_OPT_OUT_FOOTER);
  });

  it('não duplica footer já anexado no mesmo payload', () => {
    const content = `Oferta\n\n${CAMPAIGN_OPT_OUT_FOOTER}`;
    expect(buildCampaignOutboundContent(content, 'Maria', 4_096)).toBe(
      content,
    );
  });

  it('rejeita payload final acima do limite sem truncar', () => {
    expect(() =>
      buildCampaignOutboundContent('x'.repeat(100), 'Maria', 50),
    ).toThrow(BadRequestException);
  });
});
