# TendonLoad – Multi-Dimensional Load Tracking Web App

A web application for tracking **Aerobic, Muscular, and Injury Load** in endurance athletes, with a focus on intelligent load management and injury prevention.

This system integrates activity data (e.g., Strava), user-entered symptom tracking, and recovery interventions to provide actionable load insights across multiple physiological domains.

---

# Project Vision

Endurance athletes often track:

- Mileage
- Vert
- Time
- Heart rate
- Strength work

But they rarely track:

- Load density across systems
- Muscular strain accumulation
- Injury reactivity trends
- Recovery tool effectiveness

**TendonLoad** aims to unify these into a single dashboard with three dedicated load views:

1. **Aerobic Load**
2. **Muscular Load**
3. **Injury Load**

Each load type has:

- A dedicated view
- A custom Load Index
- Daily & weekly trend graphs
- Consistent weekly stats (vert / mileage / strength)

---

# High-Level Architecture

## Stack Overview

Frontend:
- HTML
- CSS
- Vanilla JS (or optionally lightweight framework like Svelte)
- Chart.js (or similar for graphing)

Backend:
- AWS Lambda (Node.js)
- API Gateway
- DynamoDB
- S3 (static hosting)
- CloudFront (optional CDN)
- Cognito (optional auth)

Infrastructure:
- Terraform (IaC)

External APIs:
- Strava API (OAuth + Activity Streams)

---

# Load Types & Calculation Strategy

---

# 1. Aerobic Load View

## Purpose

Measure total cardiovascular strain across all activities (Z1+).

If the athlete:
- Runs
- Hikes
- Climbs
- Cycles

All contribute to cumulative aerobic stress.

---

## Data Inputs

- Activity duration
- HR stream
- Athlete HR zones
- Time in each zone

---

## Aerobic Load Index (ALI)

### Option A (Simple)

ALI = Total minutes in Z1+

### Option B (Weighted)

ALI =  
(Z1 * 1.0) +  
(Z2 * 1.2) +  
(Z3 * 1.5) +  
(Z4 * 2.0) +  
(Z5 * 2.5)

This produces a daily aerobic stress score.

---

## View Layout

### Top Section
- Aerobic Load Index (Today)
- 7-day rolling total
- 4-week trend line

### Middle
- Graph: Daily ALI (line graph)
- Graph: Weekly ALI (bar graph)

### Bottom (Shared Across All Views)
- Weekly vert
- Weekly mileage
- Weekly strength sessions

---

# 2. Muscular Load View

## Purpose

Track mechanical strain placed on muscular system.

Excess sustained muscular load can:
- Increase hypertonicity
- Reduce ROM
- Increase tendon load
- Increase stress fracture risk

---

## Data Inputs

- Time in Z3–Z5
- Vertical gain
- Strength sessions
- Lifting load (optional weighted metric)

---

## Muscular Load Index (MLI)

Example formula:

MLI =
(High HR Minutes × 1.5)
+ (Vert / 100)
+ (Strength Score)

Where:

Strength Score =
- Bodyweight session = 10
- Heavy lifting session = 20
- Weighted eccentric session = 15

---

## View Layout

Top:
- Muscular Load Index (Today)
- Weekly cumulative MLI

Middle:
- Daily MLI trend
- 4-week muscular strain trend

Bottom:
- Weekly vert
- Weekly mileage
- Weekly strength count

---

# 3. Injury Load View

## Purpose

When injured, load management precision becomes critical.

This view tracks:
- Symptom progression
- Load density
- Recovery tools
- Correlation patterns

---

## Data Inputs

Morning:
- Stiffness (0–10)
- Pain (0–10)
- Arch stability status
- Tenderness (Y/N)

Evening:
- Pain (0–10)
- Fatigue (0–10)

Recovery tools:
- Ice
- Contrast
- Theragun
- Graston
- Shockwave
- Supportive shoes
- Stretching

Activity data:
- Vert
- Mileage
- Strength

---

## Injury Load Index (ILI)

Example:

ILI =
Morning Stiffness Trend (3-day avg)
+ Yesterday Load Density
- Recovery Intervention Score

Recovery Score example:
- Contrast = -1
- Ice = -1
- Shockwave = -2
- Theragun = -0.5

ILI outputs:
- 🟢 Adapting
- 🟡 Watch
- 🔴 Reduce Load

---

## View Layout

Top:
- Injury Status Indicator
- Morning stiffness graph (7-day trend)

Middle:
- Overlay graph:
  - Stiffness trend
  - Load density
  - Recovery tools markers

Bottom:
- Weekly vert
- Weekly mileage
- Weekly strength

---

# Shared Components Across All Views

Each view contains:

- Weekly Vert
- Weekly Mileage
- Weekly Strength Count
- 7-day Load Trend
- 4-week Load Trend

---

# AWS Infrastructure Plan

---

# Infrastructure Components

## S3
- Static site hosting
- Stores HTML/CSS/JS bundle

## CloudFront (Optional)
- CDN
- HTTPS

## API Gateway
- REST API endpoints

## Lambda Functions
- Fetch Strava data
- Process HR streams
- Compute load indices
- Store daily summaries

## DynamoDB Tables

### Users
- user_id
- strava_id
- hr_zones
- injury_status

### Activities
- activity_id
- date
- duration
- vert
- hr_stream_ref
- ALI
- MLI

### InjuryLogs
- date
- morning_stiffness
- pain
- recovery_tools
- ILI

---

# Terraform Structure

Recommended layout:

