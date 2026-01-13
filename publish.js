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
const ratioBadge = document.getElementById('ratioBadge');
const ratioText = document.getElementById('ratioText');
const productTypeSlider = document.getElementById('productTypeSlider');
const productTypeRadios = document.querySelectorAll('input[name="productType"]');
const mockupSelectorBtn = document.getElementById('mockupSelectorBtn');
const mockupModal = document.getElementById('mockupModal');
const mockupModalClose = document.getElementById('mockupModalClose');
const mockupCategoriesContainer = document.getElementById('mockupCategoriesContainer');

// State
let selectedMockup = null;
let categoriesData = [];
let currentLayout = 'square'; // Default layout: portrait, landscape, or square
let isProcessing = false;
let resultImageUrls = []; // Array to store multiple generated mockups

// Initialize page
async function init() {
  console.log('[Init] Initializing publish page...');

  // Get image data from storage
  const result = await chrome.storage.local.get(['publishImage', 'publishPrompt', 'publishAspectRatio']);
  console.log('[Init] Retrieved from storage:', result);

  if (result.publishImage) {
    console.log('[Init] Displaying image:', result.publishImage);
    displayImage(result.publishImage);
  } else {
    console.warn('[Init] No image found');
    showNoImage();
  }

  // Load categories
  console.log('[Init] Loading categories...');
  await loadCategories();

  // Initialize product type slider
  console.log('[Init] Initializing product type slider...');
  initProductTypeSlider();

  // Initialize mockup selector
  console.log('[Init] Initializing mockup selector...');
  initMockupSelector();

  console.log('[Init] Initialization complete');
}

/**
 * Display the image
 */
function displayImage(imageUrl) {
  imageContainer.innerHTML = `
    <img src="${imageUrl}" alt="Image à publier" class="image-preview" id="previewImage">
  `;

  // Wait for image to load, then calculate ratio
  const img = document.getElementById('previewImage');
  img.addEventListener('load', () => {
    updateAspectRatioBadge(img.naturalWidth, img.naturalHeight);
  });
}

/**
 * Update aspect ratio badge based on image dimensions
 */
function updateAspectRatioBadge(width, height) {
  const ratio = width / height;

  // Determine orientation
  let orientation, label, layout;

  if (ratio >= 0.95 && ratio <= 1.05) {
    // Square (within 5% tolerance)
    orientation = 'carre';
    label = 'Carré';
    layout = 'square';
  } else if (ratio < 0.95) {
    // Portrait (taller than wide)
    orientation = 'portrait';
    label = 'Portrait';
    layout = 'portrait';
  } else {
    // Landscape (wider than tall)
    orientation = 'paysage';
    label = 'Paysage';
    layout = 'landscape';
  }

  // Store current layout
  currentLayout = layout;

  // Update badge
  ratioBadge.className = `ratio-badge ${orientation}`;
  ratioText.textContent = label;
  ratioBadge.style.display = 'inline-block';

  console.log(`Image ratio: ${width}x${height} (${ratio.toFixed(2)}) → ${label} (layout: ${layout})`);
}

/**
 * Initialize product type slider
 */
function initProductTypeSlider() {
  // Set initial slider position
  updateProductTypeSlider();

  // Add event listeners to radio buttons
  productTypeRadios.forEach(radio => {
    radio.addEventListener('change', updateProductTypeSlider);
  });
}

/**
 * Update product type slider position
 */
function updateProductTypeSlider() {
  const checkedRadio = document.querySelector('input[name="productType"]:checked');
  const label = document.querySelector(`label[for="${checkedRadio.id}"]`);

  // Get position and dimensions
  const sliderWidth = label.offsetWidth;
  const sliderLeft = label.offsetLeft;

  // Update slider
  productTypeSlider.style.width = `${sliderWidth}px`;
  productTypeSlider.style.transform = `translateX(${sliderLeft}px)`;
}

/**
 * Initialize mockup selector
 */
function initMockupSelector() {
  // Open modal on button click
  const openModal = () => {
    console.log('[MockupSelector] Opening modal...');
    // Repopulate modal with current layout images
    if (categoriesData.length > 0) {
      populateMockupModal(categoriesData);
    }
    mockupModal.classList.add('active');
  };

  mockupSelectorBtn.addEventListener('click', openModal);

  // Close modal on close button click
  mockupModalClose.addEventListener('click', () => {
    console.log('[MockupSelector] Closing modal...');
    mockupModal.classList.remove('active');
  });

  // Close modal on background click
  mockupModal.addEventListener('click', (e) => {
    if (e.target === mockupModal) {
      console.log('[MockupSelector] Modal background clicked, closing...');
      mockupModal.classList.remove('active');
    }
  });
}

/**
 * Populate mockup modal with categories
 */
function populateMockupModal(categories) {
  mockupCategoriesContainer.innerHTML = '';

  categories.forEach(category => {
    if (category.subcategories && category.subcategories.length > 0) {
      const section = document.createElement('div');
      section.className = 'mockup-category-section';

      const title = document.createElement('h2');
      title.className = 'mockup-category-title';
      title.textContent = category.name;
      section.appendChild(title);

      const grid = document.createElement('div');
      grid.className = 'mockup-grid';

      category.subcategories.forEach(subcategory => {
        const option = document.createElement('div');
        option.className = 'mockup-option';
        option.dataset.category = category.name;
        option.dataset.subcategory = subcategory;
        option.dataset.value = `${category.name}/${subcategory}`;

        // Construct image URL based on current layout
        const imageUrl = `${CONFIG.MOCKUP_SERVER_URL}/mockup-image/${encodeURIComponent(category.name)}/${encodeURIComponent(subcategory)}/${currentLayout}`;

        // Create elements
        const img = document.createElement('img');
        img.src = imageUrl;
        img.alt = subcategory;
        img.className = 'mockup-option-image';

        const fallback = document.createElement('div');
        fallback.style.cssText = 'width: 100%; height: 100%; display: none; align-items: center; justify-content: center; background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%); position: absolute; top: 0; left: 0;';
        fallback.innerHTML = `<span style="font-size: 14px; color: #2d3748; font-weight: 600; text-align: center; padding: 20px;">${subcategory}</span>`;

        const label = document.createElement('div');
        label.className = 'mockup-option-label';
        label.textContent = subcategory;

        // Handle image load error
        img.addEventListener('error', () => {
          img.style.display = 'none';
          fallback.style.display = 'flex';
        });

        // Assemble option
        option.appendChild(img);
        option.appendChild(fallback);
        option.appendChild(label);

        option.addEventListener('click', async () => {
          await selectMockupAndGenerate(option, category.name, subcategory);
        });

        grid.appendChild(option);
      });

      section.appendChild(grid);
      mockupCategoriesContainer.appendChild(section);
    }
  });
}

/**
 * Select a mockup and trigger generation
 */
async function selectMockupAndGenerate(optionElement, category, subcategory) {
  console.log('[SelectMockup] Mockup clicked:', category, subcategory);

  // Remove previous selection
  document.querySelectorAll('.mockup-option.selected').forEach(el => {
    el.classList.remove('selected');
  });

  // Add selection
  optionElement.classList.add('selected');

  // Store selected mockup
  selectedMockup = {
    category: category,
    subcategory: subcategory,
    value: `${category}/${subcategory}`
  };

  // Update hidden select
  categorySelect.value = selectedMockup.value;

  console.log('[SelectMockup] Mockup selected:', selectedMockup);

  // Close modal
  mockupModal.classList.remove('active');

  // Show loading state
  isProcessing = true;
  showLoadingState();

  try {
    // Get image from storage
    const result = await chrome.storage.local.get(['publishImage']);

    if (!result.publishImage) {
      console.error('[SelectMockup] No image found in storage');
      hideLoadingState();
      alert('Aucune image trouvée');
      return;
    }

    console.log('[SelectMockup] Starting mockup generation...');
    console.log('[SelectMockup] Image URL:', result.publishImage);
    console.log('[SelectMockup] Category:', category);
    console.log('[SelectMockup] Subcategory:', subcategory);
    console.log('[SelectMockup] Layout:', currentLayout);

    // Submit job to server
    const response = await chrome.runtime.sendMessage({
      action: 'submitJob',
      data: {
        imageUrl: result.publishImage,
        category: category,
        subcategory: subcategory,
        layout: currentLayout
      }
    });

    console.log('[SelectMockup] Received response:', response);

    if (response.success && response.data.success) {
      console.log('[SelectMockup] Mockup generated successfully:', response.data);
      showResultImage(response.data.resultPath);
    } else {
      console.error('[SelectMockup] Job failed:', response);
      hideLoadingState();
      alert('Erreur lors de la création du mockup:\n\n' + (response.data?.error || response.error || 'Erreur inconnue'));
    }
  } catch (error) {
    console.error('[SelectMockup] Error:', error);
    hideLoadingState();
    alert('Erreur lors de la génération du mockup:\n\n' + error.message);
  } finally {
    isProcessing = false;
  }
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

  // Hide ratio badge when no image
  ratioBadge.style.display = 'none';
}

/**
 * Load categories from UXP server via background script
 */
async function loadCategories() {
  try {
    console.log('[Categories] Requesting categories from background script...');

    // Ask background script to fetch categories
    const response = await chrome.runtime.sendMessage({ action: 'getCategories' });

    console.log('[Categories] Received response:', response);

    if (response.success && response.data.success && response.data.categories && response.data.categories.length > 0) {
      console.log('[Categories] Populating categories:', response.data.categories);
      populateCategories(response.data.categories);
    } else {
      console.warn('[Categories] No categories found');
      showCategoryError('Aucune catégorie trouvée');
    }
  } catch (error) {
    console.error('[Categories] Error loading categories:', error);
    showCategoryError('Erreur: Le serveur UXP est-il démarré ?');
  }
}

/**
 * Populate category dropdown
 */
function populateCategories(categories) {
  // Store categories data for modal
  categoriesData = categories;

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

  // Populate mockup modal
  populateMockupModal(categories);
}

/**
 * Show category loading error
 */
function showCategoryError(message) {
  categorySelect.innerHTML = `<option value="" disabled selected>${message}</option>`;
}

/**
 * Handle publish button click (send to backend)
 */
publishBtn.addEventListener('click', async () => {
  console.log('[Publish] Publish button clicked');

  const altText = altTextInput.value.trim();
  const productType = document.querySelector('input[name="productType"]:checked').value;

  // Check if at least one mockup has been generated
  const validMockups = resultImageUrls.filter(url => url !== null);
  if (validMockups.length === 0) {
    console.warn('[Publish] No generated mockups found');
    alert('Veuillez d\'abord générer au moins un mockup en cliquant sur une catégorie');
    return;
  }

  if (!altText) {
    console.warn('[Publish] No alt text provided');
    alert('Veuillez entrer un texte alternatif');
    return;
  }

  // Get stored data
  const result = await chrome.storage.local.get(['publishImage', 'publishPrompt']);

  console.log('[Publish] Preparing to publish:', {
    originalImage: result.publishImage,
    generatedMockups: validMockups,
    mockupCount: validMockups.length,
    altText: altText,
    productType: productType,
    layout: currentLayout,
    prompt: result.publishPrompt
  });

  // TODO: Send to backend API
  alert('Fonctionnalité de publication vers le backend en cours de développement\n\nDonnées prêtes:\n- Nombre de mockups: ' + validMockups.length + '\n- Images générées: ' + validMockups.join(', ') + '\n- Alt text: ' + altText + '\n- Type: ' + productType);

  // For now, just show success
  console.log('[Publish] Ready to send to backend (not implemented yet)');
});

/**
 * Show loading state on mockup selector button
 */
function showLoadingState() {
  const container = document.querySelector('.mockup-selector-container');
  container.innerHTML = `
    <div class="mockup-selector-btn" style="display: flex; align-items: center; justify-content: center; flex-direction: column;">
      <div class="loading-spinner"></div>
      <p style="margin-top: 20px; color: #667eea; font-weight: 600;">Génération du mockup en cours...</p>
    </div>
  `;
}

/**
 * Hide loading state (restore button)
 */
function hideLoadingState() {
  const container = document.querySelector('.mockup-selector-container');
  container.innerHTML = `
    <button type="button" class="mockup-selector-btn" id="mockupSelectorBtn">
      <div class="mockup-selector-icon">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24">
          <path fill="currentColor" d="M12 21q-.425 0-.712-.288T11 20v-7H4q-.425 0-.712-.288T3 12t.288-.712T4 11h7V4q0-.425.288-.712T12 3t.713.288T13 4v7h7q.425 0 .713.288T21 12t-.288.713T20 13h-7v7q0 .425-.288.713T12 21"/>
        </svg>
      </div>
    </button>
  `;

  // Re-attach event listener
  document.getElementById('mockupSelectorBtn').addEventListener('click', () => {
    if (categoriesData.length > 0) {
      populateMockupModal(categoriesData);
    }
    mockupModal.classList.add('active');
  });
}

/**
 * Show result image
 */
function showResultImage(imagePath) {
  console.log('[ShowResult] Adding mockup image:', imagePath);

  // Add to array
  resultImageUrls.push(imagePath);
  const imageIndex = resultImageUrls.length - 1;

  const container = document.querySelector('.mockup-selector-container');

  // Find the add button container by ID
  const addButtonContainer = document.getElementById('addMockupButtonContainer');

  // Create new mockup item
  const mockupItem = document.createElement('div');
  mockupItem.className = 'mockup-item';
  mockupItem.setAttribute('data-index', imageIndex);
  mockupItem.innerHTML = `
    <img src="${imagePath}" alt="Mockup généré" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);" />
    <div class="remove-mockup-btn" data-index="${imageIndex}" style="position: absolute; top: 10px; right: 10px; background: white; border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.2); transition: background 0.2s ease;" onmouseover="this.style.background='#ff4444'; this.style.color='white';" onmouseout="this.style.background='white'; this.style.color='currentColor';">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </div>
  `;

  // Insert before the add button container
  if (addButtonContainer) {
    container.insertBefore(mockupItem, addButtonContainer);
  } else {
    container.appendChild(mockupItem);
  }

  // Attach click event to remove button
  const removeBtn = mockupItem.querySelector('.remove-mockup-btn');
  removeBtn.addEventListener('click', () => removeMockup(imageIndex));

  console.log('[ShowResult] Mockup added, total count:', resultImageUrls.length);
}

/**
 * Remove a specific mockup by index
 */
async function removeMockup(index) {
  console.log('[RemoveMockup] Removing mockup at index:', index);

  const imageUrl = resultImageUrls[index];

  // Delete file from server if it exists
  if (imageUrl) {
    try {
      // Extract filename from URL (e.g., "http://localhost:3001/uploads/processed_job_xxx.jpg" -> "processed_job_xxx.jpg")
      const filename = imageUrl.split('/').pop();
      console.log('[RemoveMockup] Deleting file from server:', filename);

      // Call delete endpoint via background script
      const response = await chrome.runtime.sendMessage({
        action: 'deleteFile',
        filename: filename
      });

      if (response.success) {
        console.log('[RemoveMockup] File deleted successfully');
      } else {
        console.warn('[RemoveMockup] Failed to delete file:', response.error);
      }
    } catch (error) {
      console.error('[RemoveMockup] Error deleting file:', error);
    }
  }

  // Remove from array (set to null to keep indices stable)
  resultImageUrls[index] = null;

  // Remove from DOM
  const container = document.querySelector('.mockup-selector-container');
  const mockupItem = container.querySelector(`.mockup-item[data-index="${index}"]`);
  if (mockupItem) {
    mockupItem.remove();
  }

  console.log('[RemoveMockup] Mockup removed, remaining count:', resultImageUrls.filter(url => url !== null).length);
}

// Initialize on load
init();
