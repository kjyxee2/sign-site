import { Avatar } from './avatar.js';
import { buildTimeline, sample, segmentAt } from './timeline.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const API = (params.get('api') ?? window.SIGN_API_BASE ?? '').replace(/\/+$/, '');
const YT_ID = /^(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

let avatar = null, avatarReady = null, ytApi = null, yt = null;
let segments = [], timeline = null, session = 0;
let lastRaw = -1, base = 0, baseAt = 0, lastSeg = -2, lastEventKey = '';

function videoId(value) {
  value = value.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;
  const m = value.match(YT_ID);
  return m ? m[1] : null;
}

async function api(path, options) {
  let res;
  try {
    res = await fetch(API + path, options);
  } catch {
    throw new Error('번역 서버에 연결하지 못했습니다. 백엔드 주소(config.js)와 서버 실행 상태를 확인해 주세요.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `서버 오류 (${res.status})`);
  return data;
}

function setStatus(id, text) { $(id).textContent = text; }

// ---------- start screen ----------
$('url').value = params.get('v') ? `https://www.youtube.com/watch?v=${params.get('v')}` : '';
$('startForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('startError').textContent = '';
  const vid = videoId($('url').value);
  if (!vid) { $('startError').textContent = '올바른 유튜브 링크를 입력해 주세요.'; return; }
  const file = $('subtitleFile').files[0];
  $('startButton').disabled = true;
  try {
    let subs;
    if (file) {
      setStatus('startStatus', '자막 파일 읽는 중…');
      const body = new FormData();
      body.append('file', file);
      subs = (await api('/api/subtitles/parse', { method: 'POST', body })).segments;
    } else {
      setStatus('startStatus', '유튜브 한국어 자막 가져오는 중…');
      try {
        subs = (await api('/api/youtube/captions?url=' + encodeURIComponent(vid))).segments;
      } catch (err) {
        throw new Error(err.message + '\n자막 파일(.srt/.vtt)을 선택해 다시 시도해 주세요.');
      }
    }
    setStatus('startStatus', `자막 ${subs.length}줄을 수어 단어로 번역하는 중…`);
    const result = await api('/api/translate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ segments: subs }),
    });
    setStatus('startStatus', '');
    history.replaceState(null, '', `?${new URLSearchParams({ ...(params.get('api') ? { api: params.get('api') } : {}), v: vid })}`);
    await openPlayer(vid, result);
  } catch (err) {
    setStatus('startStatus', '');
    $('startError').textContent = err.message;
  } finally {
    $('startButton').disabled = false;
  }
});

$('back').addEventListener('click', () => {
  session++;
  yt?.destroy?.(); yt = null;
  $('yt').replaceWith(Object.assign(document.createElement('div'), { id: 'yt' }));
  $('player').hidden = true;
  $('start').hidden = false;
  timeline = null;
});

// ---------- player ----------
function loadYouTubeApi() {
  if (ytApi) return ytApi;
  ytApi = new Promise((resolve, reject) => {
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => reject(new Error('유튜브 플레이어를 불러오지 못했습니다.'));
    document.head.append(s);
  });
  return ytApi;
}

function initAvatar() {
  if (avatarReady) return avatarReady;
  avatar = new Avatar($('avatarStage'));
  avatarReady = avatar.load(API + '/api/avatar.vrm', p => {
    $('avatarLoading').textContent = `아바타 불러오는 중… ${Math.round(p * 100)}%`;
  }).then(() => { requestAnimationFrame(loop); });
  return avatarReady;
}

async function openPlayer(vid, result) {
  const mine = ++session;
  segments = result.segments;
  timeline = null;
  lastSeg = -2; lastEventKey = '';
  $('start').hidden = true;
  $('player').hidden = false;
  $('koCaption').textContent = '';
  $('glossCaption').replaceChildren();
  $('avatarLoading').hidden = false;
  $('avatarLoading').textContent = '아바타 준비 중…';
  const coverage = result.gloss_count ? Math.round(100 * result.motion_count / result.gloss_count) : 0;
  setStatus('playerStatus', `자막 ${segments.length}줄 · 수어 단어 ${result.gloss_count}개 중 ${coverage}% 동작 연결`);

  const YT = await loadYouTubeApi();
  yt = new YT.Player('yt', {
    videoId: vid,
    playerVars: { playsinline: 1, rel: 0, cc_load_policy: 0, modestbranding: 1 },
    events: {
      onError: e => setStatus('playerStatus', e.data === 101 || e.data === 150
        ? '이 영상은 다른 사이트에서 재생(임베드)이 허용되지 않습니다.' : '유튜브 영상을 재생할 수 없습니다.'),
    },
  });

  try {
    await initAvatar();
  } catch (err) {
    $('avatarLoading').textContent = '아바타를 불러오지 못했습니다: ' + err.message;
    return;
  }
  const labels = [...new Set(segments.flatMap(s => s.glosses.filter(g => g.motion).map(g => g.label)))];
  const clips = new Map();
  let done = 0;
  const queue = labels.slice();
  const worker = async () => {
    while (queue.length && mine === session) {
      const label = queue.shift();
      try {
        clips.set(label, avatar.convert(await api('/api/clip?label=' + encodeURIComponent(label))));
      } catch { /* treated as "no motion" */ }
      $('avatarLoading').textContent = `수어 동작 불러오는 중… ${++done} / ${labels.length}`;
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  if (mine !== session) return;
  for (const s of segments) for (const g of s.glosses) if (g.motion && !clips.has(g.label)) g.motion = false;
  timeline = buildTimeline(segments, clips, avatar.rest);
  $('avatarLoading').hidden = true;
}

function playerTime() {
  if (!yt?.getCurrentTime) return 0;
  const raw = yt.getCurrentTime() || 0, now = performance.now();
  const playing = yt.getPlayerState?.() === 1;
  if (raw !== lastRaw) { lastRaw = raw; base = raw; baseAt = now; }
  if (!playing) return raw;
  const t = base + (now - baseAt) / 1000 * (yt.getPlaybackRate?.() || 1);
  return Math.min(t, raw + 0.5);
}

function renderCaptions(t, event) {
  const si = segmentAt(segments, t);
  const shown = event ? event.segment : si;
  if (si !== lastSeg) {
    $('koCaption').textContent = si >= 0 ? segments[si].text : '';
    lastSeg = si;
  }
  const key = `${shown}:${event?.glossIndex ?? ''}`;
  if (key === lastEventKey) return;
  lastEventKey = key;
  const box = $('glossCaption');
  if (shown == null || shown < 0) { box.replaceChildren(); return; }
  box.replaceChildren(...segments[shown].glosses.map((g, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip' + (g.motion ? '' : ' missing') + (event && event.glossIndex === i ? ' active' : '');
    chip.textContent = g.label;
    chip.title = g.motion ? g.gloss : `${g.gloss} · 동작 데이터 없음`;
    return chip;
  }));
}

let prev = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;
  if (timeline && yt && !$('player').hidden) {
    const t = playerTime();
    const { pose, event } = sample(timeline, t);
    avatar.setPose(pose);
    renderCaptions(t, event);
  }
  avatar.render(dt);
}

// Debug/test hook (used by the headless check script).
window.signSite = { get timeline() { return timeline; }, get segments() { return segments; }, get yt() { return yt; } };
