/** Profile photos are normalized raster images, never arbitrary remote URLs. */
export const PROFILE_STORAGE_KEY = 'lope.profile.v1';
export const PROFILE_PICTURE_KEY = 'accountProfilePicture';
export const MAX_PROFILE_PICTURE_LENGTH = 256 * 1024;
export function isProfilePicture(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_PROFILE_PICTURE_LENGTH
    && /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(value);
}
export function isProfileData(value: unknown): value is { accountProfilePicture?: string | null } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const profile = value as Record<string, unknown>;
  return Object.keys(profile).every(key => key === PROFILE_PICTURE_KEY)
    && (profile.accountProfilePicture === undefined || profile.accountProfilePicture === null || isProfilePicture(profile.accountProfilePicture));
}
