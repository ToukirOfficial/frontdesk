import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { AppConfig } from '../config.js';

const NAME = /^[0-9a-f-]{36}\.(png|jpg|webp)$/;
const dir = (config: AppConfig) => resolve(config.STORAGE_DIR, 'avatars');

export const avatarPath = (config: AppConfig, name: string): string => {
  if (!NAME.test(name)) throw new Error('Invalid avatar name');
  return join(dir(config), name);
};

export const saveAvatar = async (config: AppConfig, name: string, data: Buffer): Promise<void> => {
  await mkdir(dir(config), { recursive: true, mode: 0o700 });
  await writeFile(avatarPath(config, name), data, { mode: 0o600, flag: 'wx' });
};

export const deleteAvatar = async (config: AppConfig, name: string): Promise<void> => {
  await unlink(avatarPath(config, name)).catch(() => undefined);
};
