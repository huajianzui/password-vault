/**
 * CipherVault Content Script - Intelligent Autofill & Single-Trigger Capture
 */

(function () {
  let hasPromptedThisSession = false;
  let lastFilledData = null;

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

      // Fire full spectrum of input events for Vue/React/Angular
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

  // Smart Form & Input Field Locator
  function findFields() {
    // 1. Locate all password inputs
    const passwordInputs = Array.from(
      document.querySelectorAll('input[type="password"], input[name*="password" i], input[id*="password" i], input[autocomplete="current-password"], input[autocomplete="new-password"]')
    ).filter(isElementVisible);

    const passwordInput = passwordInputs.length > 0 ? passwordInputs[0] : null;

    // 2. Locate username / email / account input
    let usernameInput = null;
    if (passwordInput) {
      const form = passwordInput.closest('form') || document.body;
      const candidates = Array.from(
        form.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input:not([type])')
      ).filter(isElementVisible);

      if (candidates.length > 0) {
        // Look for username-like name/id/autocomplete first
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
      // Standalone username step
      const candidates = Array.from(
        document.querySelectorAll('input[autocomplete="username"], input[name*="user" i], input[name*="login" i], input[type="email"]')
      ).filter(isElementVisible);
      if (candidates.length > 0) usernameInput = candidates[0];
    }

    return { usernameInput, passwordInput };
  }

  // Execute Autofill
  function performAutofill(data) {
    if (!data) return false;
    const { username, password } = data;
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

  // Automatic Background Autofill on page load
  function tryAutoFillOnLoad() {
    try {
      chrome.runtime.sendMessage(
        { action: 'getAutofillData', url: window.location.href },
        (response) => {
          if (chrome.runtime.lastError) return;
          if (response && response.shouldAutofill && response.data) {
            performAutofill(response.data);
          }
        }
      );
    } catch (e) {
      // Extension context invalidated or inactive
    }
  }

  // Observe dynamically loaded login modals (React / Vue SPAs)
  let fillAttempts = 0;
  const observer = new MutationObserver(() => {
    if (fillAttempts < 5) {
      const { passwordInput } = findFields();
      if (passwordInput && !passwordInput.value) {
        fillAttempts++;
        tryAutoFillOnLoad();
      }
    }
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
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
        <div class="cv-banner-title">CipherVault 提示保存账号</div>
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

    // Auto dismiss after 8s
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

        // If this matches what we just autofilled, no need to prompt
        if (lastFilledData && lastFilledData.password === password && lastFilledData.username === username) {
          return;
        }

        // Ask background if this is already in the vault
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

  // Listen for messages from popup or background
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'autofill') {
      const success = performAutofill(request.data);
      sendResponse({ success });
      return true;
    }
  });

  // Track form submits & login button clicks
  document.addEventListener('submit', handleFormSubmitCapture, true);
  document.addEventListener('click', (e) => {
    const target = e.target;
    if (target && (target.type === 'submit' || target.matches('button[type="submit"], input[type="submit"], button:not([type])'))) {
      handleFormSubmitCapture();
    }
  }, true);

  // Initial trigger after DOM loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryAutoFillOnLoad);
  } else {
    setTimeout(tryAutoFillOnLoad, 400);
  }

})();
