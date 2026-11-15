import type { Env } from '../env';
import type { StorageDriver } from './driver';
import { createGcsDriver } from './gcs';
import { LocalDriver } from './local';

export async function createStorage(env: Env): Promise<StorageDriver> {
  if (env.STORAGE_DRIVER === 'gcs') {
    return createGcsDriver(env.GCS_BUCKET!, env.GOOGLE_APPLICATION_CREDENTIALS);
  }
  return new LocalDriver(env.LOCAL_STORAGE_DIR);
}

export type { StorageDriver } from './driver';
