'use strict';

const logger = require('../utils/logger');

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

/**
 * Envia mensagem de alerta via Telegram
 * Requer TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID nas env vars
 */
async function sendTelegramAlert(title, message, severity = 'high') {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    return; // Telegram não configurado — silenciosamente ignorar
  }

  const severityEmoji = {
    critical: '🔴',
    high:     '🟠',
    medium:   '🟡',
  };

  const emoji = severityEmoji[severity] || '🟠';

  const text = [
    `${emoji} *CONFLICT WATCH — ALERTA ${severity.toUpperCase()}*`,
    '',
    `*${escapeMarkdown(title)}*`,
    '',
    escapeMarkdown(message),
    '',
    `_${new Date().toUTCString()}_`,
  ].join('\n');

  try {
    const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        chat_id:    process.env.TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'MarkdownV2',
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      const error = await res.text();
      logger.warn({ error }, 'Telegram send failed');
    } else {
      logger.info({ title }, 'Telegram alert sent');
    }
  } catch (err) {
    logger.error({ err }, 'Telegram service error');
    // Não propagar erro — alerta Telegram é não-crítico
  }
}

/**
 * Envia alerta crítico para todos os usuários PRO que configuraram Telegram
 */
async function notifyProUsersViaTelegram(alert, users) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return;

  for (const user of users) {
    if (!user.alert_telegram_enabled || !user.telegram_chat_id) continue;

    try {
      const text = `🔴 *ALERTA CRÍTICO — CONFLICT WATCH*\n\n*${escapeMarkdown(alert.title)}*\n\n${escapeMarkdown(alert.message)}`;

      await fetch(`${TELEGRAM_API}/sendMessage`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          chat_id:    user.telegram_chat_id,
          text,
          parse_mode: 'MarkdownV2',
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      logger.error({ err, userId: user.id }, 'Telegram user notify error');
    }
  }
}

// Escapar caracteres especiais do MarkdownV2
function escapeMarkdown(text) {
  return (text || '').replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

module.exports = { sendTelegramAlert, notifyProUsersViaTelegram };
