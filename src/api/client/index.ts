import * as Chats from './chats';
import * as Messages from './messages';

const LANG_PACK = {
  AuthContinueOnThisLanguage: 'Continue in English',
};

export async function callApiClient(method: string, payload?: any) {
  console.log('[API]', method, payload);

  switch (method) {
    // ==========================
    // Language
    // ==========================

    case 'oldFetchLangPack':
    case 'fetchLangPack':
      return {
        langPack: LANG_PACK,
      };

    case 'fetchLangStrings':
      return {
        strings: LANG_PACK,
      };

    case 'fetchLanguage':
      return {
        langCode: 'en',
        baseLangCode: 'en',
        pluralCode: 'en',
        isRtl: false,
        nativeName: 'English',
        translationsUrl: '',
      };

    // ==========================
    // Chats
    // ==========================

case 'loadAllChats':
  return Chats.loadChats();
    // ==========================
    // Messages
    // ==========================

    case 'fetchMessages':
  return Messages.fetchMessages(payload);

    case 'sendMessage':
  return Messages.sendMessage(payload);

case 'editMessage':
  return Messages.editMessage(payload);

case 'deleteMessages':
  return Messages.deleteMessages(payload);
  

    default:
      console.warn('[API] Unhandled method:', method);
      return undefined;
  }
}