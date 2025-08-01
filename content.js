(function () {
  let currentPath = '';
  let isLogoAdded = false;
  
  // Track mouse position globally
  window.mouseX = 0;
  window.mouseY = 0;

  // === Entry Point ===
  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onDOMReady);
    } else {
      onDOMReady();
    }
  }

  // === DOM Ready Handler ===
  function onDOMReady() {
    // Start monitoring URL changes
    monitorUrlChanges();
    
    // Track mouse position
    document.addEventListener('mousemove', (e) => {
      window.mouseX = e.clientX;
      window.mouseY = e.clientY;
    });
    
    // Initial check
    checkAndHandleJobPage();
  }

  // === Monitor URL Changes ===
  function monitorUrlChanges() {
    // Check for URL changes every 500ms
    setInterval(() => {
      const newPath = window.location.pathname;
      if (newPath !== currentPath) {
        currentPath = newPath;
        isLogoAdded = false; // Reset flag when URL changes
        checkAndHandleJobPage();
      }
    }, 500);

    // Also listen to popstate events (back/forward buttons)
    window.addEventListener('popstate', () => {
      currentPath = window.location.pathname;
      isLogoAdded = false;
      checkAndHandleJobPage();
    });
  }

  // === Check and Handle Job Page ===
  function checkAndHandleJobPage() {
    // Only handle single job page (URL contains /jobs/) and if logo not already added
    if (window.location.pathname.includes('/jobs/') && !isLogoAdded) {
      handleSingleJobPage();
    }
  }

  // === Handle Single Job Page ===
  function handleSingleJobPage() {
    // Try to find the container immediately first
    let jobImageContainer = findJobImageContainer();
    
    if (jobImageContainer) {
      // Element found immediately, add logo
      window.addLogoToJobCard(jobImageContainer);
      isLogoAdded = true;
    } else {
      // Element not found, wait for it to appear
      waitForJobImageContainer();
    }
  }

  // === Wait for Job Image Container ===
  function waitForJobImageContainer() {
    // Use MutationObserver to watch for DOM changes
    const observer = new MutationObserver((mutations) => {
      const jobImageContainer = findJobImageContainer();
      if (jobImageContainer) {
        observer.disconnect(); // Stop observing
        window.addLogoToJobCard(jobImageContainer);
        isLogoAdded = true;
      }
    });

    // Start observing
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Fallback: also check periodically in case MutationObserver doesn't catch it
    let attempts = 0;
    const maxAttempts = 20; // 10 seconds max (20 * 500ms)
    
    const interval = setInterval(() => {
      attempts++;
      const jobImageContainer = findJobImageContainer();
      
      if (jobImageContainer) {
        clearInterval(interval);
        observer.disconnect();
        window.addLogoToJobCard(jobImageContainer);
        isLogoAdded = true;
      } else if (attempts >= maxAttempts) {
        // Give up after max attempts
        clearInterval(interval);
        observer.disconnect();
        console.log('🚀 ~ waitForJobImageContainer: Max attempts reached, giving up');
      }
    }, 500);
  }

  // === Find Job Image Container ===
  function findJobImageContainer() {
    // Target image with specific classes and inline style
    const targetImage = document.querySelector('img.absolute.w-full.h-full[style*="filter: none"]');
    
    if (targetImage) {
      // Find the closest container that would be suitable for the logo
      const container = targetImage.closest('div') || targetImage.parentElement;
      if (container && container.style.position !== 'static') {
        return container;
      }
      return targetImage.parentElement;
    }

    return null;
  }

  // === Start the script ===
  init();
})();
