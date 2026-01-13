// Configuration
const MOCKUP_SERVER_URL = 'http://localhost:3001';

// Listen for extension icon click
chrome.action.onClicked.addListener(async (tab) => {
  try {
    // Execute script to find first image on the page
    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // Find first image on the page
        const images = document.querySelectorAll('img');

        for (const img of images) {
          // Skip very small images (icons, etc.)
          if (img.naturalWidth > 100 && img.naturalHeight > 100) {
            return {
              imageUrl: img.src,
              alt: img.alt || ''
            };
          }
        }

        return null;
      }
    });

    const imageData = result[0]?.result;

    // Store image data
    await chrome.storage.local.set({
      publishImage: imageData?.imageUrl || null,
      publishPrompt: imageData?.alt || '',
      publishAspectRatio: null
    });

    // Open publish page in new tab
    await chrome.tabs.create({
      url: chrome.runtime.getURL('publish.html')
    });

  } catch (error) {
    console.error('Error opening publish page:', error);
  }
});

// Listen for messages from publish page
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getCategories') {
    console.log('[Background] Fetching categories from server...');
    // Fetch categories from UXP server
    fetch(`${MOCKUP_SERVER_URL}/categories`)
      .then(response => response.json())
      .then(data => {
        console.log('[Background] Categories fetched successfully:', data);
        sendResponse({ success: true, data: data });
      })
      .catch(error => {
        console.error('[Background] Error fetching categories:', error);
        sendResponse({ success: false, error: error.message });
      });

    // Return true to indicate we'll respond asynchronously
    return true;
  }

  if (request.action === 'submitJob') {
    console.log('[Background] Submitting job to server:', request.data);
    // Submit job to server
    fetch(`${MOCKUP_SERVER_URL}/submit-job`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(request.data)
    })
      .then(response => {
        console.log('[Background] Server response status:', response.status);
        return response.json();
      })
      .then(data => {
        console.log('[Background] Job response:', data);
        sendResponse({ success: true, data: data });
      })
      .catch(error => {
        console.error('[Background] Error submitting job:', error);
        sendResponse({ success: false, error: error.message });
      });

    // Return true to indicate we'll respond asynchronously
    return true;
  }

  if (request.action === 'deleteFile') {
    console.log('[Background] Deleting file from server:', request.filename);
    // Delete file from server
    fetch(`${MOCKUP_SERVER_URL}/delete-mockup/${request.filename}`, {
      method: 'DELETE'
    })
      .then(response => {
        console.log('[Background] Delete response status:', response.status);
        return response.json();
      })
      .then(data => {
        console.log('[Background] Delete response:', data);
        sendResponse({ success: true, data: data });
      })
      .catch(error => {
        console.error('[Background] Error deleting file:', error);
        sendResponse({ success: false, error: error.message });
      });

    // Return true to indicate we'll respond asynchronously
    return true;
  }
});
