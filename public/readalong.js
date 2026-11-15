  // Read-along: sticky mini player (moves the ONE audio element — no clone,
  // no desync), sentence highlight + calm auto-follow.
  (function () {
    var audio = document.querySelector(".sermon audio");
    var card = document.querySelector(".sermon");
    if (!audio || !card) return;

    var reduceMotion = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ---- Mini bar: teleport the single audio element in/out ----
    var homeParent = audio.parentNode;
    var homeNext = audio.nextSibling;
    var bar = document.createElement("div");
    bar.id = "tl-minibar";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Sermon audio");
    var label = document.createElement("span");
    label.className = "tl-mini-label";
    var titleEl = document.querySelector("main h1");
    label.textContent = titleEl ? titleEl.textContent.trim() : "Sermon";
    var slot = document.createElement("div");
    slot.className = "tl-mini-slot";
    var followBtn = document.createElement("button");
    followBtn.type = "button";
    followBtn.className = "tl-follow";
    followBtn.textContent = "Following";
    followBtn.setAttribute("aria-pressed", "true");
    bar.appendChild(label);
    bar.appendChild(slot);
    bar.appendChild(followBtn);
    document.body.appendChild(bar);

    var follow = true;
    function setFollow(v) {
      follow = v;
      followBtn.setAttribute("aria-pressed", v ? "true" : "false");
      followBtn.textContent = v ? "Following" : "Follow";
    }
    followBtn.addEventListener("click", function () {
      setFollow(!follow);
      if (follow) {
        // Re-engaging must always be perceivable: jump to the sentence
        // being spoken now, paused or playing. With no active sentence
        // yet (before first play / after ended), anchor to the transcript.
        try { update(audio.currentTime || 0); } catch (e) { /* not loaded */ }
        if (cur >= 0 && spans[cur]) scrollToActive();
        else scrollToTranscript();
      }
    });

    function dockInBar() {
      if (slot.contains(audio)) return;
      slot.appendChild(audio);
      bar.classList.add("is-visible");
    }
    function dockHome() {
      if (!slot.contains(audio)) return;
      homeParent.insertBefore(audio, homeNext);
      bar.classList.remove("is-visible");
    }
    function syncBar() {
      var r = card.getBoundingClientRect();
      // Show once the card has scrolled past (above the viewport).
      if (r.bottom < 0) dockInBar();
      else dockHome();
    }
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function () { syncBar(); }, { threshold: 0 }).observe(card);
    }
    window.addEventListener("scroll", function () {
      if (!window.__tlTick) {
        window.__tlTick = true;
        requestAnimationFrame(function () { window.__tlTick = false; syncBar(); });
      }
    }, { passive: true });
    window.addEventListener("resize", syncBar);
    syncBar();

    // ---- Sentence highlight (binary search over [data-s, data-e]) ----
    var spans = Array.prototype.slice.call(document.querySelectorAll(".tl-s"));
    var starts = spans.map(function (el) { return parseFloat(el.getAttribute("data-s")); });
    var ends = spans.map(function (el) { return parseFloat(el.getAttribute("data-e")); });
    var cur = -1;

    function findIndex(t) {
      if (isNaN(t)) return -1;
      var lo = 0, hi = spans.length - 1, ans = -1;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        if (starts[mid] <= t) { ans = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      if (ans === -1) return -1;
      if (t < ends[ans]) return ans;
      // In a small gap between sentences: hold the nearest finished one
      // briefly so the highlight doesn't flicker off.
      if (ans + 1 < spans.length && t < starts[ans + 1]) return ans;
      return -1;
    }

    function scrollToActive() {
      if (cur < 0 || !spans[cur]) return;
      try {
        spans[cur].scrollIntoView({
          behavior: reduceMotion ? "auto" : "smooth",
          block: "center"
        });
      } catch (e) { /* older browsers */ }
    }

    function scrollToTranscript() {
      var t = document.querySelector(".transcript");
      if (!t) return;
      try {
        t.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      } catch (e) { /* older browsers */ }
    }

    var scheduled = false;
    function update(t) {
      var i = findIndex(t);
      if (i === cur) return;
      if (cur >= 0 && spans[cur]) spans[cur].classList.remove("is-active");
      cur = i;
      if (cur >= 0 && spans[cur]) {
        spans[cur].classList.add("is-active");
        if (follow && !audio.paused) scrollToActive();
      }
    }
    function updateSoon() {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () {
        scheduled = false;
        try { update(audio.currentTime); } catch (e) { /* not loaded */ }
      });
    }

    audio.addEventListener("timeupdate", updateSoon);
    audio.addEventListener("seeked", function () {
      setFollow(true);
      try { update(audio.currentTime); } catch (e) { /* not loaded */ }
      if (!audio.paused) scrollToActive();
    });
    audio.addEventListener("play", function () {
      setFollow(true);
      updateSoon();
    });
    audio.addEventListener("loadedmetadata", updateSoon);

    // Manual scroll wins: pause following while the user scrolls. Gestures
    // that start on the mini player itself (e.g. the tap toggling this
    // very button) are player interaction, not reading, so ignore them —
    // otherwise the tap's own touchmove reverts the toggle before click.
    function interrupt(e) {
      if (e && e.target && bar.contains(e.target)) return;
      if (follow && !audio.paused) setFollow(false);
    }
    window.addEventListener("wheel", interrupt, { passive: true });
    window.addEventListener("touchmove", interrupt, { passive: true });
    window.addEventListener("keydown", function (e) {
      // Space on the pill activates it (click follows); not a scroll-away.
      if (e.key === " " && e.target === followBtn) return;
      var keys = ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "];
      if (keys.indexOf(e.key) !== -1) interrupt(e);
    });

    // Click a sentence to jump there.
    document.querySelector(".transcript").addEventListener("click", function (e) {
      var s = e.target && e.target.closest ? e.target.closest(".tl-s") : null;
      if (!s) return;
      var t = parseFloat(s.getAttribute("data-s"));
      if (isNaN(t)) return;
      try { audio.currentTime = t + 0.01; } catch (err) { /* not loaded */ }
      setFollow(true);
      update(t);
    });
  })();
