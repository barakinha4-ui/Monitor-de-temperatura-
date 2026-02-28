'use strict';

const cron   = require('node-cron');
const logger = require('../utils/logger');
const { fetchLatestNews }                          = require('../services/news');
const { classifyNewsEvent, translateNewsTitle }    = require('../services/claude');
const { supabaseAdmin, createAlert }               = require('../services/supabase');
const { calculateTensionDelta, applyTensionDelta, shouldTriggerAlert } = require('../utils/tensionCalc');
const { sendTelegramAlert, notifyProUsersViaTelegram } = require('../services/telegram');

let isRunning = false; // Evitar execuções sobrepostas

/**
 * Execução principal do cron job:
 * 1. Buscar notícias recentes
 * 2. Classificar com IA
 * 3. Salvar no Supabase
 * 4. Atualizar índice de tensão
 * 5. Disparar alertas se necessário
 */
async function runNewsCycle() {
  if (isRunning) {
    logger.warn('News cron already running — skipping');
    return;
  }

  isRunning = true;
  const startTime = Date.now();
  logger.info('◈ News cycle started');

  try {
    // 1. Buscar notícias
    const articles = await fetchLatestNews();
    if (articles.length === 0) {
      logger.info('No new articles found');
      return;
    }

    // 2. Buscar tensão atual
    const { data: latestTension } = await supabaseAdmin
      .from('tension_history')
      .select('tension_value')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    let currentTension = latestTension?.tension_value || 75;
    const alertsToFire = [];

    // 3. Processar cada artigo
    for (const article of articles) {
      try {
        // Verificar se já existe no banco (deduplicação)
        const { data: exists } = await supabaseAdmin
          .from('news_events')
          .select('id')
          .eq('url', article.url)
          .single();

        if (exists) continue; // Já processado

        // Classificar com IA
        const classification = await classifyNewsEvent(
          article.title,
          article.description
        );

        // Traduzir título
        const translations = await translateNewsTitle(article.title);

        // Calcular delta de tensão
        const delta = calculateTensionDelta(
          classification.category,
          classification.impact_score,
          article.title
        );

        // Inserir evento no banco
        const { data: savedEvent, error: insertError } = await supabaseAdmin
          .from('news_events')
          .insert({
            title:        article.title,
            description:  article.description,
            url:          article.url,
            source:       article.source,
            published_at: article.published_at,
            category:     classification.category,
            impact_score: classification.impact_score,
            is_critical:  classification.is_critical || shouldTriggerAlert({ ...article, impact_score: classification.impact_score }),
            ai_summary:   classification.summary_pt,
            keywords:     classification.keywords || [],
            tension_delta: delta,
            title_en:     article.title,
            title_pt:     translations.pt,
            title_es:     translations.es,
            title_ar:     translations.ar,
            title_fa:     translations.fa,
          })
          .select()
          .single();

        if (insertError) {
          // Ignorar erro de URL duplicada (race condition)
          if (!insertError.code === '23505') {
            logger.error({ error: insertError, url: article.url }, 'Insert error');
          }
          continue;
        }

        // Atualizar tensão
        currentTension = applyTensionDelta(currentTension, delta);

        // Checar se precisa de alerta
        if (savedEvent.is_critical || classification.impact_score >= 8) {
          alertsToFire.push({
            event:    savedEvent,
            score:    classification.impact_score,
            summary:  classification.summary_pt,
          });
        }

        logger.info({
          title:    article.title.slice(0, 60),
          category: classification.category,
          score:    classification.impact_score,
          delta,
        }, 'Event processed');

        // Rate limit para não sobrecarregar a API da IA
        await sleep(500);

      } catch (err) {
        logger.error({ err, url: article.url }, 'Article processing error');
      }
    }

    // 4. Salvar nova tensão no histórico
    await supabaseAdmin.from('tension_history').insert({
      tension_value: currentTension,
      notes:         `Auto-update via news cron — ${articles.length} articles processed`,
    });

    logger.info({ tensionValue: currentTension }, 'Tension updated');

    // 5. Disparar alertas
    for (const alertData of alertsToFire) {
      await processAlert(alertData);
    }

    const duration = Date.now() - startTime;
    logger.info({ duration, articles: articles.length }, '◈ News cycle completed');

  } catch (err) {
    logger.error({ err }, 'News cycle failed');
  } finally {
    isRunning = false;
  }
}

/**
 * Processa e distribui um alerta crítico
 */
async function processAlert(alertData) {
  const { event, score, summary } = alertData;

  try {
    // Criar alerta no banco
    const severity = score >= 9 ? 'critical' : score >= 7 ? 'high' : 'medium';
    const alert = await createAlert(
      event.id,
      event.title,
      summary || event.description || 'Evento crítico detectado',
      severity,
      event.category
    );

    if (!alert) return;

    logger.info({ alertId: alert.id, severity }, 'Alert created');

    // Enviar para canal Telegram global (se configurado)
    await sendTelegramAlert(alert.title, alert.message, severity);

    // Notificar usuários PRO via Telegram pessoal (se configurado)
    const { data: proUsers } = await supabaseAdmin
      .from('users')
      .select('id, telegram_chat_id, alert_telegram_enabled')
      .eq('plan', 'pro')
      .eq('alert_telegram_enabled', true)
      .not('telegram_chat_id', 'is', null);

    if (proUsers?.length) {
      await notifyProUsersViaTelegram(alert, proUsers);
    }

    // Realtime é automático via Supabase — usuários PRO que
    // estão subscritos no canal 'alerts' receberão automaticamente

  } catch (err) {
    logger.error({ err }, 'processAlert failed');
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Inicia o cron job
 * Executa a cada 5 minutos
 */
function startNewsCron() {
  // Executar imediatamente na inicialização
  runNewsCycle();

  // Depois executar a cada 5 minutos
  cron.schedule('*/5 * * * *', () => {
    runNewsCycle();
  }, {
    timezone: 'UTC',
  });

  logger.info('News cron scheduled: every 5 minutes');
}

module.exports = { startNewsCron, runNewsCycle };
