/*
 * Password hashing with Argon2id through Bun.password. The cost settings come from the
 * environment (ARGON2_MEMORY_COST, ARGON2_TIME_COST), so production can use strong values and
 * tests can use cheap ones. Bun.password has no parallelism option, so none is configurable.
 */

/** Cost settings for Argon2id. */
export interface PasswordHasherOptions {
  /** Memory in KiB. */
  memoryCost: number;
  /** Number of passes over the memory. */
  timeCost: number;
}

/** Hashes and checks passwords. */
export interface PasswordHasher {
  /**
   * @param password - the plain password
   * @returns an Argon2id hash string (starts with `$argon2id$`) that includes its own salt
   */
  hash(password: string): Promise<string>;

  /**
   * @param password - the plain password to check
   * @param hash - a stored hash from `hash`
   * @returns true when the password matches; false for a wrong password or an unreadable hash
   */
  verify(password: string, hash: string): Promise<boolean>;
}

/**
 * Create a password hasher.
 * @param options - Argon2id cost settings
 * @returns a hasher that uses Argon2id
 */
export function createPasswordHasher(options: PasswordHasherOptions): PasswordHasher {
  return {
    hash: (password) =>
      Bun.password.hash(password, {
        algorithm: "argon2id",
        memoryCost: options.memoryCost,
        timeCost: options.timeCost,
      }),
    verify: async (password, hash) => {
      try {
        return await Bun.password.verify(password, hash);
      } catch {
        return false;
      }
    },
  };
}
