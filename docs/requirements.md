# Requirements

Problem: it is hard to find a compatible person for a relationship.

## Features

| Priority     | Feature                                   | Main backend owner                           |
| ------------ | ----------------------------------------- | -------------------------------------------- |
| Must Have    | Create Profile                            | Chuan (Profile), Tae (Photo), Vic (Location) |
| Must Have    | Login / Switch User                       | Chuan (Auth)                                 |
| Must Have    | Find Matches (recommendations and search) | Vic & Tae (Match Service, Match Engine)      |
| Must Have    | View Chat List (favorites first)          | Vic (Messaging)                              |
| Must Have    | View Conversation                         | Vic (Messaging)                              |
| Must Have    | Send Message                              | Vic (Messaging)                              |
| Must Have    | Reply to Message                          | Vic (Messaging)                              |
| Nice to Have | Add Favorite                              | Vic (Favorites & Notes)                      |
| Nice to Have | Record Small Notes                        | Vic (Favorites & Notes)                      |
| Nice to Have | View Notes                                | Vic (Favorites & Notes)                      |

## Details from the course brief

- **Create profile**: unique username, personal details and personal preferences, a variety of characteristics.
- **Login / switch user**: after login, show any unread messages with the sender and the time sent.
- **Find matches**: use the profile preferences plus optional extra criteria to find potential matches, with a "match score" algorithm (see `docs/match-engine.md`).
- **Send message**: send a short text message to another user by username. The receiver sees it the next time they log in. Messages have timestamps.
- **Reply to message**: like sending, but the receiver comes from the message being replied to.
- **Record notes**: free form private comments about another user (for example dates or contacts outside the app). Notes have timestamps.
- **View notes**: see the notes you wrote about another user.

Team revisions (25 August 2026): login uses username and password; Find Matches has two paths (select from recommended matches, or search by specification); Reply to Message replies to one specific message; Add Favorite pins a user to the top of the chat list.

## Screen flow (functional map, 8 September 2026)

```
Landing Page -> Create Profile -> Login / Switch User
Landing Page -> Login / Switch User <-> Main Menu (home, unread messages)
Main Menu -> Find Matches -> Select from recommended matches -> View candidate profile
                          -> Search by specification         -> View candidate profile
             View candidate profile -> Send message | Add favorite*
Main Menu -> View Chat List (favorites on top) -> View conversation -> Send message | Reply to message | Record small note*
                                               -> Add favorite* | View notes*
(* = Nice to Have)
```

## Use case narratives

- `docs/use-cases/create-profile.md` (written, revised 8 September 2026)

<!-- Add one short file per use case in docs/use-cases/ when it is written. Keep the main steps and extensions, drop the course formatting. -->
