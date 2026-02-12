/**
 * Socratic — Client-Side OpenRouter API Service
 * Uses OpenRouter (OpenAI-compatible) endpoint with model fallback + retry.
 */

const GeminiAPI = {
    // ─── Config ───
    _lastRequestTime: 0,
    _minRequestGap: 1000,       // 1 s between requests
    _requestQueue: Promise.resolve(),
    _maxHistory: 10,            // Only send last N conversation turns
    _maxRetries: 3,             // Retries per model on rate-limit
    _baseBackoff: 2000,         // 2 s initial backoff

    OPENROUTER_URL: 'https://openrouter.ai/api/v1/chat/completions',

    // Models to try, in preference order
    ALL_MODELS: [
        'google/gemini-2.5-flash',
        'meta-llama/llama-3.3-70b-instruct:free',
        'mistralai/mistral-small-3.1-24b-instruct:free',
        'google/gemma-3-27b-it:free',
    ],

    // ─── System Prompts (compact) ───

    SOCRATIC_SYSTEM_PROMPT: `You are Socratic. NEVER give direct answers. Guide via questions only.
If correct go deeper. If wrong probe the flaw. If stuck simplify.
Respond ONLY with this JSON:
{"question":"","thinking":"","understanding_signals":{"correct_insights":[],"misconceptions":[],"gaps":[]},"understanding_score":0,"difficulty_level":"foundational","hint_available":true,"encouragement":""}
understanding_score: 0-100. difficulty_level: foundational|intermediate|advanced|mastery.
Progress difficulty as student improves. Be warm but rigorous.`,

    HINT_SYSTEM_PROMPT: `Give a 1-2 sentence HINT (not answer). JSON only: {"hint":"your hint"}`,

    SUMMARY_SYSTEM_PROMPT: `Summarize this learning session. JSON only:
{"topic_summary":"","key_discoveries":[],"misconceptions_addressed":[],"remaining_gaps":[],"overall_understanding":0,"recommended_next_topics":[],"learning_style_notes":"","time_well_spent_score":0}
Scores 0-100.`,

    // ─── API Key Validation ───

    async validateApiKey(apiKey) {
        try {
            // Quick validation: make a tiny request to OpenRouter
            const res = await fetch(this.OPENROUTER_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': window.location.origin,
                    'X-Title': 'Socratic Learning App',
                },
                body: JSON.stringify({
                    model: this.ALL_MODELS[0],
                    messages: [{ role: 'user', content: 'Hi' }],
                    max_tokens: 1,
                }),
            });

            if (res.ok) {
                return { success: true };
            }

            const errData = await res.json().catch(() => ({}));
            const errMsg = errData?.error?.message || `API error (${res.status})`;

            if (res.status === 401) {
                return { success: false, error: 'Invalid API key. Check your key at openrouter.ai/keys' };
            }
            if (res.status === 402) {
                return { success: false, error: 'No credits remaining. Add credits at openrouter.ai' };
            }

            // Rate limit during validation is fine — key is valid
            if (res.status === 429) {
                return { success: true };
            }

            return { success: false, error: errMsg };
        } catch (e) {
            return { success: false, error: 'Network error. Check your connection.' };
        }
    },

    // ─── Internals ───

    _enqueue(fn) {
        this._requestQueue = this._requestQueue.then(async () => {
            const now = Date.now();
            const wait = this._minRequestGap - (now - this._lastRequestTime);
            if (wait > 0) await new Promise(r => setTimeout(r, wait));
            this._lastRequestTime = Date.now();
            return fn();
        });
        return this._requestQueue;
    },

    _isRateLimitError(status, msg) {
        if (status === 429) return true;
        if (typeof msg === 'string') {
            const l = msg.toLowerCase();
            return l.includes('quota') || l.includes('rate') || l.includes('resource_exhausted');
        }
        return false;
    },

    async _rawFetch(model, apiKey, messages, temperature, maxTokens) {
        return fetch(this.OPENROUTER_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': window.location.origin,
                'X-Title': 'Socratic Learning App',
            },
            body: JSON.stringify({
                model,
                messages,
                temperature,
                max_tokens: maxTokens || 1024,
                response_format: { type: 'json_object' },
            }),
        });
    },

    /**
     * Build the messages array (OpenAI format) from system prompt + user content.
     */
    _buildMessages(systemPrompt, contents) {
        const msgs = [];
        if (systemPrompt) {
            msgs.push({ role: 'system', content: systemPrompt });
        }
        if (Array.isArray(contents)) {
            // Multi-turn conversation
            for (const turn of contents) {
                msgs.push(turn);
            }
        } else {
            msgs.push({ role: 'user', content: String(contents) });
        }
        return msgs;
    },

    /**
     * Core call: tries each model with retries + exponential backoff.
     */
    async _callAPI(systemPrompt, contents, temperature = null) {
        const apiKey = Storage.getApiKey();
        if (!apiKey) return { success: false, error: 'API key not configured.' };

        const temp = temperature !== null ? temperature : Storage.getTemperature();
        const messages = this._buildMessages(systemPrompt, contents);

        const modelsToTry = [...this.ALL_MODELS];

        return this._enqueue(async () => {
            let lastError = '';

            for (const model of modelsToTry) {
                for (let attempt = 1; attempt <= this._maxRetries; attempt++) {
                    try {
                        const res = await this._rawFetch(model, apiKey, messages, temp);

                        if (res.ok) {
                            const data = await res.json();
                            const text = data?.choices?.[0]?.message?.content || '';
                            const parsed = this._parseJSON(text);
                            return { success: true, data: parsed };
                        }

                        const errData = await res.json().catch(() => ({}));
                        const errMsg = errData?.error?.message || `API error (${res.status})`;

                        if (this._isRateLimitError(res.status, errMsg)) {
                            lastError = errMsg;

                            if (attempt < this._maxRetries) {
                                const wait = this._baseBackoff * Math.pow(2, attempt - 1);
                                console.warn(`${model} rate-limited (attempt ${attempt}/${this._maxRetries}). Retrying in ${wait}ms...`);
                                window.dispatchEvent(new CustomEvent('gemini-rate-limit', {
                                    detail: { waitSeconds: Math.ceil(wait / 1000), model, attempt }
                                }));
                                await new Promise(r => setTimeout(r, wait));
                                continue;
                            }

                            console.warn(`${model} exhausted after ${this._maxRetries} retries, trying next model...`);
                            break;
                        }

                        // Non-rate-limit error — don't retry
                        return { success: false, error: errMsg };
                    } catch (e) {
                        lastError = e.message || 'Network error.';
                        if (attempt < this._maxRetries) {
                            const wait = this._baseBackoff * Math.pow(2, attempt - 1);
                            await new Promise(r => setTimeout(r, wait));
                            continue;
                        }
                        break;
                    }
                }
            }

            return {
                success: false,
                error: `All models are rate-limited or unavailable.\n\nFix options:\n1. Wait a minute and try again\n2. Check your credits at openrouter.ai\n3. Try a different API key\n\nLast error: ${lastError}`
            };
        });
    },

    _parseJSON(text) {
        let c = text.trim();
        if (c.startsWith('```')) c = c.substring(c.indexOf('\n') + 1);
        if (c.endsWith('```')) c = c.slice(0, -3).trim();
        return JSON.parse(c);
    },

    // ─── Public Methods ───

    async startSession(topic, context) {
        const prompt = `Topic: ${topic}\nContext: ${context || 'None'}\nAsk one foundational question to gauge what I know. Do NOT explain the topic.`;
        return this._callAPI(this.SOCRATIC_SYSTEM_PROMPT, prompt);
    },

    async continueDialogue(topic, conversationHistory, studentResponse) {
        const messages = [];
        const trimmed = conversationHistory.slice(-this._maxHistory);

        messages.push({ role: 'user', content: `Topic: ${topic}` });
        messages.push({ role: 'assistant', content: '{"question":"Let\'s explore this."}' });

        for (const entry of trimmed) {
            if (entry.role === 'assistant') {
                const q = typeof entry.content === 'object'
                    ? (entry.content.question || JSON.stringify(entry.content))
                    : String(entry.content);
                messages.push({ role: 'assistant', content: q });
            } else {
                messages.push({ role: 'user', content: String(entry.content) });
            }
        }
        messages.push({ role: 'user', content: studentResponse });

        return this._callAPI(this.SOCRATIC_SYSTEM_PROMPT, messages);
    },

    async getHint(topic, conversationHistory, currentQuestion) {
        const recent = conversationHistory.slice(-4);
        let ctx = `Topic: ${topic}\nQuestion: ${currentQuestion}\n`;
        for (const e of recent) {
            const r = e.role === 'assistant' ? 'Q' : 'A';
            const c = typeof e.content === 'string' ? e.content : (e.content.question || '');
            ctx += `${r}: ${c}\n`;
        }
        return this._callAPI(this.HINT_SYSTEM_PROMPT, ctx);
    },

    async generateSessionSummary(topic, conversationHistory) {
        const trimmed = conversationHistory.slice(-12);
        let ctx = `Topic: ${topic}\n`;
        for (const e of trimmed) {
            const r = e.role === 'assistant' ? 'Q' : 'A';
            const c = typeof e.content === 'object' ? (e.content.question || '') : String(e.content);
            ctx += `${r}: ${c}\n`;
        }
        return this._callAPI(this.SUMMARY_SYSTEM_PROMPT, ctx, 0.5);
    },

    async generateTopicSuggestions(interests) {
        const sys = 'Suggest 6 learning topics. JSON: {"suggestions":[{"topic":"","description":"","category":"","difficulty":"beginner|intermediate|advanced"}]}';
        const prompt = interests ? `Interests: ${interests}` : 'Mix of science, tech, philosophy, math, history.';
        return this._callAPI(sys, prompt, 0.9);
    },
};
