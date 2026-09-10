import type { AdeepApi } from './index'

declare global {
  interface Window {
    adeep: AdeepApi
  }
}

export {}
