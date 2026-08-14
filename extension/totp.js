/**
 * CipherVault Extension TOTP 2FA Engine (RFC 6238)
 */
export class TOTP {
  static base32ToBuffer(base32) {
    const clean = base32.replace(/\s+/g, '').replace(/=+$/, '').toUpperCase();
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';

    for (let i = 0; i < clean.length; i++) {
      const val = alphabet.indexOf(clean.charAt(i));
      if (val === -1) continue;
      bits += val.toString(2).padStart(5, '0');
    }

    const bytes = new Uint8Array(Math.floor(bits.length / 8));
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(bits.substr(i * 8, 8), 2);
    }
    return bytes.buffer;
  }

  static async generateCode(secret, timeStep = 30) {
    try {
      if (!secret) return null;
      const keyBuffer = this.base32ToBuffer(secret);
      if (keyBuffer.byteLength === 0) return null;

      const epoch = Math.floor(Date.now() / 1000);
      const counter = Math.floor(epoch / timeStep);
      const remainingSeconds = timeStep - (epoch % timeStep);

      const counterBuffer = new ArrayBuffer(8);
      const counterView = new DataView(counterBuffer);
      counterView.setUint32(4, counter, false);

      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBuffer,
        { name: 'HMAC', hash: 'SHA-1' },
        false,
        ['sign']
      );

      const signature = await crypto.subtle.sign('HMAC', cryptoKey, counterBuffer);
      const hashBytes = new Uint8Array(signature);
      const offset = hashBytes[hashBytes.length - 1] & 0xf;

      const binary =
        ((hashBytes[offset] & 0x7f) << 24) |
        ((hashBytes[offset + 1] & 0xff) << 16) |
        ((hashBytes[offset + 2] & 0xff) << 8) |
        (hashBytes[offset + 3] & 0xff);

      const otp = (binary % 1000000).toString().padStart(6, '0');
      return { code: otp, remainingSeconds };
    } catch (e) {
      console.warn('Failed to calculate TOTP:', e);
      return null;
    }
  }
}
