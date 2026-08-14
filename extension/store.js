/**
 * CipherVault Extension Vault State & Storage Manager
 */
import { VaultCrypto } from './crypto.js';

export class VaultStore {
  constructor() {
    this.key = null;
    this.salt = null;
    this.verifier = null;
    this.items = [];
    this.syncConfig = { mode: 'local', webdav: {}, gist: {} };
    this.isUnlocked = false;
    this.currentMasterPassword = null;
    this.storageKey = 'ciphervault_encrypted_store';
    this.metaKey = 'ciphervault_metadata';
  }

  async getStorage(key) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const res = await chrome.storage.local.get(key);
      return res[key] || null;
    }
    return localStorage.getItem(key);
  }

  async setStorage(key, value) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ [key]: value });
    } else {
      localStorage.setItem(key, value);
    }
  }

  async hasInitializedVault() {
    const meta = await this.getStorage(this.metaKey);
    return meta !== null;
  }

  async saveMetadata() {
    const meta = {
      salt: this.salt,
      verifier: this.verifier,
      syncConfig: this.syncConfig
    };
    await this.setStorage(this.metaKey, JSON.stringify(meta));
  }

  async loadMetadata() {
    const metaStr = await this.getStorage(this.metaKey);
    if (!metaStr) return false;
    try {
      const meta = JSON.parse(metaStr);
      this.salt = meta.salt;
      this.verifier = meta.verifier;
      if (meta.syncConfig) this.syncConfig = meta.syncConfig;
      return true;
    } catch (e) {
      console.error('Failed to parse metadata:', e);
      return false;
    }
  }

  async initializeVault(masterPassword) {
    const saltBytes = VaultCrypto.generateRandomBytes(16);
    this.salt = VaultCrypto.bufferToBase64(saltBytes);
    this.key = await VaultCrypto.deriveKey(masterPassword, saltBytes);
    this.verifier = await VaultCrypto.createVerifier(this.key);
    this.currentMasterPassword = masterPassword;
    this.items = [];
    this.isUnlocked = true;

    await this.saveMetadata();
    await this.persistVault();
    return true;
  }

  async unlockVault(masterPassword) {
    const loaded = await this.loadMetadata();
    if (!loaded) return false;

    const saltBytes = new Uint8Array(VaultCrypto.base64ToBuffer(this.salt));
    const derivedKey = await VaultCrypto.deriveKey(masterPassword, saltBytes);

    const isValid = await VaultCrypto.verifyKey(derivedKey, this.verifier);
    if (!isValid) return false;

    this.key = derivedKey;
    this.currentMasterPassword = masterPassword;
    this.isUnlocked = true;

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
    if (!this.key) return null;
    const encryptedObj = await VaultCrypto.encryptData(this.items, this.key);
    encryptedObj.salt = this.salt;
    await this.setStorage(this.storageKey, JSON.stringify(encryptedObj));
    return JSON.stringify(encryptedObj);
  }

  async loadVaultItems() {
    if (!this.key) return;
    const encStr = await this.getStorage(this.storageKey);
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

  async loadFromEncryptedString(encStr, currentMasterPassword = null) {
    const pass = currentMasterPassword || this.currentMasterPassword;
    if (!this.key && !pass) {
      throw new Error('保险库尚未解锁，无法解密云端数据');
    }

    try {
      const encryptedObj = JSON.parse(encStr);
      let decryptKey = this.key;

      if (encryptedObj.salt && pass) {
        const saltBytes = new Uint8Array(VaultCrypto.base64ToBuffer(encryptedObj.salt));
        decryptKey = await VaultCrypto.deriveKey(pass, saltBytes);
      }

      const remoteItems = await VaultCrypto.decryptData(encryptedObj, decryptKey);
      if (!Array.isArray(remoteItems)) {
        throw new Error('云端解密数据格式不合法');
      }

      if (encryptedObj.salt && pass) {
        this.key = decryptKey;
        this.salt = encryptedObj.salt;
        this.verifier = await VaultCrypto.createVerifier(this.key);
        await this.saveMetadata();
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
      if (e.name === 'OperationError' || (e.message && e.message.includes('OperationError'))) {
        throw new Error('解密失败：云端数据的主密码与当前主密码不一致');
      }
      throw e;
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

  findItemsByDomain(domain) {
    if (!domain) return [];
    const cleanDomain = domain.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
    const mainHost = cleanDomain.split('.').slice(-2).join('.'); // e.g. github.com

    return this.items.filter(item => {
      if (item.trash) return false;
      const itemUrl = (item.url || '').toLowerCase();
      const itemTitle = (item.title || '').toLowerCase();

      return itemUrl.includes(mainHost) || itemUrl.includes(cleanDomain) || itemTitle.includes(mainHost) || cleanDomain.includes(itemTitle);
    });
  }
}
