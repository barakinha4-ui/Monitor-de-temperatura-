'use strict';

const express = require('express');
const router  = express.Router();

const { requireAuth }                          = require('../middleware/auth');
const { requirePro }                           = require('../middleware/planGate');
const { supabaseAdmin }                        = require('../services/supabase');
const { sendSuccess, sendError, asyncHandler } = require('../utils/response');

// ── GET /api/alerts ───────────────────────────────────────────
// Lista alertas críticos ativos — PRO apenas
router.get(
  '/',
  requireAuth,
  requirePro('Alertas críticos são exclusivos do plano PRO'),
  asyncHandler(async (req, res) => {
    const showAll = req.query.all === 'true';

    let query = supabaseAdmin
      .from('alerts')
      .select(`
        id, title, message, severity, category, is_active,
        notified_count, created_at,
        event:event_id (id, url, source, impact_score)
      `)
      .order('created_at', { ascending: false })
      .limit(50);

    if (!showAll) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;
    if (error) return sendError(res, 500, 'Erro ao buscar alertas');

    return sendSuccess(res, data || []);
  })
);

// ── GET /api/alerts/unread-count ──────────────────────────────
router.get(
  '/unread-count',
  requireAuth,
  requirePro(),
  asyncHandler(async (req, res) => {
    // Alertas criados após o último login do usuário
    const since = req.profile.last_alert_check || req.profile.created_at;

    const { count } = await supabaseAdmin
      .from('alerts')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .gte('created_at', since);

    return sendSuccess(res, { count: count || 0 });
  })
);

// ── PUT /api/alerts/mark-read ─────────────────────────────────
router.put(
  '/mark-read',
  requireAuth,
  requirePro(),
  asyncHandler(async (req, res) => {
    const { updateUser } = require('../services/supabase');
    await updateUser(req.profile.id, {
      last_alert_check: new Date().toISOString(),
    }).catch(() => {});

    return sendSuccess(res, { message: 'Alertas marcados como lidos' });
  })
);

module.exports = router;
