// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Imported first by the harness so server modules see these values when they are evaluated.
// Lower scrypt cost keeps password hashing fast in tests (production default: N=2^17).
process.env.VB_SCRYPT_N ??= '16384';
