'use strict';

const express = require('express');
const router  = express.Router();

const { optionalAuth }                         = require('../middleware/auth');
const { supabaseAdmin }                        = require('../services/supabase');
const { sendSuccess, sendError, asyncHandler } = require('../utils/response');
const { classifyTensionLevel }                 = require('../utils/tensionCalc');

// ── GET /api/tension/current ──────────────────────────────────
router.get('/current', asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('tension_history')
    .select('tension_value, delta, created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return sendError(res, 500, 'Erro ao buscar tensão');

  const classification = classifyTensionLevel(data.tension_value);

  return sendSuccess(res, {
    value:     data.tension_value,
    delta:     data.delta,
    level:     classification.level,
    label:     classification.label,
    color:     classification.color,
    updated_at: data.created_at,
  });
}));

// ── GET /api/tension/history ──────────────────────────────────
// FREE: últimas 24h | PRO: 90 dias
router.get('/history', optionalAuth, asyncHandler(async (req, res) => {
  const plan = req.profile?.plan || 'anon';

  // Definir janela de tempo por plano
  let hoursBack;
  if (plan === 'pro')  hoursBack = 90 * 24; // 90 dias
  else if (plan === 'free') hoursBack = 24;
  else hoursBack = 6;

  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

  // Limitar pontos para não sobrecarregar (máx 500)
  const maxPoints = plan === 'pro' ? 500 : 100;

  const { data, error } = await supabaseAdmin
    .from('tension_history')
    .select('id, tension_value, delta, notes, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(maxPoints);

  if (error) return sendError(res, 500, 'Erro ao buscar histórico');

  // Calcular estatísticas
  const values = (data || []).map(d => d.tension_value);
  const stats  = values.length > 0 ? {
    min:     Math.min(...values),
    max:     Math.max(...values),
    avg:     Math.round(values.reduce((a, b) => a + b, 0) / values.length * 100) / 100,
    current: values[values.length - 1],
  } : null;

  return sendSuccess(res, data || [], 200, {
    plan,
    hours_back: hoursBack,
    stats,
    upgrade_url: plan !== 'pro' ? `${process.env.APP_URL}/pricing` : null,
  });
}));

module.exports = router;
