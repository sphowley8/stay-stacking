# StayStacking — Feature Ideas

## Mock Activity Simulator
Add a "what if?" mode where you can add a hypothetical activity (type, distance, duration, pace) and see how it would affect your weekly load ratios before committing to it. Useful for planning a long run or a hard workout when you're on the edge of overtraining.

## Load Ratios (Muscular, Aerobic, Injury)
Introduce three distinct load scores per week, each with their own rolling average and acute:chronic ratio:
- **Aerobic load** — time in HR zones 3–5, distance, elevation
- **Muscular load** — vertical gain, high-grade time, hard efforts (pace zones 5–7)
- **Injury risk load** — rapid week-over-week load spikes, consecutive hard days, check-in pain scores

Surface each as a color-coded gauge (green / yellow / red) so athletes can see at a glance which system is being stressed.

## Injury Root Cause Analysis (Claude)
When a user opens an injury case, pull the last 4 weeks of activity data (load, pace zones, HR zones, elevation, mileage) and send it to Claude with a prompt to identify what changed in their training that may have contributed — e.g. sudden mileage spike, increase in high-grade time, back-to-back hard days. Surface the response as a plain-language summary inside the injury case.

## Data Export
Create a mechanism to download your data — activities, check-ins, training plan entries, and load history — as a CSV or JSON file. The export serves a dual purpose: users own their data and can take it with them, and it reduces the app's storage overhead by giving users a way to archive their history locally rather than requiring the app to retain it indefinitely.

## README Problem Statement
Add a concise "Problem Statement / What We're Solving" bullet list near the top of README.md so visitors immediately understand the pain point the app addresses.

With so much fun to be had in the mountains with friends — running, cycling, big mountain adventures, etc, etc — it's easy to get carried away sometimes. How can I possibly balance the interplay of these ad-hoc activities with a training cycle without ending up sidelined? StayStacking was my best stab at that.
