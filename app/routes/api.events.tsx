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
  }

  return jsonResponse({ ok: true });
};

export const headers = () => corsHeaders;
