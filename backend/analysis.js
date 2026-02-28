'use strict';

const express = require('express');
const router  = express.Router();

const { requireAuth }                                    = require('../middleware/auth');
const { validateSubscription }                           = require('../middleware/planGate');
const { analysisRateLimit }                              = require('../middleware/rateLimit');
const { analyzeGeopolitical }                            = require('../services/claude');
const { incrementAnalysisCount, saveAnalysis, supabaseAdmin } = require('../services/supabase');
const { sendSuccess, sendError, asyncHandler }           = require('../utils/response');
const { sanitizeAIQuery, validateLanguage }              = require('../utils/sanitize');

const FREE_DAILY_LIMIT = 5;

// ── POST /api/analysis ────────────────────────────────────────
// Análise principal — requer auth + verifica plano
router.post(
  '/',
  requireAuth,
  validateSubscription,
  analysisRateLimit,
  asyncHandler(async (req, res) => {
    const { query: rawQuery, language: rawLang } = req.body;

    // Sanitização
    const query    = sanitizeAIQuery(rawQuery);
    const language = validateLanguage(rawLang || req.profile.preferred_language);

    if (!query || query.length < 5) {
      return sendError(res, 400, 'Query muito curta ou inválida');
    }

    const { profile } = req;

    // ── Verificar limite de uso ───────────────────────────────
    const allowed = await incrementAnalysisCount(profile.id, profile.plan);

    if (!allowed) {
      return res.status(429).json({
        success:   false,
        error:     `Limite de ${FREE_DAILY_LIMIT} análises por dia atingido no plano FREE.`,
        limit:     FREE_DAILY_LIMIT,
        used:      profile.ai_analyses_today,
        resets_at: getResetTime(profile.ai_analyses_reset_at),
        upgrade_url: `${process.env.APP_URL}/pricing`,
      });
    }

    // ── Executar análise IA ───────────────────────────────────
    const result = await analyzeGeopolitical(query, language);

    // ── Salvar no histórico (async, não bloquear resposta) ────
    saveAnalysis(
      profile.id,
      query,
      result.text,
      language,
      result.totalTokens
    ).catch(() => {});

    // ── Responder ─────────────────────────────────────────────
    return sendSuccess(res, {
      response:  result.text,
      language,
      usage: {
        analyses_today: profile.ai_analyses_today + 1,
        limit:          profile.plan === 'pro' ? null : FREE_DAILY_LIMIT,
        plan:           profile.plan,
      },
    });
  })
);

// ── GET /api/analysis/history ─────────────────────────────────
// Histórico de análises do usuário (PRO: tudo | FREE: últimas 5)
router.get(
  '/history',
  requireAuth,
  asyncHandler(async (req, res) => {
    const limit  = req.profile.plan === 'pro' ? 100 : 5;
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const offset = (page - 1) * limit;

    const { data, error, count } = await supabaseAdmin
      .from('user_analyses')
      .select('id, query, response, language, tokens_used, created_at', { count: 'exact' })
      .eq('user_id', req.profile.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) return sendError(res, 500, 'Erro ao buscar histórico');

    return sendSuccess(res, data, 200, {
      pagination: { page, limit, total: count, pages: Math.ceil(count / limit) },
    });
  })
);

// ── GET /api/analysis/usage ───────────────────────────────────
// Status de uso atual do usuário
router.get(
  '/usage',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { profile } = req;
    return sendSuccess(res, {
      plan:           profile.plan,
      analyses_today: profile.ai_analyses_today,
      limit:          profile.plan === 'pro' ? null : FREE_DAILY_LIMIT,
      remaining:      profile.plan === 'pro'
        ? null
        : Math.max(0, FREE_DAILY_LIMIT - profile.ai_analyses_today),
      resets_at: getResetTime(profile.ai_analyses_reset_at),
    });
  })
);

function getResetTime(resetAt) {
  const next = new Date(resetAt);
  next.setHours(next.getHours() + 24);
  return next.toISOString();
}

module.exports = router;
