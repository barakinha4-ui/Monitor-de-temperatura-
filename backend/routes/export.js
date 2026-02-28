'use strict';

const express = require('express');
const router  = express.Router();

const { requireAuth }                          = require('../middleware/auth');
const { requirePro }                           = require('../middleware/planGate');
const { exportRateLimit }                      = require('../middleware/rateLimit');
const { supabaseAdmin }                        = require('../services/supabase');
const { sendError, asyncHandler }              = require('../utils/response');
const { sanitizeNumber }                       = require('../utils/sanitize');

// ── GET /api/export/events.csv ────────────────────────────────
router.get(
  '/events.csv',
  requireAuth,
  requirePro('Exportação de dados é exclusiva do plano PRO'),
  exportRateLimit,
  asyncHandler(async (req, res) => {
    const days = sanitizeNumber(req.query.days, 1, 90, 30);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabaseAdmin
      .from('news_events')
      .select('id, title_en, category, impact_score, is_critical, tension_delta, source, published_at, url')
      .gte('published_at', since)
      .order('published_at', { ascending: false })
      .limit(5000);

    if (error) return sendError(res, 500, 'Erro ao exportar dados');

    // Gerar CSV
    const headers = [
      'ID', 'Title', 'Category', 'Impact Score',
      'Is Critical', 'Tension Delta', 'Source', 'Published At', 'URL'
    ];

    const rows = (data || []).map(row => [
      row.id,
      `"${(row.title_en || '').replace(/"/g, '""')}"`,
      row.category,
      row.impact_score,
      row.is_critical,
      row.tension_delta,
      `"${(row.source || '').replace(/"/g, '""')}"`,
      row.published_at,
      row.url,
    ].join(','));

    const csv = [headers.join(','), ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="conflictwatch-events-${days}d.csv"`);
    res.send('\uFEFF' + csv); // BOM para Excel
  })
);

// ── GET /api/export/tension.csv ───────────────────────────────
router.get(
  '/tension.csv',
  requireAuth,
  requirePro('Exportação de dados é exclusiva do plano PRO'),
  exportRateLimit,
  asyncHandler(async (req, res) => {
    const days = sanitizeNumber(req.query.days, 1, 90, 30);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabaseAdmin
      .from('tension_history')
      .select('id, tension_value, delta, notes, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(10000);

    if (error) return sendError(res, 500, 'Erro ao exportar tensão');

    const headers = ['ID', 'Tension Value', 'Delta', 'Notes', 'Timestamp'];
    const rows = (data || []).map(row => [
      row.id,
      row.tension_value,
      row.delta,
      `"${(row.notes || '').replace(/"/g, '""')}"`,
      row.created_at,
    ].join(','));

    const csv = [headers.join(','), ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="conflictwatch-tension-${days}d.csv"`);
    res.send('\uFEFF' + csv);
  })
);

module.exports = router;
