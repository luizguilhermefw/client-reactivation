export interface FirebaseStorageConfig {
  projectId: string;
  bucket: string;
}

export class FirebaseStorageConfigurationError extends Error {
  readonly name = 'FirebaseStorageConfigurationError';

  constructor() {
    super(
      'FIREBASE_STORAGE_PROJECT_ID and FIREBASE_STORAGE_BUCKET are required',
    );
  }
}

type FirebaseStorageEnvironmentKey =
  | 'FIREBASE_STORAGE_PROJECT_ID'
  | 'FIREBASE_STORAGE_BUCKET';

type EnvironmentReader = (
  key: FirebaseStorageEnvironmentKey,
) => string | undefined;

export function resolveFirebaseStorageConfig(
  readEnvironment: EnvironmentReader = (key) => process.env[key],
): FirebaseStorageConfig {
  const projectId = readEnvironment('FIREBASE_STORAGE_PROJECT_ID')?.trim();
  const bucket = readEnvironment('FIREBASE_STORAGE_BUCKET')?.trim();

  if (
    !projectId ||
    !bucket ||
    bucket.includes('*') ||
    bucket.includes('/') ||
    bucket.includes('\\') ||
    bucket.includes('://')
  ) {
    throw new FirebaseStorageConfigurationError();
  }

  return { projectId, bucket };
}
