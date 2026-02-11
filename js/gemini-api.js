/**
 * Socratic — Client-Side Gemini API Service
 * Calls Google Gemini REST API directly from the browser.
 * Replaces the server-side ai_service.py.
 */

const GeminiAPI = {
    // ─── System Prompts ───

    SOCRATIC_SYSTEM_PROMPT: `You are Socratic, an AI learning companion that NEVER gives direct answers.
You implement the Socratic method: you guide students to discover understanding through carefully crafted questions.

## YOUR CORE RULES:
1. NEVER directly answer a student's question or explain a concept outright.
2. ALWAYS respond with a guiding question that leads the student closer to understanding.
3. If a student gives a correct insight, acknowledge it briefly and push deeper with a harder question.
4. If a student reveals a misconception, gently probe it with a question that exposes the flaw.
5. If a student is stuck, break the problem into a simpler sub-question.
6. Track the student's understanding level throughout the conversation.

## YOUR RESPONSE FORMAT (strict JSON):
{
    "question": "Your Socratic question to the student",
    "thinking": "Brief internal reasoning about the student's current understanding (hidden from student)",
    "understanding_signals": {
        "correct_insights": ["list of correct things the student has demonstrated"],
        "misconceptions": ["list of misconceptions detected"],
        "gaps": ["knowledge gaps still to be explored"]
    },
    "understanding_score": 0,
    "difficulty_level": "foundational",
    "hint_available": true,
    "encouragement": "A brief encouraging note about their progress (1 sentence max)"
}

understanding_score is an integer from 0 to 100.
difficulty_level is one of: foundational, intermediate, advanced, mastery.

## DIFFICULTY PROGRESSION:
- foundational: Basic recall and definition-level questions
- intermediate: Application and analysis questions
- advanced: Synthesis and evaluation questions
- mastery: Questions requiring transfer to novel contexts

## IMPORTANT BEHAVIORS:
- Start with foundational questions to gauge baseline understanding
- Progressively increase difficulty as the student demonstrates understanding
- If the student answers 3+ questions correctly at a level, move to the next
- If the student struggles, decompose into simpler sub-questions
- Be warm but intellectually rigorous
- Keep questions concise and focused
- Reference the student's previous answers to build continuity`,

    HINT_SYSTEM_PROMPT: `You are providing a HINT (not an answer) to help a stuck student.
The hint should:
1. Point them in the right direction without giving the full answer
2. Reference something they might already know
3. Suggest an analogy or simpler related concept
4. Be 1-2 sentences maximum

Respond with valid JSON only: {"hint": "your hint text"}`,

    SUMMARY_SYSTEM_PROMPT: `You are summarizing a Socratic learning session.
Analyze the conversation and provide a comprehensive learning summary.

Respond with valid JSON only:
{
    "topic_summary": "What the session covered (2-3 sentences)",
    "key_discoveries": ["Things the student discovered through questioning"],
    "misconceptions_addressed": ["Misconceptions that were identified and corrected"],
    "remaining_gaps": ["Areas that still need exploration"],
    "overall_understanding": 0,
    "recommended_next_topics": ["Topics to explore next"],
    "learning_style_notes": "Observations about how this student learns best (1-2 sentences)",
    "time_well_spent_score": 0
}

overall_understanding and time_well_spent_score are integers from 0 to 100.`,

    // ─── Core API Call ───

    async _callGemini(systemPrompt, userPrompt, temperature = null) {
        const apiKey = Storage.getApiKey();
        if (!apiKey) {
            return { success: false, error: 'API key not configured. Please set your Gemini API key in Settings.' };
        }

        const model = Storage.getModel();
        const temp = temperature !== null ? temperature : Storage.getTemperature();
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const body = {
            contents: [{
                parts: [{ text: systemPrompt + '\n\n---\n\n' + userPrompt }]
            }],
            generationConfig: {
                temperature: temp,
                topP: 0.95,
                maxOutputTokens: 1024,
                responseMimeType: 'application/json',
            }
        };

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                const msg = errData?.error?.message || `API error (${res.status})`;
                return { success: false, error: msg };
            }

            const data = await res.json();
            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const parsed = this._parseJSON(text);
            return { success: true, data: parsed };
        } catch (e) {
            return { success: false, error: e.message || 'Network error calling Gemini API.' };
        }
    },

    _parseJSON(text) {
        let cleaned = text.trim();
        if (cleaned.startsWith('```')) {
            const firstNL = cleaned.indexOf('\n');
            cleaned = cleaned.substring(firstNL + 1);
        }
        if (cleaned.endsWith('```')) {
            cleaned = cleaned.slice(0, -3).trim();
        }
        return JSON.parse(cleaned);
    },

    // ─── Public Methods ───

    async validateApiKey(apiKey) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
        try {
            const res = await fetch(url);
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                return { success: false, error: errData?.error?.message || 'Invalid API key' };
            }
            return { success: true };
        } catch (e) {
            return { success: false, error: 'Network error. Check your connection.' };
        }
    },

    async startSession(topic, context) {
        const userPrompt = `A student wants to learn about: ${topic}\n\nAdditional context from the student: ${context || 'None provided'}\n\nBegin the Socratic dialogue. Start with a foundational question to gauge their current understanding of this topic. Remember: do NOT explain the topic - ask a question that reveals what they already know.`;
        return this._callGemini(this.SOCRATIC_SYSTEM_PROMPT, userPrompt);
    },

    async continueDialogue(topic, conversationHistory, studentResponse) {
        const parts = [this.SOCRATIC_SYSTEM_PROMPT, '\n---\n'];
        parts.push(`Topic being explored: ${topic}\n`);

        for (const entry of conversationHistory) {
            if (entry.role === 'assistant') {
                const content = entry.content;
                if (typeof content === 'object') {
                    parts.push(`Socratic (you previously asked): ${content.question || ''}`);
                } else {
                    parts.push(`Socratic (you previously asked): ${content}`);
                }
            } else {
                parts.push(`Student responded: ${entry.content}`);
            }
        }

        parts.push(`\nStudent's latest response: ${studentResponse}`);
        parts.push('\nAnalyze their response for understanding, misconceptions, and gaps. Then ask your next Socratic question. Remember: NEVER give the answer directly. Respond with valid JSON only.');

        const fullPrompt = parts.join('\n');

        try {
            const model = Storage.getModel();
            const temp = Storage.getTemperature();
            const apiKey = Storage.getApiKey();
            if (!apiKey) {
                return { success: false, error: 'API key not configured.' };
            }

            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
            const body = {
                contents: [{ parts: [{ text: fullPrompt }] }],
                generationConfig: {
                    temperature: temp,
                    topP: 0.95,
                    maxOutputTokens: 1024,
                    responseMimeType: 'application/json',
                }
            };

            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                return { success: false, error: errData?.error?.message || `API error (${res.status})` };
            }

            const data = await res.json();
            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const parsed = this._parseJSON(text);
            return { success: true, data: parsed };
        } catch (e) {
            if (e instanceof SyntaxError) {
                return { success: false, error: 'Failed to parse AI response as JSON: ' + e.message };
            }
            return { success: false, error: e.message || 'Network error.' };
        }
    },

    async getHint(topic, conversationHistory, currentQuestion) {
        let context = `Topic: ${topic}\nCurrent question the student is stuck on: ${currentQuestion}\n\n`;
        context += 'Recent conversation:\n';
        const recent = conversationHistory.slice(-6);
        for (const entry of recent) {
            const role = entry.role === 'assistant' ? 'Socratic' : 'Student';
            const content = typeof entry.content === 'string' ? entry.content : (entry.content.question || '');
            context += `${role}: ${content}\n`;
        }
        context += '\nProvide a helpful hint. Respond with valid JSON only.';

        return this._callGemini(this.HINT_SYSTEM_PROMPT, context);
    },

    async generateSessionSummary(topic, conversationHistory) {
        let context = `Topic: ${topic}\n\nFull conversation:\n`;
        for (const entry of conversationHistory) {
            const role = entry.role === 'assistant' ? 'Socratic' : 'Student';
            let content;
            if (typeof entry.content === 'object') {
                content = entry.content.question || JSON.stringify(entry.content);
            } else {
                content = String(entry.content);
            }
            context += `${role}: ${content}\n`;
        }
        context += '\n\nProvide a comprehensive learning session summary. Respond with valid JSON only.';

        return this._callGemini(this.SUMMARY_SYSTEM_PROMPT, context, 0.5);
    },

    async generateTopicSuggestions(interests) {
        const system = 'You suggest fascinating learning topics. Respond with valid JSON only.';
        let prompt = 'Suggest 6 diverse, interesting topics for Socratic learning exploration.\n';
        if (interests) {
            prompt += `The student is interested in: ${interests}\n`;
        } else {
            prompt += 'Provide a diverse mix across science, technology, philosophy, mathematics, history, and social sciences.\n';
        }
        prompt += '\nRespond with valid JSON:\n{\n    "suggestions": [\n        {"topic": "topic name", "description": "One-line hook that makes it intriguing", "category": "category", "difficulty": "beginner|intermediate|advanced"}\n    ]\n}';

        return this._callGemini(system, prompt, 0.9);
    },
};
