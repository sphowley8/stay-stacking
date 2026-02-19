# Posterior Tibialis Recovery Tracker App – Wireframe

## Core Philosophy

This is not a generic fitness tracker.

This is a **tendon load-response tracker**.

It answers one question daily:

> Is my posterior tib adapting or becoming more reactive?

Everything in the app supports that.

---

# 1. Home Screen (Today Dashboard)

## Morning Check-In (Most Important)

- **Morning Stiffness** (0–10 slider)
- **Morning Pain** (0–10 slider)
- **Tender to Touch?** (Yes/No)
- **Arch Feels:** Stable / Fatigued / Collapsing

### Display:
- 7-day rolling trend graph
- Status indicator:
  - 🟢 Adapting
  - 🟡 Watch Load
  - 🔴 Reduce Density

### Logic:
- 3-day upward stiffness trend → 🟡
- 5-day upward trend → 🔴

---

## Today’s Plan (Auto-Suggested)

- ☐ Trail Run
- ☐ Cycling
- ☐ Strength
- ☐ Shockwave
- ☐ Recovery session

Based on previous load + trend.

---

## Recovery Score (Auto-Calculated)

Example formula:

Recovery Score =
Morning Trend
+ Yesterday Load Density
+ Sleep
+ Soreness

Displayed as:
- 🟢 Adapting
- 🟡 Watch Load
- 🔴 Reduce Density

---

# 2. Daily Load Entry Screen

## A. Trail Run Log

- Duration (minutes)
- Vertical gain (ft or m)
- Downhill intensity (Easy / Moderate / Hard)
- Terrain (Smooth / Technical / Off-camber)
- Pain during run (0–10)

---

## B. Cycling Log

- Duration
- Resistance (Low / Moderate / High)
- Arch discomfort during (0–10)

---

## C. Strength Log

Checkboxes:
- ☐ Isometrics
- ☐ Double-leg slow raises
- ☐ Single-leg slow raises
- ☐ Weighted raises
- ☐ Bands

Fields:
- Sets / reps
- Pain during (0–10)

---

## D. Shockwave

- ☐ Yes
- Session #
- Irritation afterward (0–10)

---

## E. Recovery Modalities

- ☐ Contrast bath
- ☐ Theragun
- ☐ Graston
- ☐ Stretching
- ☐ Supportive shoes indoors (Y/N)

---

# 3. Weekly Trends Page

## Questions This Page Answers:
- Is capacity improving?
- Is load increasing safely?
- Are flare-ups predictable?

### Graphs:
- Morning stiffness trend (line graph)
- Weekly vertical gain
- Strength progression
- Shockwave sessions

Highlight:
- Flare weeks automatically

---

# 4. Flare Detection Logic

Trigger alert if:

Morning stiffness ↑ 3 consecutive days  
AND  
Load density high in previous 48h  

Auto-popup suggestion:

"Reduce downhill volume by 30% for 3–5 days."

---

# 5. Weekly Layout View

Example calendar:

| Day | Activity |
|------|----------|
| Mon | Trail (1k vert) |
| Tue | Strength only |
| Wed | Cycling |
| Thu | Trail (2k vert) |
| Fri | Recovery |
| Sat | Strength |
| Sun | Light cycling |

Smart suggestion:

"Separate heavy eccentrics from long downhill by 24h."

---

# 6. Capacity Milestones

Track long-term tendon capacity:

- Max single-leg heel raise reps
- Weight used in calf raises
- Max vert tolerated without flare
- Longest run pain-free

This shows tendon strengthening over months.

---

# 7. Load Density Index (LDI)

Instead of tracking just volume, calculate **Load Density**.

Example:

LDI =
(Vert Score + Strength Score + Cycling Score)
÷
Recovery Interventions

Higher LDI → higher flare risk.

---

# Example Daily Flow

Morning:
- Stiffness = 3
- Trend slightly up → 🟡

During Day:
- Log trail run
- Log cycling

Evening:
- Log contrast + Theragun

Next Morning:
- Stiffness = 2
- Trend improving → 🟢

Over time, you learn what works.

---

# Basic Text Wireframe

HOME
---------------------------------
Morning Stiffness: [ 2 ] slider
Pain: [ 1 ]
Arch Status: Stable

7-Day Trend Graph

Today’s Plan:
☐ Isometrics
☐ Trail 60min / 1k
☐ Contrast

Recovery Status: 🟢 Adapting
---------------------------------

DAILY LOG
---------------------------------
Trail:
Duration: ___
Vert: ___
Downhill intensity: ___
Pain: ___

Cycling:
Duration: ___
Resistance: ___

Strength:
☐ Isometrics
☐ Double-leg raises
☐ Single-leg raises
Weight: ___

Shockwave:
☐ Yes
Irritation: ___

Recovery:
☐ Contrast
☐ Theragun
☐ Supportive shoes
---------------------------------

---

# Advanced Feature Ideas

- Toggle: Reactive Phase / Capacity Phase
- Auto-warning for:
  - Trail + heavy eccentrics same day
  - Shockwave + heavy loading same day
  - Two high-vert days back-to-back
- Trend-based load recommendations
- “Return to 3k vert readiness” indicator
