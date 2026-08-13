/**
 * CipherVault App Main Controller
 */
import { VaultCrypto } from './crypto.js';
import { VaultStore } from './store.js';
import { TOTP } from './totp.js';
import { PasswordGenerator } from './generator.js';
import { DataImporter } from './importer.js';
import { SyncClient } from './webdav.js';

class AppController {
  constructor() {
    this.store = new VaultStore();
    this.currentCategory = 'all';
    this.searchQuery = '';
    this.selectedItemId = null;
    this.totpTimer = null;
    this.clipboardTimer = null;
    this.autoLockCheckTimer = null;
    this.lastSyncTime = null;
  }

  async init() {
    this.bindEvents();
    this.checkVaultStatus();

    // Setup auto-lock checker every 30s
    this.autoLockCheckTimer = setInterval(() => {
      if (this.store.checkAutoLock()) {
        this.showToast('保险库已被闲置自动锁定', 'warning');
        this.checkVaultStatus();
      }
    }, 30000);

    // Track user activity
    window.addEventListener('mousemove', () => this.store.updateActivity());
    window.addEventListener('keydown', () => this.store.updateActivity());
  }

  checkVaultStatus() {
    const isInit = this.store.hasInitializedVault();
    const lockOverlay = document.getElementById('lock-overlay');
    const lockTitle = document.getElementById('lock-title');
    const lockSub = document.getElementById('lock-subtitle');
    const masterInput = document.getElementById('master-password-input');
    const initNotice = document.getElementById('init-notice');

    if (!isInit) {
      lockTitle.textContent = '欢迎使用 CipherVault';
      lockSub.textContent = '请设置您的高级主密码以创建全新密室';
      initNotice.style.display = 'block';
    } else {
      lockTitle.textContent = '保险库已锁定';
      lockSub.textContent = '请输入主密码解密您的专属密码库';
      initNotice.style.display = 'none';
    }
    masterInput.value = '';
    lockOverlay.style.display = 'flex';
  }

  async handleMasterAuth(e) {
    e.preventDefault();
    const input = document.getElementById('master-password-input');
    const masterPassword = input.value;
    if (!masterPassword) return;

    const isInit = this.store.hasInitializedVault();

    try {
      if (!isInit) {
        if (masterPassword.length < 6) {
          this.showToast('主密码长度不能少于 6 位', 'warning');
          return;
        }
        await this.store.initializeVault(masterPassword);
        this.showToast('保险库创建成功！已完成 AES-256 加密初始化', 'success');
      } else {
        const success = await this.store.unlockVault(masterPassword);
        if (!success) {
          this.showToast('主密码错误，无法解密保险库', 'danger');
          input.value = '';
          return;
        }
        this.showToast('欢迎回来！密码库已解密', 'success');
      }

      document.getElementById('lock-overlay').style.display = 'none';
      this.renderSidebar();
      this.renderVaultList();
      this.clearDetailPane();

      // Auto Pull latest data from cloud (WebDAV/Gist) on unlock
      await this.autoSyncPull();
    } catch (err) {
      console.error(err);
      this.showToast('操作失败: ' + err.message, 'danger');
    }
  }

  /**
   * Auto Sync Push: Push encrypted data to cloud automatically on save/delete
   */
  async autoSyncPush() {
    const cfg = this.store.syncConfig;
    if (!cfg || cfg.mode === 'local') return;

    try {
      const encStr = await this.store.persistVault();
      if (cfg.mode === 'webdav' && cfg.webdav && cfg.webdav.url) {
        await SyncClient.pushWebDAV(cfg.webdav, encStr);
        this.updateSyncStatus('已同步至 WebDAV', new Date());
      } else if (cfg.mode === 'gist' && cfg.gist && cfg.gist.token) {
        const newGistId = await SyncClient.pushGist(cfg.gist, encStr);
        if (newGistId && newGistId !== cfg.gist.gistId) {
          this.store.syncConfig.gist.gistId = newGistId;
          this.store.saveMetadata();
        }
        this.updateSyncStatus('已实时同步至 GitHub Gist', new Date());
      }
    } catch (e) {
      console.warn('Auto sync push error:', e);
      this.updateSyncStatus('同步失败: ' + e.message, null, true);
    }
  }

  /**
   * Auto Sync Pull: Pull remote data and update local storage (supports auto Gist ID discovery)
   */
  async autoSyncPull() {
    const cfg = this.store.syncConfig;
    if (!cfg || cfg.mode === 'local') return;

    try {
      let remoteEncData = null;
      if (cfg.mode === 'webdav' && cfg.webdav && cfg.webdav.url) {
        const content = await SyncClient.pullWebDAV(cfg.webdav);
        if (content) remoteEncData = { content };
      } else if (cfg.mode === 'gist' && cfg.gist && cfg.gist.token) {
        remoteEncData = await SyncClient.pullGist(cfg.gist);
      }

      if (remoteEncData && remoteEncData.content) {
        if (remoteEncData.gistId && remoteEncData.gistId !== cfg.gist.gistId) {
          this.store.syncConfig.gist.gistId = remoteEncData.gistId;
          this.store.saveMetadata();
        }
        await this.store.loadFromEncryptedString(remoteEncData.content);
        this.renderSidebar();
        this.renderVaultList();
        this.updateSyncStatus('已成功从云端拉取最新数据', new Date());
      }
    } catch (e) {
      console.warn('Auto sync pull error:', e);
      this.updateSyncStatus('云端拉取失败: ' + e.message, null, true);
    }
  }

  updateSyncStatus(text, dateObj = null, isError = false) {
    const indicator = document.getElementById('sync-status-indicator');
    if (!indicator) return;

    if (dateObj) {
      this.lastSyncTime = dateObj;
      const timeStr = dateObj.toLocaleTimeString();
      indicator.textContent = `${text} (${timeStr})`;
      indicator.style.color = 'var(--success)';
    } else if (isError) {
      indicator.textContent = text;
      indicator.style.color = 'var(--danger)';
    } else {
      indicator.textContent = text;
      indicator.style.color = 'var(--text-muted)';
    }
  }

  renderSidebar() {
    const counts = {
      all: 0,
      favorite: 0,
      login: 0,
      card: 0,
      note: 0,
      audit: 0,
      trash: 0
    };

    this.store.items.forEach(item => {
      if (item.trash) {
        counts.trash++;
        return;
      }
      counts.all++;
      if (item.favorite) counts.favorite++;
      if (item.category === 'login') counts.login++;
      if (item.category === 'card') counts.card++;
      if (item.category === 'note') counts.note++;
    });

    const auditData = this.store.auditVault();
    counts.audit = auditData.weakCount + auditData.reusedCount;

    document.getElementById('count-all').textContent = counts.all;
    document.getElementById('count-favorite').textContent = counts.favorite;
    document.getElementById('count-login').textContent = counts.login;
    document.getElementById('count-card').textContent = counts.card;
    document.getElementById('count-note').textContent = counts.note;
    document.getElementById('count-audit').textContent = counts.audit;
    document.getElementById('count-trash').textContent = counts.trash;
  }

  renderVaultList() {
    const container = document.getElementById('vault-items-container');
    container.innerHTML = '';

    const filtered = this.store.items.filter(item => {
      if (this.currentCategory === 'favorite' && (!item.favorite || item.trash)) return false;
      if (this.currentCategory === 'trash' && !item.trash) return false;
      if (this.currentCategory !== 'trash' && item.trash) return false;
      if (['login', 'card', 'note'].includes(this.currentCategory) && item.category !== this.currentCategory) return false;
      if (this.currentCategory === 'audit') {
        if (item.trash) return false;
        const auditData = this.store.auditVault();
        const isWeak = auditData.weakItems.some(i => i.id === item.id);
        const isReused = auditData.reusedItems.some(i => i.id === item.id);
        if (!isWeak && !isReused) return false;
      }

      if (this.searchQuery) {
        const q = this.searchQuery.toLowerCase();
        const titleMatch = (item.title || '').toLowerCase().includes(q);
        const userMatch = (item.username || '').toLowerCase().includes(q);
        const urlMatch = (item.url || '').toLowerCase().includes(q);
        const tagMatch = (item.tags || []).some(t => t.toLowerCase().includes(q));
        return titleMatch || userMatch || urlMatch || tagMatch;
      }

      return true;
    });

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 40px 20px; color: var(--text-dim);">
          <i data-lucide="inbox" style="width: 32px; height: 32px; margin-bottom: 8px;"></i>
          <p style="font-size: 14px;">没有找到匹配的条目</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    filtered.forEach(item => {
      const card = document.createElement('div');
      card.className = `vault-item-card ${item.id === this.selectedItemId ? 'active' : ''}`;
      
      const iconUrl = VaultStore.getFaviconUrl(item.url, item.title);
      const iconHtml = iconUrl 
        ? `<img src="${iconUrl}" onerror="this.onerror=null; this.src=''; this.parentNode.innerHTML='<i data-lucide=\\'key\\'></i>';" />`
        : `<i data-lucide="${this.getCategoryIcon(item.category)}"></i>`;

      card.innerHTML = `
        <div class="item-icon">${iconHtml}</div>
        <div class="item-meta">
          <div class="item-title">${this.escapeHtml(item.title || '未命名')}</div>
          <div class="item-sub">${this.escapeHtml(item.username || item.url || '暂无账号名')}</div>
        </div>
        ${item.favorite ? `<i data-lucide="star" style="width: 16px; height: 16px; color: #f59e0b; fill: #f59e0b;"></i>` : ''}
      `;

      card.addEventListener('click', () => {
        this.selectedItemId = item.id;
        this.renderVaultList();
        this.renderDetailPane(item);
      });

      container.appendChild(card);
    });

    if (window.lucide) window.lucide.createIcons();
  }

  renderDetailPane(item) {
    const pane = document.getElementById('vault-detail-pane');
    pane.classList.add('mobile-active');

    const iconUrl = VaultStore.getFaviconUrl(item.url, item.title);
    const iconHtml = iconUrl 
      ? `<img src="${iconUrl}" style="width: 36px; height: 36px; object-fit: contain;" />`
      : `<i data-lucide="${this.getCategoryIcon(item.category)}"></i>`;

    pane.innerHTML = `
      <div class="detail-header">
        <div class="detail-title-block">
          <div class="detail-large-icon">${iconHtml}</div>
          <div>
            <h1 class="detail-h1">${this.escapeHtml(item.title || '未命名条目')}</h1>
            <div class="detail-category-tag">${this.getCategoryLabel(item.category)} · 更新于 ${new Date(item.updatedAt).toLocaleDateString()}</div>
          </div>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-secondary" id="btn-toggle-fav">
            <i data-lucide="star" style="${item.favorite ? 'color: #f59e0b; fill: #f59e0b;' : ''}"></i>
            ${item.favorite ? '取消收藏' : '收藏'}
          </button>
          <button class="btn btn-primary" id="btn-edit-item">编辑</button>
          <button class="btn btn-secondary" id="btn-delete-item" style="color: var(--danger);">
            <i data-lucide="${item.trash ? 'trash-2' : 'trash'}"></i>
          </button>
        </div>
      </div>

      <div class="detail-section">
        ${item.username ? `
          <div class="field-box">
            <div class="field-header">
              <span class="field-label">账号 / 用户名</span>
              <button class="btn-icon" id="copy-username" title="复制账号"><i data-lucide="copy"></i></button>
            </div>
            <div class="field-content font-mono">${this.escapeHtml(item.username)}</div>
          </div>
        ` : ''}

        ${item.password ? `
          <div class="field-box">
            <div class="field-header">
              <span class="field-label">密码</span>
              <div style="display: flex; gap: 4px;">
                <button class="btn-icon" id="toggle-pwd-mask" title="显示/隐藏"><i data-lucide="eye"></i></button>
                <button class="btn-icon" id="copy-password" title="复制密码"><i data-lucide="copy"></i></button>
              </div>
            </div>
            <div class="field-content font-mono" id="pwd-display">••••••••••••</div>
          </div>
        ` : ''}

        ${item.url ? `
          <div class="field-box">
            <div class="field-header">
              <span class="field-label">网址 / URL</span>
              <a href="${item.url.startsWith('http') ? item.url : 'https://' + item.url}" target="_blank" class="btn-icon" title="在浏览器打开"><i data-lucide="external-link"></i></a>
            </div>
            <div class="field-content font-mono">${this.escapeHtml(item.url)}</div>
          </div>
        ` : ''}

        ${item.totpSecret ? `
          <div class="field-box">
            <div class="field-header">
              <span class="field-label">双重验证 (2FA / TOTP)</span>
              <button class="btn-icon" id="copy-totp" title="复制验证码"><i data-lucide="copy"></i></button>
            </div>
            <div class="field-content totp-box">
              <span class="totp-code font-mono" id="totp-code-display">------</span>
              <span style="font-size: 13px; color: var(--accent-cyan);" id="totp-timer-display">30s</span>
            </div>
          </div>
        ` : ''}

        ${item.notes ? `
          <div class="field-box">
            <span class="field-label">安全笔记 / 备注</span>
            <div class="field-content" style="white-space: pre-wrap; font-size: 14px;">${this.escapeHtml(item.notes)}</div>
          </div>
        ` : ''}
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();

    document.getElementById('btn-toggle-fav').addEventListener('click', async () => {
      await this.store.toggleFavorite(item.id);
      this.renderSidebar();
      this.renderVaultList();
      this.renderDetailPane(item);
      await this.autoSyncPush();
    });

    document.getElementById('btn-delete-item').addEventListener('click', async () => {
      if (item.trash) {
        if (confirm('确认永久删除该账号凭据？删除后无法恢复。')) {
          await this.store.deleteItem(item.id, true);
          this.showToast('已永久删除该凭据', 'success');
        }
      } else {
        await this.store.deleteItem(item.id, false);
        this.showToast('已移至回收站', 'success');
      }
      this.selectedItemId = null;
      this.renderSidebar();
      this.renderVaultList();
      this.clearDetailPane();
      await this.autoSyncPush();
    });

    document.getElementById('btn-edit-item').addEventListener('click', () => {
      this.openItemModal(item);
    });

    if (item.username) {
      document.getElementById('copy-username').addEventListener('click', () => {
        navigator.clipboard.writeText(item.username);
        this.showToast('账号已复制到剪贴板', 'success');
      });
    }

    if (item.password) {
      let isVisible = false;
      const pwdDisplay = document.getElementById('pwd-display');
      document.getElementById('toggle-pwd-mask').addEventListener('click', () => {
        isVisible = !isVisible;
        pwdDisplay.textContent = isVisible ? item.password : '••••••••••••';
      });

      document.getElementById('copy-password').addEventListener('click', () => {
        navigator.clipboard.writeText(item.password);
        this.showToast('密码已复制！出于安全考量，系统将在 15 秒后自动清空剪贴板', 'success');

        if (this.clipboardTimer) clearTimeout(this.clipboardTimer);
        this.clipboardTimer = setTimeout(() => {
          navigator.clipboard.writeText('');
          this.showToast('剪贴板已自动清空', 'warning');
        }, 15000);
      });
    }

    if (item.totpSecret) {
      this.startTotpLoop(item.totpSecret);
      document.getElementById('copy-totp').addEventListener('click', async () => {
        const res = await TOTP.generateCode(item.totpSecret);
        if (res) {
          navigator.clipboard.writeText(res.code);
          this.showToast('2FA 验证码已复制: ' + res.code, 'success');
        }
      });
    }
  }

  startTotpLoop(secret) {
    if (this.totpTimer) clearInterval(this.totpTimer);
    const update = async () => {
      const res = await TOTP.generateCode(secret);
      const codeEl = document.getElementById('totp-code-display');
      const timerEl = document.getElementById('totp-timer-display');
      if (res && codeEl && timerEl) {
        codeEl.textContent = res.code.substr(0, 3) + ' ' + res.code.substr(3, 3);
        timerEl.textContent = `${res.remainingSeconds}s`;
      }
    };
    update();
    this.totpTimer = setInterval(update, 1000);
  }

  clearDetailPane() {
    if (this.totpTimer) clearInterval(this.totpTimer);
    const pane = document.getElementById('vault-detail-pane');
    pane.classList.remove('mobile-active');
    pane.innerHTML = `
      <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--text-dim);">
        <img src="icon.jpg" style="width: 64px; height: 64px; border-radius: 18px; margin-bottom: 16px; object-fit: cover;" />
        <h3 style="font-size: 18px; color: var(--text-main); margin-bottom: 8px;">CipherVault 密室保护中</h3>
        <p style="font-size: 14px;">在左侧选择一个凭据条目以查看详细加密数据</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
  }

  openItemModal(item = null) {
    const modal = document.getElementById('item-modal');
    const title = document.getElementById('modal-item-title');
    
    document.getElementById('modal-item-id').value = item ? item.id : '';
    document.getElementById('modal-item-title-input').value = item ? item.title : '';
    document.getElementById('modal-item-category').value = item ? item.category : 'login';
    document.getElementById('modal-item-username').value = item ? item.username : '';
    document.getElementById('modal-item-password').value = item ? item.password : '';
    document.getElementById('modal-item-url').value = item ? item.url : '';
    document.getElementById('modal-item-totp').value = item ? item.totpSecret : '';
    document.getElementById('modal-item-notes').value = item ? item.notes : '';

    title.textContent = item ? '编辑账号凭据' : '新建账号凭据';
    modal.classList.add('open');
  }

  closeModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
  }

  bindEvents() {
    document.getElementById('lock-form').addEventListener('submit', (e) => this.handleMasterAuth(e));

    document.getElementById('btn-lock-vault').addEventListener('click', () => {
      this.store.lockVault();
      this.checkVaultStatus();
      this.showToast('保险库已手动锁定', 'warning');
    });

    document.getElementById('btn-add-item').addEventListener('click', () => {
      this.openItemModal();
    });

    document.querySelectorAll('.btn-close-modal').forEach(btn => {
      btn.addEventListener('click', () => this.closeModals());
    });

    document.getElementById('item-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('modal-item-id').value;
      const title = document.getElementById('modal-item-title-input').value;
      const category = document.getElementById('modal-item-category').value;
      const username = document.getElementById('modal-item-username').value;
      const password = document.getElementById('modal-item-password').value;
      const url = document.getElementById('modal-item-url').value;
      const totpSecret = document.getElementById('modal-item-totp').value;
      const notes = document.getElementById('modal-item-notes').value;

      const itemData = {
        id: id || null,
        category,
        title,
        username,
        password,
        url,
        totpSecret,
        notes,
        favorite: false,
        trash: false
      };

      const saved = await this.store.saveItem(itemData);
      this.closeModals();
      this.showToast('已安全加密保存凭据！', 'success');
      this.selectedItemId = saved.id;
      this.renderSidebar();
      this.renderVaultList();
      this.renderDetailPane(saved);

      // Auto Push to cloud
      await this.autoSyncPush();
    });

    document.querySelectorAll('.nav-item').forEach(nav => {
      nav.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        nav.classList.add('active');
        this.currentCategory = nav.dataset.category;
        this.renderVaultList();
      });
    });

    document.getElementById('search-input').addEventListener('input', (e) => {
      this.searchQuery = e.target.value;
      this.renderVaultList();
    });

    document.getElementById('btn-open-generator').addEventListener('click', () => {
      document.getElementById('generator-modal').classList.add('open');
      this.updateGeneratorOutput();
    });

    const genLengthSlider = document.getElementById('gen-length');
    genLengthSlider.addEventListener('input', (e) => {
      document.getElementById('gen-length-val').textContent = e.target.value;
      this.updateGeneratorOutput();
    });

    ['gen-upper', 'gen-lower', 'gen-num', 'gen-symbol'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => this.updateGeneratorOutput());
    });

    document.getElementById('btn-regen-pwd').addEventListener('click', () => this.updateGeneratorOutput());

    document.getElementById('btn-apply-gen-pwd').addEventListener('click', () => {
      const pwd = document.getElementById('gen-result-input').value;
      document.getElementById('modal-item-password').value = pwd;
      this.closeModals();
    });

    document.getElementById('btn-open-import').addEventListener('click', () => {
      document.getElementById('import-modal').classList.add('open');
    });

    document.getElementById('btn-execute-import').addEventListener('click', async () => {
      const fileInput = document.getElementById('import-file-input');
      if (!fileInput.files || fileInput.files.length === 0) {
        this.showToast('请先选择要导入的 CSV / JSON 文件', 'warning');
        return;
      }

      const file = fileInput.files[0];
      const text = await file.text();
      let importedItems = [];

      if (file.name.endsWith('.csv')) {
        importedItems = DataImporter.parseCSV(text);
      } else if (file.name.endsWith('.json')) {
        importedItems = DataImporter.parseJSON(text);
      }

      if (importedItems.length === 0) {
        this.showToast('未能解析到任何凭据，请确认文件格式是否正确', 'danger');
        return;
      }

      for (const item of importedItems) {
        await this.store.saveItem(item);
      }

      this.showToast(`成功导入 ${importedItems.length} 条账号凭据！`, 'success');
      this.closeModals();
      this.renderSidebar();
      this.renderVaultList();

      await this.autoSyncPush();
    });

    document.getElementById('btn-export-backup').addEventListener('click', async () => {
      const encStr = await this.store.persistVault();
      const blob = new Blob([encStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `CipherVault_Backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.showToast('高强度加密备份已导出文件下载', 'success');
    });

    // WebDAV / Gist Sync Settings Modal
    document.getElementById('btn-open-sync').addEventListener('click', () => {
      document.getElementById('sync-modal').classList.add('open');
      const cfg = this.store.syncConfig;
      document.getElementById('sync-mode-select').value = cfg.mode || 'local';
      document.getElementById('webdav-url').value = (cfg.webdav && cfg.webdav.url) || '';
      document.getElementById('webdav-user').value = (cfg.webdav && cfg.webdav.username) || '';
      document.getElementById('webdav-pwd').value = (cfg.webdav && cfg.webdav.password) || '';
      document.getElementById('gist-token').value = (cfg.gist && cfg.gist.token) || '';
      document.getElementById('gist-id').value = (cfg.gist && cfg.gist.gistId) || '';
    });

    // Manual Sync Now button inside Sync Modal
    document.getElementById('btn-manual-sync-now').addEventListener('click', async () => {
      this.showToast('正在即时双向同步云端数据...', 'success');
      await this.autoSyncPull();
      await this.autoSyncPush();
    });

    document.getElementById('btn-save-sync-config').addEventListener('click', async () => {
      const mode = document.getElementById('sync-mode-select').value;
      this.store.syncConfig = {
        mode,
        webdav: {
          url: document.getElementById('webdav-url').value,
          username: document.getElementById('webdav-user').value,
          password: document.getElementById('webdav-pwd').value
        },
        gist: {
          token: document.getElementById('gist-token').value,
          gistId: document.getElementById('gist-id').value
        }
      };
      this.store.saveMetadata();
      this.showToast('同步配置保存成功！', 'success');

      await this.autoSyncPull();
      await this.autoSyncPush();
      this.closeModals();
    });
  }

  updateGeneratorOutput() {
    const length = parseInt(document.getElementById('gen-length').value, 10);
    const uppercase = document.getElementById('gen-upper').checked;
    const lowercase = document.getElementById('gen-lower').checked;
    const numbers = document.getElementById('gen-num').checked;
    const symbols = document.getElementById('gen-symbol').checked;

    const pwd = PasswordGenerator.generate({ length, uppercase, lowercase, numbers, symbols });
    document.getElementById('gen-result-input').value = pwd;

    const evalRes = PasswordGenerator.evaluateStrength(pwd);
    const badge = document.getElementById('gen-strength-badge');
    badge.textContent = `强度: ${evalRes.label} (${evalRes.score}分)`;
    badge.style.backgroundColor = evalRes.color;
    badge.style.color = '#ffffff';
  }

  getCategoryIcon(cat) {
    switch (cat) {
      case 'login': return 'globe';
      case 'card': return 'credit-card';
      case 'note': return 'file-text';
      default: return 'key';
    }
  }

  getCategoryLabel(cat) {
    switch (cat) {
      case 'login': return 'Web / App 账号';
      case 'card': return '支付卡片';
      case 'note': return '安全备忘录';
      default: return '账号凭据';
    }
  }

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&#039;");
  }

  showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.style.borderLeft = `4px solid ${type === 'success' ? '#10b981' : type === 'warning' ? '#f59e0b' : '#ef4444'}`;
    toast.innerHTML = `<span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'toastOut 0.3s forwards';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }
}

// Instantiate on DOM loaded
window.addEventListener('DOMContentLoaded', () => {
  const app = new AppController();
  app.init();
});
