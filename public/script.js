// Mobile menu + footer year. No framework, no build step.
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.querySelector("[data-menu-toggle]");
  const menu = document.querySelector("[data-mobile-menu]");
  if (btn && menu) {
    btn.addEventListener("click", () => {
      const open = menu.classList.toggle("open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) document.querySelector(".site-header")?.classList.remove("is-hidden");
    });
  }

  // Smart header (all breakpoints): hide on scroll down, reveal on scroll up
  // so navigation is one flick away. Stays pinned while the mobile menu or a
  // desktop dropdown is open, while the pointer is over it, or while keyboard
  // focus is inside it. Transform-only in CSS, so no layout shift.
  const header = document.querySelector(".site-header");
  if (header) {
    let lastY = window.scrollY;
    let ticking = false;
    const HIDE_AFTER = 140; // don't hide until the hero has had its moment
    const TOLERANCE = 8; // ignore tiny jitter / trackpad noise
    const sync = () => {
      ticking = false;
      const y = window.scrollY;
      const engaged =
        (menu && menu.classList.contains("open")) ||
        header.querySelector(".nav-links .open") ||
        header.matches(":hover") ||
        header.contains(document.activeElement);
      if (engaged || y <= HIDE_AFTER) {
        header.classList.remove("is-hidden");
      } else if (y > lastY + TOLERANCE) {
        header.classList.add("is-hidden");
      } else if (y < lastY - TOLERANCE) {
        header.classList.remove("is-hidden");
      }
      lastY = y;
    };
    window.addEventListener("scroll", () => {
      if (!ticking) { requestAnimationFrame(sync); ticking = true; }
    }, { passive: true });
  }
  document.querySelectorAll("[data-year]").forEach((el) => {
    el.textContent = new Date().getFullYear();
  });

  // Transcript "back" links preserve the archive list state: when arriving
  // from /sermons or /podcast with a query string (?q=&...&page=), point the
  // back link at that exact URL so the reader returns to the same list.
  try {
    const back = document.querySelector("a.transcript-back");
    if (back && document.referrer) {
      const r = new URL(document.referrer, window.location.origin);
      const sameOrigin = r.origin === window.location.origin;
      const fromArchive = ["/sermons", "/sermons.html", "/podcast", "/podcast.html"]
        .includes(r.pathname);
      if (sameOrigin && fromArchive && r.search) {
        back.setAttribute("href", r.pathname.replace(/\.html$/, "") + r.search);
      }
    }
  } catch (e) { /* keep the default back-link href */ }

  // Tap/click support for nav dropdowns (touch laptops, and backup for hover).
  // First tap opens the menu; second tap follows the link.
  document.querySelectorAll(".nav-links > li.has-menu > a").forEach((link) => {
    link.addEventListener("click", (e) => {
      const item = link.parentElement;
      if (!item.classList.contains("open")) {
        e.preventDefault();
        document.querySelectorAll(".nav-links > li.has-menu.open").forEach((o) => {
          if (o !== item) o.classList.remove("open");
        });
        item.classList.add("open");
      }
    });
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".nav-links > li.has-menu")) {
      document.querySelectorAll(".nav-links > li.has-menu.open").forEach((o) => o.classList.remove("open"));
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".nav-links > li.has-menu.open").forEach((o) => o.classList.remove("open"));
    }
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
