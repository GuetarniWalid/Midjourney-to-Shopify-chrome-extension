window.extractCardData = function(card) {
    const link = getLinkToBigSizeImage(card);
    return { link };
}

function getLinkToBigSizeImage(card) {
    const image = card.querySelector('a');
    return image.href;
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