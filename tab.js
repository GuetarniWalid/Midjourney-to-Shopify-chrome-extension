/**
 * Opens a link in a new background tab and handles the data extraction
 * @param {string} link - The URL to open
 */
window.openTab = (link, callback) => {
  if (!link) {
    console.error('No link provided to open tab');
    return;
  }

  chrome.runtime.sendMessage(
    {
      action: 'openTab',
      url: link,
    },
    response => {
      console.log('🚀 ~ response:', response)
      if (chrome.runtime.lastError) {
        console.error('Error opening tab:', chrome.runtime.lastError);
        return;
      }
      if (callback) callback(response.data);
    }
  );
};
