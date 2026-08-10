import { feathers } from '@feathersjs/feathers'
import restClient from '@feathersjs/rest-client'
import authenticationClient from '@feathersjs/authentication-client'

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3030'

const rest = restClient(apiUrl)

export const feathersClient = feathers()
  .configure(rest.fetch(window.fetch.bind(window)))
  .configure(
    authenticationClient({
      storage: window.localStorage,
      storageKey: 'facturacion-sii-token'
    })
  )
