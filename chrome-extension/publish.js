// Configuration
const CONFIG = {
  API_URL: 'http://localhost:3333',
  MOCKUP_SERVER_URL: 'http://localhost:3001'
};

// Custom alert function
function customAlert(message) {
  const modal = document.getElementById('customAlertModal');
  const messageElement = document.getElementById('customAlertMessage');
  const btn = document.getElementById('customAlertBtn');

  messageElement.textContent = message;
  modal.classList.add('active');

  // Close on button click
  const closeAlert = () => {
    modal.classList.remove('active');
    btn.removeEventListener('click', closeAlert);
  };

  btn.addEventListener('click', closeAlert);
}

// Get elements
const imageContainer = document.getElementById('imageContainer');
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
let resultImageContexts = []; // Array to store mockup contexts (category/subcategory descriptions)

// Collection selector state
let collections = []; // Array of {id, title} from API
let selectedCollection = null; // Currently selected {id, title}
let isLoadingCollections = false;
let filteredCollections = []; // Filtered by search term

// Initialize page
async function init() {
  console.log('[Init] Initializing publish page...');

  // Get image data from storage
  const result = await chrome.storage.local.get(['publishImage', 'publishAspectRatio']);
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

  // Initialize collection selector
  console.log('[Init] Initializing collection selector...');
  initCollectionSelector();

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

  // Reload collections for new product type
  clearCollectionSelection();
  loadCollections(checkedRadio.value);
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
 * Initialize collection selector
 */
function initCollectionSelector() {
  const searchInput = document.getElementById('collectionSearch');
  const dropdown = document.getElementById('collectionDropdown');

  // Open dropdown on input click/focus
  searchInput.addEventListener('click', () => {
    if (collections.length > 0 && !dropdown.classList.contains('active')) {
      dropdown.classList.add('active');
    }
  });

  searchInput.addEventListener('focus', () => {
    if (collections.length > 0) {
      dropdown.classList.add('active');
    }
  });

  // Filter on input
  searchInput.addEventListener('input', (e) => {
    filterCollections(e.target.value);
  });

  // Handle keyboard navigation
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      dropdown.classList.remove('active');
      searchInput.blur();
    }

    // Backspace to clear selection
    if (e.key === 'Backspace' && selectedCollection) {
      clearCollectionSelection();
      searchInput.value = '';
      filterCollections('');
    }
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.remove('active');
    }
  });

  // Load initial collections for default product type
  const defaultProductType = document.querySelector('input[name="productType"]:checked').value;
  loadCollections(defaultProductType);
}

/**
 * Load collections for a given product type
 */
async function loadCollections(productType) {
  console.log('[Collections] Loading collections for type:', productType);

  try {
    isLoadingCollections = true;
    showCollectionLoadingState();

    // Fetch collections via background script
    const response = await chrome.runtime.sendMessage({
      action: 'getCollections',
      productType: productType
    });

    console.log('[Collections] Response:', response);

    if (!response) {
      console.error('[Collections] No response received');
      showCollectionError('Erreur: Serveur non accessible');
      customAlert('Le serveur backend n\'est pas accessible.\n\nVeuillez démarrer le serveur backend sur:\n' + CONFIG.API_URL);
      return;
    }

    if (!response.success) {
      console.error('[Collections] Failed to load:', response.error);
      showCollectionError('Erreur lors du chargement des collections');
      customAlert('Impossible de charger les collections.\n\nVeuillez vérifier que le serveur backend est démarré sur:\n' + CONFIG.API_URL + '\n\nErreur: ' + response.error);
      return;
    }

    if (response.data && response.data.success && response.data.data) {
      collections = response.data.data;
      filteredCollections = [...collections];
      console.log('[Collections] Loaded', collections.length, 'collections');
      populateCollections(filteredCollections);
    } else {
      console.error('[Collections] Invalid response format:', response);
      showCollectionError('Erreur lors du chargement des collections');
      customAlert('Format de réponse invalide.\n\nVeuillez vérifier que le serveur backend est démarré correctement.');
    }
  } catch (error) {
    console.error('[Collections] Error:', error);
    showCollectionError('Erreur: ' + error.message);
    customAlert('Erreur lors du chargement des collections.\n\nVeuillez démarrer le serveur backend sur:\n' + CONFIG.API_URL + '\n\nErreur: ' + error.message);
  } finally {
    isLoadingCollections = false;
  }
}

/**
 * Show loading state in dropdown
 */
function showCollectionLoadingState() {
  const dropdown = document.getElementById('collectionDropdown');
  dropdown.innerHTML = `
    <div class="collection-loading">
      <div class="loading-spinner"></div>
      <p>Chargement des collections...</p>
    </div>
  `;
  dropdown.classList.add('active');
}

/**
 * Show error in dropdown
 */
function showCollectionError(message) {
  const dropdown = document.getElementById('collectionDropdown');
  dropdown.innerHTML = `
    <div class="collection-no-results">${message}</div>
  `;
}

/**
 * Populate collections dropdown
 */
function populateCollections(collectionsToShow) {
  const dropdown = document.getElementById('collectionDropdown');
  const searchInput = document.getElementById('collectionSearch');

  if (collectionsToShow.length === 0) {
    dropdown.innerHTML = `
      <div class="collection-no-results">Aucune collection trouvée</div>
    `;
    return;
  }

  dropdown.innerHTML = '';

  collectionsToShow.forEach(collection => {
    const option = document.createElement('div');
    option.className = 'collection-option';
    option.textContent = collection.title;
    option.dataset.id = collection.id;
    option.dataset.title = collection.title;

    // Highlight if selected
    if (selectedCollection && selectedCollection.id === collection.id) {
      option.classList.add('selected');
    }

    option.addEventListener('click', () => selectCollection(collection));

    dropdown.appendChild(option);
  });

  // Enable search input
  searchInput.removeAttribute('readonly');
  searchInput.placeholder = 'Rechercher une collection...';
}

/**
 * Select a collection
 */
function selectCollection(collection) {
  console.log('[Collections] Selected:', collection);

  selectedCollection = collection;

  const searchInput = document.getElementById('collectionSearch');
  const hiddenInput = document.getElementById('selectedCollectionId');
  const dropdown = document.getElementById('collectionDropdown');

  // Update UI
  searchInput.value = collection.title;
  searchInput.classList.add('has-selection');
  hiddenInput.value = collection.id;

  // Close dropdown
  dropdown.classList.remove('active');

  // Update selected state in dropdown
  document.querySelectorAll('.collection-option').forEach(opt => {
    opt.classList.remove('selected');
    if (opt.dataset.id === collection.id) {
      opt.classList.add('selected');
    }
  });
}

/**
 * Filter collections based on search input
 */
function filterCollections(searchTerm) {
  const term = searchTerm.toLowerCase().trim();

  if (term === '') {
    filteredCollections = [...collections];
  } else {
    filteredCollections = collections.filter(collection =>
      collection.title.toLowerCase().includes(term)
    );
  }

  populateCollections(filteredCollections);

  const dropdown = document.getElementById('collectionDropdown');
  dropdown.classList.add('active');
}

/**
 * Clear collection selection
 */
function clearCollectionSelection() {
  selectedCollection = null;

  const searchInput = document.getElementById('collectionSearch');
  const hiddenInput = document.getElementById('selectedCollectionId');

  searchInput.classList.remove('has-selection');
  hiddenInput.value = '';

  document.querySelectorAll('.collection-option.selected').forEach(opt => {
    opt.classList.remove('selected');
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
      customAlert('Aucune image trouvée');
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

    // Check if response exists
    if (!response) {
      console.error('[SelectMockup] No response received');
      hideLoadingState();
      customAlert('Erreur: Aucune réponse du serveur');
      return;
    }

    // Check for background script error
    if (!response.success) {
      console.error('[SelectMockup] Background error:', response.error);
      hideLoadingState();

      // Provide user-friendly French error messages
      let errorMessage = response.error || 'Erreur lors de la génération du mockup';
      if (errorMessage.includes('UXP plugin is not connected')) {
        errorMessage = 'Le plugin Photoshop n\'est pas connecté.\n\nVeuillez:\n1. Ouvrir Photoshop\n2. Ouvrir le plugin UXP\n3. Cliquer sur "Connect to Server"';
      }

      customAlert(errorMessage);
      return;
    }

    // Check for job success
    if (response.data && response.data.success) {
      console.log('[SelectMockup] Mockup generated successfully:', response.data);

      // Use mockupContext from server response (read from context.txt)
      const mockupContext = response.data.mockupContext || `${category} - ${subcategory}`;

      showResultImage(response.data.resultPath, mockupContext);
      hideLoadingState();
    } else {
      console.error('[SelectMockup] Job failed:', response);
      hideLoadingState();
      customAlert('Erreur lors de la création du mockup:\n\n' + (response.data?.error || 'Erreur inconnue'));
    }
  } catch (error) {
    console.error('[SelectMockup] Error:', error);
    hideLoadingState();
    customAlert('Erreur lors de la génération du mockup:\n\n' + error.message);
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

    // Check if background script returned an error
    if (!response.success) {
      console.error('[Categories] Background script error:', response.error);
      showCategoryError('Erreur de connexion');
      customAlert('Le serveur de mockups n\'est pas accessible.\n\nVeuillez démarrer le serveur:\ncd dist/mockup-server && npm start\n\nErreur: ' + response.error);
      return;
    }

    if (response.data.success && response.data.categories && response.data.categories.length > 0) {
      console.log('[Categories] Populating categories:', response.data.categories);
      populateCategories(response.data.categories);
    } else {
      console.warn('[Categories] No categories found');
      showCategoryError('Aucune catégorie trouvée');
      customAlert('Aucune catégorie de mockup trouvée.\n\nVérifiez que le serveur de mockups est démarré et que les dossiers de mockups existent.');
    }
  } catch (error) {
    console.error('[Categories] Error loading categories:', error);
    showCategoryError('Erreur: Le serveur UXP est-il démarré ?');
    customAlert('Erreur lors du chargement des catégories.\n\nVeuillez démarrer le serveur de mockups:\ncd dist/mockup-server && npm start\n\nErreur: ' + error.message);
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

  const productType = document.querySelector('input[name="productType"]:checked').value;

  // Check if collection is selected
  if (!selectedCollection) {
    console.warn('[Publish] No collection selected');
    customAlert('Veuillez sélectionner une collection');
    return;
  }

  // Check if at least one mockup has been generated
  const validMockups = resultImageUrls.filter(url => url !== null);
  if (validMockups.length === 0) {
    console.warn('[Publish] No generated mockups found');
    customAlert('Veuillez d\'abord générer au moins un mockup');
    return;
  }

  // Show loading state
  publishBtn.disabled = true;
  const originalButtonText = publishBtn.textContent;
  publishBtn.innerHTML = '<div class="loading-spinner" style="width: 24px; height: 24px; margin: 0 auto;"></div>';

  try {
    // Get stored data (original image)
    const result = await chrome.storage.local.get(['publishImage']);

    if (!result.publishImage) {
      console.error('[Publish] No original image found');
      customAlert('Image originale introuvable');
      publishBtn.disabled = false;
      publishBtn.textContent = originalButtonText;
      return;
    }

    // Get valid mockup indices (filter out nulls but keep track of original indices)
    const validMockupData = [];
    for (let i = 0; i < resultImageUrls.length; i++) {
      if (resultImageUrls[i] !== null) {
        validMockupData.push({
          url: resultImageUrls[i],
          context: resultImageContexts[i] || ''
        });
      }
    }

    // Build image data array in specific order:
    // [mockup1, originalImage, mockup2, mockup3, ...]
    const imageDataArray = [];

    // Add first mockup
    if (validMockupData[0]) {
      imageDataArray.push({
        url: validMockupData[0].url,
        mockupContext: validMockupData[0].context,
        type: 'mockup'
      });
    }

    // Add original image at position 2
    imageDataArray.push({
      url: result.publishImage,
      type: 'original'
    });

    // Add remaining mockups
    for (let i = 1; i < validMockupData.length; i++) {
      imageDataArray.push({
        url: validMockupData[i].url,
        mockupContext: validMockupData[i].context,
        type: 'mockup'
      });
    }

    console.log('[Publish] Image order:', imageDataArray.map((item, idx) => ({
      position: idx + 1,
      type: item.type,
      context: item.mockupContext,
      url: item.url
    })));

    // Log detailed info about each image URL
    console.log('[Publish] === DETAILED IMAGE URLS ===');
    imageDataArray.forEach((item, idx) => {
      console.log(`[Publish] Image ${idx}: type="${item.type}", url="${item.url}", context="${item.mockupContext || 'N/A'}"`);
    });
    console.log('[Publish] === END DETAILED URLS ===');

    // Fetch all images and convert to base64
    console.log('[Publish] Fetching images and converting to base64...');
    const imagesArray = [];

    for (let i = 0; i < imageDataArray.length; i++) {
      const item = imageDataArray[i];
      console.log(`[Publish] Fetching image ${i + 1}/${imageDataArray.length}:`, item.url);

      const response = await fetch(item.url);
      if (!response.ok) {
        throw new Error(`Failed to fetch image ${i + 1}: ${response.statusText}`);
      }

      const blob = await response.blob();
      console.log(`[Publish] Image ${i + 1} fetched, size:`, blob.size, 'bytes');

      // Convert blob to base64 with data URI prefix
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          // Keep full data URI (e.g., "data:image/jpeg;base64,...")
          resolve(reader.result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      console.log(`[Publish] Image ${i + 1} converted to base64, length:`, base64.length);

      const imageObject = {
        base64Image: base64,
        type: item.type
      };

      // Only add mockupContext for mockup images (not for original)
      if (item.mockupContext) {
        imageObject.mockupContext = item.mockupContext;
      }

      // Log what we're adding
      console.log(`[Publish] Image ${i + 1} prepared:`, {
        type: imageObject.type,
        context: imageObject.mockupContext || 'N/A',
        base64Length: base64.length,
        base64Preview: base64.substring(0, 50) + '...'
      });

      imagesArray.push(imageObject);
    }

    // Map product type to backend format
    const productTypeMapping = {
      'toile': 'painting',
      'poster': 'poster',
      'tapisserie': 'tapestry'
    };

    // Create final data structure
    const publishData = {
      images: imagesArray,
      ratio: currentLayout, // portrait, landscape, or square
      productType: productTypeMapping[productType],
      parentCollection: {
        id: selectedCollection.id,
        title: selectedCollection.title
      }
    };

    console.log('[Publish] Final data structure ready, sending to backend...');
    console.log('[Publish] Data summary:', {
      imageCount: imagesArray.length,
      ratio: currentLayout,
      productType: productTypeMapping[productType],
      collectionId: selectedCollection.id
    });

    // Send to backend API
    const apiResponse = await fetch(`${CONFIG.API_URL}/api/shopify-product-publisher/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(publishData)
    });

    if (!apiResponse.ok) {
      const errorData = await apiResponse.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${apiResponse.status}: ${apiResponse.statusText}`);
    }

    const apiResult = await apiResponse.json();
    console.log('[Publish] Backend response:', apiResult);

    customAlert('Publication réussie !\n\n' +
      '- Total images: ' + imagesArray.length + '\n' +
      '- Format: ' + publishData.ratio + '\n' +
      '- Type: ' + publishData.productType + '\n' +
      '- Collection: ' + selectedCollection.title);

  } catch (error) {
    console.error('[Publish] Error preparing images:', error);
    customAlert('Erreur lors de la préparation des images:\n\n' + error.message);
  } finally {
    // Restore button state
    publishBtn.disabled = false;
    publishBtn.textContent = originalButtonText;
  }
});

/**
 * Show loading state on mockup selector button (only replace the add button, not the whole container)
 */
function showLoadingState() {
  const addButtonContainer = document.getElementById('addMockupButtonContainer');
  if (addButtonContainer) {
    addButtonContainer.innerHTML = `
      <div class="mockup-selector-btn" style="display: flex; align-items: center; justify-content: center; flex-direction: column;">
        <div class="loading-spinner"></div>
        <p style="margin-top: 20px; color: #667eea; font-weight: 600;">Génération du mockup en cours...</p>
      </div>
    `;
  }
}

/**
 * Hide loading state (restore the add button)
 */
function hideLoadingState() {
  const addButtonContainer = document.getElementById('addMockupButtonContainer');
  if (addButtonContainer) {
    addButtonContainer.innerHTML = `
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
}

/**
 * Show result image
 */
function showResultImage(imagePath, mockupContext = '') {
  console.log('[ShowResult] Adding mockup image:', imagePath);
  console.log('[ShowResult] Mockup context:', mockupContext);

  // Add to arrays
  resultImageUrls.push(imagePath);
  resultImageContexts.push(mockupContext);
  const imageIndex = resultImageUrls.length - 1;

  // Log complete arrays state
  console.log('[ShowResult] Current resultImageUrls array:', resultImageUrls);
  console.log('[ShowResult] Current resultImageContexts array:', resultImageContexts);

  const container = document.querySelector('.mockup-selector-container');

  // Find the add button container by ID
  const addButtonContainer = document.getElementById('addMockupButtonContainer');

  // Add cache-busting parameter to prevent browser from showing cached images
  const cacheBustedPath = imagePath + '?t=' + Date.now();

  // Create new mockup item
  const mockupItem = document.createElement('div');
  mockupItem.className = 'mockup-item';
  mockupItem.setAttribute('data-index', imageIndex);
  mockupItem.innerHTML = `
    <img src="${cacheBustedPath}" alt="Mockup généré" style="width: 100%; height: 100%; object-fit: cover;" />
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

  // Remove from arrays (set to null to keep indices stable)
  resultImageUrls[index] = null;
  resultImageContexts[index] = null;

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
