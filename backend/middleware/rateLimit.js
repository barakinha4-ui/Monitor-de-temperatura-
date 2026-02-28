'use strict';

const rateLimit = require('express-rate-limit');

// ── Rate limit global (todos os endpoints) ────────────────────
const globalRateLimit = rateLimit({
  windowMs:         15 * 60 * 1000, // 15 minutos
  max:              200,             // 200 requests por janela por IP
  standardHeaders:  true,
  legacyHeaders:    false,
  message: {
    success: false,
    error:   'Muitas requisições. Tente novamente em 15 minutos.',
  },
  skip: (req) => {
    // Stripe webhook nunca sofre rate limit
    return req.path === '/api/stripe/webhook';
  },
});

// ── Rate limit para rotas de autenticação ────────────────────
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max:      20,              // 20 tentativas de login por IP
  standardHeaders: true,
  legacyHeaders:   false,
  message: {
    success: false,
    error:   'Muitas tentativas. Tente novamente em 15 minutos.',
  },
});

// ── Rate limit para análises IA por usuário ───────────────────
// Nota: o limite de negócio (5/dia FREE) é controlado no banco.
// Este é um limite técnico de abuso (independente do plano).
const analysisRateLimit = rateLimit({
  windowMs:         60 * 1000, // 1 minuto
  max:              10,         // 10 análises por minuto por IP
  standardHeaders:  true,
  legacyHeaders:    false,
  keyGenerator:     (req) => {
    // Preferir userId se disponível (mais preciso que IP)
    return req.profile?.id || req.ip;
  },
  message: {
    success: false,
    error:   'Limite de velocidade atingido. Aguarde 1 minuto.',
  },
});

// ── Rate limit para exportações ──────────────────────────────
const exportRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max:      10,              // 10 exportações por hora
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator: (req) => req.profile?.id || req.ip,
  message: {
    success: false,
    error:   'Limite de exportações atingido. Tente em 1 hora.',
  },
});

module.exports = {
  globalRateLimit,
  authRateLimit,
  analysisRateLimit,
  exportRateLimit,
};
