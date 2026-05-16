(function () {
  const roots = document.querySelectorAll("[data-dityy-popups-root]");
  if (!roots.length) return;

  const root = roots[0];
  const eventsUrl = root.getAttribute("data-events-url") || "";
  const query = new URLSearchParams(window.location.search);
  const previewId = query.get("dityy_preview") || "";
  const isPreview = Boolean(previewId);
  let popups = [];
  let parseError = "";

  try {
    popups = JSON.parse(root.getAttribute("data-config") || "[]");
  } catch (error) {
    parseError = error && error.message ? error.message : "Invalid popup configuration";
    popups = [];
  }

  window.DityyPopupManager = {
    root,
    popups: Array.isArray(popups) ? popups : [],
    rejected: [],
    eligible: [],
    shown: [],
    viewed: [],
    previewId,
    isPreview,
    parseError,
  };

  if (!Array.isArray(popups) || !popups.length) {
    if (parseError) {
      console.warn("[Dityy Popup Manager] Could not parse popup config:", parseError);
    }
    return;
  }

  const pageType = root.getAttribute("data-page-type") || "";
  const path = root.getAttribute("data-path") || window.location.pathname;
  const cartSubtotal = (Number(root.getAttribute("data-cart-total") || 0) || 0) / 100;
  const splitList = (value) =>
    String(value || "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  const productTags = splitList(root.getAttribute("data-product-tags"));
  const collectionHandle = String(root.getAttribute("data-collection-handle") || "").trim().toLowerCase();
  const customerTags = splitList(root.getAttribute("data-customer-tags"));
  const country = String(root.getAttribute("data-country") || "").trim().toLowerCase();
  const language = String(root.getAttribute("data-language") || "").trim().toLowerCase();
  let isModalOpen = false;
  let hasShownModal = false;

  window.DityyPopupManager.context = {
    pageType,
    path,
    cartSubtotal,
    productTags,
    collectionHandle,
    customerTags,
    country,
    language,
  };

  const track = (popup, type, extra) => {
    if (isPreview) return;
    if (!eventsUrl || !popup || !popup.id) return;

    const payload = JSON.stringify({
      popupId: popup.id,
      type,
      variant: popup.variant || "a",
      path,
      pageType,
      referrer: document.referrer || "",
      ...(extra || {}),
    });

    if (navigator.sendBeacon) {
      navigator.sendBeacon(eventsUrl, new Blob([payload], { type: "text/plain" }));
      return;
    }

    fetch(eventsUrl, {
      method: "POST",
      mode: "cors",
      headers: { "content-type": "text/plain" },
      body: payload,
      keepalive: true,
    }).catch(function () {});
  };

  const rememberDebug = (key, popup, extra) => {
    if (!window.DityyPopupManager[key]) window.DityyPopupManager[key] = [];
    window.DityyPopupManager[key].push({
      id: popup.id,
      name: popup.name,
      displayType: popup.displayType,
      pageMode: popup.pageMode,
      path,
      ...(extra || {}),
    });
  };

  const trackVisibleView = (element, popup) => {
    let tracked = false;
    const sendView = (source) => {
      if (tracked) return;
      tracked = true;
      rememberDebug("viewed", popup, { source });
      track(popup, "view", { source });
    };

    if (!("IntersectionObserver" in window)) {
      window.setTimeout(() => sendView("fallback"), 400);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry && entry.isIntersecting && entry.intersectionRatio >= 0.25) {
          observer.disconnect();
          sendView("visible");
        }
      },
      { threshold: [0.25, 0.5, 0.75] },
    );

    observer.observe(element);
  };

  const matchesDevice = (popup) => {
    if (!popup.deviceMode || popup.deviceMode === "all") return true;
    const isMobile = window.matchMedia("(max-width: 749px)").matches;
    return popup.deviceMode === "mobile" ? isMobile : !isMobile;
  };

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

  const matchesCart = (popup) => {
    const min = Number(popup.cartMinSubtotal || 0);
    const max = Number(popup.cartMaxSubtotal || 0);

    if (min > 0 && cartSubtotal < min) return false;
    if (max > 0 && cartSubtotal > max) return false;

    return true;
  };

  const formatMoney = (amount) => "EGP " + Math.round(Number(amount) || 0).toLocaleString("en-US");

  const tokenText = (value, popup) => {
    const threshold = Number(popup.freeShippingThreshold || 0) || 1800;
    const remaining = Math.max(0, threshold - cartSubtotal);

    return String(value || "")
      .replaceAll("{remaining_free_shipping}", remaining > 0 ? formatMoney(remaining) : "0")
      .replaceAll("{free_shipping_threshold}", formatMoney(threshold))
      .replaceAll("{cart_total}", formatMoney(cartSubtotal));
  };

  const matchesSchedule = (popup) => {
    const now = Date.now();
    const startsAt = popup.startsAt ? new Date(popup.startsAt).getTime() : 0;
    const endsAt = popup.endsAt ? new Date(popup.endsAt).getTime() : 0;

    if (startsAt && now < startsAt) return false;
    if (endsAt && now > endsAt) return false;

    return true;
  };

  const listRuleMatches = (rule, values) => {
    const rules = splitList(rule);
    if (!rules.length) return true;
    return rules.some((item) => values.includes(item));
  };

  const matchesAdvancedRules = (popup) => {
    if (!listRuleMatches(popup.productTags, productTags)) return false;
    if (!listRuleMatches(popup.customerTags, customerTags)) return false;

    const collectionRules = splitList(popup.collectionHandles);
    if (collectionRules.length && !collectionRules.includes(collectionHandle)) return false;

    const countryRules = splitList(popup.countries);
    if (countryRules.length && !countryRules.includes(country)) return false;

    const languageRules = splitList(popup.languages);
    if (
      languageRules.length &&
      !languageRules.some((item) => language === item || language.startsWith(item + "-"))
    ) {
      return false;
    }

    return true;
  };

  const storageKey = (popup) => "dityy-popup:" + popup.id;

  const canShowByFrequency = (popup) => {
    if (isPreview) return true;
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
    if (isPreview) return;
    if (popup.frequency === "session") {
      window.sessionStorage.setItem(storageKey(popup), "shown");
    }

    if (popup.frequency === "days") {
      window.localStorage.setItem(storageKey(popup), String(Date.now()));
    }
  };

  const variantStorageKey = (popup) => "dityy-popup-variant:" + popup.id;

  const withVariant = (popup) => {
    if (!popup.abTestEnabled) return { ...popup, variant: "a" };

    let variant = window.localStorage.getItem(variantStorageKey(popup));
    if (variant !== "a" && variant !== "b") {
      variant = Math.random() < 0.5 ? "a" : "b";
      window.localStorage.setItem(variantStorageKey(popup), variant);
    }

    if (variant === "b") {
      return {
        ...popup,
        variant,
        title: popup.variantBTitle || popup.title,
        body: popup.variantBBody || popup.body,
        primaryLabel: popup.variantBPrimaryLabel || popup.primaryLabel,
      };
    }

    return { ...popup, variant: "a" };
  };

  const applyColors = (element, popup) => {
    element.style.setProperty("--dityy-popup-bg", popup.backgroundColor || "#ffffff");
    element.style.setProperty("--dityy-popup-text", popup.textColor || "#161616");
    element.style.setProperty("--dityy-popup-accent", popup.accentColor || "#0f6b57");
    element.style.setProperty("--dityy-popup-button", popup.buttonColor || "#111111");
    element.style.setProperty("--dityy-popup-radius", Math.max(0, Number(popup.borderRadius) || 8) + "px");
    element.style.setProperty("--dityy-popup-spacing", Math.max(8, Number(popup.spacing) || 18) + "px");
  };

  const textNode = (tag, className, text) => {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  };

  const formatRemaining = (target) => {
    const remaining = Math.max(0, new Date(target).getTime() - Date.now());
    const days = Math.floor(remaining / 86400000);
    const hours = Math.floor((remaining % 86400000) / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);

    return { days, hours, minutes, seconds };
  };

  const startCountdown = (element, target) => {
    const render = () => {
      const remaining = formatRemaining(target);
      element.innerHTML =
        '<span><strong>' + String(remaining.days).padStart(2, "0") + '</strong><small>Days</small></span>' +
        '<span><strong>' + String(remaining.hours).padStart(2, "0") + '</strong><small>Hours</small></span>' +
        '<span><strong>' + String(remaining.minutes).padStart(2, "0") + '</strong><small>Min</small></span>' +
        '<span><strong>' + String(remaining.seconds).padStart(2, "0") + '</strong><small>Sec</small></span>';
    };

    render();
    window.setInterval(render, 1000);
  };

  const buildCampaign = (popup, displayClass) => {
    const card = document.createElement("div");
    card.className =
      "dityy-popup-card " +
      displayClass +
      " dityy-popup-card--template-" +
      (popup.templateStyle || "clean") +
      " dityy-popup-card--image-" +
      (popup.imagePosition || "top") +
      " dityy-popup-card--font-" +
      (popup.fontFamily || "system");
    applyColors(card, popup);

    if (popup.imageUrl) {
      const image = document.createElement("img");
      image.className = "dityy-popup-card__image";
      image.src = popup.imageUrl;
      image.alt = popup.title || popup.name || "";
      image.loading = "lazy";
      card.appendChild(image);
    }

    const content = document.createElement("div");
    content.className = "dityy-popup-card__content";

    if (popup.title) {
      content.appendChild(textNode("h2", "dityy-popup-card__title", tokenText(popup.title, popup)));
    }

    let bodyElement = null;
    if (popup.body || popup.campaignType === "multi_announcement") {
      const messages =
        popup.campaignType === "multi_announcement" && Array.isArray(popup.messages) && popup.messages.length
          ? popup.messages
          : [popup.body || ""];
      bodyElement = textNode("p", "dityy-popup-card__body", tokenText(messages[0] || popup.body || "", popup));
      content.appendChild(bodyElement);

      if (popup.campaignType === "multi_announcement" && messages.length > 1) {
        let index = 0;
        window.setInterval(() => {
          index = (index + 1) % messages.length;
          bodyElement.textContent = tokenText(messages[index], popup);
        }, 3500);
      }
    }

    if (popup.campaignType === "countdown" && popup.countdownEndsAt) {
      const countdown = document.createElement("div");
      countdown.className = "dityy-popup-card__countdown";
      startCountdown(countdown, popup.countdownEndsAt);
      content.appendChild(countdown);
    }

    if (popup.couponCode) {
      const coupon = document.createElement("button");
      coupon.className = "dityy-popup-card__coupon";
      coupon.type = "button";
      coupon.innerHTML = "<span>" + popup.couponCode + "</span><small>Copy code</small>";
      coupon.addEventListener("click", () => {
        navigator.clipboard?.writeText(popup.couponCode).catch(function () {});
        coupon.querySelector("small").textContent = "Copied";
        track(popup, "click", { action: "coupon_copy" });
      });
      content.appendChild(coupon);
    }

    if (popup.collectName || popup.collectEmail || popup.collectPhone) {
      const form = document.createElement("form");
      form.className = "dityy-popup-card__form";

      if (popup.collectName) {
        const input = document.createElement("input");
        input.name = "name";
        input.type = "text";
        input.placeholder = "Name";
        input.autocomplete = "name";
        form.appendChild(input);
      }

      if (popup.collectEmail) {
        const input = document.createElement("input");
        input.name = "email";
        input.type = "email";
        input.placeholder = "Email";
        input.required = true;
        form.appendChild(input);
      }

      if (popup.collectPhone) {
        const input = document.createElement("input");
        input.name = "phone";
        input.type = "tel";
        input.placeholder = "Phone";
        form.appendChild(input);
      }

      const consentLabel = document.createElement("label");
      consentLabel.className = "dityy-popup-card__consent";
      const consentInput = document.createElement("input");
      consentInput.name = "consent";
      consentInput.type = "checkbox";
      consentInput.required = true;
      consentLabel.appendChild(consentInput);
      consentLabel.appendChild(document.createTextNode(popup.privacyText || "I agree to receive updates."));
      form.appendChild(consentLabel);

      const submit = document.createElement("button");
      submit.type = "submit";
      submit.textContent = popup.leadButtonLabel || "Send";
      form.appendChild(submit);

      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const data = new FormData(form);
        track(popup, "lead", {
          name: String(data.get("name") || ""),
          email: String(data.get("email") || ""),
          phone: String(data.get("phone") || ""),
          consent: data.get("consent") === "on",
        });
        form.replaceWith(textNode("p", "dityy-popup-card__success", popup.successMessage || "Thanks."));

        if (popup.redirectToWhatsApp && popup.whatsappNumber) {
          const number = String(popup.whatsappNumber).replace(/\D/g, "");
          const message = encodeURIComponent(popup.whatsappMessage || popup.title || "Hello");
          window.setTimeout(() => {
            window.open("https://wa.me/" + number + "?text=" + message, "_blank", "noopener");
          }, 450);
        }
      });

      content.appendChild(form);
    }

    if (popup.primaryLabel && popup.primaryUrl) {
      const link = document.createElement("a");
      link.className = "dityy-popup-card__button";
      link.href = popup.primaryUrl;
      link.textContent = popup.primaryLabel;
      link.addEventListener("click", () => track(popup, "click"));
      content.appendChild(link);
    }

    card.appendChild(content);
    return card;
  };

  const closeModal = (popup) => {
    const overlay = document.querySelector(".dityy-popup-overlay");
    if (overlay) overlay.remove();
    document.documentElement.classList.remove("dityy-popup-lock");
    isModalOpen = false;
    if (popup) track(popup, "close");
  };

  const showPopup = (popup) => {
    if (isModalOpen || hasShownModal || !canShowByFrequency(popup)) return;

    isModalOpen = true;
    hasShownModal = true;
    markShown(popup);
    rememberDebug("shown", popup, { source: "popup" });
    track(popup, "view");
    document.documentElement.classList.add("dityy-popup-lock");

    const overlay = document.createElement("div");
    overlay.className = "dityy-popup-overlay dityy-popup-overlay--" + (popup.position || "center");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    const modal = document.createElement("div");
    modal.className = "dityy-popup-modal";

    const closeButton = document.createElement("button");
    closeButton.className = "dityy-popup-card__close";
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Close popup");
    closeButton.textContent = "x";
    closeButton.addEventListener("click", () => closeModal(popup));

    modal.appendChild(closeButton);
    const card = buildCampaign(popup, "dityy-popup-card--popup");
    card.setAttribute("data-dityy-popup-id", popup.id);
    modal.appendChild(card);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeModal(popup);
    });
  };

  const showBar = (popup) => {
    if (!canShowByFrequency(popup)) return;

    markShown(popup);
    const bar = buildCampaign(popup, "dityy-popup-card--bar dityy-popup-card--" + (popup.position || "top"));
    bar.setAttribute("data-dityy-popup-id", popup.id);
    rememberDebug("shown", popup, { source: "bar" });
    const closeButton = document.createElement("button");
    closeButton.className = "dityy-popup-card__close dityy-popup-card__close--bar";
    closeButton.type = "button";
    closeButton.textContent = "x";
    closeButton.addEventListener("click", () => {
      bar.remove();
      track(popup, "close");
    });
    bar.appendChild(closeButton);
    document.body.appendChild(bar);
    trackVisibleView(bar, popup);
  };

  const insertAfter = (element, target) => {
    if (!target || !target.parentNode) {
      document.body.insertBefore(element, document.body.firstChild);
      return;
    }

    target.parentNode.insertBefore(element, target.nextSibling);
  };

  const insertEmbed = (embed, popup) => {
    const placement = popup.embedPlacement || "after_first_section";
    const main = document.querySelector("main") || document.body;

    if (placement === "custom" && popup.embedSelector) {
      const customTarget = document.querySelector(popup.embedSelector);
      if (customTarget) {
        insertAfter(embed, customTarget);
        return;
      }
    }

    if (placement === "after_header") {
      const header = document.querySelector("header, .shopify-section-header, [id*='shopify-section-header']");
      insertAfter(embed, header || main.firstElementChild || main);
      return;
    }

    if (placement === "before_footer") {
      const footer = document.querySelector("footer, .shopify-section-footer, [id*='shopify-section-footer']");
      if (footer && footer.parentNode) {
        footer.parentNode.insertBefore(embed, footer);
        return;
      }
      document.body.appendChild(embed);
      return;
    }

    if (placement === "after_main") {
      insertAfter(embed, main);
      return;
    }

    const firstSection =
      main.querySelector(".shopify-section:not([id*='footer']):not([id*='header'])") ||
      main.querySelector("section") ||
      main.firstElementChild ||
      main;
    insertAfter(embed, firstSection);
  };

  const showEmbed = (popup) => {
    if (!canShowByFrequency(popup)) return;

    markShown(popup);
    const embed = buildCampaign(popup, "dityy-popup-card--embed");
    embed.setAttribute("data-dityy-popup-id", popup.id);
    rememberDebug("shown", popup, { source: "embed" });
    insertEmbed(embed, popup);
    trackVisibleView(embed, popup);
  };

  const rejectionReason = (popup) => {
    if (!popup) return "Invalid campaign data.";
    if (previewId && popup.id !== previewId) return "Another campaign is selected for preview.";
    if (previewId && popup.id === previewId) return "";
    if (!popup.enabled) return "Campaign is disabled.";
    if (!matchesPage(popup)) return "Page rule does not match this page.";
    if (!matchesDevice(popup)) return "Device rule does not match this screen size.";
    if (!matchesCart(popup)) return "Cart subtotal rule does not match this cart.";
    if (!matchesSchedule(popup)) return "Campaign schedule is not active now.";
    if (!matchesAdvancedRules(popup)) return "Advanced targeting rules do not match this page/customer.";
    if (!canShowByFrequency(popup)) return "Frequency rule has already shown this campaign.";
    return "";
  };

  const rejectedPopups = popups
    .map((popup) => ({
      id: popup && popup.id,
      name: popup && popup.name,
      reason: rejectionReason(popup),
    }))
    .filter((item) => item.reason);

  const eligiblePopups = popups
    .filter((popup) => !rejectionReason(popup))
    .map(withVariant)
    .sort((first, second) => Number(second.priority || 0) - Number(first.priority || 0));

  window.DityyPopupManager.rejected = rejectedPopups;
  window.DityyPopupManager.eligible = eligiblePopups.map((popup) => ({
    id: popup.id,
    name: popup.name,
    displayType: popup.displayType,
    pageMode: popup.pageMode,
  }));
  window.DityyPopupManager.resetFrequency = function () {
    popups.forEach((popup) => {
      if (!popup || !popup.id) return;
      window.sessionStorage.removeItem(storageKey(popup));
      window.localStorage.removeItem(storageKey(popup));
      window.localStorage.removeItem(variantStorageKey(popup));
    });
    window.location.reload();
  };
  window.DityyPopupManager.findElements = function () {
    return Array.from(document.querySelectorAll(".dityy-popup-card")).map((element) => ({
      id: element.getAttribute("data-dityy-popup-id") || "",
      className: element.className,
      text: element.textContent.trim().slice(0, 120),
      rect: element.getBoundingClientRect().toJSON ? element.getBoundingClientRect().toJSON() : element.getBoundingClientRect(),
    }));
  };

  if (!eligiblePopups.length) {
    console.info("[Dityy Popup Manager] No campaign matched this page.", rejectedPopups);
    return;
  }

  const renderCampaign = (popup) => {
    if (popup.displayType === "bar") {
      showBar(popup);
      return;
    }

    if (popup.displayType === "embed") {
      showEmbed(popup);
      return;
    }

    showPopup(popup);
  };

  const schedulePopup = (popup) => {
    if (isPreview) {
      renderCampaign(popup);
      return;
    }

    if (popup.displayType === "bar" || popup.displayType === "embed") {
      renderCampaign(popup);
      return;
    }

    if (popup.trigger === "scroll") {
      const onScroll = () => {
        const scrollable = document.documentElement.scrollHeight - window.innerHeight;
        const progress = scrollable <= 0 ? 100 : (window.scrollY / scrollable) * 100;
        if (progress >= Number(popup.scrollPercent || 40)) {
          window.removeEventListener("scroll", onScroll);
          renderCampaign(popup);
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
          renderCampaign(popup);
        }
      };
      document.addEventListener("mouseleave", onMouseLeave);
      return;
    }

    window.setTimeout(() => renderCampaign(popup), Math.max(0, Number(popup.delaySeconds) || 0) * 1000);
  };

  eligiblePopups.forEach(schedulePopup);
})();
