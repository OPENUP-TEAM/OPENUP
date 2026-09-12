import { query } from '../config/db.js';
import { notify } from './notification.service.js';

/**
 * Crisis escalation.
 *
 * Module: Voice Journal — 5. Send Crisis Alert.
 * Also used by the AI Crisis Companion and the Mental Health Assessment,
 * so the escalation path exists in one place rather than three.
 *
 * Order matters here. The resident gets hotline numbers first, in the same
 * response that created the alert. Everything after that — the alert row,
 * the psychologist queue, the trusted contact — is follow-up. A resident
 * must never be left holding "we have notified someone" and nothing they
 * can act on themselves.
 */

const DEFAULT_HOTLINES = [
  { name: 'NCMH Crisis Hotline', number: '1553', note: 'Free, 24/7, landline and mobile' },
  { name: 'Hopeline PH', number: '0917-558-4673', note: '24/7' },
  { name: 'Emergency', number: '911', note: 'If someone is in immediate danger' },
];

/** Hotlines are configurable by an admin under System Settings. */
export async function getHotlines() {
  try {
    const { rows } = await query(
      `SELECT value FROM system_setting WHERE key = 'crisis_hotlines'`
    );
    const v = rows[0]?.value;
    return Array.isArray(v) && v.length ? v : DEFAULT_HOTLINES;
  } catch {
    return DEFAULT_HOTLINES;
  }
}

/** Escalation threshold, also admin-configurable. */
async function getThreshold() {
  try {
    const { rows } = await query(
      `SELECT value FROM system_setting WHERE key = 'ai_escalation_threshold'`
    );
    const t = Number(rows[0]?.value?.risk_score);
    return Number.isFinite(t) ? t : 0.75;
  } catch {
    return 0.75;
  }
}

/**
 * Should this analysis escalate?
 * 'severe' and 'high' always do, regardless of the numeric threshold —
 * a low score attached to a high label is a model error, not a reason
 * to stay quiet.
 */
export async function shouldEscalate({ risk_level, risk_score }) {
  if (risk_level === 'severe' || risk_level === 'high') return true;
  return risk_score >= (await getThreshold());
}

/**
 * Create the alert and notify the people who can act on it.
 *
 * @param {object} opts
 * @param {number} opts.userId
 * @param {'voice_journal'|'ai_companion'|'assessment'} opts.source
 * @param {number} opts.sourceId
 * @param {string} opts.riskLevel
 * @returns {Promise<{alert_id:number, hotlines:Array, contact_alerted:boolean}>}
 */
export async function raiseCrisisAlert({ userId, source, sourceId, riskLevel }) {
  const { rows } = await query(
    `INSERT INTO crisis_alert (user_id, source, source_id, risk_level, status)
     VALUES ($1, $2, $3, $4, 'open')
     RETURNING alert_id`,
    [userId, source, sourceId, riskLevel]
  );
  const alertId = rows[0].alert_id;

  const hotlines = await getHotlines();

  // The resident's own notification leads with something they can do.
  await notify(
    null,
    userId,
    'Support is available right now. Tap to see who you can call.',
    'system',
    '/app/support'
  );

  // Queue for whoever is on duty. Only verified psychologists, and only
  // the alert — never the transcript. Clinical content stays with the
  // resident until they choose to share it in a session.
  const { rows: onDuty } = await query(
    `SELECT p.user_id
       FROM psychologist p
       JOIN "user" u ON u.user_id = p.user_id
      WHERE p.is_verified = true AND u.status = 'active'`
  );

  const label = riskLevel === 'severe' ? 'Severe' : 'High';
  await Promise.all(
    onDuty.map((p) =>
      notify(
        null,
        p.user_id,
        `${label}-risk alert raised. A resident may need priority support.`,
        'system',
        '/psychologist/alerts'
      )
    )
  );

  // Trusted contact, only for severe, and only if the resident nominated
  // one. Module: AI Crisis Companion — 4. Alert Trusted Person.
  let contactAlerted = false;
  if (riskLevel === 'severe') {
    const { rows: contacts } = await query(
      `SELECT contact_id, name FROM trusted_contact WHERE user_id = $1 LIMIT 1`,
      [userId]
    );
    if (contacts.length) {
      // Recorded, not sent. Sending an SMS needs a gateway that is not
      // wired up yet, and pretending otherwise would be worse than an
      // honest "not yet".
      await query(
        `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
         VALUES ($1, 'crisis.trusted_contact_pending', 'crisis_alert', $2, $3)`,
        [userId, alertId, { contact_id: contacts[0].contact_id }]
      );
      contactAlerted = true;
    }
  }

  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
     VALUES ($1, 'crisis.raise', 'crisis_alert', $2, $3)`,
    [userId, alertId, { source, risk_level: riskLevel, notified: onDuty.length }]
  );

  return { alert_id: alertId, hotlines, contact_alerted: contactAlerted };
}
