// Maps YouTube playback time -> avatar pose.
// Each subtitle segment plays its gloss clips in order starting at the segment start time,
// with short quaternion blends between clips, and returns to the rest pose afterwards.
// If the clips do not fit before the next subtitle, playback speeds up (max MAX_RATE) and
// is then cut off by the next segment.

export const BLEND_IN = 0.25, BETWEEN = 0.3, BLEND_OUT = 0.45, HOLD = 0.6, MAX_RATE = 1.8;

const smooth = x => x * x * (3 - 2 * x);

function lerpPose(a, b, f) {
  return a.map((q, i) => q.clone().slerp(b[i], f));
}

function clipPose(clip, local) {
  const fr = clip.frames;
  if (local <= fr[0].t) return fr[0].rotations;
  if (local >= fr[fr.length - 1].t) return fr[fr.length - 1].rotations;
  let lo = 0, hi = fr.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (fr[m].t <= local) lo = m; else hi = m - 1; }
  const a = fr[lo], b = fr[lo + 1], f = (local - a.t) / (b.t - a.t);
  return lerpPose(a.rotations, b.rotations, f);
}

function eventPose(e, t) {
  if (e.kind === 'clip') return clipPose(e.clip, (t - e.t0) * e.rate);
  if (e.kind === 'blend') return lerpPose(e.from, e.to, smooth(Math.min(1, Math.max(0, (t - e.t0) / e.dur))));
  return e.pose;
}

export function sample(timeline, t) {
  const ev = timeline.events;
  let lo = 0, hi = ev.length - 1, found = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (ev[m].t0 <= t) { found = m; lo = m + 1; } else hi = m - 1; }
  const e = found >= 0 ? ev[found] : null;
  if (!e || t >= e.t1) return { pose: timeline.rest, event: null };
  return { pose: eventPose(e, t), event: e };
}

/**
 * @param segments [{start,end,text,glosses:[{gloss,label,motion}]}] sorted by start
 * @param clips Map(label -> {duration, frames:[{t, rotations:Quaternion[]}]})
 * @param rest Quaternion[] rest pose
 */
export function buildTimeline(segments, clips, rest) {
  const timeline = { events: [], rest };
  segments.forEach((seg, si) => {
    const next = segments[si + 1];
    const limit = next ? Math.max(next.start, seg.start + 0.2) : seg.end + 3;
    const items = seg.glosses.map((g, gi) => ({ gi, label: g.label, clip: g.motion ? clips.get(g.label) : null }));
    if (!items.length) return;
    const playable = items.filter(x => x.clip).length;
    const natural = BLEND_IN + BLEND_OUT + BETWEEN * Math.max(0, playable - 1)
      + items.reduce((sum, x) => sum + (x.clip ? x.clip.duration : HOLD), 0);
    const rate = Math.min(MAX_RATE, Math.max(1, natural / Math.max(0.5, limit - seg.start)));
    const out = [];
    let t = seg.start;
    let cur = sample(timeline, seg.start - 1e-4).pose; // continue smoothly if the previous line was cut
    let first = true;
    for (const item of items) {
      const base = { segment: si, glossIndex: item.gi, label: item.label };
      if (item.clip) {
        const dur = (first ? BLEND_IN : BETWEEN) / rate;
        out.push({ ...base, kind: 'blend', t0: t, t1: t + dur, dur, from: cur, to: item.clip.frames[0].rotations });
        t += dur;
        const len = item.clip.duration / rate;
        out.push({ ...base, kind: 'clip', t0: t, t1: t + len, clip: item.clip, rate });
        t += len;
        cur = item.clip.frames[item.clip.frames.length - 1].rotations;
        first = false;
      } else {
        out.push({ ...base, kind: 'hold', t0: t, t1: t + HOLD / rate, pose: cur, missing: true });
        t += HOLD / rate;
      }
    }
    const dur = BLEND_OUT / rate;
    out.push({ segment: si, glossIndex: null, label: null, kind: 'blend', t0: t, t1: t + dur, dur, from: cur, to: rest });
    for (const e of out) {
      if (e.t0 >= limit) break;
      e.t1 = Math.min(e.t1, limit);
      timeline.events.push(e);
    }
  });
  return timeline;
}

export function segmentAt(segments, t) {
  let lo = 0, hi = segments.length - 1, found = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (segments[m].start <= t) { found = m; lo = m + 1; } else hi = m - 1; }
  return found >= 0 && t < segments[found].end ? found : -1;
}
