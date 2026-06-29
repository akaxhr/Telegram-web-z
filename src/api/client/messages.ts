let messages = [
  {
    id: 1,
    chatId: '1',
    date: Math.floor(Date.now() / 1000) - 60,
    isOutgoing: false,
    content: { text: { text: 'Welcome to Icha Panel' } },
  },
];

export async function fetchMessages() {
  return {
    messages,
    count: messages.length,
    topics: [],
  };
}

export async function sendMessage(payload: any) {
  const params = payload?.[0] || payload;
  const text = params?.text || 'Unknown';
  const chatId = String(params?.chat?.id || '1');

  messages.push({
    id: Date.now(),
    chatId,
    date: Math.floor(Date.now() / 1000),
    isOutgoing: true,
    content: { text: { text } },
  });

  return true;
}

export async function editMessage() {
  return true;
}

export async function deleteMessages() {
  return true;
}