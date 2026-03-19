# victorshammas.com

Personal academic website built with [Hugo](https://gohugo.io/) and [Decap CMS](https://decapcms.org/), deployed on [Netlify](https://www.netlify.com/).

## Architecture

```
victorshammas.com/
├── archetypes/          # Templates for new content
│   └── blog.md          # Blog post template
├── content/
│   ├── _index.md        # Homepage (Research page)
│   ├── about.md         # About page
│   ├── media.md         # Media page
│   ├── norwegian.md     # Norwegian writings page
│   └── blog/            # Blog posts (managed via CMS)
│       ├── _index.md
│       └── *.md          # Individual posts
├── layouts/
│   ├── _default/
│   │   ├── baseof.html   # Base template (sidebar, head, scripts)
│   │   └── single.html   # Generic page template
│   ├── blog/
│   │   ├── list.html     # Blog listing with pagination
│   │   └── single.html   # Individual blog post
│   ├── partials/
│   │   └── sidebar.html  # Sidebar navigation
│   └── index.html        # Homepage template
├── static/
│   ├── css/main.css      # All styles
│   ├── images/           # Site images
│   ├── pdfs/             # PDF files (publications)
│   └── admin/            # Decap CMS
│       ├── index.html    # CMS entry point
│       └── config.yml    # CMS configuration
├── hugo.toml             # Hugo configuration
├── netlify.toml          # Netlify build + redirect config
└── README.md
```

## Quick Start (Local Development)

### 1. Install Hugo

**macOS:**
```bash
brew install hugo
```

**Windows:**
```bash
choco install hugo-extended
# or: winget install Hugo.Hugo.Extended
```

**Linux:**
```bash
# Download from https://github.com/gohugoio/hugo/releases
# Pick the "hugo_extended" build, version 0.139.0+
```

Verify:
```bash
hugo version
# Should show v0.139.0 or newer
```

### 2. Clone and Run

```bash
git clone https://github.com/victor-shammas/victorshammas.com.git
cd victorshammas.com
hugo server -D
```

Open `http://localhost:1313` to see your site. The `-D` flag shows draft posts.

### 3. Add Your PDFs

Copy all your PDF files into `static/pdfs/`. The filenames should match the links in the content files. For example, `static/pdfs/Shammas-2024-The-Global-Hinterland-of-Social-Democracy.pdf`.

**Tip:** You can download all PDFs from your current Squarespace site in bulk. The PDF links in the content currently point to `/pdfs/filename.pdf`. During transition, you can temporarily point them back to the Squarespace URLs (`https://www.victorshammas.com/s/filename.pdf`) — the Netlify redirect rule in `netlify.toml` handles `/s/*` → `/pdfs/*` mapping for incoming links from external sites.

### 4. Add Your Images

Place images in `static/images/`:
- `static/images/shammas-keynote-2023.jpg` (About page photo)
- `static/images/blog/` (blog post feature images)

## Deploying to Netlify

### Step 1: Push to GitHub

```bash
cd victorshammas.com
git init
git add .
git commit -m "Initial site"
git branch -M main
git remote add origin https://github.com/victor-shammas/victorshammas.com.git
git push -u origin main
```

### Step 2: Connect to Netlify

1. Go to [app.netlify.com](https://app.netlify.com) and sign in with GitHub.
2. Click **"Add new site"** → **"Import an existing project"**.
3. Select your `victorshammas.com` repository.
4. Netlify will auto-detect Hugo. Build settings should show:
   - **Build command:** `hugo --minify`
   - **Publish directory:** `public`
5. Click **Deploy site**.

Your site will be live at a `*.netlify.app` URL within ~30 seconds.

### Step 3: Custom Domain

1. In Netlify dashboard → **Domain management** → **Add custom domain**.
2. Enter `www.victorshammas.com`.
3. Netlify will give you DNS settings. Update your domain registrar's nameservers to point to Netlify, or add a CNAME record:
   ```
   www  CNAME  YOUR-SITE-NAME.netlify.app
   ```
4. Netlify auto-provisions HTTPS via Let's Encrypt.

### Step 4: Enable the CMS (GitHub OAuth via Netlify)

This gives you a secure login at `/admin/` using your GitHub account. One-time setup:

1. In your Netlify dashboard, go to **Site configuration** → **Access & security** → **OAuth** → **Install provider**.
2. Select **GitHub** as the provider.
3. You'll need a GitHub OAuth App. Go to [github.com/settings/developers](https://github.com/settings/developers) → **OAuth Apps** → **New OAuth App**.
4. Fill in:
   - **Application name:** `victorshammas.com CMS`
   - **Homepage URL:** `https://www.victorshammas.com`
   - **Authorization callback URL:** `https://api.netlify.com/auth/done`
5. Click **Register application**. Copy the **Client ID** and **Client Secret**.
6. Back in Netlify, paste the Client ID and Client Secret into the OAuth provider form. Save.
7. Go to `https://www.victorshammas.com/admin/` — you'll be prompted to log in with GitHub. Authorize the app, and you're in.

Only users with write access to the `victor-shammas/victorshammas.com` repo can log in, so it's inherently secure — no one else can access the CMS.

## Using the CMS

Navigate to `https://www.victorshammas.com/admin/` and log in with your GitHub account.

### Writing a New Blog Post

1. Click **Blog Posts** in the left sidebar.
2. Click **New Blog Post**.
3. Fill in:
   - **Title** — The headline.
   - **Publish Date** — When it should appear.
   - **Draft** — Toggle off when ready to publish.
   - **Deck** — Optional one-line subtitle (shown in italics).
   - **Feature Image** — Upload a cover image (optional).
   - **Summary** — Short excerpt for the listing page.
   - **Body** — Write in the rich-text/Markdown editor.
4. Click **Publish** (or **Save** if still a draft).

Behind the scenes, Decap CMS commits a new `.md` file to your GitHub repo via the GitHub API. Netlify detects the push, rebuilds Hugo, and your post is live within ~15 seconds.

### Editing Existing Pages

Click **Pages** in the CMS sidebar to edit the About, Media, or Norwegian pages directly.

The **Research** (homepage) uses custom HTML for bibliography formatting, so edit it directly in `content/_index.md` via your code editor or GitHub's web editor.

## Adding a New Publication (Research Page)

Edit `content/_index.md` and add a new `<li class="pub-entry">` block in the appropriate section. Follow the existing pattern:

```html
<li class="pub-entry">
<span class="authors">Shammas, V. L.</span> <span class="year">(2027)</span>
<a href="/pdfs/your-file.pdf" class="title-link">"Your article title."</a>
<span class="journal">Journal Name</span> 1(2): 100–120.
<a href="/pdfs/your-file.pdf" class="pdf-link">PDF</a>
</li>
```

Then drop the PDF in `static/pdfs/`, commit, and push.

## Development Tips

### Creating a post via command line

```bash
hugo new blog/my-new-post.md
# Creates content/blog/my-new-post.md from the archetype
```

### Build for production

```bash
hugo --minify
# Output in /public/
```

### Project structure conventions

- **Static pages** (Research, About, Media, Norwegian) → edit Markdown files in `content/`
- **Blog posts** → create via CMS GUI or as Markdown files in `content/blog/`
- **PDFs** → drop in `static/pdfs/`
- **Images** → drop in `static/images/` or `static/images/blog/`
- **Styles** → edit `static/css/main.css`
- **Templates** → edit files in `layouts/`

## Migrating from Squarespace

### PDFs

Your current PDFs are hosted at `https://www.victorshammas.com/s/*.pdf`. Download them all and place them in `static/pdfs/`. The `netlify.toml` includes a redirect from `/s/*` to `/pdfs/*` so external links to your old PDF URLs will continue to work.

### Blog post content

The sample blog posts in `content/blog/` contain abbreviated versions of your current posts. Replace the `<!-- Continue... -->` comments with the full text from your Squarespace blog. You can copy the content from the Squarespace editor and paste it into the CMS's Markdown editor, or edit the `.md` files directly.

### Images

Download your blog post images from Squarespace and place them in `static/images/blog/`. Update the `image:` field in each blog post's front matter to point to the local path.

### DNS cutover

Once your Netlify site is fully populated:
1. Point `www.victorshammas.com` to Netlify (see Step 3 above).
2. Keep your Squarespace site active for a few days as a safety net.
3. Cancel Squarespace once everything is verified.

## License

Content © Victor Shammas. Site code is available for personal and academic use.
