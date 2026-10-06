/*
 * Messaging types: the message as the Data Access Layer stores it, and the shapes the
 * Messaging API sends to the app (docs/api-contract.md, Messaging section).
 */

/** A message as stored by the Data Access Layer. Times are Date objects in UTC. */
export interface StoredMessage {
  messageId: string;
  senderId: string;
  receiverId: string;
  text: string;
  sentAt: Date;
  readAt: Date | null;
  replyToMessageId: string | null;
}

/** The data needed to store a new message. The repository creates the ID. */
export interface NewMessage {
  senderId: string;
  receiverId: string;
  text: string;
  sentAt: Date;
  replyToMessageId: string | null;
}

/**
 * Position of a message in the message order. Messages sort by `sentAt`, then by `messageId`,
 * so two messages sent in the same millisecond still have a fixed order and paging never skips
 * or repeats one.
 */
export interface MessageKey {
  sentAt: Date;
  messageId: string;
}

/** Another user as shown in lists (`UserSummary` in the contract). */
export interface UserSummary {
  userId: string;
  displayName: string;
  photoId: string;
}

/** The message a reply points to, as sent to the app. */
export interface ReplyPreview {
  messageId: string;
  senderId: string;
  text: string;
}

/** A message as sent to the app (`Message` in the contract). `sentAt` is UTC ISO 8601. */
export interface Message {
  messageId: string;
  senderId: string;
  receiverId: string;
  text: string;
  sentAt: string;
  isRead: boolean;
  replyTo: ReplyPreview | null;
}

/** The last message of a chat list row. */
export interface LastMessage {
  messageId: string;
  senderId: string;
  text: string;
  sentAt: string;
}

/** One row of the chat list. */
export interface ConversationRow {
  user: UserSummary;
  isFavorite: boolean;
  lastMessage: LastMessage;
  unreadCount: number;
}

/** One item of the home page unread list. */
export interface UnreadMessage {
  messageId: string;
  sender: UserSummary;
  text: string;
  sentAt: string;
}

/**
 * Compare two messages in the message order (oldest first).
 * @param a - first message position
 * @param b - second message position
 * @returns a negative number if `a` is older, a positive number if newer, 0 if the same
 */
export function compareMessageKeys(a: MessageKey, b: MessageKey): number {
  const timeDifference = a.sentAt.getTime() - b.sentAt.getTime();
  if (timeDifference !== 0) {
    return timeDifference;
  }
  if (a.messageId === b.messageId) {
    return 0;
  }
  return a.messageId < b.messageId ? -1 : 1;
}
