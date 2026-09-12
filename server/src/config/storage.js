import { createClient } from '@supabase/supabase-js';

/**
 * Supabase Storage client, used for PRC license documents and (later)
 * voice journal audio.
 *
 * Uses the service role key, so it bypasses RLS and bucket policies.
 * This key must never reach the browser — every upload and download goes
 * through the Express API, which checks authorisation first.
 */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export const LICENSE_BUCKET = 'licenses';

/** Upload a buffer and return the storage path (not a public URL). */
export async function uploadLicense(psychologistId, file) {
  const ext = (file.originalname.split('.').pop() || 'bin').toLowerCase();
  const path = `psychologist-${psychologistId}/license-${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from(LICENSE_BUCKET)
    .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });

  if (error) throw new Error(`Upload failed: ${error.message}`);
  return path;
}

/**
 * Short-lived signed URL so an admin can view a license document.
 * The bucket is private; without a signed URL the object is unreachable.
 */
export async function signLicenseUrl(path, expiresInSeconds = 300) {
  const { data, error } = await supabase.storage
    .from(LICENSE_BUCKET)
    .createSignedUrl(path, expiresInSeconds);

  if (error) throw new Error(`Could not sign URL: ${error.message}`);
  return data.signedUrl;
}

export async function deleteLicense(path) {
  await supabase.storage.from(LICENSE_BUCKET).remove([path]);
}