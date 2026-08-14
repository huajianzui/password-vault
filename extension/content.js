/**
 * CipherVault Content Script - Multi-Account In-Page Selector & Autofill
 */

(function () {
  let hasPromptedThisSession = false;
  let lastFilledData = null;
  let cachedMatchedAccounts = [];

  // Safe DOM input & change event dispatcher
  function setNativeValue(element, value) {
    if (!element || value === undefined || value === null) return;

    try {
      const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')
        ? Object.getOwnPropertyDescriptor(element, 'value').set
        : null;
      const prototype = Object.getPrototypeOf(element);
      const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')
        ? Object.getOwnPropertyDescriptor(prototype, 'value').set
        : null;

      if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
        prototypeValueSetter.call(element, value);
      } else if (valueSetter) {
        valueSetter.call(element, value);
      } else {
        element.value = value;
      }

      element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      element.dispatchEvent(new Event('blur', { bubbles: true }));
    } catch (e) {
      element.value = value;
    }
  }

  // Check if an element is visible
  function isElementVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && el.offsetWidth > 0;
  }

  // Locate username & password inputs
  function findFields() {
    const passwordInputs = Array.from(
      document.querySelectorAll('input[type="password"], input[name*="password" i], input[id*="password" i], input[autocomplete="current-password"], input[autocomplete="new-password"]')
    ).filter(isElementVisible);

    const passwordInput = passwordInputs.length > 0 ? passwordInputs[0] : null;

    let usernameInput = null;
    if (passwordInput) {
      const form = passwordInput.closest('form') || document.body;
      const candidates = Array.from(
        form.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input:not([type])')
      ).filter(isElementVisible);

      if (candidates.length > 0) {
        const explicitUsername = candidates.find(c => {
          const name = (c.name || '').toLowerCase();
          const id = (c.id || '').toLowerCase();
          const ac = (c.autocomplete || '').toLowerCase();
          return name.includes('user') || name.includes('login') || name.includes('email') || name.includes('account') ||
                 id.includes('user') || id.includes('login') || id.includes('email') || id.includes('account') ||
                 ac === 'username' || ac === 'email';
        });

        usernameInput = explicitUsername || candidates[candidates.length - 1];
      }
    } else {
      const candidates = Array.from(
        document.querySelectorAll('input[autocomplete="username"], input[name*="user" i], input[name*="login" i], input[type="email"]')
      ).filter(isElementVisible);
      if (candidates.length > 0) usernameInput = candidates[0];
    }

    return { usernameInput, passwordInput };
  }

  // Perform Autofill with a specific account
  function performAutofill(account) {
    if (!account) return false;
    const { username, password } = account;
    const { usernameInput, passwordInput } = findFields();

    let filledCount = 0;
    if (username && usernameInput) {
      setNativeValue(usernameInput, username);
      filledCount++;
    }
    if (password && passwordInput) {
      setNativeValue(passwordInput, password);
      filledCount++;
    }

    if (filledCount > 0) {
      lastFilledData = { username, password };
    }
    return filledCount > 0;
  }

  // Remove in-page dropdown
  function hideInlineDropdown() {
    const existing = document.getElementById('ciphervault-inline-dropdown');
    if (existing) existing.remove();
  }

  // Show in-page multi-account selector dropdown
  function showInlineDropdown(targetInput, accounts) {
    if (!targetInput || !accounts || accounts.length === 0) return;
    hideInlineDropdown();

    const rect = targetInput.getBoundingClientRect();
    const dropdown = document.createElement('div');
    dropdown.id = 'ciphervault-inline-dropdown';

    const top = window.scrollY + rect.bottom + 6;
    const left = window.scrollX + rect.left;

    dropdown.style.top = `${top}px`;
    dropdown.style.left = `${left}px`;

    dropdown.innerHTML = `
      <div class="cv-drop-header">
        <span>🛡️ 选择回填账号 / 角色 (${accounts.length})</span>
      </div>
      <div class="cv-drop-list">
        ${accounts.map((acc, index) => `
          <div class="cv-drop-item" data-index="${index}">
            <div class="cv-item-info">
              <div class="cv-item-title-row">
                <span class="cv-item-name">${escapeHtml(acc.title || '未命名')}</span>
                <span class="cv-item-role-tag">${escapeHtml(acc.role || acc.title || '角色')}</span>
              </div>
              <span class="cv-item-user">${escapeHtml(acc.username || '无账号名')}</span>
            </div>
            <button class="cv-item-action">填入</button>
          </div>
        `).join('')}
      </div>
    `;

    document.body.appendChild(dropdown);

    // Bind click events on account rows
    dropdown.querySelectorAll('.cv-drop-item').forEach(itemEl => {
      itemEl.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const index = parseInt(itemEl.dataset.index, 10);
        const selectedAccount = accounts[index];
        if (selectedAccount) {
          performAutofill(selectedAccount);
        }
        hideInlineDropdown();
      });
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Query background for matching accounts
  function checkAndSetupAutofill() {
    try {
      chrome.runtime.sendMessage(
        { action: 'getAutofillData', url: window.location.href },
        (response) => {
          if (chrome.runtime.lastError || !response) return;

          if (response.hasMatch && response.matchedAccounts) {
            cachedMatchedAccounts = response.matchedAccounts;

            // If exactly 1 account, auto-fill it directly on load
            if (response.shouldAutoFillSingle && cachedMatchedAccounts.length === 1) {
              performAutofill(cachedMatchedAccounts[0]);
            }
          }
        }
      );
    } catch (e) {
      // Extension context invalidated
    }
  }

  // Attach focus listeners to inputs to display multi-account dropdown
  function bindInputFocusEvents() {
    const inputs = document.querySelectorAll('input');
    inputs.forEach(input => {
      if (input.__cv_bound) return;
      input.__cv_bound = true;

      input.addEventListener('focus', () => {
        const type = (input.type || '').toLowerCase();
        if (['text', 'email', 'password', 'tel'].includes(type) || !input.type) {
          if (cachedMatchedAccounts.length > 0) {
            showInlineDropdown(input, cachedMatchedAccounts);
          } else {
            // Re-fetch in case unlocked later
            chrome.runtime.sendMessage(
              { action: 'getAutofillData', url: window.location.href },
              (response) => {
                if (response && response.hasMatch && response.matchedAccounts) {
                  cachedMatchedAccounts = response.matchedAccounts;
                  showInlineDropdown(input, cachedMatchedAccounts);
                }
              }
            );
          }
        }
      });
    });
  }

  // Dismiss dropdown on outside click
  document.addEventListener('mousedown', (e) => {
    const dropdown = document.getElementById('ciphervault-inline-dropdown');
    if (dropdown && !dropdown.contains(e.target)) {
      hideInlineDropdown();
    }
  });

  // Display floating capture banner (Strictly once per session)
  function showCaptureBanner(username, password) {
    if (hasPromptedThisSession) return;
    hasPromptedThisSession = true;

    const existing = document.getElementById('ciphervault-capture-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'ciphervault-capture-banner';

    const hostname = window.location.hostname.replace(/^www\./, '');

    banner.innerHTML = `
      <div class="cv-banner-icon">🛡️</div>
      <div class="cv-banner-content">
        <div class="cv-banner-title">CipherVault 提示保存新账号</div>
        <div class="cv-banner-sub">${username || '当前账号'} (${hostname})</div>
      </div>
      <div class="cv-banner-actions">
        <button class="cv-btn cv-btn-save" id="cv-btn-save">保存</button>
        <button class="cv-btn cv-btn-ignore" id="cv-btn-ignore">忽略</button>
      </div>
    `;

    document.body.appendChild(banner);

    document.getElementById('cv-btn-save').addEventListener('click', () => {
      chrome.runtime.sendMessage({
        action: 'captureCredential',
        data: {
          title: document.title || hostname,
          url: window.location.origin,
          username: username,
          password: password,
          category: 'login'
        }
      });
      banner.style.animation = 'cvSlideOut 0.2s forwards';
      setTimeout(() => banner.remove(), 200);
    });

    document.getElementById('cv-btn-ignore').addEventListener('click', () => {
      chrome.runtime.sendMessage({
        action: 'dismissCapture',
        data: { username, url: window.location.href }
      });
      banner.style.animation = 'cvSlideOut 0.2s forwards';
      setTimeout(() => banner.remove(), 200);
    });

    setTimeout(() => {
      if (document.body.contains(banner)) {
        banner.style.animation = 'cvSlideOut 0.2s forwards';
        setTimeout(() => banner.remove(), 200);
      }
    }, 8000);
  }

  // Handle Form Capture safely
  let submitDebounceTimer = null;
  function handleFormSubmitCapture() {
    if (hasPromptedThisSession) return;

    if (submitDebounceTimer) clearTimeout(submitDebounceTimer);
    submitDebounceTimer = setTimeout(() => {
      try {
        const { usernameInput, passwordInput } = findFields();
        const password = passwordInput ? passwordInput.value : '';
        const username = usernameInput ? usernameInput.value : '';

        if (!password) return;

        if (lastFilledData && lastFilledData.password === password && lastFilledData.username === username) {
          return;
        }

        chrome.runtime.sendMessage(
          {
            action: 'checkShouldCapture',
            data: { username, password, url: window.location.href }
          },
          (response) => {
            if (chrome.runtime.lastError) return;
            if (response && response.shouldPrompt) {
              showCaptureBanner(username, password);
            }
          }
        );
      } catch (e) {
        console.warn('Capture check error:', e);
      }
    }, 300);
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'autofill') {
      const success = performAutofill(request.data);
      sendResponse({ success });
      return true;
    }
  });

  // Track form submits
  document.addEventListener('submit', handleFormSubmitCapture, true);
  document.addEventListener('click', (e) => {
    const target = e.target;
    if (target && (target.type === 'submit' || target.matches('button[type="submit"], input[type="submit"]'))) {
      handleFormSubmitCapture();
    }
  }, true);

  // Dynamic DOM observation
  const observer = new MutationObserver(() => {
    bindInputFocusEvents();
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });

  // Initial load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      checkAndSetupAutofill();
      bindInputFocusEvents();
    });
  } else {
    checkAndSetupAutofill();
    bindInputFocusEvents();
  }

})();
