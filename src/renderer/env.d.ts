import type { LyriqueApi } from '../preload/index'

declare global {
  interface Window {
    lyrique: LyriqueApi
  }
}

export {}
