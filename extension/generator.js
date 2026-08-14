/**
 * CipherVault Password Generator & Strength Evaluator
 */
export class PasswordGenerator {
  static CHARSETS = {
    uppercase: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
    lowercase: 'abcdefghijkmnopqrstuvwxyz',
    numbers: '23456789',
    symbols: '!@#$%^&*()_+-=[]{}|;:,.<>?'
  };

  static generate(options = {}) {
    const {
      length = 16,
      uppercase = true,
      lowercase = true,
      numbers = true,
      symbols = true
    } = options;

    let pool = '';
    const guaranteed = [];

    if (uppercase) {
      pool += this.CHARSETS.uppercase;
      guaranteed.push(this.getRandomChar(this.CHARSETS.uppercase));
    }
    if (lowercase) {
      pool += this.CHARSETS.lowercase;
      guaranteed.push(this.getRandomChar(this.CHARSETS.lowercase));
    }
    if (numbers) {
      pool += this.CHARSETS.numbers;
      guaranteed.push(this.getRandomChar(this.CHARSETS.numbers));
    }
    if (symbols) {
      pool += this.CHARSETS.symbols;
      guaranteed.push(this.getRandomChar(this.CHARSETS.symbols));
    }

    if (!pool) pool = this.CHARSETS.lowercase + this.CHARSETS.numbers;

    const remainingLength = Math.max(0, length - guaranteed.length);
    const randomBytes = new Uint32Array(remainingLength);
    crypto.getRandomValues(randomBytes);

    const result = [...guaranteed];
    for (let i = 0; i < remainingLength; i++) {
      result.push(pool[randomBytes[i] % pool.length]);
    }

    // Fisher-Yates Shuffle
    for (let i = result.length - 1; i > 0; i--) {
      const jBytes = new Uint32Array(1);
      crypto.getRandomValues(jBytes);
      const j = jBytes[0] % (i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }

    return result.join('');
  }

  static getRandomChar(str) {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    return str[bytes[0] % str.length];
  }

  static evaluateStrength(password) {
    if (!password) return { score: 0, label: '无', color: '#64748b' };
    let score = 0;
    if (password.length >= 8) score += 20;
    if (password.length >= 12) score += 20;
    if (password.length >= 16) score += 20;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 15;
    if (/[0-9]/.test(password)) score += 10;
    if (/[^a-zA-Z0-9]/.test(password)) score += 15;

    if (score < 40) return { score, label: '较弱', color: '#ef4444' };
    if (score < 75) return { score, label: '中等', color: '#f59e0b' };
    return { score, label: '极强', color: '#10b981' };
  }
}
