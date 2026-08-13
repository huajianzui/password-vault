/**
 * CipherVault Data Importer - Chrome CSV & Bitwarden JSON Parser
 */
export class DataImporter {
  /**
   * Parse CSV string into standard items
   */
  static parseCSV(csvText) {
    const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length === 0) return [];

    const headers = this.parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
    
    // Find index for standard columns
    const nameIdx = headers.findIndex(h => h.includes('name') || h.includes('title') || h.includes('名称'));
    const urlIdx = headers.findIndex(h => h.includes('url') || h.includes('website') || h.includes('网址'));
    const usernameIdx = headers.findIndex(h => h.includes('username') || h.includes('login') || h.includes('用户名') || h.includes('账号'));
    const passwordIdx = headers.findIndex(h => h.includes('password') || h.includes('密码'));
    const noteIdx = headers.findIndex(h => h.includes('note') || h.includes('comment') || h.includes('备注'));

    const items = [];

    for (let i = 1; i < lines.length; i++) {
      const row = this.parseCSVLine(lines[i]);
      if (row.length === 0) continue;

      const title = (nameIdx !== -1 ? row[nameIdx] : '') || (urlIdx !== -1 ? row[urlIdx] : '未命名凭据');
      const url = urlIdx !== -1 ? row[urlIdx] : '';
      const username = usernameIdx !== -1 ? row[usernameIdx] : '';
      const password = passwordIdx !== -1 ? row[passwordIdx] : '';
      const notes = noteIdx !== -1 ? row[noteIdx] : '';

      if (!username && !password && !url) continue;

      items.push({
        id: 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        category: 'login',
        title: title.trim(),
        username: username.trim(),
        password: password.trim(),
        url: url.trim(),
        notes: notes.trim(),
        totpSecret: '',
        tags: ['导入密码'],
        favorite: false,
        trash: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    return items;
  }

  static parseCSVLine(text) {
    const result = [];
    let cur = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (inQuotes && text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === ',' && !inQuotes) {
        result.push(cur);
        cur = '';
      } else {
        cur += c;
      }
    }
    result.push(cur);
    return result;
  }

  /**
   * Parse Bitwarden / Generic JSON file content
   */
  static parseJSON(jsonText) {
    try {
      const data = JSON.parse(jsonText);
      const items = [];

      // Bitwarden export structure
      if (data.items && Array.isArray(data.items)) {
        data.items.forEach(bwItem => {
          const login = bwItem.login || {};
          const title = bwItem.name || '未命名凭据';
          const username = login.username || '';
          const password = login.password || '';
          const url = (login.uris && login.uris.length > 0) ? login.uris[0].uri : '';
          const totp = login.totp || '';
          const notes = bwItem.notes || '';

          items.push({
            id: 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            category: 'login',
            title: title.trim(),
            username: username.trim(),
            password: password.trim(),
            url: url.trim(),
            notes: notes.trim(),
            totpSecret: totp.trim(),
            tags: ['Bitwarden导入'],
            favorite: bwItem.favorite || false,
            trash: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
        });
        return items;
      }

      // CipherVault native backup structure
      if (Array.isArray(data)) {
        return data;
      }

      return [];
    } catch (e) {
      console.error('JSON parse failed:', e);
      return [];
    }
  }
}
