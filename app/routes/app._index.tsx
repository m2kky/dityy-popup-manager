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
const POPUP_JSON_KEY = "config_json";
const uploadDir = process.env.UPLOAD_DIR || "/data/uploads";
const INTEGRATIONS_SETTING_KEY = "integrations";

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

type DailyStat = {
  date: string;
  views: number;
  clicks: number;
  leads: number;
};

type VariantStats = {
  a: PopupStats;
  b: PopupStats;
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
  templateStyle: "clean" | "split" | "dark" | "coupon" | "minimal";
  imageUrl: string;
  imagePosition: "top" | "left" | "right" | "background";
  primaryLabel: string;
  primaryUrl: string;
  couponCode: string;
  countdownEndsAt: string;
  collectName: boolean;
  collectEmail: boolean;
  collectPhone: boolean;
  leadButtonLabel: string;
  successMessage: string;
  privacyText: string;
  redirectToWhatsApp: boolean;
  whatsappNumber: string;
  whatsappMessage: string;
  pageMode: PopupPageMode;
  urlContains: string;
  cartMinSubtotal: number;
  cartMaxSubtotal: number;
  productTags: string;
  collectionHandles: string;
  customerTags: string;
  countries: string;
  languages: string;
  startsAt: string;
  endsAt: string;
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
  borderRadius: number;
  fontFamily: "system" | "serif" | "mono";
  spacing: number;
  abTestEnabled: boolean;
  variantBTitle: string;
  variantBBody: string;
  variantBPrimaryLabel: string;
};

type LoaderData = {
  appInstallationId: string;
  popups: PopupConfig[];
  stats: Record<string, PopupStats>;
  variantStats: Record<string, VariantStats>;
  dailyStats: Record<string, DailyStat[]>;
  leads: LeadRow[];
  integrations: IntegrationConfig;
};

type IntegrationConfig = {
  googleSheetsWebhookUrl: string;
  klaviyoApiKey: string;
  klaviyoListId: string;
  mailchimpApiKey: string;
  mailchimpServerPrefix: string;
  mailchimpListId: string;
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

type PopupPreset = {
  id: string;
  label: string;
  patch: Partial<PopupConfig>;
};

const popupPresets: PopupPreset[] = [
  {
    id: "flash-offer",
    label: "Flash offer",
    patch: {
      title: "عرض لفترة محدودة",
      body: "خصم خاص على منتجات مختارة. اطلب قبل انتهاء العرض.",
      primaryLabel: "تسوق العرض",
      primaryUrl: "/collections/all",
      backgroundColor: "#0f6b57",
      textColor: "#ffffff",
      accentColor: "#f3d35b",
      buttonColor: "#f3d35b",
      couponCode: "DIET10",
      borderRadius: 16,
    },
  },
  {
    id: "lead-capture",
    label: "Lead capture",
    patch: {
      campaignType: "email_signup",
      title: "خليك أول واحد يعرف العروض",
      body: "سيب بياناتك وهنبعتلك أحدث الخصومات والمنتجات الجديدة.",
      collectName: true,
      collectEmail: true,
      collectPhone: true,
      leadButtonLabel: "سجلني",
      successMessage: "تم التسجيل. هنتواصل معاك قريب.",
      borderRadius: 18,
    },
  },
  {
    id: "whatsapp-followup",
    label: "WhatsApp follow-up",
    patch: {
      campaignType: "email_signup",
      title: "محتاج مساعدة في اختيار المنتج؟",
      body: "سيب رقمك وافتح واتساب مباشرة عشان نساعدك.",
      collectName: true,
      collectPhone: true,
      leadButtonLabel: "كلمنا على واتساب",
      redirectToWhatsApp: true,
      whatsappMessage: "أهلا، محتاج مساعدة في اختيار منتجات مناسبة من دايتي.",
      buttonColor: "#18a558",
    },
  },
  {
    id: "free-shipping",
    label: "Free shipping",
    patch: {
      campaignType: "free_shipping",
      displayType: "bar",
      position: "top",
      title: "الشحن مجاني للطلبات فوق 1800 جنيه",
      body: "كمل طلبك واستفيد من الشحن المجاني.",
      primaryLabel: "تسوق الآن",
      cartMaxSubtotal: 1799,
      backgroundColor: "#111827",
      textColor: "#ffffff",
      buttonColor: "#ffffff",
    },
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
  templateStyle: "clean",
  imageUrl: "",
  imagePosition: "top",
  primaryLabel: "Shop now",
  primaryUrl: "/collections/all",
  couponCode: "",
  countdownEndsAt: "",
  collectName: false,
  collectEmail: false,
  collectPhone: false,
  leadButtonLabel: "Send",
  successMessage: "Thanks. We received your details.",
  privacyText: "I agree to receive updates and accept the privacy policy.",
  redirectToWhatsApp: false,
  whatsappNumber: "",
  whatsappMessage: "Thanks for registering. We will contact you shortly.",
  pageMode: "all",
  urlContains: "",
  cartMinSubtotal: 0,
  cartMaxSubtotal: 0,
  productTags: "",
  collectionHandles: "",
  customerTags: "",
  countries: "",
  languages: "",
  startsAt: "",
  endsAt: "",
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
  borderRadius: 12,
  fontFamily: "system",
  spacing: 18,
  abTestEnabled: false,
  variantBTitle: "Your alternate headline",
  variantBBody: "Use this alternate message for A/B testing.",
  variantBPrimaryLabel: "Learn more",
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
      templateStyle: enumValue(record.templateStyle, ["clean", "split", "dark", "coupon", "minimal"] as const, "clean"),
      imageUrl: stringOrDefault(record.imageUrl),
      imagePosition: enumValue(record.imagePosition, ["top", "left", "right", "background"] as const, "top"),
      primaryLabel: stringOrDefault(record.primaryLabel, base.primaryLabel),
      primaryUrl: stringOrDefault(record.primaryUrl, base.primaryUrl),
      couponCode: stringOrDefault(record.couponCode),
      countdownEndsAt: stringOrDefault(record.countdownEndsAt),
      collectName: booleanOrDefault(record.collectName),
      collectEmail: booleanOrDefault(record.collectEmail),
      collectPhone: booleanOrDefault(record.collectPhone),
      leadButtonLabel: stringOrDefault(record.leadButtonLabel, base.leadButtonLabel),
      successMessage: stringOrDefault(record.successMessage, base.successMessage),
      privacyText: stringOrDefault(record.privacyText, base.privacyText),
      redirectToWhatsApp: booleanOrDefault(record.redirectToWhatsApp),
      whatsappNumber: stringOrDefault(record.whatsappNumber),
      whatsappMessage: stringOrDefault(record.whatsappMessage, base.whatsappMessage),
      pageMode: enumValue(
        record.pageMode,
        ["all", "home", "product", "collection", "cart", "url_contains"] as const,
        "all",
      ),
      urlContains: stringOrDefault(record.urlContains),
      cartMinSubtotal: Math.max(0, numberOrDefault(record.cartMinSubtotal, 0)),
      cartMaxSubtotal: Math.max(0, numberOrDefault(record.cartMaxSubtotal, 0)),
      productTags: stringOrDefault(record.productTags),
      collectionHandles: stringOrDefault(record.collectionHandles),
      customerTags: stringOrDefault(record.customerTags),
      countries: stringOrDefault(record.countries),
      languages: stringOrDefault(record.languages),
      startsAt: stringOrDefault(record.startsAt),
      endsAt: stringOrDefault(record.endsAt),
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
      borderRadius: Math.min(32, Math.max(0, numberOrDefault(record.borderRadius, base.borderRadius))),
      fontFamily: enumValue(record.fontFamily, ["system", "serif", "mono"] as const, "system"),
      spacing: Math.min(40, Math.max(8, numberOrDefault(record.spacing, base.spacing))),
      abTestEnabled: booleanOrDefault(record.abTestEnabled),
      variantBTitle: stringOrDefault(record.variantBTitle, base.variantBTitle),
      variantBBody: stringOrDefault(record.variantBBody, base.variantBBody),
      variantBPrimaryLabel: stringOrDefault(record.variantBPrimaryLabel, base.variantBPrimaryLabel),
    };
  });
};

const emptyStats = (): PopupStats => ({
  views: 0,
  clicks: 0,
  closes: 0,
  leads: 0,
});

const emptyVariantStats = (): VariantStats => ({
  a: emptyStats(),
  b: emptyStats(),
});

const emptyIntegrations = (): IntegrationConfig => ({
  googleSheetsWebhookUrl: "",
  klaviyoApiKey: "",
  klaviyoListId: "",
  mailchimpApiKey: "",
  mailchimpServerPrefix: "",
  mailchimpListId: "",
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
          jsonMetafield: metafield(namespace: "${POPUP_NAMESPACE}", key: "${POPUP_JSON_KEY}") {
            value
          }
        }
      }`,
  );
  const json = await response.json();
  const appInstallation = json.data.currentAppInstallation;
  const rawValue = appInstallation.jsonMetafield?.value || appInstallation.metafield?.value;

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

  const eventVariantStats = await prisma.popupEvent.groupBy({
    by: ["popupId", "type", "variant"],
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

  const variantStats = eventVariantStats.reduce<Record<string, VariantStats>>((acc, item) => {
    acc[item.popupId] ||= emptyVariantStats();
    const variant = item.variant === "b" ? "b" : "a";
    if (item.type === "view") acc[item.popupId][variant].views = item._count._all;
    if (item.type === "click") acc[item.popupId][variant].clicks = item._count._all;
    if (item.type === "lead") acc[item.popupId][variant].leads = item._count._all;
    if (item.type === "close") acc[item.popupId][variant].closes = item._count._all;
    return acc;
  }, {});

  const recentEvents = await prisma.popupEvent.findMany({
    where: {
      createdAt: {
        gte: new Date(Date.now() - 13 * 24 * 60 * 60 * 1000),
      },
    },
    select: {
      popupId: true,
      type: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const dailyStats = recentEvents.reduce<Record<string, DailyStat[]>>((acc, event) => {
    const date = event.createdAt.toISOString().slice(0, 10);
    acc[event.popupId] ||= [];
    let row = acc[event.popupId].find((item) => item.date === date);
    if (!row) {
      row = { date, views: 0, clicks: 0, leads: 0 };
      acc[event.popupId].push(row);
    }
    if (event.type === "view") row.views += 1;
    if (event.type === "click") row.clicks += 1;
    if (event.type === "lead") row.leads += 1;
    return acc;
  }, {});

  const leads = await prisma.popupLead.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const integrationSetting = await prisma.appSetting.findUnique({
    where: { key: INTEGRATIONS_SETTING_KEY },
  });
  let integrations = emptyIntegrations();
  if (integrationSetting) {
    try {
      integrations = { ...integrations, ...JSON.parse(integrationSetting.value) };
    } catch {
      integrations = emptyIntegrations();
    }
  }

  return {
    appInstallationId: appInstallation.id,
    popups,
    stats,
    variantStats,
    dailyStats,
    leads: leads.map((lead) => ({
      id: lead.id,
      popupId: lead.popupId,
      email: lead.email,
      phone: lead.phone,
      name: lead.name,
      path: lead.path,
      createdAt: lead.createdAt.toISOString(),
    })),
    integrations,
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
  const integrationsPayload = formData.get("integrations");
  const appInstallationId = formData.get("appInstallationId");

  if (typeof payload !== "string" || typeof integrationsPayload !== "string" || typeof appInstallationId !== "string") {
    return { ok: false, error: "Missing popup data." } satisfies ActionData;
  }

  let popups: PopupConfig[];
  let integrations: IntegrationConfig;
  try {
    popups = parsePopups(JSON.parse(payload));
    integrations = { ...emptyIntegrations(), ...JSON.parse(integrationsPayload) };
  } catch {
    return { ok: false, error: "Popup data is not valid JSON." } satisfies ActionData;
  }

  const popupPayload = JSON.stringify(popups);
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
            value: popupPayload,
          },
          {
            ownerId: appInstallationId,
            namespace: POPUP_NAMESPACE,
            key: POPUP_JSON_KEY,
            type: "multi_line_text_field",
            value: popupPayload,
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

  await prisma.appSetting.upsert({
    where: { key: INTEGRATIONS_SETTING_KEY },
    create: {
      key: INTEGRATIONS_SETTING_KEY,
      value: JSON.stringify(integrations),
    },
    update: {
      value: JSON.stringify(integrations),
    },
  });

  return { ok: true, intent: "save", popups } satisfies ActionData;
};

export default function Index() {
  const loaderData = useLoaderData<typeof loader>();
  const saveFetcher = useFetcher<typeof action>();
  const uploadFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [popups, setPopups] = useState<PopupConfig[]>(loaderData.popups);
  const [integrations, setIntegrations] = useState<IntegrationConfig>(loaderData.integrations);
  const [activeId, setActiveId] = useState<string | null>(loaderData.popups[0]?.id ?? null);
  const [step, setStep] = useState<"type" | "display" | "editor">(
    loaderData.popups.length ? "editor" : "type",
  );
  const [panelView, setPanelView] = useState<"menu" | "detail">("menu");
  const [activePanel, setActivePanel] = useState<"content" | "style" | "targeting" | "automation" | "data" | "integrations">("content");
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");
  const [previewMode, setPreviewMode] = useState<"product" | "cart">("product");
  const [leadSearch, setLeadSearch] = useState("");
  const [leadDateFrom, setLeadDateFrom] = useState("");
  const [leadDateTo, setLeadDateTo] = useState("");
  const [savedSnapshot, setSavedSnapshot] = useState(() =>
    JSON.stringify({ popups: loaderData.popups, integrations: loaderData.integrations }),
  );

  const enabledCount = useMemo(() => popups.filter((popup) => popup.enabled).length, [popups]);
  const currentSnapshot = useMemo(() => JSON.stringify({ popups, integrations }), [popups, integrations]);
  const hasUnsavedChanges = currentSnapshot !== savedSnapshot;
  const activePopup = popups.find((popup) => popup.id === activeId) ?? null;
  const activeStats = activePopup ? loaderData.stats[activePopup.id] || emptyStats() : emptyStats();
  const activeLeads = activePopup
    ? loaderData.leads
        .filter((lead) => lead.popupId === activePopup.id)
        .filter((lead) => {
          const search = leadSearch.trim().toLowerCase();
          const createdAt = lead.createdAt.slice(0, 10);
          if (search && !`${lead.name || ""} ${lead.email || ""} ${lead.phone || ""}`.toLowerCase().includes(search)) return false;
          if (leadDateFrom && createdAt < leadDateFrom) return false;
          if (leadDateTo && createdAt > leadDateTo) return false;
          return true;
        })
    : [];
  const activeCtr = activeStats.views ? Math.round((activeStats.clicks / activeStats.views) * 1000) / 10 : 0;
  const activeLeadRate = activeStats.views ? Math.round((activeStats.leads / activeStats.views) * 1000) / 10 : 0;
  const activeVariantStats = activePopup ? loaderData.variantStats[activePopup.id] || emptyVariantStats() : emptyVariantStats();
  const activeDailyStats = activePopup ? loaderData.dailyStats[activePopup.id] || [] : [];
  const visibilityNotes = activePopup
    ? [
        activePopup.displayType === "popup"
          ? `Popup opens ${activePopup.trigger === "delay" ? `after ${activePopup.delaySeconds}s` : activePopup.trigger === "scroll" ? `after ${activePopup.scrollPercent}% scroll` : "on exit intent"}.`
          : activePopup.displayType === "bar"
            ? `Bar appears fixed at the ${activePopup.position === "bottom" ? "bottom" : "top"} as soon as rules match.`
            : "Embed appears inline after the product form, or after the main page content if there is no product form.",
        activePopup.pageMode === "all"
          ? "Page rule: all pages."
          : activePopup.pageMode === "url_contains"
            ? `Page rule: URLs containing "${activePopup.urlContains || "..."}".`
            : `Page rule: ${activePopup.pageMode} page.`,
      ]
    : [];
  const visibilityWarnings = activePopup
    ? [
        activePopup.pageMode !== "product" && activePopup.productTags.trim()
          ? "Product tags only exist on product pages. This rule can block home/cart/collection pages."
          : "",
        activePopup.pageMode !== "collection" && activePopup.collectionHandles.trim()
          ? "Collection handles only exist on collection pages. This rule can block other pages."
          : "",
        activePopup.cartMinSubtotal > 0 && activePopup.pageMode !== "cart"
          ? "Cart subtotal can be 0 on normal page loads. A minimum cart value can hide this campaign."
          : "",
        activePopup.displayType !== "popup" && activePopup.trigger !== "delay"
          ? "Scroll and exit triggers only apply to popups. Bars and embeds render immediately when rules match."
          : "",
      ].filter(Boolean)
    : [];
  const isSaving = saveFetcher.state !== "idle";
  const isUploading = uploadFetcher.state !== "idle";

  useEffect(() => {
    if (saveFetcher.data?.ok && saveFetcher.data.intent === "save") {
      setSavedSnapshot(JSON.stringify({ popups: saveFetcher.data.popups, integrations }));
      shopify.toast.show("Popups saved");
    } else if (saveFetcher.data?.ok === false) {
      shopify.toast.show(saveFetcher.data.error, { isError: true });
    }
  }, [integrations, saveFetcher.data, shopify]);

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

  const updateIntegration = <Key extends keyof IntegrationConfig>(
    key: Key,
    value: IntegrationConfig[Key],
  ) => {
    setIntegrations((current) => ({ ...current, [key]: value }));
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

  const applyPreset = (preset: PopupPreset) => {
    if (!activePopup) return;

    setPopups((current) =>
      current.map((popup) =>
        popup.id === activePopup.id
          ? {
              ...popup,
              ...preset.patch,
            }
          : popup,
      ),
    );
  };

  const savePopups = () => {
    saveFetcher.submit(
      {
        intent: "save",
        payload: JSON.stringify(popups),
        integrations: JSON.stringify(integrations),
        appInstallationId: loaderData.appInstallationId,
      },
      { method: "POST" },
    );
  };

  const saveActivePopup = () => {
    if (!activePopup) return;
    savePopups();
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
        "--preview-radius": `${activePopup.borderRadius}px`,
        "--preview-spacing": `${activePopup.spacing}px`,
      } as CSSProperties)
    : undefined;
  const panelItems: Array<{
    id: typeof activePanel;
    label: string;
    description: string;
    badge?: string;
  }> = [
    { id: "content", label: "Announcement", description: "Text, CTA, images, coupon" },
    { id: "style", label: "Style & Behavior", description: "Template, colors, spacing" },
    { id: "targeting", label: "Targeting", description: "Pages, products, audience", badge: "Rules" },
    { id: "automation", label: "Automation", description: "Trigger, frequency, A/B" },
    { id: "data", label: "Data", description: "Leads, consent, analytics" },
    { id: "integrations", label: "Integrations", description: "Sheets, Klaviyo, Mailchimp" },
  ];
  const activePanelItem = panelItems.find((item) => item.id === activePanel) || panelItems[0];

  return (
    <s-page heading="Dityy Popup Manager">
      <s-button slot="primary-action" onClick={savePopups} {...(isSaving ? { loading: true } : {})}>
        Save popups
      </s-button>

      <div className={`dityy-save-banner${hasUnsavedChanges ? " dityy-save-banner--dirty" : ""}`}>
        <span>{hasUnsavedChanges ? "Unsaved changes" : "Saved"}</span>
        <small>{hasUnsavedChanges ? "Review the preview, then save to publish your latest popup settings." : "Your latest configuration is stored."}</small>
      </div>

      <div className="dityy-app-shell">
        <aside className="dityy-sidebar">
          <div className="dityy-sidebar__head">
            <div>
              <strong>Campaigns</strong>
              <span>{popups.length} total · {enabledCount} live</span>
            </div>
            <button type="button" className="dityy-icon-button" onClick={() => setStep("type")}>
              +
            </button>
          </div>
          <div className="dityy-sidebar__metrics">
            <span><strong>{Object.values(loaderData.stats).reduce((total, item) => total + item.views, 0)}</strong> views</span>
            <span><strong>{Object.values(loaderData.stats).reduce((total, item) => total + item.leads, 0)}</strong> leads</span>
          </div>
          <div className="dityy-campaign-strip">
            {popups.map((popup) => (
              <button
                key={popup.id}
                type="button"
                className={`dityy-campaign-item${popup.id === activeId ? " dityy-campaign-item--active" : ""}`}
                onClick={() => {
                  setActiveId(popup.id);
                  setStep("editor");
                  setPanelView("menu");
                }}
              >
                <span>{popup.name || "Untitled campaign"}</span>
                <small>
                  {popup.enabled ? "Live" : "Paused"} · {popup.displayType} · {popup.campaignType.replace("_", " ")}
                </small>
              </button>
            ))}
          </div>
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
                  <button type="button" className="dityy-primary" onClick={saveActivePopup} disabled={isSaving}>
                    Save this campaign
                  </button>
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
                  <div className="dityy-editor__head">
                    <button
                      type="button"
                      className="dityy-back-link"
                      onClick={() => {
                        if (panelView === "detail") {
                          setPanelView("menu");
                          return;
                        }
                        setStep("type");
                      }}
                    >
                      Back
                    </button>
                    <strong>{panelView === "detail" ? activePanelItem.label : "Campaign settings"}</strong>
                    <span>{activePopup.enabled ? "Draft saved locally" : "Paused"}</span>
                  </div>
                  {panelView === "menu" && (
                    <div className="dityy-tabs">
                      {panelItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={activePanel === item.id ? "active" : ""}
                          onClick={() => {
                            setActivePanel(item.id);
                            setPanelView("detail");
                          }}
                        >
                          <span>{item.label}</span>
                          {item.badge && <em>{item.badge}</em>}
                          <small>{item.description}</small>
                        </button>
                      ))}
                    </div>
                  )}

                  {panelView === "detail" && activePanel === "content" && (
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
                        Coupon code
                        <input value={activePopup.couponCode} placeholder="DIET10" onChange={(event) => updatePopup(activePopup.id, "couponCode", event.currentTarget.value.toUpperCase())} />
                      </label>
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

                  {panelView === "detail" && activePanel === "style" && (
                    <div className="dityy-panel">
                      <div className="dityy-presets">
                        {popupPresets.map((preset) => (
                          <button key={preset.id} type="button" onClick={() => applyPreset(preset)}>
                            {preset.label}
                          </button>
                        ))}
                      </div>
                      <div className="dityy-field-grid">
                        <label>
                          Template
                          <select value={activePopup.templateStyle} onChange={(event) => updatePopup(activePopup.id, "templateStyle", event.currentTarget.value as PopupConfig["templateStyle"])}>
                            <option value="clean">Clean</option>
                            <option value="split">Split image</option>
                            <option value="dark">Dark editorial</option>
                            <option value="coupon">Coupon focus</option>
                            <option value="minimal">Minimal</option>
                          </select>
                        </label>
                        <label>
                          Display type
                          <select value={activePopup.displayType} onChange={(event) => updatePopup(activePopup.id, "displayType", event.currentTarget.value as DisplayType)}>
                            <option value="popup">Popup</option>
                            <option value="bar">Bar</option>
                            <option value="embed">Embed</option>
                          </select>
                        </label>
                        <label>
                          Image position
                          <select value={activePopup.imagePosition} onChange={(event) => updatePopup(activePopup.id, "imagePosition", event.currentTarget.value as PopupConfig["imagePosition"])}>
                            <option value="top">Top</option>
                            <option value="left">Left</option>
                            <option value="right">Right</option>
                            <option value="background">Background</option>
                          </select>
                        </label>
                        <label>
                          Font
                          <select value={activePopup.fontFamily} onChange={(event) => updatePopup(activePopup.id, "fontFamily", event.currentTarget.value as PopupConfig["fontFamily"])}>
                            <option value="system">System</option>
                            <option value="serif">Serif</option>
                            <option value="mono">Mono</option>
                          </select>
                        </label>
                        <label>
                          Spacing
                          <input type="number" min={8} max={40} value={activePopup.spacing} onChange={(event) => updatePopup(activePopup.id, "spacing", Number(event.currentTarget.value))} />
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
                        <label>
                          Radius
                          <input type="number" min={0} max={32} value={activePopup.borderRadius} onChange={(event) => updatePopup(activePopup.id, "borderRadius", Number(event.currentTarget.value))} />
                        </label>
                      </div>
                    </div>
                  )}

                  {panelView === "detail" && activePanel === "targeting" && (
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
                        <label>
                          Product tags
                          <input value={activePopup.productTags} placeholder="protein, keto" onChange={(event) => updatePopup(activePopup.id, "productTags", event.currentTarget.value)} />
                        </label>
                        <label>
                          Collection handles
                          <input value={activePopup.collectionHandles} placeholder="snacks, offers" onChange={(event) => updatePopup(activePopup.id, "collectionHandles", event.currentTarget.value)} />
                        </label>
                        <label>
                          Customer tags
                          <input value={activePopup.customerTags} placeholder="vip, wholesale" onChange={(event) => updatePopup(activePopup.id, "customerTags", event.currentTarget.value)} />
                        </label>
                        <label>
                          Countries
                          <input value={activePopup.countries} placeholder="EG, SA" onChange={(event) => updatePopup(activePopup.id, "countries", event.currentTarget.value.toUpperCase())} />
                        </label>
                        <label>
                          Languages
                          <input value={activePopup.languages} placeholder="ar, en" onChange={(event) => updatePopup(activePopup.id, "languages", event.currentTarget.value.toLowerCase())} />
                        </label>
                      </div>
                    </div>
                  )}

                  {panelView === "detail" && activePanel === "automation" && (
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
                        <label>
                          Starts at
                          <input type="datetime-local" value={activePopup.startsAt} onChange={(event) => updatePopup(activePopup.id, "startsAt", event.currentTarget.value)} />
                        </label>
                        <label>
                          Ends at
                          <input type="datetime-local" value={activePopup.endsAt} onChange={(event) => updatePopup(activePopup.id, "endsAt", event.currentTarget.value)} />
                        </label>
                      </div>
                      <label className="dityy-check">
                        <input type="checkbox" checked={activePopup.abTestEnabled} onChange={(event) => updatePopup(activePopup.id, "abTestEnabled", event.currentTarget.checked)} />
                        Enable A/B test
                      </label>
                      {activePopup.abTestEnabled && (
                        <>
                          <div className="dityy-field-grid">
                            <label>
                              Variant B headline
                              <input dir="auto" value={activePopup.variantBTitle} onChange={(event) => updatePopup(activePopup.id, "variantBTitle", event.currentTarget.value)} />
                            </label>
                            <label>
                              Variant B button
                              <input dir="auto" value={activePopup.variantBPrimaryLabel} onChange={(event) => updatePopup(activePopup.id, "variantBPrimaryLabel", event.currentTarget.value)} />
                            </label>
                          </div>
                          <label>
                            Variant B description
                            <textarea dir="auto" rows={3} value={activePopup.variantBBody} onChange={(event) => updatePopup(activePopup.id, "variantBBody", event.currentTarget.value)} />
                          </label>
                          <div className="dityy-ab-grid">
                            <span><strong>{activeVariantStats.a.views}</strong> A views</span>
                            <span><strong>{activeVariantStats.a.leads}</strong> A leads</span>
                            <span><strong>{activeVariantStats.b.views}</strong> B views</span>
                            <span><strong>{activeVariantStats.b.leads}</strong> B leads</span>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {panelView === "detail" && activePanel === "data" && (
                    <div className="dityy-panel">
                      <label className="dityy-check">
                        <input type="checkbox" checked={activePopup.collectName} onChange={(event) => updatePopup(activePopup.id, "collectName", event.currentTarget.checked)} />
                        Collect name
                      </label>
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
                      <label>
                        Privacy consent text
                        <textarea
                          dir="auto"
                          rows={3}
                          value={activePopup.privacyText}
                          onChange={(event) => updatePopup(activePopup.id, "privacyText", event.currentTarget.value)}
                        />
                      </label>
                      <label className="dityy-check">
                        <input type="checkbox" checked={activePopup.redirectToWhatsApp} onChange={(event) => updatePopup(activePopup.id, "redirectToWhatsApp", event.currentTarget.checked)} />
                        Open WhatsApp after lead submit
                      </label>
                      <div className="dityy-field-grid">
                        <label>
                          WhatsApp number
                          <input value={activePopup.whatsappNumber} placeholder="2010xxxxxxx" onChange={(event) => updatePopup(activePopup.id, "whatsappNumber", event.currentTarget.value)} />
                        </label>
                        <label>
                          WhatsApp message
                          <input dir="auto" value={activePopup.whatsappMessage} onChange={(event) => updatePopup(activePopup.id, "whatsappMessage", event.currentTarget.value)} />
                        </label>
                      </div>
                      <div className="dityy-stat-grid">
                        <span><strong>{activeStats.views}</strong> Views</span>
                        <span><strong>{activeStats.clicks}</strong> Clicks</span>
                        <span><strong>{activeStats.leads}</strong> Leads</span>
                        <span><strong>{activeStats.closes}</strong> Closes</span>
                        <span><strong>{activeCtr}%</strong> CTR</span>
                        <span><strong>{activeLeadRate}%</strong> Lead rate</span>
                      </div>
                      <div className="dityy-chart">
                        {activeDailyStats.length === 0 ? (
                          <p>No chart data yet.</p>
                        ) : (
                          activeDailyStats.map((day) => {
                            const maxValue = Math.max(1, ...activeDailyStats.map((item) => item.views + item.clicks + item.leads));
                            const height = Math.max(8, ((day.views + day.clicks + day.leads) / maxValue) * 96);
                            return (
                              <span key={day.date} title={`${day.date}: ${day.views} views, ${day.clicks} clicks, ${day.leads} leads`}>
                                <i style={{ height }} />
                                <small>{day.date.slice(5)}</small>
                              </span>
                            );
                          })
                        )}
                      </div>
                      <div className="dityy-leads-head">
                        <strong>Latest leads</strong>
                        <button type="button" className="dityy-secondary" onClick={exportActiveLeads} disabled={!activeLeads.length}>
                          Export CSV
                        </button>
                      </div>
                      <div className="dityy-field-grid">
                        <label>
                          Search leads
                          <input value={leadSearch} placeholder="email, phone, name" onChange={(event) => setLeadSearch(event.currentTarget.value)} />
                        </label>
                        <label>
                          From date
                          <input type="date" value={leadDateFrom} onChange={(event) => setLeadDateFrom(event.currentTarget.value)} />
                        </label>
                        <label>
                          To date
                          <input type="date" value={leadDateTo} onChange={(event) => setLeadDateTo(event.currentTarget.value)} />
                        </label>
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

                  {panelView === "detail" && activePanel === "integrations" && (
                    <div className="dityy-panel">
                      <div className="dityy-integration-note">
                        These keys stay server-side and are not sent to the storefront.
                      </div>
                      <label>
                        Google Sheets webhook URL
                        <input value={integrations.googleSheetsWebhookUrl} placeholder="https://script.google.com/..." onChange={(event) => updateIntegration("googleSheetsWebhookUrl", event.currentTarget.value)} />
                      </label>
                      <div className="dityy-field-grid">
                        <label>
                          Klaviyo private API key
                          <input type="password" value={integrations.klaviyoApiKey} onChange={(event) => updateIntegration("klaviyoApiKey", event.currentTarget.value)} />
                        </label>
                        <label>
                          Klaviyo list ID
                          <input value={integrations.klaviyoListId} onChange={(event) => updateIntegration("klaviyoListId", event.currentTarget.value)} />
                        </label>
                        <label>
                          Mailchimp API key
                          <input type="password" value={integrations.mailchimpApiKey} onChange={(event) => updateIntegration("mailchimpApiKey", event.currentTarget.value)} />
                        </label>
                        <label>
                          Mailchimp server prefix
                          <input value={integrations.mailchimpServerPrefix} placeholder="us21" onChange={(event) => updateIntegration("mailchimpServerPrefix", event.currentTarget.value)} />
                        </label>
                        <label>
                          Mailchimp list ID
                          <input value={integrations.mailchimpListId} onChange={(event) => updateIntegration("mailchimpListId", event.currentTarget.value)} />
                        </label>
                      </div>
                    </div>
                  )}
                </div>

                <div className="dityy-preview">
                  <div className="dityy-preview__toolbar">
                    <span>Live preview</span>
                    <div>
                      <button type="button" className={previewMode === "product" ? "active" : ""} onClick={() => setPreviewMode("product")}>Product</button>
                      <button type="button" className={previewMode === "cart" ? "active" : ""} onClick={() => setPreviewMode("cart")}>Cart</button>
                      <button type="button" className={previewDevice === "desktop" ? "active" : ""} onClick={() => setPreviewDevice("desktop")}>Desktop</button>
                      <button type="button" className={previewDevice === "mobile" ? "active" : ""} onClick={() => setPreviewDevice("mobile")}>Mobile</button>
                    </div>
                  </div>
                  <div className={`dityy-preview-stage dityy-preview-stage--${previewDevice}`}>
                    <div className="dityy-placement-note">
                      <strong>Where this appears</strong>
                      {visibilityNotes.map((note) => (
                        <span key={note}>{note}</span>
                      ))}
                      {visibilityWarnings.map((warning) => (
                        <em key={warning}>{warning}</em>
                      ))}
                    </div>
                    {previewMode === "product" ? (
                      <div className="dityy-preview-page dityy-preview-page--product">
                        <div className="dityy-preview-media" />
                        <div className="dityy-preview-copy">
                          <span>Dietty product</span>
                          <strong>Protein snack bundle</strong>
                          <p>EGP 240.00</p>
                          <button type="button">Add to cart</button>
                        </div>
                      </div>
                    ) : (
                      <div className="dityy-preview-page dityy-preview-page--cart">
                        <strong>Your cart</strong>
                        <span />
                        <span />
                        <button type="button">Checkout</button>
                      </div>
                    )}
                    <div className={`dityy-preview-campaign dityy-preview-campaign--${activePopup.displayType} dityy-preview-campaign--${activePopup.position} dityy-preview-campaign--${activePopup.templateStyle} dityy-preview-campaign--image-${activePopup.imagePosition} dityy-preview-campaign--font-${activePopup.fontFamily}`} style={previewStyle}>
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
                        {activePopup.couponCode && (
                          <div className="dityy-preview-coupon">
                            <span>{activePopup.couponCode}</span>
                            <small>Copy code</small>
                          </div>
                        )}
                        {(activePopup.collectName || activePopup.collectEmail || activePopup.collectPhone) && (
                          <div className="dityy-preview-lead">
                            {activePopup.collectName && <input placeholder="Name" readOnly />}
                            {activePopup.collectEmail && <input placeholder="Email" readOnly />}
                            {activePopup.collectPhone && <input placeholder="Phone" readOnly />}
                            <label>
                              <input type="checkbox" checked readOnly />
                              <span>{activePopup.privacyText}</span>
                            </label>
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
    background: #f4f4f4;
    display: block;
    margin: 0 -16px -24px;
    min-height: calc(100vh - 68px);
    overflow-x: hidden;
  }

  .dityy-save-banner {
    align-items: center;
    background: #f7f7f5;
    border-bottom: 1px solid #dfe2dc;
    display: flex;
    gap: 12px;
    margin: -12px -16px 12px;
    min-height: 46px;
    padding: 0 22px;
  }

  .dityy-save-banner span {
    color: #1f2421;
    font-weight: 750;
  }

  .dityy-save-banner small {
    color: #666d68;
  }

  .dityy-save-banner--dirty span::before {
    content: "△";
    margin-right: 8px;
  }

  .dityy-sidebar {
    align-items: center;
    background: #fff;
    border: 1px solid #dedfd8;
    border-radius: 10px;
    color: #1f2421;
    display: grid;
    gap: 14px;
    grid-template-columns: auto auto minmax(0, 1fr);
    margin: 0 auto 12px;
    max-width: 1500px;
    min-height: auto;
    padding: 14px 16px;
    position: static;
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
    border: 1px solid #d7d9d3;
    border-radius: 8px;
    cursor: pointer;
    min-height: 34px;
    padding: 6px 12px;
  }

  .dityy-sidebar__head span {
    color: #6b716d;
    display: block;
    font-size: 12px;
    margin-top: 4px;
  }

  .dityy-sidebar .dityy-icon-button {
    background: #101513;
    border-color: #101513;
    color: #fff;
    font-weight: 800;
  }

  .dityy-sidebar__metrics {
    border: 0;
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin: 0;
    padding: 0;
  }

  .dityy-sidebar__metrics span {
    color: #6b716d;
    font-size: 12px;
  }

  .dityy-sidebar__metrics strong {
    color: #101513;
    display: block;
    font-size: 20px;
  }

  .dityy-campaign-strip {
    display: flex;
    gap: 10px;
    min-width: 0;
    overflow-x: auto;
    padding-bottom: 2px;
  }

  .dityy-campaign-item {
    background: #f8f8f6;
    border: 1px solid #d7d9d3;
    border-radius: 9px;
    color: #1f2421;
    cursor: pointer;
    display: block;
    flex: 0 0 220px;
    margin-top: 0;
    padding: 12px;
    text-align: left;
    width: 100%;
  }

  .dityy-campaign-item--active {
    background: #fff;
    border-color: #101513;
    box-shadow: inset 3px 0 0 #101513;
    color: #0d1512;
  }

  .dityy-campaign-item span,
  .dityy-campaign-item small {
    display: block;
  }

  .dityy-campaign-item small,
  .dityy-step-head p,
  .dityy-builder__top p {
    color: #6f756f;
    margin: 4px 0 0;
  }

  .dityy-sidebar .dityy-campaign-item small {
    color: #6b716d;
  }

  .dityy-sidebar .dityy-campaign-item--active small {
    color: #506058;
  }

  .dityy-main {
    margin: 0 auto;
    max-width: 1500px;
    min-width: 0;
    padding: 0 0 28px;
  }

  .dityy-main h2 {
    letter-spacing: 0;
    margin: 0;
  }

  .dityy-main p {
    line-height: 1.5;
    min-width: 0;
  }

  .dityy-card,
  .dityy-builder {
    background: #fff;
    border: 1px solid #dedfd8;
    border-radius: 10px;
    box-shadow: 0 1px 2px rgba(16,21,19,.06);
    padding: 22px;
  }

  .dityy-card {
    margin: 32px auto;
    max-width: 960px;
  }

  .dityy-builder {
    padding: 0;
  }

  .dityy-option-grid,
  .dityy-display-grid {
    display: grid;
    gap: 18px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin-top: 22px;
  }

  .dityy-display-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .dityy-option-card,
  .dityy-display-card {
    background: #fff;
    border: 1px solid #bfc4c0;
    border-radius: 10px;
    cursor: pointer;
    min-height: 108px;
    padding: 20px;
    position: relative;
    text-align: left;
    transition: background .15s ease, border-color .15s ease, box-shadow .15s ease;
  }

  .dityy-option-card:hover,
  .dityy-display-card:hover {
    background: #fafafa;
    border-color: #8c918d;
    box-shadow: 0 1px 0 rgba(16,21,19,.08);
  }

  .dityy-display-card {
    text-align: center;
  }

  .dityy-display-card--active {
    background: #f0f0ee;
    border-color: #8c918d;
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
    background: #e9e9e6;
    border: 2px solid #6c716d;
    border-radius: 2px;
    display: inline-flex;
    height: 44px;
    justify-content: center;
    margin-bottom: 10px;
    width: 58px;
  }

  .dityy-builder__top {
    border-bottom: 1px solid #ededed;
    margin-bottom: 0;
    padding: 22px 24px 18px;
  }

  .dityy-actions {
    display: flex;
    gap: 8px;
  }

  .dityy-primary,
  .dityy-secondary,
  .dityy-danger {
    background: #fff;
    border: 1px solid #c9c9c9;
    border-radius: 6px;
    cursor: pointer;
    min-height: 36px;
    padding: 7px 12px;
  }

  .dityy-primary {
    background: #101513;
    border-color: #101513;
    color: #fff;
  }

  .dityy-danger {
    border-color: #b42318;
    color: #b42318;
  }

  .dityy-builder__grid {
    display: grid;
    gap: 0;
    grid-template-columns: 360px minmax(0, 1fr);
    min-height: 760px;
  }

  .dityy-editor,
  .dityy-preview {
    background: #fff;
    border: 0;
    border-radius: 0;
    overflow: hidden;
  }

  .dityy-preview {
    align-self: start;
    border-left: 1px solid #dedfd8;
    position: sticky;
    top: 0;
  }

  .dityy-tabs {
    background: #fff;
    border-bottom: 1px solid #e4e1d8;
    display: grid;
    gap: 14px;
    padding: 18px 14px;
  }

  .dityy-tabs button {
    align-items: center;
    background: #fff;
    border: 1px solid #c8ccc8;
    border-radius: 9px;
    cursor: pointer;
    display: grid;
    gap: 4px;
    min-height: 74px;
    padding: 13px 44px 13px 14px;
    position: relative;
    text-align: left;
  }

  .dityy-tabs button::after {
    color: #4f5550;
    content: "›";
    font-size: 28px;
    line-height: 1;
    position: absolute;
    right: 16px;
    top: 50%;
    transform: translateY(-50%);
  }

  .dityy-tabs button span {
    font-weight: 750;
  }

  .dityy-tabs button small {
    color: #6b716d;
  }

  .dityy-tabs button em {
    background: #bdeeb9;
    border-radius: 999px;
    font-size: 11px;
    font-style: normal;
    padding: 3px 8px;
    position: absolute;
    right: 38px;
    top: 15px;
  }

  .dityy-preview__toolbar button {
    background: transparent;
    border: 0;
    border-radius: 6px;
    cursor: pointer;
    flex: 0 0 auto;
    padding: 8px 10px;
  }

  .dityy-tabs button.active {
    background: #f6f7f4;
    border-color: #0d1512;
    box-shadow: inset 3px 0 0 #0d1512;
  }

  .dityy-preview__toolbar button.active {
    background: #101513;
    color: #fff;
  }

  .dityy-editor__head {
    align-items: center;
    background: #f7f7f5;
    border-bottom: 1px solid #dfe2dc;
    display: grid;
    gap: 6px;
    grid-template-columns: auto 1fr;
    padding: 14px;
  }

  .dityy-editor__head strong {
    justify-self: center;
  }

  .dityy-editor__head span {
    color: #6b716d;
    font-size: 12px;
    grid-column: 1 / -1;
    justify-self: center;
  }

  .dityy-back-link {
    background: transparent;
    border: 0;
    color: #135fd0;
    cursor: pointer;
    padding: 0;
  }

  .dityy-panel {
    display: grid;
    gap: 14px;
    border-top: 1px solid #ecece8;
    padding: 18px 14px 22px;
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
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .dityy-panel label {
    color: #303030;
    font-size: 13px;
    font-weight: 650;
  }

  .dityy-panel input,
  .dityy-panel select,
  .dityy-panel textarea {
    background: #fff;
    border: 1px solid #d1d2cb;
    border-radius: 9px;
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
    background: #f6f8f4;
    border: 1px solid #e3e8df;
    border-radius: 9px;
    padding: 12px;
  }

  .dityy-stat-grid strong {
    display: block;
    font-size: 22px;
  }

  .dityy-ab-grid {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .dityy-ab-grid span,
  .dityy-integration-note {
    background: #f4f7f2;
    border: 1px solid #dce6d9;
    border-radius: 9px;
    padding: 11px;
  }

  .dityy-ab-grid strong {
    display: block;
    font-size: 20px;
  }

  .dityy-chart {
    align-items: end;
    border: 1px solid #e1ded4;
    border-radius: 10px;
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(14, minmax(12px, 1fr));
    min-height: 136px;
    padding: 14px;
  }

  .dityy-chart p {
    color: #6f756f;
    grid-column: 1 / -1;
    margin: 0;
  }

  .dityy-chart span {
    align-items: center;
    display: grid;
    gap: 6px;
    justify-items: center;
  }

  .dityy-chart i {
    background: #77c8a7;
    border-radius: 999px 999px 3px 3px;
    display: block;
    width: 100%;
  }

  .dityy-chart small {
    color: #6f756f;
    font-size: 10px;
  }

  .dityy-presets {
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .dityy-presets button {
    background: #f6f6f6;
    border: 1px solid #d8d8d8;
    border-radius: 7px;
    cursor: pointer;
    min-height: 38px;
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
    background: #faf9f5;
    border-bottom: 1px solid #e4e1d8;
    display: flex;
    justify-content: space-between;
    padding: 10px 12px;
  }

  .dityy-preview-stage {
    background:
      linear-gradient(135deg, rgba(119,200,167,.18), transparent 32%),
      #efeee8;
    min-height: 716px;
    padding: 124px 54px 48px;
    position: relative;
  }

  .dityy-placement-note {
    background: rgba(255,255,255,.92);
    border: 1px solid #dedfd8;
    border-radius: 8px;
    display: grid;
    gap: 4px;
    left: 54px;
    padding: 10px 12px;
    position: absolute;
    right: 54px;
    top: 24px;
    z-index: 3;
  }

  .dityy-placement-note strong {
    font-size: 12px;
  }

  .dityy-placement-note span,
  .dityy-placement-note em {
    color: #626963;
    font-size: 12px;
    font-style: normal;
  }

  .dityy-placement-note em {
    color: #9a3412;
  }

  .dityy-preview-stage--mobile {
    margin: 0 auto;
    max-width: 390px;
    min-height: 716px;
  }

  .dityy-preview-page {
    background: #fff;
    border: 1px solid #e1e1e1;
    box-shadow: 0 12px 30px rgba(16,21,19,.06);
    min-height: 540px;
    padding: 28px;
  }

  .dityy-preview-page--product {
    display: grid;
    gap: 28px;
    grid-template-columns: 1fr 1fr;
  }

  .dityy-preview-media,
  .dityy-preview-page--cart span {
    background: #efefef;
    border-radius: 10px;
    display: block;
  }

  .dityy-preview-media {
    min-height: 300px;
  }

  .dityy-preview-copy span,
  .dityy-preview-copy p {
    color: #6f756f;
  }

  .dityy-preview-copy strong {
    display: block;
    font-size: 30px;
    margin: 8px 0;
  }

  .dityy-preview-page button {
    background: #111;
    border: 0;
    border-radius: 8px;
    color: #fff;
    min-height: 44px;
    padding: 0 18px;
  }

  .dityy-preview-page--cart {
    display: grid;
    gap: 16px;
  }

  .dityy-preview-page--cart span {
    display: block;
    height: 74px;
  }

  .dityy-preview-campaign {
    background: var(--preview-bg);
    border: 1px solid rgba(0,0,0,.12);
    border-radius: var(--preview-radius);
    color: var(--preview-text);
    left: 50%;
    max-width: 420px;
    padding: 0;
    position: absolute;
    text-align: center;
    top: 50%;
    transform: translate(-50%, -50%);
    width: calc(100% - 90px);
  }

  .dityy-preview-campaign > div {
    padding: var(--preview-spacing);
  }

  .dityy-preview-campaign--font-serif {
    font-family: Georgia, serif;
  }

  .dityy-preview-campaign--font-mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .dityy-preview-campaign--dark {
    box-shadow: 0 20px 60px rgba(16,21,19,.24);
  }

  .dityy-preview-campaign--minimal {
    border-color: transparent;
    box-shadow: none;
  }

  .dityy-preview-campaign--split,
  .dityy-preview-campaign--image-left,
  .dityy-preview-campaign--image-right {
    align-items: center;
    display: grid;
    grid-template-columns: 140px 1fr;
    text-align: left;
  }

  .dityy-preview-campaign--image-right {
    grid-template-columns: 1fr 140px;
  }

  .dityy-preview-campaign--image-right img {
    order: 2;
  }

  .dityy-preview-campaign--image-background {
    overflow: hidden;
  }

  .dityy-preview-campaign--image-background img {
    height: 100%;
    inset: 0;
    max-height: none;
    opacity: .18;
    position: absolute;
    z-index: 0;
  }

  .dityy-preview-campaign--image-background > div {
    position: relative;
    z-index: 1;
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

  .dityy-preview-coupon {
    align-items: center;
    border: 1px dashed color-mix(in srgb, var(--preview-accent) 70%, transparent);
    border-radius: 9px;
    display: flex;
    justify-content: space-between;
    margin: 0 0 14px;
    padding: 9px 11px;
  }

  .dityy-preview-coupon span {
    font-weight: 800;
    letter-spacing: .08em;
  }

  .dityy-preview-coupon small {
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

  .dityy-preview-lead label {
    align-items: flex-start;
    color: inherit;
    display: flex;
    font-size: 11px;
    gap: 7px;
    line-height: 1.35;
    opacity: .76;
    text-align: left;
  }

  .dityy-preview-lead label input {
    min-height: auto;
    width: auto;
  }

  @media (max-width: 1100px) {
    .dityy-app-shell,
    .dityy-builder__grid {
      grid-template-columns: 1fr;
    }

    .dityy-sidebar,
    .dityy-preview {
      min-height: auto;
      position: static;
    }
  }
`;

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
