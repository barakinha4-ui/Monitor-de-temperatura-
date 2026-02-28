'use strict';

const express = require('express');
const router  = express.Router();

const { optionalAuth }                         = require('../middleware/auth');
const { supabaseAdmin }                        = require('../services/supabase');
const { sendSuccess, sendError, asyncHandler } = require('../utils/response');
const { sanitizeNumber, validateLanguage }     = require('../utils/sanitize');

// ── GET /api/events ───────────────────────────────────────────
// Feed principal de eventos
// - Anon:  últimas 6h, sem críticos
// - FREE:  últimas 24h
// - PRO:   tudo + traduções
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const plan     = req.profile?.plan || 'anon';
  const language = validateLanguage(req.query.lang || req.profile?.preferred_language || 'pt');
  const limit    = sanitizeNumber(req.query.limit, 1, 50, 20);
  const page     = Math.max(1, parseInt(req.query.page) || 1);
  const offset   = (page - 1) * limit;

  // Montar query base
  let query = supabaseAdmin
    .from('news_events')
    .select([
      'id',
      'published_at',
      'source',
      'url',
      'category',
      'impact_score',
      'is_critical',
      'tension_delta',
      // Selecionar título no idioma correto (fallback para EN)
      `title_${language}`,
      'title_en',
      // AI summary apenas para logados
      ...(plan !== 'anon' ? ['ai_summary', 'keywords'] : []),
    ].join(', '), { count: 'exact' })
    .order('published_at', { ascending: false })
    .range(offset, offset + limit - 1);

  // Filtros por plano
  if (plan === 'anon') {
    query = query
      .gte('published_at', new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
      .eq('is_critical', false);
  } else if (plan === 'free') {
    query = query
      .gte('published_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  }
  // PRO: sem filtro de data

  // Filtros opcionais da query string
  if (req.query.category) {
    const validCategories = ['military','nuclear','diplomatic','economic','cyber','other'];
    if (validCategories.includes(req.query.category)) {
      query = query.eq('category', req.query.category);
    }
  }

  if (req.query.critical === 'true') {
    query = query.eq('is_critical', true);
  }

  const { data, error, count } = await query;

  if (error) return sendError(res, 500, 'Erro ao buscar eventos');

  // Normalizar título para o idioma solicitado
  const events = (data || []).map(e => ({
    ...e,
    title: e[`title_${language}`] || e.title_en,
    // Remover campos de título individuais da resposta
    title_pt: undefined,
    title_en: undefined,
    title_es: undefined,
    title_ar: undefined,
    title_fa: undefined,
  }));

  return sendSuccess(res, events, 200, {
    plan,
    language,
    pagination: {
      page,
      limit,
      total: count,
      pages: Math.ceil((count || 0) / limit),
    },
    meta: {
      history_days: plan === 'pro' ? 90 : plan === 'free' ? 1 : 0.25,
    },
  });
}));

// ── GET /api/events/:id ───────────────────────────────────────
router.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabaseAdmin
    .from('news_events')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) return sendError(res, 404, 'Evento não encontrado');

  // Verificar acesso ao conteúdo PRO
  const plan = req.profile?.plan || 'anon';
  if (data.is_critical && plan === 'anon') {
    return res.status(403).json({
      success:     false,
      error:       'Alertas críticos são exclusivos para usuários cadastrados',
      register_url: `${process.env.APP_URL}/login.html`,
    });
  }

  return sendSuccess(res, data);
}));

module.exports = router;
