/**
 * Socratic — Session History Logic
 */

let allSessions = [];

document.addEventListener('DOMContentLoaded', () => {
    loadHistory();
    setupFilters();
});

function setupFilters() {
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderSessions(btn.dataset.filter);
        });
    });
}

async function loadHistory() {
    try {
        const res = await fetch('/api/sessions');
        const data = await res.json();

        if (data.success) {
            allSessions = data.sessions;
            if (allSessions.length === 0) {
                document.getElementById('historyList').style.display = 'none';
                document.getElementById('emptyState').style.display = 'block';
            } else {
                renderSessions('all');
            }
        }
    } catch (err) {
        document.getElementById('historyList').innerHTML =
            '<p style="text-align:center;color:var(--text-muted);">Failed to load sessions.</p>';
    }
}

function renderSessions(filter) {
    const list = document.getElementById('historyList');
    let sessions = allSessions;

    if (filter === 'active') sessions = allSessions.filter(s => s.is_active);
    if (filter === 'completed') sessions = allSessions.filter(s => !s.is_active);

    if (sessions.length === 0) {
        list.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:24px;">No sessions match this filter.</p>';
        return;
    }

    list.innerHTML = sessions.map(s => {
        const badge = s.is_active
            ? '<span class="session-badge active">Active</span>'
            : '<span class="session-badge completed">Completed</span>';
        const url = s.is_active ? `/learn/${s.id}` : `/review/${s.id}`;
        const date = new Date(s.started_at).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric'
        });

        return `
            <a href="${url}" class="history-card">
                <div class="history-card-info">
                    <h4>${escapeHtml(s.topic)}</h4>
                    <p>${date} · ${s.total_exchanges} exchanges · ${s.duration_minutes}m · ${capitalize(s.highest_difficulty)}</p>
                </div>
                <div class="history-card-right">
                    <span class="history-score">${s.final_understanding_score}%</span>
                    ${badge}
                </div>
            </a>
        `;
    }).join('');
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

function capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}
