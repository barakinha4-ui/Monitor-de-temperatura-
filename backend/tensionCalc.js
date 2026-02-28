'use strict';

// ── Scores por categoria de evento ───────────────────────────
const CATEGORY_SCORES = {
  military:    8,  // ataque, míssil, confronto
  nuclear:     6,  // enriquecimento, teste nuclear
  economic:    5,  // sanções, embargo
  cyber:       4,  // ataque cibernético
  diplomatic:  3,  // ruptura, expulsão de embaixador
  other:       1,
};

// ── Palavras-chave de alta tensão (multiplicador) ─────────────
const CRITICAL_KEYWORDS = [
  'strike', 'attack', 'missile', 'launched', 'fired', 'bomb',
  'retaliation', 'war', 'invasion', 'nuclear weapon', 'warhead',
  'ataque', 'míssil', 'guerra', 'bomba', 'retaliação',
  'ضربة', 'صاروخ', 'حرب',
];

// ── Palavras-chave de de-escalada (redutor) ───────────────────
const DEESCALATION_KEYWORDS = [
  'negotiation', 'agreement', 'deal', 'ceasefire', 'diplomacy',
  'talks', 'peace', 'accord', 'dialogue',
  'negociação', 'acordo', 'cessar-fogo', 'diplomacia', 'paz',
];

/**
 * Calcula delta de tensão baseado no evento
 * @param {string} category  - categoria do evento
 * @param {number} aiScore   - score 0-10 retornado pela IA
 * @param {string} title     - título do evento (para keyword check)
 * @returns {number} delta de tensão (-10 a +10)
 */
function calculateTensionDelta(category, aiScore, title = '') {
  const titleLower = title.toLowerCase();

  // Score base por categoria
  const baseScore = CATEGORY_SCORES[category] || 1;

  // Normalizar aiScore (0-10) para multiplicador (0.5 - 1.5)
  const aiMultiplier = 0.5 + (aiScore / 10);

  let delta = baseScore * aiMultiplier;

  // Bonus para palavras-chave críticas
  const hasCritical = CRITICAL_KEYWORDS.some(kw => titleLower.includes(kw));
  if (hasCritical) delta *= 1.3;

  // Redução para de-escalada
  const hasDeescalation = DEESCALATION_KEYWORDS.some(kw => titleLower.includes(kw));
  if (hasDeescalation) delta *= -0.5; // Vai na direção oposta

  // Arredondar para 2 casas
  return Math.round(delta * 100) / 100;
}

/**
 * Aplica delta ao valor atual de tensão com limites
 * @param {number} current  - tensão atual (0-100)
 * @param {number} delta    - variação calculada
 * @returns {number} novo valor de tensão
 */
function applyTensionDelta(current, delta) {
  const newValue = current + delta;
  // Clampar entre 0 e 100, com tendência de retorno ao baseline
  const BASELINE = 60;
  const GRAVITY  = 0.02; // tensão "decai" levemente para baseline

  const withGravity = newValue + (BASELINE - newValue) * GRAVITY;
  return Math.min(100, Math.max(0, Math.round(withGravity * 100) / 100));
}

/**
 * Classifica nível de tensão por faixa
 */
function classifyTensionLevel(value) {
  if (value >= 90) return { level: 'critical', label: 'CRÍTICO', color: '#ff2222' };
  if (value >= 75) return { level: 'high',     label: 'ELEVADO', color: '#ff6a00' };
  if (value >= 55) return { level: 'moderate', label: 'MODERADO', color: '#ffb700' };
  if (value >= 35) return { level: 'low',      label: 'BAIXO',   color: '#88cc44' };
  return                  { level: 'stable',   label: 'ESTÁVEL', color: '#00ff88' };
}

/**
 * Verifica se evento deve gerar alerta crítico
 */
function shouldTriggerAlert(event) {
  const ALERT_KEYWORDS = [
    'strike', 'missile', 'retaliation', 'attack', 'nuclear weapon',
    'enrichment above 80', 'warship', 'blockade', 'explosion',
    'ataque', 'míssil', 'retaliação', 'bloqueio',
  ];

  const text = `${event.title} ${event.description || ''}`.toLowerCase();
  return (
    event.impact_score >= 8 ||
    ALERT_KEYWORDS.some(kw => text.includes(kw))
  );
}

module.exports = {
  calculateTensionDelta,
  applyTensionDelta,
  classifyTensionLevel,
  shouldTriggerAlert,
  CATEGORY_SCORES,
};
