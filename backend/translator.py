"""Korean subtitle text -> gloss list, using the fine-tuned KoBART checkpoint.

Reuses the original project's model helpers (read-only import) so decoding follows the
same contract as training/evaluation: greedy decoding, output is a JSON string array.
"""
import sys
import threading
from collections import OrderedDict

from . import settings

sys.path.insert(0, str(settings.MODEL_CODE_DIR))


class Translator:
    def __init__(self):
        self._lock = threading.Lock()
        self._cache = OrderedDict()
        self.model = self.tokenizer = self.device = None
        self.error = None

    @property
    def loaded(self):
        return self.model is not None

    def load(self):
        with self._lock:
            if self.model is not None:
                return
            import torch
            from model_utils import load_pretrained
            device = settings.DEVICE
            if device == 'auto':
                device = 'cuda:0' if torch.cuda.is_available() else 'cpu'
            model, tokenizer, _ = load_pretrained(str(settings.MODEL_DIR))
            model.requires_grad_(False)
            model = model.to(device).eval()
            model.config.use_cache = True
            model.generation_config.max_new_tokens = settings.MAX_NEW_TOKENS
            self.model, self.tokenizer, self.device = model, tokenizer, torch.device(device)

    def _encode(self, text):
        tok = self.tokenizer
        ids = tok.encode(text, add_special_tokens=False)[:settings.SOURCE_MAX_TOKENS - 1]
        return ids + [tok.eos_token_id]

    def _generate(self, texts):
        import torch
        from model_utils import decode_generated_ids, parse_raw_prediction
        tok, out = self.tokenizer, []
        with torch.inference_mode():
            for start in range(0, len(texts), settings.BATCH_SIZE):
                encoded = [self._encode(t) for t in texts[start:start + settings.BATCH_SIZE]]
                width = max(map(len, encoded))
                ids = torch.full((len(encoded), width), tok.pad_token_id, dtype=torch.long)
                mask = torch.zeros_like(ids)
                for i, row in enumerate(encoded):
                    ids[i, :len(row)] = torch.tensor(row)
                    mask[i, :len(row)] = 1
                generated = self.model.generate(input_ids=ids.to(self.device), attention_mask=mask.to(self.device),
                                                generation_config=self.model.generation_config)
                for row in generated:
                    raw = decode_generated_ids(tok, row.tolist())
                    parsed, valid = parse_raw_prediction(raw)
                    out.append({'raw': raw, 'glosses': parsed, 'valid': valid})
        return out

    def translate(self, texts):
        """Return one {'raw','glosses','valid'} per input text (cached by exact text)."""
        self.load()
        todo = [t for t in dict.fromkeys(texts) if t and t not in self._cache]
        if todo:
            with self._lock:
                for text, result in zip(todo, self._generate(todo)):
                    self._cache[text] = result
                while len(self._cache) > 20000:
                    self._cache.popitem(last=False)
        return [self._cache.get(t, {'raw': '[]', 'glosses': [], 'valid': True}) for t in texts]
