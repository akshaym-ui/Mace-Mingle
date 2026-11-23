
import { useState } from 'react'
import './App.css'
import VideoChat from './components/VideoChat'

function App() {
  const [started, setStarted] = useState(false)

  if (started) {
    return <VideoChat onLeave={() => setStarted(false)} />
  }

  return (
    <div className="app">
      <nav className="navbar">
        <h2 className="logo">mingle<span>.</span></h2>
        <div className="status">
          <span className="live-dot"></span>
          Ready to connect
        </div>
      </nav>

      <main className="hero">
        <div className="tag">✦ YOUR NEXT CONVERSATION STARTS HERE</div>

        <h1>
          The world is full
          <br />
          of <span>strangers.</span>
        </h1>

        <p className="subtitle">
          Meet someone new. Have a random conversation.
          <br />
          No accounts. No awkward introductions.
        </p>

        <button
          className="start-btn"
          onClick={() => setStarted(true)}
        >
          Start Mingle <span>→</span>
        </button>

        <p className="note">
          Anonymous conversations · 18+ only
        </p>
      </main>

      <footer>
        <span>mingle. © 2026</span>
        <span>Be kind. Be respectful.</span>
      </footer>
    </div>
  )
}

export default App
