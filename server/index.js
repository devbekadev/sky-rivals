import "dotenv/config";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { createClient } from "@supabase/supabase-js";

const port = Number(process.env.PORT) || 3001;
const allowedOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

const httpServer = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, leaderboardConfigured: Boolean(supabase) }));
    return;
  }
  response.writeHead(404);
  response.end("Not found");
});

const io = new Server(httpServer, {
  cors: { origin: allowedOrigin, methods: ["GET", "POST"] },
});

const waiting = [];
const matches = new Map();
const playerRooms = new Map();

function cleanName(value) {
  if (typeof value !== "string") return "Sky pilot";
  const name = value.trim().replace(/[<>]/g, "").slice(0, 16);
  return name || "Sky pilot";
}

function removeFromQueue(socketId) {
  const index = waiting.indexOf(socketId);
  if (index !== -1) waiting.splice(index, 1);
}

function closeMatch(socket, notifyOpponent = true) {
  const roomId = playerRooms.get(socket.id);
  if (!roomId) return;
  const match = matches.get(roomId);
  const players = Array.isArray(match) ? match : match?.players || [];
  playerRooms.delete(socket.id);
  socket.leave(roomId);
  const remaining = players.filter((id) => id !== socket.id);
  if (notifyOpponent) {
    for (const id of remaining) {
      io.to(id).emit("match:opponent-left");
      io.sockets.sockets.get(id)?.leave(roomId);
    }
  }
  for (const id of players) playerRooms.delete(id);
  matches.delete(roomId);
}

async function sendLeaderboard(socket) {
  if (!supabase) {
    socket.emit("leaderboard:data", { configured: false, scores: [] });
    return;
  }
  const { data, error } = await supabase
    .from("scores")
    .select("player_name, score, created_at")
    .order("score", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(5);
  if (error) {
    console.error("Supabase leaderboard read failed:", error.message);
    socket.emit("leaderboard:error", { message: "Leaderboard is temporarily unavailable." });
    return;
  }
  socket.emit("leaderboard:data", { configured: true, scores: data || [] });
}

io.on("connection", (socket) => {
  socket.on("leaderboard:request", () => {
    void sendLeaderboard(socket);
  });

  socket.on("match:find", (payload) => {
    if (playerRooms.has(socket.id) || waiting.includes(socket.id)) return;
    socket.data.playerName = cleanName(payload?.name);

    let opponentId;
    while (waiting.length && !opponentId) {
      const candidate = waiting.shift();
      if (candidate !== socket.id && io.sockets.sockets.has(candidate)) opponentId = candidate;
    }

    if (!opponentId) {
      waiting.push(socket.id);
      socket.emit("match:waiting");
      return;
    }

    const opponentSocket = io.sockets.sockets.get(opponentId);
    const roomId = `match-${socket.id}-${opponentId}`;
    const seed = Math.floor(Math.random() * 2 ** 31);
    matches.set(roomId, { players: [opponentId, socket.id], seed, ready: new Set() });
    playerRooms.set(opponentId, roomId);
    playerRooms.set(socket.id, roomId);
    socket.join(roomId);
    opponentSocket.join(roomId);

    socket.emit("match:found", { opponent: { name: opponentSocket.data.playerName }, roomId });
    opponentSocket.emit("match:found", { opponent: { name: socket.data.playerName }, roomId });
  });

  socket.on("match:ready", () => {
    const roomId = playerRooms.get(socket.id);
    const match = roomId && matches.get(roomId);
    if (!match || Array.isArray(match)) return;
    match.ready.add(socket.id);
    if (match.ready.size === 2) {
      io.to(roomId).emit("match:start", {
        seed: match.seed,
        startedAt: Date.now() + 1200,
      });
    }
  });

  socket.on("player:state", (payload) => {
    const roomId = playerRooms.get(socket.id);
    if (!roomId) return;
    const y = Number(payload?.y);
    const score = Number(payload?.score);
    if (!Number.isFinite(y) || !Number.isFinite(score)) return;
    socket.to(roomId).emit("opponent:state", {
      y: Math.max(0, Math.min(440, y)),
      score: Math.max(0, Math.floor(score)),
      alive: payload?.alive !== false,
    });
  });

  socket.on("game:over", async (payload) => {
    const roomId = playerRooms.get(socket.id);
    const score = Number(payload?.score);
    if (!Number.isFinite(score) || score < 0) return;
    const safeScore = Math.min(100000, Math.floor(score));
    if (roomId) socket.to(roomId).emit("opponent:finished", { score: safeScore });
    if (!supabase) return;

    const { error } = await supabase.from("scores").insert({
      player_name: cleanName(payload?.name || socket.data.playerName),
      score: safeScore,
    });
    if (error) {
      console.error("Supabase score insert failed:", error.message);
      socket.emit("score:error", { message: "Your score could not be saved to the leaderboard." });
      return;
    }
    await sendLeaderboard(socket);
  });

  socket.on("match:leave", () => {
    removeFromQueue(socket.id);
    closeMatch(socket);
  });

  socket.on("disconnect", () => {
    removeFromQueue(socket.id);
    closeMatch(socket);
  });
});

httpServer.listen(port, () => {
  console.log(`Sky Rivals Socket.IO server listening on http://localhost:${port}`);
  if (!supabase) console.log("Supabase is not configured; scores will not be persisted.");
});
