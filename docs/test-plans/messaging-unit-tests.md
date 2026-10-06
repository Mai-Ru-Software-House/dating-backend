# Messaging Service: unit test plan

Component: Messaging Service (`src/services/messaging/`). Owner: Vic. Written 6 October 2026 and updated the same day to follow the team functional test plan (`MaiRu_FunctionalTestPlan`, sheets 4 and 5).

How the tests run: `bun test test/messaging`. The service tests use in-memory repositories and a fixed clock that starts at `2026-10-06T10:00:00.000Z` and moves only when a test moves it. There is no database and no network. The route tests build the whole app with `createApp`, a fake token check and the same in-memory data.

Test users are the users of the functional test plan: alice (`usr_alice`), bob (`usr_bob`), chai (`usr_chai`), dan (`usr_dan`), fah (`usr_fah`, no messages) and hana (`usr_hana`, an outsider). The unknown user ID is `99999`. "1000 a" means the letter a repeated 1000 times.

Seeded messages are the ones on the Seed Data sheet, counted back from the clock: M1 chai to alice (1 day ago, read), M2, M3 and M4 bob to alice (60, 50 and 40 minutes ago, unread), M5 bob to chai (2 hours ago, read), M6 alice to hana (3 hours ago, read). Alice's favorite is chai. The "seeded data" below means this set.

Each Test Case below is the exact name of a test in `test/messaging/messagingService.test.ts` or `test/messaging/messagingRoutes.test.ts`. A name that starts with a case ID (CH05, MS09 and so on) covers that case of the functional test plan at unit level.

Rules that follow the functional test plan (6 October 2026):

- Messages are text only. There are no chat photos and no message delete.
- Send message takes JSON only: `text` and an optional `replyToMessageId`. A multipart body answers 400.
- Opening a conversation marks every message from the other user to me as read.
- `PATCH /conversations/{userId}` with `{ "isRead": true }` marks every message from that user to me as read.

## Functional test plan cases covered

| Case | What it checks | Unit tests |
| --- | --- | --- |
| CH01 | Chat list content | `CH01` in `getChatList` |
| CH02 | Favorites on top | `CH02` in `getChatList` |
| CH03 | Other chats by newest message | `CH03` in `getChatList` |
| CH04 | Empty chat list | `CH04` in `getChatList` |
| CH05 | Open a conversation | `CH05` in `getConversation` (2 tests) and in the route tests |
| CH06 | Load older messages | `CH06` in `getConversation` |
| CH07 | Mark as read without opening | `CH07` in `markConversationRead` and in the route tests |
| CH08 | Unknown user gives 404 | `CH08` in `getConversation` and in the route tests |
| CH09 | Cannot read other people's chats | `CH09` in `getConversation` (2 tests) and in the route tests |
| MS01 | Send a text message | `MS01` in `sendMessage` (2 tests) |
| MS02 | Thai text and emoji | `MS02` in `sendMessage` |
| MS04 | Two users send at the same time | `MS04` in `sendMessage` |
| MS05 | Empty message | `MS05` in `sendMessage`, `replyToMessage` and the route tests |
| MS06 | Message length limit | `MS06` in `sendMessage` and `replyToMessage` |
| MS09 | Reply to a message | `MS09` in `sendMessage`, `replyToMessage` and the route tests |
| SY04 | Time stamps in UTC ending in Z | `SY04` in `getChatList`, `getUnreadMessages` and the route tests |

Not covered here because they need the full stack: the app showing Bangkok time (SY04), the restart check (SY02) and the full journey (SY01).

## Objective 1: Send a message (`sendMessage`)

The text is trimmed and must be 1 to 1000 characters, counted as Unicode characters (code points). The receiver must exist and must not be the sender. The server sets the time in UTC. A message can name the message it answers with `replyToMessageId`.

| Test Case | Test Data | Expected Result |
| --- | --- | --- |
| MS01: stores a valid message and returns it with the server time in UTC | alice sends "Hi Bob, coffee this weekend?" to bob | Message with sender alice, receiver bob, `sentAt` `2026-10-06T10:00:00.000Z` (ends in Z), not read, `replyTo` null, and no photo or deleted fields |
| MS01: shows the new message to the receiver in the unread list with the time sent | alice sends "Hi Bob" to bob | Bob's unread list has that message with the sender alice, the text and the time sent |
| trims spaces around the text | Text "   Hi Bob \n " | Stored text is "Hi Bob" |
| MS06: accepts text of exactly 1000 characters | 1000 a | Accepted, text length 1000 |
| accepts 1000 characters after trimming spaces at both ends | 2 spaces, 1000 a, 2 spaces | Accepted, text length 1000 |
| MS06: rejects text of 1001 characters with 400 text | 1001 a | 400 `INVALID_INPUT`, field `text`; nothing is stored |
| counts an emoji as one character at the limit | 999 a plus one emoji, then the same plus a second emoji | First is accepted (1000 characters), second gives 400 field `text` |
| MS02: saves Thai text and an emoji exactly as typed, for both users | alice sends the Thai greeting "สวัสดีค่ะ" with a smiling emoji | The text is the same when alice and when bob open the conversation |
| MS06: counts Thai letters by Unicode characters, 1000 is accepted and 1001 is not | One Thai letter repeated 1000 times, then 1001 times | 1000 is accepted, 1001 gives 400 field `text` |
| counts a Thai vowel mark as its own character | A Thai letter with a vowel mark (2 characters) repeated 500 times, then 501 times | 500 times (1000 characters) is accepted, 501 times gives 400 field `text` |
| MS05: rejects empty text with 400 text | Text "" | 400 `INVALID_INPUT`, field `text` |
| MS05: rejects text with only spaces with 400 text and saves nothing | Spaces, a tab and a new line | 400 `INVALID_INPUT`, field `text`; alice has no chats |
| rejects a message to yourself with 400 userId | alice sends to alice | 400 `INVALID_INPUT`, field `userId` |
| rejects a message to an unknown user with 404 USER_NOT_FOUND | alice sends to `99999` | 404 `USER_NOT_FOUND` |
| calls the notifier once with the stored message | alice sends to bob | The notifier gets exactly one call, with the new message ID |
| MS04: keeps both messages, in one shared order, when two users send at the same time | alice and bob each send at the same moment | Both messages are stored with the same time; alice and bob see the same two messages in the same order |

### With `replyToMessageId`

The original must be a message between the sender and the receiver. A message the sender cannot see gives 404, so message IDs do not leak.

| Test Case | Test Data | Expected Result |
| --- | --- | --- |
| MS09: stores and returns which message it answers | Seeded data. alice sends "Yes, Saturday works" to bob with `replyToMessageId` M3 | Receiver bob; `replyTo` has M3, sender bob and the text "Are you free this weekend?" |
| keeps the link when the conversation is read again | Same reply, then alice opens the conversation | The newest message has `replyTo` M3 |
| accepts one of my own messages as the original | Seeded data. alice sends to hana with `replyToMessageId` M6 | `replyTo` has M6 and sender alice |
| rejects an original that does not exist with 404 MESSAGE_NOT_FOUND | `replyToMessageId` `msg_missing` | 404 `MESSAGE_NOT_FOUND` |
| rejects an original from a chat I am not in with 404 MESSAGE_NOT_FOUND | Seeded data. hana sends to bob with `replyToMessageId` M2 | 404 `MESSAGE_NOT_FOUND` |
| rejects an original from another conversation of mine with 400 replyToMessageId | Seeded data. alice sends to bob with `replyToMessageId` M1 (chai and alice) | 400 `INVALID_INPUT`, field `replyToMessageId` |
| saves nothing when the original is rejected | Same as the row above | The notifier is not called; the conversation with bob still has 3 messages |

## Objective 2: Reply to a message (`replyToMessage`)

The receiver comes from the original message, so the user does not type it. Only its sender or receiver can reply. Anyone else gets 404.

| Test Case | Test Data | Expected Result |
| --- | --- | --- |
| MS09: sends the reply to bob without typing his ID, and bob sees it as unread | Seeded data. alice replies "Yes, Saturday works" to M3 | Sender alice, receiver bob, not read, `replyTo` is M3 with sender bob; bob's unread count for alice is 1 |
| sends the reply to the sender when the receiver replies | alice sends to bob, bob replies | Reply sender bob, receiver alice |
| sends the reply to the receiver when the sender replies to their own message | alice sends to bob, alice replies | Reply sender alice, receiver bob |
| links the reply to the original message | bob replies "  Sure  " to "Coffee?" | Text "Sure", `replyTo` has the original ID, sender alice and text "Coffee?" |
| rejects a reply from a third person with 404 MESSAGE_NOT_FOUND | alice sends to bob, hana replies | 404 `MESSAGE_NOT_FOUND` |
| rejects a reply to a message that does not exist with 404 MESSAGE_NOT_FOUND | Reply to `msg_missing` | 404 `MESSAGE_NOT_FOUND` |
| MS05: rejects an empty reply with 400 text | Reply text of spaces | 400 `INVALID_INPUT`, field `text` |
| MS06: rejects a reply of 1001 characters with 400 text | 1001 a | 400 `INVALID_INPUT`, field `text` |

## Objective 3: Chat list (`getChatList`)

One row per person with at least one message in either direction. Favorites come first, then the newest last message first. A favorite with no messages is not shown.

| Test Case | Test Data | Expected Result |
| --- | --- | --- |
| CH01: shows one row per person with the last message, its time and the unread count | Seeded data. alice's chat list | Rows for chai, bob and hana. Bob: last message M4 "There is a jazz night at Siam on Saturday." at `2026-10-06T09:20:00.000Z`, unread 3. Chai: last message time `2026-10-05T10:00:00.000Z`, unread 0. Hana: "Hi Hana" at `2026-10-06T07:00:00.000Z`, unread 0 |
| CH02: puts a favorite first, even when another chat has a newer last message | Seeded data. alice's chat list | chai is first and `isFavorite` is true; the other rows are not favorites |
| CH03: sorts the other chats by newest last message, bob before hana | Seeded data. alice's chat list | After chai: bob (40 minutes ago), then hana (3 hours ago) |
| CH04: returns an empty list, not an error, for a user with no chats | Seeded data. fah's chat list | `{ conversations: [] }` |
| returns the last message in either direction | alice sends to bob, then bob sends to alice | One row for bob; the last message is bob's, unread 1 |
| orders rows with the same last message time by the larger message ID first | alice sends to bob and chai at the same time | chai first, then bob |
| counts only unread messages from the other user | bob sends 2 to alice, alice sends 1 to bob | alice's row for bob: unread 2. bob's row for alice: unread 1 |
| does not show a favorite with no messages | alice has bob and chai as favorites, but wrote only to chai | Only the row for chai |
| SY04: sends every last message time as UTC ISO 8601 ending in Z | Seeded data. alice's chat list | Every `lastMessage.sentAt` matches `YYYY-MM-DDTHH:MM:SS.mmmZ` |

## Objective 4: Conversation (`getConversation`)

Messages between the two users only, newest first, with `before`, `after` and `limit` (default 30, 1 to 100). A message is a cursor only if it belongs to this conversation. **Opening a conversation marks every unread message from that user to me as read.** This happens only after every check passed, and before the page is read.

| Test Case | Test Data | Expected Result |
| --- | --- | --- |
| returns only messages between the two users, newest first | alice and bob talk, alice also writes to chai | Only the messages with bob, newest first |
| CH05: shows the messages in time order and marks them as read | Seeded data. alice opens bob | M4, M3, M2 with sender bob, every one is read, every time ends in Z |
| CH05: sets bob's unread count to 0 in the chat list and on the home page | Seeded data. alice opens bob | Unread count for bob is 3 before and 0 after; alice's unread list is empty |
| marks every unread message from that user, not only the page that was asked for | Seeded data. alice opens bob with `limit` 1 | 1 message returned; bob's unread count is 0 |
| does not mark the messages I sent | alice sent to bob (seeded data), alice opens bob | Bob's unread count for alice's new message is still 1 |
| does not mark the messages of another conversation | chai sends a new message to alice, alice opens bob | Alice's unread count for chai is still 1 |
| marks nothing when the request is rejected | Seeded data. `limit` 0, a `before` cursor from another conversation, `before` and `after` together | 400 `INVALID_INPUT` with fields `limit`, `before`, `after`; bob's unread count is still 3 |
| CH08: answers 404 USER_NOT_FOUND for a user that does not exist | alice opens `99999` | 404 `USER_NOT_FOUND` |
| CH09: returns only messages between hana and bob, which is none | Seeded data. hana opens bob | `{ messages: [], hasMore: false }`; M2 to M5 never appear |
| CH09: leaves bob's messages to alice unread when hana opens the chat with bob | Seeded data. hana opens bob | Alice's unread count for bob is still 3; hana's chat list has only alice |
| CH06: loads the 60 message thread page by page, every message once | 60 messages between alice and dan, one minute apart. Pages of 25 with `before` | 3 pages (25, 25, 10), `hasMore` true, true, false; all 60 messages once, none missing, none repeated |
| uses a limit of 30 when none is sent | 31 messages | 30 messages and `hasMore` true |
| accepts limit 1 and limit 100 | 2 messages | Limit 1 gives 1 message and `hasMore` true; limit 100 gives 2 and false |
| rejects limit 0, 101 and 2.5 with 400 limit | Those three values | 400 `INVALID_INPUT`, field `limit` |
| pages back with before through every message with no gaps or duplicates | 7 messages, pairs with the same time, `limit` 3 | The pages together are the 7 messages, newest first, each once |
| polls with after and returns only newer messages with no gaps | 5 messages, `after` the 1st, 3rd and 5th, `limit` 2 | The messages just after the cursor, still newest first. `hasMore` true when even newer ones exist. Empty after the last message |
| rejects a before cursor from another conversation with 400 before | `before` is the ID of a message to chai | 400 `INVALID_INPUT`, field `before` |
| rejects an after cursor that does not exist with 400 after | `after` is `msg_missing` | 400 `INVALID_INPUT`, field `after` |
| rejects before and after together with 400 after | Both cursors | 400 `INVALID_INPUT`, field `after` |
| rejects a conversation with yourself with 400 userId | alice opens alice | 400 `INVALID_INPUT`, field `userId` |
| returns an empty list and hasMore false when there are no messages | alice opens bob with no messages | `{ messages: [], hasMore: false }` |
| fills replyTo with the original message | bob sends, alice replies | The reply has `replyTo` with the original ID, sender bob and text |

## Objective 5: Unread list for the home page (`getUnreadMessages`)

Messages sent to me that are not read, newest first, with the sender and the time sent. It does not mark anything as read.

| Test Case | Test Data | Expected Result |
| --- | --- | --- |
| returns the unread messages sent to me with the sender and time sent, newest first | Seeded data. alice's unread list | M4, M3, M2, each with sender bob, the text and the time sent (`09:20`, `09:10`, `09:00` UTC); `hasMore` false |
| returns an empty list for a user with no messages | Seeded data. fah's unread list | `{ messages: [], hasMore: false }` |
| leaves out read messages and messages I sent | bob sends one that alice reads, alice sends one, bob sends another | Only the last message from bob |
| pages back with before with no gaps or duplicates | 5 unread messages from 2 users, `limit` 3 | 2 pages, all 5 once, newest first |
| rejects a before cursor that was not sent to me with 400 before | `before` is a message alice sent | 400 `INVALID_INPUT`, field `before` |
| rejects limit 0 and 101 with 400 limit, accepts 1 and 100 | Those four values | 400 for 0 and 101; 1 message for 1 and 100 |
| uses a limit of 50 when none is sent | 51 unread messages | 50 messages and `hasMore` true |
| SY04: sends every time sent as UTC ISO 8601 ending in Z | Seeded data. alice's unread list | Every `sentAt` matches `YYYY-MM-DDTHH:MM:SS.mmmZ` |

## Objective 6: Mark a conversation as read (`markConversationRead`)

Every unread message from the other user to me becomes read. Messages I sent and messages of other conversations are not touched. It is safe to repeat.

| Test Case | Test Data | Expected Result |
| --- | --- | --- |
| CH07: marks every message from bob as read and sets his unread count to 0 | Seeded data. alice marks bob | `{ userId: bob, unreadCount: 0 }`; the chat list shows 0; the unread list is empty; the messages are read |
| marks a message that arrived after the user last looked | alice marks bob, bob sends a new message, alice marks again | Unread count 1 before, 0 after |
| does not mark the messages I sent | Seeded data. alice sent a message to bob, then marks bob | Bob's unread count for alice is still 1 |
| does not mark the messages of another conversation | chai sends a new message to alice, alice marks bob | Alice's unread count for chai is still 1 |
| is safe to repeat and keeps the first read time | alice marks bob twice, one minute apart | Same answer; the stored read time is the first one |
| answers with unread count 0 when there are no messages from that user | alice marks fah | `{ userId: fah, unreadCount: 0 }` |
| rejects an unknown user with 404 USER_NOT_FOUND | alice marks `99999` | 404 `USER_NOT_FOUND` |
| rejects yourself with 400 userId | alice marks alice | 400 `INVALID_INPUT`, field `userId` |

## Objective 7: HTTP routes (status codes and error shape)

Through the real app with a fake token check. Every error body has only the `error` key, with `code`, `message` and, for input errors, `field`. Every route needs a valid token. The send, reply and mark as read routes accept JSON only.

| Test Case | Test Data | Expected Result |
| --- | --- | --- |
| answers 401 UNAUTHENTICATED without a token | `GET /conversations`, no header | 401 `UNAUTHENTICATED` |
| answers 401 UNAUTHENTICATED with an unknown token | `GET /messages?unread=true`, token "nope" | 401 `UNAUTHENTICATED` |
| sends a JSON message and answers 201 with a message that has no photo or deleted fields | alice posts `{ "text": "  Hi Bob  " }` to bob | 201, text "Hi Bob", `replyTo` null, time ends in Z, and only the keys `messageId`, `senderId`, `receiverId`, `text`, `sentAt`, `isRead`, `replyTo` |
| MS09: answers 201 and returns which message it answers when replyToMessageId is sent | bob posts text and `replyToMessageId` of alice's message | 201, receiver alice, `replyTo` with the original ID, sender and text |
| answers 404 MESSAGE_NOT_FOUND when replyToMessageId does not exist | `replyToMessageId` `msg_missing` | 404 `MESSAGE_NOT_FOUND` |
| answers 400 with field replyToMessageId when it is not a string | `replyToMessageId` 5 | 400 `INVALID_INPUT`, field `replyToMessageId` |
| MS05: answers 400 with field text and only the error key for empty and space only text | `{ "text": "" }` and `{ "text": "   " }` | 400 `INVALID_INPUT`, field `text` |
| answers 400 with field text when text is missing or is not a string | `{}`, `{ "text": 5 }`, `{ "text": null }` | 400 `INVALID_INPUT`, field `text` |
| answers 400 for a multipart request, because only JSON is accepted, and saves nothing | A form with a text part, and a form with text and a png in `photos` | 400 `INVALID_INPUT` for both; bob's chat list is empty |
| answers 404 USER_NOT_FOUND when sending to an unknown user | alice posts to `99999` | 404 `USER_NOT_FOUND` |
| answers 201 for a JSON reply, with the receiver taken from the original message | bob posts `{ "text": "Sure" }` to the replies route of alice's message | 201, sender bob, receiver alice, `replyTo` with the original |
| answers 400 with field text when the reply has no text | Body `{}` | 400 `INVALID_INPUT`, field `text` |
| answers 400 for a multipart reply | A form with a text part | 400 `INVALID_INPUT` |
| is gone: DELETE /messages/{messageId} answers 404 NOT_FOUND and keeps the message | alice calls `DELETE /messages/{id}` for her own message | 404 `NOT_FOUND`; the message is still in bob's chat list |
| CH07: answers 200 for { isRead: true } and sets the unread count to 0 | alice sends 2 messages; bob patches `/conversations/{alice}` with `{ "isRead": true }` | Unread 2 before; 200 `{ userId: alice, unreadCount: 0 }`; chat list 0; unread list empty |
| answers 400 with field isRead for false, a string, a missing value and the old body | `{ "isRead": false }`, `{ "isRead": "true" }`, `{}`, `{ "lastReadMessageId": ... }` | 400 `INVALID_INPUT`, field `isRead` each time; the message stays unread |
| answers 400 for a multipart body | A form with `isRead` true | 400 `INVALID_INPUT` |
| answers 404 USER_NOT_FOUND for an unknown user and 400 userId for yourself | Patch `99999`, then patch yourself | 404 `USER_NOT_FOUND`; 400 `INVALID_INPUT`, field `userId` |
| CH05: opening a conversation marks the messages as read | alice sends "Hi Bob"; bob opens the conversation | 200 with the message read; bob's chat list shows 0 and his unread list is empty |
| CH08: answers 404 USER_NOT_FOUND in the standard shape for a user that does not exist | `GET /conversations/99999/messages` | 404, only the `error` key, code `USER_NOT_FOUND` |
| CH09: hana gets no messages from the chat of alice and bob and marks nothing as read | alice writes to bob; hana opens the conversation with bob | 200 `{ messages: [], hasMore: false }`; bob's unread count is still 1 |
| SY04: sends every time as UTC ISO 8601 ending in Z | Chat list, unread list and conversation | Every time matches `YYYY-MM-DDTHH:MM:SS.mmmZ` |
| answers 400 with field unread when unread is not true | `GET /messages` and `GET /messages?unread=false` | 400 `INVALID_INPUT`, field `unread` |
| answers 400 with field limit when limit is not a number | `?limit=abc` | 400 `INVALID_INPUT`, field `limit` |

## Not covered here

- The real repositories from the Data Access Layer (Chuan). The same tests can run against them once they exist.
- The real token check (Auth Service, Chuan). The route tests use a fake.
- The app showing times in Bangkok time, the restart check and the full journey (functional test plan cases SY01, SY02 and the app part of SY04).
