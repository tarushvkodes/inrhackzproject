/**
 * Socratic — Session Review Logic (Static / GitHub Pages version)
 * Reads session data from localStorage.
 */

const urlParams = new URLSearchParams(window.location.search);
const SESSION_ID = urlParams.get('id');

document.addEventListener('DOMContentLoaded', () => {
    if (!SESSION_ID) {
        window.location.href = 'history.html';
        return;
    }
    loadReview();
    setupActions();
});

function setupActions() {
    document.getElementById('deleteSession').addEventListener('click', () => {
        if (!confirm('Delete this session permanently?')) return;
        Storage.deleteSession(SESSION_ID);
        window.location.href = 'history.html';
    });
}

function loadReview() {
    const session = Storage.getSession(SESSION_ID);
    if (!session) {
        document.getElementById('summaryContent').innerHTML =
            '<p style="color:var(--danger);">Session not found.</p>';
        return;
    }

    const summary = session.summary;
    const duration = Storage.getSessionDuration(session);

    // Update hero stats
    document.getElementById('reviewTopic').textContent = session.topic;
    document.getElementById('reviewScore').textContent = session.final_understanding_score + '%';
    document.getElementById('reviewExchanges').textContent = session.total_exchanges;
    document.getElementById('reviewDuration').textContent = duration + 'm';
    document.getElementById('reviewDifficulty').textContent = capitalize(session.highest_difficulty);
    document.getElementById('reviewHints').textContent = session.hints_used || 0;

    // AI Summary
    if (summary) {
        const summaryDiv = document.getElementById('summaryContent');
        summaryDiv.innerHTML = `
            <p>${escapeHtml(summary.topic_summary || '')}</p>
            ${summary.learning_style_notes ? `<p style="margin-top:8px;color:var(--text-muted);font-style:italic;">${escapeHtml(summary.learning_style_notes)}</p>` : ''}
            ${summary.time_well_spent_score !== undefined ? `<p style="margin-top:8px;font-size:0.85rem;">Time well-spent score: <strong>${summary.time_well_spent_score}%</strong></p>` : ''}
        `;

        // Key Discoveries
        const discoveryList = document.getElementById('discoveryList');
        if (summary.key_discoveries && summary.key_discoveries.length > 0) {
            discoveryList.innerHTML = summary.key_discoveries
                .map(d => `<li>${escapeHtml(d)}</li>`).join('');
        } else {
            discoveryList.innerHTML = '<li style="color:var(--text-muted);">No specific discoveries recorded.</li>';
        }

        // Misconceptions
        const miscList = document.getElementById('misconceptionList');
        if (summary.misconceptions_addressed && summary.misconceptions_addressed.length > 0) {
            miscList.innerHTML = summary.misconceptions_addressed
                .map(m => `<li>${escapeHtml(m)}</li>`).join('');
        } else {
            miscList.innerHTML = '<li style="color:var(--text-muted);">No misconceptions were identified.</li>';
        }

        // Next topics
        const nextDiv = document.getElementById('nextTopics');
        if (summary.recommended_next_topics && summary.recommended_next_topics.length > 0) {
            nextDiv.innerHTML = summary.recommended_next_topics
                .map(t => `<a class="next-topic-tag" href="index.html">${escapeHtml(t)}</a>`).join('');
        } else {
            nextDiv.innerHTML = '<span style="color:var(--text-muted);">No specific recommendations.</span>';
        }
    } else {
        document.getElementById('summaryContent').innerHTML =
            '<p style="color:var(--text-muted);">No summary available for this session.</p>';
    }

    // Conversation Replay
    const replayDiv = document.getElementById('conversationReplay');
    const history = session.conversation_history || [];
    let replayHtml = '';
    let currentQuestion = '';

    history.forEach(entry => {
        if (entry.role === 'assistant') {
            const question = typeof entry.content === 'object'
                ? (entry.content.question || '')
                : entry.content;
            currentQuestion = question;
        } else {
            replayHtml += `
                <div class="replay-exchange">
                    <div class="replay-question">Q: ${escapeHtml(currentQuestion)}</div>
                    <div class="replay-answer">A: ${escapeHtml(entry.content)}</div>
                </div>
            `;
        }
    });

    // Show last unanswered question
    const lastEntry = history[history.length - 1];
    if (lastEntry && lastEntry.role === 'assistant') {
        const q = typeof lastEntry.content === 'object'
            ? (lastEntry.content.question || '')
            : lastEntry.content;
        replayHtml += `
            <div class="replay-exchange">
                <div class="replay-question">Q: ${escapeHtml(q)}</div>
                <div class="replay-answer" style="color:var(--text-muted);font-style:italic;">Session ended before answering</div>
            </div>
        `;
    }

    replayDiv.innerHTML = replayHtml || '<p style="color:var(--text-muted);">No conversation recorded.</p>';
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

function capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}
