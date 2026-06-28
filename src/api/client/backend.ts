export async function backendGet(path: string) {
  const response = await fetch(path);

  if (!response.ok) {
    throw new Error(`Backend GET failed: ${response.status}`);
  }

  return response.json();
}

export async function backendPost(path: string, body: unknown) {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Backend POST failed: ${response.status}`);
  }

  return response.json();
}