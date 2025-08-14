/**
 * Handles the logo click event.
 * @param {HTMLElement} card
 */
window.handleLogoClick = card => {
  const loader = window.addLoader(card);
  const imageUrl = window.getLinkToBigSizeImage(card);
  console.log('🚀 ~ imageUrl:', imageUrl)

  // Extract additional data from the page
  const { prompt, aspectRatio } = extractPageData();

  // Fetch image and convert to base64, then send to server
  fetchImageAndSendToServer(imageUrl, card, loader, { prompt, aspectRatio });
};

/**
 * Extracts prompt and aspect ratio from the current page
 * @returns {Object} - Object containing prompt and aspectRatio
 */
function extractPageData() {
  // Extract prompt
  let prompt = '';
  const pCandidates = Array.from(document.querySelectorAll('p')).filter(p => !p.classList.contains('relative'));
  if (pCandidates.length) {
    prompt = (pCandidates[0].textContent || '').trim();
  }
  
  // Fallback to image alt text if prompt is too short
  if (!prompt || prompt.length < 10) {
    const images = document.querySelectorAll('img');
    for (const img of images) {
      const alt = (img.getAttribute('alt') || '').trim();
      if (alt.length >= 10) {
        prompt = alt;
        break;
      }
    }
  }

  // Extract aspect ratio
  let aspectRatio = null;
  const versionButton = document.querySelector('button[title="Version"]');
  const aspectRatioButton = versionButton.previousElementSibling;
  if (aspectRatioButton) {
    const aspectRatioElem = aspectRatioButton.querySelector('span');
    const aspectRatioString = aspectRatioElem?.textContent || '';
    aspectRatio = aspectRatioString.split(' ')[1] || null;
  }

  return { prompt, aspectRatio };
}

/**
 * Fetches image, converts to base64, and sends to server
 * @param {string} imageUrl - Direct URL to the Midjourney image
 * @param {HTMLElement} card - The card element
 * @param {HTMLElement} loader - The loader element
 * @param {Object} pageData - Additional data from the page (prompt, aspectRatio)
 */
async function fetchImageAndSendToServer(imageUrl, card, loader, pageData) {
  try {
    // Fetch the image
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }
    
    // Convert to base64
    const blob = await response.blob();
    const base64Image = await blobToBase64(blob);
    
    // Send to your server
    const serverResponse = await fetch(window.CONFIG.API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        base64Image,
        prompt: pageData.prompt,
        aspectRatio: pageData.aspectRatio,
        // Add any other data you need
      }),
    });
    
    const result = await serverResponse.json();
    console.log('Success:', result);
    
    if (result?.success) {
      window.addSuccessMessage(card, 'Fiche créée avec succès');
    } else {
      window.addErrorMessage(card, result?.message || 'Une erreur est survenue');
    }
    
  } catch (error) {
    console.error('Error:', error);
    window.addErrorMessage(card, 'Erreur lors du traitement de l\'image');
  } finally {
    window.removeLoader(loader);
  }
}

/**
 * Converts a blob to base64
 * @param {Blob} blob - The blob to convert
 * @returns {Promise<string>} - Base64 string
 */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]); // Remove data:image/...;base64, prefix
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

