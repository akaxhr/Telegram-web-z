const methodMap: Record<string, string> = {
  // ==========================
  // Messages
  // ==========================
  fetchMessages: "messages.fetchMessages",
  fetchMessage: "messages.fetchMessage",
  fetchRichMessage: "messages.fetchRichMessage",
  fetchMessagesById: "messages.fetchMessagesByIds",

  sendMessage: "messages.sendMessage",
  editMessage: "messages.editMessage",
  deleteMessages: "messages.deleteMessages",
  fetchMessageViews: "messages.getMessagesViews",

  // ==========================
  // Users
  // ==========================
  getFullUser: "users.getFullUser",
  getCommonChats: "users.getCommonChats",
  getRequirementsToContact: "users.getRequirementsToContact",
  getNearestDc: "users.getNearestDc",
  getContacts: "users.getContacts",
  getUsers: "users.getUsers",
  importContacts: "users.importContacts",
  addContact: "users.addContact",
  deleteContact: "users.deleteContact",
  toggleNoPaidMessagesException: "users.toggleNoPaidMessagesException",
  getPaidMessagesRevenue: "users.getPaidMessagesRevenue",
  getUserPhotos: "users.getUserPhotos",
  reportSpam: "users.reportSpam",
  updateEmojiStatus: "users.updateEmojiStatus",
  editCloseFriends: "users.editCloseFriends",
  updateContactNote: "users.updateContactNote",
  toggleNoForwards: "users.toggleNoForwards",
};

export async function callApiClient(method: string, payload?: any) {
  const backendMethod = methodMap[method] ?? method;

  console.warn('[CLIENT API]', method, payload);
  console.warn('[BACKEND METHOD]', backendMethod);

  try {
    const response = await fetch('/api/client/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: backendMethod,
        payload: Array.isArray(payload) ? payload[0] : payload,
      }),
    });

    const result = await response.json();
    console.warn('[CLIENT API RESULT]', backendMethod, result);

    if (!response.ok) return undefined;

    return result;
  } catch (err) {
    console.warn('[CLIENT API FAILED]', backendMethod, err);
    return undefined;
  }
}