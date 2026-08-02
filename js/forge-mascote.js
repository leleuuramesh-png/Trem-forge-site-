/**
 * Forge Mascote — Controller
 * Trem Forge — troca de expressões com crossfade
 * Uso: ver forge-demo.html
 */

class ForgeMascote {
  /**
   * @param {string} elId - id do elemento <img> que exibe o mascote
   * @param {string} basePath - caminho base onde estão as imagens (padrão: /images/forge)
   */
  constructor(elId, basePath = "/images/forge") {
    this.el = document.getElementById(elId);
    this.basePath = basePath;

    // Mapa de estado -> caminho da imagem (ajustar conforme sua estrutura de pastas)
    this.mapa = {
      celebracao: `${basePath}/forge-animado-transparente-v2.webp`,
      // Expressões base
      feliz: `${basePath}/forge-feliz.png`,
      determinado: `${basePath}/forge-determinado.png`,
      pensativo: `${basePath}/forge-pensativo.png`,
      sonolento: `${basePath}/forge-sonolento.png`,
      acenando: `${basePath}/forge-acenando.png`,
      erro: `${basePath}/forge-erro.png`,
      bonus: `${basePath}/forge-bonus.png`,
      concluido: `${basePath}/forge-projeto-concluido.png`,
      manutencao: `${basePath}/forge-manutencao.png`,

      // Estados de IA (chat)
      ia_pensando: `${basePath}/extras/forge-ia-pensativo.png`,
      ia_analisando: `${basePath}/extras/forge-ia-analisando.png`,
      ia_gerando: `${basePath}/extras/forge-ia-gerando-codigo.png`,

      // Notificações
      notif_bonus: `${basePath}/extras/forge-notificacao-bonus.png`,
      notif_recurso: `${basePath}/extras/forge-notificacao-recurso.png`,
      notif_renovacao: `${basePath}/extras/forge-notificacao-renovacao.png`,

      // Tutorial
      tutorial_apontando: `${basePath}/tutorial/forge-tutorial-apontando.png`,
      tutorial_explicando: `${basePath}/tutorial/forge-tutorial-explicando.png`,
      tutorial_aprovando: `${basePath}/tutorial/forge-tutorial-aprovando.png`,
    };
  }

  /** Troca a expressão do mascote com um crossfade simples */
  set(estado) {
    const src = this.mapa[estado];
    if (!src) {
      console.warn(`[ForgeMascote] estado "${estado}" não mapeado.`);
      return;
    }
    if (!this.el) return;

    this.el.style.opacity = 0;
    setTimeout(() => {
      this.el.src = src;
      this.el.style.opacity = 1;
    }, 200);
  }

  /** Toca a animação de entrada (classe CSS forge-entrando) */
  entrar() {
    this.el?.classList.remove("forge-saindo");
    this.el?.classList.add("forge-entrando");
  }

  /** Toca a animação de saída e remove o elemento do DOM ao final */
  sair(callback) {
    if (!this.el) return;
    this.el.classList.remove("forge-entrando");
    this.el.classList.add("forge-saindo");
    this.el.addEventListener(
      "animationend",
      () => {
        callback?.();
      },
      { once: true }
    );
  }
}

// Exporta para uso via <script type="module"> ou como global
if (typeof module !== "undefined") {
  module.exports = ForgeMascote;
} else {
  window.ForgeMascote = ForgeMascote;
}
/** Liga o botão de play customizado a um <video> (necessário pro áudio funcionar, já que autoplay com som é bloqueado) */
function iniciarForgeVideoPlayer(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const video = container.querySelector("video");
  const btn = container.querySelector(".forge-video-play-btn");

  btn.addEventListener("click", () => {
    video.play();
    btn.classList.add("oculto");
    video.setAttribute("controls", "true");
  });

  video.addEventListener("pause", () => {
    btn.classList.remove("oculto");
  });
}
