/**
 * CipherVault Extension Popup Controller
 */
import { VaultStore } from './store.js';
import { TOTP } from './totp.js';
import { PasswordGenerator } from './generator.js';
import { SyncClient } from './webdav.js';

class PopupController {
  constructor() {
    this.store = new VaultStore();
    this.currentTab = null;
    this.currentHost = '';
    this.searchQuery = '';
  }

  async init() {
    this.bindEvents();
    await this.loadActiveTab();
    await this.checkStatus();
  }

  async loadActiveTab() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs && tabs.length > 0) {
        this.currentTab = tabs[0];
        if (this.currentTab.url && this.currentTab.url.startsWith('http')) {
          const urlObj = new URL(this.currentTab.url);
          this.currentHost = urlObj.hostname.replace(/^www\./, '');
        }
      }
    } catch (e) {
      console.warn('Failed to load active tab:', e);
    }
  }

  async checkStatus() {
    const isInit = await this.store.hasInitializedVault();
    const lockTitle = document.getElementById('lock-title');
    const lockSub = document.getElementById('lock-sub');

    if (!isInit) {
      lockTitle.textContent = '欢迎使用 CipherVault';
      lockSub.textContent = '设置主密码以初始化密室';
    } else {
      lockTitle.textContent = 'CipherVault 已锁定';
      lockSub.textContent = '输入主密码以解密密码库';
    }

    this.showView('view-lock');
  }

  showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    const target = document.getElementById(viewId);
    if (target) target.style.display = 'flex';

    const isUnlocked = this.store.isUnlocked;
    document.getElementById('unlocked-header-actions').style.display = isUnlocked ? 'flex' : 'none';
    document.getElementById('bottom-nav').style.display = isUnlocked ? 'flex' : 'none';
  }

  async syncSessionWithBackground() {
    try {
      chrome.runtime.sendMessage({
        action: 'syncUnlockedSession',
        items: this.store.items
      });
    } catch (e) {
      console.warn('Background sync error:', e);
    }
  }

  async handleAuth(e) {
    e.preventDefault();
    const input = document.getElementById('input-master-pwd');
    const pwd = input.value;
    if (!pwd) return;

    const isInit = await this.store.hasInitializedVault();

    if (!isInit) {
      if (pwd.length < 6) {
        this.showToast('主密码长度不能少于 6 位');
        return;
      }
      await this.store.initializeVault(pwd);
      this.showToast('保险库创建成功！');
    } else {
      const success = await this.store.unlockVault(pwd);
      if (!success) {
        this.showToast('主密码错误，无法解密');
        input.value = '';
        return;
      }
      this.showToast('已解锁保险库');
    }

    // Share unlocked items with background service worker for page-load autofill
    await this.syncSessionWithBackground();

    // Process any pending captured credentials
    await this.processPendingCaptures();

    this.renderVaultView();
    this.showView('view-vault');

    // Auto pull in background
    this.performSync(false);
  }

  async processPendingCaptures() {
    const res = await chrome.storage.local.get(['ciphervault_pending_captures']);
    const pending = res.ciphervault_pending_captures || [];
    if (pending.length > 0) {
      for (const item of pending) {
        await this.store.saveItem(item);
      }
      await chrome.storage.local.remove(['ciphervault_pending_captures']);
      await this.syncSessionWithBackground();
      this.showToast(`已自动同步保存 ${pending.length} 条新登录账号！`);
    }
  }

  renderVaultView() {
    document.getElementById('current-host-tag').textContent = this.currentHost || '非网页标签';

    // 1. Matched items for current website (Multiple accounts)
    const matchedContainer = document.getElementById('matched-items-list');
    matchedContainer.innerHTML = '';

    const matched = this.store.findItemsByDomain(this.currentHost);
    if (matched.length === 0) {
      matchedContainer.innerHTML = `<div style="font-size: 12px; color: #64748b; padding: 4px 0;">未找到该网站已保存的账号</div>`;
    } else {
      matched.forEach(item => {
        matchedContainer.appendChild(this.createItemCard(item, true));
      });
    }

    // 2. All items list
    this.renderAllItems();
  }

  renderAllItems() {
    const allContainer = document.getElementById('all-items-list');
    allContainer.innerHTML = '';

    const q = this.searchQuery.toLowerCase();
    const filtered = this.store.items.filter(item => {
      if (item.trash) return false;
      if (!q) return true;
      return (item.title || '').toLowerCase().includes(q) ||
             (item.username || '').toLowerCase().includes(q) ||
             (item.role || '').toLowerCase().includes(q) ||
             (item.url || '').toLowerCase().includes(q);
    });

    if (filtered.length === 0) {
      allContainer.innerHTML = `<div style="font-size: 12px; color: #64748b; padding: 10px 0; text-align: center;">无匹配凭据</div>`;
      return;
    }

    filtered.forEach(item => {
      allContainer.appendChild(this.createItemCard(item, false));
    });
  }

  createItemCard(item, isMatched = false) {
    const card = document.createElement('div');
    card.className = 'card-item';

    const roleText = item.role || (item.title !== this.currentHost ? item.title : '');
    const roleTag = roleText
      ? `<span style="background: rgba(99,102,241,0.2); color: #818cf8; border: 1px solid rgba(99,102,241,0.3); padding: 1px 5px; border-radius: 4px; font-size: 10px; margin-left: 6px;">${this.escapeHtml(roleText)}</span>`
      : '';

    card.innerHTML = `
      <div class="card-meta">
        <div class="card-title">${this.escapeHtml(item.title || '未命名')}${roleTag}</div>
        <div class="card-sub">${this.escapeHtml(item.username || '无用户名')}</div>
      </div>
      <div class="card-actions">
        <button class="btn btn-fill btn-card-fill" title="选择并填入此账号">⚡ 填充</button>
        ${item.totpSecret ? `<button class="icon-btn btn-card-totp" title="复制 2FA 动态码">🔑</button>` : ''}
        <button class="icon-btn btn-card-user" title="复制账号">👤</button>
        <button class="icon-btn btn-card-pwd" title="复制密码">📋</button>
      </div>
    `;

    // Fill Action
    const fillBtn = card.querySelector('.btn-card-fill');
    if (fillBtn) {
      fillBtn.addEventListener('click', async () => {
        if (!this.currentTab || !this.currentTab.id) return;

        const sendFillMsg = async () => {
          return new Promise((resolve) => {
            chrome.tabs.sendMessage(
              this.currentTab.id,
              { action: 'autofill', data: { username: item.username, password: item.password } },
              (response) => {
                if (chrome.runtime.lastError || !response || !response.success) {
                  resolve(false);
                } else {
                  resolve(true);
                }
              }
            );
          });
        };

        let filled = await sendFillMsg();
        if (!filled) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: this.currentTab.id },
              files: ['content.js']
            });
            filled = await sendFillMsg();
          } catch (e) {
            console.warn('Script injection error:', e);
          }
        }

        if (filled) {
          this.showToast(`已填入账号: ${item.username}`);
          setTimeout(() => window.close(), 600);
        } else {
          this.showToast('未能定位到可填充的输入框');
        }
      });
    }

    // Copy Username
    card.querySelector('.btn-card-user').addEventListener('click', () => {
      navigator.clipboard.writeText(item.username || '');
      this.showToast('已复制账号');
    });

    // Copy Password
    card.querySelector('.btn-card-pwd').addEventListener('click', () => {
      navigator.clipboard.writeText(item.password || '');
      this.showToast('已复制密码');
    });

    // Copy TOTP 2FA
    const totpBtn = card.querySelector('.btn-card-totp');
    if (totpBtn) {
      totpBtn.addEventListener('click', async () => {
        const res = await TOTP.generateCode(item.totpSecret);
        if (res) {
          navigator.clipboard.writeText(res.code);
          this.showToast(`已复制 2FA 验证码: ${res.code}`);
        }
      });
    }

    return card;
  }

  async performSync(showToast = true) {
    const cfg = this.store.syncConfig;
    if (!cfg || cfg.mode === 'local') return;

    const statusEl = document.getElementById('sync-status-msg');
    if (statusEl) statusEl.textContent = '正在同步中...';

    try {
      let remoteEncData = null;
      if (cfg.mode === 'gist' && cfg.gist && cfg.gist.token) {
        remoteEncData = await SyncClient.pullGist(cfg.gist);
      } else if (cfg.mode === 'webdav' && cfg.webdav && cfg.webdav.url) {
        const content = await SyncClient.pullWebDAV(cfg.webdav);
        if (content) remoteEncData = { content };
      }

      if (remoteEncData && remoteEncData.content) {
        if (remoteEncData.gistId && remoteEncData.gistId !== cfg.gist.gistId) {
          this.store.syncConfig.gist.gistId = remoteEncData.gistId;
          await this.store.saveMetadata();
        }
        await this.store.loadFromEncryptedString(remoteEncData.content, this.store.currentMasterPassword);
        await this.syncSessionWithBackground();
        this.renderVaultView();
      }

      const encStr = await this.store.persistVault();
      if (encStr) {
        if (cfg.mode === 'gist' && cfg.gist && cfg.gist.token) {
          const newId = await SyncClient.pushGist(cfg.gist, encStr);
          if (newId && newId !== cfg.gist.gistId) {
            this.store.syncConfig.gist.gistId = newId;
            await this.store.saveMetadata();
          }
        } else if (cfg.mode === 'webdav' && cfg.webdav && cfg.webdav.url) {
          await SyncClient.pushWebDAV(cfg.webdav, encStr);
        }
      }

      if (statusEl) statusEl.textContent = `同步成功 (${new Date().toLocaleTimeString()})`;
      if (showToast) this.showToast('云端双向同步成功！');
    } catch (e) {
      console.warn('Sync failed:', e);
      if (statusEl) statusEl.textContent = '同步失败: ' + e.message;
      if (showToast) this.showToast('同步失败: ' + e.message);
    }
  }

  updateGenerator() {
    const length = parseInt(document.getElementById('gen-len-slider').value, 10);
    const uppercase = document.getElementById('chk-upper').checked;
    const lowercase = document.getElementById('chk-lower').checked;
    const numbers = document.getElementById('chk-num').checked;
    const symbols = document.getElementById('chk-sym').checked;

    const pwd = PasswordGenerator.generate({ length, uppercase, lowercase, numbers, symbols });
    document.getElementById('gen-pwd-output').value = pwd;
    document.getElementById('gen-len-label').textContent = `${length} 位`;
  }

  bindEvents() {
    document.getElementById('form-unlock').addEventListener('submit', (e) => this.handleAuth(e));

    document.getElementById('btn-lock').addEventListener('click', () => {
      this.store.lockVault();
      this.syncSessionWithBackground();
      this.showToast('保险库已锁定');
      this.checkStatus();
    });

    document.getElementById('btn-sync-now').addEventListener('click', () => {
      this.performSync(true);
    });

    document.getElementById('input-search').addEventListener('input', (e) => {
      this.searchQuery = e.target.value;
      this.renderAllItems();
    });

    // Tab Switching
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const targetView = tab.dataset.target;
        this.showView(targetView);

        if (targetView === 'view-generator') {
          this.updateGenerator();
        } else if (targetView === 'view-sync') {
          const cfg = this.store.syncConfig;
          document.getElementById('sel-sync-mode').value = cfg.mode || 'local';
          document.getElementById('input-gist-token').value = (cfg.gist && cfg.gist.token) || '';
          document.getElementById('input-gist-id').value = (cfg.gist && cfg.gist.gistId) || '';
        }
      });
    });

    // Generator Events
    document.getElementById('gen-len-slider').addEventListener('input', () => this.updateGenerator());
    ['chk-upper', 'chk-lower', 'chk-num', 'chk-sym'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => this.updateGenerator());
    });
    document.getElementById('btn-gen-refresh').addEventListener('click', () => this.updateGenerator());
    document.getElementById('btn-copy-gen-pwd').addEventListener('click', () => {
      const pwd = document.getElementById('gen-pwd-output').value;
      navigator.clipboard.writeText(pwd);
      this.showToast('随机强密码已复制！');
    });

    // Sync Save Event
    document.getElementById('btn-save-sync').addEventListener('click', async () => {
      const mode = document.getElementById('sel-sync-mode').value;
      this.store.syncConfig = {
        mode,
        gist: {
          token: document.getElementById('input-gist-token').value.trim(),
          gistId: document.getElementById('input-gist-id').value.trim()
        }
      };
      await this.store.saveMetadata();
      await this.performSync(true);
    });
  }

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  showToast(msg) {
    const toast = document.getElementById('popup-toast');
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new PopupController();
  app.init();
});
