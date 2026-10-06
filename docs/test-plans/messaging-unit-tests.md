# Messaging Service: unit test plan

Component: Messaging Service (`src/services/messaging/`). Owner: Vic. Written 6 October 2026.

How the tests run: `bun test test/messaging`. The service tests use in-memory repositories and a fixed clock that starts at `2026-10-06T10:00:00.000Z` and moves only when a test moves it. There is no database and no network. The route tests build the whole app with `createApp`, a fake token check and the same in-memory data.

Test users: A (`usr_a`, Mai), B (`usr_b`, Ploy), C (`usr_c`, Arm) and an unknown ID (`usr_unknown`). "1000 a" means the letter a repeated 1000 times.

Each Test Case below is the exact name of a test in `test/messaging/messagingService.test.ts` or `test/messaging/messagingRoutes.test.ts`.

## Objective 1: Send a message (`sendMessage`)

The text is trimmed and must be 1 to 1000 characters (Unicode code points). The receiver must exist and must not be the sender. The server sets the time in UTC.

| Test Case | Test Data | Expected Result |
| --- | --- | --- |
| stores a valid message and returns it with the server time in UTC | A sends "Hi Ploy" to B | Message with sender A, receiver B, `sentAt` `2026-10-06T10:00:00.000Z`, not read, not deleted, `photoIds` empty, `replyTo` null |
| trims spaces around the text | Text "   Hi Ploy \n " | Stored text is "Hi Ploy" |
| accepts text of exactly 1000 characters | 1000 a | Accepted, text length 1000 |
| accepts 1000 characters after trimming spaces at both ends | 2 spaces, 1000 a, 2 spaces | Accepted, text length 1000 |
| rejects text of 1001 characters with 400 text | 1001 a | 400 `INVALID_INPUT`, field `text` |
| counts an emoji as one character at the limit | 999 a plus one emoji, then the same plus a second emoji | First is accepted (1000 characters), second gives 400 field `text` |
| rejects empty text with 400 text | Text "" | 400 `INVALID_INPUT`, field `text` |
| rejects text with only spaces with 400 text | Text of spaces, a tab and a new line | 400 `INVALID_INPUT`, field `text` |
| rejects a message with no text with 400 text | No text, no photos | 400 `INVALID_INPUT`, field `text` |
| rejects a photos part with 400 photos | Text "Look" plus a photos part | 400 `INVALID_INPUT`, field `photos`; nothing is stored |
| rejects a message to yourself with 400 userId | A sends to A | 400 `INVALID_INPUT`, field `userId` |
| rejects a message to an unknown user with 404 USER_NOT_FOUND | A sends to `usr_unknown` | 404 `USER_NOT_FOUND` |
| calls the notifier once with the stored message | A sends to B | The notifier gets exactly one call, with the new message ID |

## Objective 2: Reply to a message (`replyToMessage`)

The receiver comes from the original message. Only its sender or receiver can reply. Anyone else gets 404, so message IDs do not leak.

| Test Case | Test Data | Expected Result |
| --- | --- | --- |
| sends the reply to the sender when the receiver replies | A sends to B, B replies | Reply sender B, receiver A |
| sends the reply to the receiver when the sender replies to their own message | A sends to B, A replies | Reply sender A, receiver B |
| links the reply to the original message | B replies "  Sure  " to "Coffee?" | Text "Sure", `replyTo` has the original ID, sender A and text "Coffee?" |
| rejects a reply from a third person with 404 MESSAGE_NOT_FOUND | A sends to B, C replies | 404 `MESSAGE_NOT_FOUND` |
| rejects a reply to a message that does not exist with 404 MESSAGE_NOT_FOUND | A replies to `msg_missing` | 404 `MESSAGE_NOT_FOUND` |
| rejects an empty reply with 400 text | Reply text of spaces only | 400 `INVALID_INPUT`, field `text` |
| rejects a reply of 1001 characters with 400 text | Reply of 1001 a | 400 `INVALID_INPUT`, field `text` |

## Objective 3: Chat list (`getChatList`)

One row per other user, with the last message, its time and the unread count. Favorites first, then the newest last message first.

| Test Case | Test Data | Expected Result |
| --- | --- | --- |
| returns an empty list for a user with no messages | No messages | `{ conversations: [] }` |
| returns one row per other user with the last message in either direction | A sends "first", one minute later B sends "second" | One row for B, last message "second" from B, unread count 1 |
| puts favorites first, then the newest last message first | C is A's favorite. A sends to C, one minute later to B | Order C, B; `isFavorite` true, false |
| orders rows with the same last message time by the larger message ID first | A sends to B, then to C, at the same time | Order C, B |
| counts only unread messages from the other user | B sends 2 to A, A sends 1 to B | A sees unread count 2, B sees 1 |
| shows a deleted last message with isDeleted true and no text | A sends "oops", then deletes it | B's row: `isDeleted` true, text null, unread count 0 |
| does not show a favorite with no messages | B and C are favorites, A only wrote to C | Only C is listed |

## Objective 4: Conversation (`getConversation`)

Messages between me and one user only, newest first. `limit` is 1 to 100 (default 30). `before` pages back, `after` polls for newer messages, and they cannot be sent together.

| Test Case | Test Data | Expected Result |
| --- | --- | --- |
| returns only messages between the two users, newest first | A and B write 2 messages, A also writes to C | Only the 2 messages with B, newest first, `hasMore` false |
| uses a limit of 30 when none is sent | 31 messages, no limit | 30 messages, `hasMore` true |
| accepts limit 1 and limit 100 | 2 messages, limit 1 and limit 100 | 1 message with `hasMore` true; 2 messages with `hasMore` false |
| rejects limit 0, 101 and 2.5 with 400 limit | limit 0, 101, 2.5 | 400 `INVALID_INPUT`, field `limit` each time |
| pages back with before through every message with no gaps or duplicates | 7 messages, pairs share the same time, limit 3, follow `before` until `hasMore` is false | All 7 IDs seen exactly once, in newest first order |
| polls with after and returns only newer messages with no gaps | 5 messages one minute apart, limit 2, `after` the 1st, 3rd and 5th | Messages 3 and 2 with `hasMore` true; then 5 and 4 with `hasMore` false; then an empty list |
| rejects a before cursor from another conversation with 400 before | `before` is a message between A and C | 400 `INVALID_INPUT`, field `before` |
| rejects an after cursor that does not exist with 400 after | `after` is `msg_missing` | 400 `INVALID_INPUT`, field `after` |
| rejects before and after together with 400 after | Both cursors sent | 400 `INVALID_INPUT`, field `after` |
| rejects a conversation with yourself with 400 userId | A opens A | 400 `INVALID_INPUT`, field `userId` |
| rejects an unknown user with 404 USER_NOT_FOUND | A opens `usr_unknown` | 404 `USER_NOT_FOUND` |
| returns an empty list and hasMore false when there are no messages | A opens B, no messages | `{ messages: [], hasMore: false }` |
| does not mark messages as read | B sends to A, A opens the conversation | Unread count stays 1 |
| fills replyTo with the original message | A replies "Sure" to B's "Coffee?" | The reply's `replyTo` has B's message ID, sender B, text "Coffee?" |

## Objective 5: Unread list for the home page (`getUnreadMessages`)

Unread messages sent to me, with the sender and the time sent, newest first. `limit` is 1 to 100 (default 50).

| Test Case | Test Data | Expected Result |
| --- | --- | --- |
| returns unread messages sent to me with the sender and time sent, newest first | B sends to A, one minute later C sends to A | C's message then B's, each with the sender summary and `sentAt` |
| leaves out read messages and messages I sent | One read message from B, one sent by A, one unread from B | Only the unread message from B |
| leaves out deleted messages | B sends to A, then deletes it | Empty list |
| pages back with before with no gaps or duplicates | 5 unread messages from B and C, limit 3, then `before` the last one | 3 then 2 messages, all 5 exactly once, newest first |
| rejects a before cursor that was not sent to me with 400 before | `before` is a message A sent | 400 `INVALID_INPUT`, field `before` |
| rejects limit 0 and 101 with 400 limit, accepts 1 and 100 | limit 0, 101, 1, 100 | 400 field `limit` for 0 and 101; 1 and 100 are accepted |
| uses a limit of 50 when none is sent | 51 unread messages, no limit | 50 messages, `hasMore` true |

## Objective 6: Mark a conversation as read (`markConversationRead`)

Every message from the other user to me, at or before `lastReadMessageId`, becomes read. Later messages stay unread. Safe to repeat.

| Test Case | Test Data | Expected Result |
| --- | --- | --- |
| sets the unread count to zero and marks the messages as read | B sends 2 to A, A marks up to the last | `{ userId: B, unreadCount: 0 }`, chat list count 0, every message `isRead` true |
| keeps a message that arrives later unread | A marks up to message 1, message 2 is newer | Unread count 1 |
| marks only messages up to the given message, including one with the same time | 2 messages at the same time, A marks up to the first | Unread count 1; the second is still in the unread list |
| changes nothing when an older message ID is sent | Mark up to the newer message, then send the older ID | Unread count stays 0, nothing becomes unread |
| is safe to repeat | Mark the same message twice | Both answers are the same |
| accepts the ID of a message I sent | B sends to A, A answers, A marks up to A's own message | Unread count 0 |
| rejects a message from another conversation with 400 lastReadMessageId | ID of a message from C | 400 `INVALID_INPUT`, field `lastReadMessageId` |
| rejects an unknown user with 404 USER_NOT_FOUND | Other user `usr_unknown` | 404 `USER_NOT_FOUND` |
| rejects yourself with 400 userId | A marks a conversation with A | 400 `INVALID_INPUT`, field `userId` |

## Objective 7: Delete a message (`deleteMessage`)

Only the sender can delete. The row stays, marked deleted, and its text is hidden everywhere (provisional rule, see `docs/decisions.md`).

| Test Case | Test Data | Expected Result |
| --- | --- | --- |
| lets the sender delete a message and hides its text everywhere | A sends "secret", B replies, A deletes | The message has `isDeleted` true, text null, `photoIds` empty; the reply's `replyTo.text` is null |
| rejects a delete by the receiver with 403 NOT_MESSAGE_SENDER | B deletes A's message | 403 `NOT_MESSAGE_SENDER` |
| rejects a delete by a third person with 404 MESSAGE_NOT_FOUND | C deletes A's message to B | 404 `MESSAGE_NOT_FOUND` |
| rejects a message that does not exist with 404 MESSAGE_NOT_FOUND | Delete `msg_missing` | 404 `MESSAGE_NOT_FOUND` |
| succeeds again on a second delete and keeps the first delete time | A deletes twice, one minute apart | No error; the stored delete time is the first one |
| removes a deleted unread message from the unread count | B sends 2 to A, deletes 1 | A's unread count is 1 |

## Objective 8: HTTP routes (status codes and error shape)

Every route needs a valid token. Every error body has only the `error` key, with `code`, `message` and, for input errors, `field`.

| Test Case | Test Data | Expected Result |
| --- | --- | --- |
| answers 401 UNAUTHENTICATED without a token | `GET /conversations`, no header | 401 `UNAUTHENTICATED` |
| answers 401 UNAUTHENTICATED with an unknown token | `GET /messages?unread=true`, token "nope" | 401 `UNAUTHENTICATED` |
| sends a multipart message and answers 201 with the message | A posts form part text "  Hi Ploy  " to B | 201, text "Hi Ploy", `replyTo` null |
| answers 400 with field text and only the error key for an empty message | Form part text of spaces | 400 `INVALID_INPUT`, field `text`, body keys only `error` |
| answers 400 with field photos when a photos part is sent | Form with text and one png in `photos` | 400 `INVALID_INPUT`, field `photos` |
| answers 404 USER_NOT_FOUND when sending to an unknown user | Post to `usr_unknown` | 404 `USER_NOT_FOUND` |
| answers 201 for a JSON reply | B posts JSON `{ "text": "Sure" }` to A's message | 201, sender B, receiver A |
| answers 400 with field text when the reply has no text | JSON `{}` | 400 `INVALID_INPUT`, field `text` |
| answers 403 NOT_MESSAGE_SENDER when the receiver deletes | B deletes A's message | 403 `NOT_MESSAGE_SENDER` |
| answers 204 with no body when the sender deletes | A deletes A's message | 204, empty body |
| answers 400 with field unread when unread is not true | `GET /messages` and `GET /messages?unread=false` | 400 `INVALID_INPUT`, field `unread` |
| answers 400 with field limit when limit is not a number | `?limit=abc` | 400 `INVALID_INPUT`, field `limit` |
| returns the chat list and marks a conversation as read | A sends to B; B gets the chat list, then marks it read | 200 with unread count 1; then 200 `{ userId: A, unreadCount: 0 }` |

## Not covered here

- Chat photos (the `photos` part is rejected until the photo module from Tae exists).
- The real repositories from the Data Access Layer (Chuan). The same tests can run against them once they exist.
- The real token check (Auth Service, Chuan). The route tests use a fake.
