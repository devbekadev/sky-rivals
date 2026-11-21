# Sky Rivals

A React flappy-bird-style multiplayer race. Vite serves the React client, Socket.IO handles matchmaking and live opponent state, and Supabase stores the leaderboard.

## Run locally

1. Install Node.js 18 or newer.
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env`. The Supabase URL is prefilled for project `ofxzrhzvhbngvhnzjnwa`; add the project's **service role key** to enable the persistent leaderboard. The game and matchmaking also work without Supabase.
4. In one terminal, run the Socket.IO server: `npm run server`
5. In another terminal, run the React client: `npm run dev`
6. Open the Vite URL in two browser windows to test matchmaking.

Run `supabase/schema.sql` in the Supabase SQL editor to create the scores table. The service role key must stay in the server `.env`; do not add it to a `VITE_` variable or commit it.

To host the client and server on different origins, set `CLIENT_ORIGIN` to the exact client origin in the server environment and set `VITE_SOCKET_URL` to the Socket.IO server URL when building the client.

## Gameplay

- Click or press **Space** / **Arrow Up** to flap.
- Each gate passed adds one point; touching a pipe or the ground ends your flight.
- The game matches two connected players in a shared, seeded flight course.
