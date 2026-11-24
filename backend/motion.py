"""Gloss -> recorded sign motion (AI Hub 3D keypoints), read-only.

A model gloss such as "건강1" or "비내리다2#" is normalised to its label ("건강", "비내리다") and
looked up in two places of the existing motion catalogue:
  1. isolated WORD recordings whose single label equals the gloss (preferred);
  2. labelled segments inside SEN (sentence) recordings.
Frames are read on demand and validated with the same rules as the original prototype.
"""
import json
import math
import re
import sys
import threading
from collections import defaultdict
from pathlib import Path

from . import settings

sys.path.insert(0, str(settings.CATALOG_CODE_DIR))

PARTS = {'pose': ('pose_keypoints_3d', 25), 'hand_l': ('hand_left_keypoints_3d', 21),
         'hand_r': ('hand_right_keypoints_3d', 21)}


def normalize_gloss(gloss):
    """'비내리다2#' -> '비내리다'; '건강1' -> '건강'. Returns '' for empty/garbage tokens."""
    g = gloss.strip().strip('#@').strip()
    return re.sub(r'\d+$', '', g).strip()


class MotionIndex:
    def __init__(self):
        self._lock = threading.Lock()
        self.rows = {}
        self.candidates = defaultdict(list)  # label -> [(video_id, segment_index or None)]
        self.loaded = False

    def load(self):
        with self._lock:
            if self.loaded:
                return
            from catalog import Catalog, _eligible
            catalog = Catalog(settings.SEQUENCE_CATALOG)
            sen = defaultdict(list)
            for cid, item in catalog.contents.items():
                for row in item['rows']:  # already sorted: eligible + preferred REAL group first
                    if not _eligible(row):
                        continue
                    self.rows[row['video_id']] = row
                    gloss = json.loads(row['gloss_order_json'])
                    if row['kind'] == 'WORD' and len(gloss) == 1:
                        self.candidates[gloss[0]].append((row['video_id'], None))
                    elif row['kind'] == 'SEN':
                        for i, seg in enumerate(json.loads(row['segments_json'])):
                            names = [a.get('name') for a in seg.get('attributes') or []]
                            if len(names) == 1 and names[0]:
                                sen[names[0]].append((row['video_id'], i))
            for label, items in sen.items():
                self.candidates[label].extend(items[:12])
            self.loaded = True

    def has(self, label):
        return bool(self.candidates.get(label))

    @property
    def vocabulary_size(self):
        return len(self.candidates)

    def clip(self, label):
        self.load()
        return _load_clip(self, label)


_clip_cache = {}
_clip_lock = threading.Lock()


def _load_clip(index, label):
    if label in _clip_cache:
        return _clip_cache[label]
    errors = []
    for video_id, seg_index in index.candidates.get(label, [])[:8]:
        try:
            clip = read_clip(index.rows[video_id], seg_index)
            clip['label'] = label
            with _clip_lock:
                if len(_clip_cache) > 3000:
                    _clip_cache.pop(next(iter(_clip_cache)))
                _clip_cache[label] = clip
            return clip
        except (ValueError, KeyError, OSError) as e:
            errors.append(f'{video_id}: {e}')
    raise LookupError(f'No validated motion for "{label}"' + (f' ({errors[0]})' if errors else ''))


def read_clip(row, seg_index=None):
    """Load and validate frames for a whole WORD label span or one SEN segment (+3 frames padding)."""
    if row['label_status'] != 'exact' or row['label_issues']:
        raise ValueError('label not exact')
    path = Path(row['path']).resolve()
    if not any(path.is_relative_to(root) for root in settings.KEYPOINT_ROOTS):
        raise ValueError('path outside source datasets')
    segments = json.loads(row['segments_json'])
    spans = [segments[seg_index]] if seg_index is not None else segments
    fps, pad = settings.FPS, settings.CLIP_PAD_FRAMES
    first_frame, last_frame = int(row['first_frame']), int(row['last_frame'])
    first = max(first_frame, math.ceil(min(s['start'] for s in spans) * fps) - pad)
    last = min(last_frame, math.floor(max(s['end'] for s in spans) * fps) + pad)
    if not 2 <= last - first + 1 <= 600:
        raise ValueError('clip length outside bounds')
    frames, widths = [], []
    for i in range(first, last + 1):
        with (path / f"{row['video_id']}_{i:012d}_keypoints.json").open() as f:
            person = json.load(f)['people']
        if not isinstance(person, dict):
            raise ValueError('unsupported people schema')
        frame = {'t': round((i - first) / fps, 4)}
        for part, (key, count) in PARTS.items():
            values = person[key]
            if len(values) != count * 4 or not all(isinstance(x, (int, float)) and math.isfinite(x) for x in values):
                raise ValueError(f'invalid {key} at frame {i}')
            frame[part] = [[round(values[j], 5), round(values[j + 1], 5), round(values[j + 2], 5)]
                           for j in range(0, len(values), 4)]
        widths.append(math.dist(frame['pose'][2], frame['pose'][5]))
        frames.append(frame)
    if min(widths) <= 0 or max(widths) / min(widths) > 100:
        raise ValueError('degenerate coordinate scale')
    return {'source': {'video_id': row['video_id'], 'kind': row['kind'], 'content_id': row['content_id'],
                       'segment_index': seg_index, 'first_frame': first, 'last_frame': last, 'fps': fps},
            'duration': frames[-1]['t'], 'frames': frames}
