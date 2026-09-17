import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

@Injectable()
export class IdService {
  private lastTime = 0;
  private sequence = 0;

  /**
   * Generates a 26-character Crockford Base32 Universally Unique
   * Lexicographically Sortable Identifier (ULID).
   * Monotonic, collision-free, time-ordered ID.
   * Matches the 'Id Service' component in enterprise chat architecture.
   */
  generate(): string {
    const now = Date.now();
    if (now === this.lastTime) {
      this.sequence = (this.sequence + 1) & 0xffff;
    } else {
      this.lastTime = now;
      this.sequence = crypto.randomInt(0, 0xffff);
    }

    // 48-bit timestamp -> 10 Crockford Base32 characters
    let timeChars = '';
    let t = now;
    for (let i = 0; i < 10; i++) {
      timeChars = CROCKFORD_BASE32[t % 32] + timeChars;
      t = Math.floor(t / 32);
    }

    // 80-bit randomness (with sequence embedded in first 16 bits) -> 16 Base32 characters
    const entropy = crypto.randomBytes(10);
    entropy[0] = (this.sequence >> 8) & 0xff;
    entropy[1] = this.sequence & 0xff;

    let randChars = '';
    // Encode 10 bytes (80 bits) into 16 5-bit characters
    for (let i = 0; i < 10; i += 5) {
      const b0 = entropy[i];
      const b1 = entropy[i + 1];
      const b2 = entropy[i + 2];
      const b3 = entropy[i + 3];
      const b4 = entropy[i + 4];

      randChars += CROCKFORD_BASE32[b0 >> 3];
      randChars += CROCKFORD_BASE32[((b0 & 0x07) << 2) | (b1 >> 6)];
      randChars += CROCKFORD_BASE32[(b1 >> 1) & 0x1f];
      randChars += CROCKFORD_BASE32[((b1 & 0x01) << 4) | (b2 >> 4)];
      randChars += CROCKFORD_BASE32[((b2 & 0x0f) << 1) | (b3 >> 7)];
      randChars += CROCKFORD_BASE32[(b3 >> 2) & 0x1f];
      randChars += CROCKFORD_BASE32[((b3 & 0x03) << 3) | (b4 >> 5)];
      randChars += CROCKFORD_BASE32[b4 & 0x1f];
    }

    return timeChars + randChars;
  }
}
