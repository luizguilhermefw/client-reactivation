import {
  BadRequestException,
} from '@nestjs/common';
import {
  CampaignAudienceType,
  CustomerGender,
  Prisma,
} from '@prisma/client';
import { buildBirthDateRange } from '../../customer/customer-filter.helpers';
import { normalizeCustomerCity } from '../../customer/customer-normalization';
import {
  isBrazilianStateCode,
  normalizeBrazilianState,
} from '../../customer/customer-state';

export const MAX_CAMPAIGN_CUSTOMER_IDS = 500;

export function normalizeCampaignCustomerIds(
  customerIds: string[] | undefined,
): string[] | undefined {
  if (customerIds === undefined) return undefined;

  const normalized = [
    ...new Set(customerIds.map((customerId) => customerId.trim())),
  ];
  if (
    normalized.length === 0 ||
    normalized.some((customerId) => !customerId) ||
    normalized.length > MAX_CAMPAIGN_CUSTOMER_IDS
  ) {
    throw new BadRequestException('Campaign customer IDs are invalid');
  }

  return normalized;
}

export interface CampaignSegmentationInput {
  segmentGender?: CustomerGender | null;
  segmentCity?: string | null;
  segmentState?: string | null;
  segmentMinAge?: number | null;
  segmentMaxAge?: number | null;
  segmentLastPurchaseBefore?: string | Date | null;
  segmentLastPurchaseAfter?: string | Date | null;
}

export interface NormalizedCampaignSegmentation {
  segmentGender: CustomerGender | null;
  segmentCity: string | null;
  segmentState: string | null;
  segmentMinAge: number | null;
  segmentMaxAge: number | null;
  segmentLastPurchaseBefore: Date | null;
  segmentLastPurchaseAfter: Date | null;
}

export const EMPTY_CAMPAIGN_SEGMENTATION: NormalizedCampaignSegmentation = {
  segmentGender: null,
  segmentCity: null,
  segmentState: null,
  segmentMinAge: null,
  segmentMaxAge: null,
  segmentLastPurchaseBefore: null,
  segmentLastPurchaseAfter: null,
};

function normalizeDate(
  value: string | Date | null | undefined,
  field: string,
): Date | null {
  if (value === undefined || value === null) return null;

  const normalized = new Date(
    value instanceof Date ? value.getTime() : value,
  );
  if (Number.isNaN(normalized.getTime())) {
    throw new BadRequestException(`${field} must be a valid date`);
  }

  return normalized;
}

function normalizeAge(
  value: number | null | undefined,
  field: string,
): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value < 0 || value > 120) {
    throw new BadRequestException(`${field} must be an integer from 0 to 120`);
  }
  return value;
}

export function normalizeCampaignSegmentation(
  input: CampaignSegmentationInput,
): NormalizedCampaignSegmentation {
  const segmentState = normalizeBrazilianState(input.segmentState);
  if (segmentState && !isBrazilianStateCode(segmentState)) {
    throw new BadRequestException('segmentState must be a valid Brazilian UF');
  }

  const normalized: NormalizedCampaignSegmentation = {
    segmentGender: input.segmentGender ?? null,
    segmentCity: normalizeCustomerCity(input.segmentCity) ?? null,
    segmentState: segmentState ?? null,
    segmentMinAge: normalizeAge(input.segmentMinAge, 'segmentMinAge'),
    segmentMaxAge: normalizeAge(input.segmentMaxAge, 'segmentMaxAge'),
    segmentLastPurchaseBefore: normalizeDate(
      input.segmentLastPurchaseBefore,
      'segmentLastPurchaseBefore',
    ),
    segmentLastPurchaseAfter: normalizeDate(
      input.segmentLastPurchaseAfter,
      'segmentLastPurchaseAfter',
    ),
  };

  if (
    normalized.segmentMinAge !== null &&
    normalized.segmentMaxAge !== null &&
    normalized.segmentMinAge > normalized.segmentMaxAge
  ) {
    throw new BadRequestException(
      'segmentMinAge must be less than or equal to segmentMaxAge',
    );
  }

  if (
    normalized.segmentLastPurchaseAfter !== null &&
    normalized.segmentLastPurchaseBefore !== null &&
    normalized.segmentLastPurchaseAfter >
      normalized.segmentLastPurchaseBefore
  ) {
    throw new BadRequestException(
      'segmentLastPurchaseAfter must be before or equal to segmentLastPurchaseBefore',
    );
  }

  return normalized;
}

export function hasCampaignSegmentationFilter(
  input: NormalizedCampaignSegmentation,
): boolean {
  return Object.values(input).some((value) => value !== null);
}

export function assertCampaignAudienceConfiguration(
  audienceType: CampaignAudienceType,
  segmentation: NormalizedCampaignSegmentation,
): void {
  const hasFilters = hasCampaignSegmentationFilter(segmentation);

  if (audienceType === CampaignAudienceType.SEGMENTED && !hasFilters) {
    throw new BadRequestException(
      'SEGMENTED audience requires at least one filter',
    );
  }

  if (audienceType !== CampaignAudienceType.SEGMENTED && hasFilters) {
    throw new BadRequestException(
      'Segment filters are only allowed for SEGMENTED audience',
    );
  }
}

export function buildSegmentedCustomerWhere(
  companyId: string,
  segmentation: NormalizedCampaignSegmentation,
  referenceDate = new Date(),
): Prisma.CustomerWhereInput {
  const birthDate = buildBirthDateRange(
    segmentation.segmentMinAge ?? undefined,
    segmentation.segmentMaxAge ?? undefined,
    referenceDate,
  );

  return {
    companyId,
    ...(segmentation.segmentGender === null
      ? {}
      : { gender: segmentation.segmentGender }),
    ...(segmentation.segmentCity === null
      ? {}
      : {
          city: {
            equals: segmentation.segmentCity,
            mode: Prisma.QueryMode.insensitive,
          },
        }),
    ...(segmentation.segmentState === null
      ? {}
      : { state: segmentation.segmentState }),
    ...(birthDate === undefined ? {} : { birthDate }),
    ...(segmentation.segmentLastPurchaseBefore === null &&
    segmentation.segmentLastPurchaseAfter === null
      ? {}
      : {
          lastPurchaseDate: {
            ...(segmentation.segmentLastPurchaseBefore === null
              ? {}
              : { lt: segmentation.segmentLastPurchaseBefore }),
            ...(segmentation.segmentLastPurchaseAfter === null
              ? {}
              : { gt: segmentation.segmentLastPurchaseAfter }),
          },
        }),
  };
}
