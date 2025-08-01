function getLinkToBigSizeImage(card) {
    // Get the first image in the card
    const img = card.querySelector('img');
    if (!img || !img.src) {
        console.error('No image found in card');
        return null;
    }

    // Extract jobId and index from image src
    const src = img.src;
    const urlParts = src.split('/');
    const jobId = urlParts[3]; // After https://cdn.midjourney.com/
    
    // Extract index (after 0_)
    const filename = urlParts[4]; // 0_0_384_N.webp?method=shortest&qst=6&quality=15
    const indexMatch = filename.match(/0_(\d+)/);
    const index = indexMatch ? indexMatch[1] : '0';
    
    const link = `https://cdn.midjourney.com/${jobId}/0_${index}.png`;
    
    return link;
}

window.addLoader = (card) => {
    const loader = document.createElement('div');
    loader.style.position = 'absolute';
    loader.style.top = '0';
    loader.style.left = '0';
    loader.style.width = '100%';
    loader.style.height = '100%';
    loader.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    loader.style.zIndex = '1000';
    loader.style.display = 'flex';
    loader.style.justifyContent = 'center';
    loader.style.alignItems = 'center';
    loader.style.gap = '20px';

    const dot = document.createElement('div');
    dot.style.width = '20px';
    dot.style.height = '20px';
    dot.style.backgroundColor = 'white';
    dot.style.borderRadius = '50%';
    dot.style.animation = 'pulse 1s infinite';
    dot.style.animationDelay = '0s';
    loader.appendChild(dot);

    const dot2 = document.createElement('div');
    dot2.style.width = '20px';
    dot2.style.height = '20px';
    dot2.style.backgroundColor = 'white';
    dot2.style.borderRadius = '50%';
    dot2.style.animation = 'pulse 1s infinite';
    dot2.style.animationDelay = '0.2s';
    loader.appendChild(dot2);

    const dot3 = document.createElement('div');
    dot3.style.width = '20px';
    dot3.style.height = '20px';
    dot3.style.backgroundColor = 'white';
    dot3.style.borderRadius = '50%';
    dot3.style.animation = 'pulse 1s infinite';
    dot3.style.animationDelay = '0.4s';
    loader.appendChild(dot3);


    card.appendChild(loader);
    return loader;
}

window.removeLoader = (loader) => {
    loader.remove();
}

window.addSuccessMessage = (card, message) => {
    const successMessage = document.createElement('div');
    successMessage.style.position = 'absolute';
    successMessage.style.top = '0';
    successMessage.style.left = '0';
    successMessage.style.width = '100%';
    successMessage.style.height = '100%';
    successMessage.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    successMessage.style.zIndex = '1000';
    successMessage.style.display = 'flex';
    successMessage.style.justifyContent = 'center';
    successMessage.style.alignItems = 'center';
    successMessage.style.color = 'white';
    successMessage.style.fontSize = '20px';
    successMessage.style.fontWeight = 'bold';
    successMessage.style.textAlign = 'center';
    successMessage.style.padding = '20px';
    successMessage.style.backgroundColor = 'green';
    successMessage.textContent = message;
    successMessage.style.cursor = 'pointer';
    successMessage.title = 'Click to remove';
    successMessage.addEventListener('click', () => {
        successMessage.remove();
    });
    card.appendChild(successMessage);
}

window.addErrorMessage = (card, message) => {
    const errorMessage = document.createElement('div');
    errorMessage.style.position = 'absolute';
    errorMessage.style.top = '0';
    errorMessage.style.left = '0';
    errorMessage.style.width = '100%';
    errorMessage.style.height = '100%';
    errorMessage.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    errorMessage.style.zIndex = '1000';
    errorMessage.style.display = 'flex';
    errorMessage.style.justifyContent = 'center';
    errorMessage.style.alignItems = 'center';
    errorMessage.style.color = 'white';
    errorMessage.style.fontSize = '20px';
    errorMessage.style.fontWeight = 'bold';
    errorMessage.style.textAlign = 'center';
    errorMessage.style.padding = '20px';
    errorMessage.style.backgroundColor = 'red';
    errorMessage.textContent = message;
    errorMessage.style.cursor = 'pointer';
    errorMessage.title = 'Click to remove';
    errorMessage.addEventListener('click', () => {
        errorMessage.remove();
    });
    card.appendChild(errorMessage);
}