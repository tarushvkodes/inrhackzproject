/**
 * Socratic — Landing Page Logic
 * Handles topic input, suggestions, stats, and recent sessions.
 */

document.addEventListener('DOMContentLoaded', () => {
    loadStats();
    loadSuggestions();
    loadRecentSessions();
    setupEventListeners();
});

function setupEventListeners() {
    // Topic form submission
    document.getElementById('topicForm').addEventListener('submit', handleStartSession);

    // Context toggle
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

    // Refresh suggestions
    document.getElementById('refreshSuggestions').addEventListener('click', loadSuggestions);
}

async function handleStartSession(e) {
    e.preventDefault();
    const topic = document.getElementById('topicInput').value.trim();
    const context = document.getElementById('contextInput').value.trim();

    if (!topic) return;

    const btn = document.getElementById('startBtn');
    setButtonLoading(btn, true);

    try {
        const res = await fetch('/api/session/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ topic, context })
        });

        const data = await res.json();

        if (data.success) {
            window.location.href = `/learn/${data.session_id}`;
        } else {
            showError(data.error || 'Failed to start session. Check your OpenRouter API key.');
        }
    } catch (err) {
        showError('Network error. Is the server running?');
    } finally {
        setButtonLoading(btn, false);
    }
}

async function loadStats() {
    try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        if (data.success && data.stats) {
            const s = data.stats;
            document.getElementById('statSessions').textContent = s.total_sessions || 0;
            document.getElementById('statExchanges').textContent = s.total_exchanges || 0;
            document.getElementById('statMinutes').textContent = s.total_learning_minutes || 0;
            document.getElementById('statUnderstanding').textContent = (s.average_understanding || 0) + '%';
        }
    } catch (err) {
        // Stats are non-critical, fail silently
    }
}

async function loadSuggestions() {
    const grid = document.getElementById('suggestionsGrid');
    grid.innerHTML = '<div class="loading-state"><span class="spinner"></span></div>';

    try {
        const res = await fetch('/api/suggestions');
        const data = await res.json();

        if (data.success && data.data && data.data.suggestions) {
            grid.innerHTML = '';
            data.data.suggestions.forEach(s => {
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
        } else {
            grid.innerHTML = '<p style="color: var(--text-muted); text-align: center;">Could not load suggestions. You can type any topic above!</p>';
        }
    } catch (err) {
        grid.innerHTML = '<p style="color: var(--text-muted); text-align: center;">Enter any topic above to begin learning.</p>';
    }
}

async function loadRecentSessions() {
    try {
        const res = await fetch('/api/sessions');
        const data = await res.json();

        if (data.success && data.sessions && data.sessions.length > 0) {
            const section = document.getElementById('recentSection');
            const list = document.getElementById('recentSessions');
            section.style.display = 'block';

            // Show up to 3 most recent
            const recent = data.sessions.slice(0, 3);
            list.innerHTML = '';

            recent.forEach(s => {
                const card = document.createElement('a');
                card.className = 'session-card';
                card.href = s.is_active ? `/learn/${s.id}` : `/review/${s.id}`;

                const badge = s.is_active
                    ? '<span class="session-badge active">Active</span>'
                    : '<span class="session-badge completed">Done</span>';

                const time = formatTimeAgo(s.started_at);

                card.innerHTML = `
                    <div class="session-info">
                        <h4>${escapeHtml(s.topic)}</h4>
                        <p>${time} · ${s.total_exchanges} exchanges · ${s.duration_minutes}m</p>
                    </div>
                    <div style="display:flex;align-items:center;gap:12px;">
                        <span class="session-score">${s.final_understanding_score}%</span>
                        ${badge}
                    </div>
                `;
                list.appendChild(card);
            });
        }
    } catch (err) {
        // Non-critical
    }
}

// ─── Utilities ───

function setButtonLoading(btn, loading) {
    const text = btn.querySelector('.btn-text');
    const loader = btn.querySelector('.btn-loading');
    if (loading) {
        text.style.display = 'none';
        loader.style.display = 'inline-flex';
        btn.disabled = true;
    } else {
        text.style.display = 'inline';
        loader.style.display = 'none';
        btn.disabled = false;
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

function showError(message) {
    // Simple inline error — could be a toast in production
    const existing = document.querySelector('.error-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'error-toast';
    toast.style.cssText = `
        position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
        padding: 12px 24px; background: var(--danger-bg); color: var(--danger);
        border: 1px solid var(--danger); border-radius: var(--radius-md);
        font-size: 0.9rem; z-index: 1000; animation: message-in 0.3s ease;
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
