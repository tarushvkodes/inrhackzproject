/**
 * Socratic — Landing Page Logic (Static / GitHub Pages version)
 * Uses localStorage for data and calls Gemini API directly from browser.
 */

// Listen for rate-limit events from GeminiAPI and show a countdown toast
window.addEventListener('gemini-rate-limit', (e) => {
    const { waitSeconds, model, attempt } = e.detail;
    showError(`Rate limited — retrying in ${waitSeconds}s (trying ${model}, attempt ${attempt})...`);
});

document.addEventListener('DOMContentLoaded', () => {
    checkApiKey();
    loadStats();
    loadSuggestions();
    loadRecentSessions();
    setupEventListeners();
    setupSettingsModal();
    setupSetupModal();
});

// ─── API Key Check ───

function checkApiKey() {
    if (!Storage.isApiKeyConfigured()) {
        document.getElementById('setupModal').style.display = 'flex';
    }
}

function setupSetupModal() {
    const form = document.getElementById('setupForm');
    const showKey = document.getElementById('setupShowKey');
    const keyInput = document.getElementById('setupApiKeyInput');

    showKey.addEventListener('change', () => {
        keyInput.type = showKey.checked ? 'text' : 'password';
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const key = keyInput.value.trim();
        const errEl = document.getElementById('setupError');
        const btn = document.getElementById('setupSaveBtn');

        if (!key) return;

        errEl.style.display = 'none';
        setButtonLoading(btn, true);

        const result = await GeminiAPI.validateApiKey(key);
        if (result.success) {
            Storage.setApiKey(key);
            // Auto-select the first working model
            if (result.workingModels && result.workingModels.length > 0) {
                Storage.setModel(result.workingModels[0]);
                console.log('Working models:', result.workingModels);
            }
            document.getElementById('setupModal').style.display = 'none';
            loadSuggestions();
        } else {
            errEl.textContent = result.error || 'Invalid API key. Please check and try again.';
            errEl.style.display = 'block';
        }

        setButtonLoading(btn, false);
    });
}

// ─── Settings Modal ───

function setupSettingsModal() {
    const btn = document.getElementById('settingsBtn');
    const modal = document.getElementById('settingsModal');
    const closeBtn = document.getElementById('closeSettings');
    const form = document.getElementById('settingsForm');
    const toggleKey = document.getElementById('settingsToggleKey');
    const keyInput = document.getElementById('settingsApiKey');
    const modelSelect = document.getElementById('settingsModel');
    const tempSlider = document.getElementById('settingsTemp');
    const tempValue = document.getElementById('tempValue');
    const clearBtn = document.getElementById('clearDataBtn');

    btn.addEventListener('click', () => {
        // Populate current values
        keyInput.value = Storage.getApiKey();
        modelSelect.value = Storage.getModel();
        tempSlider.value = Storage.getTemperature();
        tempValue.textContent = Storage.getTemperature();
        modal.style.display = 'flex';
    });

    closeBtn.addEventListener('click', () => {
        modal.style.display = 'none';
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.style.display = 'none';
    });

    toggleKey.addEventListener('click', () => {
        if (keyInput.type === 'password') {
            keyInput.type = 'text';
            toggleKey.textContent = 'Hide';
        } else {
            keyInput.type = 'password';
            toggleKey.textContent = 'Show';
        }
    });

    tempSlider.addEventListener('input', () => {
        tempValue.textContent = tempSlider.value;
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const msgEl = document.getElementById('settingsMsg');

        const newKey = keyInput.value.trim();
        if (newKey) {
            Storage.setApiKey(newKey);
        }
        Storage.setModel(modelSelect.value);
        Storage.setTemperature(parseFloat(tempSlider.value));

        msgEl.style.color = 'var(--success)';
        msgEl.textContent = 'Settings saved!';
        msgEl.style.display = 'block';
        setTimeout(() => { msgEl.style.display = 'none'; }, 2000);
    });

    clearBtn.addEventListener('click', () => {
        if (confirm('This will delete ALL your session data and settings. Are you sure?')) {
            localStorage.clear();
            window.location.reload();
        }
    });
}

// ─── Event Listeners ───

function setupEventListeners() {
    document.getElementById('topicForm').addEventListener('submit', handleStartSession);

    document.getElementById('contextToggle').addEventListener('click', () => {
        const area = document.getElementById('contextInput');
        const btn = document.getElementById('contextToggle');
        if (area.style.display === 'none') {
            area.style.display = 'block';
            btn.textContent = '− Hide context';
            area.focus();
        } else {
            area.style.display = 'none';
            btn.textContent = '+ Add context about what you already know';
        }
    });

    document.getElementById('refreshSuggestions').addEventListener('click', refreshSuggestionsFromAPI);
}

async function handleStartSession(e) {
    e.preventDefault();

    if (!Storage.isApiKeyConfigured()) {
        document.getElementById('setupModal').style.display = 'flex';
        return;
    }

    const topic = document.getElementById('topicInput').value.trim();
    const context = document.getElementById('contextInput').value.trim();
    if (!topic) return;

    const btn = document.getElementById('startBtn');
    setButtonLoading(btn, true);

    try {
        const result = await GeminiAPI.startSession(topic, context);

        if (result.success) {
            // Generate a unique ID
            const sessionId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substr(2);

            // Create session in localStorage
            const session = Storage.createSession(sessionId, topic, context);

            // Save the first AI response into conversation history
            const aiData = result.data;
            session.conversation_history = [{ role: 'assistant', content: aiData }];
            Storage.updateSession(sessionId, { conversation_history: session.conversation_history });

            // Navigate to session page
            window.location.href = `session.html?id=${sessionId}`;
        } else {
            showError(result.error || 'Failed to start session. Check your Gemini API key in Settings.');
        }
    } catch (err) {
        showError('Unexpected error. Please try again.');
    } finally {
        setButtonLoading(btn, false);
    }
}

function loadStats() {
    const s = Storage.getStats();
    document.getElementById('statSessions').textContent = s.total_sessions || 0;
    document.getElementById('statExchanges').textContent = s.total_exchanges || 0;
    document.getElementById('statMinutes').textContent = s.total_learning_minutes || 0;
    document.getElementById('statUnderstanding').textContent = (s.average_understanding || 0) + '%';
}

// Default suggestions shown instantly — no API call needed
const DEFAULT_SUGGESTIONS = [
    { topic: 'How does photosynthesis work?', description: 'Discover how plants turn sunlight into food.', category: 'Biology', difficulty: 'beginner' },
    { topic: 'What is recursion?', description: 'A function that calls itself — but why?', category: 'Computer Science', difficulty: 'intermediate' },
    { topic: 'Why does time slow near a black hole?', description: 'Explore Einstein\'s mind-bending spacetime.', category: 'Physics', difficulty: 'advanced' },
    { topic: 'How do vaccines train your immune system?', description: 'The elegant trick behind modern medicine.', category: 'Medicine', difficulty: 'beginner' },
    { topic: 'What makes a market crash?', description: 'Psychology, panic, and feedback loops.', category: 'Economics', difficulty: 'intermediate' },
    { topic: 'Is mathematics discovered or invented?', description: 'A philosophical question with no easy answer.', category: 'Philosophy', difficulty: 'advanced' },
];

function loadSuggestions() {
    // Show hardcoded suggestions instantly — saves API quota
    renderSuggestions(DEFAULT_SUGGESTIONS);
}

async function refreshSuggestionsFromAPI() {
    const grid = document.getElementById('suggestionsGrid');

    if (!Storage.isApiKeyConfigured()) {
        grid.innerHTML = '<p style="color:var(--text-muted);text-align:center;">Set up your API key to see topic suggestions.</p>';
        return;
    }

    grid.innerHTML = '<div class="loading-state"><span class="spinner"></span></div>';

    try {
        const data = await GeminiAPI.generateTopicSuggestions('');

        if (data.success && data.data && data.data.suggestions) {
            renderSuggestions(data.data.suggestions);
        } else {
            renderSuggestions(DEFAULT_SUGGESTIONS);
        }
    } catch (err) {
        renderSuggestions(DEFAULT_SUGGESTIONS);
    }
}

function renderSuggestions(suggestions) {
    const grid = document.getElementById('suggestionsGrid');
    grid.innerHTML = '';
    suggestions.forEach(s => {
        const card = document.createElement('div');
        card.className = 'suggestion-card';
        card.innerHTML = `
            <div class="topic-name">${escapeHtml(s.topic)}</div>
            <div class="topic-desc">${escapeHtml(s.description)}</div>
            <div class="topic-meta">
                <span class="topic-tag">${escapeHtml(s.category || '')}</span>
                <span class="topic-tag">${escapeHtml(s.difficulty || '')}</span>
            </div>
        `;
        card.addEventListener('click', () => {
            document.getElementById('topicInput').value = s.topic;
            document.getElementById('topicInput').focus();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        grid.appendChild(card);
    });
}

function loadRecentSessions() {
    const sessions = Storage.getAllSessions();
    if (sessions.length === 0) return;

    const section = document.getElementById('recentSection');
    const list = document.getElementById('recentSessions');
    section.style.display = 'block';

    const recent = sessions.slice(0, 3);
    list.innerHTML = '';

    recent.forEach(s => {
        const card = document.createElement('a');
        card.className = 'session-card';
        card.href = s.is_active ? `session.html?id=${s.id}` : `review.html?id=${s.id}`;

        const badge = s.is_active
            ? '<span class="session-badge active">Active</span>'
            : '<span class="session-badge completed">Done</span>';

        const time = formatTimeAgo(s.started_at);
        const duration = Storage.getSessionDuration(s);

        card.innerHTML = `
            <div class="session-info">
                <h4>${escapeHtml(s.topic)}</h4>
                <p>${time} · ${s.total_exchanges} exchanges · ${duration}m</p>
            </div>
            <div style="display:flex;align-items:center;gap:12px;">
                <span class="session-score">${s.final_understanding_score}%</span>
                ${badge}
            </div>
        `;
        list.appendChild(card);
    });
}

// ─── Utilities ───

function setButtonLoading(btn, loading) {
    const text = btn.querySelector('.btn-text');
    const loader = btn.querySelector('.btn-loading');
    if (loading) {
        if (text) text.style.display = 'none';
        if (loader) loader.style.display = 'inline-flex';
        btn.disabled = true;
    } else {
        if (text) text.style.display = 'inline';
        if (loader) loader.style.display = 'none';
        btn.disabled = false;
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

function showError(message) {
    const existing = document.querySelector('.error-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'error-toast';
    toast.style.cssText = `
        position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
        padding:12px 24px;background:var(--danger-bg);color:var(--danger);
        border:1px solid var(--danger);border-radius:var(--radius-md);
        font-size:0.9rem;z-index:1000;animation:message-in 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
}

function formatTimeAgo(isoString) {
    if (!isoString) return '';
    const now = new Date();
    const date = new Date(isoString);
    const diff = Math.floor((now - date) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return date.toLocaleDateString();
}
