/**
 * CipherVault Password Generator & Security Auditor
 */
export class PasswordGenerator {
  static CHARS = {
    uppercase: 'ABCDEFGHJKLMNPQRSTUVWXYZ', // Exclude I, O
    lowercase: 'abcdefghijkmnopqrstuvwxyz', // Exclude l
    numbers: '23456789', // Exclude 0, 1
    symbols: '!@#$%^&*()_+-=[]{}|;:,.<>?'
  };

  static ALL_CHARS = {
    uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    lowercase: 'abcdefghijklmnopqrstuvwxyz',
    numbers: '0123456789',
    symbols: '!@#$%^&*()_+-=[]{}|;:,.<>?'
  };

  static generate(options = {}) {
    const {
      length = 16,
      uppercase = true,
      lowercase = true,
      numbers = true,
      symbols = true,
      excludeAmbiguous = true
    } = options;

    const sourceChars = excludeAmbiguous ? this.CHARS : this.ALL_CHARS;
    let pool = '';
    const guaranteed = [];

    if (uppercase) {
      pool += sourceChars.uppercase;
      guaranteed.push(this.getRandomChar(sourceChars.uppercase));
    }
    if (lowercase) {
      pool += sourceChars.lowercase;
      guaranteed.push(this.getRandomChar(sourceChars.lowercase));
    }
    if (numbers) {
      pool += sourceChars.numbers;
      guaranteed.push(this.getRandomChar(sourceChars.numbers));
    }
    if (symbols) {
      pool += sourceChars.symbols;
      guaranteed.push(this.getRandomChar(sourceChars.symbols));
    }

    if (!pool) {
      pool = sourceChars.lowercase + sourceChars.numbers;
    }

    const remainingLength = Math.max(0, length - guaranteed.length);
    const randomChars = [];

    const randomBytes = new Uint32Array(remainingLength);
    window.crypto.getRandomValues(randomBytes);

    for (let i = 0; i < remainingLength; i++) {
      randomChars.push(pool[randomBytes[i] % pool.length]);
    }

    // Combine and shuffle
    const combined = guaranteed.concat(randomChars);
    for (let i = combined.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [combined[i], combined[j]] = [combined[j], combined[i]];
    }

    return combined.join('');
  }

  static getRandomChar(charSet) {
    const arr = new Uint32Array(1);
    window.crypto.getRandomValues(arr);
    return charSet[arr[0] % charSet.length];
  }

  /**
   * Evaluate password strength (0 to 100 score)
   */
  static evaluateStrength(password) {
    if (!password) return { score: 0, label: '空', color: '#ef4444' };

    let score = 0;
    const len = password.length;

    // Length score
    score += Math.min(len * 4, 40);

    // Variety checks
    if (/[a-z]/.test(password)) score += 10;
    if (/[A-Z]/.test(password)) score += 15;
    if (/[0-9]/.test(password)) score += 15;
    if (/[^a-zA-Z0-9]/.test(password)) score += 20;

    // Deduct for repetitive patterns
    if (/(.)\1{2,}/.test(password)) score -= 15;
    if (/^[0-9]+$/.test(password) || /^[a-zA-Z]+$/.test(password)) score -= 15;

    score = Math.max(0, Math.min(score, 100));

    if (score < 35) return { score, label: '弱', color: '#ef4444' };
    if (score < 65) return { score, label: '中等', color: '#f59e0b' };
    if (score < 85) return { score, label: '强', color: '#10b981' };
    return { score, label: '极强', color: '#06b6d4' };
  }
}
