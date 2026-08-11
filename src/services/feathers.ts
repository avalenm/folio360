import { feathers } from '@feathersjs/feathers'
import socketioClient from '@feathersjs/socketio-client'
import authenticationClient from '@feathersjs/authentication-client'
import { io } from 'socket.io-client'

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3030'

// WebSocket como único transporte (no REST): más allá de las llamadas
// normales (find/create/patch/...), esto es lo que permite recibir eventos
// en vivo (`service.on('created'|'patched'|'removed', ...)`) cuando algo
// cambia por un proceso en segundo plano — el worker de polling de estado
// SII o el poller de la Casilla de Intercambio (ver server/src/channels.ts +
// server/src/realtime/) — sin esto ninguna pantalla se actualizaría sola.
const socket = io(apiUrl, { transports: ['websocket'] })

export const feathersClient = feathers()
  .configure(socketioClient(socket))
  .configure(
    authenticationClient({
      storage: window.localStorage,
      storageKey: 'facturacion-sii-token'
    })
  )
