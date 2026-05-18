import { useCallback, useEffect, useRef, useState } from "react";
import {
  data,
  useFetcher,
  useNavigate,
  useSearchParams,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { sendContactMessage } from "../lib/services/contact.server";
import { isValidEmail } from "../lib/utils/validation";
import { AppPageFooter } from "../components/app-page-footer";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

const MIN_MESSAGE_LENGTH = 10;

const CONTACT_SAVE_BAR = "contact-form-save-bar";

const SUBJECTS = [
  { label: "Feedback", value: "feedback" },
  { label: "Feature", value: "feature" },
  { label: "Help", value: "help" },
  { label: "Bug", value: "bug" },
  { label: "Other", value: "other" },
];

interface FieldErrors {
  name?: string;
  email?: string;
  message?: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const formData = await request.formData();
  const subject = String(formData.get("subject") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const message = String(formData.get("message") ?? "");

  const errors: FieldErrors = {};
  if (!name) errors.name = "You must enter your name";
  if (!email) errors.email = "You must enter your email";
  else if (!isValidEmail(email)) errors.email = "You must enter a valid email";
  if (message.length < MIN_MESSAGE_LENGTH) {
    errors.message = `Min length is ${MIN_MESSAGE_LENGTH} characters`;
  }
  if (Object.keys(errors).length > 0) {
    return data({ ok: false, errors }, { status: 400 });
  }

  const result = await sendContactMessage({
    subject,
    name,
    email,
    message,
    shopName: session.shop,
  });

  if (!result.ok) {
    return data({ ok: false, errors: {} as FieldErrors }, { status: 500 });
  }

  return data({ ok: true, errors: {} as FieldErrors });
};

export default function Contact() {
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fetcher = useFetcher<typeof action>();

  const initialSubject = searchParams.get("subject") ?? "feedback";
  const initialSubjectRef = useRef(initialSubject);
  const [subject, setSubject] = useState(initialSubject);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  const loading = fetcher.state !== "idle";
  const errors: FieldErrors = fetcher.data?.errors ?? {};
  const [sendError, setSendError] = useState<string | null>(null);
  const lastHandledResponseRef = useRef<typeof fetcher.data>(undefined);

  const isDirty =
    subject !== initialSubjectRef.current ||
    name !== "" ||
    email !== "" ||
    message !== "";

  useEffect(() => {
    if (isDirty) shopify.saveBar.show(CONTACT_SAVE_BAR);
    else shopify.saveBar.hide(CONTACT_SAVE_BAR);
  }, [isDirty, shopify]);

  useEffect(() => {
    return () => {
      shopify.saveBar.hide(CONTACT_SAVE_BAR);
    };
  }, [shopify]);

  const handleBreadcrumbClick = useCallback(async () => {
    try {
      await shopify.saveBar.leaveConfirmation();
    } catch {
      return;
    }
    navigate("/app");
  }, [shopify, navigate]);

  const handleCancel = useCallback(async () => {
    try {
      await shopify.saveBar.leaveConfirmation();
    } catch {
      return;
    }
    navigate("/app");
  }, [shopify, navigate]);

  const handleDiscard = useCallback(() => {
    setSubject(initialSubjectRef.current);
    setName("");
    setEmail("");
    setMessage("");
    setSendError(null);
  }, []);

  const handleSubmit = useCallback(() => {
    fetcher.submit(
      { subject, name, email, message },
      { method: "post", action: "/app/contact" },
    );
  }, [fetcher, subject, name, email, message]);

  useEffect(() => {
    if (fetcher.state !== "idle") return;
    if (!fetcher.data) return;
    if (lastHandledResponseRef.current === fetcher.data) return;
    lastHandledResponseRef.current = fetcher.data;

    if (fetcher.data.ok) {
      setSendError(null);
      shopify.saveBar.hide(CONTACT_SAVE_BAR);
      shopify.toast.show("Message sent");
      navigate("/app");
      return;
    }

    if (Object.keys(fetcher.data.errors ?? {}).length === 0) {
      setSendError(
        "Couldn't send your message. Check your connection and try again.",
      );
    } else {
      setSendError(null);
    }
  }, [fetcher.state, fetcher.data, shopify, navigate]);

  return (
    <s-page heading="Contact us" inlineSize="base">
      <s-button
        slot="breadcrumb-actions"
        variant="tertiary"
        onClick={handleBreadcrumbClick}
      >
        Dashboard
      </s-button>

      <ui-save-bar id={CONTACT_SAVE_BAR}>
        <button
          {...{ variant: "primary", loading: loading || undefined }}
          onClick={handleSubmit}
          disabled={loading || undefined}
        >
          Send
        </button>
        <button onClick={handleDiscard}>Discard</button>
      </ui-save-bar>

      <s-stack direction="block" gap="base">
        <s-section padding="base">
          <s-stack direction="block" gap="base">
            {sendError && <s-banner tone="critical">{sendError}</s-banner>}

            <s-select
              label="Subject"
              value={subject}
              onChange={(event: Event) =>
                setSubject((event.target as HTMLSelectElement).value)
              }
              disabled={loading || undefined}
            >
              {SUBJECTS.map((s) => (
                <s-option key={s.value} value={s.value}>
                  {s.label}
                </s-option>
              ))}
            </s-select>

            <s-grid
              gridTemplateColumns="@container (inline-size <= 600px) 1fr, 1fr 1fr"
              gap="base"
            >
              <s-text-field
                label="Name"
                value={name}
                disabled={loading || undefined}
                error={errors.name || undefined}
                onInput={(event: Event) =>
                  setName((event.target as HTMLInputElement).value)
                }
              />
              <s-text-field
                label="E-Mail"
                value={email}
                disabled={loading || undefined}
                error={errors.email || undefined}
                onInput={(event: Event) =>
                  setEmail((event.target as HTMLInputElement).value)
                }
              />
            </s-grid>

            <s-text-area
              label="Message"
              value={message}
              disabled={loading || undefined}
              error={errors.message || undefined}
              rows={6}
              onInput={(event: Event) =>
                setMessage((event.target as HTMLTextAreaElement).value)
              }
            />

            <s-stack direction="inline" gap="small" justifyContent="end">
              <s-button
                variant="tertiary"
                onClick={handleCancel}
                disabled={loading || undefined}
              >
                Cancel
              </s-button>
              <s-button
                variant="primary"
                onClick={handleSubmit}
                disabled={loading || undefined}
                loading={loading || undefined}
              >
                Send
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>

        <AppPageFooter />
      </s-stack>
    </s-page>
  );
}
