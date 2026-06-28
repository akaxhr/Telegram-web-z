type RequestOptions = {
  shouldThrow?: boolean;
  shouldReturnTrue?: boolean;
  shouldIgnoreErrors?: boolean;
};

export async function request<T = any>(
  method: string,
  payload?: unknown,
  options: RequestOptions = {},
): Promise<T | undefined> {
  try {
    const response = await fetch('/api/client/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, payload }),
    });

    if (!response.ok) {
      if (options.shouldThrow) throw new Error(`Request failed: ${response.status}`);
      return undefined;
    }

    const result = await response.json();

    if (options.shouldReturnTrue) {
      return true as T;
    }

    return result as T;
  } catch (err) {
    if (options.shouldThrow) throw err;
    if (!options.shouldIgnoreErrors) console.warn('[CLIENT REQUEST FAILED]', method, err);
    return undefined;
  }
}