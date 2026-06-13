// Main content script - UI overlay and orchestration

(function () {
  'use strict';

  let isRunning = false;
  let fab = null;
  let overlay = null;

  let sidebarIframe = null;
  let linkedinInterval = null;
  let spaInterval = null;
  const clydeNonce = crypto.randomUUID();

  function isContextValid() {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime) return false;
      const url = chrome.runtime.getURL("");
      if (url.includes('invalid')) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  function toggleSidebar() {
    if (window !== window.top) return;

    if (sidebarIframe) {
      if (sidebarIframe.style.display === 'none') {
        sidebarIframe.src = chrome.runtime.getURL('popup.html?sidebar=true') + '&nonce=' + clydeNonce;
        sidebarIframe.style.display = 'block';
        setTimeout(() => {
          sidebarIframe.style.opacity = '1';
          sidebarIframe.style.transform = 'translateX(0)';
        }, 10);
      } else {
        sidebarIframe.style.opacity = '0';
        sidebarIframe.style.transform = 'translateX(20px)';
        setTimeout(() => {
          sidebarIframe.style.display = 'none';
        }, 300);
      }
    } else {
      sidebarIframe = document.createElement('iframe');
      sidebarIframe.id = 'clyde-sidebar-iframe';
      sidebarIframe.setAttribute('allow', 'clipboard-write');
      sidebarIframe.src = chrome.runtime.getURL('popup.html?sidebar=true') + '&nonce=' + clydeNonce;
      sidebarIframe.style.cssText = `
        position: fixed !important;
        top: 20px !important;
        right: 20px !important;
        width: 460px !important;
        height: 80vh !important;
        border: 1px solid rgba(255, 255, 255, 0.15) !important;
        border-radius: 12px !important;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5) !important;
        z-index: 2147483646 !important;
        background: #0f172a !important;
        transition: opacity 0.3s ease, transform 0.3s ease !important;
        opacity: 0 !important;
        transform: translateX(20px) !important;
        display: block !important;
      `;
      document.body.appendChild(sidebarIframe);
      setTimeout(() => {
        sidebarIframe.style.opacity = '1';
        sidebarIframe.style.transform = 'translateX(0)';
      }, 10);
    }
  }

  // Listen for sidebar messages (e.g. CLOSE_SIDEBAR) — only from our own sidebar iframe
  window.addEventListener('message', (event) => {
    // Reject messages not from the sidebar iframe
    if (!sidebarIframe || event.source !== sidebarIframe.contentWindow) return;
    // Reject unexpected origins as defense-in-depth
    if (event.origin !== chrome.runtime.getURL('').replace(/\/$/, '')) return;

    if (event.data && event.data.type === 'CLOSE_SIDEBAR') {
      if (sidebarIframe && sidebarIframe.style.display !== 'none') {
        sidebarIframe.style.opacity = '0';
        sidebarIframe.style.transform = 'translateX(20px)';
        setTimeout(() => {
          sidebarIframe.style.display = 'none';
        }, 300);
      }
    } else if (event.data && event.data.type === 'CLYDE_EXTRACT_REQUEST') {
      let textToExtract = "";
      const handler = PortalHandlers.detect();
      if (handler && typeof handler.getJobDescription === 'function') {
        textToExtract = handler.getJobDescription() || "";
      }

      if (!textToExtract) {
        const clone = document.body.cloneNode(true);
        const stripTags = ['script', 'style', 'noscript', 'code', 'iframe', 'header', 'footer', 'nav'];
        for (const tag of stripTags) {
          clone.querySelectorAll(tag).forEach(el => el.remove());
        }

        textToExtract = clone.innerText || "";
        const selectors = [
          '.show-more-less-html__markup',
          '.jobs-box__html-content',
          '.jobs-description-content__text',
          '.jobs-description__content',
          '.jobs-search__job-details--container',
          '.jobs-description',
          '.job-description', 
          '#job-description',
          '[data-automation-id="jobPostingDescription"]',
          '[data-automation-id="job-posting-description"]'
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.innerText && el.innerText.trim().length > 200) {
            const elClone = el.cloneNode(true);
            for (const tag of stripTags) {
              elClone.querySelectorAll(tag).forEach(e => e.remove());
            }
            if (elClone.innerText && elClone.innerText.trim().length > 100) {
              textToExtract = elClone.innerText;
              break;
            }
          }
        }
      }

      const iframe = document.getElementById('clyde-sidebar-iframe');
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({
          type: 'CLYDE_EXTRACT_RESPONSE',
          nonce: clydeNonce,
          text: textToExtract,
          url: window.location.href
        }, '*');
      }
    }
  });

  // Create floating action button
  function createFAB() {
    if (window !== window.top) return; // Only show FAB in top frame

    if (fab) return;

    const iconUrl = chrome.runtime.getURL('icons/sidebar_ghost_icon.svg');

    fab = document.createElement('div');
    fab.id = 'job-autofill-fab';
    
    // Style element for CSS rules
    const styleEl = document.createElement('style');
    styleEl.textContent = `
      #clyde-floating-tab {
        position: fixed !important;
        right: 0 !important;
        top: 50% !important;
        transform: translateY(-50%) !important;
        width: 64px !important;
        height: 64px !important;
        background-color: #3b4b72 !important;
        border-top-left-radius: 12px !important;
        border-bottom-left-radius: 12px !important;
        box-shadow: 0 4px 12px rgba(0,0,0,0.35) !important;
        z-index: 2147483647 !important;
        cursor: pointer !important;
        transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
        display: flex !important;
        align-items: center !important;
        justify-content: flex-start !important;
        overflow: visible !important;
        user-select: none !important;
        box-sizing: border-box !important;
      }
      #clyde-floating-tab:hover {
        width: 106px !important;
      }
      #clyde-tab-content {
        display: flex !important;
        align-items: center !important;
        justify-content: flex-start !important;
        width: 100% !important;
        height: 100% !important;
        padding-left: 13px !important;
        gap: 12px !important;
        box-sizing: border-box !important;
      }
      #clyde-tab-logo {
        width: 38px !important;
        height: 38px !important;
        pointer-events: none !important;
        flex-shrink: 0 !important;
      }
      #clyde-tab-drag {
        display: grid !important;
        grid-template-columns: repeat(2, 6px) !important;
        grid-gap: 4px !important;
        cursor: ns-resize !important;
        opacity: 0 !important;
        transition: opacity 0.2s ease !important;
        flex-shrink: 0 !important;
        padding: 4px !important;
      }
      #clyde-floating-tab:hover #clyde-tab-drag {
        opacity: 1 !important;
      }
      .clyde-drag-dot {
        width: 6px !important;
        height: 6px !important;
        background-color: white !important;
        border-radius: 50% !important;
      }
      #clyde-tab-close {
        position: absolute !important;
        left: -10px !important;
        top: -10px !important;
        width: 22px !important;
        height: 22px !important;
        background-color: #4f649c !important;
        color: white !important;
        border-radius: 50% !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        font-family: Arial, sans-serif !important;
        font-size: 11px !important;
        font-weight: bold !important;
        cursor: pointer !important;
        box-shadow: 0 2px 5px rgba(0,0,0,0.3) !important;
        opacity: 0 !important;
        transition: opacity 0.2s ease !important;
        user-select: none !important;
        z-index: 10 !important;
      }
      #clyde-floating-tab:hover #clyde-tab-close {
        opacity: 1 !important;
      }
      #clyde-tab-close:hover {
        background-color: #3f517d !important;
      }
    `;
    document.head.appendChild(styleEl);

    fab.innerHTML = `
      <div id="clyde-floating-tab" title="Clyde Assistant">
        <div id="clyde-tab-close" title="Hide Clyde">X</div>
        <div id="clyde-tab-content">
          <img id="clyde-tab-logo" src="${iconUrl}" alt="Clyde logo">
          <div id="clyde-tab-drag" title="Drag up/down">
            <div class="clyde-drag-dot"></div>
            <div class="clyde-drag-dot"></div>
            <div class="clyde-drag-dot"></div>
            <div class="clyde-drag-dot"></div>
            <div class="clyde-drag-dot"></div>
            <div class="clyde-drag-dot"></div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(fab);

    const tabEl = document.getElementById('clyde-floating-tab');
    const dragHandle = document.getElementById('clyde-tab-drag');
    const closeBtn = document.getElementById('clyde-tab-close');

    // Click behavior (excluding close/drag)
    tabEl.addEventListener('click', (e) => {
      if (e.target.closest('#clyde-tab-close') || e.target.closest('#clyde-tab-drag')) {
        return;
      }
      toggleSidebar();
    });

    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      
      const existingMenu = document.getElementById('clyde-close-menu');
      if (existingMenu) {
        existingMenu.remove();
        return;
      }

      const menu = document.createElement('div');
      menu.id = 'clyde-close-menu';
      menu.style.cssText = `
        position: absolute !important;
        right: 12px !important;
        top: 32px !important;
        background: rgba(15, 23, 42, 0.75) !important;
        backdrop-filter: blur(12px) !important;
        -webkit-backdrop-filter: blur(12px) !important;
        border: 1px solid rgba(255, 255, 255, 0.1) !important;
        border-radius: 8px !important;
        box-shadow: 0 10px 25px rgba(0,0,0,0.35) !important;
        z-index: 2147483647 !important;
        padding: 6px 0 !important;
        width: 180px !important;
        display: flex !important;
        flex-direction: column !important;
        box-sizing: border-box !important;
        font-family: 'Inter', system-ui, -apple-system, sans-serif !important;
      `;

      const options = [
        {
          text: 'Hide until next visit',
          action: () => {
            tabEl.style.display = 'none';
            if (sidebarIframe) {
              sidebarIframe.style.opacity = '0';
              sidebarIframe.style.transform = 'translateX(20px)';
              setTimeout(() => { sidebarIframe.style.display = 'none'; }, 300);
            }
          }
        },
        {
          text: 'Disable on all pages',
          action: async () => {
            await chrome.storage.local.set({ badgeDisabledGlobally: true });
            if (fab) { fab.remove(); fab = null; }
            if (sidebarIframe) { sidebarIframe.remove(); sidebarIframe = null; }
          }
        },
        {
          text: 'Disable on this domain',
          action: async () => {
            const currentDomain = window.location.hostname;
            const settings = await chrome.storage.local.get('disabledDomains');
            const disabledDomains = settings.disabledDomains || [];
            if (!disabledDomains.includes(currentDomain)) {
              disabledDomains.push(currentDomain);
              await chrome.storage.local.set({ disabledDomains });
            }
            if (fab) { fab.remove(); fab = null; }
            if (sidebarIframe) { sidebarIframe.remove(); sidebarIframe = null; }
          }
        }
      ];

      options.forEach(opt => {
        const item = document.createElement('div');
        item.textContent = opt.text;
        item.style.cssText = `
          padding: 8px 16px !important;
          color: #cbd5e1 !important;
          font-size: 13px !important;
          cursor: pointer !important;
          transition: background 0.15s, color 0.15s !important;
          text-align: left !important;
          font-family: inherit !important;
          box-sizing: border-box !important;
        `;
        
        item.addEventListener('mouseenter', () => {
          item.style.background = 'rgba(56, 189, 248, 0.15)';
          item.style.color = '#38bdf8';
        });
        
        item.addEventListener('mouseleave', () => {
          item.style.background = 'transparent';
          item.style.color = '#cbd5e1';
        });

        item.addEventListener('click', async (evt) => {
          evt.stopPropagation();
          menu.remove();
          await opt.action();
        });

        menu.appendChild(item);
      });

      tabEl.appendChild(menu);
    });

    // Close menu when clicking outside of it
    document.addEventListener('click', (e) => {
      const openMenu = document.getElementById('clyde-close-menu');
      if (openMenu && !e.target.closest('#clyde-close-menu') && !e.target.closest('#clyde-tab-close')) {
        openMenu.remove();
      }
    });

    // Drag behavior
    let isDragging = false;
    let dragStartY = 0;
    let startTop = 0;

    dragHandle.addEventListener('mousedown', (e) => {
      isDragging = true;
      dragStartY = e.clientY;
      const rect = tabEl.getBoundingClientRect();
      startTop = rect.top;

      document.body.style.setProperty('user-select', 'none', 'important');
      document.body.style.cursor = 'ns-resize';

      e.preventDefault();
      e.stopPropagation();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const deltaY = e.clientY - dragStartY;
      let newTop = startTop + deltaY;

      // Constrain inside viewport
      const maxTop = window.innerHeight - tabEl.offsetHeight;
      if (newTop < 0) newTop = 0;
      if (newTop > maxTop) newTop = maxTop;

      tabEl.style.setProperty('top', `${newTop}px`, 'important');
      tabEl.style.setProperty('bottom', 'auto', 'important');
      tabEl.style.setProperty('transform', 'none', 'important');
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      }
    });

    // Touch events for drag
    dragHandle.addEventListener('touchstart', (e) => {
      isDragging = true;
      dragStartY = e.touches[0].clientY;
      const rect = tabEl.getBoundingClientRect();
      startTop = rect.top;
      e.stopPropagation();
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      const deltaY = e.touches[0].clientY - dragStartY;
      let newTop = startTop + deltaY;

      const maxTop = window.innerHeight - tabEl.offsetHeight;
      if (newTop < 0) newTop = 0;
      if (newTop > maxTop) newTop = maxTop;

      tabEl.style.setProperty('top', `${newTop}px`, 'important');
      tabEl.style.setProperty('bottom', 'auto', 'important');
      tabEl.style.setProperty('transform', 'none', 'important');
    }, { passive: false });

    window.addEventListener('touchend', () => {
      isDragging = false;
    });
  }

  let skipRequested = false;

  // Helper to query element inside overlay's shadow root
  function getOverlayElement(id) {
    if (!overlay) return null;
    return overlay.shadowRoot ? overlay.shadowRoot.getElementById(id) : document.getElementById(id);
  }

  // Create status overlay
  function createOverlay() {
    if (window !== window.top) return; // Only show UI in the top frame

    if (overlay) {
      overlay.style.opacity = '1';
      const statusEl = getOverlayElement('job-autofill-status');
      if (statusEl) statusEl.textContent = 'Initializing...';
      const progressBar = getOverlayElement('job-autofill-progress-bar');
      if (progressBar) {
        progressBar.style.width = '0%';
        progressBar.style.background = '#38bdf8';
      }
      const skipBtn = getOverlayElement('job-autofill-skip-btn');
      if (skipBtn) skipBtn.style.display = 'none';
      const noticeEl = getOverlayElement('job-autofill-navigation-notice');
      if (noticeEl) noticeEl.style.display = 'block';
      return;
    }

    overlay = document.createElement('div');
    overlay.id = 'job-autofill-overlay';
    
    // Set fixed positioning and other container properties on host element
    overlay.style.position = 'fixed';
    overlay.style.top = '20px';
    overlay.style.right = '20px';
    overlay.style.zIndex = '1000000';
    overlay.style.transition = 'opacity 0.3s';
    overlay.style.opacity = '1';

    const shadow = overlay.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <div style="
        background: rgba(15, 23, 42, 0.75) !important;
        backdrop-filter: blur(12px) !important;
        -webkit-backdrop-filter: blur(12px) !important;
        border: 1px solid rgba(255, 255, 255, 0.1) !important;
        border-radius: 12px !important;
        padding: 18px 22px !important;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4) !important;
        font-family: 'Inter', system-ui, -apple-system, sans-serif !important;
        font-size: 14px !important;
        line-height: 1.5 !important;
        text-align: left !important;
        box-sizing: border-box !important;
        min-width: 290px !important;
        max-width: 360px !important;
        height: auto !important;
        display: block !important;
        position: relative !important;
      " id="job-autofill-overlay-inner">
        <button id="job-autofill-close-btn" style="
          position: absolute !important;
          top: 14px !important;
          right: 14px !important;
          background: none !important;
          border: none !important;
          color: #94a3b8 !important;
          cursor: pointer !important;
          font-size: 14px !important;
          font-weight: bold !important;
          padding: 4px !important;
          line-height: 1 !important;
          transition: color 0.2s !important;
          outline: none !important;
        " title="Close Overlay">✕</button>
        <div style="font-weight: 700; font-size: 15px; margin-bottom: 12px !important; color: #38bdf8 !important; line-height: 1.4 !important; display: block !important; position: relative !important; float: none !important; clear: both !important; height: auto !important; width: auto !important;">
          Clyde AutoFill
        </div>
        <div id="job-autofill-status" style="color: #cbd5e1 !important; font-size: 13px !important; line-height: 1.5 !important; display: block !important; position: relative !important; float: none !important; clear: both !important; height: auto !important; width: auto !important;">
          Initializing...
        </div>
        <div id="job-autofill-progress" style="
          margin-top: 12px !important;
          height: 6px !important;
          background: rgba(255, 255, 255, 0.15) !important;
          border-radius: 3px !important;
          overflow: hidden !important;
          display: block !important;
          position: relative !important;
          box-sizing: border-box !important;
          width: 100% !important;
        ">
          <div id="job-autofill-progress-bar" style="
            height: 100% !important;
            background: #38bdf8 !important;
            width: 0% !important;
            transition: width 0.3s !important;
            border-radius: 3px !important;
            display: block !important;
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
          "></div>
        </div>
        <div id="job-autofill-navigation-notice" style="
          margin-top: 12px !important;
          font-size: 11px !important;
          color: #f87171 !important;
          font-style: italic !important;
          line-height: 1.4 !important;
          display: block !important;
          position: relative !important;
        ">
          ⚠️ Please do not navigate away or close this page while autofill is in progress.
        </div>
        <button id="job-autofill-skip-btn" style="margin-top: 14px !important; width: 100% !important; padding: 8px !important; background: rgba(249, 115, 22, 0.8) !important; border: 1px solid rgba(255, 255, 255, 0.1) !important; border-radius: 6px !important; cursor: pointer !important; color: white !important; font-weight: 600 !important; font-size: 12px !important; transition: background 0.2s !important; line-height: normal !important; display: none !important; box-sizing: border-box !important;">Skip Current Field</button>
      </div>
    `;
    document.body.appendChild(overlay);

    const skipBtn = getOverlayElement('job-autofill-skip-btn');
    if (skipBtn) {
      skipBtn.addEventListener('mouseenter', () => skipBtn.style.background = '#ea580c');
      skipBtn.addEventListener('mouseleave', () => skipBtn.style.background = '#f97316');
      skipBtn.addEventListener('click', () => {
        skipRequested = true;
        skipBtn.textContent = 'Skipping...';
        setTimeout(() => { skipBtn.textContent = 'Skip Current Field'; }, 1000);
      });
    }

    const closeBtn = getOverlayElement('job-autofill-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('mouseenter', () => closeBtn.style.color = '#ffffff');
      closeBtn.addEventListener('mouseleave', () => closeBtn.style.color = '#94a3b8');
      closeBtn.addEventListener('click', () => {
        if (overlay) {
          overlay.style.opacity = '0';
          setTimeout(() => overlay?.remove(), 300);
          overlay = null;
        }
      });
    }
  }

  function updateStatus(text, progress) {
    if (window === window.top) {
      if (!overlay) createOverlay();
      const statusEl = getOverlayElement('job-autofill-status');
      const progressBar = getOverlayElement('job-autofill-progress-bar');
      if (statusEl) statusEl.textContent = text;
      if (progressBar && progress !== undefined) progressBar.style.width = `${progress}%`;
    }
    if (window !== window.top) {
      try {
        chrome.runtime.sendMessage({ type: 'AUTOFILL_PROGRESS', text, progress });
      } catch (e) { }
    }
  }

  function showResult(filled, failedLabels, total) {
    if (window === window.top) {
      const skipBtn = getOverlayElement('job-autofill-skip-btn');
      if (skipBtn) skipBtn.style.display = 'none';

      const noticeEl = getOverlayElement('job-autofill-navigation-notice');
      if (noticeEl) noticeEl.style.display = 'none';

      const statusEl = getOverlayElement('job-autofill-status');
      const failedCount = failedLabels.length;

      let failedListHtml = '';
      if (failedCount > 0) {
        const uniqueFailed = [...new Set(failedLabels)];
        failedListHtml = `
          <div style="display: block !important; position: relative !important; margin-top: 10px !important; max-height: 140px !important; overflow-y: auto !important; background: rgba(251, 191, 36, 0.1) !important; border: 1px solid rgba(251, 191, 36, 0.3) !important; border-radius: 6px !important; padding: 10px !important; font-size: 12px !important; line-height: 1.5 !important; color: #fde047 !important; box-sizing: border-box !important;">
            <strong style="display: block !important; position: relative !important; font-weight: 700 !important; margin-bottom: 6px !important; font-size: 12px !important; line-height: 1.4 !important;">Please double-check for accuracy and completeness (${failedCount}):</strong>
            <div style="display: block !important; position: relative !important; margin: 0 !important; padding: 0 !important; box-sizing: border-box !important;">
              ${uniqueFailed.map(label => `
                <div style="margin-bottom: 6px !important; line-height: 1.5 !important; display: block !important; position: relative !important; height: auto !important; min-height: 18px !important; visibility: visible !important; text-align: left !important; font-size: 12px !important; color: #fde047 !important; box-sizing: border-box !important;">
                  • ${escapeHtml(label)}
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }

      if (statusEl) {
        statusEl.innerHTML = `
          <div style="color: #4ade80 !important; font-weight: 600 !important; line-height: 1.4 !important; display: block !important;">Autofill Complete</div>
          <div style="margin-top: 4px !important; color: #cbd5e1 !important; font-size: 13px !important; line-height: 1.4 !important; display: block !important; position: relative !important; box-sizing: border-box !important;">
            Processed ${total} fields${failedCount > 0 ? ` (${failedCount} require verification)` : ''}
          </div>
          ${failedListHtml}
          <div style="margin-top: 6px !important; color: #94a3b8 !important; font-size: 11px !important; font-style: italic !important; line-height: 1.4 !important; display: block !important; position: relative !important; box-sizing: border-box !important;">
            We recommend a quick manual review of your application before submitting.
          </div>
          <button id="job-autofill-continue-btn" style="margin-top: 12px !important; width: 100% !important; padding: 8px !important; background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%) !important; border: none !important; border-radius: 6px !important; cursor: pointer !important; color: white !important; font-weight: 600 !important; font-size: 13px !important; transition: opacity 0.2s !important; line-height: normal !important; display: block !important; box-sizing: border-box !important;">Continue with Autofill</button>
          <button id="job-autofill-dismiss-btn" style="margin-top: 8px !important; width: 100% !important; padding: 8px !important; background: rgba(255, 255, 255, 0.1) !important; border: 1px solid rgba(255, 255, 255, 0.1) !important; border-radius: 6px !important; cursor: pointer !important; color: #cbd5e1 !important; font-weight: 600 !important; font-size: 13px !important; transition: background 0.2s, color 0.2s !important; line-height: normal !important; display: block !important; box-sizing: border-box !important;">Dismiss</button>
        `;

        const continueBtn = getOverlayElement('job-autofill-continue-btn');
        if (continueBtn) {
          continueBtn.addEventListener('mouseenter', () => continueBtn.style.opacity = '0.85');
          continueBtn.addEventListener('mouseleave', () => continueBtn.style.opacity = '1');
          continueBtn.addEventListener('click', () => {
            startAutoFill();
          });
        }

        const dismissBtn = getOverlayElement('job-autofill-dismiss-btn');
        if (dismissBtn) {
          dismissBtn.addEventListener('mouseenter', () => {
            dismissBtn.style.background = 'rgba(255, 255, 255, 0.15)';
            dismissBtn.style.color = '#ffffff';
          });
          dismissBtn.addEventListener('mouseleave', () => {
            dismissBtn.style.background = 'rgba(255, 255, 255, 0.1)';
            dismissBtn.style.color = '#cbd5e1';
          });
          dismissBtn.addEventListener('click', () => {
            showReadyState();
          });
        }
      }
      const progressBar = getOverlayElement('job-autofill-progress-bar');
      if (progressBar) {
        progressBar.style.width = '100%';
        progressBar.style.background = failedCount > 0 ? '#fbbc04' : '#34a853';
      }
    } else {
      try {
        chrome.runtime.sendMessage({ type: 'AUTOFILL_DONE', filled, failedLabels, total });
      } catch (e) { }
    }
  }

  function showReadyState() {
    const statusEl = getOverlayElement('job-autofill-status');
    if (statusEl) {
      statusEl.innerHTML = `
        <div style="color: #cbd5e1 !important; font-weight: 500 !important; line-height: 1.4 !important; display: block !important;">Ready for next page</div>
        <button id="job-autofill-continue-btn" style="margin-top: 12px !important; width: 100% !important; padding: 8px !important; background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%) !important; border: none !important; border-radius: 6px !important; cursor: pointer !important; color: white !important; font-weight: 600 !important; font-size: 13px !important; transition: opacity 0.2s !important; line-height: normal !important; display: block !important; box-sizing: border-box !important;">Continue with Autofill</button>
      `;
      const progressBar = getOverlayElement('job-autofill-progress-bar');
      if (progressBar) {
        progressBar.style.width = '0%';
        progressBar.style.background = '#38bdf8';
      }
      
      const continueBtn = getOverlayElement('job-autofill-continue-btn');
      if (continueBtn) {
        continueBtn.addEventListener('mouseenter', () => continueBtn.style.opacity = '0.85');
        continueBtn.addEventListener('mouseleave', () => continueBtn.style.opacity = '1');
        continueBtn.addEventListener('click', () => {
          startAutoFill();
        });
      }
    }
  }

  function showError(message) {
    if (window === window.top) {
      const skipBtn = getOverlayElement('job-autofill-skip-btn');
      if (skipBtn) skipBtn.style.display = 'none';

      const noticeEl = getOverlayElement('job-autofill-navigation-notice');
      if (noticeEl) noticeEl.style.display = 'none';

      const statusEl = getOverlayElement('job-autofill-status');
      if (statusEl) {
        statusEl.innerHTML = `
          <div style="color: #ea4335; margin-bottom: 12px; line-height: 1.4 !important; display: block !important;">${escapeHtml(message)}</div>
          <button id="job-autofill-error-dismiss-btn" style="width: 100%; padding: 6px; background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 4px; cursor: pointer; color: #374151; font-weight: 600; font-size: 12px; transition: background 0.2s;">Dismiss</button>
        `;
        const dismissBtn = getOverlayElement('job-autofill-error-dismiss-btn');
        if (dismissBtn) {
          dismissBtn.addEventListener('mouseenter', () => dismissBtn.style.background = '#e5e7eb');
          dismissBtn.addEventListener('mouseleave', () => dismissBtn.style.background = '#f3f4f6');
          dismissBtn.addEventListener('click', () => {
            showReadyState();
          });
        }
      }
    } else {
      try {
        chrome.runtime.sendMessage({ type: 'AUTOFILL_ERROR', message });
      } catch (e) { }
    }
  }

  function getFieldPurpose(field) {
    return classifyFieldPurpose(field.label, field.options || [], field.fieldType, field.element);
  }

  function resolveFieldElement(field) {
    const el = field.element;
    if (el && document.contains(el)) return field;
    if (el?.id) {
      const fresh = document.getElementById(el.id);
      if (fresh) return { ...field, element: fresh };
    }
    if (el?.name) {
      const fresh = document.querySelector(`[name="${CSS.escape(el.name)}"]`);
      if (fresh) return { ...field, element: fresh };
    }
    if (field.label && el) {
      const allCandidates = FormFiller.querySelectorAllDeep('input:not([type="hidden"]), textarea, select');
      for (const cand of allCandidates) {
        if (cand.tagName.toLowerCase() === el.tagName.toLowerCase()) {
          const l = getFieldLabel(cand);
          if (l === field.label) {
            return { ...field, element: cand };
          }
        }
      }
    }
    return field;
  }

  function isComboboxInput(el) {
    if (!el) return false;
    return el.getAttribute('role') === 'combobox' ||
      el.getAttribute('aria-haspopup') === 'listbox' ||
      el.getAttribute('aria-autocomplete') != null ||
      el.closest('[role="combobox"]') != null ||
      FormFiller.isGreenhouseRemixComboboxInput(el);
  }

  function keyForNearDuplicateLabel(label) {
    let k = normalizeFieldText(String(label || '')).replace(/\t+/g, ' ');
    k = k.replace(/\s*select\.{3}\s*$/i, '').replace(/\*+\s*$/g, '').trim();
    return k || `__raw__${label}`;
  }

  function fieldLooksVisible(field) {
    const el = field.element;
    if (!el || !document.contains(el)) return false;
    const st = window.getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  }

  function dedupeFieldsByNearDuplicateLabel(fieldList) {
    const groups = new Map();
    for (const f of fieldList) {
      const key = keyForNearDuplicateLabel(f.label);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(f);
    }
    const out = [];
    for (const list of groups.values()) {
      if (list.length === 1) {
        out.push(list[0]);
        continue;
      }
      // Prefer a field whose element is actually visible; the "*Select..." label often points
      // at an aria-hidden mirror input while the plain-labeled sibling is the real UI target.
      const vis = list.filter(fieldLooksVisible);
      const withSelect = list.find(x => /select\.{0,3}/i.test(x.label));
      if (withSelect && fieldLooksVisible(withSelect)) {
        out.push(withSelect);
        continue;
      }
      if (vis.length === 1) {
        out.push(vis[0]);
        continue;
      }
      if (vis.length > 1) {
        const prefer = vis.find(x => /select\.{0,3}/i.test(x.label)) || vis[0];
        out.push(prefer);
        continue;
      }
      const pool = list;
      const combobox = pool.find(x =>
        x.element?.getAttribute?.('role') === 'combobox' ||
        x.element?.getAttribute?.('aria-haspopup') === 'listbox' ||
        x.element?.getAttribute?.('aria-autocomplete') != null
      );
      out.push(withSelect || combobox || pool[pool.length - 1]);
    }
    return out;
  }

  function dedupeAiFieldsByNearDuplicateLabel(aiFields) {
    return dedupeFieldsByNearDuplicateLabel(aiFields);
  }

  function dedupeDirectByLabelAndPurpose(directList) {
    const seen = new Set();
    const out = [];
    for (const f of directList) {
      const k = `${normalizeFieldText(String(f.label || ''))}::${f.purpose}`;
      if (seen.has(k)) {
        console.log(`[JobAutoFill] Dedup: skipping duplicate direct "${f.label}" (${f.purpose})`);
        continue;
      }
      seen.add(k);
      out.push(f);
    }
    return out;
  }

  function isGroupedChoiceField(field) {
    return (field.fieldType === 'radio' || field.fieldType === 'checkbox-group' || field.fieldType === 'aria-choice-group') &&
      Array.isArray(field.allElements) && field.allElements.length > 1;
  }

  async function fillDetectedField(field, value) {
    if (field.fieldType === 'radio' && field.allElements) {
      return FormFiller.fillRadio(field.element, String(value), field.allElements);
    }
    if (field.fieldType === 'checkbox-group' && field.allElements) {
      return FormFiller.fillCheckboxGroup(field.element, value, field.allElements);
    }
    if (field.fieldType === 'aria-choice-group' && field.allElements) {
      return FormFiller.fillAriaChoiceGroup(field.element, String(value), field.allElements);
    }
    return await FormFiller.fillField(field.element, String(value), field.fieldType, field.purpose, field.label);
  }

  function verifyFilledField(field, expectedValue) {
    if (field.fieldType === 'radio' && field.allElements) {
      const actual = FormFiller.getSelectedRadioLabel(field.allElements);
      return {
        ok: !!actual && FormFiller.matchesChoice(actual, '', expectedValue),
        actual
      };
    }

    if (field.fieldType === 'checkbox-group' && field.allElements) {
      const actual = FormFiller.getCheckedCheckboxLabels(field.allElements);
      const desired = FormFiller.parseMultiValue(expectedValue);
      const matchedCount = desired.filter(answer =>
        actual.some(label => FormFiller.matchesChoice(label, '', answer))
      ).length;
      return {
        ok: desired.length > 0 && matchedCount === desired.length && actual.length === desired.length,
        actual: actual.join(', ')
      };
    }

    if (field.fieldType === 'aria-choice-group' && field.allElements) {
      const actual = FormFiller.getSelectedAriaChoiceLabel(field.allElements);
      return {
        ok: !!actual && FormFiller.matchesChoice(actual, '', expectedValue),
        actual
      };
    }

    if (field.fieldType === 'checkbox') {
      const shouldBeChecked = /^(yes|true|1|checked|agree)$/i.test(String(expectedValue));
      return {
        ok: field.element.checked === shouldBeChecked,
        actual: field.element.checked ? 'checked' : 'unchecked'
      };
    }

    const actual = FormFiller.getEffectiveInputValue(field.element) ||
      field.element.value ||
      field.element.textContent ||
      '';
    const rawTrim = String(actual).trim();
    const placeholder = (field.element.getAttribute('placeholder') || '').trim();

    if (isComboboxInput(field.element)) {
      if (!rawTrim || /^select\.{0,3}$/i.test(rawTrim)) {
        return { ok: false, actual: rawTrim || '(empty)' };
      }
      if (placeholder && rawTrim.toLowerCase() === placeholder.toLowerCase()) {
        return { ok: false, actual: rawTrim };
      }
      if (/no location found|try entering a different location/i.test(rawTrim)) {
        return { ok: false, actual: rawTrim };
      }
    }

    const isPhone = field.element.type === 'tel' ||
      /\b(phone|mobile|cell|telephone)\b/i.test(field.label || '');
    if (isPhone) {
      const actualDigits = String(actual).replace(/\D/g, '');
      const expectedDigits = String(expectedValue).replace(/\D/g, '');
      if (actualDigits && expectedDigits) {
        const ok = actualDigits.includes(expectedDigits) || expectedDigits.includes(actualDigits);
        return { ok, actual: rawTrim };
      }
    }

    const normalizedActual = FormFiller.normalizeChoiceText(actual);
    const normalizedExpected = FormFiller.normalizeChoiceText(String(expectedValue));
    const expectedShort = /^(yes|no)$/i.test(String(expectedValue).trim());
    if (expectedShort && !/^(yes|no)$/i.test(rawTrim)) {
      const ok = FormFiller.matchesChoice(rawTrim, '', expectedValue);
      return { ok, actual: rawTrim };
    }

    const expectedTokens = FormFiller.tokenizeChoice(normalizedExpected).filter(token => token.length > 2);
    const actualTokens = new Set(FormFiller.tokenizeChoice(normalizedActual));
    const tokenHits = expectedTokens.filter(token => actualTokens.has(token)).length;
    const fuzzyMatch = expectedTokens.length > 0 && tokenHits >= Math.max(2, Math.ceil(expectedTokens.length / 2));
    return {
      ok: normalizedActual === normalizedExpected ||
        normalizedActual.includes(normalizedExpected) ||
        normalizedExpected.includes(normalizedActual) ||
        fuzzyMatch,
      actual: rawTrim
    };
  }

  // Main auto-fill flow
  async function startAutoFill() {
    if (isRunning) return;

    // Detect portal handler
    const handler = PortalHandlers.detect() || GenericHandler;
    const fields = handler ? handler.getFields() : [];

    // Robust logging for portal and fields detection
    console.log(`[JobAutoFill Robust Log] Entering startAutoFill for window: "${window.location.href}" (isTop: ${window === window.top})`);
    console.log(`[JobAutoFill Robust Log] Detected handler: "${handler?.name || 'Generic'}"`);
    console.log(`[JobAutoFill Robust Log] Fields count: ${fields.length}`);

    const hasIframeInTop = window === window.top && document.querySelectorAll('iframe').length > 0;
    const isFrameWithFields = fields.length > 0;
    const shouldRun = (window === window.top) || isFrameWithFields;

    if (!shouldRun) {
      console.log(`[JobAutoFill Robust Log] Skipping frame "${window.location.href}" - not top-level and contains 0 fields.`);
      return;
    }

    isRunning = true;
    skipRequested = false;

    // Only create status overlay in the top-level window
    if (window === window.top) {
      createOverlay();
      const skipBtn = getOverlayElement('job-autofill-skip-btn');
      if (skipBtn) skipBtn.style.display = 'block';
      updateStatus('Detecting application form...', 5);
    } else {
      console.log(`[JobAutoFill Robust Log] Executing autofill inside active sub-frame: "${window.location.href}" with ${fields.length} detected fields!`);
    }

    try {
      // 1. Get profile and resume data
      const profileData = await chrome.runtime.sendMessage({ type: 'GET_PROFILE' });
      console.log('[JobAutoFill Debug] Profile loaded:', profileData.profile);
      if (!profileData.hasApiKey) throw new Error('Please set your Gemini API key in the extension popup.');
      if (!profileData.hasResume) throw new Error('Please upload your resume in the extension popup.');

      // Wire settings.autoFillDelay dynamically
      if (profileData.settings && typeof profileData.settings.autoFillDelay === 'number') {
        FormFiller.FILL_DELAY = profileData.settings.autoFillDelay;
      }

      const querySelectorAllDeep = (selector, root = document) => {
        const elements = Array.from(root.querySelectorAll(selector));
        const children = root.querySelectorAll('*');
        for (const child of children) {
          if (child.shadowRoot) {
            elements.push(...querySelectorAllDeep(selector, child.shadowRoot));
          }
        }
        return elements;
      };
      console.log(`[JobAutoFill Debug] Detected handler: "${handler?.name || 'Generic'}"`);
      console.log(`[JobAutoFill Debug] Is customFill defined on handler? ${typeof handler?.customFill === 'function'}`);
      const isSmartRecruiters = handler?.name === 'SmartRecruiters';

      // Click all "+ Add" buttons (Experience, Education rows) to expand dynamic form fields (crossing shadow boundaries)
      // Skip if the handler has a customFill method that manages its own card expansion
      if (!handler.customFill) {
        console.log('[JobAutoFill Debug] No customFill defined on handler. Doing standard expansion.');
        const allButtons = querySelectorAllDeep('button, [role="button"], a.btn, .btn, sf-button, [class*="button"], [class*="btn"], .add-button, span, div, a');
        console.log(`[JobAutoFill Debug] querySelectorAllDeep found ${allButtons.length} candidate elements.`);
        const addButtons = allButtons.filter(el => {
          const text = el.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
          if (text.length > 50) return false;
          const isMatch = text === '+ add' || text === 'add' || text === '+add' || text === 'add more' || text === 'add another' ||
            (text.includes('add') && (text.includes('experience') || text.includes('education') || text.includes('job') || text.includes('work') || text.includes('school') || text.includes('history') || text.includes('degree') || text.includes('employer')));
          if (isMatch) {
            console.log(`[JobAutoFill Debug] Matched button: tag=${el.tagName}, class=${el.className}, text="${text}"`);
          }
          return isMatch;
        });

        if (addButtons.length > 0) {
          // Deduplicate to keep only the leaf (most specific) click targets
          const leafButtons = addButtons.filter(btn => {
            return !addButtons.some(other => other !== btn && btn.contains(other));
          });

          console.log(`[JobAutoFill] Clicking ${leafButtons.length} "+ Add" button(s) to expand form sections...`);
          for (const btn of leafButtons) {
            try {
              btn.click();
              await FormFiller.delay(200); // short delay between clicks for React state updates
            } catch (e) {
              console.warn('[JobAutoFill] Click failed on "+ Add" button:', e);
            }
          }
          await FormFiller.delay(500); // wait for all animations to complete
        }
      } else {
        console.log(`[JobAutoFill Debug] customFill IS defined on "${handler.name}". Skipping standard expansion.`);
      }

      // If handler has a custom multi-card/complex fill flow, invoke it first
      // (e.g. SmartRecruiters experience/education sections with Shadow DOM cards)
      if (handler.customFill) {
        console.log(`[JobAutoFill Debug] Calling customFill for "${handler.name}"...`);
        updateStatus('Filling experience and education details...', 10);
        try {
          await handler.customFill(profileData);
          console.log(`[JobAutoFill Debug] customFill for "${handler.name}" completed successfully.`);
        } catch (e) {
          console.error(`[JobAutoFill Debug] Exception caught inside customFill for "${handler.name}":`, e);
        }
      }

      updateStatus('Scanning form fields...', 15);

      // Loop up to 2 times for dynamic fields (like race appearing after hispanic)
      const MAX_PASSES = 2;
      const allDetectedFieldIds = new Set();
      const allFailedFieldLabels = [];
      let totalFieldsAttempted = 0;
      let totalFilled = 0;

      for (let pass = 1; pass <= MAX_PASSES; pass++) {
        const currentPassFields = handler.getFields();

        // Filter out fields we already processed in a previous pass
        const fields = currentPassFields.filter(f => !allDetectedFieldIds.has(f.id));
        fields.forEach(f => allDetectedFieldIds.add(f.id));

        if (fields.length === 0) {
          if (pass === 1) {
            // Prevent false "No form fields" errors when the form is in another frame
            if (window !== window.top || document.querySelectorAll('iframe').length > 0) {
              isRunning = false;
              console.log('[JobAutoFill Robust Log] Frame has no direct fields, but found active iframes or is a subframe. Keeping overlay active.');
              if (window !== window.top && overlay) { 
                overlay.remove(); 
                overlay = null; 
              }
              return;
            }
            throw new Error('No form fields detected on this page.');
          } else {
            // Pass 2: No new fields appeared, we can stop early
            break;
          }
        }

        updateStatus(`Pass ${pass}: Found ${fields.length} new fields. Analyzing...`, pass === 1 ? 25 : 80);

        // Get job description and info
        const jobDescription = handler.getJobDescription?.() || '';
        const jobInfo = handler.getJobInfo?.() || {};

        console.log(`[JobAutoFill Robust Log] Pass ${pass}: Total fields found: ${fields.length}`);
        fields.forEach((f, idx) => {
          console.log(`  [Field #${idx + 1}] ID: "${f.id}", Label: "${f.label}", Type: "${f.fieldType}", Options: ${f.options ? `[${f.options.join(', ')}]` : 'None'}`);
        });

        // Separate fields by type
        const directFields = [];
        const aiFields = [];
        const fileFields = [];
        const coverLetterFields = [];

        fields.forEach(field => {
          const purpose = getFieldPurpose(field);
          console.log(`[JobAutoFill] Pass ${pass}: Field "${field.label}" (${field.fieldType}) → purpose: ${purpose}`, field.options ? `options: [${field.options.join(', ')}]` : '');

          if (purpose === 'resumeFile') {
            fileFields.push(field);
          } else if (purpose === 'coverLetter') {
            coverLetterFields.push(field);
          } else if (purpose === 'ai') {
            aiFields.push(field);
          } else {
            directFields.push({ ...field, purpose });
          }
        });

        // Dedup direct fields
        const groupedChoiceFields = [...directFields, ...aiFields].filter(isGroupedChoiceField);
        const groupedPurposes = new Set(groupedChoiceFields.map(f => f.purpose));
        const dedupedDirect = directFields.filter(f => {
          const coveredByGroupedField = groupedChoiceFields.find(group =>
            group !== f &&
            group.purpose === f.purpose &&
            group.allElements.some(el => el === f.element || (el.name && el.name === f.element?.name))
          );
          if (coveredByGroupedField || ((f.fieldType === 'radio' || f.fieldType === 'checkbox') && !f.allElements && groupedPurposes.has(f.purpose))) {
            return false;
          }
          return true;
        });
        const dedupedDirectUnique = dedupeDirectByLabelAndPurpose(dedupedDirect);
        directFields.length = 0;
        directFields.push(...dedupedDirectUnique);

        const dedupedAi = aiFields.filter(f => {
          if ((f.fieldType === 'radio' || f.fieldType === 'checkbox') && !f.allElements) {
            const parentGroup = groupedChoiceFields.find(g =>
              g.allElements.some(r => r === f.element || (r.name && r.name === f.element?.name))
            );
            if (parentGroup) return false;
          }
          return true;
        });



        if (directFields.length > 0) {
          updateStatus(`Pass ${pass}: Filling ${directFields.length} profile fields...`, pass === 1 ? 40 : 85);
        }

        // 6. Fill direct fields
        const fallbackPurposes = new Set([
          'pronouns', 'workAuthorizationStatus', 'relocation', 'officeAttendance', 'sponsorship', 'gender', 'ethnicity', 'disabilityStatus', 'veteranStatus'
        ]);
        const optionalPurposes = new Set([
          'facebookUrl', 'twitterUrl', 'githubUrl', 'portfolioUrl'
        ]);
        const fallbackAiFields = [];

        for (const field of directFields) {
          const resolved = resolveFieldElement(field);

          if (skipRequested) {
            skipRequested = false;
            console.log(`[JobAutoFill] Skipped direct field: ${resolved.label}`);
            allFailedFieldLabels.push(resolved.label + " (skipped)");
            const highlightTarget = FormFiller.getComboboxInteractTarget(resolved.element) || resolved.element;
            highlightTarget.style.outline = '2px solid #f97316';
            highlightTarget.style.outlineOffset = '2px';
            continue;
          }

          const value = getProfileValue(profileData.profile, resolved.purpose);
          if (value) {
            const success = await fillDetectedField(resolved, value);
            if (resolved.fieldType === 'aria-choice-group') await FormFiller.delay(120);
            const verification = verifyFilledField(resolved, value);
            const applied = success && verification.ok;

            const highlightTarget = FormFiller.getComboboxInteractTarget(resolved.element) || resolved.element;

            if (applied) {
              totalFilled++;
              highlightTarget.style.outline = '2px solid #34a853';
              highlightTarget.style.outlineOffset = '2px';
            } else {
              console.log(`[JobAutoFill] Pass ${pass}: Direct fill failed for "${resolved.label}" (value: ${value}). Falling back to AI...`);
              // Clear the incorrect value if possible
              if (resolved.element.tagName === 'SELECT') {
                resolved.element.selectedIndex = -1;
                resolved.element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
              }
              fallbackAiFields.push(resolved);
            }
            await FormFiller.delay(FormFiller.FILL_DELAY);
          } else {
            if (fallbackPurposes.has(resolved.purpose)) {
              fallbackAiFields.push(resolved);
            } else if (optionalPurposes.has(resolved.purpose)) {
              // Optional profile field: skip outlining in red if empty
            } else {
              const highlightTarget = FormFiller.getComboboxInteractTarget(resolved.element) || resolved.element;
              highlightTarget.style.outline = '2px solid #ea4335';
              highlightTarget.style.outlineOffset = '2px';
              allFailedFieldLabels.push(resolved.label); // Profile didn't have value
            }
          }
        }

        const aiQueue = [...dedupedAi, ...fallbackAiFields].filter((field, index, list) =>
          list.findIndex(candidate => candidate.id === field.id) === index
        );

        // Kick off custom Q&A and Cover Letter generation in parallel to prevent Manifest V3 message timeouts
        let aiAnswersPromise = Promise.resolve({});
        if (aiQueue.length > 0) {
          const aiFieldData = aiQueue.map(f => ({
            id: f.id,
            label: f.label,
            fieldType: f.fieldType,
            options: f.options || null
          }));
          aiAnswersPromise = chrome.runtime.sendMessage({
            type: 'FILL_FIELDS',
            payload: { fields: aiFieldData, jobDescription }
          }).then(res => {
            if (res?.error) throw new Error(res.error);
            return res?.answers || {};
          }).catch(err => {
            console.error('[JobAutoFill] Custom Q&A failed:', err);
            return {};
          });
        }

        let coverLetterPromise = Promise.resolve(null);
        if (coverLetterFields.length > 0) {
          updateStatus('Generating cover letter...', 90);
          coverLetterPromise = chrome.runtime.sendMessage({
            type: 'GENERATE_COVER_LETTER',
            payload: {
              jobDescription,
              companyName: jobInfo.company,
              roleTitle: jobInfo.title
            }
          }).then(res => res?.coverLetter || null).catch(err => {
            console.error('[JobAutoFill] Cover letter generation failed:', err);
            return null;
          });
        }

        // Wait for both parallel requests to complete
        const [aiAnswers, coverLetter] = await Promise.all([aiAnswersPromise, coverLetterPromise]);

        // 8. Fill custom questions / AI answers
        if (aiQueue.length > 0) {
          updateStatus(`Pass ${pass}: Filling AI answers...`, pass === 1 ? 70 : 95);

          for (const field of aiQueue) {
            const resolved = resolveFieldElement(field);

            if (skipRequested) {
              skipRequested = false;
              console.log(`[JobAutoFill] Skipped AI field: ${resolved.label}`);
              allFailedFieldLabels.push(resolved.label + " (skipped)");
              const highlightTarget = FormFiller.getComboboxInteractTarget(resolved.element) || resolved.element;
              highlightTarget.style.outline = '2px solid #f97316';
              highlightTarget.style.outlineOffset = '2px';
              continue;
            }

            const value = aiAnswers[resolved.id];
            const highlightTarget = FormFiller.getComboboxInteractTarget(resolved.element) || resolved.element;

            if (value) {
              const success = await fillDetectedField(resolved, value);
              if (resolved.fieldType === 'aria-choice-group') await FormFiller.delay(120);
              const verification = verifyFilledField(resolved, value);
              const applied = success && verification.ok;

              if (applied) {
                totalFilled++;
                highlightTarget.style.outline = '2px solid #34a853';
                highlightTarget.style.outlineOffset = '2px';
              } else {
                highlightTarget.style.outline = '2px solid #ea4335';
                highlightTarget.style.outlineOffset = '2px';
                allFailedFieldLabels.push(resolved.label);
              }
              await FormFiller.delay(FormFiller.FILL_DELAY);
            } else {
              highlightTarget.style.outline = '2px solid #ea4335';
              highlightTarget.style.outlineOffset = '2px';
              allFailedFieldLabels.push(resolved.label);
            }
          }
        }

        // 9. Attach / fill cover letter (Only on Pass 1 to prevent regeneration & overwrite loops)
        if (pass === 1 && coverLetterFields.length > 0 && coverLetter) {
          // Save cover letter text to the active clip in storage!
          try {
            const data = await chrome.storage.local.get({ clips: [], activeClipIdx: null });
            if (data.activeClipIdx !== null && data.clips[data.activeClipIdx]) {
              data.clips[data.activeClipIdx].coverLetterText = coverLetter;
              await chrome.storage.local.set({ clips: data.clips });
            }
          } catch (e) {
            console.error('[Clyde] Failed to save generated cover letter to active clip:', e);
          }

          const applicant = profileData.profile.fullName || 'Applicant';
          for (const field of coverLetterFields) {
            const resolved = resolveFieldElement(field);
            let success;
            if (resolved.fieldType === 'file') {
              const fileName = `${applicant.replace(/\s+/g, '_')}_Cover_Letter.pdf`;
              success = FormFiller.attachGeneratedTextAsPdf(
                resolved.element, coverLetter, fileName
              );
            } else {
              success = await FormFiller.fillField(resolved.element, coverLetter, resolved.fieldType);
            }

            const highlightTarget = FormFiller.getComboboxInteractTarget(resolved.element) || resolved.element;
            if (success) {
              totalFilled++;
              highlightTarget.style.outline = '2px solid #34a853';
            } else {
              allFailedFieldLabels.push(resolved.label);
            }
          }
          // Display the cover letter preview panel so the user can see what was generated & attached
          showCoverLetterPreview(coverLetter);
        }

        totalFieldsAttempted += fileFields.length + directFields.length + aiQueue.length + coverLetterFields.length;

        // If this was pass 1, wait half a second to let any cascading fields (like Race) appear
        if (pass === 1) {
          const saveButtons = querySelectorAllDeep('button, [role="button"], a.btn, .btn, sf-button')
            .filter(el => {
              const text = el.textContent.trim().toLowerCase();
              return text === 'save' || text === 'add and save';
            });

          if (saveButtons.length > 0) {
            console.log(`[JobAutoFill] Found ${saveButtons.length} "Save" button(s) at end of Pass 1. Clicking to save sections...`);
            for (const btn of saveButtons) {
              try {
                btn.click();
              } catch (e) { }
            }
            await FormFiller.delay(1000); // wait for save API requests and animations to settle!

            // Now click "+ Add" again to expand the next card for Pass 2!
            // Skip if handler manages its own card expansion via customFill
            if (!handler.customFill) {
              const addButtonsPass2 = querySelectorAllDeep('button, [role="button"], a.btn, .btn, sf-button, [class*="button"], [class*="btn"], .add-button')
                .filter(el => {
                  const text = el.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
                  if (text === '+ add' || text === 'add' || text === '+add' || text === 'add more' || text === 'add another') return true;
                  if (text.includes('add') && (text.includes('experience') || text.includes('education') || text.includes('job') || text.includes('work') || text.includes('school') || text.includes('history') || text.includes('degree') || text.includes('employer'))) return true;
                  return false;
                });

              if (addButtonsPass2.length > 0) {
                console.log(`[JobAutoFill] Clicking "+ Add" button(s) again to expand subsequent cards for Pass 2...`);
                for (const btn of addButtonsPass2) {
                  try {
                    btn.click();
                  } catch (e) { }
                }
                await FormFiller.delay(500); // wait for card to open
              }
            }
          }
          await FormFiller.delay(600);
        }
      }

      // Attach resume at the very end on ALL portals to avoid auto-parser race conditions
      let resumeFileEl = null;
      const allFiles = FormFiller.querySelectorAllDeep('input[type="file"]');
      if (allFiles.length > 0) {
        // Prioritize inputs that have resume/cv in their name or id or container
        resumeFileEl = allFiles.find(el => {
          const nameOrId = (el.id || el.name || '').toLowerCase();
          if (/\bresume\b|\bcv\b/.test(nameOrId)) return true;
          const container = el.closest('.field, .form-group, .form-field, [class*="group"], [class*="field"], [class*="question"]');
          if (container && /\bresume\b|\bcv\b/.test(container.textContent.toLowerCase())) return true;
          return false;
        });
        
        // Fallback: first file input that isn't cover letter
        if (!resumeFileEl) {
          resumeFileEl = allFiles.find(el => {
            const nameOrId = (el.id || el.name || '').toLowerCase();
            return !/\bcover_?letter\b/.test(nameOrId);
          });
        }
        
        // Final fallback: first file input
        if (!resumeFileEl) {
          resumeFileEl = allFiles[0];
        }
      }

      if (resumeFileEl) {
        updateStatus('Attaching resume...', 98);
        const resumeFile = await chrome.runtime.sendMessage({ type: 'GET_RESUME_FILE' });
        if (resumeFile) {
          if (resumeFile.generateFromText) {
             await FormFiller.attachGeneratedTextAsPdf(resumeFileEl, resumeFile.text, resumeFile.fileName);
          } else {
             await FormFiller.attachFile(resumeFileEl, resumeFile.data, resumeFile.fileName);
          }
          await FormFiller.delay(1000); // let upload commit
        }
      }

      showResult(totalFilled, allFailedFieldLabels, totalFieldsAttempted);

    } catch (e) {
      console.error('[JobAutoFill] Error:', e);
      showError(e.message);
    } finally {
      isRunning = false;
    }
  }

  // Listen for messages from popup — only from the extension itself
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Reject messages from other extensions or external senders
    if (sender.id !== chrome.runtime.id) return;

    if (message.type === 'START_AUTOFILL') {
      startAutoFill();
      sendResponse({ ok: true });
    } else if (message.type === 'TOGGLE_SIDEBAR') {
      toggleSidebar();
      sendResponse({ ok: true });
    } else if (message.type === 'EXTRACT_JD_FROM_PAGE') {
      let textToExtract = "";
      const handler = PortalHandlers.detect();
      if (handler && typeof handler.getJobDescription === 'function') {
        textToExtract = handler.getJobDescription() || "";
      }

      if (!textToExtract) {
        const clone = document.body.cloneNode(true);
        const stripTags = ['script', 'style', 'noscript', 'code', 'iframe', 'header', 'footer', 'nav'];
        for (const tag of stripTags) {
          clone.querySelectorAll(tag).forEach(el => el.remove());
        }

        textToExtract = clone.innerText || "";
        const selectors = [
          '.show-more-less-html__markup',
          '.jobs-box__html-content',
          '.jobs-description-content__text',
          '.jobs-description__content',
          '.jobs-search__job-details--container',
          '.jobs-description',
          '.job-description', 
          '#job-description',
          '[data-automation-id="jobPostingDescription"]',
          '[data-automation-id="job-posting-description"]'
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.innerText && el.innerText.trim().length > 200) {
            const elClone = el.cloneNode(true);
            for (const tag of stripTags) {
              elClone.querySelectorAll(tag).forEach(e => e.remove());
            }
            if (elClone.innerText && elClone.innerText.trim().length > 100) {
              textToExtract = elClone.innerText;
              break;
            }
          }
        }
      }
      sendResponse({ text: textToExtract });
    } else if (message.type === 'AUTOFILL_PROGRESS') {
      if (window === window.top) {
        updateStatus(message.text, message.progress);
      }
    } else if (message.type === 'AUTOFILL_DONE') {
      if (window === window.top) {
        showResult(message.filled, message.failedLabels || [], message.total);
      }
    } else if (message.type === 'AUTOFILL_ERROR') {
      if (window === window.top) {
        showError(message.message);
      }
    } else if (message.type === 'SHOW_COVER_LETTER_PREVIEW') {
      showCoverLetterPreview(message.coverLetter);
    }
    return true;
  });

  // Watch for multi-step form navigation (LinkedIn Easy Apply, Workday)
  const mutationObserver = new MutationObserver((mutations) => {
    if (isRunning) return;

    // Check if new form fields appeared
    let hasNewFields = false;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.querySelector?.('input, textarea, select, [contenteditable]') ||
            node.matches?.('input, textarea, select')) {
            hasNewFields = true;
            break;
          }
        }
      }
      if (hasNewFields) break;
    }

    // If new fields appeared on a job application page, show the FAB
    if (hasNewFields) {
      if (fab) {
        const fabBtn = document.getElementById('job-autofill-fab-btn');
        if (fabBtn) {
          fabBtn.style.background = '#fbbc04';
          setTimeout(() => { fabBtn.style.background = '#1a73e8'; }, 2000);
        }
      }
      if (overlay) {
        showReadyState();
      }
    }
  });

  // Initialize: show FAB if this looks like a job application page
  async function init() {
    const url = window.location.href;

    // Always start LinkedIn button injection poller on linkedin.com
    if (url.includes('linkedin.com')) {
      linkedinInterval = setInterval(injectLinkedInExtractButton, 1000);
    }

    const isJobSite = /ashbyhq\.com|greenhouse\.io|lever\.co|myworkdayjobs\.com|workday\.com|linkedin\.com\/jobs|icims\.com|taleo\.net|careers|jobs|apply|application/i.test(url);

    if (isJobSite) {
      try {
        const settings = await chrome.storage.local.get(['badgeDisabledGlobally', 'disabledDomains']);
        const isGloballyDisabled = settings.badgeDisabledGlobally || false;
        const disabledDomains = settings.disabledDomains || [];
        const currentDomain = window.location.hostname;

        if (!isGloballyDisabled && !disabledDomains.includes(currentDomain)) {
          createFAB();
          mutationObserver.observe(document.body, { childList: true, subtree: true });
        } else {
          console.log('[Clyde] FAB is disabled on this page/domain via user settings.');
        }
      } catch (err) {
        console.log('[Clyde] Extension context invalidated during init config load.');
        return;
      }
    }

    // Monitor URL changes on Single Page Applications (SPAs) like LinkedIn
    let lastUrl = url;
    spaInterval = setInterval(async () => {
       // Gracefully exit and clear interval if context has been invalidated
      if (!isContextValid()) {
        if (spaInterval) {
          clearInterval(spaInterval);
          spaInterval = null;
        }
        return;
      }
      
      const currentUrl = window.location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        
        // Re-evaluate FAB showing
        const isJob = /ashbyhq\.com|greenhouse\.io|lever\.co|myworkdayjobs\.com|workday\.com|linkedin\.com\/jobs|icims\.com|taleo\.net|careers|jobs|apply|application/i.test(currentUrl);
        if (isJob) {
          try {
            const settings = await chrome.storage.local.get(['badgeDisabledGlobally', 'disabledDomains']);
            const isGloballyDisabled = settings.badgeDisabledGlobally || false;
            const disabledDomains = settings.disabledDomains || [];
            const currentDomain = window.location.hostname;

            if (!isGloballyDisabled && !disabledDomains.includes(currentDomain)) {
              if (!fab) createFAB();
              mutationObserver.disconnect();
              mutationObserver.observe(document.body, { childList: true, subtree: true });
            } else {
              if (fab) { fab.remove(); fab = null; }
            }
          } catch (err) {
            console.log('[Clyde] Extension context invalidated inside SPA poller.');
            if (spaInterval) {
              clearInterval(spaInterval);
              spaInterval = null;
            }
          }
        } else {
          if (fab) { fab.remove(); fab = null; }
        }
      }
    }, 1000);
  }

  function injectLinkedInExtractButton() {
    // Gracefully exit and clear interval if context has been invalidated
    if (!isContextValid()) {
      if (linkedinInterval) {
        clearInterval(linkedinInterval);
        linkedinInterval = null;
      }
      return;
    }

    // Look for all "Save" or "Apply" buttons on the page (supports list view and single job view)
    const saveBtns = document.querySelectorAll('.jobs-save-button, .jobs-apply-button, button.jobs-easy-apply-button, button[class*="jobs-save"], button[class*="jobs-apply"]');
    if (!saveBtns || saveBtns.length === 0) return;

    let targetSaveBtn = null;
    for (const btnEl of saveBtns) {
      // Find the visible save button (skips hidden sticky header ones)
      if (btnEl.offsetWidth > 0 || btnEl.offsetHeight > 0) {
        targetSaveBtn = btnEl;
        break;
      }
    }

    if (!targetSaveBtn) return;

    // The parent container of the Apply/Save buttons
    const container = targetSaveBtn.parentElement;
    if (!container) return;

    let btn = container.querySelector('#clyde-go-inline-extract-btn');
    if (!btn) {
      const existing = document.getElementById('clyde-go-inline-extract-btn');
      if (existing) existing.remove();

      btn = document.createElement('button');
      btn.id = 'clyde-go-inline-extract-btn';
      btn.style.cssText = `
        background: transparent;
        border: none;
        padding: 0;
        cursor: pointer;
        margin-left: 8px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 40px;
        box-shadow: none;
        transition: opacity 0.2s;
        box-sizing: border-box;
      `;

      const svgUrl = chrome.runtime.getURL("icons/clyde_apply.svg");
      const buttonSvgHtml = `<img src="${svgUrl}" alt="Clyde" style="height: 40px !important; width: auto !important; display: inline-block !important; vertical-align: middle !important; pointer-events: none !important; border: none !important; margin: 0 !important; padding: 0 !important; filter: none !important;">`;
      btn.innerHTML = buttonSvgHtml;

      btn.addEventListener('mouseenter', () => btn.style.opacity = '0.88');
      btn.addEventListener('mouseleave', () => btn.style.opacity = '1');

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (btn.disabled || btn.getAttribute('data-state') === 'extracted') return;

        btn.style.background = '#1e293b';
        btn.style.padding = '0 20px';
        btn.style.borderRadius = '24px';
        btn.innerHTML = `<span style="font-size: 14px !important; font-weight: 700 !important; font-family: system-ui, -apple-system, sans-serif !important; color: #ffffff !important; vertical-align: middle !important;">Extracting...</span>`;
        btn.setAttribute('data-state', 'extracting');
        btn.disabled = true;

        // Open the sidebar cockpit if it's not already visible
        if (!sidebarIframe || sidebarIframe.style.display === 'none') {
          toggleSidebar();
        }

        let textToExtract = document.body.innerText;
        const selectors = [
          '.jobs-description__content',
          '.jobs-search__job-details--container',
          '.job-description',
          '#job-description'
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.innerText && el.innerText.trim().length > 200) {
            textToExtract = el.innerText;
            break;
          }
        }

        try {
          chrome.runtime.sendMessage({
            action: "extract-page-from-content",
            text: textToExtract,
            url: window.location.href
          }, (res) => {
            if (chrome.runtime.lastError || res?.error) {
              btn.style.background = '#991b1b';
              btn.style.padding = '0 20px';
              btn.style.borderRadius = '24px';
              btn.innerHTML = `<span style="font-size: 14px !important; font-weight: 700 !important; font-family: system-ui, -apple-system, sans-serif !important; color: #ffffff !important; vertical-align: middle !important;">Error!</span>`;
              btn.setAttribute('data-state', 'error');
              setTimeout(() => { updateButtonState(btn); btn.disabled = false; }, 2000);
            } else {
              btn.style.background = 'transparent';
              btn.style.padding = '0';
              btn.innerHTML = buttonSvgHtml + ` <span style="font-size: 16px !important; font-weight: bold !important; color: #10b981 !important; margin-left: 6px !important; vertical-align: middle !important;">\u2713</span>`;
              btn.setAttribute('data-state', 'extracted');
              btn.style.opacity = '0.5';
              btn.style.cursor = 'default';
            }
          });
        } catch (e) {
          btn.style.background = '#991b1b';
          btn.style.padding = '0 20px';
          btn.style.borderRadius = '24px';
          btn.innerHTML = `<span style="font-size: 14px !important; font-weight: 700 !important; font-family: system-ui, -apple-system, sans-serif !important; color: #ffffff !important; vertical-align: middle !important;">Error!</span>`;
          btn.setAttribute('data-state', 'error');
          setTimeout(() => { updateButtonState(btn); btn.disabled = false; }, 2000);
        }
      });

      container.appendChild(btn);
    }

    // Always update state if it's not currently extracting
    if (btn.getAttribute('data-state') !== 'extracting') {
      updateButtonState(btn);
    }
  }

  function showCoverLetterPreview(coverLetterText) {
    const existing = document.getElementById('clyde-cover-letter-preview-panel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'clyde-cover-letter-preview-panel';
    panel.style.position = 'fixed';
    panel.style.bottom = '20px';
    panel.style.right = '20px';
    panel.style.width = '380px';
    panel.style.maxHeight = '500px';
    panel.style.backgroundColor = 'rgba(15, 23, 42, 0.75)';
    panel.style.backdropFilter = 'blur(12px)';
    panel.style.webkitBackdropFilter = 'blur(12px)';
    panel.style.border = '1px solid rgba(255, 255, 255, 0.1)';
    panel.style.borderRadius = '12px';
    panel.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.4)';
    panel.style.zIndex = '999999';
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    panel.style.fontFamily = 'Inter, system-ui, -apple-system, sans-serif';
    panel.style.overflow = 'hidden';

    panel.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background-color: rgba(30, 41, 59, 0.5); color: #ffffff; border-bottom: 1px solid rgba(255, 255, 255, 0.05);">
        <span style="font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 6px; color: #38bdf8;">
          <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
            <path d="M14 1a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h12zM2 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2H2z"/>
            <path d="M4 4h8v1H4V4zm0 2h8v1H4V6zm0 2h8v1H4V8zm0 2h4v1H4v-1z"/>
          </svg>
          Tailored Cover Letter
        </span>
        <button id="clyde-cl-close-btn" style="background: none; border: none; color: #94a3b8; cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center; transition: color 0.2s; line-height: 1;">
          ✕
        </button>
      </div>
      <div style="padding: 16px; display: flex; flex-direction: column; gap: 12px;">
        <textarea id="clyde-cl-textarea" style="width: 100%; height: 280px; padding: 12px; background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; font-size: 13px; line-height: 1.5; color: #f1f5f9; resize: none; font-family: inherit; outline: none; box-sizing: border-box; backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);">${escapeHtml(coverLetterText)}</textarea>
        <div style="display: flex; gap: 8px; justify-content: flex-end; align-items: center;">
          <button id="clyde-cl-copy-btn" style="padding: 6px 14px; background-color: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; font-size: 12px; font-weight: 600; color: #cbd5e1; cursor: pointer; transition: background 0.2s, color 0.2s;">
            Copy
          </button>
          <span style="font-size: 12px; font-weight: 600; color: #4ade80; display: flex; align-items: center; gap: 4px;">
            ✓ Tailored and Attached
          </span>
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    const closeBtn = document.getElementById('clyde-cl-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => panel.remove());
    }

    const copyBtn = document.getElementById('clyde-cl-copy-btn');
    const textarea = document.getElementById('clyde-cl-textarea');
    if (copyBtn && textarea) {
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(textarea.value);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => copyBtn.textContent = 'Copy', 2000);
      });
    }
  }

  function getJobIdFromUrl(url) {
    const match = url.match(/currentJobId=([0-9]+)/) || url.match(/\/jobs\/view\/([0-9]+)/);
    return match ? match[1] : null;
  }

  function updateButtonState(btn) {
    if (!isContextValid() || !chrome.storage || !chrome.storage.local) return;

    try {
      chrome.storage.local.get({ clips: [] }, (data) => {
        if (chrome.runtime.lastError) return; // fail silently if context invalidated during async call

        const currentUrl = window.location.href;
        const currentJobId = getJobIdFromUrl(currentUrl);

        const isExtracted = data.clips.some(clip => {
          if (!clip.url) return false;
          const clipJobId = getJobIdFromUrl(clip.url);
          return (clipJobId && clipJobId === currentJobId) || (clip.url === currentUrl);
        });

        const svgUrl = chrome.runtime.getURL("icons/clyde_apply.svg");
        const buttonSvgHtml = `<img src="${svgUrl}" alt="Clyde" style="height: 40px !important; width: auto !important; display: inline-block !important; vertical-align: middle !important; pointer-events: none !important; border: none !important; margin: 0 !important; padding: 0 !important; filter: none !important;">`;

        if (isExtracted) {
          btn.style.background = 'transparent';
          btn.style.padding = '0';
          btn.innerHTML = buttonSvgHtml + ` <span style="font-size: 16px !important; font-weight: bold !important; color: #10b981 !important; margin-left: 6px !important; vertical-align: middle !important;">\u2713</span>`;
          btn.setAttribute('data-state', 'extracted');
          btn.style.opacity = '0.5';
          btn.style.cursor = 'default';
          btn.disabled = true; // prevent re-clicking while extracted
          btn.onmouseenter = null;
          btn.onmouseleave = null;
        } else {
          btn.style.background = 'transparent';
          btn.style.padding = '0';
          btn.innerHTML = buttonSvgHtml;
          btn.setAttribute('data-state', 'idle');
          btn.style.opacity = '1';
          btn.style.cursor = 'pointer';
          btn.disabled = false;
          btn.onmouseenter = () => btn.style.opacity = '0.88';
          btn.onmouseleave = () => btn.style.opacity = '1';
        }
      });
    } catch (e) {
      // Ignore extension context invalidated errors to prevent console spam
      if (e.message && e.message.includes('Extension context invalidated')) return;
      console.warn('Clyde: Error accessing storage:', e);
    }
  }

  // Listen for storage changes so the button updates if a clip is deleted in the popup
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    try {
      chrome.storage.onChanged.addListener((changes, namespace) => {
        if (!isContextValid()) return;

        if (namespace === 'local' && changes.clips) {
          const btn = document.getElementById('clyde-go-inline-extract-btn');
          if (btn) updateButtonState(btn);
        }
      });
    } catch (e) {
      // Ignore errors related to context invalidation
    }
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
