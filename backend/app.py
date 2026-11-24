"""FastAPI backend: subtitles -> KoBART gloss -> recorded sign motion clips.

Run (from the sign-site folder):  ./run_local.sh      -> http://127.0.0.1:8000
The same process also serves the static frontend so the whole site can be checked locally.
"""
import asyncio
import threading
from typing import List

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import settings
from .motion import MotionIndex, normalize_gloss
from .subtitles import fetch_youtube_captions, parse_subtitles, video_id
from .translator import Translator

app = FastAPI(title='Sign translation backend', version='1.0.0')
app.add_middleware(CORSMiddleware, allow_origins=settings.ALLOWED_ORIGINS,
                   allow_origin_regex=settings.ALLOWED_ORIGIN_REGEX, allow_methods=['GET', 'POST'],
                   allow_headers=['*'])
translator = Translator()
motions = MotionIndex()


@app.on_event('startup')
def warm_up():
    # Load the catalogue and the model in the background so the first request is fast.
    def run():
        for step in (motions.load, translator.load):
            try:
                step()
            except Exception as e:  # reported by /api/health
                translator.error = translator.error or f'{type(e).__name__}: {e}'
    threading.Thread(target=run, daemon=True).start()


class Segment(BaseModel):
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    text: str = Field(max_length=settings.MAX_SEGMENT_CHARS)


class TranslateRequest(BaseModel):
    segments: List[Segment] = Field(max_length=settings.MAX_SEGMENTS)


@app.get('/api/health')
def health():
    return {'ok': True, 'model_loaded': translator.loaded, 'device': str(translator.device) if translator.device else None,
            'motion_index_loaded': motions.loaded, 'motion_vocabulary': motions.vocabulary_size,
            'error': translator.error, 'model_dir': settings.MODEL_DIR.name}


@app.get('/api/youtube/captions')
async def youtube_captions(url: str = Query(..., max_length=500)):
    try:
        vid = video_id(url)
    except ValueError as e:
        raise HTTPException(400, str(e))
    try:
        result = await asyncio.to_thread(fetch_youtube_captions, vid)
    except LookupError as e:
        raise HTTPException(404, str(e))
    return {'video_id': vid, **result}


@app.post('/api/subtitles/parse')
async def upload_subtitles(file: UploadFile = File(...)):
    if not (file.filename or '').lower().endswith(('.srt', '.vtt')):
        raise HTTPException(400, '.srt 또는 .vtt 파일만 올릴 수 있습니다.')
    data = await file.read(5_000_001)
    if len(data) > 5_000_000:
        raise HTTPException(413, '자막 파일은 5MB 이하여야 합니다.')
    for encoding in ('utf-8-sig', 'cp949', 'utf-16'):
        try:
            text = data.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise HTTPException(400, '자막 파일 인코딩을 읽지 못했습니다. UTF-8로 저장해 주세요.')
    segments = parse_subtitles(text)
    if not segments:
        raise HTTPException(400, '자막 구간을 찾지 못했습니다. SRT/VTT 형식을 확인해 주세요.')
    return {'segments': segments}


@app.post('/api/translate')
async def translate(req: TranslateRequest):
    segments = sorted((s for s in req.segments if s.text.strip() and s.end > s.start), key=lambda s: s.start)
    if not segments:
        raise HTTPException(400, '번역할 자막이 없습니다.')
    await asyncio.to_thread(motions.load)
    try:
        results = await asyncio.to_thread(translator.translate, [s.text.strip() for s in segments])
    except Exception as e:
        raise HTTPException(503, f'모델을 불러오지 못했습니다: {type(e).__name__}')
    out, total, covered = [], 0, 0
    for seg, res in zip(segments, results):
        glosses = []
        for raw in res['glosses']:
            label = normalize_gloss(raw)
            if not label:
                continue
            has = motions.has(label)
            total += 1
            covered += has
            glosses.append({'gloss': raw, 'label': label, 'motion': has})
        out.append({'start': seg.start, 'end': seg.end, 'text': seg.text.strip(), 'glosses': glosses,
                    'model_output_valid': res['valid']})
    return {'segments': out, 'gloss_count': total, 'motion_count': covered,
            'model': settings.MODEL_DIR.resolve().name}


@app.get('/api/clip')
async def clip(label: str = Query(..., min_length=1, max_length=60)):
    try:
        data = await asyncio.to_thread(motions.clip, label)
    except LookupError as e:
        raise HTTPException(404, str(e))
    return JSONResponse(data, headers={'Cache-Control': 'public, max-age=86400'})


@app.get('/api/avatar.vrm')
def avatar():
    if not settings.AVATAR_VRM.is_file():
        raise HTTPException(404, 'avatar not found')
    return FileResponse(settings.AVATAR_VRM, media_type='model/gltf-binary',
                        headers={'Cache-Control': 'public, max-age=86400'})


# Local check: serve the static site from the same origin (GitHub Pages serves it in production).
app.mount('/', StaticFiles(directory=settings.FRONTEND_DIR, html=True), name='frontend')
