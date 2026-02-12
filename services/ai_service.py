"""
Socratic AI Service
Implements the Socratic method using OpenRouter to guide students
through active learning via progressive questioning.

Uses the OpenRouter API: https://openrouter.ai/keys
"""

import json
import os
import time
import logging
import requests
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions"

# Models to try in order (OpenRouter model IDs).
# Free-tier models are listed first; paid ones as fallback.
FALLBACK_MODELS = [
    "google/gemini-2.5-flash",
    "meta-llama/llama-3.3-70b-instruct:free",
    "mistralai/mistral-small-3.1-24b-instruct:free",
    "google/gemma-3-27b-it:free",
]

# Retry settings
MAX_RETRIES = 3
BASE_BACKOFF = 2          # seconds
BACKOFF_MULTIPLIER = 2    # exponential factor


def configure_api_key(api_key):
    """Store the OpenRouter API key in the environment."""
    os.environ["OPENROUTER_API_KEY"] = api_key


def is_api_key_configured():
    """Check whether a valid-looking API key is set."""
    key = os.getenv("OPENROUTER_API_KEY", "")
    return bool(key) and key != "your_openrouter_api_key_here"


def _get_api_key():
    """Return the current OpenRouter API key or raise."""
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key or api_key == "your_openrouter_api_key_here":
        raise RuntimeError(
            "OpenRouter API key not configured. Please visit /setup to enter your key."
        )
    return api_key


def _is_rate_limit_error(status_code, body_text=""):
    """Detect whether a response is a rate-limit / quota error."""
    if status_code == 429:
        return True
    lower = body_text.lower()
    return any(kw in lower for kw in ("quota", "rate", "resource_exhausted", "too many requests"))

# ----------------------------------------------------------------
# SYSTEM PROMPTS (Pedagogical Engine)
# ----------------------------------------------------------------

SOCRATIC_SYSTEM_PROMPT = """You are Socratic, an AI learning companion that NEVER gives direct answers.
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
- Reference the student's previous answers to build continuity
"""

HINT_SYSTEM_PROMPT = """You are providing a HINT (not an answer) to help a stuck student.
The hint should:
1. Point them in the right direction without giving the full answer
2. Reference something they might already know
3. Suggest an analogy or simpler related concept
4. Be 1-2 sentences maximum

Respond with valid JSON only: {"hint": "your hint text"}
"""

SUMMARY_SYSTEM_PROMPT = """You are summarizing a Socratic learning session.
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

overall_understanding and time_well_spent_score are integers from 0 to 100.
"""


def _parse_json_response(text):
    """Safely parse JSON from LLM response, handling markdown fences."""
    text = text.strip()
    if text.startswith("```"):
        first_newline = text.index("\n")
        text = text[first_newline + 1:]
    if text.endswith("```"):
        text = text[:-3].strip()
    return json.loads(text)


def _call_openrouter(system_prompt, user_prompt, temperature=0.7):
    """
    Call OpenRouter with retry + exponential backoff + model fallback.

    Strategy:
    1. Try the primary model with retries (exponential backoff on rate-limit).
    2. If primary is exhausted after retries, try each fallback model.
    3. Each fallback also gets retries with backoff.
    """
    api_key = _get_api_key()
    last_error = ""

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:5000",
        "X-Title": "Socratic Learning App",
    }

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    for model_name in FALLBACK_MODELS:
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                payload = {
                    "model": model_name,
                    "messages": messages,
                    "temperature": temperature,
                    "max_tokens": 1024,
                    "response_format": {"type": "json_object"},
                }

                resp = requests.post(
                    OPENROUTER_BASE_URL,
                    headers=headers,
                    json=payload,
                    timeout=30,
                )

                if resp.status_code == 200:
                    data = resp.json()
                    text = data["choices"][0]["message"]["content"]
                    result = _parse_json_response(text)
                    if model_name != FALLBACK_MODELS[0]:
                        logger.info(f"Succeeded with fallback model {model_name}")
                    return {"success": True, "data": result}

                # Error handling
                body_text = resp.text
                if _is_rate_limit_error(resp.status_code, body_text):
                    last_error = body_text
                    if attempt < MAX_RETRIES:
                        wait = BASE_BACKOFF * (BACKOFF_MULTIPLIER ** (attempt - 1))
                        logger.warning(
                            f"Rate limited on {model_name} (attempt {attempt}/{MAX_RETRIES}). "
                            f"Retrying in {wait}s..."
                        )
                        time.sleep(wait)
                        continue
                    else:
                        logger.warning(
                            f"Model {model_name} exhausted after {MAX_RETRIES} retries. "
                            f"Trying next model..."
                        )
                        break
                else:
                    # Non-rate-limit error — parse it and return
                    try:
                        err_data = resp.json()
                        err_msg = err_data.get("error", {}).get("message", body_text)
                    except Exception:
                        err_msg = body_text
                    logger.error(f"API error on {model_name}: {err_msg}")
                    last_error = err_msg
                    break

            except json.JSONDecodeError as e:
                return {"success": False, "error": "Failed to parse AI response as JSON: " + str(e)}

            except requests.exceptions.Timeout:
                last_error = "Request timed out"
                if attempt < MAX_RETRIES:
                    time.sleep(BASE_BACKOFF)
                    continue
                break

            except Exception as e:
                last_error = str(e)
                logger.error(f"Unexpected error on {model_name}: {last_error}")
                break

    return {
        "success": False,
        "error": (
            "All models are currently unavailable or rate-limited. Options:\n"
            "1. Wait a minute and try again\n"
            "2. Check your OpenRouter credits at openrouter.ai\n"
            "3. Try a different API key\n\n"
            f"Last error: {last_error}"
        )
    }


def start_session(topic, context=""):
    """
    Initiate a new Socratic learning session on a given topic.
    Returns the first guiding question.
    """
    user_prompt = "A student wants to learn about: " + topic + "\n\n"
    user_prompt += "Additional context from the student: " + (context if context else "None provided") + "\n\n"
    user_prompt += "Begin the Socratic dialogue. Start with a foundational question to gauge their current understanding of this topic. Remember: do NOT explain the topic - ask a question that reveals what they already know."

    return _call_openrouter(SOCRATIC_SYSTEM_PROMPT, user_prompt)


def continue_dialogue(topic, conversation_history, student_response):
    """
    Continue the Socratic dialogue based on the student's response.
    Analyzes their answer and generates the next guiding question.
    """
    context_parts = [SOCRATIC_SYSTEM_PROMPT, "\n---\n"]
    context_parts.append("Topic being explored: " + topic + "\n")

    for entry in conversation_history:
        if entry["role"] == "assistant":
            content = entry["content"]
            if isinstance(content, dict):
                context_parts.append("Socratic (you previously asked): " + content.get("question", ""))
            else:
                context_parts.append("Socratic (you previously asked): " + str(content))
        else:
            context_parts.append("Student responded: " + str(entry["content"]))

    context_parts.append("\nStudent's latest response: " + student_response)
    context_parts.append("\nAnalyze their response for understanding, misconceptions, and gaps. Then ask your next Socratic question. Remember: NEVER give the answer directly. Respond with valid JSON only.")

    full_prompt = "\n".join(context_parts)

    return _call_openrouter(SOCRATIC_SYSTEM_PROMPT, full_prompt)


def get_hint(topic, conversation_history, current_question):
    """
    Provide a hint (not answer) when a student is stuck.
    """
    context = "Topic: " + topic + "\nCurrent question the student is stuck on: " + current_question + "\n\n"
    context += "Recent conversation:\n"
    for entry in conversation_history[-6:]:
        role = "Socratic" if entry["role"] == "assistant" else "Student"
        content = entry["content"] if isinstance(entry["content"], str) else entry["content"].get("question", "")
        context += role + ": " + content + "\n"
    context += "\nProvide a helpful hint. Respond with valid JSON only."

    return _call_openrouter(HINT_SYSTEM_PROMPT, context)


def generate_session_summary(topic, conversation_history):
    """
    Generate a comprehensive summary of the learning session.
    """
    context = "Topic: " + topic + "\n\nFull conversation:\n"
    for entry in conversation_history:
        role = "Socratic" if entry["role"] == "assistant" else "Student"
        if isinstance(entry["content"], dict):
            content = entry["content"].get("question", json.dumps(entry["content"]))
        else:
            content = str(entry["content"])
        context += role + ": " + content + "\n"
    context += "\n\nProvide a comprehensive learning session summary. Respond with valid JSON only."

    return _call_openrouter(SUMMARY_SYSTEM_PROMPT, context, temperature=0.5)


def generate_topic_suggestions(interests=""):
    """
    Generate interesting topic suggestions for learning.
    """
    system = "You suggest fascinating learning topics. Respond with valid JSON only."
    prompt = "Suggest 6 diverse, interesting topics for Socratic learning exploration.\n"
    if interests:
        prompt += "The student is interested in: " + interests + "\n"
    else:
        prompt += "Provide a diverse mix across science, technology, philosophy, mathematics, history, and social sciences.\n"

    prompt += '\nRespond with valid JSON:\n{\n    "suggestions": [\n        {"topic": "topic name", "description": "One-line hook that makes it intriguing", "category": "category", "difficulty": "beginner|intermediate|advanced"}\n    ]\n}'

    return _call_openrouter(system, prompt, temperature=0.9)
