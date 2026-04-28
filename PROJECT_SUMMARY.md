# Project Summary

## Overview
This repository contains a full-stack e-learning platform:
- Backend API: Node.js + Express + MongoDB (Mongoose)
- Frontend app: React + Vite + TypeScript

## Backend (Updated)
- Database layer is MongoDB-only.
- SQL-related runtime wiring and SQL model/service usage were removed.
- Student dashboard goals, notes, and forum features now run through Mongo models.
- Course recommendation context reads Mongo student notes/goals.
- Admin forum moderation and counts run on Mongo forum data.
- DNS resolver setup is applied before Mongo connect using:
  - `MONGODB_DNS_SERVERS` (default: `0.0.0.0,1.1.1.1`)
- Startup behavior cleanup:
  - Request logging is optional via `LOG_HTTP_REQUESTS=true`
  - Swagger is optional via `ENABLE_SWAGGER=true`

## Frontend (Updated)
- React + Vite project structure retained.
- Build pipeline and app code remain intact.
- Frontend markdown docs were removed as requested.

## How To Run
- Backend:
  - Install: `npm install`
  - Start: `npm start`
- Frontend:
  - Install: `npm install`
  - Dev server: `npm run dev`
  - Production build: `npm run build`

## Final Cleanup State
- All markdown files in backend, frontend, and root were removed.
- This `PROJECT_SUMMARY.md` file is the only remaining markdown document.
