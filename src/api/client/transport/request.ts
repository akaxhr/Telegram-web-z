type RequestOptions = {
  shouldThrow?: boolean;
  shouldReturnTrue?: boolean;
  shouldIgnoreErrors?: boolean;
};

const API_URL =
  typeof window !== "undefined"
    ? "/api/client/request"
    : `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/client/request`;

export async function request<T = any>(
  method: string,
  payload?: unknown,
  options: RequestOptions = {},
): Promise<T | undefined> {
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        method,
        payload,
        options,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      if (options.shouldThrow) {
        throw new Error(result?.error ?? `Request failed (${response.status})`);
      }

      if (!options.shouldIgnoreErrors) {
        console.warn("[CLIENT REQUEST FAILED]", method, result);
      }

      return undefined;
    }

    if (options.shouldReturnTrue) {
      return true as T;
    }

    return result as T;
  } catch (err) {
    if (options.shouldThrow) throw err;

    if (!options.shouldIgnoreErrors) {
      console.warn("[CLIENT REQUEST FAILED]", method, err);
    }

    return undefined;
  }
}