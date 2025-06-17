(function () {
  // === Constants ===
  const JOB_CARD_CLASS = '@container/jobCard';
  const PAGE_SCROLL_ID = 'pageScroll';

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
    const container = document.getElementById(PAGE_SCROLL_ID);
    if (!container) return;
    observeJobCards(container);
  }

  // === Observe for New Job Cards ===
  function observeJobCards(container) {
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (isJobCard(node)) {
            window.addLogoToJobCard(node);
          }
        });
      });
    });
    observer.observe(container, { childList: true, subtree: true });
  }

  // === Utility: Check if Node is a Job Card ===
  function isJobCard(node) {
    return node.tagName === 'DIV' && node.classList.contains(JOB_CARD_CLASS);
  }

  // === Start the script ===
  init();
})();
