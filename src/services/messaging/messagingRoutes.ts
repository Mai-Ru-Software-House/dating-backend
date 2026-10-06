/*
 * Messaging routes: chat list, conversation, send, reply, unread list and mark as read
 * (docs/api-contract.md, Messaging section). Every route needs a logged in user. Bodies are JSON
 * only (`parse: "json"`), because Elysia would otherwise also accept a multipart body. Handlers
 * only check types with `t` and call the Messaging Service, which checks the rules.
 */
import { Elysia, t } from "elysia";

import { ApiError, ERROR_CODES } from "../../plugins/errors";
import { requireSession } from "../../plugins/session";
import type { SessionValidator } from "../auth/sessionValidator";
import type { MessagingService } from "./messagingService";

const HTTP_CREATED = 201;
const HTTP_BAD_REQUEST = 400;
const UNREAD_FILTER_VALUE = "true";
const JSON_ONLY = "json";
const TAGS = ["Messaging"];

const userSummarySchema = t.Object({
  userId: t.String(),
  displayName: t.String(),
  photoId: t.String(),
});

const messageSchema = t.Object({
  messageId: t.String(),
  senderId: t.String(),
  receiverId: t.String(),
  text: t.String(),
  sentAt: t.String({ description: "UTC ISO 8601 ending in Z, set by the server" }),
  isRead: t.Boolean(),
  replyTo: t.Nullable(t.Object({ messageId: t.String(), senderId: t.String(), text: t.String() })),
});

const chatListSchema = t.Object({
  conversations: t.Array(
    t.Object({
      user: userSummarySchema,
      isFavorite: t.Boolean(),
      lastMessage: t.Object({
        messageId: t.String(),
        senderId: t.String(),
        text: t.String(),
        sentAt: t.String(),
      }),
      unreadCount: t.Integer(),
    }),
  ),
});

const unreadListSchema = t.Object({
  messages: t.Array(
    t.Object({
      messageId: t.String(),
      sender: userSummarySchema,
      text: t.String(),
      sentAt: t.String(),
    }),
  ),
  hasMore: t.Boolean(),
});

const limitQuery = t.Optional(t.Numeric({ description: "Page size, 1 to 100" }));
const userIdParams = t.Object({ userId: t.String() });
const messageIdParams = t.Object({ messageId: t.String() });

/**
 * Build the Elysia plugin with the Messaging routes.
 * @param service - the Messaging Service
 * @param validateSession - Auth Service function that checks the access token
 * @returns an Elysia plugin to register with `.use()`
 * @throws ApiError (inside the routes) 401 without a valid token, and every error of the
 *   Messaging Service
 */
export function messagingRoutes(service: MessagingService, validateSession: SessionValidator) {
  return new Elysia({ name: "messaging-routes", prefix: "/api/v1" })
    .use(requireSession(validateSession))
    .get("/conversations", ({ session }) => service.getChatList(session.userId), {
      response: { 200: chatListSchema },
      detail: { summary: "Chat list, favorites first", tags: TAGS },
    })
    .get(
      "/conversations/:userId/messages",
      ({ session, params, query }) => service.getConversation(session.userId, params.userId, query),
      {
        params: userIdParams,
        query: t.Object({
          before: t.Optional(t.String()),
          after: t.Optional(t.String()),
          limit: limitQuery,
        }),
        response: { 200: t.Object({ messages: t.Array(messageSchema), hasMore: t.Boolean() }) },
        detail: {
          summary: "Messages with one user, newest first. Marks them as read.",
          tags: TAGS,
        },
      },
    )
    .post(
      "/conversations/:userId/messages",
      async ({ session, params, body, status }) => {
        const message = await service.sendMessage(session.userId, params.userId, {
          text: body.text,
          replyToMessageId: body.replyToMessageId,
        });
        return status(HTTP_CREATED, message);
      },
      {
        params: userIdParams,
        parse: JSON_ONLY,
        body: t.Object({
          text: t.String({ description: "1 to 1000 characters after trimming" }),
          replyToMessageId: t.Optional(
            t.String({ description: "The message this one answers, from the same conversation" }),
          ),
        }),
        response: { [HTTP_CREATED]: messageSchema },
        detail: { summary: "Send a text message (JSON)", tags: TAGS },
      },
    )
    .post(
      "/messages/:messageId/replies",
      async ({ session, params, body, status }) => {
        const message = await service.replyToMessage(session.userId, params.messageId, body.text);
        return status(HTTP_CREATED, message);
      },
      {
        params: messageIdParams,
        parse: JSON_ONLY,
        body: t.Object({ text: t.String({ description: "1 to 1000 characters after trimming" }) }),
        response: { [HTTP_CREATED]: messageSchema },
        detail: {
          summary: "Reply to a message (the receiver comes from that message)",
          tags: TAGS,
        },
      },
    )
    .get(
      "/messages",
      ({ session, query }) => {
        if (query.unread !== UNREAD_FILTER_VALUE) {
          throw new ApiError(
            HTTP_BAD_REQUEST,
            ERROR_CODES.invalidInput,
            "unread must be true.",
            "unread",
          );
        }
        return service.getUnreadMessages(session.userId, {
          before: query.before,
          limit: query.limit,
        });
      },
      {
        query: t.Object({
          unread: t.Optional(t.String({ description: "Must be true" })),
          before: t.Optional(t.String()),
          limit: limitQuery,
        }),
        response: { 200: unreadListSchema },
        detail: { summary: "Unread messages for the home page", tags: TAGS },
      },
    )
    .patch(
      "/conversations/:userId",
      ({ session, params }) => service.markConversationRead(session.userId, params.userId),
      {
        params: userIdParams,
        parse: JSON_ONLY,
        body: t.Object({ isRead: t.Literal(true) }),
        response: { 200: t.Object({ userId: t.String(), unreadCount: t.Integer() }) },
        detail: { summary: "Mark every message from this user as read", tags: TAGS },
      },
    );
}
