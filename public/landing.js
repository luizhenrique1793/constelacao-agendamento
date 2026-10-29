(() => {
  const header = document.querySelector('.site-header');
  const hero = document.querySelector('.video-hero');
  const video = document.querySelector('#hero-video');
  const videoToggle = document.querySelector('.video-toggle');
  const floatingCta = document.querySelector('.floating-whatsapp');
  const menuToggle = document.querySelector('.menu-toggle');
  const mobileMenu = document.querySelector('#mobile-menu');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const desktop = window.matchMedia('(min-width: 901px)');
  const connection = navigator.connection;
  let heroVisible = true;
  let manuallyPaused = false;
  let videoFailed = false;

  function setMenu(open, restoreFocus = false) {
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.querySelector('.sr-only').textContent = open ? 'Fechar menu' : 'Abrir menu';
    mobileMenu.hidden = !open;
    header.classList.toggle('menu-is-open', open);
    if (restoreFocus) menuToggle.focus();
  }

  menuToggle.hidden = false;
  menuToggle.addEventListener('click', () => setMenu(mobileMenu.hidden));
  mobileMenu.addEventListener('click', (event) => {
    if (event.target.closest('a')) setMenu(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !mobileMenu.hidden) setMenu(false, true);
  });
  document.addEventListener('click', (event) => {
    if (!mobileMenu.hidden && !header.contains(event.target)) setMenu(false);
  });
  desktop.addEventListener('change', () => setMenu(false));

  function playbackAllowed() {
    return !reducedMotion.matches && !connection?.saveData && !videoFailed;
  }

  function updatePlaybackButton() {
    videoToggle.hidden = !video.hasAttribute('src') || !playbackAllowed();
    videoToggle.querySelector('.video-toggle-label').textContent = video.paused ? 'Reproduzir vídeo' : 'Pausar vídeo';
    videoToggle.querySelector('.video-toggle-icon').textContent = video.paused ? '▷' : 'Ⅱ';
  }

  function playVideo() {
    if (!playbackAllowed() || manuallyPaused || !heroVisible || document.hidden) return;
    video.muted = true;
    if (!video.hasAttribute('src')) video.src = video.dataset.src;
    const request = video.play();
    if (request) request.catch(updatePlaybackButton);
  }

  function applyPlaybackPreference() {
    if (!playbackAllowed()) {
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.classList.remove('is-ready');
      updatePlaybackButton();
      return;
    }
    playVideo();
  }

  video.addEventListener('playing', () => {
    video.classList.add('is-ready');
    updatePlaybackButton();
  });
  video.addEventListener('pause', updatePlaybackButton);
  video.addEventListener('error', () => {
    videoFailed = true;
    video.classList.remove('is-ready');
    videoToggle.hidden = true;
  });
  videoToggle.addEventListener('click', () => {
    manuallyPaused = !video.paused;
    if (manuallyPaused) video.pause();
    else playVideo();
  });
  reducedMotion.addEventListener('change', applyPlaybackPreference);
  connection?.addEventListener('change', applyPlaybackPreference);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) video.pause();
    else playVideo();
  });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      header.classList.toggle('is-scrolled', !entry.isIntersecting);
    }).observe(document.querySelector('#header-sentinel'));

    new IntersectionObserver(([entry]) => {
      heroVisible = entry.isIntersecting;
      floatingCta.classList.toggle('is-hidden', heroVisible);
      floatingCta.tabIndex = heroVisible ? -1 : 0;
      if (heroVisible) playVideo();
      else video.pause();
    }).observe(hero);
  }

  // The poster and page remain usable while the decorative video loads.
  const poster = document.querySelector('.hero-poster');
  if (poster.complete) playVideo();
  else {
    poster.addEventListener('load', playVideo, { once: true });
    poster.addEventListener('error', playVideo, { once: true });
  }
})();
