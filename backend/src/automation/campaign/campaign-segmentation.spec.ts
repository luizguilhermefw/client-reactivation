import { BadRequestException } from '@nestjs/common';
import { CampaignAudienceType, CustomerGender } from '@prisma/client';
import {
  assertCampaignAudienceConfiguration,
  buildSegmentedCustomerWhere,
  normalizeCampaignSegmentation,
} from './campaign-segmentation';

describe('campaign segmentation', () => {
  const referenceDate = new Date('2026-08-13T12:00:00.000Z');

  it('normaliza gender, city, UF, idade e datas', () => {
    const segmentation = normalizeCampaignSegmentation({
      segmentGender: CustomerGender.FEMALE,
      segmentCity: '  São   Paulo ',
      segmentState: ' sp ',
      segmentMinAge: 18,
      segmentMaxAge: 35,
      segmentLastPurchaseAfter: '2026-01-01',
      segmentLastPurchaseBefore: '2026-08-01',
    });

    expect(segmentation).toEqual({
      segmentGender: CustomerGender.FEMALE,
      segmentCity: 'São Paulo',
      segmentState: 'SP',
      segmentMinAge: 18,
      segmentMaxAge: 35,
      segmentLastPurchaseAfter: new Date('2026-01-01'),
      segmentLastPurchaseBefore: new Date('2026-08-01'),
    });
  });

  it.each([
    [{ segmentState: 'ZZ' }],
    [{ segmentMinAge: -1 }],
    [{ segmentMaxAge: 121 }],
    [{ segmentMinAge: 36, segmentMaxAge: 35 }],
    [
      {
        segmentLastPurchaseAfter: '2026-08-02',
        segmentLastPurchaseBefore: '2026-08-01',
      },
    ],
  ])('rejeita filtro inválido %#', (input) => {
    expect(() => normalizeCampaignSegmentation(input)).toThrow(
      BadRequestException,
    );
  });

  it('exige pelo menos um filtro em SEGMENTED', () => {
    const empty = normalizeCampaignSegmentation({});
    expect(() =>
      assertCampaignAudienceConfiguration(
        CampaignAudienceType.SEGMENTED,
        empty,
      ),
    ).toThrow('SEGMENTED audience requires at least one filter');
  });

  it('rejeita filtros em ALL_ELIGIBLE e CUSTOMER_IDS', () => {
    const filtered = normalizeCampaignSegmentation({ segmentState: 'PR' });
    for (const audienceType of [
      CampaignAudienceType.ALL_ELIGIBLE,
      CampaignAudienceType.CUSTOMER_IDS,
    ]) {
      expect(() =>
        assertCampaignAudienceConfiguration(audienceType, filtered),
      ).toThrow('Segment filters are only allowed for SEGMENTED audience');
    }
  });

  it('gera query Prisma combinada, por tenant, sem filtros de elegibilidade', () => {
    const where = buildSegmentedCustomerWhere(
      'company-1',
      normalizeCampaignSegmentation({
        segmentGender: CustomerGender.OTHER,
        segmentCity: 'Curitiba',
        segmentState: 'PR',
        segmentMinAge: 18,
        segmentMaxAge: 35,
        segmentLastPurchaseAfter: '2026-01-01',
        segmentLastPurchaseBefore: '2026-08-01',
      }),
      referenceDate,
    );

    expect(where).toEqual({
      companyId: 'company-1',
      gender: CustomerGender.OTHER,
      city: { equals: 'Curitiba', mode: 'insensitive' },
      state: 'PR',
      birthDate: {
        gt: expect.any(Date),
        lte: expect.any(Date),
      },
      lastPurchaseDate: {
        gt: new Date('2026-01-01'),
        lt: new Date('2026-08-01'),
      },
    });
    expect(where).not.toHaveProperty('isActiveForAutomation');
    expect(where).not.toHaveProperty('contactConsentStatus');
  });

  it.each([
    ['gender', { segmentGender: CustomerGender.MALE }, 'gender'],
    ['city', { segmentCity: 'Londrina' }, 'city'],
    ['state', { segmentState: 'PR' }, 'state'],
    ['minAge', { segmentMinAge: 18 }, 'birthDate'],
    ['maxAge', { segmentMaxAge: 35 }, 'birthDate'],
    [
      'lastPurchaseBefore',
      { segmentLastPurchaseBefore: '2026-08-01' },
      'lastPurchaseDate',
    ],
    [
      'lastPurchaseAfter',
      { segmentLastPurchaseAfter: '2026-01-01' },
      'lastPurchaseDate',
    ],
  ])('aplica filtro individual %s', (_name, input, expectedField) => {
    const where = buildSegmentedCustomerWhere(
      'company-1',
      normalizeCampaignSegmentation(input as never),
      referenceDate,
    );
    expect(where).toHaveProperty(expectedField);
  });
});
