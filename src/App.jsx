import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const GAME_WIDTH = 720;
const GAME_HEIGHT = 440;
const BIRD_X = 106;
const BIRD_SIZE = 34;
const PIPE_WIDTH = 68;
const PIPE_GAP = 154;
const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ||
  (import.meta.env.DEV ? "http://localhost:3001" : window.location.origin);

function makeRandom(seed) {
  let value = seed || 1;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function makePipe(x, random) {
  const gapCenter = 112 + random() * (GAME_HEIGHT - 224);
  return { x, gapCenter, counted: false, key: `${x}-${Math.round(gapCenter)}` };
}

function GameBoard({
  phase,
  seed,
  startedAt,
  onGameOver,
  onProgress,
  opponent,
  opponentScore,
  opponentName,
  opponentFinished,
  localName,
}) {
  const [game, setGame] = useState({
    birdY: 210,
    score: 0,
    pipes: [],
    crashed: false,
    running: false,
  });
  const gameRef = useRef(game);

  const updateGame = useCallback((next) => {
    gameRef.current = next;
    setGame(next);
  }, []);

  useEffect(() => {
    if (phase !== "playing" || !startedAt) return undefined;

    const random = makeRandom(seed);
    const initialPipes = [
      makePipe(GAME_WIDTH + 110, random),
      makePipe(GAME_WIDTH + 430, random),
      makePipe(GAME_WIDTH + 750, random),
    ];
    const initial = {
      birdY: GAME_HEIGHT / 2 - BIRD_SIZE / 2,
      velocity: 0,
      score: 0,
      pipes: initialPipes,
      crashed: false,
      running: false,
    };
    updateGame(initial);
    let animationFrame;
    let lastTimestamp = 0;
    let lastProgressAt = 0;
    let finished = false;

    const frame = (timestamp) => {
      if (Date.now() < startedAt) {
        animationFrame = requestAnimationFrame(frame);
        return;
      }

      const current = gameRef.current;
      const delta = Math.min((timestamp - (lastTimestamp || timestamp - 16.67)) / 16.67, 2.5);
      lastTimestamp = timestamp;

      let velocity = (current.velocity || 0) + 0.39 * delta;
      let birdY = current.birdY + velocity * delta;
      let score = current.score;
      let pipes = current.pipes
        .map((pipe) => ({ ...pipe, x: pipe.x - 2.65 * delta }))
        .filter((pipe) => pipe.x > -PIPE_WIDTH - 8);

      const lastPipe = pipes[pipes.length - 1];
      if (!lastPipe || lastPipe.x < GAME_WIDTH - 310) {
        pipes = [...pipes, makePipe((lastPipe?.x ?? GAME_WIDTH) + 320, random)];
      }

      let collided = birdY < 0 || birdY + BIRD_SIZE > GAME_HEIGHT;
      pipes = pipes.map((pipe) => {
        const overlapsBird = BIRD_X + BIRD_SIZE - 3 > pipe.x && BIRD_X + 5 < pipe.x + PIPE_WIDTH;
        const gapTop = pipe.gapCenter - PIPE_GAP / 2;
        const gapBottom = pipe.gapCenter + PIPE_GAP / 2;
        if (overlapsBird && (birdY + BIRD_SIZE - 3 > gapBottom || birdY + 3 < gapTop)) {
          collided = true;
        }
        if (!pipe.counted && pipe.x + PIPE_WIDTH < BIRD_X) {
          score += 1;
          return { ...pipe, counted: true };
        }
        return pipe;
      });

      if (collided && !finished) {
        finished = true;
        const final = { ...current, birdY, velocity, score, pipes, crashed: true, running: false };
        updateGame(final);
        onProgress({ y: birdY, score, alive: false });
        onGameOver(score);
        return;
      }

      const next = { birdY, velocity, score, pipes, crashed: false, running: true };
      updateGame(next);
      if (timestamp - lastProgressAt >= 66) {
        lastProgressAt = timestamp;
        onProgress({ y: birdY, score, alive: true });
      }
      animationFrame = requestAnimationFrame(frame);
    };

    animationFrame = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animationFrame);
  }, [onGameOver, onProgress, phase, seed, startedAt, updateGame]);

  const flap = useCallback(() => {
    if (phase === "playing" && !gameRef.current.crashed) {
      const next = { ...gameRef.current, velocity: -6.8, running: true };
      updateGame(next);
    }
  }, [phase, updateGame]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.code === "Space" || event.code === "ArrowUp") {
        event.preventDefault();
        flap();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [flap]);

  return (
    <div className="game-shell">
      <div className="arena-topline">
        <div className="player-tag">
          <span className="player-dot you" />
          <span>{localName || "You"}</span>
          <span className="you-label">YOU</span>
        </div>
        <div className="score-pill"><span>FLIGHT SCORE</span><strong>{game.score}</strong></div>
        <div className="player-tag opponent-tag">
          <span className={`player-dot ${opponent ? "rival" : "waiting"}`} />
          <span>{opponentName || "Finding rival"}</span>
          {opponent && <span className="rival-label">RIVAL</span>}
        </div>
      </div>

      <div
        className="arena"
        role="button"
        tabIndex={phase === "playing" ? 0 : -1}
        aria-label="Tap to flap during the race"
        onPointerDown={flap}
        onKeyDown={(event) => { if (event.key === "Enter") flap(); }}
      >
        <div className="sun-halo" />
        <div className="cloud cloud-one" />
        <div className="cloud cloud-two" />
        <div className="cloud cloud-three" />
        {game.pipes.map((pipe) => {
          const gapTop = pipe.gapCenter - PIPE_GAP / 2;
          const gapBottom = pipe.gapCenter + PIPE_GAP / 2;
          return (
            <div className="pipe-pair" key={pipe.key} style={{ left: `${(pipe.x / GAME_WIDTH) * 100}%` }}>
              <div className="pipe pipe-top" style={{ height: `${(gapTop / GAME_HEIGHT) * 100}%` }} />
              <div className="pipe pipe-bottom" style={{ top: `${(gapBottom / GAME_HEIGHT) * 100}%` }} />
            </div>
          );
        })}
        <div
          className={`bird bird-you ${game.crashed ? "bird-crashed" : ""}`}
          style={{ top: `${(game.birdY / GAME_HEIGHT) * 100}%` }}
          aria-label="Your bird"
        >
          <span className="bird-eye" />
          <span className="bird-wing" />
          <span className="bird-beak" />
        </div>
        {opponent && opponent.alive && (
          <div
            className="bird bird-opponent"
            style={{ top: `${(Math.max(0, Math.min(GAME_HEIGHT - BIRD_SIZE, opponent.y)) / GAME_HEIGHT) * 100}%` }}
            aria-label={`${opponentName}'s bird`}
          >
            <span className="bird-eye" />
            <span className="bird-wing" />
            <span className="bird-beak" />
          </div>
        )}
        <div className="ground"><div className="ground-stripe" /></div>

        {phase === "waiting" && (
          <div className="arena-overlay">
            <div className="overlay-card">
              <span className="countdown-icon">✦</span>
              <p className="eyebrow">RIVAL FOUND</p>
              <h2>Warming up...</h2>
              <p>Your flight starts in a moment. Get ready to flap.</p>
            </div>
          </div>
        )}
        {phase === "playing" && !game.running && !game.crashed && (
          <button type="button" className="start-hint">
            <span className="tap-icon">↑</span>
            <strong>Tap to flap</strong>
            <small>or press space</small>
          </button>
        )}
        {phase === "ended" && (
          <div className="arena-overlay">
            <div className="overlay-card result-card">
                  <span className="result-sparkle">{game.score > opponentScore ? "✦" : "↗"}</span>
                  <p className="eyebrow">{game.score > opponentScore ? "FLIGHT COMPLETE" : "NICE FLIGHT"}</p>
                  <h2>{opponentFinished && game.score > opponentScore ? "You took the lead!" : "Run it back?"}</h2>
              <p>
                {opponentFinished
                  ? `${opponentName} scored ${opponentScore}. You scored ${game.score}.`
                  : `You scored ${game.score}. Waiting on ${opponentName || "your rival"}...`}
              </p>
            </div>
          </div>
        )}
      </div>
      <div className="arena-footer">
        <div className="flight-hint"><span className="keycap">SPACE</span><span>or click to flap</span></div>
        <div className="race-progress">
          <span>{game.score} gates</span>
          <div className="progress-track"><div style={{ width: `${Math.min(game.score * 8, 100)}%` }} /></div>
          <span>{opponentScore} rival</span>
        </div>
        <span className="live-indicator"><i /> LIVE RACE</span>
      </div>
    </div>
  );
}

function App() {
  const [name, setName] = useState(() => localStorage.getItem("sky-rivals-name") || "");
  const [phase, setPhase] = useState("menu");
  const [connection, setConnection] = useState("connecting");
  const [message, setMessage] = useState("");
  const [match, setMatch] = useState(null);
  const [gameSeed, setGameSeed] = useState(1);
  const [startedAt, setStartedAt] = useState(null);
  const [opponent, setOpponent] = useState(null);
  const [opponentScore, setOpponentScore] = useState(0);
  const [opponentFinished, setOpponentFinished] = useState(false);
  const [leaderboard, setLeaderboard] = useState([]);
  const [leaderboardReady, setLeaderboardReady] = useState(false);
  const [playerScore, setPlayerScore] = useState(0);
  const socketRef = useRef(null);

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ["websocket", "polling"], reconnection: true });
    socketRef.current = socket;
    socket.on("connect", () => {
      setConnection("online");
      setMessage("");
      socket.emit("leaderboard:request");
    });
    socket.on("disconnect", () => {
      setConnection("offline");
      setMessage("Connection lost. Reconnecting...");
      setPhase("menu");
      setMatch(null);
    });
    socket.on("connect_error", () => {
      setConnection("offline");
      setMessage("Game server is offline. Start the server and try again.");
    });
    socket.on("match:waiting", () => setPhase("searching"));
    socket.on("match:found", (data) => {
      setMatch(data);
      setOpponent(null);
      setOpponentScore(0);
      setOpponentFinished(false);
      setPhase("waiting");
      socket.emit("match:ready");
    });
    socket.on("match:start", (data) => {
      setGameSeed(data.seed);
      setStartedAt(data.startedAt);
      setPhase("playing");
    });
    socket.on("opponent:state", (data) => {
      setOpponent(data);
      setOpponentScore(data.score || 0);
      if (!data.alive) setOpponentFinished(true);
    });
    socket.on("opponent:finished", (data) => {
      setOpponentScore(data.score || 0);
      setOpponentFinished(true);
    });
    socket.on("match:opponent-left", () => {
      setMessage("Your rival left the race.");
      setPhase("menu");
    });
    socket.on("leaderboard:data", (data) => {
      setLeaderboard(data.scores || []);
      setLeaderboardReady(data.configured);
    });
    socket.on("leaderboard:error", (data) => setMessage(data.message || "Could not load the leaderboard."));
    socket.on("score:error", (data) => setMessage(data.message || "Your score could not be saved."));

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const sendProgress = useCallback((progress) => {
    socketRef.current?.emit("player:state", progress);
  }, []);

  const finishGame = useCallback((score) => {
    setPlayerScore(score);
    setPhase("ended");
    socketRef.current?.emit("game:over", { score, name });
  }, [name]);

  const findMatch = () => {
    const cleanName = name.trim().slice(0, 16);
    if (!cleanName) {
      setMessage("Add a name so your rival knows who they're racing.");
      return;
    }
    if (!socketRef.current?.connected) {
      setMessage("The game server is not connected yet.");
      return;
    }
    localStorage.setItem("sky-rivals-name", cleanName);
    setName(cleanName);
    setMessage("");
    setMatch(null);
    socketRef.current.emit("match:find", { name: cleanName });
    setPhase("searching");
  };

  const cancelMatch = () => {
    socketRef.current?.emit("match:leave");
    setPhase("menu");
    setMatch(null);
    setMessage("");
  };

  const playAgain = () => {
    cancelMatch();
    window.setTimeout(findMatch, 100);
  };

  const active = phase === "playing" || phase === "waiting" || phase === "ended";
  const opponentName = match?.opponent?.name || "Your rival";

  return (
    <main className="app">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Sky Rivals home">
          <span className="brand-mark"><span>↗</span></span>
          <span>sky<span className="brand-light">rivals</span></span>
        </a>
        <div className="topbar-right">
          <div className={`connection ${connection}`}>
            <span className="connection-dot" />
            {connection === "online" ? "Server online" : connection === "offline" ? "Server offline" : "Connecting"}
          </div>
          <div className="topbar-divider" />
          <span className="season-label"><span className="season-icon">✳</span> OPEN SKIES <span className="season-number">/ 01</span></span>
        </div>
      </header>

      <section className={`main-layout ${active ? "in-game" : ""}`}>
        <div className="content-column">
          {!active ? (
            <>
              <section className="hero">
                <div className="hero-kicker"><span className="kicker-line" /> THE SKY IS BETTER SHARED</div>
                <h1>One sky.<br /><span>Two birds.</span></h1>
                <p className="hero-copy">A tiny flight, a friendly rivalry.<br />Flap through the gates and see who flies furthest.</p>
                <div className="hero-decoration" aria-hidden="true">
                  <span className="orbit orbit-one" /><span className="orbit orbit-two" />
                  <span className="hero-star star-one">✦</span><span className="hero-star star-two">✳</span>
                  <div className="hero-bird"><span /><i /></div>
                </div>
              </section>
              <section className="match-card">
                <div className="card-heading">
                  <div><p className="eyebrow">READY WHEN YOU ARE</p><h2>Find your next rival</h2></div>
                  <span className="match-icon">⌁</span>
                </div>
                <label className="name-label" htmlFor="player-name">YOUR CALLSIGN <span>UP TO 16 CHARACTERS</span></label>
                <div className="name-field">
                  <span className="name-symbol">@</span>
                  <input
                    id="player-name"
                    maxLength={16}
                    placeholder="What should we call you?"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") findMatch(); }}
                  />
                  <span className="input-count">{name.length}/16</span>
                </div>
                <button className="find-button" type="button" onClick={findMatch} disabled={connection !== "online"}>
                  <span>Find a rival</span><span className="button-arrow">↗</span>
                </button>
                {phase === "searching" && (
                  <div className="searching-state"><span className="search-spinner" /> Looking for another bird...</div>
                )}
                {message && <div className="notice" role="status">{message}</div>}
                <div className="match-foot"><span><i className="lock-icon">⌑</i> No account needed</span><span>JUST YOU &amp; THE SKY</span></div>
              </section>
            </>
          ) : (
            <section className="active-game">
              <div className="game-heading">
                <div><p className="eyebrow">FLIGHT IN PROGRESS</p><h1>Stay in the air<span>.</span></h1></div>
                <button className="leave-button" type="button" onClick={cancelMatch}>Leave race <span>×</span></button>
              </div>
              <GameBoard
                phase={phase}
                seed={gameSeed}
                startedAt={startedAt}
                onGameOver={finishGame}
                onProgress={sendProgress}
                opponent={opponent}
                opponentScore={opponentScore}
                opponentName={opponentName}
                opponentFinished={opponentFinished}
                localName={name}
              />
              {phase === "ended" && (
                <div className="after-game">
                  <div className="score-summary">
                    <span>YOUR FLIGHT</span><strong>{playerScore}</strong><small>gates cleared</small>
                  </div>
                  <button className="find-button rematch-button" type="button" onClick={playAgain}>
                    <span>Race again</span><span className="button-arrow">↗</span>
                  </button>
                  {message && <div className="notice" role="status">{message}</div>}
                </div>
              )}
            </section>
          )}
        </div>

        <aside className="sidebar">
          <section className="leaderboard-card">
            <div className="side-heading">
              <div><p className="eyebrow">THE HIGH FLYERS</p><h2>Top flights</h2></div>
              <span className="trophy">♧</span>
            </div>
            <div className="leaderboard-list">
              {leaderboard.length > 0 ? leaderboard.slice(0, 5).map((entry, index) => (
                <div className={`leader-row ${index === 0 ? "leader-first" : ""}`} key={`${entry.player_name}-${index}`}>
                  <span className="leader-rank">{String(index + 1).padStart(2, "0")}</span>
                  <span className={`leader-avatar avatar-${index}`}>{(entry.player_name || "?").slice(0, 1).toUpperCase()}</span>
                  <span className="leader-name">{entry.player_name}</span>
                  <span className="leader-score">{entry.score}<small> pts</small></span>
                </div>
              )) : (
                <div className="empty-leaderboard">
                  <span className="empty-icon">↗</span>
                  <p>{leaderboardReady ? "Your flight could be the first on the board." : "Scores will show up here once Supabase is connected."}</p>
                </div>
              )}
            </div>
            <div className="leaderboard-foot"><span><i /> {leaderboardReady ? "ALL-TIME FLIGHTS" : "LEADERBOARD SETUP NEEDED"}</span><span>TOP 5</span></div>
          </section>
          <section className="how-card">
            <p className="eyebrow">THE FLIGHT MANUAL</p>
            <div className="how-row"><span className="how-number">01</span><span className="how-icon">⌘</span><div><strong>Find a rival</strong><small>We’ll pair you with a live player.</small></div></div>
            <div className="how-row"><span className="how-number">02</span><span className="how-icon">↑</span><div><strong>Tap to flap</strong><small>Keep your bird between the gates.</small></div></div>
            <div className="how-row"><span className="how-number">03</span><span className="how-icon">✦</span><div><strong>Fly the furthest</strong><small>Every gate is another point.</small></div></div>
          </section>
          <div className="sidebar-note"><span>✦</span> A little friendly competition, never a bad idea.</div>
        </aside>
      </section>

      <footer className="footer">
        <span>MADE FOR THE JOY OF THE FLIGHT <span className="footer-star">✳</span></span>
        <span>ONE MATCH AT A TIME <span className="footer-dot">·</span> ALL HEART</span>
      </footer>
    </main>
  );
}

export default App;
