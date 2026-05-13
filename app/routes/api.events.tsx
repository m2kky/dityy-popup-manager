import { createHash } from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import prisma from "../db.server";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "content-type": "application/json; charset=utf-8",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });

const safeString = (value: unknown, maxLength = 500) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
};

type IntegrationConfig = {
  googleSheetsWebhookUrl: string;
  klaviyoApiKey: string;
  klaviyoListId: string;
  mailchimpApiKey: string;
  mailchimpServerPrefix: string;
  mailchimpListId: string;
};

const emptyIntegrations = (): IntegrationConfig => ({
  googleSheetsWebhookUrl: "",
  klaviyoApiKey: "",
  klaviyoListId: "",
  mailchimpApiKey: "",
  mailchimpServerPrefix: "",
  mailchimpListId: "",
});

const loadIntegrations = async () => {
  const setting = await prisma.appSetting.findUnique({ where: { key: "integrations" } });
  if (!setting) return emptyIntegrations();

  try {
    return { ...emptyIntegrations(), ...JSON.parse(setting.value) } as IntegrationConfig;
  } catch {
    return emptyIntegrations();
  }
};

const postJson = async (url: string, body: unknown, headers: Record<string, string> = {}) => {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
};

const forwardLead = async (payload: Record<string, unknown>) => {
  const integrations = await loadIntegrations();
  const email = safeString(payload.email, 240);
  const phone = safeString(payload.phone, 80);
  const name = safeString(payload.name, 160);

  const tasks: Array<Promise<unknown>> = [];

  if (integrations.googleSheetsWebhookUrl) {
    tasks.push(postJson(integrations.googleSheetsWebhookUrl, payload));
  }

  if (integrations.mailchimpApiKey && integrations.mailchimpServerPrefix && integrations.mailchimpListId && email) {
    const hash = createHash("md5").update(email.toLowerCase()).digest("hex");
    const auth = Buffer.from(`dityy:${integrations.mailchimpApiKey}`).toString("base64");
    tasks.push(
      fetch(
        `https://${integrations.mailchimpServerPrefix}.api.mailchimp.com/3.0/lists/${integrations.mailchimpListId}/members/${hash}`,
        {
          method: "PUT",
          headers: {
            authorization: `Basic ${auth}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            email_address: email,
            status_if_new: "subscribed",
            merge_fields: {
              FNAME: name || "",
              PHONE: phone || "",
            },
          }),
        },
      ),
    );
  }

  if (integrations.klaviyoApiKey && email) {
    tasks.push(
      (async () => {
        const headers = {
          authorization: `Klaviyo-API-Key ${integrations.klaviyoApiKey}`,
          accept: "application/vnd.api+json",
          "content-type": "application/vnd.api+json",
          revision: "2026-04-15",
        };
        const profileResponse = await postJson(
          "https://a.klaviyo.com/api/profile-import",
          {
            data: {
              type: "profile",
              attributes: {
                email,
                phone_number: phone || undefined,
                first_name: name || undefined,
              },
              properties: {
                source: "Dityy Popup Manager",
              },
            },
          },
          headers,
        );

        if (!integrations.klaviyoListId) return;

        const profileJson = (await profileResponse.json().catch(() => null)) as { data?: { id?: string } } | null;
        const profileId = profileJson?.data?.id;
        if (!profileId) return;

        await postJson(
          `https://a.klaviyo.com/api/lists/${integrations.klaviyoListId}/relationships/profiles`,
          {
            data: [{ type: "profile", id: profileId }],
          },
          headers,
        );
      })(),
    );
  }

  await Promise.allSettled(tasks);
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  return jsonResponse({ ok: true });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  let payload: Record<string, unknown>;

  try {
    payload = JSON.parse(await request.text());
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON." }, 400);
  }

  const popupId = safeString(payload.popupId, 120);
  const type = safeString(payload.type, 40);

  if (!popupId || !type) {
    return jsonResponse({ ok: false, error: "Missing popup event fields." }, 400);
  }

  await prisma.popupEvent.create({
    data: {
      popupId,
      type,
      variant: safeString(payload.variant, 20),
      action: safeString(payload.action, 80),
      path: safeString(payload.path, 700),
      pageType: safeString(payload.pageType, 80),
      referrer: safeString(payload.referrer, 700),
      userAgent: request.headers.get("user-agent")?.slice(0, 700) ?? null,
    },
  });

  if (type === "lead") {
    await prisma.popupLead.create({
      data: {
        popupId,
        email: safeString(payload.email, 240),
        phone: safeString(payload.phone, 80),
        name: safeString(payload.name, 160),
        path: safeString(payload.path, 700),
      },
    });
    await forwardLead(payload);
  }

  return jsonResponse({ ok: true });
};

export const headers = () => corsHeaders;
