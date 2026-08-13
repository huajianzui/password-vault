/**
 * CipherVault WebDAV & GitHub Gist Sync Client
 */
export class SyncClient {
  /**
   * WebDAV Sync Push
   */
  static async pushWebDAV(config, encryptedString) {
    const { url, username, password } = config;
    if (!url || !username || !password) {
      throw new Error('WebDAV 配置不完整，请输入完整服务器 URL、用户名与密码/授权码');
    }

    const authHeader = 'Basic ' + window.btoa(unescape(encodeURIComponent(username + ':' + password)));
    const targetUrl = url.endsWith('/') ? url + 'ciphervault.json' : url + '/ciphervault.json';

    const response = await fetch(targetUrl, {
      method: 'PUT',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: encryptedString
    });

    if (!response.ok && response.status !== 201 && response.status !== 204) {
      throw new Error(`WebDAV 同步失败 (HTTP ${response.status})`);
    }

    return true;
  }

  /**
   * WebDAV Sync Pull
   */
  static async pullWebDAV(config) {
    const { url, username, password } = config;
    if (!url || !username || !password) {
      throw new Error('WebDAV 配置不完整');
    }

    const authHeader = 'Basic ' + window.btoa(unescape(encodeURIComponent(username + ':' + password)));
    const targetUrl = url.endsWith('/') ? url + 'ciphervault.json' : url + '/ciphervault.json';

    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'Authorization': authHeader
      }
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`WebDAV 拉取失败 (HTTP ${response.status})`);
    }

    return await response.text();
  }

  /**
   * Automatically search for existing ciphervault.json Gist under user's GitHub account
   */
  static async findExistingGist(token) {
    if (!token) return null;
    try {
      const response = await fetch('https://api.github.com/gists?per_page=100', {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      if (!response.ok) return null;
      const gists = await response.json();
      const found = gists.find(g => g.files && (g.files['ciphervault.json'] || g.description.includes('CipherVault')));
      return found ? found.id : null;
    } catch (e) {
      console.warn('Find Gist failed:', e);
      return null;
    }
  }

  /**
   * GitHub Gist Sync Push
   */
  static async pushGist(config, encryptedString) {
    let { token, gistId } = config;
    if (!token) throw new Error('请输入 GitHub Personal Access Token');

    // Auto-discover Gist ID if missing
    if (!gistId) {
      const existingId = await this.findExistingGist(token);
      if (existingId) gistId = existingId;
    }

    const payload = {
      description: 'CipherVault Encrypted Backup Data',
      public: false,
      files: {
        'ciphervault.json': { content: encryptedString }
      }
    };

    let response;
    if (gistId) {
      response = await fetch(`https://api.github.com/gists/${gistId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
    } else {
      response = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
    }

    if (!response.ok) {
      throw new Error(`GitHub Gist 同步失败 (HTTP ${response.status})`);
    }

    const data = await response.json();
    return data.id;
  }

  /**
   * GitHub Gist Sync Pull
   */
  static async pullGist(config) {
    let { token, gistId } = config;
    if (!token) throw new Error('GitHub Token 未配置');

    // Auto-discover Gist ID if missing
    if (!gistId) {
      gistId = await this.findExistingGist(token);
    }

    if (!gistId) return null;

    const response = await fetch(`https://api.github.com/gists/${gistId}`, {
      method: 'GET',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub Gist 拉取失败 (HTTP ${response.status})`);
    }

    const data = await response.json();
    if (data.files && data.files['ciphervault.json']) {
      return {
        gistId: data.id,
        content: data.files['ciphervault.json'].content
      };
    }
    return null;
  }
}
