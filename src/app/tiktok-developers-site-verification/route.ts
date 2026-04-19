import { NextResponse } from 'next/server'

const TOKEN = 'tiktok-developers-site-verification=eEBtwOVv66dRDs9Xpa23tJEWkGfNiDpr'

export async function GET() {
  return new NextResponse(`${TOKEN}\n`, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  })
}
