(function () {
  const roots = document.querySelectorAll("[data-dityy-popups-root]");
  if (!roots.length) return;

  const root = roots[0];
  let popups = [];

  try {
    popups = JSON.parse(root.getAttribute("data-config") || "[]");
  } catch (error) {
    popups = [];
  }

  if (!Array.isArray(popups) || !popups.length) return;

  const pageType = root.getAttribute("data-page-type") || "";
  const path = root.getAttribute("data-path") || window.location.pathname;
  let isOpen = false;
  let hasShown = false;

  const matchesPage = (popup) => {
    switch (popup.pageMode) {
      case "home":
        return pageType === "index" || path === "/";
      case "product":
        return pageType === "product" || path.includes("/products/");
      case "collection":
        return pageType === "collection" || path.includes("/collections/");
      case "cart":
        return pageType === "cart" || path === "/cart";
      case "url_contains":
        return Boolean(popup.urlContains && path.includes(popup.urlContains));
      case "all":
      default:
        return true;
    }
  };

  const storageKey = (popup) => `dityy-popup:${popup.id}`;

  const canShowByFrequency = (popup) => {
    if (popup.frequency === "always") return true;

    if (popup.frequency === "session") {
      return window.sessionStorage.getItem(storageKey(popup)) !== "shown";
    }

    if (popup.frequency === "days") {
      const stored = window.localStorage.getItem(storageKey(popup));
      const lastShown = stored ? Number(stored) : 0;
      const days = Math.max(1, Number(popup.frequencyDays) || 1);
      return Date.now() - lastShown > days * 24 * 60 * 60 * 1000;
    }

    return true;
  };

  const markShown = (popup) => {
    if (popup.frequency === "session") {
      window.sessionStorage.setItem(storageKey(popup), "shown");
    }

    if (popup.frequency === "days") {
      window.localStorage.setItem(storageKey(popup), String(Date.now()));
    }
  };

  const closePopup = () => {
    const overlay = document.querySelector(".dityy-popup-overlay");
    if (overlay) overlay.remove();
    document.documentElement.classList.remove("dityy-popup-lock");
    isOpen = false;
  };

  const textNode = (tag, className, text) => {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  };

  const showPopup = (popup) => {
    if (isOpen || hasShown || !canShowByFrequency(popup)) return;

    isOpen = true;
    hasShown = true;
    markShown(popup);
    document.documentElement.classList.add("dityy-popup-lock");

    const overlay = document.createElement("div");
    overlay.className = "dityy-popup-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    const modal = document.createElement("div");
    modal.className = "dityy-popup";

    const closeButton = document.createElement("button");
    closeButton.className = "dityy-popup__close";
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Close popup");
    closeButton.textContent = "×";
    closeButton.addEventListener("click", closePopup);

    modal.appendChild(closeButton);

    if (popup.imageUrl) {
      const image = document.createElement("img");
      image.className = "dityy-popup__image";
      image.src = popup.imageUrl;
      image.alt = popup.title || popup.name || "";
      image.loading = "lazy";
      modal.appendChild(image);
    }

    const content = document.createElement("div");
    content.className = "dityy-popup__content";

    if (popup.title) {
      content.appendChild(textNode("h2", "dityy-popup__title", popup.title));
    }

    if (popup.body) {
      content.appendChild(textNode("p", "dityy-popup__body", popup.body));
    }

    if (popup.primaryLabel && popup.primaryUrl) {
      const actions = document.createElement("div");
      actions.className = "dityy-popup__actions";
      const link = document.createElement("a");
      link.className = "dityy-popup__button";
      link.href = popup.primaryUrl;
      link.textContent = popup.primaryLabel;
      link.addEventListener("click", closePopup);
      actions.appendChild(link);
      content.appendChild(actions);
    }

    modal.appendChild(content);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closePopup();
    });
  };

  const eligiblePopups = popups
    .filter((popup) => popup && popup.enabled && matchesPage(popup))
    .filter(canShowByFrequency)
    .sort((first, second) => Number(second.priority || 0) - Number(first.priority || 0));

  if (!eligiblePopups.length) return;

  const schedulePopup = (popup) => {
    if (popup.trigger === "scroll") {
      const onScroll = () => {
        const scrollable = document.documentElement.scrollHeight - window.innerHeight;
        const progress = scrollable <= 0 ? 100 : (window.scrollY / scrollable) * 100;
        if (progress >= Number(popup.scrollPercent || 40)) {
          window.removeEventListener("scroll", onScroll);
          showPopup(popup);
        }
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
      return;
    }

    if (popup.trigger === "exit") {
      const onMouseLeave = (event) => {
        if (event.clientY <= 0) {
          document.removeEventListener("mouseleave", onMouseLeave);
          showPopup(popup);
        }
      };
      document.addEventListener("mouseleave", onMouseLeave);
      return;
    }

    window.setTimeout(() => showPopup(popup), Math.max(0, Number(popup.delaySeconds) || 0) * 1000);
  };

  eligiblePopups.forEach(schedulePopup);
})();
