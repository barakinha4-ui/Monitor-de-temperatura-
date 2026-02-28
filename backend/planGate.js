'use strict';

const { sendError } = require('../utils/response');

/**
 * Factory: cria middleware que bloqueia acesso se usuário não for PRO
 * 
 * Uso:
 *   router.get('/historico', requireAuth, requirePro(), handler)
 */
function requirePro(customMessage) {
  return (req, res, next) => {
    if (!req.profile) {
      return sendError(res, 401, 'Autenticação necessária');
    }

    if (req.profile.plan !== 'pro') {
      return res.status(403).json({
        success:    false,
        error:      customMessage || 'Este recurso é exclusivo do plano PRO',
        upgrade_url: `${process.env.APP_URL}/pricing`,
        plan:       req.profile.plan,
      });
    }

    next();
  };
}

/**
 * Middleware: verifica se assinatura Stripe está ativa para usuários PRO
 * Downgrade automático se assinatura expirou
 */
async function validateSubscription(req, res, next) {
  if (!req.profile || req.profile.plan !== 'pro') return next();

  const { updateUser } = require('../services/supabase');
  const now = new Date();

  // Verificar se assinatura expirou
  if (
    req.profile.subscription_ends_at &&
    new Date(req.profile.subscription_ends_at) < now &&
    req.profile.subscription_status !== 'active'
  ) {
    // Downgrade automático
    await updateUser(req.profile.id, {
      plan:               'free',
      subscription_status: 'expired',
    }).catch(() => {}); // não bloquear por erro de db

    req.profile.plan = 'free';
  }

  next();
}

module.exports = { requirePro, validateSubscription };
