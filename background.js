// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'openTab') {
    chrome.tabs.create(
      {
        url: request.url,
        active: false,
      },
      tab => {
        // Listen for the tab to complete loading
        chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
          if (tabId === tab.id && info.status === 'complete') {
            // Remove the listener once we're done with it
            chrome.tabs.onUpdated.removeListener(listener);

            // Execute script in the new tab to get the image data
            chrome.scripting.executeScript(
              {
                target: { tabId: tab.id },
                function: extractImageData,
              },
              results => {
                if (results && results[0]) {
                  chrome.tabs.remove(tab.id);
                  sendResponse({ success: true, data: results[0].result });
                }
              }
            );
          }
        });
      }
    );
    // Return true to indicate we will send a response asynchronously
    return true;
  }
});

/**
 * Extracts the image data from the opened page
 * @returns {Object} The image data { imageUrl, prompt }
 */
function extractImageData() {
  const imageUrl = extractBigImageUrl();
  const prompt = extractImagePrompt();
  const aspectRatio = extractImageAspectRatio();
  return { imageUrl, prompt, aspectRatio };

  /**
   * Extracts the big image url from the opened page
   * @returns {string} The big image url
   */
  function extractBigImageUrl() {
    const imageElement = document.querySelector('img + img[draggable=true]');
    const imageUrl = imageElement.src;
    if (!imageElement) throw new Error('Image element not found');

    return imageUrl;
  }

  /**
   * Extracts the prompt from the opened page
   * @returns {string} The image prompt
   */
  function extractImagePrompt() {
    const promptElement = document.querySelector('p:not(.relative)');
    if (!promptElement) throw new Error('Prompt element not found');

    const prompt = promptElement.textContent;
    const promptSize = prompt.length;
    if (promptSize < 10) throw new Error('Prompt is too short');

    return prompt;
  }

    /**
   * Extracts the prompt from the opened page
   * @returns {string} The image prompt
   */
    function extractImageAspectRatio() {
        const buttons = document.querySelectorAll('button[title]')
        const aspectRatioButton = Array.from(buttons).find(button => button.title.includes('ratio'))
        const aspectRatioElem = aspectRatioButton?.querySelector('span')
        const aspectRatioString = aspectRatioElem?.textContent
        const aspectRatio = aspectRatioString?.split(' ')[1]
        return aspectRatio
      }
}
