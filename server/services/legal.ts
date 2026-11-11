// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * Terms of Service acceptance (click-wrap) and the legal details configured for this installation.
 *
 * The owner accepts the terms when creating the account and again whenever TERMS_VERSION changes; each acceptance is
 * a row in terms_acceptances with the time, device and browser, so there is a record of who agreed to which version.
 */
import type { Config } from '../config.ts';
import type { Db } from '../db/database.ts';
import { HttpError } from '../http/http.ts';
import { COMPANY, TERMS_VERSION, type LegalInfo, type TermsStatus } from '../../shared/legal.ts';

export function legalInfo(config: Config): LegalInfo {
  return {
    company: COMPANY,
    legalName: config.legal.name,
    email: config.legal.email,
    address: config.legal.address,
    governingLaw: config.legal.governingLaw,
    termsVersion: TERMS_VERSION,
  };
}

export function termsStatus(db: Db, userId: number): TermsStatus {
  const row = db.get<{ terms_version: string; accepted_at: number }>(
    'SELECT terms_version, accepted_at FROM terms_acceptances WHERE user_id = ? ORDER BY accepted_at DESC, id DESC LIMIT 1',
    userId,
  );
  return {
    version: TERMS_VERSION,
    acceptedVersion: row?.terms_version ?? null,
    acceptedAt: row?.accepted_at ?? null,
    required: row?.terms_version !== TERMS_VERSION,
  };
}

/** Record that the account accepted `version`, which must be the version in force. Accepting it again is a no-op. */
export function acceptTerms(db: Db, userId: number, version: string, now: number, deviceId: string | null, userAgent: string | null): TermsStatus {
  if (version !== TERMS_VERSION) {
    throw new HttpError(409, 'terms_outdated', 'These terms have been updated. Reload the page to read and accept the current version.', { version: TERMS_VERSION });
  }
  if (termsStatus(db, userId).acceptedVersion !== TERMS_VERSION) {
    db.run(
      'INSERT INTO terms_acceptances (user_id, terms_version, accepted_at, device_id, user_agent) VALUES (?, ?, ?, ?, ?)',
      userId,
      TERMS_VERSION,
      now,
      deviceId,
      userAgent ? userAgent.slice(0, 300) : null,
    );
  }
  return termsStatus(db, userId);
}
