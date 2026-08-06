export interface UploadMediaObjectInput {
  companyId: string;
  mediaAssetId: string;
  objectKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  content: Buffer;
}

export interface UploadMediaObjectResult {
  storageProvider: string;
  bucket: string;
  objectKey: string;
  sizeBytes: number;
}

export interface CreateTemporaryReadUrlInput {
  bucket: string;
  objectKey: string;
  expiresInSeconds: number;
}

export interface CreateTemporaryReadUrlResult {
  url: string;
  expiresAt: Date;
}

export interface DeleteMediaObjectInput {
  bucket: string;
  objectKey: string;
}

export interface DeleteMediaObjectResult {
  bucket: string;
  objectKey: string;
  deletedAt: Date;
}
