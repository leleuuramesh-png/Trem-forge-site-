// Registra o Service Worker (necessário pro Chrome/Android considerar o site
// instalável) e escuta o evento de "pode instalar" pra guardar o prompt,
// caso alguma página queira oferecer um botão "Instalar app" próprio.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("Falha ao registrar o service worker:", err);
    });
  });
}

window.deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  window.deferredInstallPrompt = event;
  window.dispatchEvent(new CustomEvent("tf-install-available"));
});
