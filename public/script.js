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

  // Hero background parallax in the style of the reference site's Squarespace
  // image-effect-parallax (vertical drift across the viewport traversal,
  // image outrunning the text), dialed up to clearly-visible strength.
  // Skipped for reduced-motion users.
  const heroImgs = Array.from(document.querySelectorAll(".hero-bg img"));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (heroImgs.length && !reduceMotion) {
    let ticking = false;
    const update = () => {
      const vh = window.innerHeight;
      heroImgs.forEach((img) => {
        const hero = img.closest("section");
        if (!hero) return;
        const r = hero.getBoundingClientRect();
        if (r.bottom > 0 && r.top < vh) {
          const progress = Math.min(Math.max((vh - r.top) / (vh + r.height), 0), 1);
          img.style.transform = `scale(1.4) translateY(${((0.5 - progress) * 36).toFixed(2)}%)`;
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
