#!/usr/bin/env python3
"""
Lot 1A — Transcription locale word-level via faster-whisper.

Entrée (JSON stdin) :
  {
    "audio_path": "/path/to/audio.mp3",
    "language": "fr",          // optionnel, auto-détecté sinon
    "model_size": "base",      // tiny|base|small|medium|large-v3
    "output_path": "/path/to/transcript.json"  // optionnel
  }

Sortie (JSON stdout) — contrat canonique :
  {
    "language": "fr",
    "duration_s": 92.4,
    "model_used": "base",
    "segments": [
      {
        "start_s": 0.0,
        "end_s": 4.2,
        "text": "Bonjour à tous",
        "words": [
          { "word": "Bonjour", "start_s": 0.0, "end_s": 0.8, "confidence": 0.97 },
          { "word": "à",       "start_s": 0.8, "end_s": 0.9, "confidence": 0.95 },
          { "word": "tous",    "start_s": 0.9, "end_s": 1.3, "confidence": 0.98 }
        ]
      }
    ]
  }

Dépendances : pip install faster-whisper
"""

import json
import os
import sys
import time

# Ajouter le parent pour accéder à scripts/common/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
from common.io import read_input, write_output


def transcribe(audio_path: str, language: str | None, model_size: str) -> dict:
    """Transcription word-level via faster-whisper."""
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(json.dumps({
            "error": "faster-whisper non installé. Installer avec : pip install faster-whisper"
        }), file=sys.stderr)
        sys.exit(2)

    if not os.path.isfile(audio_path):
        print(json.dumps({
            "error": f"Fichier audio introuvable : {audio_path}"
        }), file=sys.stderr)
        sys.exit(1)

    # Charger le modèle — CPU sur macOS (MPS pas supporté par CTranslate2)
    device = "cpu"
    compute_type = "int8"

    t0 = time.time()
    model = WhisperModel(model_size, device=device, compute_type=compute_type)
    load_time = time.time() - t0

    # Transcrire avec word_timestamps=True
    t1 = time.time()
    segments_gen, info = model.transcribe(
        audio_path,
        language=language,
        word_timestamps=True,
        vad_filter=True,
    )

    segments = []
    for seg in segments_gen:
        words = []
        if seg.words:
            for w in seg.words:
                words.append({
                    "word": w.word.strip(),
                    "start_s": round(w.start, 3),
                    "end_s": round(w.end, 3),
                    "confidence": round(w.probability, 4),
                })

        segments.append({
            "start_s": round(seg.start, 3),
            "end_s": round(seg.end, 3),
            "text": seg.text.strip(),
            "words": words,
        })

    transcribe_time = time.time() - t1

    return {
        "language": info.language,
        "language_probability": round(info.language_probability, 4),
        "duration_s": round(info.duration, 3),
        "model_used": model_size,
        "device": device,
        "compute_type": compute_type,
        "load_time_s": round(load_time, 2),
        "transcribe_time_s": round(transcribe_time, 2),
        "segment_count": len(segments),
        "word_count": sum(len(s["words"]) for s in segments),
        "segments": segments,
    }


def main():
    input_data = read_input()

    audio_path = input_data.get("audio_path")
    if not audio_path:
        print(json.dumps({"error": "audio_path requis"}), file=sys.stderr)
        sys.exit(1)

    language = input_data.get("language")  # None = auto-detect
    model_size = input_data.get("model_size", "base")
    output_path = input_data.get("output_path")

    result = transcribe(audio_path, language, model_size)

    # Écrire dans un fichier si demandé
    if output_path:
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)

    write_output(result)


if __name__ == "__main__":
    main()
