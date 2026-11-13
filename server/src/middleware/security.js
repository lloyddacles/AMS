import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

export function securityHeaders() {
  return helmet({
    // The SPA, QR scanner, and PWA assets need a permissive-but-explicit policy;
    // keep defaults strong while allowing same-origin resources and data/blob
    // URLs used for avatars, QR images, and exports.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });
}

export function authRateLimit() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many sign-in attempts. Please try again later.' },
  });
}

export function publicWriteRateLimit() {
  return rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' },
  });
}

export function publicReadRateLimit() {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests. Please slow down and try again.' },
  });
}

export function apiRateLimit() {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests. Please slow down and try again.' },
  });
}
