const model = process.env.OPENAI_MODEL?.trim() || 'gpt-5.6-terra';
const responseTimeout = 10 * 60 * 1000;
const openAiConfigured = () => Boolean(process.env.OPENAI_API_KEY?.trim());

module.exports = { model, openAiConfigured, responseTimeout };
