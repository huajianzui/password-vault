/**
 * CipherVault Background Service Worker (Manifest V3)
 */

let unlockedVaultItems = [];
let dismissedCaptures = new Set();

chrome.runtime.onInstalled.addListener(() => {
  // Create Context Menus
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
    console.warn('Context menu creation error:', e);
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.id) return;
  if (info.menuItemId === 'ciphervault_autofill') {
    chrome.action.openPopup();
  }
});

// Match domain helper
function matchDomain(url, item) {
  if (!url || !item) return false;
  try {
    const cleanHost = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    const itemUrl = (item.url || '').toLowerCase();
    const itemTitle = (item.title || '').toLowerCase();

    const mainDomain = cleanHost.split('.').slice(-2).join('.');
    return (
      itemUrl.includes(mainDomain) ||
      itemUrl.includes(cleanHost) ||
      itemTitle.includes(mainDomain) ||
      cleanHost.includes(itemTitle)
    );
  } catch (e) {
    return false;
  }
}

// Cross-script messaging hub
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 1. Popup syncs unlocked items into background memory
  if (request.action === 'syncUnlockedSession') {
    unlockedVaultItems = request.items || [];
    sendResponse({ success: true });
    return true;
  }

  // 2. Content script asks for autofill data on page load
  if (request.action === 'getAutofillData') {
    const url = request.url;
    const matched = unlockedVaultItems.find(item => !item.trash && matchDomain(url, item));
    if (matched) {
      sendResponse({ shouldAutofill: true, data: { username: matched.username, password: matched.password } });
    } else {
      sendResponse({ shouldAutofill: false });
    }
    return true;
  }

  // 3. Content script checks if capture prompt should be displayed (Deduplication)
  if (request.action === 'checkShouldCapture') {
    const { username, password, url } = request.data;
    const sessionKey = `${url}:${username}`;

    if (dismissedCaptures.has(sessionKey)) {
      sendResponse({ shouldPrompt: false, reason: 'dismissed' });
      return true;
    }

    // Check if already in vault
    const alreadySaved = unlockedVaultItems.some(item => {
      if (item.trash) return false;
      const isSameHost = matchDomain(url, item);
      const isSameUser = (item.username || '').toLowerCase() === (username || '').toLowerCase();
      const isSamePwd = item.password === password;
      return isSameHost && isSameUser && isSamePwd;
    });

    if (alreadySaved) {
      sendResponse({ shouldPrompt: false, reason: 'already_saved' });
      return true;
    }

    sendResponse({ shouldPrompt: true });
    return true;
  }

  // 4. Save captured credential & remember dismissal for session
  if (request.action === 'captureCredential') {
    const { username, password, url } = request.data;
    const sessionKey = `${url}:${username}`;
    dismissedCaptures.add(sessionKey);

    // Save pending capture to storage
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

    // Also cache in current background list
    unlockedVaultItems.push(request.data);
    sendResponse({ success: true });
    return true;
  }

  // 5. User dismissed banner
  if (request.action === 'dismissCapture') {
    const { username, url } = request.data;
    dismissedCaptures.add(`${url}:${username}`);
    sendResponse({ success: true });
    return true;
  }
});
