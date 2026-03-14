if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('./service-worker.js');
    } catch (error) {
      console.warn('Service worker registration failed:', error);
    }
  });
}