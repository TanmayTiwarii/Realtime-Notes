KO# Real-Time Collaborative Notes App

A production-grade Real-Time Collaborative Notes Application similar to Google Docs Lite. Built with React, Node.js, Socket.io, and Firebase.

## Features

- **Real-Time Collaboration**: Multiple users can edit notes simultaneously with live syncing.
- **Authentication**: Secure login/signup via Firebase Auth.
- **Presence**: See who is currently editing the note.
- **Sharing**: Share notes with other users via email.
- **Version History**: Track changes and revisions.
- **Dashboard**: Manage your personal and shared notes.

## Tech Stack

- **Frontend**: React (Vite), Socket.io Client, Firebase Client SDK, CSS
- **Backend**: Node.js, Express, Socket.io, Firebase Admin SDK
- **Database**: Firebase Firestore

## Setup Instructions

### Prerequisites
- Node.js (v14+)
- A Firebase Project with Firestore and Auth enabled.

### 1. Backend Setup

1. Navigate to the server directory:
   ```bash
   cd server
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure Environment Variables:
   - Copy `.env.example` to `.env`:
     ```bash
     cp .env.example .env
     ```
   - Fill in your Firebase Service Account details and other config.
     - `FIREBASE_PRIVATE_KEY`: Your service account private key (ensure newlines are handled correctly if pasting).
     - `FIREBASE_CLIENT_EMAIL`: Your service account email.
     - `FIREBASE_PROJECT_ID`: Your project ID.

4. Start the server:
   ```bash
   npm run dev
   ```
   Server runs on http://localhost:5000

### 2. Frontend Setup

1. Navigate to the client directory:
   ```bash
   cd client
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure Environment Variables:
   - Copy `.env.example` to `.env`:
     ```bash
     cp .env.example .env
     ```
   - Fill in your Firebase Web App config (API Key, Auth Domain, etc.).

4. Start the client:
   ```bash
   npm run dev
   ```
   Client runs on http://localhost:5173

## Usage

1. Open http://localhost:5173
2. Sign up for an account.
3. Create a new note from the dashboard.
4. Open the same note in a different browser/incognito window with a different account (or share it with the other email).
5. Type in one window and see changes appear instantly in the other!

## Environment Variables

### Server (.env)
```
PORT=5000
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY=...
FRONTEND_URL=http://localhost:5173
```

### Client (.env)
```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_BACKEND_URL=http://localhost:5000
```
