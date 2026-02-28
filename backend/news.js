'use strict';

const logger = require('../utils/logger');

// Palavras-chave para busca de notícias relevantes
const SEARCH_KEYWORDS = [
  'Iran USA conflict',
  'Iran nuclear program',
  'Iran sanctions',
  'Strait of Hormuz',
  'Iran missile',
  'IRGC',
  'JCPOA nuclear deal',
];

/**
 * Busca notícias via NewsAPI (primary)
 * Docs: https://newsapi.org/docs
 */
async function fetchFromNewsAPI(keyword) {
  const url = new URL('https://newsapi.org/v2/everything');
  url.searchParams.set('q',          keyword);
  url.searchParams.set('language',   'en');
  url.searchParams.set('sortBy',     'publishedAt');
  url.searchParams.set('pageSize',   '10');
  url.searchParams.set('from',       getYesterdayISO());
  url.searchParams.set('apiKey',     process.env.NEWS_API_KEY);

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': 'ConflictWatch/1.0' },
    signal:  AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    logger.warn({ status: res.status, keyword }, 'NewsAPI request failed');
    return [];
  }

  const data = await res.json();
  if (data.status !== 'ok') return [];

  return (data.articles || []).map(article => ({
    title:        article.title,
    description:  article.description,
    url:          article.url,
    source:       article.source?.name || 'Unknown',
    published_at: article.publishedAt,
  })).filter(a => a.title && a.url);
}

/**
 * Busca notícias via GNews (backup)
 * Docs: https://gnews.io/docs
 */
async function fetchFromGNews(keyword) {
  const url = new URL('https://gnews.io/api/v4/search');
  url.searchParams.set('q',        keyword);
  url.searchParams.set('lang',     'en');
  url.searchParams.set('max',      '10');
  url.searchParams.set('sortby',   'publishedAt');
  url.searchParams.set('token',    process.env.GNEWS_API_KEY);

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    logger.warn({ status: res.status, keyword }, 'GNews request failed');
    return [];
  }

  const data = await res.json();

  return (data.articles || []).map(article => ({
    title:        article.title,
    description:  article.description,
    url:          article.url,
    source:       article.source?.name || 'Unknown',
    published_at: article.publishedAt,
  })).filter(a => a.title && a.url);
}

/**
 * Busca todas as notícias relevantes (tenta NewsAPI, fallback GNews)
 * Remove duplicatas por URL
 */
async function fetchLatestNews() {
  const allArticles = new Map(); // url -> article

  for (const keyword of SEARCH_KEYWORDS) {
    try {
      let articles = [];

      // Tentar NewsAPI primeiro
      if (process.env.NEWS_API_KEY) {
        articles = await fetchFromNewsAPI(keyword);
      }

      // Fallback para GNews
      if (articles.length === 0 && process.env.GNEWS_API_KEY) {
        articles = await fetchFromGNews(keyword);
      }

      for (const article of articles) {
        if (!allArticles.has(article.url)) {
          allArticles.set(article.url, article);
        }
      }

      // Respeitar rate limits das APIs
      await sleep(300);

    } catch (err) {
      logger.error({ err, keyword }, 'fetchLatestNews error');
    }
  }

  const results = Array.from(allArticles.values());
  logger.info({ count: results.length }, 'News fetched');
  return results;
}

// ── Helpers ───────────────────────────────────────────────────
function getYesterdayISO() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { fetchLatestNews };
