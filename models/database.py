"""
Database models for Socratic learning sessions.
Uses Flask-SQLAlchemy for ORM.
"""

import json
from datetime import datetime, timezone
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


class LearningSession(db.Model):
    """Represents a single Socratic learning session."""
    __tablename__ = 'learning_sessions'
    
    id = db.Column(db.String(36), primary_key=True)
    topic = db.Column(db.String(500), nullable=False)
    context = db.Column(db.Text, default='')
    started_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    ended_at = db.Column(db.DateTime, nullable=True)
    is_active = db.Column(db.Boolean, default=True)
    
    # Metrics
    total_exchanges = db.Column(db.Integer, default=0)
    final_understanding_score = db.Column(db.Integer, default=0)
    highest_difficulty = db.Column(db.String(20), default='foundational')
    hints_used = db.Column(db.Integer, default=0)
    
    # Session summary (JSON)
    summary_json = db.Column(db.Text, nullable=True)
    
    # Conversation history (stored as JSON)
    conversation_json = db.Column(db.Text, default='[]')
    
    # Relationships
    exchanges = db.relationship('Exchange', backref='session', lazy=True, cascade='all, delete-orphan')
    
    @property
    def conversation_history(self):
        return json.loads(self.conversation_json) if self.conversation_json else []
    
    @conversation_history.setter
    def conversation_history(self, value):
        self.conversation_json = json.dumps(value)
    
    @property
    def summary(self):
        return json.loads(self.summary_json) if self.summary_json else None
    
    @summary.setter
    def summary(self, value):
        self.summary_json = json.dumps(value)
    
    @property
    def duration_minutes(self):
        end = self.ended_at or datetime.now(timezone.utc)
        if self.started_at.tzinfo is None:
            start = self.started_at
            if end.tzinfo is not None:
                end = end.replace(tzinfo=None)
        else:
            start = self.started_at
        delta = end - start
        return round(delta.total_seconds() / 60, 1)
    
    def to_dict(self):
        return {
            'id': self.id,
            'topic': self.topic,
            'context': self.context,
            'started_at': self.started_at.isoformat() if self.started_at else None,
            'ended_at': self.ended_at.isoformat() if self.ended_at else None,
            'is_active': self.is_active,
            'total_exchanges': self.total_exchanges,
            'final_understanding_score': self.final_understanding_score,
            'highest_difficulty': self.highest_difficulty,
            'hints_used': self.hints_used,
            'duration_minutes': self.duration_minutes,
            'summary': self.summary,
            'conversation_history': self.conversation_history
        }


class Exchange(db.Model):
    """Represents a single question-answer exchange in a session."""
    __tablename__ = 'exchanges'
    
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    session_id = db.Column(db.String(36), db.ForeignKey('learning_sessions.id'), nullable=False)
    exchange_number = db.Column(db.Integer, nullable=False)
    timestamp = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    
    # The Socratic question
    question = db.Column(db.Text, nullable=False)
    difficulty_level = db.Column(db.String(20), default='foundational')
    
    # The student's response
    student_response = db.Column(db.Text, nullable=True)
    
    # AI analysis of the response
    understanding_score = db.Column(db.Integer, default=0)
    correct_insights_json = db.Column(db.Text, default='[]')
    misconceptions_json = db.Column(db.Text, default='[]')
    gaps_json = db.Column(db.Text, default='[]')
    
    # Whether the student used a hint
    hint_used = db.Column(db.Boolean, default=False)
    hint_text = db.Column(db.Text, nullable=True)
    
    @property
    def correct_insights(self):
        return json.loads(self.correct_insights_json) if self.correct_insights_json else []
    
    @property
    def misconceptions(self):
        return json.loads(self.misconceptions_json) if self.misconceptions_json else []
    
    @property
    def gaps(self):
        return json.loads(self.gaps_json) if self.gaps_json else []
    
    def to_dict(self):
        return {
            'id': self.id,
            'exchange_number': self.exchange_number,
            'timestamp': self.timestamp.isoformat() if self.timestamp else None,
            'question': self.question,
            'difficulty_level': self.difficulty_level,
            'student_response': self.student_response,
            'understanding_score': self.understanding_score,
            'correct_insights': self.correct_insights,
            'misconceptions': self.misconceptions,
            'gaps': self.gaps,
            'hint_used': self.hint_used,
            'hint_text': self.hint_text
        }


class LearningStats(db.Model):
    """Aggregate learning statistics across all sessions."""
    __tablename__ = 'learning_stats'
    
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    total_sessions = db.Column(db.Integer, default=0)
    total_exchanges = db.Column(db.Integer, default=0)
    total_learning_minutes = db.Column(db.Float, default=0)
    average_understanding = db.Column(db.Float, default=0)
    topics_explored = db.Column(db.Text, default='[]')  # JSON array
    streak_days = db.Column(db.Integer, default=0)
    last_session_date = db.Column(db.DateTime, nullable=True)
    
    @property
    def topics_list(self):
        return json.loads(self.topics_explored) if self.topics_explored else []
    
    def to_dict(self):
        return {
            'total_sessions': self.total_sessions,
            'total_exchanges': self.total_exchanges,
            'total_learning_minutes': round(self.total_learning_minutes, 1),
            'average_understanding': round(self.average_understanding, 1),
            'topics_explored': self.topics_list,
            'streak_days': self.streak_days
        }
