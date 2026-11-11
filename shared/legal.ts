// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * Lango's legal texts, shared by the server (which records acceptance) and the web app (which shows them).
 *
 * Changing the Terms of Service: edit web/src/pages/TermsPage.tsx, then set TERMS_VERSION to the new date. Every
 * account is asked to accept the new version on its next visit, and the acceptance is recorded (terms_acceptances).
 */
export const COMPANY = 'Lango';
export const PRODUCT = 'VocabBuilder';
export const COPYRIGHT_YEAR = '2026';
export const COPYRIGHT = `© ${COPYRIGHT_YEAR} Lango. All rights reserved.`;

/** The version of the Terms of Service in force: the date it was last changed (ISO), with a letter for a second change that day. */
export const TERMS_VERSION = '2026-11-08b';
export const TERMS_UPDATED = '8 November 2026';

/**
 * Lango's legal details (given by the owner on 2026-11-08), shown in the Terms of Service. VB_LEGAL_* in .env override
 * them. The governing law is used as written after "the laws of".
 */
export const LEGAL_DEFAULTS = {
  name: 'Lango LLC',
  email: 'contact@lango.com',
  address: null as string | null,
  governingLaw: 'the United States of America',
};

/** Legal details for this installation: VB_LEGAL_* in .env, or LEGAL_DEFAULTS; null when neither is set. */
export interface LegalInfo {
  company: string;
  /** The registered legal name behind Lango, e.g. "Lango LLC". */
  legalName: string | null;
  /** Where to send permission requests and legal notices. */
  email: string | null;
  /** Postal address for legal notices. */
  address: string | null;
  /** The country (or state) whose law governs the terms, e.g. "Ukraine". */
  governingLaw: string | null;
  termsVersion: string;
}

/** Where the signed-in owner stands with the Terms of Service. */
export interface TermsStatus {
  version: string;
  /** The latest version this account accepted, or null. */
  acceptedVersion: string | null;
  acceptedAt: number | null;
  /** True when the current version still has to be accepted. */
  required: boolean;
}
