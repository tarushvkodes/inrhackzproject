/**
 * Socratic — Active Learning Session Logic
 * Handles the real-time Socratic dialogue, hints, insights,
 * understanding tracking, and session management.
 */

// SESSION_ID is injected from the template
let exchangeCount = 0;
let currentDifficulty = 'foundational';
let hintsUsed = 0;
let allCorrectInsights = [];
let allMisconceptions = [];
let allGaps = [];

document.addEventListener('DOMContentLoaded', () => {
    loadSession();
    setupEventListeners();
});

function setupEventListeners() {
    // Response form
    document.getElementById('responseForm').addEventListener('submit', handleResponse);

    // Hint button
    document.getElementById('hintBtn').addEventListener('click', handleHint);

    // End session
    document.getElementById('endSessionBtn').addEventListener('click', () => {
        document.getElementById('endModal').style.display = 'flex';
    });
    document.getElementById('cancelEnd').addEventListener('click', () => {
        document.getElementById('endModal').style.display = 'none';
    });
    document.getElementById('confirmEnd').addEventListener('click', handleEndSession);

    // Insights panel toggle
    document.getElementById('insightsToggle').addEventListener('click', () => {
        document.getElementById('insightsPanel').classList.toggle('open');
    });

    // Auto-resize textarea
    const textarea = document.getElementById('responseInput');
    textarea.addEventListener('input', () => {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
    });

    // Submit on Enter (Shift+Enter for newline)
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            document.getElementById('responseForm').dispatchEvent(new Event('submit'));
        }
    });
}

async function loadSession() {
    try {
        const res = await fetch(`/api/session/${SESSION_ID}`);
        const data = await res.json();

        if (data.success) {
            const session = data.session;
            exchangeCount = session.total_exchanges;

            // Render existing conversation
            const history = session.conversation_history || [];
            history.forEach(entry => {
                if (entry.role === 'assistant') {
                    addSocraticMessage(entry.content);
                } else {
                    addStudentMessage(entry.content);
                }
            });

            // Update UI from last AI message
            const lastAI = [...history].reverse().find(e => e.role === 'assistant');
            if (lastAI && lastAI.content) {
                updateUI(lastAI.content);
            }

            scrollToBottom();
        }
    } catch (err) {
        addSystemMessage('Failed to load session. Please refresh.');
    }
}

async function handleResponse(e) {
    e.preventDefault();
    const input = document.getElementById('responseInput');
    const response = input.value.trim();
    if (!response) return;

    // Show student message
    addStudentMessage(response);
    input.value = '';
    input.style.height = 'auto';

    // Show thinking indicator
    const thinking = addThinkingIndicator();

    const btn = document.getElementById('submitBtn');
    setButtonLoading(btn, true);

    try {
        const res = await fetch(`/api/session/${SESSION_ID}/respond`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ response })
        });

        const data = await res.json();
        thinking.remove();

        if (data.success) {
            exchangeCount++;
            addSocraticMessage(data.data);
            updateUI(data.data);
        } else {
            addSystemMessage(data.error || 'Failed to get response. Try again.');
        }
    } catch (err) {
        thinking.remove();
        addSystemMessage('Network error. Please check your connection.');
    } finally {
        setButtonLoading(btn, false);
        input.focus();
        scrollToBottom();
    }
}

async function handleHint() {
    const btn = document.getElementById('hintBtn');
    btn.disabled = true;

    try {
        const res = await fetch(`/api/session/${SESSION_ID}/hint`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await res.json();

        if (data.success && data.data) {
            hintsUsed++;
            document.getElementById('hintCount').textContent = `(${hintsUsed} used)`;
            addHintMessage(data.data.hint);
            scrollToBottom();
        }
    } catch (err) {
        // Fail silently
    } finally {
        btn.disabled = false;
    }
}

async function handleEndSession() {
    const btn = document.getElementById('confirmEnd');
    btn.textContent = 'Generating...';
    btn.disabled = true;

    try {
        const res = await fetch(`/api/session/${SESSION_ID}/end`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await res.json();

        if (data.success) {
            window.location.href = `/review/${SESSION_ID}`;
        } else {
            btn.textContent = 'Generate Summary';
            btn.disabled = false;
            addSystemMessage('Failed to end session. Try again.');
            document.getElementById('endModal').style.display = 'none';
        }
    } catch (err) {
        btn.textContent = 'Generate Summary';
        btn.disabled = false;
    }
}

// ─── UI Update Functions ───

function updateUI(aiData) {
    // Update understanding gauge
    const score = aiData.understanding_score || 0;
    document.getElementById('gaugeFill').setAttribute('stroke-dasharray', `${score}, 100`);
    document.getElementById('gaugeText').textContent = score + '%';

    // Update gauge color based on score
    const fill = document.getElementById('gaugeFill');
    if (score >= 80) fill.style.stroke = 'var(--success)';
    else if (score >= 50) fill.style.stroke = 'var(--accent-warm)';
    else fill.style.stroke = 'var(--accent-primary)';

    // Update difficulty level
    const difficulty = aiData.difficulty_level || 'foundational';
    currentDifficulty = difficulty;
    updateDifficultyProgress(difficulty);

    // Update session meta
    document.getElementById('sessionMeta').textContent =
        `Exchange ${exchangeCount + 1} · ${capitalize(difficulty)}`;

    // Update insights
    const signals = aiData.understanding_signals || {};
    if (signals.correct_insights) {
        signals.correct_insights.forEach(i => {
            if (!allCorrectInsights.includes(i)) allCorrectInsights.push(i);
        });
    }
    if (signals.misconceptions) {
        signals.misconceptions.forEach(i => {
            if (!allMisconceptions.includes(i)) allMisconceptions.push(i);
        });
    }
    if (signals.gaps) {
        allGaps = signals.gaps;
    }

    updateInsightsPanel();
}

function updateDifficultyProgress(level) {
    const levels = ['foundational', 'intermediate', 'advanced', 'mastery'];
    const currentIdx = levels.indexOf(level);

    document.querySelectorAll('.difficulty-step').forEach((step, idx) => {
        step.classList.remove('completed', 'active');
        if (idx < currentIdx) step.classList.add('completed');
        else if (idx === currentIdx) step.classList.add('active');
    });
}

function updateInsightsPanel() {
    const correctList = document.getElementById('correctInsights');
    const miscList = document.getElementById('misconceptions');
    const gapsList = document.getElementById('gaps');

    if (allCorrectInsights.length > 0) {
        correctList.innerHTML = allCorrectInsights.map(i =>
            `<li>${escapeHtml(i)}</li>`
        ).join('');
    }

    if (allMisconceptions.length > 0) {
        miscList.innerHTML = allMisconceptions.map(i =>
            `<li>${escapeHtml(i)}</li>`
        ).join('');
    }

    if (allGaps.length > 0) {
        gapsList.innerHTML = allGaps.map(i =>
            `<li>${escapeHtml(i)}</li>`
        ).join('');
    }
}

// ─── Message Rendering ───

function addSocraticMessage(content) {
    const area = document.getElementById('conversationArea');
    const div = document.createElement('div');
    div.className = 'message message-socratic';

    const question = typeof content === 'string' ? content : (content.question || '');
    const encouragement = typeof content === 'object' ? (content.encouragement || '') : '';

    let html = `
        <div class="message-label">Socratic</div>
        <div class="message-question">${escapeHtml(question)}</div>
    `;

    if (encouragement) {
        html += `<div class="message-encouragement">${escapeHtml(encouragement)}</div>`;
    }

    div.innerHTML = html;
    area.appendChild(div);
}

function addStudentMessage(text) {
    const area = document.getElementById('conversationArea');
    const div = document.createElement('div');
    div.className = 'message message-student';
    div.innerHTML = `
        <div class="message-label">You</div>
        <div class="message-text">${escapeHtml(text)}</div>
    `;
    area.appendChild(div);
}

function addHintMessage(hint) {
    const area = document.getElementById('conversationArea');
    const div = document.createElement('div');
    div.className = 'message-hint';
    div.innerHTML = `
        <div class="hint-label">💡 Hint</div>
        <div class="hint-text">${escapeHtml(hint)}</div>
    `;
    area.appendChild(div);
}

function addSystemMessage(text) {
    const area = document.getElementById('conversationArea');
    const div = document.createElement('div');
    div.style.cssText = 'text-align:center;padding:12px;color:var(--text-muted);font-size:0.85rem;';
    div.textContent = text;
    area.appendChild(div);
}

function addThinkingIndicator() {
    const area = document.getElementById('conversationArea');
    const div = document.createElement('div');
    div.className = 'thinking-indicator';
    div.innerHTML = `
        <div class="thinking-dots"><span></span><span></span><span></span></div>
        Socratic is thinking...
    `;
    area.appendChild(div);
    scrollToBottom();
    return div;
}

// ─── Utilities ───

function scrollToBottom() {
    const area = document.getElementById('conversationArea');
    area.scrollTop = area.scrollHeight;
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

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

function capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}
