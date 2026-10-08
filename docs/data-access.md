# Data access: what the services need from the database layer

For Chuan (Data Access Layer and database). The services never write SQL and never import the Prisma client. Each service declares an **interface** for what it needs, and the Prisma implementation lives in `src/data/` on top of `prisma/schema.prisma`. Vic wrote the implementations below as a **proposal** so the app works on PostgreSQL today; Chuan reviews them and keeps, changes or moves them into the Data Access Layer. Checked on 9 October 2026 against the schema of PR #3.

## Written (proposals, to review)

| Interface | Prisma version | What it does |
| --------- | -------------- | ------------ |
| `AuthRepository` (`src/services/auth/authRepository.ts`) | `src/data/prismaAuthRepository.ts` | Reads the password hash from `user_auth_methods`, keeps hashed refresh tokens in `refresh_tokens`. Rotation is one transaction, with a conditional update as the lock, so two requests with the same token cannot both succeed |
| `MatchProfileReader` (`src/services/match/matchTypes.ts`) | `src/data/prismaMatchProfileReader.ts` | Reads users, target preferences and target genders for the Match Service |
| `MessageRepository` (`src/services/messaging/messageRepository.ts`) | `src/data/prismaMessageRepository.ts` | Insert, find, the conversation page (`before` and `after`), the unread list, one summary per chat partner, mark as read |
| `UserReader` (same file) | `createPrismaUserReader` in `src/data/prismaMessageRepository.ts` | `{ userId, displayName, photoUrl }` for each user that exists |
| `FavoritesRepository` (`src/services/favoritesNotes/favoritesNotesRepository.ts`) | `createPrismaFavoritesRepository` in `src/data/prismaFavoritesNotesRepository.ts` | Add (keeps the first `createdAt`), remove, list newest first. It also gives the favorite IDs for the chat list order |
| `NotesRepository` (same file) | `createPrismaNotesRepository` in the same file | Insert, a user's notes about one person newest first, the people list with the count and the newest note |

`createApp` uses these by default, so a running backend reads and writes PostgreSQL. The in-memory versions stay as the reference and for unit tests.

How they were checked: one set of behaviour tests (`test/repositories/contracts.ts`) runs against **both** the in-memory and the Prisma versions, so they must behave the same: 26 behaviour tests, run once on each version (the Prisma runs use a real PostgreSQL 18), plus the seed users through the real routes (the unread list of alice shows bob's three messages, the chat list puts chai first as a favorite, the seeded note about chai is returned).

## Rules every repository follows

- An ID that is not a UUID is "not found" (the app sends IDs like `99999` in the test plan), never a `500`. `src/data/ids.ts` has the check.
- Use the Prisma query API or tagged `$queryRaw` templates. Never build SQL by joining strings.
- Several writes that must succeed together go in one `prisma.$transaction`.
- Times are `Date` objects in UTC. The service turns them into ISO 8601 strings.
- Messages sort by `sent_at`, then `id` (UUID version 7, so the `id` grows with time), newest first.
- Never return password hashes, token hashes or another user's private data (notes and favorites belong to their owner).
- The table column `messages.body` is the API's `text`, and `notes.body` is the note `text`.

## Notes for the schema (Chuan)

- The two indexes on `messages` do not cover the query for one conversation in both directions ordered by `sent_at`. It runs on the `(sender_id, receiver_id, sent_at)` index for each direction. If it gets slow, add an index on `(receiver_id, sender_id, sent_at)` or store a sorted pair of user IDs.
- The summary query uses `DISTINCT ON` over the chat partner; it reads all messages of one user. Fine for the project, worth an index on `(receiver_id, sent_at)` later.
- `notes.body` allows 2000 characters, the service limits it to 500.

## Still to write

### Profile (Chuan)

Sign up writes `users` (with the `photo_key` of the claimed photo upload), `user_auth_methods` and `user_target_genders` in one transaction. A unique violation on `username` (Prisma code `P2002`) must become `409 USERNAME_TAKEN`. The username is stored in lowercase. `GET /users/{userId}`, `GET` and `PATCH /users/me` read and update the same rows.

### Photos (Tae with Chuan)

The photo functions need: read `users.photo_key` by photo ID, and replace the photo of a user in one transaction (set the new `photo_key`, then delete the old object only after the commit). This needs a unique index on `users.photo_key` and the key format `profile-photos/<photoId>.<extension>`. The temporary uploads of the sign up flow (`POST /photo-uploads`) need no table in the proposal: the object `uploads/<uploadId>.<extension>` lives in RustFS, and the delete token is an HMAC of the upload ID. If you prefer a table, it needs `uploadId`, `objectKey`, `deleteTokenHash`, `expiresAt` and a used flag; tell Tae.

## Test harness

`test/integration/database.ts` connects to `TEST_DATABASE_URL`, `createTestUser` builds a user with a password method and one target gender, and `resetDatabase` empties the user tables (the `genders` rows stay). Apply the migrations to that database first (`bun run db:deploy` with `DATABASE_URL` set to the same URL). Bun 1.4.2 on Windows crashes when `bun test` talks to PostgreSQL, so run the database tests on Linux or WSL.
