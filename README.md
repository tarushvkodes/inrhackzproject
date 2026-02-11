# Socratic — AI-Powered Active Learning Through Guided Discovery

> An AI companion that **never gives answers** — only the questions that lead you to them.

![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Ready-brightgreen?logo=github)
![Gemini](https://img.shields.io/badge/Google%20Gemini-Free%20API-orange?logo=google)
![No Server](https://img.shields.io/badge/Server-Not%20Required-blue)

---

## The Problem

Every AI education tool **gives answers**. But decades of research consistently show that students retain 2-3x more when they **discover answers themselves** through guided questioning — the Socratic method. No tool implements this properly.

## The Solution

**Socratic** is an AI learning companion that implements the Socratic method through:

1. **Never giving direct answers** — always responding with guiding questions
2. **Progressive difficulty** — adapting from foundational → intermediate → advanced → mastery
3. **Misconception detection** — identifying and gently exposing flawed reasoning
4. **Real-time understanding tracking** — quantifying comprehension with a live score
5. **Session summaries** — AI-generated learning reports with discovered insights

## Why It's Different

| Feature | Typical AI Tools | Socratic |
|---------|-----------------|----------|
| Approach | Gives answers directly | Guides to discovery via questions |
| Learning model | Passive consumption | Active construction of knowledge |
| Misconceptions | Ignored or corrected bluntly | Detected and gently probed |
| Progress tracking | Quiz scores | Multi-dimensional understanding signals |
| Pedagogy | None specific | Implements the Socratic method |

## Tech Stack

- **Hosting:** GitHub Pages (static site — no server needed!)
- **AI Engine:** Google Gemini API (free tier), called directly from the browser
- **Storage:** Browser localStorage (all data stays on your machine)
- **Frontend:** Vanilla HTML/CSS/JS (no framework dependencies)

## Quick Start

### Option 1: Use on GitHub Pages (recommended)

1. Fork or push this repo to GitHub
2. Go to **Settings → Pages** and set the source to the `main` branch (root `/`)
3. Visit your GitHub Pages URL
4. On first visit, you'll be prompted to enter your **free Gemini API key**

### Option 2: Run Locally

Just open `index.html` in your browser — no server needed!

```bash
# Clone the repo
git clone https://github.com/your-username/inrhackzproject.git
cd inrhackzproject

# Open in browser (any of these work)
open index.html          # macOS
start index.html         # Windows
xdg-open index.html      # Linux
```

### Getting a Free API Key

1. Visit [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Sign in with your Google account
3. Click **"Create API key"**
4. Paste it into Socratic when prompted

> **Privacy:** Your API key is stored only in your browser's localStorage. It is never sent anywhere except directly to Google's Gemini API. You can clear it anytime from Settings.

## How It Works

### Learning Flow
1. Enter any topic you want to understand
2. Socratic asks a **foundational question** to gauge your baseline
3. You respond with your reasoning (not just "yes/no")
4. Socratic analyzes your response for:
   - **Correct insights** (acknowledged, then pushed deeper)
   - **Misconceptions** (probed with counter-questions)
   - **Knowledge gaps** (addressed through simpler sub-questions)
5. Difficulty progressively increases as understanding grows
6. End the session to receive a comprehensive learning summary

### Key Features
- **Understanding Gauge:** Live circular progress showing your comprehension (0-100%)
- **Difficulty Progression:** Visual tracker from Foundational → Mastery
- **Hint System:** Get directional hints (not answers) when stuck
- **Learning Insights Panel:** Real-time view of your correct insights, misconceptions, and gaps
- **Session Summaries:** AI-generated analysis of what you discovered, what you missed, and what to explore next
- **Learning History:** Track all past sessions with stats and conversation replay
- **API Settings:** Configure your API key, model, and temperature from the Settings panel

## Project Structure

```
inrhackzproject/
├── index.html                # Landing page
├── session.html              # Active learning session
├── history.html              # Session history
├── review.html               # Session review/summary
├── css/
│   └── style.css             # Complete stylesheet
└── js/
    ├── storage.js            # localStorage data layer
    ├── gemini-api.js         # Client-side Gemini API service
    ├── index.js              # Landing page logic
    ├── session.js            # Session interaction logic
    ├── history.js            # History page logic
    └── review.js             # Review page logic
```

## The AI Engine

The core innovation is in the **system prompt engineering** within `js/gemini-api.js`. The AI is constrained to:

- **Never answer directly** — every response is a question
- **Track understanding signals** — correct insights, misconceptions, gaps
- **Score comprehension** — 0-100 understanding metric per exchange
- **Adapt difficulty** — automatically progress or regress based on performance
- **Follow pedagogical principles** — Bloom's taxonomy-aligned difficulty levels

All AI responses are structured JSON, enabling the frontend to parse and visualize learning progress in real-time.

## Settings

Click the **⚙️ Settings** button on the main page to:

- **Change your API key** — update or replace your Gemini API key
- **Switch models** — choose between Gemini 2.0 Flash, Flash Lite, 1.5 Flash, or 1.5 Pro
- **Adjust temperature** — control how creative vs. focused the AI responses are
- **Clear all data** — reset everything including session history and API key

## License

MIT — Built for the Studygy AI App Hackathon
