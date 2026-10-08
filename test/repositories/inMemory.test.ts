/*
 * The repository behaviour tests, run against the in-memory repositories (the reference
 * versions). The same tests run against PostgreSQL in test/integration/prismaRepositories.test.ts.
 */
import {
  createInMemoryFavoritesRepository,
  createInMemoryNotesRepository,
} from "../../src/services/favoritesNotes/inMemoryFavoritesNotesRepository";
import {
  createInMemoryMessageRepository,
  createInMemoryUserReader,
} from "../../src/services/messaging/inMemoryMessageRepository";
import { createInMemoryProfilePhotoRepository } from "../../src/services/photo/inMemoryProfilePhotoRepository";
import { createInMemoryProfileRepository } from "../../src/services/profile/inMemoryProfileRepository";
import {
  describeFavoritesRepository,
  describeMessageRepository,
  describeNotesRepository,
  describeProfilePhotoRepository,
  describeProfileRepository,
  describeUserReader,
  type People,
} from "./contracts";

const PEOPLE: People = { alice: "usr_alice", bob: "usr_bob", chai: "usr_chai" };

describeMessageRepository(async () => ({
  ...PEOPLE,
  repository: createInMemoryMessageRepository(),
}));

describeFavoritesRepository(async () => ({
  ...PEOPLE,
  repository: createInMemoryFavoritesRepository(),
}));

describeNotesRepository(async () => ({ ...PEOPLE, repository: createInMemoryNotesRepository() }));

describeUserReader(async () => {
  const expected: Record<string, { displayName: string; photoUrl: string }> = Object.fromEntries(
    Object.values(PEOPLE).map((userId) => {
      const name = userId.replace("usr_", "");
      return [userId, { displayName: name, photoUrl: `/api/v1/photos/pho_${name}` }];
    }),
  );
  const reader = createInMemoryUserReader(
    Object.entries(expected).map(([userId, summary]) => ({ userId, ...summary })),
  );
  return { ...PEOPLE, reader, expected };
});

describeProfileRepository(async () => ({ repository: createInMemoryProfileRepository() }));

describeProfilePhotoRepository(async () => {
  const alice = { userId: PEOPLE.alice, photoKey: `profile-photos/${Bun.randomUUIDv7()}.jpg` };
  const bob = { userId: PEOPLE.bob, photoKey: `profile-photos/${Bun.randomUUIDv7()}.webp` };
  return { repository: createInMemoryProfilePhotoRepository([alice, bob]), alice, bob };
});
