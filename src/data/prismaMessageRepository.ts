/*
 * Prisma versions of the Messaging repositories (Data Access Layer, owner: Chuan; written by Vic
 * as a proposal): messages, the favorite IDs for the chat list order, and the user summaries.
 * Messages sort by `sent_at`, then by `id` (UUID version 7, so it grows with time), newest first.
 * The table column is `body`; the service calls it `text`.
 */
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import type {
  ConversationSummary,
  MessageRepository,
  UserReader,
} from "../services/messaging/messageRepository";
import type { MessageKey, StoredMessage } from "../services/messaging/messagingTypes";
import { isUuid, onlyUuids } from "./ids";
import { photoUrlFromKey } from "./photoKey";

interface MessageRow {
  id: string;
  senderId: string;
  receiverId: string;
  body: string;
  sentAt: Date;
  readAt: Date | null;
  replyToMessageId: string | null;
}

interface RawSummaryRow {
  id: string;
  sender_id: string;
  receiver_id: string;
  body: string;
  sent_at: Date;
  read_at: Date | null;
  reply_to_message_id: string | null;
  partner_id: string;
}

const NEWEST_FIRST: Prisma.MessageOrderByWithRelationInput[] = [{ sentAt: "desc" }, { id: "desc" }];
const OLDEST_FIRST: Prisma.MessageOrderByWithRelationInput[] = [{ sentAt: "asc" }, { id: "asc" }];

function toStored(row: MessageRow): StoredMessage {
  return {
    messageId: row.id,
    senderId: row.senderId,
    receiverId: row.receiverId,
    text: row.body,
    sentAt: row.sentAt,
    readAt: row.readAt,
    replyToMessageId: row.replyToMessageId,
  };
}

/** Messages older ("before") or newer ("after") than a position, in the message order. */
function keyFilter(direction: "before" | "after", key: MessageKey): Prisma.MessageWhereInput {
  const operator = direction === "before" ? "lt" : "gt";
  return {
    OR: [
      { sentAt: { [operator]: key.sentAt } },
      { sentAt: key.sentAt, id: { [operator]: key.messageId } },
    ],
  };
}

/**
 * Create the message repository on PostgreSQL.
 * @param prisma - the Prisma client from `createPrismaClient`
 * @returns the repository
 */
export function createPrismaMessageRepository(prisma: PrismaClient): MessageRepository {
  return {
    async insertMessage(message) {
      const row = await prisma.message.create({
        data: {
          senderId: message.senderId,
          receiverId: message.receiverId,
          body: message.text,
          sentAt: message.sentAt,
          replyToMessageId: message.replyToMessageId,
        },
      });
      return toStored(row);
    },

    async findMessageById(messageId) {
      if (!isUuid(messageId)) {
        return null;
      }
      const row = await prisma.message.findUnique({ where: { id: messageId } });
      return row === null ? null : toStored(row);
    },

    async findMessagesByIds(messageIds) {
      const rows = await prisma.message.findMany({ where: { id: { in: onlyUuids(messageIds) } } });
      return rows.map(toStored);
    },

    async listConversationMessages(userA, userB, page) {
      if (!isUuid(userA) || !isUuid(userB)) {
        return [];
      }
      const filters: Prisma.MessageWhereInput[] = [
        {
          OR: [
            { senderId: userA, receiverId: userB },
            { senderId: userB, receiverId: userA },
          ],
        },
      ];
      if (page.before !== undefined) {
        filters.push(keyFilter("before", page.before));
      }
      if (page.after !== undefined) {
        filters.push(keyFilter("after", page.after));
      }
      if (page.after !== undefined) {
        // The messages just after the position, closest first, then shown newest first.
        const rows = await prisma.message.findMany({
          where: { AND: filters },
          orderBy: OLDEST_FIRST,
          take: page.limit,
        });
        return rows.reverse().map(toStored);
      }
      const rows = await prisma.message.findMany({
        where: { AND: filters },
        orderBy: NEWEST_FIRST,
        take: page.limit,
      });
      return rows.map(toStored);
    },

    async listUnreadForReceiver(receiverId, page) {
      if (!isUuid(receiverId)) {
        return [];
      }
      const filters: Prisma.MessageWhereInput[] = [{ receiverId, readAt: null }];
      if (page.before !== undefined) {
        filters.push(keyFilter("before", page.before));
      }
      const rows = await prisma.message.findMany({
        where: { AND: filters },
        orderBy: NEWEST_FIRST,
        take: page.limit,
      });
      return rows.map(toStored);
    },

    async listConversationSummaries(userId) {
      if (!isUuid(userId)) {
        return [];
      }
      // The newest message of each chat partner, in either direction.
      const lastMessages = await prisma.$queryRaw<RawSummaryRow[]>`
        SELECT DISTINCT ON (partner_id)
          id, sender_id, receiver_id, body, sent_at, read_at, reply_to_message_id,
          CASE WHEN sender_id = ${userId}::uuid THEN receiver_id ELSE sender_id END AS partner_id
        FROM messages
        WHERE sender_id = ${userId}::uuid OR receiver_id = ${userId}::uuid
        ORDER BY partner_id, sent_at DESC, id DESC`;
      const unread = await prisma.message.groupBy({
        by: ["senderId"],
        where: { receiverId: userId, readAt: null },
        _count: { _all: true },
      });
      const unreadByPartner = new Map(unread.map((row) => [row.senderId, row._count._all]));

      return lastMessages.map((row): ConversationSummary => ({
        otherUserId: row.partner_id,
        lastMessage: toStored({
          id: row.id,
          senderId: row.sender_id,
          receiverId: row.receiver_id,
          body: row.body,
          sentAt: row.sent_at,
          readAt: row.read_at,
          replyToMessageId: row.reply_to_message_id,
        }),
        unreadCount: unreadByPartner.get(row.partner_id) ?? 0,
      }));
    },

    async markConversationRead(readerId, otherUserId, readAt) {
      if (!isUuid(readerId) || !isUuid(otherUserId)) {
        return 0;
      }
      await prisma.message.updateMany({
        where: { senderId: otherUserId, receiverId: readerId, readAt: null },
        data: { readAt },
      });
      return prisma.message.count({
        where: { senderId: otherUserId, receiverId: readerId, readAt: null },
      });
    },
  };
}

/**
 * Create the user reader for Messaging, Favorites and Notes on PostgreSQL.
 * @param prisma - the Prisma client from `createPrismaClient`
 * @returns a reader that gives `{ userId, displayName, photoUrl }` and leaves out unknown IDs
 */
export function createPrismaUserReader(prisma: PrismaClient): UserReader {
  return {
    async findUserSummaries(userIds) {
      const users = await prisma.user.findMany({
        where: { id: { in: onlyUuids(userIds) } },
        select: { id: true, displayName: true, photoKey: true },
      });
      return users.map((user) => ({
        userId: user.id,
        displayName: user.displayName,
        photoUrl: photoUrlFromKey(user.photoKey),
      }));
    },
  };
}
