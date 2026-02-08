const puppeteer = require('puppeteer');
const fetch = require('node-fetch');
const fs = require('fs-extra');
const path = require('path');

const START_URL = 'https://www.supercartoons.net/serie/tom-and-jerry/page/3/';
const OUTPUT_DIR = path.join(__dirname, 'videos');

async function downloadVideo(url, filename) {
  console.log('Downloading:', url);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}`);

  const filePath = path.join(OUTPUT_DIR, filename);
  const stream = fs.createWriteStream(filePath);

  await new Promise((resolve, reject) => {
    res.body.pipe(stream);
    res.body.on('error', reject);
    stream.on('finish', resolve);
  });

  console.log(`Saved → ${filename}`);
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
    await epPage.goto(episodeUrl, { waitUntil: 'domcontentloaded' });

    await epPage.waitForSelector('.jw-video', { timeout: 15000 });

    const videoSrc = await epPage.evaluate(async () => {
      const video = document.querySelector('.jw-video');
      if (!video) return null;

      try {
        await video.play();
      } catch (e) {}

      return await new Promise(resolve => {
        const check = setInterval(() => {
          if (video.currentSrc) {
            clearInterval(check);
            resolve(video.currentSrc);
          }
        }, 300);

        setTimeout(() => {
          clearInterval(check);
          resolve(null);
        }, 10000);
      });
    });

    if (!videoSrc) {
      console.warn('❌ Video URL not found');
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
