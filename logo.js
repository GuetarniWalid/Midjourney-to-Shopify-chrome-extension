/**
 * Creates the logo SVG element.
 * @returns {HTMLElement}
 */
function createLogoElement() {
  const div = document.createElement('div');
  div.className = 'absolute p-2 top-3 right-3 z-10 cursor-pointer chatGPT-logo buttonHoverBackground buttonHoverOpacity rounded-full  active:!ring-white/50 buttonActiveRing buttonActiveOpacity buttonActiveBackground !transition-none active:!transition';
  div.innerHTML = `
    <svg class="pointer-events-none" width="18" height="18" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8.00004 7.49994C8.00004 7.49994 7.50007 3.9999 12.5 2.49994C17.5 0.999987 19.5 3.99994 20 4.49995C20.5 4.99997 23 2.99994 27 6.49994C31.0001 9.99994 28 13.1314 28 13.4999C28.0001 13.8685 31 14.5001 30.5 19.5C30 24.4999 24.5 24.9999 24.5 24.9999C24.5 24.9999 24.5 29.4999 19.5 30.5C14.5 31.5001 13 27.9999 13 27.9999C13 27.9999 8.50007 29.4999 5.50003 25.9999C2.5 22.5 4.50003 18.9999 4.50003 18.9999C4.50003 18.9999 1.00006 17.5 2.50003 11.9999C4 6.49988 8.00004 7.49994 8.00004 7.49994Z" fill="white"/>
      <path d="M12.2533 18.6267V9.02666L19.7133 4.71999C23.8466 2.33333 31.2466 8.21999 28.14 13.6067" stroke="black" stroke-width="0.666667" stroke-linejoin="round"/>
      <path d="M12.2533 13.96L20.5666 9.16003L28.0266 13.4667C32.16 15.8534 30.76 25.2067 24.54 25.2067" stroke="black" stroke-width="0.666667" stroke-linejoin="round"/>
      <path d="M16.2933 11.6267L24.6066 16.4267V25.0467C24.6066 29.82 15.8066 33.2867 12.7 27.9" stroke="black" stroke-width="0.666667" stroke-linejoin="round"/>
      <path d="M20.3333 14.1333V23.56L12.8733 27.8666C8.73997 30.2533 1.33997 24.3666 4.44664 18.98" stroke="black" stroke-width="0.666667" stroke-linejoin="round"/>
      <path d="M20.3334 18.6267L12.02 23.4267L4.56002 19.12C0.420024 16.7267 1.82002 7.38 8.04002 7.38" stroke="black" stroke-width="0.666667" stroke-linejoin="round"/>
      <path d="M16.2933 20.96L7.97998 16.16V7.53997C7.97998 2.76664 16.78 -0.700028 19.8866 4.68664" stroke="black" stroke-width="0.666667" stroke-linejoin="round"/>
    </svg>
  `;
  return div;
}

/**
 * Attaches the logo to the card and sets up event listeners.
 * @param {HTMLElement} card
 * @param {Function} onClick - Callback when logo is clicked
 */
function attachLogo(card, onClick) {
  const LOGO_CLASS = 'chatGPT-logo';

  function showLogo() {
    if (card.querySelector('.' + LOGO_CLASS)) return;
    const logo = createLogoElement();
    card.appendChild(logo);
    logo.addEventListener('click', e => {
      e.stopPropagation();
      if (onClick) onClick(card);
    });
  }

  function hideLogo(e) {
    if (card.contains(e.relatedTarget)) return;
    removeLogo(card);
  }

  card.addEventListener('mouseover', showLogo);
  card.addEventListener('mouseout', hideLogo);
  
  // Check if mouse is already over the card when we attach the logo
  const rect = card.getBoundingClientRect();
  const mouseX = window.mouseX || 0; // We'll need to track mouse position
  const mouseY = window.mouseY || 0;
  
  if (mouseX >= rect.left && mouseX <= rect.right && 
      mouseY >= rect.top && mouseY <= rect.bottom) {
    showLogo();
  }
}

/**
 * Removes the logo from the card.
 * @param {HTMLElement} card
 */
function removeLogo(card) {
  const logo = card.querySelector('.chatGPT-logo');
  if (logo) logo.remove();
}

/**
 * Adds the logo to the job card.
 * @param {HTMLElement} card
 */
window.addLogoToJobCard = function(card) {
  attachLogo(card, window.handleLogoClick);
};
