'use strict';

const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

// ── Client com ANON KEY (para operações de usuário autenticado) ─
const supabaseAnon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  {
    auth: { persistSession: false },
  }
);

// ── Client com SERVICE ROLE KEY (operações privilegiadas de backend) ─
// NUNCA expor ao frontend — apenas no backend
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

// ── Helpers ───────────────────────────────────────────────────

/**
 * Busca usuário pelo ID (com service role — ignora RLS)
 */
async function getUserById(userId) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) {
    logger.error({ error, userId }, 'getUserById failed');
    return null;
  }
  return data;
}

/**
 * Atualiza dados do usuário (service role)
 */
async function updateUser(userId, updates) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Busca usuário pelo stripe_customer_id
 */
async function getUserByStripeCustomer(customerId) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('stripe_customer_id', customerId)
    .single();

  if (error) return null;
  return data;
}

/**
 * Verifica JWT do Supabase e retorna o usuário
 */
async function verifySupabaseToken(token) {
  const { data, error } = await supabaseAnon.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

/**
 * Incrementa contador de análises do usuário hoje
 * Retorna false se limite atingido
 */
async function incrementAnalysisCount(userId, plan) {
  const FREE_LIMIT = 5;

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('ai_analyses_today, ai_analyses_reset_at')
    .eq('id', userId)
    .single();

  if (!user) return false;

  // Reset se passou 24h
  const resetAt = new Date(user.ai_analyses_reset_at);
  const now     = new Date();
  let count     = user.ai_analyses_today;

  if (now - resetAt > 24 * 60 * 60 * 1000) {
    count = 0;
    await supabaseAdmin.from('users').update({
      ai_analyses_today:  0,
      ai_analyses_reset_at: now.toISOString(),
    }).eq('id', userId);
  }

  // PRO não tem limite
  if (plan === 'pro') {
    await supabaseAdmin.from('users').update({
      ai_analyses_today: count + 1,
    }).eq('id', userId);
    return true;
  }

  // FREE: verificar limite
  if (count >= FREE_LIMIT) return false;

  await supabaseAdmin.from('users').update({
    ai_analyses_today: count + 1,
  }).eq('id', userId);

  return true;
}

/**
 * Salva análise IA no histórico do usuário
 */
async function saveAnalysis(userId, query, response, language, tokensUsed) {
  const { error } = await supabaseAdmin.from('user_analyses').insert({
    user_id:     userId,
    query,
    response,
    language,
    tokens_used: tokensUsed,
  });
  if (error) logger.error({ error }, 'saveAnalysis failed');
}

/**
 * Notifica usuários PRO de um novo alerta via Supabase Realtime
 * (Realtime funciona por broadcast/canal — frontend subscreve)
 */
async function createAlert(eventId, title, message, severity, category) {
  const { data, error } = await supabaseAdmin
    .from('alerts')
    .insert({
      event_id: eventId,
      title,
      message,
      severity,
      category,
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    logger.error({ error }, 'createAlert failed');
    return null;
  }
  return data;
}

module.exports = {
  supabase: supabaseAnon,
  supabaseAdmin,
  getUserById,
  updateUser,
  getUserByStripeCustomer,
  verifySupabaseToken,
  incrementAnalysisCount,
  saveAnalysis,
  createAlert,
};
