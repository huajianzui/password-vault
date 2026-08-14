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
    // Fallback to local session storage cache
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

  // 2. Content script asks for matching accounts for current website
  if (request.action === 'getAutofillData') {
    getUnlockedItems().then(items => {
      const url = request.url;
      const matchedList = items.filter(item => !item.trash && matchDomain(url, item));

      if (matchedList.length > 0) {
        sendResponse({
          hasMatch: true,
          count: matchedList.length,
          shouldAutoFillSingle: matchedList.length === 1,
          matchedAccounts: matchedList.map(item => ({
            id: item.id,
            title: item.title,
            role: item.role || item.title || '默认角色',
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

  // 4. Save captured credential into pending queue
  if (request.action === 'captureCredential') {
    const { username, password, url } = request.data;

    chrome.storage.local.get(['ciphervault_pending_captures'], (result) => {
      const pending = result.ciphervault_pending_captures || [];
      const isDuplicate = pending.some(
        p => p.url === url && p.username === username && p.password === password
      );
      if (!isDuplicate) {
        pending.push(request.data);
        chrome.storage.local.set({ ciphervault_pending_captures: pending });
      }
    });

    getUnlockedItems().then(items => {
      items.push(request.data);
      setUnlockedItems(items);
      sendResponse({ success: true });
    });
    return true;
  }
});
