// Mobile menu + footer year. No framework, no build step.
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.querySelector("[data-menu-toggle]");
  const menu = document.querySelector("[data-mobile-menu]");
  if (btn && menu) {
    btn.addEventListener("click", () => {
      const open = menu.classList.toggle("open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }
  document.querySelectorAll("[data-year]").forEach((el) => {
    el.textContent = new Date().getFullYear();
  });

  // Subtle parallax on hero imagery (skipped for reduced-motion users).
  const heroImgs = Array.from(document.querySelectorAll(".hero-bg img"));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (heroImgs.length && !reduceMotion) {
    let ticking = false;
    const update = () => {
      heroImgs.forEach((img) => {
        const hero = img.closest("section");
        if (!hero) return;
        const r = hero.getBoundingClientRect();
        if (r.bottom > 0 && r.top < window.innerHeight) {
          const progress = Math.min(Math.max(-r.top / r.height, 0), 1);
          img.style.transform = `scale(1.2) translateY(${(progress * 10).toFixed(2)}%)`;
          // Text drifts up faster than the image and fades — prominent scroll separation.
          const content = hero.querySelector(".hero-inner");
          if (content) {
            content.style.transform = `translateY(${(-progress * 160).toFixed(1)}px)`;
            content.style.opacity = (1 - progress * 0.75).toFixed(3);
          }
        }
      });
      ticking = false;
    };
    window.addEventListener("scroll", () => {
      if (!ticking) { requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    update();
  }
});
