# StayStacking – Multi-Dimensional Load Tracking Web App

StayStacking is a web application for tracking **Aerobic, Muscular, and Injury Load** in endurance athletes, with a focus on intelligent load management, injury prevention, and long-term performance compounding.

---

# The Meaning Behind the Name

**StayStacking** is based on the concept of **“stacking blocks.”**

A *block* represents a successful 10+ week training cycle.

When an athlete completes:
- One healthy training block → progress  
- Two healthy blocks → measurable gains  
- Five or more stacked blocks → compounding fitness improvements  

The idea is simple:

> Fitness compounds when consistency compounds.

The goal of StayStacking is not to maximize a single week.

It is to:
- Protect training continuity
- Prevent avoidable injuries
- Sustain progressive overload
- Enable multiple healthy blocks per year

Over time, stacked healthy blocks create exponential improvement.

---

# Project Vision

Endurance athletes often track:

- Mileage  
- Vert  
- Time  
- Heart rate  
- Strength work  

But they rarely track:

- Load density across physiological systems  
- Muscular strain accumulation  
- Injury reactivity trends  
- Recovery tool effectiveness  
- Block-to-block sustainability  

**StayStacking** unifies these into a single dashboard with three dedicated load views:

1. **Aerobic Load**
2. **Muscular Load**
3. **Injury Load**

Each load type has:

- A dedicated view  
- A custom Load Index  
- Daily & weekly trend graphs  
- Consistent weekly stats (vert / mileage / strength)  
- Context within the current training block  

---

# High-Level Architecture

## Stack Overview

Frontend:
- HTML  
- CSS  
- Vanilla JS (optionally Svelte later)  
- Chart.js (or similar lightweight charting library)  

Backend:
- AWS Lambda (Node.js)  
- API Gateway  
- DynamoDB  
- S3 (static hosting)  
- CloudFront (optional CDN)  
- Cognito (optional auth)  

Infrastructure:
- Terraform (Infrastructure as Code)

External APIs:
- Strava API (OAuth + Activity Streams)

---

# Core Concept: Multi-System Load Tracking

StayStacking separates stress into three systems because:

- Aerobic overload ≠ Muscular overload  
- Muscular overload ≠ Tendon overload  
- Tendon reactivity ≠ Cardiovascular fatigue  

Each system gets its own index, view, and trend tracking.

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

This helps prevent:

- Chronic under-recovery  
- Sleep disruption from high cumulative load  
- Aerobic overreach  

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
(Z1 × 1.0) +  
(Z2 × 1.2) +  
(Z3 × 1.5) +  
(Z4 × 2.0) +  
(Z5 × 2.5)

This produces a daily aerobic stress score.

---

## View Layout

Top Section:
- Aerobic Load Index (Today)  
- 7-day rolling total  
- 4-week trend line  

Middle:
- Graph: Daily ALI (line graph)  
- Graph: Weekly ALI (bar graph)  

Bottom (Shared Across All Views):
- Weekly vert  
- Weekly mileage  
- Weekly strength sessions  

---

# 2. Muscular Load View

## Purpose

Track mechanical strain placed on the muscular system.

Excess sustained muscular load can:

- Increase hypertonicity  
- Reduce range of motion  
- Increase tendon load  
- Increase stress fracture risk  

This view helps regulate muscular density within and across training blocks.

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
+ (Vert ÷ 100)  
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

When an injury occurs, precision in load management becomes critical.

This view tracks:

- Symptom progression  
- Load density  
- Recovery tools  
- Correlation patterns  
- Tendon reactivity trends  

The goal is to preserve the training block while protecting tissue capacity.

---

## Data Inputs

Morning:
- Stiffness (0–10)  
- Pain (0–10)  
- Stability status  
- Tenderness (Y/N)  

Evening:
- Pain (0–10)  
- Fatigue (0–10)  

Recovery tools:
- Ice  
- Contrast  
- Percussion gun  
- Graston scraping  
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
- Percussion = -0.5  

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
  - Recovery tool markers  

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
- Current Training Block Summary  

---

# Training Block Tracking (StayStacking Core Feature)

Each user defines:

- Block start date  
- Block target duration (10–16 weeks)  
- Primary goal (e.g., build vert tolerance, aerobic base, rehab tendon)  

The app tracks:

- % of block completed  
- Consistency score  
- Injury-free streak  
- Block load averages  

When a block completes:

- It is archived  
- Summary metrics are stored  
- Year-over-year block comparison becomes possible  

This reinforces the StayStacking philosophy:

Healthy blocks → Stacked blocks → Compounding fitness.

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
- active_block  
- injury_status  

### Activities
- activity_id  
- date  
- duration  
- vert  
- ALI  
- MLI  

### InjuryLogs
- date  
- morning_stiffness  
- pain  
- recovery_tools  
- ILI  

### TrainingBlocks
- block_id  
- start_date  
- end_date  
- goal  
- avg_ALI  
- avg_MLI  
- injury_days  

---

# Terraform Structure

Recommended layout:

/terraform  
  main.tf  
  variables.tf  
  outputs.tf  

  /modules  
    /s3  
    /lambda  
    /apigateway  
    /dynamodb  
    /cognito  

Deploy flow:

1. terraform init  
2. terraform plan  
3. terraform apply  

---

# API Endpoints (Example)

GET /activities  
POST /injury-log  
GET /load/aerobic  
GET /load/muscular  
GET /load/injury  
GET /weekly-summary  
POST /training-block  
GET /training-block/current  

---

# Data Processing Flow

1. User authenticates via Strava OAuth  
2. Backend pulls activities  
3. Fetch HR stream  
4. Compute:
   - Time in zone  
   - ALI  
   - MLI  
5. Store summarized metrics  
6. Frontend renders graphs  

---

# Cost Optimization Strategy

- Serverless only (no EC2)  
- DynamoDB on-demand  
- Lambda short execution time  
- Store summarized metrics (not full HR streams long-term)  
- Use S3 + CloudFront for static frontend  

Expected cost (small user base):
Low monthly cost during early stage.

---

# MVP Roadmap

Phase 1:
- Strava OAuth  
- Aerobic Load View  
- Basic trend graphs  

Phase 2:
- Muscular Load View  
- Vert-weighted model  

Phase 3:
- Injury tracking  
- Recovery correlation overlay  

Phase 4:
- Training block tracking  
- Block summaries  
- Compounding progress metrics  

Phase 5:
- Smart alerts  
- Load density warnings  
- Adaptive suggestions  

---

# Design Philosophy

StayStacking is not about maximizing a single workout.

It is about:

- Sustainable progression  
- System-specific stress awareness  
- Injury prevention through visibility  
- Training density control  
- Long-term compounding fitness  

The ultimate goal:

Keep stacking healthy training blocks.
