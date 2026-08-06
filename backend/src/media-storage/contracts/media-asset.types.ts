export interface CreateMediaAssetInput {
  companyId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  content: Buffer;
  expiresAt?: Date;
}

export type SupportedMediaAssetMimeType = 'image/jpeg' | 'image/png';
