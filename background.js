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

// Listen for messages from publish page to fetch categories
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getCategories') {
    // Fetch categories from UXP server
    fetch(`${MOCKUP_SERVER_URL}/categories`)
      .then(response => response.json())
      .then(data => {
        sendResponse({ success: true, data: data });
      })
      .catch(error => {
        console.error('Error fetching categories:', error);
        sendResponse({ success: false, error: error.message });
      });

    // Return true to indicate we'll respond asynchronously
    return true;
  }
});
