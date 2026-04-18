export type ExportPreset = {
  name: string
  platform: string
  format: string
  resolution: string
  maxDuration: number
  codec: string
  container: string
}

export const EXPORT_PRESETS: ExportPreset[] = [
  {
    name: 'TikTok',
    platform: 'tiktok',
    format: '9:16',
    resolution: '1080x1920',
    maxDuration: 180,
    codec: 'h264',
    container: 'mp4',
  },
  {
    name: 'YouTube Shorts',
    platform: 'youtube_shorts',
    format: '9:16',
    resolution: '1080x1920',
    maxDuration: 60,
    codec: 'h264',
    container: 'mp4',
  },
  {
    name: 'Instagram Reels',
    platform: 'instagram_reels',
    format: '9:16',
    resolution: '1080x1920',
    maxDuration: 90,
    codec: 'h264',
    container: 'mp4',
  },
  {
    name: 'Facebook Reels',
    platform: 'facebook_reels',
    format: '9:16',
    resolution: '1080x1920',
    maxDuration: 90,
    codec: 'h264',
    container: 'mp4',
  },
  {
    name: 'X Video',
    platform: 'x_video',
    format: '9:16',
    resolution: '1080x1920',
    maxDuration: 140,
    codec: 'h264',
    container: 'mp4',
  },
]
