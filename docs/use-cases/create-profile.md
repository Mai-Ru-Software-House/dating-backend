# Use case: Create Profile (Must Have)

Source: "Functional design for your project" (revised 8 September 2026), which replaces the 25 August version. Includes: Upload Profile Photo.

## Fields

| Section            | Field                     | Notes                                                                                            |
| ------------------ | ------------------------- | ------------------------------------------------------------------------------------------------ |
| Account            | `username`                | Unique ID. Cannot be changed after creation                                                      |
| Account            | `password` + confirmation | Must meet minimum rules, both entries must match                                                 |
| Personal details   | `displayName`             | Shown in chat list and match results. Not unique                                                 |
| Personal details   | `dateOfBirth`             | Valid date, not in the future, age at least the minimum age. Age is never stored, always derived |
| Personal details   | `location`                | Must be "recognised". Now latitude/longitude from the phone (see `docs/decisions.md`)            |
| Personal details   | `gender`                  | Selected from a list                                                                             |
| Photo              | profile photo             | Required. Readable, supported format                                                             |
| Target preferences | `minAge`, `maxAge`        | Positive whole numbers, `minAge <= maxAge`, `minAge` at least the minimum age                    |
| Target preferences | `targetGender`            | One or more values (open question)                                                               |
| Target preferences | `radiusKm`                | Positive number                                                                                  |

These preference fields are the direct input to the Match Engine (`docs/match-engine.md`).

## Main flow

1. User picks Create Profile on the landing page.
2. User enters a username. System checks format and that it is not taken (Ext A, B).
3. User enters password twice. System checks rules and match (Ext C).
4. The form has three independent sections the user can fill in any order. Each is validated on its own as soon as it is complete:
   - Personal details (Ext E)
   - Profile photo: system checks the file is readable and supported, then stores a **temporary copy** (Ext D)
   - Target preferences (Ext F)
5. When all three sections are valid, the user can Submit or Cancel.
6. Submit: system creates the profile, attaches the temporary photo permanently, confirms, returns to the main menu.

Postconditions: profile is stored, the user can log in, the user is visible to Find Matches, and no temporary photo copy is left outside the profile.

## Extensions

- **A** Username taken: show "username taken", ask again.
- **B** Username empty, too short, too long or bad characters: show the username rules, ask again.
- **C** Password too weak or the two entries differ: say which problem happened, ask again.
- **D** Photo unreadable or unsupported format: list supported formats, store nothing, ask for another file.
- **E** Invalid personal detail (empty name, invalid or future DOB, under minimum age, location not recognised): name the invalid field, keep the entered values. Other sections are not affected.
- **F** Invalid preference (min > max, age not a positive whole number, min below minimum age, radius not positive): name the invalid field, keep the values. Other sections are not affected.
- **G** Cancel at the Submit/Cancel prompt: ask to confirm. Confirmed: discard everything, delete the temporary photo, create nothing. Not confirmed: back to the prompt with values kept.

## What this means for the backend

- The photo is uploaded **before** the account exists, so there must be an unauthenticated temporary upload that expires and gets cleaned up if the user never submits. **Changed again (Tee, Vic, Tae, 9 Oct):** the temporary upload is back, as the app does it: `POST /photo-uploads` first (kept one hour), then `POST /users` with the `photoUploadId` (see `docs/api-contract.md`). This replaces the one request sign up of 4 Oct.
- The app needs a way to check "username taken" before the final submit (Ext A), plus the same check again at submit time to avoid a race.
- Validation errors must name the field, so 400 responses should include which field failed (for example `error.field`).
- Ext A at submit time is `409 USERNAME_TAKEN`. Other validation problems are `400`.

## Still open (from the use case)

- Username rules (length, characters) and password rules (length, character types)
- Minimum permitted age
- Supported image formats, max file size, resize target
- Can `targetGender` have more than one value? (The Match Engine design already allows more than one.)
- Edit Profile is not a use case yet, but the work assignments give Profile Service "update profile"

Answered since: the rules are in `docs/api-contract.md` (A1 to A8), a user can have more than one target gender, and Edit Profile can change everything except the username and the photo (the photo has its own endpoint), with no password change in v1 (`docs/decisions.md`). The resize target is answered too: a photo that is not 1:1 is center-cropped to a square and stored as a JPEG of at most 1024 pixels per side (10 Oct, `docs/decisions.md`).