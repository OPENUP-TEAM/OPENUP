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
export const JOURNAL_BUCKET = 'journals';
export const RESOURCE_BUCKET = 'resources';

/**
 * Supabase JS reports every connection problem as "fetch failed", which
 * hides whether the cause was a missing bucket, a bad key, or no network.
 * This unwraps it into something a developer can act on.
 */
function describeUploadFailure(err, bucket) {
  const cause = err?.cause;
  const code = cause?.code ?? '';

  if (/Bucket not found/i.test(err?.message ?? ''))
    return `The "${bucket}" bucket does not exist. Create it in Supabase under Storage, with Public off.`;

  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code))
    return 'Could not resolve the Supabase address. Check SUPABASE_URL and your connection.';

  if (['ECONNREFUSED', 'ECONNRESET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'].includes(code))
    return 'Could not reach Supabase Storage. Check your connection, or whether the project is paused.';

  if (/fetch failed/i.test(err?.message ?? ''))
    return `Could not reach the "${bucket}" bucket. Run "npm run check:storage" to find out why.`;

  return err?.message ?? 'Unknown storage error.';
}



/** Upload a buffer and return the storage path (not a public URL). */
export async function uploadLicense(psychologistId, file) {
  const ext = (file.originalname.split('.').pop() || 'bin').toLowerCase();
  const path = `psychologist-${psychologistId}/license-${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from(LICENSE_BUCKET)
    .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });

  if (error) throw new Error(describeUploadFailure(error, LICENSE_BUCKET));
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

/**
 * Voice journal audio. Private bucket: these recordings are a resident
 * talking about their mental health, so nothing is ever publicly reachable
 * and every read goes through a short-lived signed URL.
 */
export async function uploadJournalAudio(userId, file) {
  const ext = (file.mimetype.split('/')[1] || 'webm').split(';')[0];
  const path = `user-${userId}/${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from(JOURNAL_BUCKET)
    .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });

  if (error) throw new Error(describeUploadFailure(error, JOURNAL_BUCKET));
  return path;
}

export async function signJournalUrl(path, expiresInSeconds = 300) {
  const { data, error } = await supabase.storage
    .from(JOURNAL_BUCKET)
    .createSignedUrl(path, expiresInSeconds);

  if (error) throw new Error(`Could not sign URL: ${error.message}`);
  return data.signedUrl;
}

export async function deleteJournalAudio(path) {
  await supabase.storage.from(JOURNAL_BUCKET).remove([path]);
}

/**
 * Wellness resource attachments.
 *
 * Kept private like the others even though the content is educational.
 * A public bucket URL is guessable and permanent, and a resident who
 * downloads a worksheet about panic attacks should not be handing anyone
 * a link that says so.
 */
export async function uploadResource(file) {
  const safe = (file.originalname || 'file')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .slice(-60);
  const path = `${Date.now()}-${safe}`;

  const { error } = await supabase.storage
    .from(RESOURCE_BUCKET)
    .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });

  if (error) throw new Error(describeUploadFailure(error, RESOURCE_BUCKET));
  return path;
}

export async function signResourceUrl(path, expiresInSeconds = 600) {
  const { data, error } = await supabase.storage
    .from(RESOURCE_BUCKET)
    .createSignedUrl(path, expiresInSeconds);

  if (error) throw new Error(`Could not sign URL: ${error.message}`);
  return data.signedUrl;
}

export async function deleteResource(path) {
  await supabase.storage.from(RESOURCE_BUCKET).remove([path]);
}
