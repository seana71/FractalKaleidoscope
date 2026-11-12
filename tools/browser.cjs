'use strict';
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright-core');

async function launch(options = {}) {
  const executablePath = options.chromium || process.env.CHROMIUM_PATH;
  return chromium.launch({
    executablePath,
    channel: executablePath ? undefined : 'chrome',
    args: options.hardware ? [] : ['--use-gl=angle','--use-angle=swiftshader']
  });
}

async function openViewer(browser) {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(path.join(__dirname,'../index.html')).href);
  if (!await page.evaluate(() => !!window.rfLab)) {
    throw Error('Viewer failed to initialize: '+await page.locator('#diagnosis').textContent());
  }
  return page;
}

async function framePNG(page) {
  const data = await page.evaluate(() => rfLab.experiment.png());
  return Buffer.from(data.split(',')[1], 'base64');
}

module.exports = {launch, openViewer, framePNG};
