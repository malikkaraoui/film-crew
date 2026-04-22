'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'

export default function TestSketchPage() {
  const [prompt, setPrompt] = useState('Test animation with scrolling text')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string; filePath?: string } | null>(null)

  async function handleGenerate() {
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch('/api/test/sketch-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, duration: 5 }),
      })
      const json = await res.json()
      setResult(json)
    } catch (e) {
      setResult({ success: false, message: (e as Error).message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Sketch Local — Test Generate</CardTitle>
        </CardHeader>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full p-2 border rounded text-sm"
              rows={3}
            />
          </div>

          <Button onClick={handleGenerate} disabled={loading} className="w-full">
            {loading ? 'Generating...' : 'Generate Video'}
          </Button>

          {result && (
            <div className={`p-4 rounded ${result.success ? 'bg-green-50' : 'bg-red-50'}`}>
              <p className="font-medium">{result.success ? '✅ Success' : '❌ Error'}</p>
              <p className="text-sm mt-1">{result.message}</p>
              {result.filePath && (
                <p className="text-xs mt-2 text-gray-600">Path: {result.filePath}</p>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
