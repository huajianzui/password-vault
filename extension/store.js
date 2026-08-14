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
      const rawItems = await VaultCrypto.decryptData(encryptedObj, this.key);
      
      // Auto-clean any historical duplicate items by (url_host, username, role)
      this.items = this.deduplicateItems(rawItems || []);
      await this.persistVault();
    } catch (e) {
      console.error('Vault decryption error:', e);
      this.items = [];
    }
  }

  deduplicateItems(items) {
    const map = new Map();
    items.forEach(item => {
      if (item.trash) {
        map.set(item.id, item);
        return;
      }
      const host = this.normalizeHost(item.url || '');
      const user = (item.username || '').trim().toLowerCase();
      const role = (item.role || '').trim().toLowerCase();
      
      const key = host && user ? `${host}:::${user}:::${role}` : item.id;
      if (!map.has(key)) {
        map.set(key, item);
      } else {
        const existing = map.get(key);
        const existingTime = new Date(existing.updatedAt || 0).getTime();
        const itemTime = new Date(item.updatedAt || 0).getTime();
        if (itemTime >= existingTime) {
          map.set(key, item);
        }
      }
    });
    return Array.from(map.values());
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

      const allMerged = [...this.items, ...remoteItems];
      this.items = this.deduplicateItems(allMerged);
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
    const itemHost = this.normalizeHost(item.url || '');
    const itemUser = (item.username || '').trim().toLowerCase();
    const itemRole = (item.role || '').trim().toLowerCase();

    let index = -1;
    if (item.id) {
      index = this.items.findIndex(i => i.id === item.id);
    }
    if (index === -1 && itemHost && itemUser) {
      index = this.items.findIndex(i => 
        !i.trash && 
        this.normalizeHost(i.url || '') === itemHost &&
        (i.username || '').trim().toLowerCase() === itemUser &&
        (i.role || '').trim().toLowerCase() === itemRole
      );
    }

    item.updatedAt = new Date().toISOString();

    if (index >= 0) {
      this.items[index] = { ...this.items[index], ...item };
    } else {
      if (!item.id) {
        item.id = 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      }
      if (!item.createdAt) item.createdAt = new Date().toISOString();
      this.items.unshift(item);
    }

    this.items = this.deduplicateItems(this.items);
    await this.persistVault();
    return item;
  }

  normalizeHost(urlOrHost) {
    if (!urlOrHost) return '';
    try {
      let host = urlOrHost.trim().toLowerCase();
      if (host.startsWith('http://') || host.startsWith('https://')) {
        const parsed = new URL(host);
        return parsed.hostname.replace(/^www\./, '');
      }
      return host.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0].split(':')[0];
    } catch (e) {
      return urlOrHost.toLowerCase();
    }
  }

  findItemsByDomain(domain) {
    if (!domain) return [];
    const currentHost = this.normalizeHost(domain);
    if (!currentHost) return [];

    const matched = this.items.filter(item => {
      if (item.trash) return false;
      const itemHost = this.normalizeHost(item.url || '');
      const itemTitle = (item.title || '').trim().toLowerCase();

      // 1. Exact host match
      if (itemHost && (itemHost === currentHost || currentHost.includes(itemHost) || itemHost.includes(currentHost))) {
        return true;
      }

      // 2. IP / Localhost check
      const isIpOrLocal = currentHost === 'localhost' || /^(\d{1,3}\.){3}\d{1,3}$/.test(currentHost);
      if (isIpOrLocal) {
        return itemHost === currentHost || itemTitle.includes(currentHost) || currentHost.includes(itemTitle);
      }

      // 3. Domain suffix check for standard domains
      const currentParts = currentHost.split('.');
      const currentMainDomain = currentParts.slice(-2).join('.');
      
      if (itemHost) {
        const itemParts = itemHost.split('.');
        const itemMainDomain = itemParts.slice(-2).join('.');
        if (currentMainDomain === itemMainDomain) return true;
      }

      if (itemTitle && (currentHost.includes(itemTitle) || itemTitle.includes(currentMainDomain))) {
        return true;
      }

      return false;
    });

    return this.deduplicateItems(matched);
  }
}
