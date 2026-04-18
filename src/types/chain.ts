export type Chain = {
  id: string
  name: string
  langSource: string
  audience: string | null
  brandKitPath: string | null
  createdAt: Date | null
  updatedAt: Date | null
}

export type PublicationAccount = {
  id: string
  chainId: string
  platform: 'tiktok' | 'youtube' | 'instagram' | 'facebook' | 'x'
  credentials: unknown
  isActive: number
  createdAt: Date | null
}

export type CreateChainInput = {
  name: string
  langSource: string
  audience?: string
}
