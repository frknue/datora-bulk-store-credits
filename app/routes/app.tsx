import {
  Outlet,
  useFetcher,
  useLoaderData,
  useNavigate,
  useNavigation,
  useRouteError,
} from "react-router";
import { useCallback, useEffect, useRef } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getPlanFromBilling } from "../services/plan.server";
import { SHOP_INFO_QUERY } from "../lib/graphql/admin";
import { completeOnboarding } from "../lib/services/dashboard.server";
import {
  OnboardingModal,
  type OnboardingModalHandle,
} from "../components/onboarding-modal";
import prisma from "../db.server";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const subscriptionPlan = await getPlanFromBilling(billing, session.shop);

  let shopCurrency: string | null = null;
  let shopTimezoneOffset: string | null = null;
  let shopMetadataLoaded = false;
  try {
    const shopResponse = await admin.graphql(SHOP_INFO_QUERY);
    const { data } = await shopResponse.json();
    shopCurrency = data.shop.currencyCode;
    shopTimezoneOffset = data.shop.timezoneOffset;
    shopMetadataLoaded = true;
  } catch (error) {
    console.error("Error fetching shop info:", error);
  }

  const userSettings = await prisma.user.findUnique({
    where: { shopName: session.shop },
    select: { completedOnboarding: true },
  });

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    subscriptionPlan,
    shopCurrency,
    shopTimezoneOffset,
    shopMetadataLoaded,
    completedOnboarding: userSettings?.completedOnboarding ?? false,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("action");

  if (actionType === "complete_onboarding") {
    await completeOnboarding(session.shop);
    return { success: true };
  }

  return { success: false };
};

function AppLoadingIndicator() {
  const shopify = useAppBridge();
  const navigation = useNavigation();
  const isNavigating = navigation.state !== "idle";

  useEffect(() => {
    shopify.loading(isNavigating);
  }, [isNavigating, shopify]);

  return null;
}

function SupportHandler({ onSupport }: { onSupport: () => void }) {
  const shopify = useAppBridge();
  const onSupportRef = useRef(onSupport);
  onSupportRef.current = onSupport;

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (shopify as any).support?.registerHandler(() => {
      onSupportRef.current();
    });
  }, [shopify]);

  return null;
}

export default function App() {
  const {
    apiKey,
    subscriptionPlan,
    shopCurrency,
    shopTimezoneOffset,
    shopMetadataLoaded,
    completedOnboarding,
  } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const onboardingModalRef = useRef<OnboardingModalHandle>(null);

  const handleOnboardingComplete = useCallback(() => {
    fetcher.submit(
      { action: "complete_onboarding" },
      { method: "post", action: "/app" },
    );
  }, [fetcher]);

  const openOnboarding = useCallback(() => {
    onboardingModalRef.current?.open();
  }, []);

  useEffect(() => {
    if (!completedOnboarding) {
      onboardingModalRef.current?.open();
    }
  }, [completedOnboarding]);

  return (
    <AppProvider embedded apiKey={apiKey}>
      <AppLoadingIndicator />
      <SupportHandler onSupport={() => navigate("/app/contact?subject=help")} />
      <s-app-nav>
        <s-link href="/app" {...{ rel: "home" }}>
          Home
        </s-link>
        <s-link href="/app/gift-cards">Gift Cards</s-link>
        <s-link href="/app/store-credit">Store Credits</s-link>
        <s-link href="/app/subscriptions">Subscriptions</s-link>
        <s-link href="/app/faq">Help</s-link>
        <s-link href="/app/changelog">Changelog</s-link>
        <s-link href="/app/contact">Contact</s-link>
        <s-link href="/app/settings">Settings</s-link>
      </s-app-nav>
      <Outlet
        context={{
          subscriptionPlan,
          shopCurrency,
          shopTimezoneOffset,
          shopMetadataLoaded,
          openOnboarding,
        }}
      />
      <OnboardingModal
        ref={onboardingModalRef}
        onComplete={handleOnboardingComplete}
      />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
