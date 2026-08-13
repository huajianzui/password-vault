/**
 * CipherVault TOTP (RFC 6238) Generator - Base32 + HMAC-SHA1
 */
export class TOTP {
  static base32Decode(base32) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let cleaned = base32.toUpperCase().replace(/[\s=-]/g, '');
    let bits = '';
    let value = 0;

    for (let i = 0; i < cleaned.length; i++) {
      const idx = alphabet.indexOf(cleaned[i]);
      if (idx === -1) continue;
      bits += idx.toString(2).padStart(5, '0');
    }

    const bytes = new Uint8Array(Math.floor(bits.length / 8));
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(bits.substr(i * 8, 8), 2);
    }
    return bytes;
  }

  static async generateCode(secret, step = 30) {
    if (!secret) return null;
    try {
      const keyBytes = this.base32Decode(secret);
      if (keyBytes.length === 0) return null;

      const epoch = Math.floor(Date.now() / 1000);
      const timeCounter = Math.floor(epoch / step);

      // Convert time counter to 8-byte array
      const buffer = new ArrayBuffer(8);
      const view = new DataView(buffer);
      view.setUint32(4, timeCounter, false);

      const cryptoKey = await window.crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'HMAC', hash: { name: 'SHA-1' } },
        false,
        ['sign']
      );

      const signature = await window.crypto.subtle.sign('HMAC', cryptoKey, buffer);
      const sigBytes = new Uint8Array(signature);
      const offset = sigBytes[sigBytes.length - 1] & 0xf;

      const codeInt =
        ((sigBytes[offset] & 0x7f) << 24) |
        ((sigBytes[offset + 1] & 0xff) << 16) |
        ((sigBytes[offset + 2] & 0xff) << 8) |
        (sigBytes[offset + 3] & 0xff);

      const otp = (codeInt % 1000000).toString().padStart(6, '0');
      const remainingSeconds = step - (epoch % step);

      return { code: otp, remainingSeconds };
    } catch (e) {
      console.warn('TOTP calculation failed:', e);
      return null;
    }
  }
}
