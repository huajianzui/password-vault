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
    this.storageKey = 'ciphervault_encrypted_store';
    this.metaKey = 'ciphervault_metadata';
  }

  /**
   * Check if vault has been initialized with a master password
   */
  hasInitializedVault() {
    const meta = localStorage.getItem(this.metaKey);
    return meta !== null;
  }

  /**
   * Initialize a brand new vault
   */
  async initializeVault(masterPassword) {
    const saltBytes = VaultCrypto.generateRandomBytes(16);
    this.salt = VaultCrypto.bufferToBase64(saltBytes);
    this.key = await VaultCrypto.deriveKey(masterPassword, saltBytes);
    this.verifier = await VaultCrypto.createVerifier(this.key);
    this.items = [];
    this.isUnlocked = true;

    // Save metadata
    this.saveMetadata();
    // Save empty encrypted items
    await this.persistVault();
    return true;
  }

  /**
   * Save metadata (salt, verifier, sync settings) to localStorage
   */
  saveMetadata() {
    const meta = {
      salt: this.salt,
      verifier: this.verifier,
      syncConfig: this.syncConfig,
      autoLockMinutes: this.autoLockMinutes
    };
    localStorage.setItem(this.metaKey, JSON.stringify(meta));
  }

  /**
   * Load metadata from localStorage
   */
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

  /**
   * Unlock vault with master password
   */
  async unlockVault(masterPassword) {
    if (!this.loadMetadata()) {
      throw new Error('未找到已初始化的保险库');
    }

    const saltBytes = new Uint8Array(VaultCrypto.base64ToBuffer(this.salt));
    const derivedKey = await VaultCrypto.deriveKey(masterPassword, saltBytes);

    const isValid = await VaultCrypto.verifyKey(derivedKey, this.verifier);
    if (!isValid) {
      return false; // Wrong master password
    }

    this.key = derivedKey;
    this.isUnlocked = true;
    this.updateActivity();

    // Load and decrypt items
    await this.loadVaultItems();
    return true;
  }

  /**
   * Lock vault (wipe key and decrypted items from memory)
   */
  lockVault() {
    this.key = null;
    this.items = [];
    this.isUnlocked = false;
  }

  /**
   * Encrypt and persist items to localStorage
   */
  async persistVault() {
    if (!this.key) return;
    const encryptedObj = await VaultCrypto.encryptData(this.items, this.key);
    localStorage.setItem(this.storageKey, JSON.stringify(encryptedObj));
    return JSON.stringify(encryptedObj);
  }

  /**
   * Load and decrypt items from localStorage
   */
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
   * Load items from remote encrypted string (WebDAV / Gist)
   */
  async loadFromEncryptedString(encStr) {
    if (!this.key) return;
    try {
      const encryptedObj = JSON.parse(encStr);
      const remoteItems = await VaultCrypto.decryptData(encryptedObj, this.key);
      this.items = remoteItems;
      await this.persistVault();
      return true;
    } catch (e) {
      console.error('Remote decryption failed:', e);
      throw new Error('无法用当前主密码解密云端备份文件');
    }
  }

  /**
   * Add or update an item
   */
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

  /**
   * Move item to Trash / Permanent Delete
   */
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

  /**
   * Restore item from Trash
   */
  async restoreItem(id) {
    const item = this.items.find(i => i.id === id);
    if (item) {
      item.trash = false;
      item.updatedAt = new Date().toISOString();
      await this.persistVault();
    }
  }

  /**
   * Toggle favorite
   */
  async toggleFavorite(id) {
    const item = this.items.find(i => i.id === id);
    if (item) {
      item.favorite = !item.favorite;
      await this.persistVault();
    }
  }

  /**
   * Extract domain or return favicon URL
   */
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

  /**
   * Audit vault passwords for health metrics
   */
  auditVault() {
    const activeItems = this.items.filter(i => !i.trash && i.password);
    const total = activeItems.length;

    const weakItems = [];
    const passwordCounts = {};
    const reusedItems = [];

    activeItems.forEach(item => {
      // Weak check (length < 8 or score low)
      if (item.password.length < 8 || /^[0-9]+$/.test(item.password)) {
        weakItems.push(item);
      }

      // Reuse check
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
