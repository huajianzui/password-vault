/**
 * CipherVault Content Script - Autofill & Form Capture
 */

(function () {
  // Helper to safely dispatch input/change events
  function setNativeValue(element, value) {
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

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // Find login fields on the current webpage
  function findFields() {
    const passwordInputs = Array.from(document.querySelectorAll('input[type="password"]')).filter(
      el => el.offsetParent !== null && !el.disabled && !el.readOnly
    );

    let usernameInput = null;
    let passwordInput = passwordInputs[0] || null;

    if (passwordInput) {
      // Find candidate username input preceding the password input
      const form = passwordInput.closest('form') || document.body;
      const textInputs = Array.from(
        form.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input:not([type])')
      ).filter(el => el.offsetParent !== null && !el.disabled && !el.readOnly);

      if (textInputs.length > 0) {
        usernameInput = textInputs[textInputs.length - 1]; // Closest text input before password
      }
    }

    return { usernameInput, passwordInput };
  }

  // Perform autofill
  function performAutofill(data) {
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

    return filledCount > 0;
  }

  // Display floating capture banner
  function showCaptureBanner(username, password) {
    const existing = document.getElementById('ciphervault-capture-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'ciphervault-capture-banner';

    const hostname = window.location.hostname.replace(/^www\./, '');

    banner.innerHTML = `
      <div class="cv-banner-icon">🛡️</div>
      <div class="cv-banner-content">
        <div class="cv-banner-title">CipherVault 发现新账号</div>
        <div class="cv-banner-sub">${username || '未知账号'} (${hostname})</div>
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
      banner.style.animation = 'cvSlideOut 0.2s forwards';
      setTimeout(() => banner.remove(), 200);
    });

    // Auto dismiss after 10s
    setTimeout(() => {
      if (document.body.contains(banner)) {
        banner.style.animation = 'cvSlideOut 0.2s forwards';
        setTimeout(() => banner.remove(), 200);
      }
    }, 10000);
  }

  // Listen for messages from popup or background
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'autofill') {
      const success = performAutofill(request.data);
      sendResponse({ success });
    }
  });

  // Track login form submissions
  document.addEventListener('submit', (e) => {
    try {
      const form = e.target;
      const pwdInput = form.querySelector('input[type="password"]');
      if (pwdInput && pwdInput.value) {
        const textInputs = Array.from(
          form.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"]')
        ).filter(el => el.value);

        const username = textInputs.length > 0 ? textInputs[0].value : '';
        const password = pwdInput.value;

        if (password) {
          showCaptureBanner(username, password);
        }
      }
    } catch (err) {
      console.warn('Form capture error:', err);
    }
  }, true);

})();
