-- ============================================================
-- CONFLICT WATCH — Supabase Schema
-- Execute no SQL Editor do Supabase Dashboard
-- ============================================================

-- Habilitar extensões necessárias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── TABELA: users ────────────────────────────────────────────
-- Espelha auth.users do Supabase com dados extras do app
CREATE TABLE IF NOT EXISTS public.users (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT NOT NULL UNIQUE,
  full_name     TEXT,
  avatar_url    TEXT,
  plan          TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  
  -- Stripe
  stripe_customer_id      TEXT UNIQUE,
  stripe_subscription_id  TEXT UNIQUE,
  stripe_price_id         TEXT,
  subscription_status     TEXT DEFAULT 'inactive',
  subscription_ends_at    TIMESTAMPTZ,
  
  -- Limites de uso
  ai_analyses_today       INTEGER NOT NULL DEFAULT 0,
  ai_analyses_reset_at    TIMESTAMPTZ DEFAULT NOW(),
  
  -- Preferências
  preferred_language      TEXT DEFAULT 'pt' CHECK (preferred_language IN ('pt','en','es','ar','fa')),
  alert_email_enabled     BOOLEAN DEFAULT true,
  alert_telegram_enabled  BOOLEAN DEFAULT false,
  telegram_chat_id        TEXT,
  
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── TABELA: news_events ──────────────────────────────────────
-- Notícias classificadas pela IA
CREATE TABLE IF NOT EXISTS public.news_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title           TEXT NOT NULL,
  description     TEXT,
  url             TEXT UNIQUE,
  source          TEXT,
  published_at    TIMESTAMPTZ NOT NULL,
  
  -- Classificação IA
  category        TEXT CHECK (category IN ('military','nuclear','diplomatic','economic','cyber','other')),
  impact_score    NUMERIC(4,2) CHECK (impact_score >= 0 AND impact_score <= 10),
  is_critical     BOOLEAN NOT NULL DEFAULT false,
  ai_summary      TEXT,
  keywords        TEXT[],
  
  -- Tensão
  tension_delta   NUMERIC(4,2) DEFAULT 0,
  
  -- Idiomas
  title_en        TEXT,
  title_pt        TEXT,
  title_es        TEXT,
  title_ar        TEXT,
  title_fa        TEXT,
  
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── TABELA: tension_history ──────────────────────────────────
-- Histórico do índice de tensão ao longo do tempo
CREATE TABLE IF NOT EXISTS public.tension_history (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tension_value   NUMERIC(5,2) NOT NULL CHECK (tension_value >= 0 AND tension_value <= 100),
  delta           NUMERIC(4,2) DEFAULT 0,
  trigger_event_id UUID REFERENCES public.news_events(id),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── TABELA: alerts ───────────────────────────────────────────
-- Alertas críticos para usuários PRO
CREATE TABLE IF NOT EXISTS public.alerts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id        UUID REFERENCES public.news_events(id),
  title           TEXT NOT NULL,
  message         TEXT NOT NULL,
  severity        TEXT NOT NULL DEFAULT 'high' CHECK (severity IN ('medium','high','critical')),
  category        TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  
  -- Tracking de entrega
  notified_count  INTEGER DEFAULT 0,
  
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── TABELA: user_analyses ────────────────────────────────────
-- Log de análises IA feitas por usuários (para rate limiting e histórico)
CREATE TABLE IF NOT EXISTS public.user_analyses (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  query       TEXT NOT NULL,
  response    TEXT,
  language    TEXT DEFAULT 'pt',
  tokens_used INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── TABELA: alert_deliveries ─────────────────────────────────
-- Track de quais alertas foram entregues a quais usuários
CREATE TABLE IF NOT EXISTS public.alert_deliveries (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  alert_id    UUID NOT NULL REFERENCES public.alerts(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL DEFAULT 'realtime' CHECK (channel IN ('realtime','email','telegram')),
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(alert_id, user_id, channel)
);

-- ── TABELA: stripe_events ────────────────────────────────────
-- Log de todos os webhooks do Stripe (idempotência)
CREATE TABLE IF NOT EXISTS public.stripe_events (
  id            TEXT PRIMARY KEY, -- stripe event id
  type          TEXT NOT NULL,
  data          JSONB,
  processed     BOOLEAN DEFAULT false,
  processed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════
-- ÍNDICES para performance
-- ══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_news_events_published    ON public.news_events(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_events_critical     ON public.news_events(is_critical) WHERE is_critical = true;
CREATE INDEX IF NOT EXISTS idx_news_events_category     ON public.news_events(category);
CREATE INDEX IF NOT EXISTS idx_news_events_impact       ON public.news_events(impact_score DESC);
CREATE INDEX IF NOT EXISTS idx_tension_history_created  ON public.tension_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_active            ON public.alerts(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_user_analyses_user       ON public.user_analyses(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer    ON public.users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_plan               ON public.users(plan);

-- ══════════════════════════════════════════════════════════════
-- TRIGGERS
-- ══════════════════════════════════════════════════════════════

-- Auto-atualizar updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-criar perfil quando usuário se registra no Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Reset contagem de análises diárias (chamado pelo cron ou trigger)
CREATE OR REPLACE FUNCTION reset_daily_analyses()
RETURNS void AS $$
BEGIN
  UPDATE public.users
  SET ai_analyses_today = 0,
      ai_analyses_reset_at = NOW()
  WHERE ai_analyses_reset_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ══════════════════════════════════════════════════════════════
-- DADOS INICIAIS
-- ══════════════════════════════════════════════════════════════

-- Tensão inicial (baseline histórico)
INSERT INTO public.tension_history (tension_value, notes) VALUES
  (72, 'Baseline inicial — configuração do sistema'),
  (75, 'Enriquecimento uranio anunciado 84%'),
  (78, 'Reforço naval EUA no Golfo Pérsico'),
  (76, 'Negociações diplomáticas europeias'),
  (80, 'Teste míssil hipersônico Fattah'),
  (78, 'Atualização baseline — fev/2025')
ON CONFLICT DO NOTHING;
