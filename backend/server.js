'use strict';

require('dotenv').config();
const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const pinoHttp   = require('pino-http');
const logger = require('./logger')
const { globalRateLimit } = require('./middleware/rateLimit');

// ── Routes ────────────────────────────────────────────────────
const authRoutes     = require('./routes/auth');
const analysisRoutes = require('./routes/analysis');
const eventsRoutes   = require('./routes/events');
const tensionRoutes  = require('./routes/tension');
const alertsRoutes   = require('./routes/alerts');
const stripeRoutes   = require('./routes/stripe');
const exportRoutes   = require('./routes/export');

// ── Cron Job ──────────────────────────────────────────────────
const { startNewsCron } = require('./jobs/newsCron');

const app  = express();
const PORT = process.env.PORT || 3001;

// ══════════════════════════════════════════════════════════════
// MIDDLEWARES GLOBAIS
// ══════════════════════════════════════════════════════════════

// Segurança: HTTP headers
app.use(helmet({
  contentSecurityPolicy: false, // configurar por rota se necessário
  crossOriginEmbedderPolicy: false,
}));

// CORS — apenas origens permitidas
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map(o => o.trim());

app.use(cors({
  origin: (origin, callback) => {
    // Permitir requests sem origin (mobile apps, curl, etc)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS bloqueado para origem: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
}));

// Logs estruturados HTTP
app.use(pinoHttp({ logger }));

// Rate limit global (proteção DDoS)
app.use(globalRateLimit);

// Body parsers
// IMPORTANTE: Stripe webhook precisa do raw body — definido ANTES do json()
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// ══════════════════════════════════════════════════════════════
// HEALTH CHECK
// ══════════════════════════════════════════════════════════════
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'conflictwatch-api',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
  });
});

// ══════════════════════════════════════════════════════════════
// ROTAS API
// ══════════════════════════════════════════════════════════════
app.use('/api/auth',     authRoutes);
app.use('/api/analysis', analysisRoutes);
app.use('/api/events',   eventsRoutes);
app.use('/api/tension',  tensionRoutes);
app.use('/api/alerts',   alertsRoutes);
app.use('/api/stripe',   stripeRoutes);
app.use('/api/export',   exportRoutes);

// ══════════════════════════════════════════════════════════════
// ERROR HANDLER GLOBAL
// ══════════════════════════════════════════════════════════════
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Log do erro
  req.log.error({ err, path: req.path }, 'Unhandled error');

  // Não expor detalhes de erro em produção
  const statusCode = err.statusCode || err.status || 500;
  const message    = process.env.NODE_ENV === 'production'
    ? (statusCode < 500 ? err.message : 'Internal server error')
    : err.message;

  res.status(statusCode).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

// ══════════════════════════════════════════════════════════════
// START
// ══════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  logger.info({ port: PORT, env: process.env.NODE_ENV }, '◈ ConflictWatch API running');

  // Iniciar cron job de notícias
  if (process.env.NODE_ENV !== 'test') {
    startNewsCron();
    logger.info('◈ News cron job started');
  }
});

module.exports = app; // para testes
