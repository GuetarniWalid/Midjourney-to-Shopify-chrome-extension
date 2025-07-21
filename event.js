/**
 * Handles the logo click event.
 * @param {HTMLElement} card
 */
window.handleLogoClick = card => {
  const loader = window.addLoader(card);
  const { link } = window.extractCardData(card);

  window.openTab(link, async data => {
    let result = null;
    try {
      const response = await fetch(window.CONFIG.API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      result = await response.json();
      console.log('Success:', result);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      window.removeLoader(loader);
      if (result?.success) {
        window.addSuccessMessage(card, result.data || 'Fiche créée avec succès');
      } else {
        window.addErrorMessage(card, result?.message || 'Une erreur est survenue');
      }
    }
  });
};
