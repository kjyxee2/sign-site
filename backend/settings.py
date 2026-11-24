"""Paths and runtime options. Every value can be overridden by an environment variable.

Defaults point at the existing read-only project on the GPU server; nothing here is a secret.
"""
import os
from pathlib import Path

SITE_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = Path(os.environ.get('SIGN_WORKSPACE', '/data1/workspaces/cy0410'))
INTEGRATED = WORKSPACE / 'sign/avatar_mvp/integrated'

# Trained KoBART text -> gloss model (symlink to the selected best epoch).
MODEL_DIR = Path(os.environ.get('SIGN_MODEL_DIR', INTEGRATED / 'text2gloss_train_20261123/checkpoints/best'))
# Helper code that defines the training/inference contract of that model.
MODEL_CODE_DIR = Path(os.environ.get('SIGN_MODEL_CODE_DIR', INTEGRATED / 'text2gloss_train_20261123'))
# Motion catalogue (AI Hub keypoint sequences) and its loader code.
CATALOG_CODE_DIR = Path(os.environ.get('SIGN_CATALOG_CODE_DIR', INTEGRATED))
SEQUENCE_CATALOG = Path(os.environ.get('SIGN_SEQUENCE_CATALOG', WORKSPACE / 'data_audit_20261112/sequence_catalog.csv'))
KEYPOINT_ROOTS = [WORKSPACE / 'sign/004.수어영상', WORKSPACE / 'sign_more/004.수어영상']
# VRM avatar served to the browser (not committed to git).
AVATAR_VRM = Path(os.environ.get('SIGN_AVATAR_VRM', WORKSPACE / 'sign/assets/avatar/test.vrm'))

FRONTEND_DIR = SITE_ROOT / 'frontend'
DEVICE = os.environ.get('SIGN_DEVICE', 'auto')  # auto | cpu | cuda:N
SOURCE_MAX_TOKENS = 256
MAX_NEW_TOKENS = int(os.environ.get('SIGN_MAX_NEW_TOKENS', '128'))
BATCH_SIZE = int(os.environ.get('SIGN_BATCH_SIZE', '32'))
MAX_SEGMENTS = 3000
MAX_SEGMENT_CHARS = 400
CLIP_PAD_FRAMES = 3
FPS = 30.0

# Comma separated exact origins; GitHub Pages and localhost are always accepted via the regex below.
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get('SIGN_ALLOWED_ORIGINS', '').split(',') if o.strip()]
ALLOWED_ORIGIN_REGEX = os.environ.get(
    'SIGN_ALLOWED_ORIGIN_REGEX', r'https://[A-Za-z0-9-]+\.github\.io|http://(localhost|127\.0\.0\.1)(:\d+)?')
