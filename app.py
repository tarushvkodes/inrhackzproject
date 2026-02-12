"""
Socratic - AI-Powered Active Learning Through Guided Discovery
Main Flask Application
"""

import os
import uuid
import json
from datetime import datetime, timezone

from flask import Flask, render_template, request, jsonify, session, redirect
from flask_cors import CORS
from dotenv import load_dotenv

from models.database import db, LearningSession, Exchange, LearningStats
from services.ai_service import (
    start_session as ai_start_session,
    continue_dialogue,
    get_hint,
    generate_session_summary,
    generate_topic_suggestions,
    configure_api_key,
    is_api_key_configured
)

load_dotenv()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('FLASK_SECRET_KEY', 'dev-secret-key')
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'sqlite:///socratic.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

CORS(app)
db.init_app(app)

with app.app_context():
    db.create_all()
    # Create initial stats record if not exists
    if not LearningStats.query.first():
        stats = LearningStats()
        db.session.add(stats)
        db.session.commit()


# ──────────────────────────────────────────────
# API KEY SETUP
# ──────────────────────────────────────────────

@app.before_request
def check_api_key():
    """Redirect to setup if OpenRouter API key is not configured."""
    allowed = ['/setup', '/api/setup', '/static/']
    if not is_api_key_configured():
        if not any(request.path.startswith(p) for p in allowed):
            return redirect('/setup')


@app.route('/setup')
def setup():
    """API key setup page."""
    if is_api_key_configured():
        return redirect('/')
    return render_template('setup.html')


@app.route('/api/setup', methods=['POST'])
def api_setup():
    """Save the OpenRouter API key."""
    data = request.get_json()
    api_key = data.get('api_key', '').strip()

    if not api_key:
        return jsonify({'success': False, 'error': 'API key is required'}), 400

    # Quick validation — try a lightweight request to OpenRouter
    try:
        import requests as req
        resp = req.get(
            'https://openrouter.ai/api/v1/models',
            headers={'Authorization': f'Bearer {api_key}'},
            timeout=10,
        )
        if resp.status_code == 401:
            return jsonify({'success': False, 'error': 'Invalid API key. Check your key at openrouter.ai/keys'}), 400
        configure_api_key(api_key)
    except Exception as e:
        return jsonify({'success': False, 'error': f'Could not validate key: {str(e)}'}), 400

    # Persist to .env file
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    try:
        if os.path.exists(env_path):
            with open(env_path, 'r') as f:
                lines = f.readlines()
            with open(env_path, 'w') as f:
                found = False
                for line in lines:
                    if line.startswith('OPENROUTER_API_KEY='):
                        f.write(f'OPENROUTER_API_KEY={api_key}\n')
                        found = True
                    else:
                        f.write(line)
                if not found:
                    f.write(f'OPENROUTER_API_KEY={api_key}\n')
        else:
            with open(env_path, 'w') as f:
                f.write(f'OPENROUTER_API_KEY={api_key}\n')
    except Exception as e:
        # Key is in memory even if file write fails
        pass

    return jsonify({'success': True})


# ──────────────────────────────────────────────
# PAGE ROUTES
# ──────────────────────────────────────────────

@app.route('/')
def index():
    """Landing page with topic selection."""
    return render_template('index.html')


@app.route('/learn/<session_id>')
def learn(session_id):
    """Active learning session page."""
    learning_session = LearningSession.query.get_or_404(session_id)
    return render_template('session.html', session=learning_session)


@app.route('/history')
def history():
    """Session history page."""
    return render_template('history.html')


@app.route('/review/<session_id>')
def review(session_id):
    """Review a completed session."""
    learning_session = LearningSession.query.get_or_404(session_id)
    return render_template('review.html', session=learning_session)


# ──────────────────────────────────────────────
# API ROUTES
# ──────────────────────────────────────────────

@app.route('/api/session/start', methods=['POST'])
def api_start_session():
    """Start a new Socratic learning session."""
    data = request.get_json()
    topic = data.get('topic', '').strip()
    context = data.get('context', '').strip()
    
    if not topic:
        return jsonify({'success': False, 'error': 'Topic is required'}), 400
    
    # Generate the first Socratic question
    result = ai_start_session(topic, context)
    
    if not result['success']:
        return jsonify(result), 500
    
    # Create session in database
    session_id = str(uuid.uuid4())
    ai_data = result['data']
    
    learning_session = LearningSession(
        id=session_id,
        topic=topic,
        context=context,
        conversation_history=[
            {
                "role": "assistant",
                "content": ai_data
            }
        ]
    )
    
    # Create the first exchange
    exchange = Exchange(
        session_id=session_id,
        exchange_number=1,
        question=ai_data.get('question', ''),
        difficulty_level=ai_data.get('difficulty_level', 'foundational'),
        understanding_score=ai_data.get('understanding_score', 0)
    )
    
    db.session.add(learning_session)
    db.session.add(exchange)
    db.session.commit()
    
    return jsonify({
        'success': True,
        'session_id': session_id,
        'data': ai_data
    })


@app.route('/api/session/<session_id>/respond', methods=['POST'])
def api_respond(session_id):
    """Submit a student response and get the next Socratic question."""
    learning_session = LearningSession.query.get_or_404(session_id)
    data = request.get_json()
    student_response = data.get('response', '').strip()
    
    if not student_response:
        return jsonify({'success': False, 'error': 'Response is required'}), 400
    
    # Get conversation history
    conv_history = learning_session.conversation_history
    
    # Add student response to history
    conv_history.append({
        "role": "user",
        "content": student_response
    })
    
    # Get next Socratic question
    result = continue_dialogue(learning_session.topic, conv_history, student_response)
    
    if not result['success']:
        return jsonify(result), 500
    
    ai_data = result['data']
    
    # Add AI response to history
    conv_history.append({
        "role": "assistant",
        "content": ai_data
    })
    
    # Update session
    learning_session.conversation_history = conv_history
    learning_session.total_exchanges += 1
    
    score = ai_data.get('understanding_score', 0)
    if score > learning_session.final_understanding_score:
        learning_session.final_understanding_score = score
    
    difficulty = ai_data.get('difficulty_level', 'foundational')
    difficulty_order = ['foundational', 'intermediate', 'advanced', 'mastery']
    current_idx = difficulty_order.index(learning_session.highest_difficulty) if learning_session.highest_difficulty in difficulty_order else 0
    new_idx = difficulty_order.index(difficulty) if difficulty in difficulty_order else 0
    if new_idx > current_idx:
        learning_session.highest_difficulty = difficulty
    
    # Update the latest exchange with student response
    latest_exchange = Exchange.query.filter_by(
        session_id=session_id
    ).order_by(Exchange.exchange_number.desc()).first()
    
    if latest_exchange and not latest_exchange.student_response:
        latest_exchange.student_response = student_response
        latest_exchange.understanding_score = score
        latest_exchange.correct_insights_json = json.dumps(
            ai_data.get('understanding_signals', {}).get('correct_insights', [])
        )
        latest_exchange.misconceptions_json = json.dumps(
            ai_data.get('understanding_signals', {}).get('misconceptions', [])
        )
        latest_exchange.gaps_json = json.dumps(
            ai_data.get('understanding_signals', {}).get('gaps', [])
        )
    
    # Create new exchange for the next question
    new_exchange = Exchange(
        session_id=session_id,
        exchange_number=(latest_exchange.exchange_number + 1) if latest_exchange else 1,
        question=ai_data.get('question', ''),
        difficulty_level=difficulty,
        understanding_score=score
    )
    
    db.session.add(new_exchange)
    db.session.commit()
    
    return jsonify({
        'success': True,
        'data': ai_data
    })


@app.route('/api/session/<session_id>/hint', methods=['POST'])
def api_hint(session_id):
    """Get a hint for the current question."""
    learning_session = LearningSession.query.get_or_404(session_id)
    conv_history = learning_session.conversation_history
    
    # Get the current question
    current_question = ""
    for entry in reversed(conv_history):
        if entry["role"] == "assistant":
            content = entry["content"]
            current_question = content.get("question", "") if isinstance(content, dict) else content
            break
    
    result = get_hint(learning_session.topic, conv_history, current_question)
    
    if not result['success']:
        return jsonify(result), 500
    
    # Track hint usage
    learning_session.hints_used += 1
    
    latest_exchange = Exchange.query.filter_by(
        session_id=session_id
    ).order_by(Exchange.exchange_number.desc()).first()
    
    if latest_exchange:
        latest_exchange.hint_used = True
        latest_exchange.hint_text = result['data'].get('hint', '')
    
    db.session.commit()
    
    return jsonify({
        'success': True,
        'data': result['data']
    })


@app.route('/api/session/<session_id>/end', methods=['POST'])
def api_end_session(session_id):
    """End a learning session and generate summary."""
    learning_session = LearningSession.query.get_or_404(session_id)
    
    # Generate session summary
    conv_history = learning_session.conversation_history
    summary_result = generate_session_summary(learning_session.topic, conv_history)
    
    # Update session
    learning_session.is_active = False
    learning_session.ended_at = datetime.now(timezone.utc)
    
    if summary_result['success']:
        learning_session.summary = summary_result['data']
        overall = summary_result['data'].get('overall_understanding', learning_session.final_understanding_score)
        learning_session.final_understanding_score = overall
    
    # Update global stats
    stats = LearningStats.query.first()
    if stats:
        stats.total_sessions += 1
        stats.total_exchanges += learning_session.total_exchanges
        stats.total_learning_minutes += learning_session.duration_minutes
        
        # Update average understanding
        all_sessions = LearningSession.query.filter_by(is_active=False).all()
        if all_sessions:
            avg = sum(s.final_understanding_score for s in all_sessions) / len(all_sessions)
            stats.average_understanding = avg
        
        # Track topics
        topics = stats.topics_list
        if learning_session.topic not in topics:
            topics.append(learning_session.topic)
            stats.topics_explored = json.dumps(topics)
        
        stats.last_session_date = datetime.now(timezone.utc)
    
    db.session.commit()
    
    return jsonify({
        'success': True,
        'summary': summary_result.get('data', {}),
        'session': learning_session.to_dict()
    })


@app.route('/api/session/<session_id>', methods=['GET'])
def api_get_session(session_id):
    """Get session details."""
    learning_session = LearningSession.query.get_or_404(session_id)
    return jsonify({
        'success': True,
        'session': learning_session.to_dict()
    })


@app.route('/api/sessions', methods=['GET'])
def api_get_sessions():
    """Get all sessions, ordered by most recent."""
    sessions = LearningSession.query.order_by(LearningSession.started_at.desc()).all()
    return jsonify({
        'success': True,
        'sessions': [s.to_dict() for s in sessions]
    })


@app.route('/api/stats', methods=['GET'])
def api_get_stats():
    """Get overall learning statistics."""
    stats = LearningStats.query.first()
    if not stats:
        return jsonify({'success': True, 'stats': {}})
    return jsonify({
        'success': True,
        'stats': stats.to_dict()
    })


@app.route('/api/suggestions', methods=['GET'])
def api_get_suggestions():
    """Get topic suggestions."""
    interests = request.args.get('interests', '')
    result = generate_topic_suggestions(interests)
    return jsonify(result)


@app.route('/api/session/<session_id>', methods=['DELETE'])
def api_delete_session(session_id):
    """Delete a session."""
    learning_session = LearningSession.query.get_or_404(session_id)
    db.session.delete(learning_session)
    db.session.commit()
    return jsonify({'success': True})


# ──────────────────────────────────────────────
# ERROR HANDLERS
# ──────────────────────────────────────────────

@app.errorhandler(404)
def not_found(e):
    if request.path.startswith('/api/'):
        return jsonify({'success': False, 'error': 'Not found'}), 404
    return render_template('index.html'), 404


@app.errorhandler(500)
def server_error(e):
    if request.path.startswith('/api/'):
        return jsonify({'success': False, 'error': 'Internal server error'}), 500
    return render_template('index.html'), 500


if __name__ == '__main__':
    app.run(debug=True, port=5000)
