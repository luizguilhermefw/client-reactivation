import {
  CreateTemporaryReadUrlInput,
  CreateTemporaryReadUrlResult,
  DeleteMediaObjectInput,
  DeleteMediaObjectResult,
  UploadMediaObjectInput,
  UploadMediaObjectResult,
} from './media-storage.types';

export interface MediaStorageAdapter {
  uploadObject(input: UploadMediaObjectInput): Promise<UploadMediaObjectResult>;
  createTemporaryReadUrl(
    input: CreateTemporaryReadUrlInput,
  ): Promise<CreateTemporaryReadUrlResult>;
  deleteObject(input: DeleteMediaObjectInput): Promise<DeleteMediaObjectResult>;
}
