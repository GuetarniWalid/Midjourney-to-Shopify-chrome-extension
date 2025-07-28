chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action !== 'openTab') {
    return; // Let other messages be handled elsewhere
  }

  // --- Configurable parameters via request.* if needed ---
  const masterTimeoutMs = request.timeoutMs || 30000; // Total timeout to avoid keeping tab open indefinitely
  const extractTimeoutMs = request.extractTimeoutMs || 20000; // Maximum wait time in page for image to appear

  let replied = false; // Ensure we only respond once
  let createdTabId = null; // ID of the tab we create

  // Safe response (unique) + cleanup of global timeout
  function safeRespond(success, payload) {
    if (replied) return;
    replied = true;
    clearTimeout(masterTimer);
    try {
      if (success) {
        sendResponse({ success: true, data: payload });
      } else {
        const msg = typeof payload === 'string' ? payload : payload?.message || 'Unknown error';
        sendResponse({ success: false, error: msg });
      }
    } catch (e) {
      // no-op
    }
  }

  // Cleanup: remove listener and close tab
  function cleanup() {
    try {
      chrome.tabs.onUpdated.removeListener(onUpdated);
    } catch {}
    if (createdTabId != null) {
      try {
        chrome.tabs.remove(createdTabId);
      } catch {}
    }
  }

  // Global timeout to avoid keeping service worker open indefinitely
  const masterTimer = setTimeout(() => {
    if (replied) return;
    cleanup();
    safeRespond(false, 'Timeout while waiting for page/image');
  }, masterTimeoutMs);

  // Main handler: triggered on each "complete" or URL change
  function onUpdated(tabId, changeInfo, tab) {
    if (tabId !== createdTabId) return;

    // Trigger on "complete" or when URL changes (useful for SPA/redirect)
    const shouldTry = changeInfo.status === 'complete' || typeof changeInfo.url === 'string';

    if (!shouldTry) return;

    // Sometimes tab.url here is stale → get current state
    chrome.tabs.get(createdTabId, current => {
      if (chrome.runtime.lastError || !current) return;
      tryExtract(current);
    });
  }

  // Try to extract (called after complete / URL change)
  function tryExtract(currentTab) {
    if (replied) return;

    const url = currentTab?.url || '';
    // Avoid targeting auth/intermediate pages
    const isMidjourney = /https?:\/\/([^/]+\.)?midjourney\.com/i.test(url);
    if (!isMidjourney) {
      // Wait for next onUpdated event (e.g., post-login redirect)
      return;
    }

    chrome.scripting.executeScript(
      {
                 target: { tabId: createdTabId /* , allFrames: true if image is rendered in a same-domain iframe */ },
        func: waitAndExtractImageData,
        args: [{ timeout: extractTimeoutMs }],
                 world: 'ISOLATED', // default value; switch to 'MAIN' if need to access page context
      },
      async results => {
        if (replied) return;

        if (chrome.runtime.lastError) {
          // Page might not be ready; wait for next event
          console.debug('[bg] executeScript error:', chrome.runtime.lastError.message);
          return;
        }

        const res = results && results[0] && results[0].result;
        if (!res) {
          // Extraction not ready → keep listener for next attempt
          return;
        }

        // Success: remove listener, close tab after fetch, then respond
        chrome.tabs.onUpdated.removeListener(onUpdated);

        try {
          const { imageUrl, prompt, aspectRatio } = res;
          const imageBuffer = await fetchImageAsBuffer(imageUrl);
          const base64Image = arrayBufferToBase64(imageBuffer);

          cleanup(); // close the tab
          safeRespond(true, { base64Image, prompt, aspectRatio });
        } catch (e) {
          cleanup();
          safeRespond(false, e);
        }
      }
    );
  }

  // Create tab + attach listener
  chrome.tabs.create({ url: request.url, active: false }, tab => {
    if (chrome.runtime.lastError || !tab) {
      safeRespond(false, 'Failed to create tab: ' + (chrome.runtime.lastError?.message || 'unknown'));
      return;
    }
    createdTabId = tab.id;
    chrome.tabs.onUpdated.addListener(onUpdated);
    // Try once in case page is already ready very quickly
    chrome.tabs.get(createdTabId, current => {
      if (chrome.runtime.lastError || !current) return;
      tryExtract(current);
    });
  });

  // IMPORTANT: keep the asynchronous response channel open
  return true;
});

/**
 * Function injected into the page: waits for a "real" image to appear
 * and returns { imageUrl, prompt, aspectRatio }.
 * Uses MutationObserver + timeout.
 */
function waitAndExtractImageData({ timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;

         const pick = () => {
       // Avoid spinners/small logos: take a sufficiently large image
       const imgs = Array.from(document.images).filter(i => i.src && i.naturalWidth >= 256 && i.naturalHeight >= 256);

       if (imgs.length) {
         const img = imgs[0];
         const imageUrl = img.currentSrc || img.src;

         // Prompt: same logic as your code, with fallback if too short
         let prompt = '';
         const pCandidates = Array.from(document.querySelectorAll('p')).filter(p => !p.classList.contains('relative'));
         if (pCandidates.length) {
           prompt = (pCandidates[0].textContent || '').trim();
         }
         if (!prompt || prompt.length < 10) {
           const alt = (img.getAttribute('alt') || '').trim();
           if (alt.length >= 10) prompt = alt;
         }

         // Aspect ratio: same logic as your code
         const buttons = document.querySelectorAll('button[title]');
         const aspectRatioButton = Array.from(buttons).find(b => (b.title || '').toLowerCase().includes('ratio'));
         const aspectRatioElem = aspectRatioButton?.querySelector('span');
         const aspectRatioString = aspectRatioElem?.textContent || '';
         const aspectRatio = aspectRatioString.split(' ')[1] || null;

        resolve({ imageUrl, prompt, aspectRatio });
        return true;
      }
      return false;
    };

    if (pick()) return;

    const mo = new MutationObserver(() => {
      if (pick()) {
        try {
          mo.disconnect();
        } catch {}
      }
    });
    mo.observe(document, { childList: true, subtree: true, attributes: true });

    const timer = setInterval(() => {
      if (Date.now() > deadline) {
        try {
          mo.disconnect();
        } catch {}
        clearInterval(timer);
        reject(new Error('Timeout waiting for image'));
      }
    }, 250);
  });
}

/**
 * Fetches an image and returns it as an ArrayBuffer.
 */
async function fetchImageAsBuffer(imageUrl) {
  const response = await fetch(imageUrl, { credentials: 'omit' });
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
  }
  return await response.arrayBuffer();
}

/**
 * Converts an ArrayBuffer to base64.
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
     const chunkSize = 0x8000; // avoid strings that are too long at once
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}
