/**
 * CipherVault Background Service Worker (Manifest V3)
 */

chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.contextMenus.create({
      id: 'ciphervault_root',
      title: 'CipherVault 密码管家',
      contexts: ['all']
    });

    chrome.contextMenus.create({
      id: 'ciphervault_autofill',
      parentId: 'ciphervault_root',
      title: '自动填充当前网站密码',
      contexts: ['editable']
    });

    chrome.contextMenus.create({
      id: 'ciphervault_gen_pwd',
      parentId: 'ciphervault_root',
      title: '生成强密码',
      contexts: ['editable']
    });
  } catch (e) {
    console.warn('Context menu error:', e);
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.id) return;
  if (info.menuItemId === 'ciphervault_autofill') {
    chrome.action.openPopup();
  }
});

// Domain normalization & matching
function normalizeHost(urlOrHost) {
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

function matchDomain(currentUrl, item) {
  if (!currentUrl || !item) return false;
  const currentHost = normalizeHost(currentUrl);
  const itemHost = normalizeHost(item.url || '');
  const itemTitle = (item.title || '').trim().toLowerCase();

  if (!currentHost) return false;

  // 1. Exact host match (handles IP, localhost, domains)
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
}

// Retrieve unlocked items from session storage
async function getUnlockedItems() {
  try {
    if (chrome.storage && chrome.storage.session) {
      const res = await chrome.storage.session.get('ciphervault_session_items');
      if (res && Array.isArray(res.ciphervault_session_items)) {
        return res.ciphervault_session_items;
      }
    }
    const localRes = await chrome.storage.local.get('ciphervault_session_cache');
    return (localRes && Array.isArray(localRes.ciphervault_session_cache)) ? localRes.ciphervault_session_cache : [];
  } catch (e) {
    return [];
  }
}

async function setUnlockedItems(items) {
  try {
    if (chrome.storage && chrome.storage.session) {
      await chrome.storage.session.set({ ciphervault_session_items: items });
    }
    await chrome.storage.local.set({ ciphervault_session_cache: items });
  } catch (e) {}
}

// Cross-script messaging hub
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 1. Popup syncs unlocked items into background session storage
  if (request.action === 'syncUnlockedSession') {
    setUnlockedItems(request.items || []).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  // 2. Content script asks for matching accounts for current website (With Strict Deduplication)
  if (request.action === 'getAutofillData') {
    getUnlockedItems().then(items => {
      const url = request.url;
      const matchedList = items.filter(item => !item.trash && matchDomain(url, item));

      // Strict Deduplication: group by (username, role) and keep the latest updated entry
      const uniqueMap = new Map();
      matchedList.forEach(item => {
        const u = (item.username || '').trim().toLowerCase();
        const r = (item.role || '').trim().toLowerCase();
        const key = `${u}:::${r}`;

        if (!uniqueMap.has(key)) {
          uniqueMap.set(key, item);
        } else {
          const existing = uniqueMap.get(key);
          const existingTime = new Date(existing.updatedAt || 0).getTime();
          const itemTime = new Date(item.updatedAt || 0).getTime();
          if (itemTime >= existingTime) {
            uniqueMap.set(key, item);
          }
        }
      });

      const uniqueMatched = Array.from(uniqueMap.values());

      if (uniqueMatched.length > 0) {
        sendResponse({
          hasMatch: true,
          count: uniqueMatched.length,
          shouldAutoFillSingle: uniqueMatched.length === 1,
          matchedAccounts: uniqueMatched.map(item => ({
            id: item.id,
            title: item.title,
            role: (item.role && item.role.trim() !== item.title.trim()) ? item.role.trim() : '',
            username: item.username,
            password: item.password,
            totpSecret: item.totpSecret
          }))
        });
      } else {
        sendResponse({ hasMatch: false, count: 0, matchedAccounts: [] });
      }
    });
    return true;
  }

  // 3. Content script checks if capture prompt should be displayed
  if (request.action === 'checkShouldCapture') {
    getUnlockedItems().then(items => {
      const { username, password, url } = request.data;

      // Check if EXACT match already exists in vault (same host + same user + same password)
      const exactMatch = items.some(item => {
        if (item.trash) return false;
        const isSameHost = matchDomain(url, item);
        const isSameUser = (item.username || '').trim().toLowerCase() === (username || '').trim().toLowerCase();
        const isSamePwd = item.password === password;
        return isSameHost && isSameUser && isSamePwd;
      });

      if (exactMatch) {
        sendResponse({ shouldPrompt: false, reason: 'already_saved' });
      } else {
        sendResponse({ shouldPrompt: true });
      }
    });
    return true;
  }

  // 4. Save captured credential into pending queue with Smart Deduplication
  if (request.action === 'captureCredential') {
    const { username, password, url, title, role } = request.data;
    const reqUser = (username || '').trim().toLowerCase();

    chrome.storage.local.get(['ciphervault_pending_captures'], (result) => {
      const pending = result.ciphervault_pending_captures || [];
      const existingPendingIdx = pending.findIndex(
        p => matchDomain(url, p) && (p.username || '').trim().toLowerCase() === reqUser
      );

      if (existingPendingIdx >= 0) {
        pending[existingPendingIdx] = { ...pending[existingPendingIdx], ...request.data, updatedAt: new Date().toISOString() };
      } else {
        pending.push({ ...request.data, id: 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      }
      chrome.storage.local.set({ ciphervault_pending_captures: pending });
    });

    getUnlockedItems().then(items => {
      const existingIdx = items.findIndex(
        i => !i.trash && matchDomain(url, i) && (i.username || '').trim().toLowerCase() === reqUser
      );

      if (existingIdx >= 0) {
        items[existingIdx].password = password;
        if (title) items[existingIdx].title = title;
        if (role) items[existingIdx].role = role;
        items[existingIdx].updatedAt = new Date().toISOString();
      } else {
        items.unshift({ ...request.data, id: 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      }

      setUnlockedItems(items);
      sendResponse({ success: true });
    });
    return true;
  }
});
