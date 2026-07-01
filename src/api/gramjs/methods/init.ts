import type {
  ApiInitialArgs,
  ApiOnProgress,
  OnApiUpdate,
} from '../../types';
import type { LocalDb } from '../localDb';
import type { MethodArgs, MethodResponse, Methods } from './types';

import Deferred from '../../../util/Deferred';
import { updateFullLocalDb } from '../localDb';
import { init as initUpdateEmitter } from '../updates/apiUpdateEmitter';
import { init as initClient } from './client';
import * as methods from './index';

export function initApi(_onUpdate: OnApiUpdate, initialArgs: ApiInitialArgs, initialLocalDb?: LocalDb) {
  initUpdateEmitter(_onUpdate);

  if (initialLocalDb) updateFullLocalDb(initialLocalDb);
return Promise.resolve();
}

export function callApi<T extends keyof Methods>(
  fnName: T,
  ...args: MethodArgs<T>
): MethodResponse<T> {
  console.log('[WORKER METHODS CALL]', fnName);

  const method = methods[fnName] as any;

  if (method) {
    console.log('[WORKER METHOD FOUND]', fnName);
    return method(...args);
  }

  switch (String(fnName)) {
    case 'loadAllChats':
    case 'loadConfig':
    case 'loadAppConfig':
    case 'loadContactList':
      case 'fetchQuickReplies':
        case 'fetchAllStories':
case 'fetchPromoData':
case 'fetchContentSettings':
case 'fetchRecentReactions':
case 'fetchDefaultTagReactions':
case 'loadAttachBots':
case 'fetchContactSignUpSetting':
case 'fetchNotifyDefaultSettings':
case 'fetchNotificationExceptions':
case 'fetchTopPeers':
case 'fetchTopReactions':
case 'fetchStarsStatus':
case 'fetchStarsTopupOptions':
case 'fetchEmojiKeywords':
case 'fetchFeaturedEmojiStickers':
case 'fetchSavedReactionTags':
case 'fetchPaidReactionPrivacy':
case 'fetchDefaultTopicIcons':
case 'fetchAnimatedEmojis':
case 'fetchAnimatedEmojiEffects':
case 'fetchAvailableReactions':
case 'fetchCollectibleEmojiStatuses':
case 'fetchGenericEmojiEffects':
case 'fetchPremiumGifts':
case 'fetchTonGifts':
case 'fetchStarGifts':
case 'fetchAvailableEffects':
case 'fetchStickers':
case 'fetchTimezones':
case 'fetchAiComposeTones':
case 'fetchStarGiftActiveAuctions':
case 'fetchCountryList':
case 'fetchCustomEmoji':
case 'fetchNearestCountry':
      return true as MethodResponse<T>;

    default:
      console.warn('[WORKER METHOD MISSING]', fnName);
      return undefined as MethodResponse<T>;
  }
}
export function cancelApiProgress(progressCallback: ApiOnProgress) {
  progressCallback.isCanceled = true;
}
