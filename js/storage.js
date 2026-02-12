/**
 * Socratic — Client-Side Storage Service
 * Replaces SQLite database with localStorage.
 */

const STORAGE_KEYS = {
    API_KEY: 'socratic_api_key',
    SESSIONS: 'socratic_sessions',
    STATS: 'socratic_stats',
    MODEL: 'socratic_model',
    TEMPERATURE: 'socratic_temperature',
};

const Storage = {
    // ─── API Key ───
    getApiKey() {
        return localStorage.getItem(STORAGE_KEYS.API_KEY) || '';
    },

    setApiKey(key) {
        localStorage.setItem(STORAGE_KEYS.API_KEY, key);
    },

    removeApiKey() {
        localStorage.removeItem(STORAGE_KEYS.API_KEY);
    },

    isApiKeyConfigured() {
        const key = this.getApiKey();
        return !!key && key !== 'your_gemini_api_key_here';
    },

    // ─── Model Settings ───
    getModel() {
        return localStorage.getItem(STORAGE_KEYS.MODEL) || 'gemini-2.5-flash-lite';
    },

    setModel(model) {
        localStorage.setItem(STORAGE_KEYS.MODEL, model);
    },

    getTemperature() {
        const t = localStorage.getItem(STORAGE_KEYS.TEMPERATURE);
        return t !== null ? parseFloat(t) : 0.7;
    },

    setTemperature(temp) {
        localStorage.setItem(STORAGE_KEYS.TEMPERATURE, temp.toString());
    },

    // ─── Sessions ───
    _getSessions() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEYS.SESSIONS) || '[]');
        } catch {
            return [];
        }
    },

    _saveSessions(sessions) {
        localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(sessions));
    },

    createSession(id, topic, context) {
        const sessions = this._getSessions();
        const session = {
            id,
            topic,
            context: context || '',
            started_at: new Date().toISOString(),
            ended_at: null,
            is_active: true,
            total_exchanges: 0,
            final_understanding_score: 0,
            highest_difficulty: 'foundational',
            hints_used: 0,
            summary: null,
            conversation_history: [],
        };
        sessions.unshift(session);
        this._saveSessions(sessions);
        return session;
    },

    getSession(id) {
        const sessions = this._getSessions();
        return sessions.find(s => s.id === id) || null;
    },

    updateSession(id, updates) {
        const sessions = this._getSessions();
        const idx = sessions.findIndex(s => s.id === id);
        if (idx === -1) return null;
        Object.assign(sessions[idx], updates);
        this._saveSessions(sessions);
        return sessions[idx];
    },

    deleteSession(id) {
        let sessions = this._getSessions();
        sessions = sessions.filter(s => s.id !== id);
        this._saveSessions(sessions);
    },

    getAllSessions() {
        return this._getSessions().sort((a, b) =>
            new Date(b.started_at) - new Date(a.started_at)
        );
    },

    // ─── Stats ───
    _getStats() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEYS.STATS) || 'null') || {
                total_sessions: 0,
                total_exchanges: 0,
                total_learning_minutes: 0,
                average_understanding: 0,
                topics_explored: [],
                streak_days: 0,
            };
        } catch {
            return {
                total_sessions: 0,
                total_exchanges: 0,
                total_learning_minutes: 0,
                average_understanding: 0,
                topics_explored: [],
                streak_days: 0,
            };
        }
    },

    _saveStats(stats) {
        localStorage.setItem(STORAGE_KEYS.STATS, JSON.stringify(stats));
    },

    getStats() {
        return this._getStats();
    },

    updateStatsOnSessionEnd(session) {
        const stats = this._getStats();
        stats.total_sessions += 1;
        stats.total_exchanges += session.total_exchanges;

        // Calculate duration
        const start = new Date(session.started_at);
        const end = session.ended_at ? new Date(session.ended_at) : new Date();
        const minutes = Math.round((end - start) / 60000 * 10) / 10;
        stats.total_learning_minutes = Math.round((stats.total_learning_minutes + minutes) * 10) / 10;

        // Update average understanding
        const allCompleted = this.getAllSessions().filter(s => !s.is_active);
        if (allCompleted.length > 0) {
            const avg = allCompleted.reduce((sum, s) => sum + s.final_understanding_score, 0) / allCompleted.length;
            stats.average_understanding = Math.round(avg * 10) / 10;
        }

        // Track topics
        if (!stats.topics_explored.includes(session.topic)) {
            stats.topics_explored.push(session.topic);
        }

        this._saveStats(stats);
        return stats;
    },

    // ─── Duration helper ───
    getSessionDuration(session) {
        const start = new Date(session.started_at);
        const end = session.ended_at ? new Date(session.ended_at) : new Date();
        return Math.round((end - start) / 60000 * 10) / 10;
    },
};
