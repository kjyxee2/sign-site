"""Fast checks that do not need the GPU, the model or the network."""
import unittest

from backend.motion import normalize_gloss
from backend.subtitles import merge_fragments, parse_subtitles, video_id


class SubtitleTests(unittest.TestCase):
    def test_srt(self):
        srt = '1\n00:00:01,000 --> 00:00:03,500\n오늘 밤 비가\n내리겠습니다.\n\n2\n00:00:04,000 --> 00:00:06,000\n<i>[음악]</i>\n\n3\n00:01:04,250 --> 00:01:06,000\n>> 교통안전에 유의하세요.\n'
        self.assertEqual(parse_subtitles(srt), [
            {'start': 1.0, 'end': 3.5, 'text': '오늘 밤 비가 내리겠습니다.'},
            {'start': 64.25, 'end': 66.0, 'text': '교통안전에 유의하세요.'}])

    def test_vtt(self):
        vtt = 'WEBVTT\n\nNOTE x\n\ncue-1\n00:02.500 --> 00:04.000 align:start\n<c>안녕하세요</c>\n\n1:00:00.000 --> 1:00:01.000\n끝\n'
        self.assertEqual(parse_subtitles(vtt), [
            {'start': 2.5, 'end': 4.0, 'text': '안녕하세요'},
            {'start': 3600.0, 'end': 3601.0, 'text': '끝'}])

    def test_merge_fragments(self):
        segs = [{'start': 0, 'end': 1, 'text': '안'}, {'start': 1, 'end': 2, 'text': '돼 횡단보도에서'},
                {'start': 5, 'end': 6, 'text': '다음 문장.'}]
        self.assertEqual([s['text'] for s in merge_fragments(segs)], ['안 돼 횡단보도에서', '다음 문장.'])

    def test_video_id(self):
        for url in ['https://www.youtube.com/watch?v=DFzHl3hhexs&t=3s', 'https://youtu.be/DFzHl3hhexs',
                    'https://www.youtube.com/shorts/DFzHl3hhexs', 'DFzHl3hhexs', 'youtube.com/embed/DFzHl3hhexs']:
            self.assertEqual(video_id(url), 'DFzHl3hhexs')
        with self.assertRaises(ValueError):
            video_id('https://example.com/watch?v=DFzHl3hhexs')


class GlossTests(unittest.TestCase):
    def test_normalize(self):
        self.assertEqual(normalize_gloss('건강1'), '건강')
        self.assertEqual(normalize_gloss('비내리다2#'), '비내리다')
        self.assertEqual(normalize_gloss(' 북쪽3# '), '북쪽')
        self.assertEqual(normalize_gloss('3.1절'), '3.1절')


if __name__ == '__main__':
    unittest.main()
