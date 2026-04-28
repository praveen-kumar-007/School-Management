# School Management E-Learning Project

This repository contains the backend API for the e-learning platform. The frontend project is located in `elearning-platform/` as a separate React + Vite application.

## Project structure

- `backend/` — Node.js backend API built with Express, MongoDB, Redis, Socket.IO, and Swagger support.
- `elearning-platform/` — Separate frontend application (React + Vite).

> Note: `elearning-platform/` is currently a nested repository and is excluded from the root repo index by design.

## Prerequisites

- Node.js 18+ or newer
- npm
- MongoDB instance
- Redis instance (optional but recommended for caching and token blacklisting)

## Running the backend

```powershell
cd backend
npm install
```

Create a `.env` file in `backend/` with the required environment variables.

### Recommended `.env` variables

```env
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/elearning
JWT_SECRET=your_jwt_secret
REFRESH_TOKEN_SECRET=your_refresh_token_secret
FRONTEND_URL=http://localhost:5173
ENABLE_SWAGGER=true
LOG_HTTP_REQUESTS=true
REDIS_URL=redis://localhost:6379
BACKUP_PATH=./backups
BACKUP_ENCRYPTION_KEY=your_backup_key
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=user@example.com
SMTP_PASS=supersecret
SMTP_FROM=no-reply@example.com
AI_API_URL=https://api.openai.com/v1/chat/completions
AI_API_KEY=your_ai_api_key
AI_MODEL=gpt-4o-mini
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_key
CLOUDINARY_API_SECRET=your_cloudinary_secret
```

### Start the backend

```powershell
cd backend
npm run dev
```

Or for production:

```powershell
cd backend
npm start
```

## Running the frontend

The frontend app is located in `elearning-platform/`.

```powershell
cd elearning-platform
npm install
npm run dev
```

Then open the URL shown by Vite (typically `http://localhost:5173`).

### Frontend commands

- `npm run dev` — start development server
- `npm run build` — build production assets
- `npm run preview` — preview built app
- `npm run test` — run unit tests
- `npm run cypress:open` — open Cypress UI
- `npm run lint` — check linting
- `npm run lint:fix` — fix lint issues automatically

## Notes

- The backend listens on `PORT` or defaults to `5000`.
- The frontend uses `VITE_` environment variables if needed.
- The root folder does not contain a top-level package manifest; backend and frontend are managed independently.

## Git

This repository is already connected to the configured `origin` remote.

```powershell
git status
git add README.md
git commit -m "docs: add root README with run instructions"
git push
```
