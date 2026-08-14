/**
 * CipherVault Background Service Worker (Manifest V3)
 */

chrome.runtime.onInstalled.addListener(() => {
  // Create Context Menus
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
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.id) return;

  if (info.menuItemId === 'ciphervault_autofill') {
    chrome.action.openPopup();
  }
});

// Message listener for in-page capture
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'captureCredential') {
    // Save pending capture to chrome.storage
    chrome.storage.local.get(['ciphervault_pending_captures'], (result) => {
      const pending = result.ciphervault_pending_captures || [];
      pending.push(request.data);
      chrome.storage.local.set({ ciphervault_pending_captures: pending });
    });
  }
});
