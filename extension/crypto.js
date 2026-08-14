/**
 * CipherVault Extension Crypto Engine - Web Crypto API (PBKDF2 + AES-GCM 256)
 */
export class VaultCrypto {
  static generateRandomBytes(length = 16) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
  }

  static bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  static base64ToBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  static async deriveKey(masterPassword, salt) {
    const enc = new TextEncoder();
    const passwordKey = await crypto.subtle.importKey(
      'raw',
      enc.encode(masterPassword),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    return await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      passwordKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  static async createVerifier(key) {
    const testText = 'CIPHERVAULT_VALID_KEY_TOKEN';
    const enc = new TextEncoder();
    const iv = this.generateRandomBytes(12);
    const ciphertextBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      enc.encode(testText)
    );

    return {
      iv: this.bufferToBase64(iv),
      verifier: this.bufferToBase64(ciphertextBuffer)
    };
  }

  static async verifyKey(key, verifierObj) {
    try {
      const iv = new Uint8Array(this.base64ToBuffer(verifierObj.iv));
      const ciphertext = this.base64ToBuffer(verifierObj.verifier);
      const dec = new TextDecoder();

      const decryptedBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        ciphertext
      );

      return dec.decode(decryptedBuffer) === 'CIPHERVAULT_VALID_KEY_TOKEN';
    } catch (e) {
      return false;
    }
  }

  static async encryptData(payload, key) {
    const enc = new TextEncoder();
    const jsonString = JSON.stringify(payload);
    const iv = this.generateRandomBytes(12);

    const ciphertextBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      enc.encode(jsonString)
    );

    return {
      iv: this.bufferToBase64(iv),
      ciphertext: this.bufferToBase64(ciphertextBuffer)
    };
  }

  static async decryptData(encryptedObj, key) {
    const iv = new Uint8Array(this.base64ToBuffer(encryptedObj.iv));
    const ciphertext = this.base64ToBuffer(encryptedObj.ciphertext);
    const dec = new TextDecoder();

    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      ciphertext
    );

    const jsonString = dec.decode(decryptedBuffer);
    return JSON.parse(jsonString);
  }
}
