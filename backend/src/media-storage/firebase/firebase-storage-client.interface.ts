export interface FirebaseStorageFile {
  save(
    content: Buffer,
    options: {
      resumable: false;
      metadata: {
        contentType: string;
        metadata: {
          companyId: string;
          mediaAssetId: string;
          originalFileName: string;
        };
      };
      preconditionOpts: {
        ifGenerationMatch: 0;
      };
    },
  ): Promise<void>;
  getSignedUrl(options: {
    version: 'v4';
    action: 'read';
    expires: Date;
  }): Promise<[string]>;
  delete(options: { ignoreNotFound: true }): Promise<unknown>;
}

export interface FirebaseStorageBucket {
  readonly name: string;
  file(objectKey: string): FirebaseStorageFile;
}
