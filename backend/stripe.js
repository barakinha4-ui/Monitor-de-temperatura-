'use strict';

const Stripe = require('stripe');
const logger = require('../utils/logger');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-04-10',
  appInfo: {
    name:    'ConflictWatch',
    version: '1.0.0',
  },
});

/**
 * Cria ou recupera cliente Stripe por email
 */
async function getOrCreateCustomer(email, userId, name) {
  // Primeiro buscar por metadata para idempotência
  const existing = await stripe.customers.search({
    query: `metadata['supabase_user_id']:'${userId}'`,
    limit: 1,
  });

  if (existing.data.length > 0) {
    return existing.data[0];
  }

  // Criar novo
  return stripe.customers.create({
    email,
    name,
    metadata: { supabase_user_id: userId },
  });
}

/**
 * Cria sessão de checkout para assinatura PRO
 */
async function createCheckoutSession(customerId, userId, successUrl, cancelUrl) {
  return stripe.checkout.sessions.create({
    customer:   customerId,
    mode:       'subscription',
    line_items: [{
      price:    process.env.STRIPE_PRO_PRICE_ID,
      quantity: 1,
    }],
    allow_promotion_codes:   true,
    billing_address_collection: 'required',
    subscription_data: {
      metadata: { supabase_user_id: userId },
      trial_period_days: 7, // 7 dias grátis
    },
    success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  cancelUrl,
    metadata: { supabase_user_id: userId },
  });
}

/**
 * Cria portal de billing para o cliente gerenciar assinatura
 */
async function createBillingPortalSession(customerId, returnUrl) {
  return stripe.billingPortal.sessions.create({
    customer:   customerId,
    return_url: returnUrl,
  });
}

/**
 * Cancela assinatura imediatamente (ou no fim do período)
 */
async function cancelSubscription(subscriptionId, immediately = false) {
  if (immediately) {
    return stripe.subscriptions.cancel(subscriptionId);
  }
  // Cancela no fim do período de faturamento
  return stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
  });
}

/**
 * Valida webhook do Stripe
 * IMPORTANTE: req.body deve ser raw (Buffer), não parsed JSON
 */
function constructWebhookEvent(payload, signature) {
  return stripe.webhooks.constructEvent(
    payload,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET
  );
}

/**
 * Busca assinatura por ID
 */
async function getSubscription(subscriptionId) {
  try {
    return await stripe.subscriptions.retrieve(subscriptionId);
  } catch {
    return null;
  }
}

module.exports = {
  stripe,
  getOrCreateCustomer,
  createCheckoutSession,
  createBillingPortalSession,
  cancelSubscription,
  constructWebhookEvent,
  getSubscription,
};
