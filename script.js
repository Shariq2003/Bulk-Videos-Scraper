const puppeteer = require('puppeteer');
const fetch = require('node-fetch');
const fs = require('fs-extra');
const path = require('path');

const START_URL = 'https://www.supercartoons.net/serie/popeye-the-sailor/page/1/';
const OUTPUT_DIR = path.join(__dirname, 'videos');
const ALLOWED_EXTENSIONS = ['.mp4', '.webm', '.mkv'];
const BLOCKED_EXTENSIONS = [
    '.apk', '.exe', '.msi', '.zip', '.rar',
    '.7z', '.html', '.js', '.php', '.bat'
];


async function downloadVideo(url, filename) {
    const ext = path.extname(filename).toLowerCase();

    if (BLOCKED_EXTENSIONS.includes(ext)) {
        console.warn(`⛔ Blocked dangerous file: ${filename}`);
        return;
    }

    if (!ALLOWED_EXTENSIONS.includes(ext)) {
        console.warn(`⛔ Not a video file: ${filename}`);
        return;
    }

    console.log('Downloading:', url);

    const res = await fetch(url, { redirect: 'manual' });

    if (res.status >= 300 && res.status < 400) {
        console.warn(`⛔ Redirect blocked for ${url}`);
        return;
    }

    if (!res.ok) {
        console.warn(`❌ Download failed: ${url}`);
        return;
    }

    const contentType = res.headers.get('content-type') || '';

    if (!contentType.startsWith('video/')) {
        console.warn(`⛔ Invalid content-type (${contentType}) for ${filename}`);
        return;
    }

    const filePath = path.join(OUTPUT_DIR, filename);
    const stream = fs.createWriteStream(filePath);

    await new Promise((resolve, reject) => {
        res.body.pipe(stream);
        res.body.on('error', reject);
        stream.on('finish', resolve);
    });

    console.log(`✅ Saved → ${filename}`);
}

async function getVideoSrc(page) {
    let src = await page.evaluate(() => {
        const v = document.querySelector('video.jw-video');
        return v && v.currentSrc ? v.currentSrc : null;
    });

    if (src) return src;

    for (const frame of page.frames()) {
        try {
            src = await frame.evaluate(() => {
                const v = document.querySelector('video.jw-video');
                return v && v.currentSrc ? v.currentSrc : null;
            });
            if (src) return src;
        } catch {
        }
    }

    return null;
}

(async () => {
  await fs.ensureDir(OUTPUT_DIR);

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--autoplay-policy=no-user-gesture-required']
  });

  const page = await browser.newPage();
  await page.goto(START_URL, { waitUntil: 'domcontentloaded' });

  const episodeLinks = await page.evaluate(() =>
    [...document.querySelectorAll('.entry-title a')].map(a => a.href)
  );

  console.log(`Found ${episodeLinks.length} episodes`);

    for (let i = 0; i < episodeLinks.length; i++) {
        const episodeUrl = episodeLinks[i];
        console.log(`\n[${i + 1}/${episodeLinks.length}] Visiting: ${episodeUrl}`);

        const epPage = await browser.newPage();

        await epPage.setRequestInterception(true);
        epPage.on('request', req => {
            const u = req.url();
            if (u.endsWith('.apk') ||
                u.endsWith('.exe') ||
                u.endsWith('.zip') ||
                u.includes('ads') || 
                u.includes('doubleclick') || 
                u.includes('pop')) {
                    return req.abort();
            }
            req.continue();
        });
        epPage.on('popup', p => p.close());

        await epPage.goto(episodeUrl, { waitUntil: 'domcontentloaded' });

        if (!epPage.url().includes('supercartoons.net')) {
            console.log('⚠ Redirect detected, retrying');
            await epPage.goto(episodeUrl, { waitUntil: 'domcontentloaded' });
        }

        let videoSrc = null;
        for (let t = 0; t < 15; t++) {
            videoSrc = await getVideoSrc(epPage);
            if (videoSrc) break;
            await epPage.waitForTimeout(1000);
        }

        if (!videoSrc) {
            console.warn('❌ Video not found');
            await epPage.close();
            continue;
        }

        const filename = path.basename(new URL(videoSrc).pathname);
        await downloadVideo(videoSrc, filename);

        await epPage.close();
    }

  await browser.close();
  console.log('\n✅ All downloads complete');
})();
