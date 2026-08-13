/**
 * CipherVault Store & Vault State Manager
 */
import { VaultCrypto } from './crypto.js';

export class VaultStore {
  constructor() {
    this.key = null; // Master CryptoKey (only in memory)
    this.salt = null; // Base64 salt string
    this.verifier = null; // Verifier object
    this.items = []; // Decrypted vault items array
    this.syncConfig = { mode: 'local', webdav: {}, gist: {} };
    this.autoLockMinutes = 15;
    this.isUnlocked = false;
    this.lastActivity = Date.now();
    this.currentMasterPassword = null; // Keep temporary in memory for salt re-derivation
    this.storageKey = 'ciphervault_encrypted_store';
    this.metaKey = 'ciphervault_metadata';
  }

  hasInitializedVault() {
    const meta = localStorage.getItem(this.metaKey);
    return meta !== null;
  }

  async initializeVault(masterPassword) {
    const saltBytes = VaultCrypto.generateRandomBytes(16);
    this.salt = VaultCrypto.bufferToBase64(saltBytes);
    this.key = await VaultCrypto.deriveKey(masterPassword, saltBytes);
    this.verifier = await VaultCrypto.createVerifier(this.key);
    this.currentMasterPassword = masterPassword;
    this.items = [];
    this.isUnlocked = true;

    this.saveMetadata();
    await this.persistVault();
    return true;
  }

  saveMetadata() {
    const meta = {
      salt: this.salt,
      verifier: this.verifier,
      syncConfig: this.syncConfig,
      autoLockMinutes: this.autoLockMinutes
    };
    localStorage.setItem(this.metaKey, JSON.stringify(meta));
  }

  loadMetadata() {
    const metaStr = localStorage.getItem(this.metaKey);
    if (!metaStr) return false;
    try {
      const meta = JSON.parse(metaStr);
      this.salt = meta.salt;
      this.verifier = meta.verifier;
      if (meta.syncConfig) this.syncConfig = meta.syncConfig;
      if (meta.autoLockMinutes) this.autoLockMinutes = meta.autoLockMinutes;
      return true;
    } catch (e) {
      console.error('Failed to parse vault metadata:', e);
      return false;
    }
  }

  async unlockVault(masterPassword) {
    if (!this.loadMetadata()) {
      throw new Error('未找到已初始化的保险库');
    }

    const saltBytes = new Uint8Array(VaultCrypto.base64ToBuffer(this.salt));
    const derivedKey = await VaultCrypto.deriveKey(masterPassword, saltBytes);

    const isValid = await VaultCrypto.verifyKey(derivedKey, this.verifier);
    if (!isValid) {
      return false;
    }

    this.key = derivedKey;
    this.currentMasterPassword = masterPassword;
    this.isUnlocked = true;
    this.updateActivity();

    await this.loadVaultItems();
    return true;
  }

  lockVault() {
    this.key = null;
    this.currentMasterPassword = null;
    this.items = [];
    this.isUnlocked = false;
  }

  async persistVault() {
    if (!this.key) return;
    const encryptedObj = await VaultCrypto.encryptData(this.items, this.key);
    encryptedObj.salt = this.salt; // Pack public Salt together with IV and Ciphertext
    localStorage.setItem(this.storageKey, JSON.stringify(encryptedObj));
    return JSON.stringify(encryptedObj);
  }

  async loadVaultItems() {
    if (!this.key) return;
    const encStr = localStorage.getItem(this.storageKey);
    if (!encStr) {
      this.items = [];
      return;
    }

    try {
      const encryptedObj = JSON.parse(encStr);
      this.items = await VaultCrypto.decryptData(encryptedObj, this.key);
    } catch (e) {
      console.error('Vault decryption error:', e);
      this.items = [];
    }
  }

  /**
   * Load and MERGE remote items with local items (supports cross-device Salt re-derivation)
   */
  async loadFromEncryptedString(encStr, currentMasterPassword = null) {
    const pass = currentMasterPassword || this.currentMasterPassword;
    if (!this.key && !pass) return false;

    try {
      const encryptedObj = JSON.parse(encStr);
      let decryptKey = this.key;

      // Re-derive key using remote Salt + Master Password if remote Salt differs
      if (encryptedObj.salt && pass) {
        const saltBytes = new Uint8Array(VaultCrypto.base64ToBuffer(encryptedObj.salt));
        decryptKey = await VaultCrypto.deriveKey(pass, saltBytes);
      }

      const remoteItems = await VaultCrypto.decryptData(encryptedObj, decryptKey);
      if (!Array.isArray(remoteItems)) return false;

      // If remote decryption with same master password succeeded, align key and salt
      if (encryptedObj.salt && pass) {
        this.key = decryptKey;
        this.salt = encryptedObj.salt;
        this.verifier = await VaultCrypto.createVerifier(this.key);
        this.saveMetadata();
      }

      const itemMap = new Map();
      this.items.forEach(item => itemMap.set(item.id, item));

      remoteItems.forEach(remoteItem => {
        const existing = itemMap.get(remoteItem.id);
        if (!existing) {
          itemMap.set(remoteItem.id, remoteItem);
        } else {
          const localTime = new Date(existing.updatedAt || 0).getTime();
          const remoteTime = new Date(remoteItem.updatedAt || 0).getTime();
          if (remoteTime > localTime) {
            itemMap.set(remoteItem.id, remoteItem);
          }
        }
      });

      this.items = Array.from(itemMap.values());
      await this.persistVault();
      return true;
    } catch (e) {
      console.error('Remote decryption failed:', e);
      throw new Error('解密云端数据失败，请确认两端主密码是否完全一致（区分大小写）');
    }
  }

  async saveItem(item) {
    const index = this.items.findIndex(i => i.id === item.id);
    item.updatedAt = new Date().toISOString();

    if (index >= 0) {
      this.items[index] = item;
    } else {
      if (!item.id) {
        item.id = 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      }
      if (!item.createdAt) item.createdAt = new Date().toISOString();
      this.items.unshift(item);
    }

    await this.persistVault();
    return item;
  }

  async deleteItem(id, permanent = false) {
    if (permanent) {
      this.items = this.items.filter(i => i.id !== id);
    } else {
      const item = this.items.find(i => i.id === id);
      if (item) {
        item.trash = true;
        item.updatedAt = new Date().toISOString();
      }
    }
    await this.persistVault();
  }

  async restoreItem(id) {
    const item = this.items.find(i => i.id === id);
    if (item) {
      item.trash = false;
      item.updatedAt = new Date().toISOString();
      await this.persistVault();
    }
  }

  async toggleFavorite(id) {
    const item = this.items.find(i => i.id === id);
    if (item) {
      item.favorite = !item.favorite;
      await this.persistVault();
    }
  }

  static getFaviconUrl(url, title = '') {
    if (!url) return null;
    try {
      let cleanUrl = url;
      if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
        cleanUrl = 'https://' + cleanUrl;
      }
      const parsed = new URL(cleanUrl);
      const domain = parsed.hostname;
      if (!domain) return null;
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
    } catch (e) {
      return null;
    }
  }

  auditVault() {
    const activeItems = this.items.filter(i => !i.trash && i.password);
    const total = activeItems.length;

    const weakItems = [];
    const passwordCounts = {};
    const reusedItems = [];

    activeItems.forEach(item => {
      if (item.password.length < 8 || /^[0-9]+$/.test(item.password)) {
        weakItems.push(item);
      }
      passwordCounts[item.password] = (passwordCounts[item.password] || 0) + 1;
    });

    activeItems.forEach(item => {
      if (passwordCounts[item.password] > 1) {
        reusedItems.push(item);
      }
    });

    return {
      total,
      weakCount: weakItems.length,
      reusedCount: reusedItems.length,
      weakItems,
      reusedItems
    };
  }

  updateActivity() {
    this.lastActivity = Date.now();
  }

  checkAutoLock() {
    if (!this.isUnlocked || !this.autoLockMinutes) return false;
    const elapsedMinutes = (Date.now() - this.lastActivity) / 1000 / 60;
    if (elapsedMinutes >= this.autoLockMinutes) {
      this.lockVault();
      return true;
    }
    return false;
  }
}
