# NoteSync AI

A production-grade Real-Time Collaborative Notes and Drawing Application. Built with React, Node.js, Socket.io, MongoDB, and Groq (LLaMA 3.1).

## Features

- **Real-Time Collaboration**: Multiple users can edit notes simultaneously with live syncing via Socket.io.
- **Infinite Canvas Vector Drawing**: Draw, highlight, and collaborate visually in real-time.
- **AI Workspace Assistant**: An integrated group chat where mentioning `@ai` summons a LLaMA 3.1 assistant (via Groq API) that answers questions based on the document's content and chat history.
- **Authentication**: Secure JWT-based login/signup with bcrypt.
- **Load-Tested Architecture**: Configured with a `k6` load testing suite capable of simulating concurrent virtual users broadcasting rapid vector drawing points.

## Tech Stack

- **Frontend**: React 19 (Vite), React Router v7, Socket.io Client, Lucide React, Axios
- **Backend**: Node.js, Express, Socket.io, Groq SDK
- **Database**: MongoDB (Mongoose)

## Setup Instructions

### Prerequisites
- Node.js (v18+)
- MongoDB connection string.
- Groq API Key.

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
   Create a `.env` file in the `server` directory:
   ```env
   PORT=5000
   MONGO_URI=your_mongodb_connection_string
   JWT_SECRET=your_jwt_secret
   GROQ_API_KEY=your_groq_api_key
   FRONTEND_URL=http://localhost:5173
   ```
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
   Create a `.env` file in the `client` directory:
   ```env
   VITE_BACKEND_URL=http://localhost:5000
   ```
4. Start the client:
   ```bash
   npm run dev
   ```
   Client runs on http://localhost:5173

### 3. Load Testing (Optional)

To benchmark the WebSocket server's performance:
1. Ensure [k6](https://k6.io/) is installed.
2. Run the load test from the root directory:
   ```bash
   k6 run load_test.js
   ```

## Usage

1. Open http://localhost:5173
2. Sign up for a new account.
3. Create a new note from the dashboard.
4. Share the URL with other users for real-time collaborative editing and drawing.
5. Open the chat panel and mention `@ai` to get contextual help from the LLaMA 3.1 assistant!
