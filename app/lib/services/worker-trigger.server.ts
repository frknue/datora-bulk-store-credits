const MAX_TRIGGER_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;

export async function triggerWorkerJob(
  jobId: string,
  shopName: string,
): Promise<boolean> {
  const workerUrl = process.env.WORKER_SERVICE_URL;

  if (!workerUrl) {
    throw new Error("WORKER_SERVICE_URL is not configured");
  }

  const url = `${workerUrl}/run-job?id=${jobId}&shop=${shopName}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    [process.env.PRESHARED_AUTH_HEADER_KEY || "X-Custom-PSK"]:
      process.env.PRESHARED_AUTH_HEADER_VALUE || "",
  };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_TRIGGER_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) {
        return true;
      }

      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 429
      ) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `Worker rejected job ${jobId}: ${response.status} ${body}`.trim(),
        );
      }

      lastError = new Error(`Worker returned ${response.status} for job ${jobId}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (lastError.message.includes("Worker rejected")) {
        throw lastError;
      }
    }

    if (attempt < MAX_TRIGGER_RETRIES - 1) {
      const delay = RETRY_BASE_DELAY_MS * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError ?? new Error(`Failed to trigger worker for job ${jobId}`);
}

export async function triggerStoreCreditJob(
  jobId: string,
  shopName: string,
): Promise<boolean> {
  const workerUrl = process.env.WORKER_SERVICE_URL;

  if (!workerUrl) {
    throw new Error("WORKER_SERVICE_URL is not configured");
  }

  const url = `${workerUrl}/run-store-credit-job?id=${jobId}&shop=${shopName}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    [process.env.PRESHARED_AUTH_HEADER_KEY || "X-Custom-PSK"]:
      process.env.PRESHARED_AUTH_HEADER_VALUE || "",
  };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_TRIGGER_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) return true;

      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 429
      ) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `Worker rejected store credit job ${jobId}: ${response.status} ${body}`.trim(),
        );
      }

      lastError = new Error(
        `Worker returned ${response.status} for store credit job ${jobId}`,
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (lastError.message.includes("Worker rejected")) throw lastError;
    }

    if (attempt < MAX_TRIGGER_RETRIES - 1) {
      const delay = RETRY_BASE_DELAY_MS * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError ?? new Error(`Failed to trigger worker for store credit job ${jobId}`);
}
