/**
 * CipherVault Crypto Engine - Web Crypto API (PBKDF2 + AES-GCM 256)
 */
export class VaultCrypto {
  /**
   * Generate a random Uint8Array salt or IV
   */
  static generateRandomBytes(length = 16) {
    const bytes = new Uint8Array(length);
    window.crypto.getRandomValues(bytes);
    return bytes;
  }

  /**
   * Convert Uint8Array to Base64 string
   */
  static bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  /**
   * Convert Base64 string to Uint8Array
   */
  static base64ToBuffer(base64) {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Derive AES-GCM key from Master Password using PBKDF2
   */
  static async deriveKey(masterPassword, salt) {
    const enc = new TextEncoder();
    const passwordKey = await window.crypto.subtle.importKey(
      'raw',
      enc.encode(masterPassword),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    return await window.crypto.subtle.deriveKey(
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

  /**
   * Create a verification hash to validate master password later
   */
  static async createVerifier(key) {
    const testText = 'CIPHERVAULT_VALID_KEY_TOKEN';
    const enc = new TextEncoder();
    const iv = this.generateRandomBytes(12);
    const ciphertextBuffer = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      enc.encode(testText)
    );

    return {
      iv: this.bufferToBase64(iv),
      verifier: this.bufferToBase64(ciphertextBuffer)
    };
  }

  /**
   * Verify derived key against stored verifier
   */
  static async verifyKey(key, verifierObj) {
    try {
      const iv = new Uint8Array(this.base64ToBuffer(verifierObj.iv));
      const ciphertext = this.base64ToBuffer(verifierObj.verifier);
      const dec = new TextDecoder();

      const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        ciphertext
      );

      return dec.decode(decryptedBuffer) === 'CIPHERVAULT_VALID_KEY_TOKEN';
    } catch (e) {
      return false;
    }
  }

  /**
   * Encrypt arbitrary payload object into JSON string with AES-GCM
   */
  static async encryptData(payload, key) {
    const enc = new TextEncoder();
    const jsonString = JSON.stringify(payload);
    const iv = this.generateRandomBytes(12);

    const ciphertextBuffer = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      enc.encode(jsonString)
    );

    return {
      iv: this.bufferToBase64(iv),
      ciphertext: this.bufferToBase64(ciphertextBuffer)
    };
  }

  /**
   * Decrypt AES-GCM payload object back into original object
   */
  static async decryptData(encryptedObj, key) {
    const iv = new Uint8Array(this.base64ToBuffer(encryptedObj.iv));
    const ciphertext = this.base64ToBuffer(encryptedObj.ciphertext);
    const dec = new TextDecoder();

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      ciphertext
    );

    const jsonString = dec.decode(decryptedBuffer);
    return JSON.parse(jsonString);
  }
}
