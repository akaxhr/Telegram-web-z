// server/lib/telegram.js

const BOT_TOKEN = process.env.BOT_TOKEN;
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function call(method, payload = {}) {
  if (!BOT_TOKEN) throw new Error("BOT_TOKEN missing");

  const res = await fetch(`${API_BASE}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const json = await res.json();

  if (!json.ok) {
    throw new Error(json.description || `Telegram ${method} failed`);
  }

  return json.result;
}

export const telegram = {
  call,

  getMe: () => call("getMe"),
  getWebhookInfo: () => call("getWebhookInfo"),
  setWebhook: (payload) => call("setWebhook", payload),
  deleteWebhook: (payload = {}) => call("deleteWebhook", payload),

  sendMessage: (payload) => call("sendMessage", payload),
  editMessageText: (payload) => call("editMessageText", payload),
  deleteMessage: (payload) => call("deleteMessage", payload),

  sendPhoto: (payload) => call("sendPhoto", payload),
  sendVideo: (payload) => call("sendVideo", payload),
  sendDocument: (payload) => call("sendDocument", payload),
  sendAudio: (payload) => call("sendAudio", payload),
  sendVoice: (payload) => call("sendVoice", payload),
  sendVideoNote: (payload) => call("sendVideoNote", payload),
  sendAnimation: (payload) => call("sendAnimation", payload),
  sendSticker: (payload) => call("sendSticker", payload),
  sendMediaGroup: (payload) => call("sendMediaGroup", payload),
  sendLocation: (payload) => call("sendLocation", payload),
  sendVenue: (payload) => call("sendVenue", payload),
  sendContact: (payload) => call("sendContact", payload),
  sendPoll: (payload) => call("sendPoll", payload),
  sendDice: (payload) => call("sendDice", payload),
  sendLivePhoto: (payload) => call("sendLivePhoto", payload),

  sendRichMessage: (payload) => call("sendRichMessage", payload),
  sendRichMessageDraft: (payload) => call("sendRichMessageDraft", payload),

  forwardMessage: (payload) => call("forwardMessage", payload),
  forwardMessages: (payload) => call("forwardMessages", payload),
  copyMessage: (payload) => call("copyMessage", payload),
  copyMessages: (payload) => call("copyMessages", payload),

  pinChatMessage: (payload) => call("pinChatMessage", payload),
  unpinChatMessage: (payload) => call("unpinChatMessage", payload),
  unpinAllChatMessages: (payload) => call("unpinAllChatMessages", payload),

  getChat: (payload) => call("getChat", payload),
  getChatMember: (payload) => call("getChatMember", payload),
  getChatAdministrators: (payload) => call("getChatAdministrators", payload),
  getChatMemberCount: (payload) => call("getChatMemberCount", payload),

  setChatTitle: (payload) => call("setChatTitle", payload),
  setChatDescription: (payload) => call("setChatDescription", payload),
  setChatPhoto: (payload) => call("setChatPhoto", payload),
  deleteChatPhoto: (payload) => call("deleteChatPhoto", payload),
  leaveChat: (payload) => call("leaveChat", payload),

  banChatMember: (payload) => call("banChatMember", payload),
  unbanChatMember: (payload) => call("unbanChatMember", payload),
  restrictChatMember: (payload) => call("restrictChatMember", payload),
  promoteChatMember: (payload) => call("promoteChatMember", payload),
  setChatPermissions: (payload) => call("setChatPermissions", payload),

  deleteMessageReaction: (payload) => call("deleteMessageReaction", payload),
  deleteAllMessageReactions: (payload) => call("deleteAllMessageReactions", payload),

  answerCallbackQuery: (payload) => call("answerCallbackQuery", payload),
  answerInlineQuery: (payload) => call("answerInlineQuery", payload),
  answerGuestQuery: (payload) => call("answerGuestQuery", payload),
  answerChatJoinRequestQuery: (payload) => call("answerChatJoinRequestQuery", payload),

  answerShippingQuery: (payload) => call("answerShippingQuery", payload),
  answerPreCheckoutQuery: (payload) => call("answerPreCheckoutQuery", payload),

  getMyStarBalance: () => call("getMyStarBalance"),
  getStarTransactions: (payload = {}) => call("getStarTransactions", payload),
  refundStarPayment: (payload) => call("refundStarPayment", payload),
  editUserStarSubscription: (payload) => call("editUserStarSubscription", payload),
};