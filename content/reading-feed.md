---
# Keeps the old feed URL (/reading/index.xml) working for existing
# subscribers after the page moved to /annotations/. RSS only, same
# template and items as /annotations/index.xml; no HTML page (the
# /reading/ alias in content/annotations.md handles that).
title: Annotations
url: /reading/
layout: reading
outputs: [RSS]
sitemap:
  disable: true
---
