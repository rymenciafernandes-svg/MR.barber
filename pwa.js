if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(err => console.warn('PWA indisponível:', err)));
}
