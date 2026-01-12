// Configuration
const CONFIG = {
  API_URL: 'https://backend.myselfmonart.com/api/midjourney/publish',
  MOCKUP_SERVER_URL: 'http://localhost:3001'
};

// Get elements
const imageContainer = document.getElementById('imageContainer');
const altTextInput = document.getElementById('alt-text');
const categorySelect = document.getElementById('category');
const publishBtn = document.getElementById('publish-btn');

// Initialize page
async function init() {
  // Get image data from storage
  const result = await chrome.storage.local.get(['publishImage', 'publishPrompt', 'publishAspectRatio']);

  if (result.publishImage) {
    displayImage(result.publishImage);
  } else {
    showNoImage();
  }

  // Load categories
  await loadCategories();
}

/**
 * Display the image
 */
function displayImage(imageUrl) {
  imageContainer.innerHTML = `
    <img src="${imageUrl}" alt="Image à publier" class="image-preview">
  `;
}

/**
 * Show no image placeholder
 */
function showNoImage() {
  imageContainer.innerHTML = `
    <div class="no-image">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      <p>Aucune image trouvée sur la page</p>
    </div>
  `;
}

/**
 * Load categories from UXP server via background script
 */
async function loadCategories() {
  try {
    // Ask background script to fetch categories
    const response = await chrome.runtime.sendMessage({ action: 'getCategories' });

    if (response.success && response.data.success && response.data.categories && response.data.categories.length > 0) {
      populateCategories(response.data.categories);
    } else {
      showCategoryError('Aucune catégorie trouvée');
    }
  } catch (error) {
    console.error('Error loading categories:', error);
    showCategoryError('Erreur: Le serveur UXP est-il démarré ?');
  }
}

/**
 * Populate category dropdown
 */
function populateCategories(categories) {
  categorySelect.innerHTML = '<option value="" disabled selected>-- Sélectionner une catégorie --</option>';

  categories.forEach(category => {
    if (category.subcategories && category.subcategories.length > 0) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = category.name;

      category.subcategories.forEach(subcategory => {
        const option = document.createElement('option');
        option.value = `${category.name}/${subcategory}`;
        option.textContent = subcategory;
        optgroup.appendChild(option);
      });

      categorySelect.appendChild(optgroup);
    }
  });
}

/**
 * Show category loading error
 */
function showCategoryError(message) {
  categorySelect.innerHTML = `<option value="" disabled selected>${message}</option>`;
}

/**
 * Handle publish button click
 */
publishBtn.addEventListener('click', async () => {
  const altText = altTextInput.value.trim();
  const category = categorySelect.value;

  if (!category) {
    alert('Veuillez sélectionner une catégorie');
    return;
  }

  if (!altText) {
    alert('Veuillez entrer un texte alternatif');
    return;
  }

  // Get stored data
  const result = await chrome.storage.local.get(['publishImage', 'publishPrompt', 'publishAspectRatio']);

  console.log('Publishing:', {
    imageUrl: result.publishImage,
    altText: altText,
    category: category,
    prompt: result.publishPrompt,
    aspectRatio: result.publishAspectRatio
  });

  // TODO: Send to backend
  alert('Fonctionnalité de publication en cours de développement\n\nDonnées:\n- Catégorie: ' + category + '\n- Alt text: ' + altText);

  // For now, just close the tab
  // window.close();
});

// Initialize on load
init();
