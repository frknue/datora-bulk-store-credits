import prisma from "../../db.server";
import { unauthenticated } from "../../shopify.server";
import { GIFT_CARDS_QUERY, SEARCH_GIFT_CARDS_QUERY } from "../graphql/admin";
import { decryptGiftCard } from "../utils/encryption.server";

interface GiftCardInput {
  id?: number | string;
  value?: number;
  code?: string;
  lastCharacters?: string;
}

interface GiftCardNode {
  id: string;
  lastCharacters: string;
  balance: {
    amount: string;
    currencyCode: string;
  };
  initialValue: {
    amount: string;
    currencyCode: string;
  };
  enabled: boolean;
  expiresOn: string | null;
}

interface GraphqlClient {
  graphql: (
    query: string,
    options?: {
      variables?: Record<string, unknown>;
    },
  ) => Promise<Response>;
}

interface GraphqlError {
  message?: string;
}

interface SearchGiftCardsResponse {
  data?: {
    giftCards?: {
      edges?: Array<{
        node?: GiftCardNode | null;
      }>;
    };
  };
  errors?: GraphqlError[];
}

function getUsageTrackingErrorMessage(message: string): string {
  if (message.includes("not approved to access the GiftCard object")) {
    return "This Shopify app is not approved to read the GiftCard object yet. Usage tracking in V2 cannot work until Shopify grants that protected-data access.";
  }

  return message;
}

function normalizeGiftCardCode(code: unknown): string | undefined {
  if (typeof code !== "string" || code.trim() === "") {
    return undefined;
  }

  try {
    return decryptGiftCard(code);
  } catch {
    return code;
  }
}

function normalizeGiftCardInputs(giftCards: unknown): GiftCardInput[] {
  if (!Array.isArray(giftCards)) {
    return [];
  }

  const normalizedGiftCards = giftCards
    .map((giftCard) => {
      let parsedGiftCard = giftCard;

      if (typeof giftCard === "string") {
        try {
          parsedGiftCard = JSON.parse(giftCard);
        } catch {
          return null;
        }
      }

      if (!parsedGiftCard || typeof parsedGiftCard !== "object") {
        return null;
      }

      const id =
        Reflect.get(parsedGiftCard, "id") ??
        Reflect.get(parsedGiftCard, "giftCardId") ??
        Reflect.get(parsedGiftCard, "gift_card_id") ??
        Reflect.get(parsedGiftCard, "ID");
      const value = Reflect.get(parsedGiftCard, "value");
      const code = normalizeGiftCardCode(Reflect.get(parsedGiftCard, "code"));
      const lastCharacters =
        Reflect.get(parsedGiftCard, "lastCharacters") ??
        Reflect.get(parsedGiftCard, "last_characters");

      if (typeof id !== "number" && typeof id !== "string" && typeof code !== "string") {
        return null;
      }

      if (typeof id === "string" && id.trim() === "") {
        return null;
      }

      return {
        id: typeof id === "number" || typeof id === "string" ? id : undefined,
        value: typeof value === "number" ? value : undefined,
        code,
        lastCharacters:
          typeof lastCharacters === "string" && lastCharacters.trim() !== ""
            ? lastCharacters
            : undefined,
      };
    })
    .filter((giftCard) => giftCard !== null);

  return normalizedGiftCards as GiftCardInput[];
}

function extractNumericId(gid: string): string {
  const match = gid.match(/(\d+)$/);
  return match ? match[1] : gid;
}

function determineBalanceStatus(initial: number, current: number): string {
  if (current <= 0) return "empty";
  if (current < initial) return "partial";
  return "full";
}

function determineStatus(enabled: boolean, expiresOn: string | null): string {
  if (!enabled) return "disabled";
  if (expiresOn) {
    const expiry = new Date(expiresOn);
    if (expiry < new Date()) return "expired";
  }
  return "enabled";
}

function toShopifyGID(id: number | string): string {
  if (typeof id === "string" && id.startsWith("gid://shopify/GiftCard/")) {
    return id;
  }

  return `gid://shopify/GiftCard/${id}`;
}

function buildUsageRecordUpsert(jobId: string, node: GiftCardNode) {
  const giftCardId = extractNumericId(node.id);
  const initialValue = parseFloat(node.initialValue.amount);
  const currentBalance = parseFloat(node.balance.amount);
  const amountRedeemed = Math.max(0, initialValue - currentBalance);
  const balanceStatus = determineBalanceStatus(initialValue, currentBalance);
  const status = determineStatus(node.enabled, node.expiresOn);

  return prisma.giftCardUsage.upsert({
    where: {
      id: `${jobId}_${giftCardId}`,
    },
    create: {
      id: `${jobId}_${giftCardId}`,
      jobId,
      giftCardId,
      lastCharacters: node.lastCharacters,
      initialValue,
      currentBalance,
      amountRedeemed,
      status,
      balanceStatus,
      lastCheckedAt: new Date(),
    },
    update: {
      currentBalance,
      amountRedeemed,
      status,
      balanceStatus,
      lastCheckedAt: new Date(),
    },
  });
}

async function searchGiftCardByCode(
  client: GraphqlClient,
  code: string,
  lastCharacters?: string,
): Promise<GiftCardNode | null> {
  const response = await client.graphql(SEARCH_GIFT_CARDS_QUERY, {
    variables: {
      first: 5,
      query: code,
    },
  });

  const responseJson: SearchGiftCardsResponse = await response.json();

  if (responseJson.errors && responseJson.errors.length > 0) {
    throw new Error(
      getUsageTrackingErrorMessage(
        responseJson.errors
          .map((error) => error.message || "Unknown GraphQL error")
          .join("; "),
      ),
    );
  }

  const nodes = (responseJson.data?.giftCards?.edges || [])
    .map((edge) => edge.node)
    .filter((node): node is GiftCardNode => node !== null && node !== undefined);

  if (!lastCharacters) {
    return nodes[0] ?? null;
  }

  const matchingNode = nodes.find(
    (node) => node.lastCharacters.toLowerCase() === lastCharacters.toLowerCase(),
  );

  return matchingNode ?? nodes[0] ?? null;
}

async function runGiftCardUsageTracking(
  client: GraphqlClient,
  jobId: string,
  giftCards: unknown,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const normalizedGiftCards = normalizeGiftCardInputs(giftCards);

  if (normalizedGiftCards.length === 0) {
    throw new Error("No valid gift cards found for usage tracking");
  }

  const batchSize = 50;
  const total = normalizedGiftCards.length;
  let processed = 0;
  let fetchedCount = 0;

  const giftCardsWithIds = normalizedGiftCards.filter(
    (giftCard): giftCard is GiftCardInput & { id: number | string } =>
      giftCard.id !== undefined,
  );
  const giftCardsWithoutIds = normalizedGiftCards.filter(
    (giftCard) => giftCard.id === undefined,
  );

  for (let i = 0; i < giftCardsWithIds.length; i += batchSize) {
    const batch = giftCardsWithIds.slice(i, i + batchSize);
    const gids = batch.map((gc) => toShopifyGID(gc.id));

    const response = await client.graphql(GIFT_CARDS_QUERY, {
      variables: { ids: gids },
    });

    const responseJson: {
      data?: {
        nodes?: (GiftCardNode | null)[];
      };
      errors?: GraphqlError[];
    } = await response.json();

    if (responseJson.errors && responseJson.errors.length > 0) {
      throw new Error(
        getUsageTrackingErrorMessage(
          responseJson.errors
            .map((error) => error.message || "Unknown GraphQL error")
            .join("; "),
        ),
      );
    }

    const fetchedCards = (responseJson?.data?.nodes || []).filter(
      (node): node is GiftCardNode => node !== null && "id" in node,
    );

    fetchedCount += fetchedCards.length;

    const upsertPromises = fetchedCards.map((node) =>
      buildUsageRecordUpsert(jobId, node),
    );

    await Promise.all(upsertPromises);
    processed += batch.length;

    if (onProgress) {
      onProgress(processed, total);
    }
  }

  for (const giftCard of giftCardsWithoutIds) {
    if (!giftCard.code) {
      processed += 1;
      if (onProgress) {
        onProgress(processed, total);
      }
      continue;
    }

    const node = await searchGiftCardByCode(
      client,
      giftCard.code,
      giftCard.lastCharacters,
    );

    if (node) {
      await buildUsageRecordUpsert(jobId, node);
      fetchedCount += 1;
    }

    processed += 1;
    if (onProgress) {
      onProgress(processed, total);
    }
  }

  if (fetchedCount === 0) {
    throw new Error("Shopify returned no gift card usage data for this job");
  }

  await prisma.job.update({
    where: { id: jobId },
    data: { usageLastRefreshedAt: new Date() },
  });
}

export async function createShopAdminGraphqlClient(
  shopName: string,
): Promise<GraphqlClient> {
  const { admin } = await unauthenticated.admin(shopName);
  return {
    graphql: async (query, options) => {
      return admin.graphql(query, { variables: options?.variables });
    },
  };
}

export async function trackGiftCardUsage(
  client: GraphqlClient,
  jobId: string,
  giftCards: unknown,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  return runGiftCardUsageTracking(client, jobId, giftCards, onProgress);
}

export async function trackGiftCardUsageForShop(
  shopName: string,
  jobId: string,
  giftCards: unknown,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const client = await createShopAdminGraphqlClient(shopName);
  return runGiftCardUsageTracking(client, jobId, giftCards, onProgress);
}
