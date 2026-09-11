# Green Cleaners & Tailors

Static website rebuild for Green Cleaners & Tailors, based on the current WordPress site at greencleanerspro.com.

## Local Preview

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Deployment Notes

- Netlify can host this directly from the repo root. The contact form is marked up for Netlify Forms.
- Vercel can host the static site directly, but the contact form will need a small serverless function or third-party form endpoint before it sends email there.
