/**
 * ConflictWatch — Frontend Auth Module
 * Gerencia autenticação via Supabase JS SDK
 * Incluir este arquivo em todas as páginas que precisam de auth
 */

// Importar via CDN no HTML:
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>

const SUPABASE_URL  = window.CW_CONFIG?.supabaseUrl  || '';
const SUPABASE_ANON = window.CW_CONFIG?.supabaseAnon || '';
const API_URL       = window.CW_CONFIG?.apiUrl        || 'http://localhost:3001';
const APP_URL       = window.CW_CONFIG?.appUrl        || 'http://localhost:3000';

// Inicializar cliente Supabase (apenas para auth client-side)
let _supabase = null;
function getSupabase() {
  if (!_supabase && window.supabase) {
    _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
  }
  return _supabase;
}

// ── Session Management ────────────────────────────────────────

const Auth = {
  /**
   * Retorna sessão atual (token, user)
   */
  async getSession() {
    const sb = getSupabase();
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data?.session || null;
  },

  /**
   * Retorna access token atual para requests à API
   */
  async getToken() {
    const session = await this.getSession();
    return session?.access_token || null;
  },

  /**
   * Retorna usuário logado ou null
   */
  async getUser() {
    const session = await this.getSession();
    return session?.user || null;
  },

  /**
   * Verifica se usuário está logado
   */
  async isLoggedIn() {
    return !!(await this.getToken());
  },

  /**
   * Login com email/senha (via backend)
   */
  async login(email, password) {
    const res = await apiPost('/api/auth/login', { email, password });
    if (res.success) {
      // Setar sessão no Supabase client
      const sb = getSupabase();
      if (sb) {
        await sb.auth.setSession({
          access_token:  res.data.access_token,
          refresh_token: res.data.refresh_token,
        });
      }
      // Guardar dados do usuário
      localStorage.setItem('cw_user', JSON.stringify(res.data.user));
    }
    return res;
  },

  /**
   * Registro com email/senha
   */
  async register(email, password, fullName) {
    return apiPost('/api/auth/register', { email, password, fullName });
  },

  /**
   * Login com Google (redireciona para OAuth)
   */
  async loginWithGoogle() {
    const res = await apiPost('/api/auth/google', {});
    if (res.success && res.data.url) {
      window.location.href = res.data.url;
    }
    return res;
  },

  /**
   * Logout
   */
  async logout() {
    try {
      const token = await this.getToken();
      if (token) await apiPost('/api/auth/logout', {}, token);
    } catch {}

    const sb = getSupabase();
    if (sb) await sb.auth.signOut();
    localStorage.removeItem('cw_user');

    window.location.href = `${APP_URL}/login.html`;
  },

  /**
   * Recuperação de senha
   */
  async forgotPassword(email) {
    return apiPost('/api/auth/forgot-password', { email });
  },

  /**
   * Busca perfil do usuário (com plano atual)
   */
  async getProfile() {
    const token = await this.getToken();
    if (!token) return null;
    const res = await apiGet('/api/auth/me', token);
    return res.success ? res.data : null;
  },

  /**
   * Redireciona para login se não autenticado
   */
  async requireAuth() {
    const loggedIn = await this.isLoggedIn();
    if (!loggedIn) {
      window.location.href = `${APP_URL}/login.html?redirect=${encodeURIComponent(window.location.href)}`;
      return false;
    }
    return true;
  },

  /**
   * Cache do perfil em memória (evitar requests repetidos)
   */
  _profileCache: null,
  _profileCacheTime: 0,

  async getCachedProfile() {
    const CACHE_TTL = 60 * 1000; // 1 minuto
    if (this._profileCache && Date.now() - this._profileCacheTime < CACHE_TTL) {
      return this._profileCache;
    }
    this._profileCache = await this.getProfile();
    this._profileCacheTime = Date.now();
    return this._profileCache;
  },

  invalidateCache() {
    this._profileCache = null;
    this._profileCacheTime = 0;
  },
};

// ── API Helpers ───────────────────────────────────────────────

async function apiGet(path, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { headers });
  return res.json();
}

async function apiPost(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, {
    method:  'POST',
    headers,
    body:    JSON.stringify(body),
  });
  return res.json();
}

// ── Supabase Realtime ─────────────────────────────────────────

const RealtimeManager = {
  _channels: {},

  /**
   * Subscreve em alertas críticos (PRO only — verificado no backend via RLS)
   */
  subscribeAlerts(onAlert) {
    const sb = getSupabase();
    if (!sb) return;

    if (this._channels.alerts) return; // já subscrito

    this._channels.alerts = sb
      .channel('public:alerts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'alerts' },
        (payload) => {
          onAlert(payload.new);
        }
      )
      .subscribe();
  },

  /**
   * Subscreve em novos eventos de notícias
   */
  subscribeEvents(onEvent) {
    const sb = getSupabase();
    if (!sb) return;

    if (this._channels.events) return;

    this._channels.events = sb
      .channel('public:news_events')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'news_events' },
        (payload) => {
          onEvent(payload.new);
        }
      )
      .subscribe();
  },

  /**
   * Subscreve em atualizações do índice de tensão
   */
  subscribeTension(onUpdate) {
    const sb = getSupabase();
    if (!sb) return;

    if (this._channels.tension) return;

    this._channels.tension = sb
      .channel('public:tension_history')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'tension_history' },
        (payload) => {
          onUpdate(payload.new);
        }
      )
      .subscribe();
  },

  unsubscribeAll() {
    const sb = getSupabase();
    if (!sb) return;
    Object.values(this._channels).forEach(ch => sb.removeChannel(ch));
    this._channels = {};
  },
};

// ── Stripe Integration ────────────────────────────────────────

const Billing = {
  /**
   * Inicia checkout para plano PRO
   */
  async startCheckout() {
    const token = await Auth.getToken();
    if (!token) {
      window.location.href = `${APP_URL}/login.html?redirect=${APP_URL}/pricing`;
      return;
    }

    const res = await apiPost('/api/stripe/checkout', {}, token);
    if (res.success && res.data.checkout_url) {
      window.location.href = res.data.checkout_url;
    } else {
      throw new Error(res.error || 'Erro ao iniciar checkout');
    }
  },

  /**
   * Abre portal de billing para gerenciar assinatura
   */
  async openPortal() {
    const token = await Auth.getToken();
    const res   = await apiPost('/api/stripe/portal', {}, token);
    if (res.success && res.data.portal_url) {
      window.location.href = res.data.portal_url;
    } else {
      throw new Error(res.error || 'Erro ao abrir portal');
    }
  },

  /**
   * Busca status da assinatura atual
   */
  async getSubscription() {
    const token = await Auth.getToken();
    if (!token) return null;
    const res = await apiGet('/api/stripe/subscription', token);
    return res.success ? res.data : null;
  },
};

// ── Exportar globalmente ──────────────────────────────────────
window.CW = {
  Auth,
  Billing,
  RealtimeManager,
  apiGet,
  apiPost,
  API_URL,
  APP_URL,
};
