"""Subtitle input: .srt / .vtt parsing and YouTube caption fetching."""
import html
import re

from . import settings

_TIME = r'(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})'
_CUE = re.compile(_TIME + r'\s*-->\s*' + _TIME)
_TAG = re.compile(r'<[^>]+>|\{\\[^}]*\}')
_NOISE = re.compile(r'^\s*[\[\(（][^\]\)）]{0,20}[\]\)）]\s*$')  # [음악], (박수) ...
_ID = re.compile(r'^(?:https?://)?(?:www\.|m\.|music\.)?(?:youtube\.com/(?:watch\?(?:.*&)?v=|embed/|shorts/|live/|v/)|youtu\.be/)([A-Za-z0-9_-]{11})')


def _seconds(h, m, s, ms):
    return int(h or 0) * 3600 + int(m) * 60 + int(s) + int(ms.ljust(3, '0')) / 1000


def clean_text(text):
    text = html.unescape(_TAG.sub('', text)).replace('>>', ' ')
    lines = [re.sub(r'^[-–]\s+', '', ln.strip()) for ln in text.splitlines() if ln.strip() and not _NOISE.match(ln)]
    return re.sub(r'\s+', ' ', ' '.join(lines)).strip()[:settings.MAX_SEGMENT_CHARS]


def parse_subtitles(content):
    """Parse SRT or WebVTT text into [{start, end, text}] sorted by start time."""
    content = content.lstrip('﻿').replace('\r\n', '\n').replace('\r', '\n')
    segments = []
    for block in re.split(r'\n\s*\n', content):
        lines = block.strip().split('\n')
        for i, line in enumerate(lines):
            m = _CUE.search(line)
            if m:
                start, end = _seconds(*m.groups()[:4]), _seconds(*m.groups()[4:])
                text = clean_text('\n'.join(lines[i + 1:]))
                if text and end > start:
                    segments.append({'start': round(start, 3), 'end': round(end, 3), 'text': text})
                break
    segments.sort(key=lambda s: s['start'])
    return _dedupe(segments)


def _dedupe(segments):
    """Drop exact repeats (common in auto-generated rolling captions)."""
    out = []
    for s in segments:
        if out and s['text'] == out[-1]['text'] and s['start'] <= out[-1]['end'] + 0.05:
            out[-1]['end'] = max(out[-1]['end'], s['end'])
        else:
            out.append(s)
    return out[:settings.MAX_SEGMENTS]


def video_id(url_or_id):
    value = (url_or_id or '').strip()
    if re.fullmatch(r'[A-Za-z0-9_-]{11}', value):
        return value
    m = _ID.match(value)
    if not m:
        raise ValueError('유튜브 링크에서 영상 ID를 찾지 못했습니다.')
    return m.group(1)


def fetch_youtube_captions(vid, languages=('ko',)):
    """Fetch Korean captions (manual preferred over auto-generated). Raises LookupError if none."""
    from youtube_transcript_api import YouTubeTranscriptApi
    api = YouTubeTranscriptApi()
    try:
        listing = api.list(vid)
    except Exception as e:  # network, disabled captions, unavailable video ...
        raise LookupError(f'유튜브 자막 목록을 가져오지 못했습니다: {type(e).__name__}') from e
    transcript = None
    for finder in (listing.find_manually_created_transcript, listing.find_generated_transcript):
        try:
            transcript = finder(list(languages))
            break
        except Exception:
            continue
    if transcript is None:
        available = [t.language_code for t in listing]
        raise LookupError('한국어 자막이 없는 영상입니다.' + (f' (있는 자막: {", ".join(available)})' if available else ''))
    fetched = transcript.fetch()
    segments = []
    snippets = list(fetched)
    for i, s in enumerate(snippets):
        text = clean_text(s.text)
        if not text:
            continue
        end = s.start + s.duration
        if i + 1 < len(snippets):  # auto captions overlap; never run into the next line
            end = min(end, snippets[i + 1].start) if snippets[i + 1].start > s.start else end
        segments.append({'start': round(s.start, 3), 'end': round(max(end, s.start + 0.2), 3), 'text': text})
    segments = _dedupe(segments)
    if transcript.is_generated:
        segments = merge_fragments(segments)
    return {'language': transcript.language_code, 'generated': transcript.is_generated, 'segments': segments}


def merge_fragments(segments, max_chars=32, max_gap=0.6, max_seconds=7.0):
    """Auto captions cut sentences into tiny pieces; join neighbours into phrase-sized lines."""
    out = []
    for s in segments:
        prev = out[-1] if out else None
        if (prev and s['start'] - prev['end'] <= max_gap and len(prev['text']) + len(s['text']) < max_chars
                and s['end'] - prev['start'] <= max_seconds and not re.search(r'[.?!。]$', prev['text'])):
            prev['text'] = f"{prev['text']} {s['text']}"
            prev['end'] = s['end']
        else:
            out.append(dict(s))
    return out
