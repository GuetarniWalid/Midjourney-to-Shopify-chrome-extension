/**
 * Handles the logo click event.
 * @param {HTMLElement} card
 */
window.handleLogoClick = card => {
  const loader = window.addLoader(card);
  const { link } = window.extractCardData(card);

  window.openTab(link, async data => {
    try {
      const response = await fetch(window.CONFIG.API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      const result = await response.json();
      console.log('Success:', result);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      window.removeLoader(loader);
    }
  });
};
