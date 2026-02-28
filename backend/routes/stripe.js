'use strict';

const express = require('express');
const router  = express.Router();

const stripeService = require('../services/stripe');
const { requireAuth } = require('../middleware/auth');
const { supabaseAdmin, getUserByStripeCustomer, updateUser } = require('../services/supabase');
const { sendSuccess, sendError, asyncHandler } = require('../utils/response');
const logger = require('../utils/logger');

// ── POST /api/stripe/checkout ─────────────────────────────────
// Cria sessão de checkout Stripe para upgrade PRO
router.post('/checkout', requireAuth, asyncHandler(async (req, res) => {
  const { profile } = req;

  if (profile.plan === 'pro' && profile.subscription_status === 'active') {
    return sendError(res, 400, 'Você já possui o plano PRO ativo');
  }

  // Criar ou recuperar cliente Stripe
  let customerId = profile.stripe_customer_id;

  if (!customerId) {
    const customer = await stripeService.getOrCreateCustomer(
      profile.email,
      profile.id,
      profile.full_name
    );
    customerId = customer.id;

    // Salvar stripe_customer_id no perfil
    await updateUser(profile.id, { stripe_customer_id: customerId });
  }

  // Criar sessão de checkout
  const session = await stripeService.createCheckoutSession(
    customerId,
    profile.id,
    `${process.env.APP_URL}/index.html?upgraded=true`,
    `${process.env.APP_URL}/pricing`
  );

  return sendSuccess(res, {
    checkout_url: session.url,
    session_id:   session.id,
  });
}));

// ── POST /api/stripe/portal ───────────────────────────────────
// Portal de billing para gerenciar/cancelar assinatura
router.post('/portal', requireAuth, asyncHandler(async (req, res) => {
  const { profile } = req;

  if (!profile.stripe_customer_id) {
    return sendError(res, 400, 'Nenhuma assinatura encontrada');
  }

  const session = await stripeService.createBillingPortalSession(
    profile.stripe_customer_id,
    `${process.env.APP_URL}/index.html`
  );

  return sendSuccess(res, { portal_url: session.url });
}));

// ── GET /api/stripe/subscription ─────────────────────────────
// Status atual da assinatura
router.get('/subscription', requireAuth, asyncHandler(async (req, res) => {
  const { profile } = req;

  if (!profile.stripe_subscription_id) {
    return sendSuccess(res, {
      plan:   'free',
      status: 'none',
    });
  }

  const subscription = await stripeService.getSubscription(profile.stripe_subscription_id);

  return sendSuccess(res, {
    plan:              profile.plan,
    status:            subscription?.status || profile.subscription_status,
    current_period_end: subscription?.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : profile.subscription_ends_at,
    cancel_at_period_end: subscription?.cancel_at_period_end,
  });
}));

// ── POST /api/stripe/webhook ──────────────────────────────────
// IMPORTANTE: body deve ser raw (configurado no server.js)
router.post('/webhook', asyncHandler(async (req, res) => {
  const signature = req.headers['stripe-signature'];

  if (!signature) {
    return res.status(400).json({ error: 'Missing stripe-signature header' });
  }

  let event;
  try {
    event = stripeService.constructWebhookEvent(req.body, signature);
  } catch (err) {
    logger.warn({ err: err.message }, 'Stripe webhook signature invalid');
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  // Idempotência: verificar se já processamos este evento
  const { data: existing } = await supabaseAdmin
    .from('stripe_events')
    .select('id, processed')
    .eq('id', event.id)
    .single();

  if (existing?.processed) {
    logger.info({ eventId: event.id }, 'Stripe event already processed — skipping');
    return res.json({ received: true });
  }

  // Salvar evento para auditoria
  await supabaseAdmin.from('stripe_events').upsert({
    id:   event.id,
    type: event.type,
    data: event.data,
  });

  // Processar evento
  try {
    await handleStripeEvent(event);

    // Marcar como processado
    await supabaseAdmin
      .from('stripe_events')
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq('id', event.id);

  } catch (err) {
    logger.error({ err, eventType: event.type }, 'Stripe webhook handler error');
    // Retornar 500 para Stripe retentar
    return res.status(500).json({ error: 'Handler error' });
  }

  res.json({ received: true });
}));

// ── Handler dos eventos Stripe ────────────────────────────────
async function handleStripeEvent(event) {
  const data = event.data.object;

  switch (event.type) {

    // Checkout completado — upgrade para PRO
    case 'checkout.session.completed': {
      if (data.mode !== 'subscription') break;

      const userId       = data.metadata?.supabase_user_id;
      const customerId   = data.customer;
      const subscriptionId = data.subscription;

      if (!userId) {
        logger.error({ event: event.id }, 'checkout.session.completed sem supabase_user_id');
        break;
      }

      await updateUser(userId, {
        plan:                   'pro',
        stripe_customer_id:     customerId,
        stripe_subscription_id: subscriptionId,
        subscription_status:    'active',
      });

      logger.info({ userId, subscriptionId }, '✓ User upgraded to PRO');
      break;
    }

    // Pagamento bem-sucedido (renovação mensal)
    case 'invoice.paid': {
      const customerId = data.customer;
      const user       = await getUserByStripeCustomer(customerId);
      if (!user) break;

      const periodEnd = data.lines?.data?.[0]?.period?.end;

      await updateUser(user.id, {
        plan:                'pro',
        subscription_status: 'active',
        subscription_ends_at: periodEnd
          ? new Date(periodEnd * 1000).toISOString()
          : null,
      });

      logger.info({ userId: user.id }, '✓ Invoice paid — subscription renewed');
      break;
    }

    // Pagamento falhou
    case 'invoice.payment_failed': {
      const customerId = data.customer;
      const user       = await getUserByStripeCustomer(customerId);
      if (!user) break;

      await updateUser(user.id, {
        subscription_status: 'past_due',
      });

      logger.warn({ userId: user.id }, '⚠ Payment failed — subscription past_due');
      break;
    }

    // Assinatura cancelada ou expirada
    case 'customer.subscription.deleted': {
      const customerId = data.customer;
      const user       = await getUserByStripeCustomer(customerId);
      if (!user) break;

      await updateUser(user.id, {
        plan:                   'free',
        subscription_status:    'cancelled',
        stripe_subscription_id: null,
        stripe_price_id:        null,
        subscription_ends_at:   new Date().toISOString(),
      });

      logger.info({ userId: user.id }, '✓ Subscription cancelled — downgraded to FREE');
      break;
    }

    // Assinatura atualizada (upgrade/downgrade de plano)
    case 'customer.subscription.updated': {
      const customerId = data.customer;
      const user       = await getUserByStripeCustomer(customerId);
      if (!user) break;

      await updateUser(user.id, {
        subscription_status:  data.status,
        stripe_price_id:      data.items?.data?.[0]?.price?.id,
        subscription_ends_at: data.current_period_end
          ? new Date(data.current_period_end * 1000).toISOString()
          : null,
      });

      logger.info({ userId: user.id, status: data.status }, '✓ Subscription updated');
      break;
    }

    default:
      logger.debug({ type: event.type }, 'Unhandled Stripe event (ignored)');
  }
}

module.exports = router;
