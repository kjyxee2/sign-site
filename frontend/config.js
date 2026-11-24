// Backend (FastAPI) address.
//  - '' : same origin. Use this when the backend also serves the page (local check on :8000).
//  - GitHub Pages: set the public HTTPS address of your backend, e.g. 'https://sign-api.example.com'.
// You can also override it per browser with ?api=https://... in the page URL.
window.SIGN_API_BASE = window.SIGN_API_BASE ?? '';
