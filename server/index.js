
const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const cors = require('cors')

const app = express()
app.use(cors())

const server = http.createServer(app)

const io = new Server(server, {
  cors: {
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST']
  }
})

const waitingQueue = []
const partners = new Map()

function removeFromQueue(socketId) {
  const index = waitingQueue.indexOf(socketId)

  if (index !== -1) {
    waitingQueue.splice(index, 1)
  }
}

function findPartner(socket) {
  removeFromQueue(socket.id)

  let partner = null

  while (waitingQueue.length > 0) {
    const partnerId = waitingQueue.shift()
    const candidate = io.sockets.sockets.get(partnerId)

    if (candidate && candidate.id !== socket.id) {
      partner = candidate
      break
    }
  }

  if (!partner) {
    waitingQueue.push(socket.id)
    socket.emit('waiting')
    return
  }

  partners.set(socket.id, partner.id)
  partners.set(partner.id, socket.id)

  socket.emit('matched', { initiator: true })
  partner.emit('matched', { initiator: false })

  console.log('Matched:', socket.id, partner.id)
}

function nextPartner(socket) {
  removeFromQueue(socket.id)

  const partnerId = partners.get(socket.id)

  if (partnerId) {
    partners.delete(socket.id)
    partners.delete(partnerId)

    const partner = io.sockets.sockets.get(partnerId)

    if (partner) {
      partner.emit('partner-stop-typing')
      partner.emit('partner-left')
    }
  }

  findPartner(socket)
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id)

  socket.on('find-partner', () => {
    if (partners.has(socket.id)) return
    findPartner(socket)
  })

  socket.on('next', () => {
    nextPartner(socket)
  })

  // Text chat
  socket.on('chat-message', (message) => {
    const partnerId = partners.get(socket.id)

    if (!partnerId) return

    const partner = io.sockets.sockets.get(partnerId)

    if (!partner) return

    const text = typeof message === 'string'
      ? message.trim()
      : ''

    if (!text || text.length > 1000) return

    partner.emit('chat-message', {
      text,
      timestamp: Date.now()
    })
  })

  // Typing indicator
  socket.on('typing', () => {
    const partnerId = partners.get(socket.id)

    if (!partnerId) return

    const partner = io.sockets.sockets.get(partnerId)

    if (partner) {
      partner.emit('partner-typing')
    }
  })

  // Stop typing indicator
  socket.on('stop-typing', () => {
    const partnerId = partners.get(socket.id)

    if (!partnerId) return

    const partner = io.sockets.sockets.get(partnerId)

    if (partner) {
      partner.emit('partner-stop-typing')
    }
  })

  // WebRTC signaling
  socket.on('webrtc-offer', (offer) => {
    const partnerId = partners.get(socket.id)

    if (partnerId) {
      io.to(partnerId).emit('webrtc-offer', offer)
    }
  })

  socket.on('webrtc-answer', (answer) => {
    const partnerId = partners.get(socket.id)

    if (partnerId) {
      io.to(partnerId).emit('webrtc-answer', answer)
    }
  })

  socket.on('ice-candidate', (candidate) => {
    const partnerId = partners.get(socket.id)

    if (partnerId) {
      io.to(partnerId).emit('ice-candidate', candidate)
    }
  })

  socket.on('disconnect', () => {
    removeFromQueue(socket.id)

    const partnerId = partners.get(socket.id)

    if (partnerId) {
      partners.delete(socket.id)
      partners.delete(partnerId)

      const partner = io.sockets.sockets.get(partnerId)

      if (partner) {
        partner.emit('partner-stop-typing')
        partner.emit('partner-left')
      }
    }

    console.log('User disconnected:', socket.id)
  })
})

app.get('/', (req, res) => {
  res.send('Mingle matchmaking server is running!')
})

server.listen(3000, () => {
  console.log('Mingle server running on port 3000')
})
