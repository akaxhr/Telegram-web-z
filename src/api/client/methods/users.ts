import { Api as GramJs } from '../../../lib/gramjs';
import { request } from '../transport/request';
import type {
  ApiEmojiStatusType, ApiFormattedText, ApiPeer, ApiUser,
} from '../../types';

import { toJSNumber } from '../../../util/numbers';
import { buildApiChatFromPreview } from '../apiBuilders/chats';
import { buildApiPhoto } from '../apiBuilders/common';
import { buildApiPeerId } from '../apiBuilders/peers';
import { buildApiUser, buildApiUserFullInfo, buildApiUserStatuses } from '../apiBuilders/users';
import {
  buildInputContact,
  buildInputEmojiStatus,
  buildInputPeer,
  buildInputTextWithEntities,
  buildInputUser,
  buildMtpPeerId,
  DEFAULT_PRIMITIVES,
  getEntityTypeById,
} from '../gramjsBuilders';
import { addPhotoToLocalDb, addUserToLocalDb } from '../helpers/localDb';
import localDb from '../localDb';
import { sendApiUpdate } from '../updates/apiUpdateEmitter';
import { invokeRequest } from './client';
import { searchMessagesInChat } from './messages';

export async function fetchFullUser({
  id,
  accessHash,
}: {
  id: string;
  accessHash?: string;
}) {
  const result = await request("users.getFullUser", { id });

  if (!result) return undefined;

  const user = result.users?.find((u: ApiUser) => u.id === id) || result.user;

  if (user) {
    sendApiUpdate({
      "@type": "updateUser",
      id,
      user,
      fullInfo: result.fullInfo,
    });
  }

  return {
    user,
    fullInfo: result.fullInfo,
    users: result.users ?? (user ? [user] : []),
    chats: result.chats ?? [],
    userStatusesById: result.userStatusesById ?? {},
  };
}

export async function fetchCommonChats({ user, maxId }: { user: ApiUser; maxId?: string }) {
  const result = await request("users.getCommonChats", {
    userId: user.id,
    maxId,
  });

  if (!result) return undefined;

  return {
    chatIds: result.chatIds ?? [],
    count: result.count ?? 0,
  };
}


export async function fetchPaidMessagesStarsAmount(user: ApiUser) {
  const result = await request("users.getRequirementsToContact", {
    userId: user.id,
  });

  return result?.starsAmount;
}

export async function fetchNearestCountry() {
  const result = await request("users.getNearestDc");
  return result?.country;
}


export async function fetchContactList() {
  const result = await request("users.getContacts");

  if (!result) return undefined;

  return {
    users: result.users ?? [],
    userStatusesById: result.userStatusesById ?? {},
  };
}

export async function fetchUsers({ users }: { users: ApiUser[] }) {
  const result = await request("users.getUsers", {
    userIds: users.map((u) => u.id),
  });

  if (!result) return undefined;

  return {
    users: result.users ?? result ?? [],
    userStatusesById: result.userStatusesById ?? {},
  };
}

export async function importContact({
  phone = DEFAULT_PRIMITIVES.STRING,
  firstName = DEFAULT_PRIMITIVES.STRING,
  lastName = DEFAULT_PRIMITIVES.STRING,
}: {
  phone?: string;
  firstName?: string;
  lastName?: string;
}) {
 const result = await request(
  "users.importContacts",
  {
    contacts: [
      {
        phone,
        firstName,
        lastName,
      },
    ],
  },
);

  if (result instanceof GramJs.contacts.ImportedContacts && result.users.length) {
    addUserToLocalDb(result.users[0]);
  }

  return result?.imported.length ? buildApiPeerId(result.imported[0].userId, 'user') : undefined;
}

export function updateContact({
  id,
  accessHash,
  phoneNumber = DEFAULT_PRIMITIVES.STRING,
  firstName = DEFAULT_PRIMITIVES.STRING,
  lastName = DEFAULT_PRIMITIVES.STRING,
  shouldSharePhoneNumber = false,
  note,
}: {
  id: string;
  accessHash?: string;
  phoneNumber?: string;
  firstName?: string;
  lastName?: string;
  shouldSharePhoneNumber?: boolean;
  note?: ApiFormattedText;
}) {
return request(
  "users.addContact",
  {
    id,
    firstName,
    lastName,
    phoneNumber,
    shouldSharePhoneNumber,
    note,
  },
  {
    shouldReturnTrue: true,
  },
);
}

export async function deleteContact({
  id,
  accessHash,
}: {
  id: string;
  accessHash?: string;
}) {
  const input = buildInputUser(id, accessHash);
  if (!(input instanceof GramJs.InputUser)) {
    return;
  }

  const result = await request(
  "users.deleteContact",
  {
    id,
  },
);

if (!result) {
  return;
}

sendApiUpdate({
  "@type": "deleteContact",
  id,
});
}

export async function toggleNoPaidMessagesException({ user, shouldRefundCharged }: {
  user: ApiUser;
  shouldRefundCharged?: boolean;
}) {
 const result = await request(
  "users.toggleNoPaidMessagesException",
  {
    userId: user.id,
    shouldRefundCharged,
  },
);
  return result;
}

export async function fetchPaidMessagesRevenue({ user }: {
  user: ApiUser;
  shouldRefundCharged?: boolean;
}) {
  const result = await request(
  "users.getPaidMessagesRevenue",
  {
    userId: user.id,
  },
);
  if (!result) return undefined;
  return toJSNumber(result.starsAmount);
}

export async function fetchProfilePhotos({
  peer,
  offset = 0,
  limit = 0,
}: {
  peer: ApiPeer;
  offset?: number;
  limit?: number;
}) {
  const chat = 'title' in peer ? peer : undefined;
  const user = !chat ? peer as ApiUser : undefined;
  if (user) {
    const { id, accessHash } = user;

    const result = await request(
  "users.getUserPhotos",
  {
    userId: id,
    limit,
    offset,
  },
);

    if (!result) {
      return undefined;
    }

    result.photos.forEach(addPhotoToLocalDb);

    const count = result instanceof GramJs.photos.PhotosSlice ? result.count : result.photos.length;
    const proposedNextOffsetId = offset + result.photos.length;
    const nextOffsetId = proposedNextOffsetId < count ? proposedNextOffsetId : undefined;

    return {
      count,
      photos: result.photos
        .filter((photo): photo is GramJs.Photo => photo instanceof GramJs.Photo)
        .map((photo) => buildApiPhoto(photo)),
      nextOffsetId,
    };
  }

  const result = await searchMessagesInChat({
    peer,
    type: 'profilePhoto',
    limit,
  });

  if (!result) {
    return undefined;
  }

  const {
    messages, totalCount, nextOffsetId,
  } = result;

  return {
    count: totalCount,
    photos: messages.map((message) => message.content.action?.type === 'chatEditPhoto' && message.content.action.photo)
      .filter(Boolean),
    nextOffsetId,
  };
}

export function reportSpam(userOrChat: ApiPeer) {
  const { id, accessHash } = userOrChat;

  return request(
  "users.reportSpam",
  {
    id,
  },
  {
    shouldReturnTrue: true,
  },
);
}

export function updateEmojiStatus(emojiStatus: ApiEmojiStatusType) {
return request(
  "users.updateEmojiStatus",
  {
    emojiStatus,
  },
  {
    shouldReturnTrue: true,
  },
);
}

export function saveCloseFriends(userIds: string[]) {
  const id = userIds.map((userId) => buildMtpPeerId(userId, 'user'));

 return request(
  "users.editCloseFriends",
  {
    ids: id,
  },
  {
    shouldReturnTrue: true,
  },
);
}

export function updateContactNote(user: ApiUser, note: ApiFormattedText) {
  const { id, accessHash } = user;

 return request(
  "users.updateContactNote",
  {
    id,
    note,
  },
  {
    shouldReturnTrue: true,
  },
);
}

export function toggleNoForwards({
  user,
  isEnabled,
  requestMsgId,
}: {
  user: ApiUser;
  isEnabled: boolean;
  requestMsgId?: number;
}) {
 return request(
  "users.toggleNoForwards",
  {
    userId: user.id,
    isEnabled,
    requestMsgId,
  },
  {
    shouldReturnTrue: true,
  },
);
}
