'use strict';

const { verifySupabaseToken, getUserById } = require('../services/supabase');
const { sendError } = require('../utils/response');
const logger = require('../utils/logger');

/**
 * Middleware: Requer autenticação válida
 * Valida JWT do Supabase, carrega perfil do usuário
 */
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendError(res, 401, 'Token de autenticação não fornecido');
    }

    const token = authHeader.slice(7); // Remove "Bearer "

    // Verifica token no Supabase Auth
    const authUser = await verifySupabaseToken(token);
    if (!authUser) {
      return sendError(res, 401, 'Token inválido ou expirado');
    }

    // Carrega perfil completo do usuário (com plano, etc.)
    const userProfile = await getUserById(authUser.id);
    if (!userProfile) {
      return sendError(res, 401, 'Perfil de usuário não encontrado');
    }

    // Disponibiliza no request para rotas subsequentes
    req.user     = authUser;
    req.profile  = userProfile;

    next();
  } catch (err) {
    logger.error({ err }, 'requireAuth error');
    return sendError(res, 401, 'Erro de autenticação');
  }
}

/**
 * Middleware: Opcional — popula req.user se houver token válido
 * Não bloqueia se não autenticado
 */
async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user    = null;
      req.profile = null;
      return next();
    }

    const token    = authHeader.slice(7);
    const authUser = await verifySupabaseToken(token);

    if (authUser) {
      req.user    = authUser;
      req.profile = await getUserById(authUser.id);
    } else {
      req.user    = null;
      req.profile = null;
    }
    next();
  } catch {
    req.user    = null;
    req.profile = null;
    next();
  }
}

module.exports = { requireAuth, optionalAuth };
