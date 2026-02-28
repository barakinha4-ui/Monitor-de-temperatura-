'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const logger    = require('../utils/logger');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = 'claude-sonnet-4-20250514';

// ── System prompts por idioma ─────────────────────────────────
const SYSTEM_PROMPTS = {
  pt: `Você é um analista de inteligência geopolítica sênior especializado no conflito Irã × EUA. 
Responda em português brasileiro de forma técnica, objetiva e concisa, como um briefing de inteligência militar.
Baseie-se em eventos históricos verificáveis e contexto geopolítico até início de 2026.
Não invente dados. Se incerto, indique claramente.
Máximo 400 palavras por resposta.`,

  en: `You are a senior geopolitical intelligence analyst specializing in the Iran × USA conflict.
Respond in English with technical, objective, and concise language, like a military intelligence briefing.
Base your analysis on verifiable historical events and geopolitical context through early 2026.
Do not fabricate data. If uncertain, clearly indicate so.
Maximum 400 words per response.`,

  es: `Eres un analista de inteligencia geopolítica senior especializado en el conflicto Irán × EE.UU.
Responde en español con lenguaje técnico, objetivo y conciso, como un briefing de inteligencia militar.
Basa tu análisis en eventos históricos verificables y contexto geopolítico hasta principios de 2026.
No inventes datos. Si tienes incertidumbre, indícalo claramente.
Máximo 400 palabras por respuesta.`,

  ar: `أنت محلل استخباراتي جيوسياسي متخصص في النزاع الإيراني الأمريكي.
أجب باللغة العربية بلغة تقنية وموضوعية وموجزة، مثل تقرير الاستخبارات العسكرية.
اعتمد على الأحداث التاريخية القابلة للتحقق والسياق الجيوسياسي حتى مطلع عام 2026.
لا تختلق بيانات. إذا كنت غير متأكد، فأشر إلى ذلك بوضوح.
بحد أقصى 400 كلمة لكل رد.`,

  fa: `شما یک تحلیلگر ارشد اطلاعات ژئوپلیتیک متخصص در درگیری ایران و آمریکا هستید.
به فارسی با زبانی تکنیکال، عینی و مختصر، مانند یک گزارش اطلاعاتی نظامی پاسخ دهید.
تحلیل خود را بر اساس رویدادهای تاریخی قابل تأیید و زمینه ژئوپلیتیک تا اوایل ۲۰۲۶ قرار دهید.
داده ها را جعل نکنید. اگر مطمئن نیستید، به وضوح ذکر کنید.
حداکثر ۴۰۰ کلمه در هر پاسخ.`,
};

/**
 * Análise geopolítica para o usuário
 */
async function analyzeGeopolitical(query, language = 'pt') {
  const systemPrompt = SYSTEM_PROMPTS[language] || SYSTEM_PROMPTS.pt;

  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: 800,
    system:     systemPrompt,
    messages: [{ role: 'user', content: query }],
  });

  return {
    text:        response.content[0].text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    totalTokens: response.usage.input_tokens + response.usage.output_tokens,
  };
}

/**
 * Classifica uma notícia e retorna categoria + score de impacto
 * Usado pelo cron job de notícias
 */
async function classifyNewsEvent(title, description) {
  const prompt = `Classifique esta notícia sobre o conflito Irã/EUA/Oriente Médio:

Título: ${title}
Descrição: ${description || 'N/A'}

Retorne APENAS um JSON válido (sem markdown) com este formato exato:
{
  "category": "military|nuclear|diplomatic|economic|cyber|other",
  "impact_score": <número de 0.0 a 10.0>,
  "is_critical": <true|false>,
  "summary_pt": "<resumo em português, max 100 chars>",
  "summary_en": "<summary in English, max 100 chars>",
  "keywords": ["keyword1", "keyword2", "keyword3"]
}

Critérios de impact_score:
- 9-10: ataque militar direto, arma nuclear
- 7-8: teste de míssil, sanções massivas, ataque cibernético grave
- 5-6: enriquecimento nuclear, movimentação de tropas, ruptura diplomática
- 3-4: novas sanções menores, declarações hostis
- 1-2: declarações políticas rotineiras
- 0: irrelevante para o conflito`;

  try {
    const response = await client.messages.create({
      model:      MODEL,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw    = response.content[0].text.trim();
    const cleaned = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    logger.error({ err, title }, 'classifyNewsEvent parse error');
    // Fallback seguro
    return {
      category:    'other',
      impact_score: 3,
      is_critical:  false,
      summary_pt:   title.slice(0, 100),
      summary_en:   title.slice(0, 100),
      keywords:     [],
    };
  }
}

/**
 * Traduz título de notícia para múltiplos idiomas
 */
async function translateNewsTitle(titleEn) {
  const prompt = `Traduza este título de notícia para os idiomas solicitados.
Retorne APENAS JSON válido (sem markdown):

Título em inglês: "${titleEn}"

{
  "pt": "<tradução em português>",
  "es": "<traducción en español>",
  "ar": "<الترجمة بالعربية>",
  "fa": "<ترجمه به فارسی>"
}`;

  try {
    const response = await client.messages.create({
      model:      MODEL,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw     = response.content[0].text.trim();
    const cleaned = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    logger.error({ err }, 'translateNewsTitle error');
    return { pt: titleEn, es: titleEn, ar: titleEn, fa: titleEn };
  }
}

module.exports = {
  analyzeGeopolitical,
  classifyNewsEvent,
  translateNewsTitle,
};
