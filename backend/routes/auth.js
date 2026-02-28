'use strict';

const express = require('express');
const router  = express.Router();

const { supabase, supabaseAdmin, getUserById } = require('../services/supabase');
const { requireAuth }                          = require('../middleware/auth');
const { authRateLimit }                        = require('../middleware/rateLimit');
const { sendSuccess, sendError, asyncHandler } = require('../utils/response');
const { sanitizeEmail, sanitizeString }        = require('../utils/sanitize');
const logger                                   = require('../utils/logger');

// ── POST /api/auth/register ───────────────────────────────────
router.post('/register', authRateLimit, asyncHandler(async (req, res) => {
  const { email: rawEmail, password, fullName } = req.body;

  const email = sanitizeEmail(rawEmail);
  if (!email) return sendError(res, 400, 'Email inválido');

  if (!password || password.length < 8) {
    return sendError(res, 400, 'Senha deve ter no mínimo 8 caracteres');
  }

  const name = sanitizeString(fullName || '', 100);

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: name },
      emailRedirectTo: `${process.env.APP_URL}/auth/callback.html`,
    },
  });

  if (error) {
    logger.warn({ email, error: error.message }, 'Register failed');
    return sendError(res, 400, error.message);
  }

  return sendSuccess(res, {
    user:    { id: data.user?.id, email },
    message: 'Conta criada. Verifique seu email para confirmar.',
  }, 201);
}));

// ── POST /api/auth/login ──────────────────────────────────────
router.post('/login', authRateLimit, asyncHandler(async (req, res) => {
  const { email: rawEmail, password } = req.body;

  const email = sanitizeEmail(rawEmail);
  if (!email || !password) {
    return sendError(res, 400, 'Email e senha são obrigatórios');
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    logger.warn({ email, error: error.message }, 'Login failed');
    // Mensagem genérica por segurança (não revelar se email existe)
    return sendError(res, 401, 'Credenciais inválidas');
  }

  const profile = await getUserById(data.user.id);

  return sendSuccess(res, {
    access_token:  data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at:    data.session.expires_at,
    user: {
      id:    data.user.id,
      email: data.user.email,
      plan:  profile?.plan || 'free',
      name:  profile?.full_name || data.user.user_metadata?.full_name,
    },
  });
}));

// ── POST /api/auth/google ─────────────────────────────────────
// Retorna URL de OAuth do Google (frontend redireciona para lá)
router.post('/google', asyncHandler(async (req, res) => {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options:  {
      redirectTo:    `${process.env.APP_URL}/auth/callback.html`,
      queryParams:   { access_type: 'offline', prompt: 'consent' },
    },
  });

  if (error) return sendError(res, 500, 'Erro ao iniciar OAuth Google');

  return sendSuccess(res, { url: data.url });
}));

// ── POST /api/auth/refresh ────────────────────────────────────
router.post('/refresh', asyncHandler(async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) return sendError(res, 400, 'refresh_token obrigatório');

  const { data, error } = await supabase.auth.refreshSession({ refresh_token });
  if (error) return sendError(res, 401, 'Refresh token inválido');

  return sendSuccess(res, {
    access_token:  data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at:    data.session.expires_at,
  });
}));

// ── POST /api/auth/forgot-password ───────────────────────────
router.post('/forgot-password', authRateLimit, asyncHandler(async (req, res) => {
  const email = sanitizeEmail(req.body.email);
  if (!email) return sendError(res, 400, 'Email inválido');

  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.APP_URL}/auth/reset-password.html`,
  });

  // Sempre retornar sucesso (não revelar se email existe)
  return sendSuccess(res, {
    message: 'Se o email existir, você receberá um link de recuperação.',
  });
}));

// ── POST /api/auth/logout ─────────────────────────────────────
router.post('/logout', requireAuth, asyncHandler(async (req, res) => {
  await supabase.auth.signOut();
  return sendSuccess(res, { message: 'Logout realizado com sucesso' });
}));

// ── GET /api/auth/me ──────────────────────────────────────────
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const profile = req.profile;
  return sendSuccess(res, {
    id:            profile.id,
    email:         profile.email,
    full_name:     profile.full_name,
    plan:          profile.plan,
    subscription_status: profile.subscription_status,
    ai_analyses_today:   profile.ai_analyses_today,
    ai_analyses_limit:   profile.plan === 'pro' ? null : 5,
    preferred_language:  profile.preferred_language,
    created_at:    profile.created_at,
  });
}));

// ── PUT /api/auth/profile ─────────────────────────────────────
router.put('/profile', requireAuth, asyncHandler(async (req, res) => {
  const { updateUser } = require('../services/supabase');
  const { fullName, preferredLanguage, alertEmailEnabled } = req.body;

  const updates = {};
  if (fullName !== undefined)         updates.full_name = sanitizeString(fullName, 100);
  if (preferredLanguage !== undefined) {
    const { validateLanguage } = require('../utils/sanitize');
    updates.preferred_language = validateLanguage(preferredLanguage);
  }
  if (alertEmailEnabled !== undefined) updates.alert_email_enabled = Boolean(alertEmailEnabled);

  const updated = await updateUser(req.profile.id, updates);
  return sendSuccess(res, updated);
}));

module.exports = router;
