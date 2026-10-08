/*
 * Profile types: what the app sends to sign up and to edit a profile, and what the Profile API
 * sends back (`OwnProfile` and the candidate profile in docs/api-contract.md).
 */

/** A point on Earth as the app sends it, in degrees. */
export interface LocationInput {
  lat: number;
  lon: number;
}

/** What a user wants to see, as the app sends it and as the API answers. */
export interface Preferences {
  minAge: number;
  maxAge: number;
  /** Gender codes, for example `["male"]`. One or more. */
  targetGenders: string[];
  /** Whole km, 1 to 20000. */
  radiusKm: number;
}

/** The body of `POST /users`. The types are checked by the route, the rules by the service. */
export interface SignUpInput {
  username: string;
  password: string;
  displayName: string;
  /** `YYYY-MM-DD` */
  dateOfBirth: string;
  gender: string;
  location: LocationInput;
  /** The `uploadId` from `POST /photo-uploads`. */
  photoUploadId: string;
  preferences: Preferences;
}

/** The body of `PATCH /users/me`. Every field is optional; `preferences` is sent whole. */
export interface ProfileUpdateInput {
  displayName?: string;
  dateOfBirth?: string;
  gender?: string;
  location?: LocationInput;
  preferences?: Preferences;
  /** Cannot be changed: sending it is a 400. Kept here so the service can say so. */
  username?: unknown;
}

/** The logged in user's own profile (`OwnProfile`). Only its owner receives it. */
export interface OwnProfile {
  userId: string;
  username: string;
  displayName: string;
  /** `YYYY-MM-DD`. The age is never stored. */
  dateOfBirth: string;
  gender: string;
  location: LocationInput;
  /** "province, district", or null when the lookup failed or the point has no name. */
  placeName: string | null;
  /** Path of the profile photo, for example `/api/v1/photos/0194a1b2-...`. */
  photoUrl: string;
  preferences: Preferences;
}

/** The answer to sign up: the two tokens and the new profile. */
export interface SignUpResult {
  accessToken: string;
  refreshToken: string;
  profile: OwnProfile;
}

/**
 * Another user as `GET /users/{userId}` shows them: a `CandidateCard` with `matchScore`, plus
 * their own preferences and whether they are a favorite. Never a date of birth or a location.
 */
export interface PublicProfile {
  userId: string;
  username: string;
  displayName: string;
  photoUrl: string;
  age: number;
  gender: string;
  placeName: string | null;
  /** Whole km from the logged in user's saved location, at least 1. */
  distanceKm: number;
  /** 0 to 100. 0 when the two users do not fit each other both ways. */
  matchScore: number;
  lookingFor: Preferences;
  isFavorite: boolean;
}
