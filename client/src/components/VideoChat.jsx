
import { useState, useEffect, useRef } from 'react'
import { io } from 'socket.io-client'
import './VideoChat.css'

function VideoChat({ onLeave }) {
  const [camera, setCamera] = useState(true)
  const [mic, setMic] = useState(true)
  const [stream, setStream] = useState(null)
  const [remoteStream, setRemoteStream] = useState(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('Connecting...')

  const [messages, setMessages] = useState([])
  const [messageInput, setMessageInput] = useState('')
  const [isMatched, setIsMatched] = useState(false)
  const [partnerTyping, setPartnerTyping] = useState(false)

  const videoRef = useRef(null)
  const remoteVideoRef = useRef(null)
  const socketRef = useRef(null)
  const peerRef = useRef(null)
  const messagesEndRef = useRef(null)
  const matchedRef = useRef(false)
  const messageIdRef = useRef(0)
  const typingTimeoutRef = useRef(null)

  useEffect(() => {
    let active = true
    let localMedia = null
    let pendingOffer = null
    let pendingCandidates = []
    let matched = false
    let initiator = false

    // Use Render server online, localhost during local development
    const SERVER_URL =
      import.meta.env.VITE_SERVER_URL ||
      'http://localhost:3000'

    const socket = io(SERVER_URL, {
      autoConnect: false
    })

    socketRef.current = socket

    function updateMatchState(value) {
      matched = value
      matchedRef.current = value
      setIsMatched(value)
    }

    function closePeer() {
      if (peerRef.current) {
        peerRef.current.close()
        peerRef.current = null
      }

      pendingCandidates = []
      setRemoteStream(null)
    }

    async function addPendingCandidates() {
      const peer = peerRef.current

      if (!peer?.remoteDescription) return

      const candidates = [...pendingCandidates]
      pendingCandidates = []

      for (const candidate of candidates) {
        try {
          await peer.addIceCandidate(candidate)
        } catch (err) {
          console.error('ICE candidate error:', err)
        }
      }
    }

    function createPeer() {
      if (peerRef.current) return peerRef.current

      const peer = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' }
        ]
      })

      peerRef.current = peer

      localMedia?.getTracks().forEach(track => {
        peer.addTrack(track, localMedia)
      })

      peer.onicecandidate = event => {
        if (event.candidate) {
          socket.emit('ice-candidate', event.candidate)
        }
      }

      peer.ontrack = event => {
        if (event.streams?.[0]) {
          setRemoteStream(event.streams[0])
        }
      }

      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'connected') {
          setStatus('Connected to stranger')
        } else if (peer.connectionState === 'connecting') {
          setStatus('Connecting video...')
        } else if (peer.connectionState === 'failed') {
          setStatus('Connection failed')
        } else if (peer.connectionState === 'disconnected') {
          setStatus('Connection interrupted')
        }
      }

      return peer
    }

    async function startOffer() {
      if (!localMedia || !matched || !initiator) return

      try {
        const peer = createPeer()
        const offer = await peer.createOffer()

        await peer.setLocalDescription(offer)
        socket.emit('webrtc-offer', peer.localDescription)
      } catch (err) {
        console.error('Offer error:', err)
        setStatus('Unable to start video connection')
      }
    }

    async function handleOffer(offer) {
      if (!localMedia) {
        pendingOffer = offer
        return
      }

      try {
        const peer = createPeer()

        await peer.setRemoteDescription(
          new RTCSessionDescription(offer)
        )

        await addPendingCandidates()

        const answer = await peer.createAnswer()
        await peer.setLocalDescription(answer)

        socket.emit('webrtc-answer', peer.localDescription)
      } catch (err) {
        console.error('Answer error:', err)
        setStatus('Unable to answer video connection')
      }
    }

    // Socket connection
    socket.on('connect', () => {
      setStatus('Finding someone...')
      socket.emit('find-partner')
    })

    socket.on('connect_error', err => {
      console.error('Socket connection error:', err.message)
      setStatus('Server connection failed')
    })

    socket.on('waiting', () => {
      updateMatchState(false)
      setPartnerTyping(false)
      setStatus('Waiting for a stranger...')
    })

    // Partner matched
    socket.on('matched', data => {
      closePeer()

      updateMatchState(true)
      initiator = data?.initiator === true

      clearTimeout(typingTimeoutRef.current)
      setPartnerTyping(false)
      setMessages([])
      setMessageInput('')
      setStatus('Stranger found!')

      if (initiator) {
        startOffer()
      }
    })

    // Receive messages
    socket.on('chat-message', message => {
      if (!matchedRef.current || !message?.text) return

      setMessages(previous => [
        ...previous,
        {
          id: ++messageIdRef.current,
          text: message.text,
          timestamp: message.timestamp || Date.now(),
          sender: 'stranger'
        }
      ])
    })

    // Receive typing indicator
    socket.on('partner-typing', () => {
      if (matchedRef.current) {
        setPartnerTyping(true)
      }
    })

    socket.on('partner-stop-typing', () => {
      setPartnerTyping(false)
    })

    // WebRTC signaling
    socket.on('webrtc-offer', offer => {
      handleOffer(offer)
    })

    socket.on('webrtc-answer', async answer => {
      try {
        const peer = peerRef.current
        if (!peer) return

        await peer.setRemoteDescription(
          new RTCSessionDescription(answer)
        )

        await addPendingCandidates()
      } catch (err) {
        console.error('Remote answer error:', err)
      }
    })

    socket.on('ice-candidate', async candidate => {
      try {
        const iceCandidate = new RTCIceCandidate(candidate)
        const peer = peerRef.current

        if (peer?.remoteDescription) {
          await peer.addIceCandidate(iceCandidate)
        } else {
          pendingCandidates.push(iceCandidate)
        }
      } catch (err) {
        console.error('ICE error:', err)
      }
    })

    // Partner leaves
    socket.on('partner-left', () => {
      updateMatchState(false)
      initiator = false

      clearTimeout(typingTimeoutRef.current)
      setPartnerTyping(false)

      closePeer()

      setMessages([])
      setMessageInput('')
      setStatus('Stranger left. Finding someone new...')

      socket.emit('find-partner')
    })

    socket.on('disconnect', () => {
      updateMatchState(false)

      clearTimeout(typingTimeoutRef.current)
      setPartnerTyping(false)

      closePeer()

      setMessages([])
      setMessageInput('')
      setStatus('Disconnected from server')
    })

    socket.connect()

    // Start camera
    async function startCamera() {
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        })

        if (!active) {
          media.getTracks().forEach(track => track.stop())
          return
        }

        localMedia = media
        setStream(media)

        if (pendingOffer) {
          const offer = pendingOffer
          pendingOffer = null
          await handleOffer(offer)
        } else if (matched && initiator) {
          await startOffer()
        }
      } catch (err) {
        if (active) {
          setError(
            err.name === 'NotAllowedError'
              ? 'Camera or microphone permission denied.'
              : 'Unable to access camera or microphone.'
          )
        }
      }
    }

    startCamera()

    return () => {
      active = false
      matchedRef.current = false

      clearTimeout(typingTimeoutRef.current)

      closePeer()

      localMedia?.getTracks().forEach(track => track.stop())

      socket.disconnect()
      socketRef.current = null
    }
  }, [])

  // Attach local video
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  // Attach stranger video
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream
    }
  }, [remoteStream])

  // Scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'end'
    })
  }, [messages, partnerTyping])

  function toggleCamera() {
    const next = !camera

    stream?.getVideoTracks().forEach(track => {
      track.enabled = next
    })

    setCamera(next)
  }

  function toggleMic() {
    const next = !mic

    stream?.getAudioTracks().forEach(track => {
      track.enabled = next
    })

    setMic(next)
  }

  function stopTyping() {
    clearTimeout(typingTimeoutRef.current)

    const socket = socketRef.current

    if (socket?.connected && matchedRef.current) {
      socket.emit('stop-typing')
    }
  }

  function handleMessageInput(value) {
    setMessageInput(value)

    const socket = socketRef.current

    if (!socket?.connected || !matchedRef.current) return

    if (!value.trim()) {
      stopTyping()
      return
    }

    socket.emit('typing')

    clearTimeout(typingTimeoutRef.current)

    typingTimeoutRef.current = setTimeout(() => {
      if (socket.connected && matchedRef.current) {
        socket.emit('stop-typing')
      }
    }, 1200)
  }

  // Send text message
  function sendMessage(event) {
    event.preventDefault()

    const text = messageInput.trim()
    const socket = socketRef.current

    if (!text || !socket?.connected || !matchedRef.current) return
    if (text.length > 1000) return

    stopTyping()
    setPartnerTyping(false)

    const timestamp = Date.now()

    setMessages(previous => [
      ...previous,
      {
        id: ++messageIdRef.current,
        text,
        timestamp,
        sender: 'you'
      }
    ])

    socket.emit('chat-message', text)
    setMessageInput('')
  }

  // Find next stranger
  function findNext() {
    stopTyping()
    matchedRef.current = false
    setIsMatched(false)

    clearTimeout(typingTimeoutRef.current)
    setPartnerTyping(false)

    peerRef.current?.close()
    peerRef.current = null

    setRemoteStream(null)
    setMessages([])
    setMessageInput('')
    setStatus('Finding someone new...')

    socketRef.current?.emit('next')
  }

  function leaveChat() {
    stopTyping()
    matchedRef.current = false

    clearTimeout(typingTimeoutRef.current)

    socketRef.current?.disconnect()
    onLeave()
  }

  function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const today = new Date().toDateString()

  return (
    <div className="chat-page">

      <nav className="chat-nav">
        <h2 className="logo">mingle<span>.</span></h2>

        <span className="chat-status">
          <span className="live-dot"></span>
          {status}
        </span>

        <button className="leave-btn" onClick={leaveChat}>
          Leave
        </button>
      </nav>

      <main className="chat-layout">

        {/* Video section */}
        <section className="video-section">

          <div className="video-container">

            <div className="video-box stranger">
              {remoteStream ? (
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                />
              ) : (
                <div className="video-placeholder">
                  <span>✦</span>
                  <p>Waiting for a stranger...</p>
                </div>
              )}

              <span className="video-label">Stranger</span>
            </div>

            <div className="video-box self">
              {stream && camera ? (
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                />
              ) : (
                <div className="video-placeholder">
                  <span>◉</span>
                  <p>{error || 'Camera is off'}</p>
                </div>
              )}

              <span className="video-label">You</span>
            </div>

          </div>

          <div className="controls">

            <button onClick={toggleMic}>
              {mic ? '🎙 Mic on' : '🔇 Mic off'}
            </button>

            <button onClick={toggleCamera}>
              {camera ? '📷 Camera on' : '🚫 Camera off'}
            </button>

            <button className="next-btn" onClick={findNext}>
              Next →
            </button>

          </div>

        </section>

        {/* Text chat */}
        <section className="text-chat">

          <div className="chat-header">
            <div>
              <h3>Messages</h3>
              <p>
                {isMatched
                  ? 'Chat with your stranger'
                  : 'Waiting for someone to connect'}
              </p>
            </div>

            <span className={isMatched ? 'chat-online' : 'chat-offline'}>
              ● {isMatched ? 'Online' : 'Waiting'}
            </span>
          </div>

          <div className="messages-container">

            {messages.length === 0 && (
              <div className="empty-chat">
                <span>✦</span>

                <h4>
                  {isMatched ? 'Say hello!' : 'Your conversation starts here'}
                </h4>

                <p>
                  {isMatched
                    ? 'Break the ice with a message.'
                    : 'Find a stranger to start chatting.'}
                </p>
              </div>
            )}

            {messages.length > 0 && (
              <div className="date-separator">
                <span>
                  {new Date(messages[0].timestamp).toDateString() === today
                    ? 'Today'
                    : new Date(messages[0].timestamp).toLocaleDateString()}
                </span>
              </div>
            )}

            {messages.map((message, index) => {
              const previous = messages[index - 1]
              const grouped = previous?.sender === message.sender

              return (
                <div
                  key={message.id}
                  className={`message-row ${
                    message.sender === 'you'
                      ? 'my-message'
                      : 'their-message'
                  } ${grouped ? 'grouped-message' : ''}`}
                >
                  <div className="message-bubble">
                    <p>{message.text}</p>
                    <span>{formatTime(message.timestamp)}</span>
                  </div>
                </div>
              )
            })}

            {partnerTyping && isMatched && (
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
                <small>Stranger is typing...</small>
              </div>
            )}

            <div ref={messagesEndRef} />

          </div>

          <form className="message-form" onSubmit={sendMessage}>

            <input
              type="text"
              placeholder={
                isMatched
                  ? 'Type a message...'
                  : 'Waiting for a stranger...'
              }
              value={messageInput}
              onChange={event => handleMessageInput(event.target.value)}
              disabled={!isMatched}
              maxLength={1000}
            />

            <button
              type="submit"
              disabled={!isMatched || !messageInput.trim()}
            >
              Send ↑
            </button>

          </form>

        </section>

      </main>
    </div>
  )
}

export default VideoChat
