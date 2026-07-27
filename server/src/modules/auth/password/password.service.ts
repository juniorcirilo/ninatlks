import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import * as bcrypt from 'bcryptjs';
import type { Profiles } from '../../../database/entities/accounts/profiles.entity';

export interface PasswordVerifyResult {
  ok: boolean;
  needsRehash: boolean;
}

/**
 * argon2 for every new hash; bcrypt verification stays only to authenticate
 * users whose password_hash was migrated from Supabase GoTrue
 * (auth.users.encrypted_password uses bcrypt) — see profiles.password_algo.
 * A successful bcrypt login re-hashes to argon2 automatically (needsRehash),
 * avoiding a mass password reset for legacy accounts.
 */
@Injectable()
export class PasswordService {
  async hash(plaintext: string): Promise<string> {
    return argon2.hash(plaintext);
  }

  async verify(
    profile: Pick<Profiles, 'passwordHash' | 'passwordAlgo'>,
    plaintext: string,
  ): Promise<PasswordVerifyResult> {
    if (!profile.passwordHash) {
      return { ok: false, needsRehash: false };
    }
    if (profile.passwordAlgo === 'bcrypt') {
      const ok = await bcrypt.compare(plaintext, profile.passwordHash);
      return { ok, needsRehash: ok };
    }
    const ok = await argon2.verify(profile.passwordHash, plaintext);
    return { ok, needsRehash: false };
  }
}
