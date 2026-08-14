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
      throw new Error('WebDAV 配置不完整，请输入服务器 URL、用户名与密码/应用独立密码');
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
      if (response.status === 401) throw new Error('WebDAV 认证失败：用户名或应用密码错误');
      if (response.status === 403) throw new Error('WebDAV 权限不足，无法写入文件');
      if (response.status === 404) throw new Error('WebDAV 路径不存在，请检查服务器 URL');
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
        'Authorization': authHeader,
        'Cache-Control': 'no-cache'
      }
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      if (response.status === 401) throw new Error('WebDAV 认证失败：用户名或应用密码错误');
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
      const response = await fetch(`https://api.github.com/gists?per_page=100&_t=${Date.now()}`, {
        headers: {
          'Authorization': `token ${token.trim()}`,
          'Accept': 'application/vnd.github.v3+json'
        },
        cache: 'no-cache'
      });
      if (!response.ok) return null;
      const gists = await response.json();
      const found = gists.find(g => g.files && (g.files['ciphervault.json'] || (g.description && g.description.includes('CipherVault'))));
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
    token = token.trim();
    if (gistId) gistId = gistId.trim();

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
      if (response.status === 401) throw new Error('GitHub Token 无效或已过期，请重新检查 Token');
      if (response.status === 404) throw new Error('未找到该 Gist ID，或该 Token 无权访问此私有 Gist (请确保 Token 勾选了 gist 权限)');
      if (response.status === 403) throw new Error('GitHub API 权限不足或频率超限 (请确认 Token 拥有 gist 读写权限)');
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
    token = token.trim();
    if (gistId) gistId = gistId.trim();

    // Auto-discover Gist ID if missing
    if (!gistId) {
      gistId = await this.findExistingGist(token);
    }

    if (!gistId) return null;

    const response = await fetch(`https://api.github.com/gists/${gistId}?_t=${Date.now()}`, {
      method: 'GET',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      },
      cache: 'no-cache'
    });

    if (!response.ok) {
      if (response.status === 401) throw new Error('GitHub Token 无效或已过期');
      if (response.status === 404) throw new Error('未找到该 Gist ID 或 Token 无权访问');
      if (response.status === 403) throw new Error('GitHub API 访问受限');
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
