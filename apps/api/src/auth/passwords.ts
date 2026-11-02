import argon2 from 'argon2';

const OPTS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (plain: string): Promise<string> => argon2.hash(plain, OPTS);

/** Hash of a random string: verifying against it when the user doesn't exist keeps login timing flat. */
let dummyHash: Promise<string> | undefined;

export const verifyPassword = async (hash: string | null | undefined, plain: string): Promise<boolean> => {
  if (!hash) {
    dummyHash ??= argon2.hash('not-a-real-password-just-for-timing', OPTS);
    await argon2.verify(await dummyHash, plain).catch(() => false);
    return false;
  }
  return argon2.verify(hash, plain).catch(() => false);
};
