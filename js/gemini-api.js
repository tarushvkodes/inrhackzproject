/**
 * Socratic — Client-Side Gemini API Service
 * Probes available models at setup time so we never pick one with zero quota.
 * Uses systemInstruction + multi-turn format to minimise tokens.
 */

const GeminiAPI = {
    // ─── Config ───
    _lastRequestTime: 0,
    _minRequestGap: 4000,       // 4 s between requests
    _requestQueue: Promise.resolve(),
    _maxHistory: 10,            // Only send last N conversation turns

    // Every model we might try, in preference order
    ALL_MODELS: [
        'gemini-2.5-flash-lite',
        'gemini-2.5-flash',
        'gemini-2.0-flash-lite',
        'gemini-2.0-flash',
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

    // ─── Model probing ───

    /**
     * Validate the API key AND probe which models actually have quota.
     * Returns { success, error?, workingModels? }
     */
    async validateApiKey(apiKey) {
        // First check the key is valid at all
        try {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
            if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                return { success: false, error: d?.error?.message || 'Invalid API key' };
            }
        } catch (e) {
            return { success: false, error: 'Network error. Check your connection.' };
        }

        // Now probe each model with a tiny request to see which ones work
        const workingModels = [];
        for (const model of this.ALL_MODELS) {
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
                const probeRes = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
                        generationConfig: { maxOutputTokens: 1 },
                    }),
                });
                if (probeRes.ok) {
                    workingModels.push(model);
                } else {
                    const err = await probeRes.json().catch(() => ({}));
                    const msg = err?.error?.message || '';
                    // If it's NOT a rate/quota error, the model might still work later
                    if (!msg.toLowerCase().includes('limit: 0') &&
                        !msg.toLowerCase().includes('quota') &&
                        probeRes.status !== 429) {
                        workingModels.push(model);
                    } else {
                        console.warn(`Model ${model} has no quota: ${msg}`);
                    }
                }
                // Small pause between probes to not hit rate limits during probing
                await new Promise(r => setTimeout(r, 1500));
            } catch (e) {
                // Network error during probe — assume model might work
                workingModels.push(model);
            }
        }

        if (workingModels.length === 0) {
            return {
                success: false,
                error: 'Your API key is valid but all models have zero quota. Try creating a new API key at aistudio.google.com/apikey, or wait for your daily quota to reset (midnight Pacific time).'
            };
        }

        // Save working models list
        localStorage.setItem('socratic_working_models', JSON.stringify(workingModels));

        return { success: true, workingModels };
    },

    /** Get models that were confirmed working during key validation. */
    _getWorkingModels() {
        try {
            const saved = localStorage.getItem('socratic_working_models');
            if (saved) return JSON.parse(saved);
        } catch (e) {}
        return this.ALL_MODELS; // fallback to trying everything
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

    async _rawFetch(model, apiKey, body) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
    },

    _buildBody(systemText, contents, temperature) {
        const body = {
            contents,
            generationConfig: {
                temperature,
                maxOutputTokens: 300,
                responseMimeType: 'application/json',
            },
        };
        if (systemText) {
            body.systemInstruction = { parts: [{ text: systemText }] };
        }
        return body;
    },

    /**
     * Core call: tries each working model in order.
     * On rate-limit → immediately skip to next model (no waiting).
     * On success → return.
     */
    async _callGemini(systemPrompt, contents, temperature = null) {
        const apiKey = Storage.getApiKey();
        if (!apiKey) return { success: false, error: 'API key not configured.' };

        const temp = temperature !== null ? temperature : Storage.getTemperature();
        const turns = Array.isArray(contents)
            ? contents
            : [{ role: 'user', parts: [{ text: contents }] }];
        const body = this._buildBody(systemPrompt, turns, temp);

        // Use working models list; put user's preferred model first
        const preferred = Storage.getModel();
        const working = this._getWorkingModels();
        const modelsToTry = [preferred, ...working.filter(m => m !== preferred)];

        return this._enqueue(async () => {
            let lastError = '';

            for (const model of modelsToTry) {
                try {
                    const res = await this._rawFetch(model, apiKey, body);

                    if (res.ok) {
                        const data = await res.json();
                        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                        const parsed = this._parseJSON(text);
                        if (model !== preferred) parsed._usedModel = model;
                        return { success: true, data: parsed };
                    }

                    const errData = await res.json().catch(() => ({}));
                    const errMsg = errData?.error?.message || `API error (${res.status})`;

                    if (this._isRateLimitError(res.status, errMsg)) {
                        // Don't wait — just try the next model immediately
                        console.warn(`${model} rate-limited, trying next model...`);
                        window.dispatchEvent(new CustomEvent('gemini-rate-limit', {
                            detail: { waitSeconds: 0, model, attempt: 1 }
                        }));
                        lastError = errMsg;
                        continue;
                    }

                    // Non-rate-limit error
                    return { success: false, error: errMsg };
                } catch (e) {
                    lastError = e.message || 'Network error.';
                    continue;
                }
            }

            // All models failed — give the user actionable advice
            return {
                success: false,
                error: `All models are rate-limited. This usually means your daily free-tier quota is used up.\n\nFix options:\n1. Wait until your quota resets (midnight Pacific time)\n2. Create a new API key at aistudio.google.com/apikey\n3. Enable billing on your Google Cloud project for higher limits\n\nLast error: ${lastError}`
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
        return this._callGemini(this.SOCRATIC_SYSTEM_PROMPT, prompt);
    },

    async continueDialogue(topic, conversationHistory, studentResponse) {
        const contents = [];
        const trimmed = conversationHistory.slice(-this._maxHistory);

        contents.push({ role: 'user', parts: [{ text: `Topic: ${topic}` }] });
        contents.push({ role: 'model', parts: [{ text: '{"question":"Let\'s explore this."}' }] });

        for (const entry of trimmed) {
            if (entry.role === 'assistant') {
                const q = typeof entry.content === 'object'
                    ? (entry.content.question || JSON.stringify(entry.content))
                    : String(entry.content);
                contents.push({ role: 'model', parts: [{ text: q }] });
            } else {
                contents.push({ role: 'user', parts: [{ text: String(entry.content) }] });
            }
        }
        contents.push({ role: 'user', parts: [{ text: studentResponse }] });

        return this._callGemini(this.SOCRATIC_SYSTEM_PROMPT, contents);
    },

    async getHint(topic, conversationHistory, currentQuestion) {
        const recent = conversationHistory.slice(-4);
        let ctx = `Topic: ${topic}\nQuestion: ${currentQuestion}\n`;
        for (const e of recent) {
            const r = e.role === 'assistant' ? 'Q' : 'A';
            const c = typeof e.content === 'string' ? e.content : (e.content.question || '');
            ctx += `${r}: ${c}\n`;
        }
        return this._callGemini(this.HINT_SYSTEM_PROMPT, ctx);
    },

    async generateSessionSummary(topic, conversationHistory) {
        const trimmed = conversationHistory.slice(-12);
        let ctx = `Topic: ${topic}\n`;
        for (const e of trimmed) {
            const r = e.role === 'assistant' ? 'Q' : 'A';
            const c = typeof e.content === 'object' ? (e.content.question || '') : String(e.content);
            ctx += `${r}: ${c}\n`;
        }
        return this._callGemini(this.SUMMARY_SYSTEM_PROMPT, ctx, 0.5);
    },

    async generateTopicSuggestions(interests) {
        const sys = 'Suggest 6 learning topics. JSON: {"suggestions":[{"topic":"","description":"","category":"","difficulty":"beginner|intermediate|advanced"}]}';
        const prompt = interests ? `Interests: ${interests}` : 'Mix of science, tech, philosophy, math, history.';
        return this._callGemini(sys, prompt, 0.9);
    },
};
