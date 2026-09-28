(() => {
  "use strict";

  const header = document.getElementById("site-header");
  const navToggle = document.getElementById("nav-toggle");
  const primaryNav = document.getElementById("primary-nav");
  const dropdownItems = Array.from(document.querySelectorAll(".has-dropdown"));
  const exploreServices = document.getElementById("explore-services");
  const servicesTrigger = document.getElementById("services-trigger");
  const mqMobile = window.matchMedia("(max-width: 992px)");

  if (!header || !navToggle || !primaryNav) {
    return;
  }

  const setScrolled = () => {
    header.classList.toggle("is-scrolled", window.scrollY > 8);
  };

  const closeDropdowns = (except = null) => {
    dropdownItems.forEach((item) => {
      if (item === except) {
        return;
      }

      item.classList.remove("is-open");
      const trigger = item.querySelector(".nav-link--dropdown");
      if (trigger) {
        trigger.setAttribute("aria-expanded", "false");
      }
    });
  };

  const setMenuOpen = (open) => {
    navToggle.setAttribute("aria-expanded", String(open));
    navToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    primaryNav.classList.toggle("is-open", open);
    document.body.style.overflow = open && mqMobile.matches ? "hidden" : "";

    if (!open) {
      closeDropdowns();
    }
  };

  const isMenuOpen = () => navToggle.getAttribute("aria-expanded") === "true";

  navToggle.addEventListener("click", () => {
    setMenuOpen(!isMenuOpen());
  });

  dropdownItems.forEach((item) => {
    const trigger = item.querySelector(".nav-link--dropdown");
    if (!trigger) {
      return;
    }

    trigger.addEventListener("click", (event) => {
      if (trigger instanceof HTMLAnchorElement && trigger.hasAttribute("href")) {
        return;
      }

      event.preventDefault();
      const willOpen = !item.classList.contains("is-open");
      closeDropdowns(willOpen ? item : null);
      item.classList.toggle("is-open", willOpen);
      trigger.setAttribute("aria-expanded", String(willOpen));
    });

    trigger.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeDropdowns();
        trigger.focus();
      }
    });

    item.addEventListener("mouseenter", () => {
      if (mqMobile.matches) {
        return;
      }
      trigger.setAttribute("aria-expanded", "true");
    });

    item.addEventListener("mouseleave", () => {
      if (mqMobile.matches || item.classList.contains("is-open")) {
        return;
      }
      trigger.setAttribute("aria-expanded", "false");
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    closeDropdowns();

    if (isMenuOpen()) {
      setMenuOpen(false);
      navToggle.focus();
    }
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }

    if (!header.contains(target)) {
      closeDropdowns();
      if (isMenuOpen()) {
        setMenuOpen(false);
      }
    }
  });

  primaryNav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      if (mqMobile.matches) {
        setMenuOpen(false);
      } else {
        closeDropdowns();
      }
    });
  });

  const handleViewportChange = () => {
    if (!mqMobile.matches) {
      setMenuOpen(false);
      document.body.style.overflow = "";
    }
  };

  if (typeof mqMobile.addEventListener === "function") {
    mqMobile.addEventListener("change", handleViewportChange);
  } else if (typeof mqMobile.addListener === "function") {
    mqMobile.addListener(handleViewportChange);
  }

  if (exploreServices && servicesTrigger) {
    exploreServices.addEventListener("click", (event) => {
      event.preventDefault();

      if (mqMobile.matches && !isMenuOpen()) {
        setMenuOpen(true);
      }

      closeDropdowns();
      const parent = servicesTrigger.closest(".has-dropdown");
      if (parent) {
        parent.classList.add("is-open");
      }
      servicesTrigger.setAttribute("aria-expanded", "true");
      servicesTrigger.focus();
    });
  }

  window.addEventListener("scroll", setScrolled, { passive: true });
  setScrolled();
})();

(() => {
  "use strict";

  const root = document.querySelector("[data-faq]");
  if (!root) {
    return;
  }

  const tabs = Array.from(root.querySelectorAll("[data-faq-tab]"));
  const panels = Array.from(root.querySelectorAll("[data-faq-panel]"));
  if (!tabs.length || tabs.length !== panels.length) {
    return;
  }

  root.classList.add("is-enhanced");

  const setItemOpen = (item, open) => {
    const trigger = item.querySelector(".faq-item__trigger");
    const answer = item.querySelector(".faq-item__panel");
    if (!trigger || !answer) {
      return;
    }

    item.classList.toggle("is-open", open);
    trigger.setAttribute("aria-expanded", String(open));
    answer.toggleAttribute("hidden", !open);
  };

  const bindAccordion = (panel) => {
    const items = Array.from(panel.querySelectorAll(".faq-item"));

    items.forEach((item) => {
      const trigger = item.querySelector(".faq-item__trigger");
      if (!trigger || trigger.dataset.faqBound === "true") {
        return;
      }

      trigger.dataset.faqBound = "true";

      trigger.addEventListener("click", () => {
        const willOpen = !item.classList.contains("is-open");
        items.forEach((other) =>
          setItemOpen(other, other === item ? willOpen : false)
        );
      });

      trigger.addEventListener("keydown", (event) => {
        const index = items.indexOf(item);
        if (index < 0) {
          return;
        }

        let nextIndex = null;
        if (event.key === "ArrowDown") {
          nextIndex = (index + 1) % items.length;
        } else if (event.key === "ArrowUp") {
          nextIndex = (index - 1 + items.length) % items.length;
        } else if (event.key === "Home") {
          nextIndex = 0;
        } else if (event.key === "End") {
          nextIndex = items.length - 1;
        }

        if (nextIndex === null) {
          return;
        }

        event.preventDefault();
        const nextTrigger = items[nextIndex].querySelector(".faq-item__trigger");
        if (nextTrigger) {
          nextTrigger.focus({ preventScroll: true });
        }
      });
    });
  };

  const restoreScrollTwice = (x, y) => {
    const restore = () => {
      window.scrollTo(x, y);
    };

    restore();
    requestAnimationFrame(() => {
      restore();
      requestAnimationFrame(restore);
    });
  };

  const activateCategory = (
    nextTab,
    { focusTab = false, scrollX = null, scrollY = null } = {}
  ) => {
    const panelId = nextTab.getAttribute("aria-controls");
    const nextPanel = panels.find((panel) => panel.id === panelId);
    if (!nextPanel) {
      return;
    }

    const x = scrollX == null ? window.scrollX : scrollX;
    const y = scrollY == null ? window.scrollY : scrollY;

    const holdScroll = () => {
      if (window.scrollX !== x || window.scrollY !== y) {
        window.scrollTo(x, y);
      }
    };

    window.addEventListener("scroll", holdScroll);

    tabs.forEach((tab) => {
      const selected = tab === nextTab;
      tab.classList.toggle("is-active", selected);
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });

    panels.forEach((panel) => {
      const active = panel === nextPanel;
      panel.classList.toggle("is-active", active);
      panel.toggleAttribute("hidden", !active);

      const items = Array.from(panel.querySelectorAll(".faq-item"));
      items.forEach((item, index) => setItemOpen(item, active && index === 0));
    });

    if (focusTab) {
      nextTab.focus({ preventScroll: true });
    }

    restoreScrollTwice(x, y);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        holdScroll();
        window.removeEventListener("scroll", holdScroll);
        restoreScrollTwice(x, y);
      });
    });
  };

  panels.forEach((panel) => bindAccordion(panel));

  let pointerScroll = null;

  tabs.forEach((tab, index) => {
    tab.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }

      pointerScroll = { x: window.scrollX, y: window.scrollY };

      // Prevent default mouse focus scroll; keep keyboard focus via click handler.
      if (event.pointerType === "mouse") {
        event.preventDefault();
      }
    });

    tab.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const saved = pointerScroll || {
        x: window.scrollX,
        y: window.scrollY,
      };
      pointerScroll = null;

      activateCategory(tab, {
        focusTab: true,
        scrollX: saved.x,
        scrollY: saved.y,
      });
    });

    tab.addEventListener("keydown", (event) => {
      let nextIndex = null;

      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        nextIndex = (index + 1) % tabs.length;
      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        nextIndex = (index - 1 + tabs.length) % tabs.length;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = tabs.length - 1;
      } else if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        activateCategory(tab, {
          focusTab: true,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
        });
        return;
      }

      if (nextIndex === null) {
        return;
      }

      event.preventDefault();
      activateCategory(tabs[nextIndex], {
        focusTab: true,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      });
    });
  });

  const initial =
    tabs.find((tab) => tab.classList.contains("is-active")) || tabs[0];
  activateCategory(initial, {
    focusTab: false,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  });
})();

(() => {
  "use strict";

  const root = document.querySelector("[data-reviews-carousel]");
  if (!root) {
    return;
  }

  const slides = Array.from(root.querySelectorAll("[data-review-slide]"));
  const dots = Array.from(root.querySelectorAll("[data-review-dot]"));
  if (!slides.length || slides.length !== dots.length) {
    return;
  }

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const intervalMs = 3000;
  let index = Math.max(
    0,
    slides.findIndex((slide) => slide.classList.contains("is-active"))
  );
  let timerId = null;
  let interactionPaused = false;
  let touchStartX = 0;
  let touchDeltaX = 0;

  const stopTimer = () => {
    if (timerId !== null) {
      window.clearInterval(timerId);
      timerId = null;
    }
  };

  const canAutoplay = () => !interactionPaused && !reduceMotion.matches;

  const startTimer = () => {
    stopTimer();
    if (!canAutoplay()) {
      return;
    }
    timerId = window.setInterval(() => {
      goTo((index + 1) % slides.length);
    }, intervalMs);
  };

  const goTo = (nextIndex) => {
    slides.forEach((slide, i) => {
      const active = i === nextIndex;
      slide.classList.toggle("is-active", active);
      slide.toggleAttribute("hidden", !active);
      slide.setAttribute("aria-hidden", String(!active));
    });

    dots.forEach((dot, i) => {
      const active = i === nextIndex;
      dot.classList.toggle("is-active", active);
      if (active) {
        dot.setAttribute("aria-current", "true");
      } else {
        dot.removeAttribute("aria-current");
      }
    });

    index = nextIndex;
  };

  dots.forEach((dot, i) => {
    dot.addEventListener("click", () => {
      goTo(i);
      if (canAutoplay()) {
        startTimer();
      }
    });
  });

  const pauseInteraction = () => {
    interactionPaused = true;
    stopTimer();
  };

  const resumeInteraction = () => {
    interactionPaused = false;
    if (canAutoplay()) {
      startTimer();
    }
  };

  root.addEventListener("mouseenter", pauseInteraction);
  root.addEventListener("mouseleave", resumeInteraction);
  root.addEventListener("focusin", pauseInteraction);
  root.addEventListener("focusout", (event) => {
    const next = event.relatedTarget;
    if (next instanceof Node && root.contains(next)) {
      return;
    }
    resumeInteraction();
  });

  root.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      goTo((index + 1) % slides.length);
      if (canAutoplay()) {
        startTimer();
      }
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      goTo((index - 1 + slides.length) % slides.length);
      if (canAutoplay()) {
        startTimer();
      }
    }
  });

  root.addEventListener(
    "touchstart",
    (event) => {
      if (!event.changedTouches.length) {
        return;
      }
      touchStartX = event.changedTouches[0].clientX;
      touchDeltaX = 0;
      pauseInteraction();
    },
    { passive: true }
  );

  root.addEventListener(
    "touchmove",
    (event) => {
      if (!event.changedTouches.length) {
        return;
      }
      touchDeltaX = event.changedTouches[0].clientX - touchStartX;
    },
    { passive: true }
  );

  root.addEventListener(
    "touchend",
    () => {
      if (Math.abs(touchDeltaX) > 40) {
        if (touchDeltaX < 0) {
          goTo((index + 1) % slides.length);
        } else {
          goTo((index - 1 + slides.length) % slides.length);
        }
      }
      resumeInteraction();
      touchStartX = 0;
      touchDeltaX = 0;
    },
    { passive: true }
  );

  const handleMotionChange = () => {
    if (reduceMotion.matches) {
      stopTimer();
    } else if (canAutoplay()) {
      startTimer();
    }
  };

  if (typeof reduceMotion.addEventListener === "function") {
    reduceMotion.addEventListener("change", handleMotionChange);
  } else if (typeof reduceMotion.addListener === "function") {
    reduceMotion.addListener(handleMotionChange);
  }

  goTo(index);
  if (canAutoplay()) {
    startTimer();
  }
})();
