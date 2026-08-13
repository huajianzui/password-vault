/**
 * CipherVault WebDAV & GitHub Gist Sync Client
 */
export class SyncClient {
  /**
   * WebDAV Sync Push (Encrypt payload -> upload file to WebDAV URL)
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
   * WebDAV Sync Pull (Download encrypted JSON string from WebDAV)
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
      return null; // File doesn't exist yet on WebDAV
    }

    if (!response.ok) {
      throw new Error(`WebDAV 拉取失败 (HTTP ${response.status})`);
    }

    return await response.text();
  }

  /**
   * GitHub Gist Sync Push
   */
  static async pushGist(config, encryptedString) {
    const { token, gistId } = config;
    if (!token) throw new Error('请输入 GitHub Personal Access Token');

    const payload = {
      description: 'CipherVault Encrypted Backup Data',
      public: false,
      files: {
        'ciphervault.json': { content: encryptedString }
      }
    };

    let response;
    if (gistId) {
      // Update existing Gist
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
      // Create new Gist
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
    return data.id; // Return new or existing Gist ID
  }

  /**
   * GitHub Gist Sync Pull
   */
  static async pullGist(config) {
    const { token, gistId } = config;
    if (!token || !gistId) throw new Error('GitHub Token 或 Gist ID 未配置');

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
      return data.files['ciphervault.json'].content;
    }
    return null;
  }
}
