'use strict';

const validator = require('validator');

/**
 * Sanitiza string: remove HTML, trim, limita tamanho
 */
function sanitizeString(input, maxLength = 500) {
  if (typeof input !== 'string') return '';
  return validator.escape(input.trim()).slice(0, maxLength);
}

/**
 * Valida e sanitiza email
 */
function sanitizeEmail(email) {
  if (typeof email !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  if (!validator.isEmail(trimmed)) return null;
  return validator.normalizeEmail(trimmed);
}

/**
 * Valida UUID v4
 */
function isValidUUID(uuid) {
  return validator.isUUID(uuid, 4);
}

/**
 * Sanitiza query de análise IA
 * Remove conteúdo que poderia ser prompt injection
 */
function sanitizeAIQuery(query) {
  if (typeof query !== 'string') return '';

  // Limitar tamanho
  let cleaned = query.trim().slice(0, 1000);

  // Remover tentativas de prompt injection óbvias
  const injectionPatterns = [
    /ignore previous instructions/gi,
    /system:/gi,
    /\[INST\]/gi,
    /<\|.*?\|>/g,
    /###\s*(instruction|system|assistant)/gi,
  ];

  for (const pattern of injectionPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  return cleaned.trim();
}

/**
 * Valida idioma suportado
 */
function validateLanguage(lang) {
  const supported = ['pt', 'en', 'es', 'ar', 'fa'];
  return supported.includes(lang) ? lang : 'pt';
}

/**
 * Sanitiza número dentro de um range
 */
function sanitizeNumber(value, min, max, defaultVal) {
  const num = Number(value);
  if (isNaN(num)) return defaultVal;
  return Math.min(Math.max(num, min), max);
}

module.exports = {
  sanitizeString,
  sanitizeEmail,
  isValidUUID,
  sanitizeAIQuery,
  validateLanguage,
  sanitizeNumber,
};
