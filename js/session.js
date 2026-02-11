/**
 * Socratic — Active Learning Session Logic (Static / GitHub Pages version)
 * All data stored in localStorage, Gemini API called directly from browser.
 */

// Get session ID from URL query parameter
const urlParams = new URLSearchParams(window.location.search);
const SESSION_ID = urlParams.get('id');

let exchangeCount = 0;
let currentDifficulty = 'foundational';
let hintsUsed = 0;
let allCorrectInsights = [];
let allMisconceptions = [];
let allGaps = [];

document.addEventListener('DOMContentLoaded', () => {
    if (!SESSION_ID) {
        window.location.href = 'index.html';
        return;
    }
    loadSession();
    setupEventListeners();
});

function setupEventListeners() {
    document.getElementById('responseForm').addEventListener('submit', handleResponse);
    document.getElementById('hintBtn').addEventListener('click', handleHint);

    document.getElementById('endSessionBtn').addEventListener('click', () => {
        document.getElementById('endModal').style.display = 'flex';
    });
    document.getElementById('cancelEnd').addEventListener('click', () => {
        document.getElementById('endModal').style.display = 'none';
    });
    document.getElementById('confirmEnd').addEventListener('click', handleEndSession);

    document.getElementById('insightsToggle').addEventListener('click', () => {
        document.getElementById('insightsPanel').classList.toggle('open');
    });

    const textarea = document.getElementById('responseInput');
    textarea.addEventListener('input', () => {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
    });

    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            document.getElementById('responseForm').dispatchEvent(new Event('submit'));
        }
    });
}

function loadSession() {
    const session = Storage.getSession(SESSION_ID);
    if (!session) {
        addSystemMessage('Session not found. Redirecting...');
        setTimeout(() => window.location.href = 'index.html', 1500);
        return;
    }

    document.getElementById('sessionTopic').textContent = session.topic;
    exchangeCount = session.total_exchanges;
    hintsUsed = session.hints_used || 0;
    if (hintsUsed > 0) {
        document.getElementById('hintCount').textContent = `(${hintsUsed} used)`;
    }

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

async function handleResponse(e) {
    e.preventDefault();
    const input = document.getElementById('responseInput');
    const response = input.value.trim();
    if (!response) return;

    addStudentMessage(response);
    input.value = '';
    input.style.height = 'auto';

    const thinking = addThinkingIndicator();
    const btn = document.getElementById('submitBtn');
    setButtonLoading(btn, true);

    try {
        const session = Storage.getSession(SESSION_ID);
        const convHistory = session.conversation_history || [];

        // Add student response to history
        convHistory.push({ role: 'user', content: response });

        // Call Gemini API
        const result = await GeminiAPI.continueDialogue(session.topic, convHistory, response);
        thinking.remove();

        if (result.success) {
            const aiData = result.data;
            exchangeCount++;

            // Add AI response to history
            convHistory.push({ role: 'assistant', content: aiData });

            // Update session in storage
            const score = aiData.understanding_score || 0;
            const difficulty = aiData.difficulty_level || 'foundational';
            const difficultyOrder = ['foundational', 'intermediate', 'advanced', 'mastery'];
            const currentIdx = difficultyOrder.indexOf(session.highest_difficulty || 'foundational');
            const newIdx = difficultyOrder.indexOf(difficulty);

            Storage.updateSession(SESSION_ID, {
                conversation_history: convHistory,
                total_exchanges: exchangeCount,
                final_understanding_score: Math.max(session.final_understanding_score || 0, score),
                highest_difficulty: newIdx > currentIdx ? difficulty : session.highest_difficulty,
            });

            addSocraticMessage(aiData);
            updateUI(aiData);
        } else {
            // Still save the student message
            Storage.updateSession(SESSION_ID, { conversation_history: convHistory });
            addSystemMessage(result.error || 'Failed to get response. Try again.');
        }
    } catch (err) {
        thinking.remove();
        addSystemMessage('Unexpected error. Please check your connection.');
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
        const session = Storage.getSession(SESSION_ID);
        const convHistory = session.conversation_history || [];

        // Find current question
        let currentQuestion = '';
        for (let i = convHistory.length - 1; i >= 0; i--) {
            if (convHistory[i].role === 'assistant') {
                const content = convHistory[i].content;
                currentQuestion = typeof content === 'object' ? (content.question || '') : content;
                break;
            }
        }

        const result = await GeminiAPI.getHint(session.topic, convHistory, currentQuestion);

        if (result.success && result.data) {
            hintsUsed++;
            document.getElementById('hintCount').textContent = `(${hintsUsed} used)`;
            Storage.updateSession(SESSION_ID, { hints_used: hintsUsed });
            addHintMessage(result.data.hint);
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
        const session = Storage.getSession(SESSION_ID);
        const convHistory = session.conversation_history || [];

        const summaryResult = await GeminiAPI.generateSessionSummary(session.topic, convHistory);

        const updates = {
            is_active: false,
            ended_at: new Date().toISOString(),
        };

        if (summaryResult.success) {
            updates.summary = summaryResult.data;
            updates.final_understanding_score = summaryResult.data.overall_understanding || session.final_understanding_score;
        }

        Storage.updateSession(SESSION_ID, updates);

        // Update global stats
        const updatedSession = Storage.getSession(SESSION_ID);
        Storage.updateStatsOnSessionEnd(updatedSession);

        window.location.href = `review.html?id=${SESSION_ID}`;
    } catch (err) {
        btn.textContent = 'Generate Summary';
        btn.disabled = false;
        addSystemMessage('Failed to end session. Try again.');
        document.getElementById('endModal').style.display = 'none';
    }
}

// ─── UI Update Functions ───

function updateUI(aiData) {
    const score = aiData.understanding_score || 0;
    document.getElementById('gaugeFill').setAttribute('stroke-dasharray', `${score}, 100`);
    document.getElementById('gaugeText').textContent = score + '%';

    const fill = document.getElementById('gaugeFill');
    if (score >= 80) fill.style.stroke = 'var(--success)';
    else if (score >= 50) fill.style.stroke = 'var(--accent-warm)';
    else fill.style.stroke = 'var(--accent-primary)';

    const difficulty = aiData.difficulty_level || 'foundational';
    currentDifficulty = difficulty;
    updateDifficultyProgress(difficulty);

    document.getElementById('sessionMeta').textContent =
        `Exchange ${exchangeCount + 1} · ${capitalize(difficulty)}`;

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
        correctList.innerHTML = allCorrectInsights.map(i => `<li>${escapeHtml(i)}</li>`).join('');
    }
    if (allMisconceptions.length > 0) {
        miscList.innerHTML = allMisconceptions.map(i => `<li>${escapeHtml(i)}</li>`).join('');
    }
    if (allGaps.length > 0) {
        gapsList.innerHTML = allGaps.map(i => `<li>${escapeHtml(i)}</li>`).join('');
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

function capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}
