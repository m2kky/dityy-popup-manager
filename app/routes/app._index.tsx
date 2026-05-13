import { useEffect, useMemo, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";

const POPUP_NAMESPACE = "dityy_popups";
const POPUP_KEY = "config";

type PopupPageMode =
  | "all"
  | "home"
  | "product"
  | "collection"
  | "cart"
  | "url_contains";

type PopupTrigger = "delay" | "scroll" | "exit";
type PopupFrequency = "always" | "session" | "days";

type PopupConfig = {
  id: string;
  enabled: boolean;
  name: string;
  title: string;
  body: string;
  imageUrl: string;
  primaryLabel: string;
  primaryUrl: string;
  pageMode: PopupPageMode;
  urlContains: string;
  trigger: PopupTrigger;
  delaySeconds: number;
  scrollPercent: number;
  frequency: PopupFrequency;
  frequencyDays: number;
  priority: number;
};

type LoaderData = {
  appInstallationId: string;
  popups: PopupConfig[];
};

type ActionData =
  | { ok: true; popups: PopupConfig[] }
  | { ok: false; error: string };

const emptyPopup = (): PopupConfig => ({
  id:
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `popup-${Date.now()}`,
  enabled: true,
  name: "New popup",
  title: "",
  body: "",
  imageUrl: "",
  primaryLabel: "",
  primaryUrl: "",
  pageMode: "all",
  urlContains: "",
  trigger: "delay",
  delaySeconds: 5,
  scrollPercent: 40,
  frequency: "session",
  frequencyDays: 7,
  priority: 10,
});

const numberOrDefault = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const stringOrEmpty = (value: unknown) =>
  typeof value === "string" ? value : "";

const parsePopups = (value: unknown): PopupConfig[] => {
  if (!Array.isArray(value)) return [];

  return value.map((popup, index) => {
    const source = popup && typeof popup === "object" ? popup : {};
    const record = source as Record<string, unknown>;

    const pageModes: PopupPageMode[] = [
      "all",
      "home",
      "product",
      "collection",
      "cart",
      "url_contains",
    ];
    const triggers: PopupTrigger[] = ["delay", "scroll", "exit"];
    const frequencies: PopupFrequency[] = ["always", "session", "days"];

    const pageMode = pageModes.includes(record.pageMode as PopupPageMode)
      ? (record.pageMode as PopupPageMode)
      : "all";
    const trigger = triggers.includes(record.trigger as PopupTrigger)
      ? (record.trigger as PopupTrigger)
      : "delay";
    const frequency = frequencies.includes(record.frequency as PopupFrequency)
      ? (record.frequency as PopupFrequency)
      : "session";

    return {
      id: stringOrEmpty(record.id) || `popup-${index + 1}`,
      enabled: Boolean(record.enabled),
      name: stringOrEmpty(record.name) || `Popup ${index + 1}`,
      title: stringOrEmpty(record.title),
      body: stringOrEmpty(record.body),
      imageUrl: stringOrEmpty(record.imageUrl),
      primaryLabel: stringOrEmpty(record.primaryLabel),
      primaryUrl: stringOrEmpty(record.primaryUrl),
      pageMode,
      urlContains: stringOrEmpty(record.urlContains),
      trigger,
      delaySeconds: Math.max(0, numberOrDefault(record.delaySeconds, 5)),
      scrollPercent: Math.min(
        100,
        Math.max(1, numberOrDefault(record.scrollPercent, 40)),
      ),
      frequency,
      frequencyDays: Math.max(1, numberOrDefault(record.frequencyDays, 7)),
      priority: numberOrDefault(record.priority, 10),
    };
  });
};

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

  return {
    appInstallationId: appInstallation.id,
    popups,
  } satisfies LoaderData;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
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

  return { ok: true, popups } satisfies ActionData;
};

export default function Index() {
  const loaderData = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [popups, setPopups] = useState<PopupConfig[]>(loaderData.popups);
  const [activeId, setActiveId] = useState<string | null>(
    loaderData.popups[0]?.id ?? null,
  );

  const isSaving = fetcher.state !== "idle";
  const enabledCount = useMemo(
    () => popups.filter((popup) => popup.enabled).length,
    [popups],
  );

  useEffect(() => {
    if (fetcher.data?.ok) {
      shopify.toast.show("Popups saved");
    } else if (fetcher.data?.ok === false) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const updatePopup = <Key extends keyof PopupConfig>(
    id: string,
    key: Key,
    value: PopupConfig[Key],
  ) => {
    setPopups((current) =>
      current.map((popup) =>
        popup.id === id ? { ...popup, [key]: value } : popup,
      ),
    );
  };

  const addPopup = () => {
    const popup = emptyPopup();
    setPopups((current) => [...current, popup]);
    setActiveId(popup.id);
  };

  const duplicatePopup = (id: string) => {
    const source = popups.find((popup) => popup.id === id);
    if (!source) return;

    const popup = {
      ...source,
      id: emptyPopup().id,
      name: `${source.name} copy`,
      enabled: false,
    };
    setPopups((current) => [...current, popup]);
    setActiveId(popup.id);
  };

  const removePopup = (id: string) => {
    setPopups((current) => {
      const next = current.filter((popup) => popup.id !== id);
      if (activeId === id) {
        setActiveId(next[0]?.id ?? null);
      }
      return next;
    });
  };

  const savePopups = () => {
    fetcher.submit(
      {
        payload: JSON.stringify(popups),
        appInstallationId: loaderData.appInstallationId,
      },
      { method: "POST" },
    );
  };

  const activePopup = popups.find((popup) => popup.id === activeId) ?? null;

  return (
    <s-page heading="Dityy Popup Manager">
      <s-button slot="primary-action" onClick={savePopups} {...(isSaving ? { loading: true } : {})}>
        Save popups
      </s-button>

      <s-section heading="Popup rules">
        <div className="dityy-admin-toolbar">
          <div>
            <strong>{popups.length}</strong> popups configured
            <span>{enabledCount} enabled</span>
          </div>
          <button type="button" className="dityy-admin-button" onClick={addPopup}>
            Add popup
          </button>
        </div>

        {popups.length === 0 ? (
          <div className="dityy-empty-state">
            <h2>No popups yet</h2>
            <p>Create the first popup, choose where it appears, then enable the app embed in your theme.</p>
            <button type="button" className="dityy-admin-button" onClick={addPopup}>
              Add first popup
            </button>
          </div>
        ) : (
          <div className="dityy-admin-layout">
            <div className="dityy-popup-list" aria-label="Configured popups">
              {popups.map((popup) => (
                <button
                  key={popup.id}
                  type="button"
                  className={`dityy-popup-list__item${popup.id === activeId ? " dityy-popup-list__item--active" : ""}`}
                  onClick={() => setActiveId(popup.id)}
                >
                  <span>{popup.name || "Untitled popup"}</span>
                  <small>
                    {popup.enabled ? "Enabled" : "Disabled"} · {popup.pageMode}
                  </small>
                </button>
              ))}
            </div>

            {activePopup && (
              <div className="dityy-popup-editor">
                <div className="dityy-field-row dityy-field-row--inline">
                  <label>
                    <input
                      type="checkbox"
                      checked={activePopup.enabled}
                      onChange={(event) =>
                        updatePopup(activePopup.id, "enabled", event.currentTarget.checked)
                      }
                    />
                    Enabled
                  </label>
                  <div className="dityy-editor-actions">
                    <button
                      type="button"
                      className="dityy-admin-button dityy-admin-button--secondary"
                      onClick={() => duplicatePopup(activePopup.id)}
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      className="dityy-admin-button dityy-admin-button--danger"
                      onClick={() => removePopup(activePopup.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="dityy-field-grid">
                  <label>
                    Internal name
                    <input
                      value={activePopup.name}
                      onChange={(event) =>
                        updatePopup(activePopup.id, "name", event.currentTarget.value)
                      }
                    />
                  </label>
                  <label>
                    Priority
                    <input
                      type="number"
                      value={activePopup.priority}
                      onChange={(event) =>
                        updatePopup(
                          activePopup.id,
                          "priority",
                          Number(event.currentTarget.value),
                        )
                      }
                    />
                  </label>
                </div>

                <label className="dityy-field-row">
                  Popup title
                  <input
                    value={activePopup.title}
                    dir="auto"
                    onChange={(event) =>
                      updatePopup(activePopup.id, "title", event.currentTarget.value)
                    }
                  />
                </label>

                <label className="dityy-field-row">
                  Popup text
                  <textarea
                    value={activePopup.body}
                    dir="auto"
                    rows={4}
                    onChange={(event) =>
                      updatePopup(activePopup.id, "body", event.currentTarget.value)
                    }
                  />
                </label>

                <div className="dityy-field-grid">
                  <label>
                    Button label
                    <input
                      value={activePopup.primaryLabel}
                      dir="auto"
                      onChange={(event) =>
                        updatePopup(
                          activePopup.id,
                          "primaryLabel",
                          event.currentTarget.value,
                        )
                      }
                    />
                  </label>
                  <label>
                    Button link
                    <input
                      value={activePopup.primaryUrl}
                      placeholder="/collections/all"
                      onChange={(event) =>
                        updatePopup(activePopup.id, "primaryUrl", event.currentTarget.value)
                      }
                    />
                  </label>
                </div>

                <label className="dityy-field-row">
                  Image URL
                  <input
                    value={activePopup.imageUrl}
                    placeholder="https://cdn.shopify.com/..."
                    onChange={(event) =>
                      updatePopup(activePopup.id, "imageUrl", event.currentTarget.value)
                    }
                  />
                </label>

                <div className="dityy-field-grid">
                  <label>
                    Show on
                    <select
                      value={activePopup.pageMode}
                      onChange={(event) =>
                        updatePopup(
                          activePopup.id,
                          "pageMode",
                          event.currentTarget.value as PopupPageMode,
                        )
                      }
                    >
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
                    <input
                      value={activePopup.urlContains}
                      disabled={activePopup.pageMode !== "url_contains"}
                      placeholder="/collections/snacks"
                      onChange={(event) =>
                        updatePopup(activePopup.id, "urlContains", event.currentTarget.value)
                      }
                    />
                  </label>
                </div>

                <div className="dityy-field-grid">
                  <label>
                    Trigger
                    <select
                      value={activePopup.trigger}
                      onChange={(event) =>
                        updatePopup(
                          activePopup.id,
                          "trigger",
                          event.currentTarget.value as PopupTrigger,
                        )
                      }
                    >
                      <option value="delay">After seconds</option>
                      <option value="scroll">After scroll</option>
                      <option value="exit">Exit intent</option>
                    </select>
                  </label>
                  <label>
                    Delay seconds
                    <input
                      type="number"
                      min={0}
                      value={activePopup.delaySeconds}
                      disabled={activePopup.trigger !== "delay"}
                      onChange={(event) =>
                        updatePopup(
                          activePopup.id,
                          "delaySeconds",
                          Number(event.currentTarget.value),
                        )
                      }
                    />
                  </label>
                  <label>
                    Scroll percent
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={activePopup.scrollPercent}
                      disabled={activePopup.trigger !== "scroll"}
                      onChange={(event) =>
                        updatePopup(
                          activePopup.id,
                          "scrollPercent",
                          Number(event.currentTarget.value),
                        )
                      }
                    />
                  </label>
                </div>

                <div className="dityy-field-grid">
                  <label>
                    Frequency
                    <select
                      value={activePopup.frequency}
                      onChange={(event) =>
                        updatePopup(
                          activePopup.id,
                          "frequency",
                          event.currentTarget.value as PopupFrequency,
                        )
                      }
                    >
                      <option value="always">Every visit</option>
                      <option value="session">Once per session</option>
                      <option value="days">Once every X days</option>
                    </select>
                  </label>
                  <label>
                    Days
                    <input
                      type="number"
                      min={1}
                      value={activePopup.frequencyDays}
                      disabled={activePopup.frequency !== "days"}
                      onChange={(event) =>
                        updatePopup(
                          activePopup.id,
                          "frequencyDays",
                          Number(event.currentTarget.value),
                        )
                      }
                    />
                  </label>
                </div>
              </div>
            )}
          </div>
        )}
      </s-section>

      <s-section slot="aside" heading="Setup">
        <s-ordered-list>
          <s-list-item>Save your popups here.</s-list-item>
          <s-list-item>Open Online Store → Themes → Customize.</s-list-item>
          <s-list-item>Open App embeds and enable Dityy Popup Embed.</s-list-item>
          <s-list-item>Preview the pages that match your rules.</s-list-item>
        </s-ordered-list>
      </s-section>

      <style>{adminStyles}</style>
    </s-page>
  );
}

const adminStyles = `
  .dityy-admin-toolbar {
    align-items: center;
    display: flex;
    gap: 16px;
    justify-content: space-between;
    margin-bottom: 18px;
  }

  .dityy-admin-toolbar span {
    color: #616161;
    display: inline-block;
    margin-left: 10px;
  }

  .dityy-admin-button {
    align-items: center;
    background: #111;
    border: 1px solid #111;
    border-radius: 6px;
    color: #fff;
    cursor: pointer;
    display: inline-flex;
    font: inherit;
    justify-content: center;
    min-height: 34px;
    padding: 7px 13px;
  }

  .dityy-admin-button--secondary {
    background: #fff;
    color: #111;
  }

  .dityy-admin-button--danger {
    background: #fff;
    border-color: #b42318;
    color: #b42318;
  }

  .dityy-empty-state {
    border: 1px solid #dedede;
    border-radius: 8px;
    padding: 28px;
    text-align: center;
  }

  .dityy-empty-state h2 {
    margin: 0 0 8px;
  }

  .dityy-empty-state p {
    color: #616161;
    margin: 0 0 18px;
  }

  .dityy-admin-layout {
    display: grid;
    gap: 18px;
    grid-template-columns: minmax(180px, 260px) 1fr;
  }

  .dityy-popup-list {
    border: 1px solid #dedede;
    border-radius: 8px;
    overflow: hidden;
  }

  .dityy-popup-list__item {
    background: #fff;
    border: 0;
    border-bottom: 1px solid #eee;
    cursor: pointer;
    display: block;
    padding: 12px;
    text-align: left;
    width: 100%;
  }

  .dityy-popup-list__item:last-child {
    border-bottom: 0;
  }

  .dityy-popup-list__item--active {
    background: #f3f3f3;
    box-shadow: inset 3px 0 0 #111;
  }

  .dityy-popup-list__item span,
  .dityy-popup-list__item small {
    display: block;
  }

  .dityy-popup-list__item small {
    color: #616161;
    margin-top: 4px;
  }

  .dityy-popup-editor {
    border: 1px solid #dedede;
    border-radius: 8px;
    padding: 18px;
  }

  .dityy-editor-actions {
    display: flex;
    gap: 8px;
  }

  .dityy-field-grid {
    display: grid;
    gap: 14px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin-bottom: 14px;
  }

  .dityy-field-grid:has(label:nth-child(3)) {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .dityy-field-row {
    display: block;
    margin-bottom: 14px;
  }

  .dityy-field-row--inline {
    align-items: center;
    display: flex;
    justify-content: space-between;
  }

  .dityy-field-row label,
  .dityy-field-grid label,
  label.dityy-field-row {
    color: #303030;
    font-size: 13px;
    font-weight: 650;
  }

  .dityy-field-grid input,
  .dityy-field-grid select,
  .dityy-field-row input,
  .dityy-field-row select,
  .dityy-field-row textarea {
    border: 1px solid #b5b5b5;
    border-radius: 6px;
    box-sizing: border-box;
    display: block;
    font: inherit;
    margin-top: 6px;
    min-height: 36px;
    padding: 7px 9px;
    width: 100%;
  }

  .dityy-field-row textarea {
    resize: vertical;
  }

  .dityy-field-row input[type="checkbox"] {
    display: inline-block;
    margin: 0 8px 0 0;
    min-height: auto;
    width: auto;
  }

  @media (max-width: 860px) {
    .dityy-admin-layout,
    .dityy-field-grid {
      grid-template-columns: 1fr;
    }
  }
`;

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
