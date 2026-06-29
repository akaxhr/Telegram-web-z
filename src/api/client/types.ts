export interface ClientChat {
  id: string;
  title: string;
  type: string;
  lastMessageId?: number;
}

export interface ClientMessage {
  id: number;
  chatId: string;
  date: number;
  isOutgoing: boolean;
  content: {
    text: {
      text: string;
    };
  };
}

export interface ClientUser {
  id: string;
  username?: string;
  firstName?: string;
  lastName?: string;
}