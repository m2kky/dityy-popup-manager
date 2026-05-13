import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, CSSProperties } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";

const POPUP_NAMESPACE = "dityy_popups";
const POPUP_KEY = "config";
const uploadDir = process.env.UPLOAD_DIR || "/data/uploads";

type CampaignType =
  | "announcement"
  | "multi_announcement"
  | "email_signup"
  | "free_shipping"
  | "cross_sell"
  | "countdown";
type DisplayType = "popup" | "bar" | "embed";
type PopupPageMode =
  | "all"
  | "home"
  | "product"
  | "collection"
  | "cart"
  | "url_contains";
type PopupTrigger = "delay" | "scroll" | "exit";
type PopupFrequency = "always" | "session" | "days";
type PopupPosition = "center" | "top" | "bottom";
type DeviceMode = "all" | "desktop" | "mobile";

type PopupStats = {
  views: number;
  clicks: number;
  closes: number;
  leads: number;
};

type LeadRow = {
  id: string;
  popupId: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  path: string | null;
  createdAt: string;
};

type PopupConfig = {
  id: string;
  enabled: boolean;
  name: string;
  campaignType: CampaignType;
  displayType: DisplayType;
  title: string;
  body: string;
  messages: string[];
  imageUrl: string;
  primaryLabel: string;
  primaryUrl: string;
  countdownEndsAt: string;
  collectEmail: boolean;
  collectPhone: boolean;
  leadButtonLabel: string;
  successMessage: string;
  pageMode: PopupPageMode;
  urlContains: string;
  cartMinSubtotal: number;
  cartMaxSubtotal: number;
  deviceMode: DeviceMode;
  trigger: PopupTrigger;
  delaySeconds: number;
  scrollPercent: number;
  frequency: PopupFrequency;
  frequencyDays: number;
  position: PopupPosition;
  priority: number;
  backgroundColor: string;
  textColor: string;
  accentColor: string;
  buttonColor: string;
};

type LoaderData = {
  appInstallationId: string;
  popups: PopupConfig[];
  stats: Record<string, PopupStats>;
  leads: LeadRow[];
};

type ActionData =
  | { ok: true; intent: "save"; popups: PopupConfig[] }
  | { ok: true; intent: "upload"; popupId: string; imageUrl: string }
  | { ok: false; error: string };

const campaignTypes: Array<{
  id: CampaignType;
  label: string;
  description: string;
  tag?: string;
}> = [
  {
    id: "announcement",
    label: "Announcement",
    description: "Display offers, events, restock notes, and urgent messages.",
  },
  {
    id: "multi_announcement",
    label: "Multi-announcement",
    description: "Rotate multiple messages in one campaign.",
  },
  {
    id: "email_signup",
    label: "Email & SMS signup",
    description: "Collect email and phone leads with a storefront form.",
  },
  {
    id: "free_shipping",
    label: "Free shipping",
    description: "Push shoppers toward a cart threshold or free shipping offer.",
  },
  {
    id: "cross_sell",
    label: "Cross-sell offer",
    description: "Promote a collection, bundle, or product add-on.",
  },
  {
    id: "countdown",
    label: "Countdown timer",
    description: "Create urgency around limited-time campaigns.",
  },
];

const displayTypes: Array<{
  id: DisplayType;
  label: string;
  description: string;
}> = [
  {
    id: "bar",
    label: "Bar",
    description: "A slim sticky message at the top or bottom of the storefront.",
  },
  {
    id: "embed",
    label: "Embed",
    description: "An inline banner inserted into the page content.",
  },
  {
    id: "popup",
    label: "Popup",
    description: "A modal campaign that captures attention or leads.",
  },
];

const defaultPopup = (): PopupConfig => ({
  id:
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `popup-${Date.now()}`,
  enabled: true,
  name: "New popup",
  campaignType: "announcement",
  displayType: "popup",
  title: "Your headline goes here",
  body: "Use this space for a clear offer, message, or signup benefit.",
  messages: ["Your first announcement", "Your second announcement"],
  imageUrl: "",
  primaryLabel: "Shop now",
  primaryUrl: "/collections/all",
  countdownEndsAt: "",
  collectEmail: false,
  collectPhone: false,
  leadButtonLabel: "Send",
  successMessage: "Thanks. We received your details.",
  pageMode: "all",
  urlContains: "",
  cartMinSubtotal: 0,
  cartMaxSubtotal: 0,
  deviceMode: "all",
  trigger: "delay",
  delaySeconds: 5,
  scrollPercent: 40,
  frequency: "session",
  frequencyDays: 7,
  position: "center",
  priority: 10,
  backgroundColor: "#ffffff",
  textColor: "#161616",
  accentColor: "#0f6b57",
  buttonColor: "#111111",
});

const numberOrDefault = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const stringOrDefault = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;

const stringArrayOrDefault = (value: unknown, fallback: string[]) => {
  if (!Array.isArray(value)) return fallback;

  const strings = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);

  return strings.length ? strings : fallback;
};

const booleanOrDefault = (value: unknown, fallback = false) =>
  typeof value === "boolean" ? value : fallback;

const enumValue = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
) => (allowed.includes(value as T) ? (value as T) : fallback);

const parsePopups = (value: unknown): PopupConfig[] => {
  if (!Array.isArray(value)) return [];

  return value.map((popup, index) => {
    const base = defaultPopup();
    const record =
      popup && typeof popup === "object"
        ? (popup as Record<string, unknown>)
        : {};

    return {
      ...base,
      id: stringOrDefault(record.id, `popup-${index + 1}`),
      enabled: booleanOrDefault(record.enabled, true),
      name: stringOrDefault(record.name, `Popup ${index + 1}`),
      campaignType: enumValue(record.campaignType, campaignTypes.map((item) => item.id), "announcement"),
      displayType: enumValue(record.displayType, displayTypes.map((item) => item.id), "popup"),
      title: stringOrDefault(record.title, base.title),
      body: stringOrDefault(record.body, base.body),
      messages: stringArrayOrDefault(record.messages, base.messages),
      imageUrl: stringOrDefault(record.imageUrl),
      primaryLabel: stringOrDefault(record.primaryLabel, base.primaryLabel),
      primaryUrl: stringOrDefault(record.primaryUrl, base.primaryUrl),
      countdownEndsAt: stringOrDefault(record.countdownEndsAt),
      collectEmail: booleanOrDefault(record.collectEmail),
      collectPhone: booleanOrDefault(record.collectPhone),
      leadButtonLabel: stringOrDefault(record.leadButtonLabel, base.leadButtonLabel),
      successMessage: stringOrDefault(record.successMessage, base.successMessage),
      pageMode: enumValue(
        record.pageMode,
        ["all", "home", "product", "collection", "cart", "url_contains"] as const,
        "all",
      ),
      urlContains: stringOrDefault(record.urlContains),
      cartMinSubtotal: Math.max(0, numberOrDefault(record.cartMinSubtotal, 0)),
      cartMaxSubtotal: Math.max(0, numberOrDefault(record.cartMaxSubtotal, 0)),
      deviceMode: enumValue(record.deviceMode, ["all", "desktop", "mobile"] as const, "all"),
      trigger: enumValue(record.trigger, ["delay", "scroll", "exit"] as const, "delay"),
      delaySeconds: Math.max(0, numberOrDefault(record.delaySeconds, 5)),
      scrollPercent: Math.min(100, Math.max(1, numberOrDefault(record.scrollPercent, 40))),
      frequency: enumValue(record.frequency, ["always", "session", "days"] as const, "session"),
      frequencyDays: Math.max(1, numberOrDefault(record.frequencyDays, 7)),
      position: enumValue(record.position, ["center", "top", "bottom"] as const, "center"),
      priority: numberOrDefault(record.priority, 10),
      backgroundColor: stringOrDefault(record.backgroundColor, base.backgroundColor),
      textColor: stringOrDefault(record.textColor, base.textColor),
      accentColor: stringOrDefault(record.accentColor, base.accentColor),
      buttonColor: stringOrDefault(record.buttonColor, base.buttonColor),
    };
  });
};

const emptyStats = (): PopupStats => ({
  views: 0,
  clicks: 0,
  closes: 0,
  leads: 0,
});

const getAppUrl = (request: Request) =>
  process.env.SHOPIFY_APP_URL || new URL(request.url).origin;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
      query DityyPopupConfig {
        currentAppInstallation {
          id
          metafield(namespace: "${POPUP_NAMESPACE}", key: "${POPUP_KEY}") {
            value
          }
        }
      }`,
  );
  const json = await response.json();
  const appInstallation = json.data.currentAppInstallation;
  const rawValue = appInstallation.metafield?.value;

  let popups: PopupConfig[] = [];
  if (rawValue) {
    try {
      popups = parsePopups(JSON.parse(rawValue));
    } catch {
      popups = [];
    }
  }

  const eventStats = await prisma.popupEvent.groupBy({
    by: ["popupId", "type"],
    _count: { _all: true },
  });

  const stats = eventStats.reduce<Record<string, PopupStats>>((acc, item) => {
    acc[item.popupId] ||= emptyStats();
    if (item.type === "view") acc[item.popupId].views = item._count._all;
    if (item.type === "click") acc[item.popupId].clicks = item._count._all;
    if (item.type === "close") acc[item.popupId].closes = item._count._all;
    if (item.type === "lead") acc[item.popupId].leads = item._count._all;
    return acc;
  }, {});

  const leads = await prisma.popupLead.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return {
    appInstallationId: appInstallation.id,
    popups,
    stats,
    leads: leads.map((lead) => ({
      id: lead.id,
      popupId: lead.popupId,
      email: lead.email,
      phone: lead.phone,
      name: lead.name,
      path: lead.path,
      createdAt: lead.createdAt.toISOString(),
    })),
  } satisfies LoaderData;
};

const uploadImage = async (request: Request, formData: FormData) => {
  const popupId = formData.get("popupId");
  const file = formData.get("image");

  if (typeof popupId !== "string") {
    return { ok: false, error: "Missing popup id." } satisfies ActionData;
  }

  if (!file || typeof file !== "object" || !("arrayBuffer" in file)) {
    return { ok: false, error: "Choose an image first." } satisfies ActionData;
  }

  const upload = file as File;
  const extension = path.extname(upload.name).toLowerCase();
  const allowed = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

  if (!allowed.has(extension)) {
    return { ok: false, error: "Upload a JPG, PNG, WEBP, or GIF image." } satisfies ActionData;
  }

  if (upload.size > 5 * 1024 * 1024) {
    return { ok: false, error: "Image must be smaller than 5MB." } satisfies ActionData;
  }

  await mkdir(uploadDir, { recursive: true });
  const filename = `${randomUUID()}${extension}`;
  await writeFile(path.join(uploadDir, filename), Buffer.from(await upload.arrayBuffer()));

  return {
    ok: true,
    intent: "upload",
    popupId,
    imageUrl: `${getAppUrl(request)}/uploads/${filename}`,
  } satisfies ActionData;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "upload") {
    return uploadImage(request, formData);
  }

  const payload = formData.get("payload");
  const appInstallationId = formData.get("appInstallationId");

  if (typeof payload !== "string" || typeof appInstallationId !== "string") {
    return { ok: false, error: "Missing popup data." } satisfies ActionData;
  }

  let popups: PopupConfig[];
  try {
    popups = parsePopups(JSON.parse(payload));
  } catch {
    return { ok: false, error: "Popup data is not valid JSON." } satisfies ActionData;
  }

  const response = await admin.graphql(
    `#graphql
      mutation DityySavePopupConfig($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
            namespace
            key
          }
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        metafields: [
          {
            ownerId: appInstallationId,
            namespace: POPUP_NAMESPACE,
            key: POPUP_KEY,
            type: "json",
            value: JSON.stringify(popups),
          },
        ],
      },
    },
  );
  const json = await response.json();
  const userErrors = json.data?.metafieldsSet?.userErrors ?? [];

  if (userErrors.length > 0) {
    return {
      ok: false,
      error: userErrors.map((error: { message: string }) => error.message).join(", "),
    } satisfies ActionData;
  }

  return { ok: true, intent: "save", popups } satisfies ActionData;
};

export default function Index() {
  const loaderData = useLoaderData<typeof loader>();
  const saveFetcher = useFetcher<typeof action>();
  const uploadFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [popups, setPopups] = useState<PopupConfig[]>(loaderData.popups);
  const [activeId, setActiveId] = useState<string | null>(loaderData.popups[0]?.id ?? null);
  const [step, setStep] = useState<"type" | "display" | "editor">(
    loaderData.popups.length ? "editor" : "type",
  );
  const [activePanel, setActivePanel] = useState<"content" | "style" | "targeting" | "automation" | "data">("content");
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");

  const enabledCount = useMemo(() => popups.filter((popup) => popup.enabled).length, [popups]);
  const activePopup = popups.find((popup) => popup.id === activeId) ?? null;
  const activeStats = activePopup ? loaderData.stats[activePopup.id] || emptyStats() : emptyStats();
  const activeLeads = activePopup
    ? loaderData.leads.filter((lead) => lead.popupId === activePopup.id)
    : [];
  const isSaving = saveFetcher.state !== "idle";
  const isUploading = uploadFetcher.state !== "idle";

  useEffect(() => {
    if (saveFetcher.data?.ok && saveFetcher.data.intent === "save") {
      shopify.toast.show("Popups saved");
    } else if (saveFetcher.data?.ok === false) {
      shopify.toast.show(saveFetcher.data.error, { isError: true });
    }
  }, [saveFetcher.data, shopify]);

  useEffect(() => {
    if (uploadFetcher.data?.ok && uploadFetcher.data.intent === "upload") {
      updatePopup(uploadFetcher.data.popupId, "imageUrl", uploadFetcher.data.imageUrl);
      shopify.toast.show("Image uploaded");
    } else if (uploadFetcher.data?.ok === false) {
      shopify.toast.show(uploadFetcher.data.error, { isError: true });
    }
  }, [uploadFetcher.data, shopify]);

  const updatePopup = <Key extends keyof PopupConfig>(
    id: string,
    key: Key,
    value: PopupConfig[Key],
  ) => {
    setPopups((current) =>
      current.map((popup) => (popup.id === id ? { ...popup, [key]: value } : popup)),
    );
  };

  const createCampaign = (campaignType: CampaignType, displayType: DisplayType = "popup") => {
    const popup = {
      ...defaultPopup(),
      campaignType,
      displayType,
      collectEmail: campaignType === "email_signup",
      collectPhone: campaignType === "email_signup",
      name: campaignTypes.find((item) => item.id === campaignType)?.label || "New popup",
      countdownEndsAt:
        campaignType === "countdown"
          ? new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16)
          : "",
    };
    setPopups((current) => [...current, popup]);
    setActiveId(popup.id);
    setStep("display");
  };

  const duplicatePopup = (id: string) => {
    const source = popups.find((popup) => popup.id === id);
    if (!source) return;

    const popup = {
      ...source,
      id: defaultPopup().id,
      name: `${source.name} copy`,
      enabled: false,
    };
    setPopups((current) => [...current, popup]);
    setActiveId(popup.id);
    setStep("editor");
  };

  const removePopup = (id: string) => {
    setPopups((current) => {
      const next = current.filter((popup) => popup.id !== id);
      if (activeId === id) setActiveId(next[0]?.id ?? null);
      if (next.length === 0) setStep("type");
      return next;
    });
  };

  const savePopups = () => {
    saveFetcher.submit(
      {
        intent: "save",
        payload: JSON.stringify(popups),
        appInstallationId: loaderData.appInstallationId,
      },
      { method: "POST" },
    );
  };

  const exportActiveLeads = () => {
    if (!activePopup || activeLeads.length === 0) return;

    const headers = ["createdAt", "campaign", "email", "phone", "name", "path"];
    const rows = activeLeads.map((lead) => [
      lead.createdAt,
      activePopup.name,
      lead.email || "",
      lead.phone || "",
      lead.name || "",
      lead.path || "",
    ]);
    const escapeCell = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => escapeCell(String(cell))).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${activePopup.name || "popup"}-leads.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const submitUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file || !activePopup) return;

    const formData = new FormData();
    formData.append("intent", "upload");
    formData.append("popupId", activePopup.id);
    formData.append("image", file);
    uploadFetcher.submit(formData, { method: "POST", encType: "multipart/form-data" });
    event.currentTarget.value = "";
  };

  const previewStyle = activePopup
    ? ({
        "--preview-bg": activePopup.backgroundColor,
        "--preview-text": activePopup.textColor,
        "--preview-accent": activePopup.accentColor,
        "--preview-button": activePopup.buttonColor,
      } as CSSProperties)
    : undefined;

  return (
    <s-page heading="Dityy Popup Manager">
      <s-button slot="primary-action" onClick={savePopups} {...(isSaving ? { loading: true } : {})}>
        Save popups
      </s-button>

      <div className="dityy-app-shell">
        <aside className="dityy-sidebar">
          <div className="dityy-sidebar__head">
            <span>{popups.length} campaigns</span>
            <button type="button" className="dityy-icon-button" onClick={() => setStep("type")}>
              +
            </button>
          </div>
          {popups.map((popup) => (
            <button
              key={popup.id}
              type="button"
              className={`dityy-campaign-item${popup.id === activeId ? " dityy-campaign-item--active" : ""}`}
              onClick={() => {
                setActiveId(popup.id);
                setStep("editor");
              }}
            >
              <span>{popup.name || "Untitled campaign"}</span>
              <small>
                {popup.enabled ? "Enabled" : "Disabled"} · {popup.displayType}
              </small>
            </button>
          ))}
        </aside>

        <main className="dityy-main">
          {step === "type" && (
            <section className="dityy-card">
              <div className="dityy-step-head">
                <button type="button" className="dityy-back" onClick={() => setStep(activePopup ? "editor" : "type")}>
                  Back
                </button>
                <div>
                  <h2>Select campaign type</h2>
                  <p>Start with a campaign goal. You can change behavior later.</p>
                </div>
              </div>
              <div className="dityy-option-grid">
                {campaignTypes.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="dityy-option-card"
                    onClick={() => createCampaign(item.id)}
                  >
                    <span className="dityy-option-icon">!</span>
                    <strong>{item.label}</strong>
                    {item.tag && <em>{item.tag}</em>}
                    <small>{item.description}</small>
                  </button>
                ))}
              </div>
            </section>
          )}

          {step === "display" && activePopup && (
            <section className="dityy-card">
              <div className="dityy-step-head">
                <button type="button" className="dityy-back" onClick={() => setStep("type")}>
                  Back
                </button>
                <div>
                  <h2>Select display type</h2>
                  <p>Choose how shoppers should see this campaign.</p>
                </div>
              </div>
              <div className="dityy-display-grid">
                {displayTypes.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`dityy-display-card${activePopup.displayType === item.id ? " dityy-display-card--active" : ""}`}
                    onClick={() => {
                      updatePopup(activePopup.id, "displayType", item.id);
                      updatePopup(activePopup.id, "position", item.id === "bar" ? "top" : "center");
                      setStep("editor");
                    }}
                  >
                    <span className={`dityy-display-art dityy-display-art--${item.id}`} />
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>
                  </button>
                ))}
              </div>
            </section>
          )}

          {step === "editor" && activePopup && (
            <section className="dityy-builder">
              <div className="dityy-builder__top">
                <div>
                  <h2>{activePopup.name}</h2>
                  <p>
                    {enabledCount} enabled · {activeStats.views} views · {activeStats.leads} leads
                  </p>
                </div>
                <div className="dityy-actions">
                  <button type="button" className="dityy-secondary" onClick={() => duplicatePopup(activePopup.id)}>
                    Duplicate
                  </button>
                  <button type="button" className="dityy-danger" onClick={() => removePopup(activePopup.id)}>
                    Delete
                  </button>
                </div>
              </div>

              <div className="dityy-builder__grid">
                <div className="dityy-editor">
                  <div className="dityy-tabs">
                    {[
                      ["content", "Announcement"],
                      ["style", "Style"],
                      ["targeting", "Targeting"],
                      ["automation", "Automation"],
                      ["data", "Data"],
                    ].map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        className={activePanel === id ? "active" : ""}
                        onClick={() => setActivePanel(id as typeof activePanel)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {activePanel === "content" && (
                    <div className="dityy-panel">
                      <label className="dityy-check">
                        <input
                          type="checkbox"
                          checked={activePopup.enabled}
                          onChange={(event) => updatePopup(activePopup.id, "enabled", event.currentTarget.checked)}
                        />
                        Enabled
                      </label>
                      <div className="dityy-field-grid">
                        <label>
                          Internal name
                          <input value={activePopup.name} onChange={(event) => updatePopup(activePopup.id, "name", event.currentTarget.value)} />
                        </label>
                        <label>
                          Priority
                          <input type="number" value={activePopup.priority} onChange={(event) => updatePopup(activePopup.id, "priority", Number(event.currentTarget.value))} />
                        </label>
                      </div>
                      <label>
                        Headline
                        <input dir="auto" value={activePopup.title} onChange={(event) => updatePopup(activePopup.id, "title", event.currentTarget.value)} />
                      </label>
                      <label>
                        Description
                        <textarea dir="auto" rows={4} value={activePopup.body} onChange={(event) => updatePopup(activePopup.id, "body", event.currentTarget.value)} />
                      </label>
                      {activePopup.campaignType === "multi_announcement" && (
                        <label>
                          Rotating messages
                          <textarea
                            dir="auto"
                            rows={4}
                            value={activePopup.messages.join("\n")}
                            onChange={(event) =>
                              updatePopup(
                                activePopup.id,
                                "messages",
                                event.currentTarget.value
                                  .split("\n")
                                  .map((item) => item.trim())
                                  .filter(Boolean),
                              )
                            }
                          />
                        </label>
                      )}
                      {activePopup.campaignType === "countdown" && (
                        <label>
                          Countdown ends at
                          <input
                            type="datetime-local"
                            value={activePopup.countdownEndsAt}
                            onChange={(event) => updatePopup(activePopup.id, "countdownEndsAt", event.currentTarget.value)}
                          />
                        </label>
                      )}
                      <div className="dityy-field-grid">
                        <label>
                          Button label
                          <input dir="auto" value={activePopup.primaryLabel} onChange={(event) => updatePopup(activePopup.id, "primaryLabel", event.currentTarget.value)} />
                        </label>
                        <label>
                          Button link
                          <input value={activePopup.primaryUrl} onChange={(event) => updatePopup(activePopup.id, "primaryUrl", event.currentTarget.value)} />
                        </label>
                      </div>
                      <label>
                        Image URL
                        <input value={activePopup.imageUrl} onChange={(event) => updatePopup(activePopup.id, "imageUrl", event.currentTarget.value)} />
                      </label>
                      <label className="dityy-upload">
                        <span>{isUploading ? "Uploading..." : "Upload image from device"}</span>
                        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={submitUpload} disabled={isUploading} />
                      </label>
                    </div>
                  )}

                  {activePanel === "style" && (
                    <div className="dityy-panel">
                      <div className="dityy-field-grid">
                        <label>
                          Display type
                          <select value={activePopup.displayType} onChange={(event) => updatePopup(activePopup.id, "displayType", event.currentTarget.value as DisplayType)}>
                            <option value="popup">Popup</option>
                            <option value="bar">Bar</option>
                            <option value="embed">Embed</option>
                          </select>
                        </label>
                        <label>
                          Position
                          <select value={activePopup.position} onChange={(event) => updatePopup(activePopup.id, "position", event.currentTarget.value as PopupPosition)}>
                            <option value="center">Center</option>
                            <option value="top">Top</option>
                            <option value="bottom">Bottom</option>
                          </select>
                        </label>
                      </div>
                      <div className="dityy-color-grid">
                        <label>
                          Background
                          <input type="color" value={activePopup.backgroundColor} onChange={(event) => updatePopup(activePopup.id, "backgroundColor", event.currentTarget.value)} />
                        </label>
                        <label>
                          Text
                          <input type="color" value={activePopup.textColor} onChange={(event) => updatePopup(activePopup.id, "textColor", event.currentTarget.value)} />
                        </label>
                        <label>
                          Accent
                          <input type="color" value={activePopup.accentColor} onChange={(event) => updatePopup(activePopup.id, "accentColor", event.currentTarget.value)} />
                        </label>
                        <label>
                          Button
                          <input type="color" value={activePopup.buttonColor} onChange={(event) => updatePopup(activePopup.id, "buttonColor", event.currentTarget.value)} />
                        </label>
                      </div>
                    </div>
                  )}

                  {activePanel === "targeting" && (
                    <div className="dityy-panel">
                      <div className="dityy-field-grid">
                        <label>
                          Show on
                          <select value={activePopup.pageMode} onChange={(event) => updatePopup(activePopup.id, "pageMode", event.currentTarget.value as PopupPageMode)}>
                            <option value="all">All pages</option>
                            <option value="home">Home page</option>
                            <option value="product">Product pages</option>
                            <option value="collection">Collection pages</option>
                            <option value="cart">Cart page</option>
                            <option value="url_contains">URL contains</option>
                          </select>
                        </label>
                        <label>
                          URL contains
                          <input value={activePopup.urlContains} disabled={activePopup.pageMode !== "url_contains"} onChange={(event) => updatePopup(activePopup.id, "urlContains", event.currentTarget.value)} />
                        </label>
                        <label>
                          Device
                          <select value={activePopup.deviceMode} onChange={(event) => updatePopup(activePopup.id, "deviceMode", event.currentTarget.value as DeviceMode)}>
                            <option value="all">All devices</option>
                            <option value="desktop">Desktop only</option>
                            <option value="mobile">Mobile only</option>
                          </select>
                        </label>
                        <label>
                          Cart subtotal from
                          <input type="number" min={0} value={activePopup.cartMinSubtotal} onChange={(event) => updatePopup(activePopup.id, "cartMinSubtotal", Number(event.currentTarget.value))} />
                        </label>
                        <label>
                          Cart subtotal to
                          <input type="number" min={0} value={activePopup.cartMaxSubtotal} onChange={(event) => updatePopup(activePopup.id, "cartMaxSubtotal", Number(event.currentTarget.value))} />
                        </label>
                      </div>
                    </div>
                  )}

                  {activePanel === "automation" && (
                    <div className="dityy-panel">
                      <div className="dityy-field-grid">
                        <label>
                          Trigger
                          <select value={activePopup.trigger} onChange={(event) => updatePopup(activePopup.id, "trigger", event.currentTarget.value as PopupTrigger)}>
                            <option value="delay">After seconds</option>
                            <option value="scroll">After scroll</option>
                            <option value="exit">Exit intent</option>
                          </select>
                        </label>
                        <label>
                          Delay seconds
                          <input type="number" min={0} value={activePopup.delaySeconds} onChange={(event) => updatePopup(activePopup.id, "delaySeconds", Number(event.currentTarget.value))} />
                        </label>
                        <label>
                          Scroll percent
                          <input type="number" min={1} max={100} value={activePopup.scrollPercent} onChange={(event) => updatePopup(activePopup.id, "scrollPercent", Number(event.currentTarget.value))} />
                        </label>
                        <label>
                          Frequency
                          <select value={activePopup.frequency} onChange={(event) => updatePopup(activePopup.id, "frequency", event.currentTarget.value as PopupFrequency)}>
                            <option value="always">Every visit</option>
                            <option value="session">Once per session</option>
                            <option value="days">Once every X days</option>
                          </select>
                        </label>
                        <label>
                          Days
                          <input type="number" min={1} value={activePopup.frequencyDays} onChange={(event) => updatePopup(activePopup.id, "frequencyDays", Number(event.currentTarget.value))} />
                        </label>
                      </div>
                    </div>
                  )}

                  {activePanel === "data" && (
                    <div className="dityy-panel">
                      <label className="dityy-check">
                        <input type="checkbox" checked={activePopup.collectEmail} onChange={(event) => updatePopup(activePopup.id, "collectEmail", event.currentTarget.checked)} />
                        Collect email
                      </label>
                      <label className="dityy-check">
                        <input type="checkbox" checked={activePopup.collectPhone} onChange={(event) => updatePopup(activePopup.id, "collectPhone", event.currentTarget.checked)} />
                        Collect phone
                      </label>
                      <div className="dityy-field-grid">
                        <label>
                          Lead button
                          <input value={activePopup.leadButtonLabel} onChange={(event) => updatePopup(activePopup.id, "leadButtonLabel", event.currentTarget.value)} />
                        </label>
                        <label>
                          Success message
                          <input value={activePopup.successMessage} onChange={(event) => updatePopup(activePopup.id, "successMessage", event.currentTarget.value)} />
                        </label>
                      </div>
                      <div className="dityy-stat-grid">
                        <span><strong>{activeStats.views}</strong> Views</span>
                        <span><strong>{activeStats.clicks}</strong> Clicks</span>
                        <span><strong>{activeStats.leads}</strong> Leads</span>
                        <span><strong>{activeStats.closes}</strong> Closes</span>
                      </div>
                      <div className="dityy-leads-head">
                        <strong>Latest leads</strong>
                        <button type="button" className="dityy-secondary" onClick={exportActiveLeads} disabled={!activeLeads.length}>
                          Export CSV
                        </button>
                      </div>
                      <div className="dityy-leads-table">
                        {activeLeads.length === 0 ? (
                          <p>No leads collected yet.</p>
                        ) : (
                          activeLeads.slice(0, 12).map((lead) => (
                            <div key={lead.id} className="dityy-lead-row">
                              <span>{lead.email || "No email"}</span>
                              <span>{lead.phone || "No phone"}</span>
                              <small>{new Date(lead.createdAt).toLocaleString()}</small>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="dityy-preview">
                  <div className="dityy-preview__toolbar">
                    <span>Live preview</span>
                    <div>
                      <button type="button" className={previewDevice === "desktop" ? "active" : ""} onClick={() => setPreviewDevice("desktop")}>Desktop</button>
                      <button type="button" className={previewDevice === "mobile" ? "active" : ""} onClick={() => setPreviewDevice("mobile")}>Mobile</button>
                    </div>
                  </div>
                  <div className={`dityy-preview-stage dityy-preview-stage--${previewDevice}`}>
                    <div className="dityy-preview-skeleton">
                      <span />
                      <span />
                      <span />
                    </div>
                    <div className={`dityy-preview-campaign dityy-preview-campaign--${activePopup.displayType} dityy-preview-campaign--${activePopup.position}`} style={previewStyle}>
                      {activePopup.imageUrl && <img src={activePopup.imageUrl} alt="" />}
                      <div>
                        <strong>{activePopup.title || "Your headline goes here"}</strong>
                        <p>{activePopup.body || "Your description goes here"}</p>
                        {activePopup.campaignType === "multi_announcement" && activePopup.messages.length > 0 && (
                          <div className="dityy-preview-messages">
                            {activePopup.messages.slice(0, 3).map((message) => (
                              <span key={message}>{message}</span>
                            ))}
                          </div>
                        )}
                        {activePopup.campaignType === "countdown" && activePopup.countdownEndsAt && (
                          <div className="dityy-preview-countdown">
                            <span>Days</span>
                            <strong>03</strong>
                            <span>Hours</span>
                            <strong>12</strong>
                            <span>Min</span>
                            <strong>45</strong>
                          </div>
                        )}
                        {(activePopup.collectEmail || activePopup.collectPhone) && (
                          <div className="dityy-preview-lead">
                            {activePopup.collectEmail && <input placeholder="Email" readOnly />}
                            {activePopup.collectPhone && <input placeholder="Phone" readOnly />}
                          </div>
                        )}
                        {activePopup.primaryLabel && <button type="button">{activePopup.primaryLabel}</button>}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}
        </main>
      </div>

      <style>{adminStyles}</style>
    </s-page>
  );
}

const adminStyles = `
  .dityy-app-shell {
    display: grid;
    gap: 18px;
    grid-template-columns: 280px minmax(0, 1fr);
    margin: -12px -8px 0;
  }

  .dityy-sidebar {
    background: #fff;
    border-right: 1px solid #dedede;
    min-height: calc(100vh - 86px);
    padding: 14px;
  }

  .dityy-sidebar__head,
  .dityy-builder__top,
  .dityy-step-head {
    align-items: center;
    display: flex;
    justify-content: space-between;
    gap: 14px;
  }

  .dityy-icon-button,
  .dityy-back {
    background: #fff;
    border: 1px solid #c9c9c9;
    border-radius: 7px;
    cursor: pointer;
    min-height: 34px;
    padding: 6px 12px;
  }

  .dityy-campaign-item {
    background: #fff;
    border: 1px solid transparent;
    border-radius: 8px;
    cursor: pointer;
    display: block;
    margin-top: 10px;
    padding: 12px;
    text-align: left;
    width: 100%;
  }

  .dityy-campaign-item--active {
    background: #f5f5f5;
    border-color: #d8d8d8;
    box-shadow: inset 3px 0 0 #111;
  }

  .dityy-campaign-item span,
  .dityy-campaign-item small {
    display: block;
  }

  .dityy-campaign-item small,
  .dityy-step-head p,
  .dityy-builder__top p {
    color: #616161;
    margin: 4px 0 0;
  }

  .dityy-main {
    padding: 18px 18px 40px 0;
  }

  .dityy-card,
  .dityy-builder {
    background: #fff;
    border: 1px solid #dedede;
    border-radius: 8px;
    box-shadow: 0 1px 2px rgba(0,0,0,.04);
    padding: 22px;
  }

  .dityy-option-grid,
  .dityy-display-grid {
    display: grid;
    gap: 16px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin-top: 22px;
  }

  .dityy-display-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .dityy-option-card,
  .dityy-display-card {
    background: #fff;
    border: 1px solid #cfcfcf;
    border-radius: 8px;
    cursor: pointer;
    min-height: 112px;
    padding: 18px;
    position: relative;
    text-align: left;
  }

  .dityy-display-card {
    text-align: center;
  }

  .dityy-display-card--active {
    background: #f1f1f1;
    border-color: #111;
  }

  .dityy-option-card strong,
  .dityy-option-card small,
  .dityy-display-card strong,
  .dityy-display-card small {
    display: block;
  }

  .dityy-option-card small,
  .dityy-display-card small {
    color: #616161;
    margin-top: 8px;
  }

  .dityy-option-card em {
    background: #bdeeb9;
    border-radius: 999px;
    font-style: normal;
    padding: 3px 8px;
    position: absolute;
    right: 14px;
    top: 14px;
  }

  .dityy-option-icon,
  .dityy-display-art {
    align-items: center;
    background: #ececec;
    border: 1px solid #c9c9c9;
    border-radius: 6px;
    display: inline-flex;
    height: 46px;
    justify-content: center;
    margin-bottom: 10px;
    width: 54px;
  }

  .dityy-builder__top {
    border-bottom: 1px solid #ededed;
    margin-bottom: 18px;
    padding-bottom: 16px;
  }

  .dityy-actions {
    display: flex;
    gap: 8px;
  }

  .dityy-secondary,
  .dityy-danger {
    background: #fff;
    border: 1px solid #c9c9c9;
    border-radius: 6px;
    cursor: pointer;
    min-height: 36px;
    padding: 7px 12px;
  }

  .dityy-danger {
    border-color: #b42318;
    color: #b42318;
  }

  .dityy-builder__grid {
    display: grid;
    gap: 18px;
    grid-template-columns: minmax(360px, 480px) minmax(420px, 1fr);
  }

  .dityy-editor,
  .dityy-preview {
    border: 1px solid #dedede;
    border-radius: 8px;
    overflow: hidden;
  }

  .dityy-tabs {
    background: #f6f6f6;
    border-bottom: 1px solid #dedede;
    display: flex;
    gap: 4px;
    overflow-x: auto;
    padding: 8px;
  }

  .dityy-tabs button,
  .dityy-preview__toolbar button {
    background: transparent;
    border: 0;
    border-radius: 6px;
    cursor: pointer;
    padding: 8px 10px;
  }

  .dityy-tabs button.active,
  .dityy-preview__toolbar button.active {
    background: #111;
    color: #fff;
  }

  .dityy-panel {
    display: grid;
    gap: 14px;
    padding: 18px;
  }

  .dityy-field-grid,
  .dityy-color-grid,
  .dityy-stat-grid {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .dityy-color-grid,
  .dityy-stat-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .dityy-panel label {
    color: #303030;
    font-size: 13px;
    font-weight: 650;
  }

  .dityy-panel input,
  .dityy-panel select,
  .dityy-panel textarea {
    border: 1px solid #b8b8b8;
    border-radius: 6px;
    box-sizing: border-box;
    display: block;
    font: inherit;
    margin-top: 6px;
    min-height: 38px;
    padding: 8px 10px;
    width: 100%;
  }

  .dityy-check input {
    display: inline-block;
    margin-right: 8px;
    min-height: auto;
    width: auto;
  }

  .dityy-upload {
    align-items: center;
    border: 1px dashed #9d9d9d;
    border-radius: 8px;
    cursor: pointer;
    display: flex;
    justify-content: center;
    min-height: 78px;
  }

  .dityy-upload input {
    display: none;
  }

  .dityy-stat-grid span {
    background: #f6f6f6;
    border-radius: 7px;
    padding: 12px;
  }

  .dityy-stat-grid strong {
    display: block;
    font-size: 22px;
  }

  .dityy-leads-head {
    align-items: center;
    display: flex;
    justify-content: space-between;
  }

  .dityy-leads-table {
    border: 1px solid #e1e1e1;
    border-radius: 7px;
    overflow: hidden;
  }

  .dityy-leads-table p {
    color: #616161;
    margin: 0;
    padding: 12px;
  }

  .dityy-lead-row {
    display: grid;
    gap: 8px;
    grid-template-columns: minmax(0, 1fr) minmax(0, 120px) minmax(0, 150px);
    padding: 10px 12px;
  }

  .dityy-lead-row + .dityy-lead-row {
    border-top: 1px solid #ececec;
  }

  .dityy-lead-row span,
  .dityy-lead-row small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dityy-preview__toolbar {
    align-items: center;
    background: #f6f6f6;
    border-bottom: 1px solid #dedede;
    display: flex;
    justify-content: space-between;
    padding: 10px 12px;
  }

  .dityy-preview-stage {
    background: #f3f3f3;
    min-height: 620px;
    padding: 38px;
    position: relative;
  }

  .dityy-preview-stage--mobile {
    margin: 24px auto;
    max-width: 390px;
    min-height: 680px;
  }

  .dityy-preview-skeleton {
    background: #fff;
    border: 1px solid #e1e1e1;
    min-height: 540px;
    padding: 28px;
  }

  .dityy-preview-skeleton span {
    background: #efefef;
    display: block;
    height: 18px;
    margin-bottom: 16px;
    width: 70%;
  }

  .dityy-preview-campaign {
    background: var(--preview-bg);
    border: 1px solid rgba(0,0,0,.12);
    border-radius: 8px;
    color: var(--preview-text);
    left: 50%;
    max-width: 420px;
    padding: 18px;
    position: absolute;
    text-align: center;
    top: 50%;
    transform: translate(-50%, -50%);
    width: calc(100% - 90px);
  }

  .dityy-preview-campaign--bar {
    border-radius: 0;
    left: 38px;
    max-width: none;
    right: 38px;
    top: 38px;
    transform: none;
    width: auto;
  }

  .dityy-preview-campaign--bottom {
    bottom: 38px;
    top: auto;
  }

  .dityy-preview-campaign--embed {
    left: 50%;
    top: 220px;
    transform: translateX(-50%);
  }

  .dityy-preview-campaign img {
    border-radius: 6px;
    display: block;
    max-height: 140px;
    object-fit: cover;
    width: 100%;
    margin-bottom: 12px;
  }

  .dityy-preview-campaign strong {
    display: block;
    font-size: 22px;
    margin-bottom: 6px;
  }

  .dityy-preview-campaign p {
    color: inherit;
    margin: 0 0 14px;
  }

  .dityy-preview-messages,
  .dityy-preview-countdown {
    display: grid;
    gap: 6px;
    margin-bottom: 14px;
  }

  .dityy-preview-messages span {
    background: rgba(0,0,0,.06);
    border-radius: 5px;
    padding: 6px 8px;
  }

  .dityy-preview-countdown {
    align-items: center;
    grid-template-columns: repeat(3, 1fr);
  }

  .dityy-preview-countdown strong {
    background: color-mix(in srgb, var(--preview-accent) 16%, transparent);
    border-radius: 6px;
    font-size: 20px;
    padding: 8px;
  }

  .dityy-preview-countdown span {
    color: inherit;
    font-size: 11px;
    opacity: .72;
  }

  .dityy-preview-campaign button {
    background: var(--preview-button);
    border: 0;
    border-radius: 6px;
    color: #fff;
    min-height: 40px;
    padding: 8px 18px;
  }

  .dityy-preview-lead {
    display: grid;
    gap: 8px;
    margin-bottom: 10px;
  }

  .dityy-preview-lead input {
    border: 1px solid #ddd;
    border-radius: 6px;
    min-height: 38px;
    padding: 8px 10px;
  }

  @media (max-width: 1100px) {
    .dityy-app-shell,
    .dityy-builder__grid {
      grid-template-columns: 1fr;
    }

    .dityy-sidebar {
      min-height: auto;
    }
  }
`;

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
