import fs from 'fs'

const metadataFile = process.argv[2]!
const saveFolder = `images`
// check both's existence before continuing
if (!fs.existsSync(metadataFile)) {
  console.error(`Metadata file ${metadataFile} does not exist.`)
  process.exit(1)
}
if (!fs.existsSync(saveFolder)) {
  console.error(`Save folder ${saveFolder} does not exist.`)
  process.exit(1)
}

function sleep(delay: number) {
  return new Promise((r)=>setTimeout(r, delay))
}

import l from "log4js"

l.configure({
  appenders: {
    main: {
      type: "console",
    },
    chromium: {
      type: "file",
      filename: "chromium.log"
    }
  },
  categories: {
    default: {
      appenders: ["main"],
      level: "DEBUG"
    },
    cdp: {
      appenders: ["main"],
      level: "DEBUG"
    }
  }
})

const logger = l.getLogger()
logger.level = "DEBUG"

const CHROMIUM_PATH = process.env.CHROMIUM_PATH

if (CHROMIUM_PATH === undefined && process.env.ANDROID_ROOT==="/system") {
  console.error("You idiot how do i know where did you install chromium???? (termux users beware)")
  process.exit(1)
}

import puppeteer from "puppeteer-extra"
import type { Browser, ScreenRecorder } from "puppeteer-core"
import puppetstealth from "puppeteer-extra-plugin-stealth"

puppeteer.use(puppetstealth())

logger.info("Starting browser...")
const browser: Browser = await puppeteer.launch({
  headless: true,
  executablePath: CHROMIUM_PATH,
  args: ['--no-sandbox', '--force-prefers-reduced-motion', ...(process.env.ANDROID_ROOT==="/system" ? ['--disable-gpu'] : []), ...(process.env.WEBGL_WORKAROUND ? ['--use-gl=egl', '--disable-webgl-image-chromium', '--disable-gpu-compositing', '--disable-dev-shm-usage'] : [])]
})

import UserAgents from "user-agents"
import { MercatorUtils } from './mercator_util.mjs'
import { encode } from '@msgpack/msgpack'

const page = await browser.newPage()
page.setUserAgent({userAgent: (new UserAgents()).toString()})

const devtools = await page.createCDPSession()

const cdpLogger = l.getLogger("cdp")

// Capture all logs from the page and output it through the cdp logger
page.on('console', (msg) => {
  cdpLogger.log(getLogLevelFromConsoleLogType(msg.type()), msg.text());
});
logger.debug("navigating to page")

/// yes
/// returns the same for debug, warn, error; debug for trace, error for assert and info for everythibg else 
function getLogLevelFromConsoleLogType(t: string) {
  switch (t) {
    case "debug":
    case "warning":
    case "error":
      return t
    case "trace":
    case "assert":
      return "debug"
    default:
      return "info"
  }
}

let rec: ScreenRecorder | null = null

try {
logger.debug("extracting maplibre map object")

const mapobj_name = "__maplibre_map"
let maplibre_map_extracted = false

const bpIds: string[] = []

await devtools.send("Debugger.enable")
// eval "window.__tmp_maplibre_maps_obj = []"
await devtools.send("Runtime.evaluate", {
  expression: `window.${mapobj_name} = undefined;window.__tmp_maplibre_maps_obj = []`
})
devtools.on("Debugger.scriptParsed", (p)=>{
  if (!p.url.startsWith("https://wplace.live/_app/immutable/nodes/")) return;
  if (p.url.startsWith("https://wplace.live/_app/immutable/nodes/app")) return;
  logger.debug(p.url)

  // Find the position after "{get map(){return " (before the return) in the src
  devtools.send("Debugger.getScriptSource", {scriptId: p.scriptId}).then(async (src)=>{
    const t1 = ".Map=class extends ";
    const t2 = "}flyTo(";
    const index = src.scriptSource.indexOf(t2)
    if (index === -1) return;


    const pos = src.scriptSource.indexOf("{", index + t2.length)+1;

    const copier = `window.${mapobj_name} = this`

    const lineNumber = src.scriptSource.slice(0, pos).split("\n").length - 1
    const columnNumber = pos - src.scriptSource.lastIndexOf("\n", pos) - 1

    // place down a breakpoint at pos to run copier
    const {breakpointId} = await devtools.send("Debugger.setBreakpoint", {
      location: {
        scriptId: p.scriptId,
        lineNumber,
        columnNumber 
      }
    })

    logger.debug(`Placed breakpoint ${p.url}:${lineNumber}:${columnNumber} (${p.scriptId})`)

    bpIds.push(breakpointId);

    devtools.on("Debugger.paused", async (pauseEvent)=>{
      for (const callFrame of pauseEvent.callFrames) {
        if (callFrame.location.scriptId === p.scriptId) {
          logger.debug(`Breakpoint hit on ${callFrame.location.scriptId}`)
          // evaluate copier in this call frame
          await devtools.send("Debugger.evaluateOnCallFrame", {
            callFrameId: callFrame.callFrameId,
            expression: copier
          })
          logger.debug("Captured, removing all breakpoints")
          // remove all breakpoints
          for (const id of bpIds) {
            await devtools.send("Debugger.removeBreakpoint", {breakpointId: id})
          }
          maplibre_map_extracted = true
          // resume execution (when it has to)
          try {
            logger.debug("Resuming")
            await devtools.send("Debugger.resume")
            logger.debug("Does not throw!")
          } catch {
            logger.debug("Does throw!")
          }
          return
        }
      }
    })
  })
})

await page.goto("https://wplace.live")
if (process.env.ENABLE_RECORDING)
  rec = await page.screencast({path: "debug/r.webm", format: "webm"})

await page.locator("button[data-tip=\"Random place\"]").waitHandle().then(()=>{
  // click in the browser context instead
  return page.evaluate(()=>{
    document.querySelector("button[data-tip=\"Random place\"]").click()
  });
})

const canvasHandle = await page.waitForSelector("canvas.maplibregl-canvas");
if (canvasHandle) {
  // Anti-puppet-stupidity measure: delete every elements in body > div except the one that contains canvasHandle
  // (also set up to hide cloudflare turnstile iframes)
  await page.evaluate((canvasSel)=>{
    const canvas = document.querySelector(canvasSel)
    if (!canvas) return;
    const bodyDiv = document.querySelector("body > div")
    if (!bodyDiv) return;
    for (const child of Array.from(bodyDiv.children)) {
      if (!child.contains(canvas)) {
        bodyDiv.removeChild(child)
      }
    }
    // inside the remaining child, delete every child except #map
    
    const remainingChild = bodyDiv.children[0]
    for (const child of Array.from(remainingChild.children)) {
      if (child.id !== "map") {
        remainingChild.removeChild(child)
      }
    }

    // hide iframes
    const iframes = document.querySelectorAll("iframe")
    for (const iframe of Array.from(iframes)) {
      iframe.style.display = "none"
    }
  }, "canvas.maplibregl-canvas")

}


// Wait for 30s until maplibre_map_extracted is true
const ct = Date.now();
while (!maplibre_map_extracted) {
  await sleep(100);
  if (Date.now() - ct > 30000) {
    throw "Timeout exceeded waiting for Map object."
  }
}

await sleep(1000)

// disable debugger again we dont need it
await devtools.send("Debugger.disable")
devtools.removeAllListeners()

logger.debug("doned")

// https://stackoverflow.com/questions/2450954/how-to-randomize-shuffle-a-javascript-array/12646864#12646864
function shuffleArray(array: any[]) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array
}

// actual work
const metadata: {
  img: string,
  coordinate?: [number, number]
  bounds: [
    // topleft
    [number, number], 
    // bottomright
    [number, number]
  ]
}[] = shuffleArray(JSON.parse(fs.readFileSync(metadataFile).toString("utf-8")));

// Record of region display strings ("${flag} ${city}, ${country}") for each image 
// Record<imgfilename, regionDisplayText>
const regionMaps: Record<string, string> = {}
const countryInfos: {
  id:number,name:string,code:string,flag:string
}[] = JSON.parse(fs.readFileSync("literally.json").toString("utf-8"))


logger.info("Capturing images")

// Create all save folders
const folderPath = saveFolder
if (!fs.existsSync(folderPath)) {
  fs.mkdirSync(folderPath, {recursive: true})
}


const mercUtil = new MercatorUtils(1000)
for (const m of metadata) {
  logger.debug(`${m.img} ${m.bounds}`)
  // run ${__maplibre_map}.fitBounds(m.bounds, {animate: false}) and wait for 2s
  m.bounds[0].reverse()
  m.bounds[1].reverse()
  await page.setViewport({width: 1920, height: 1080})
  const expression = `window.${mapobj_name}.resize();await new Promise((r)=>setTimeout(r,500));window.${mapobj_name}.fitBounds(${JSON.stringify(m.bounds)}, {animate: false, duration: 0})`
  await devtools.send("Runtime.evaluate", {
    expression,
    replMode: true
  })
  // give it some time to download stuff
  await sleep(1600)

  // figure out the aspect ratio of the bounds and calculate the new viewport width/height depending on whichever other axis is larger
  const pxCoordSW = mercUtil.latLonToPixels(...m.bounds[0].reverse(),11)
  const pxCoordNE = mercUtil.latLonToPixels(...m.bounds[1].reverse(),11)
  const yDiff = Math.abs(pxCoordSW[1] - pxCoordNE[1])
  const xDiff = Math.abs(pxCoordSW[0] - pxCoordNE[0])
  let newWidth = 1920
  let newHeight = 1080
  const targetAspect = 1920 / 1080
  const boundsAspect = xDiff / yDiff
  if (boundsAspect > targetAspect) {
    // wider than target, adjust height
    // TODO: better way to calculate the height
    newHeight = Math.round(newWidth / boundsAspect)
  } else {
    // taller than target, adjust width
    newWidth = Math.round(newHeight * boundsAspect)
  }
  logger.debug(`${newWidth}x${newHeight} ${xDiff}${yDiff} ${boundsAspect}`);

  await page.setViewport({width: newWidth, height: newHeight});

  await canvasHandle!.screenshot({
    // @ts-ignore
    path: `${saveFolder}/${m.img}.webp`,
    quality: 100
  })

  const bounds = m.bounds;
  const sw = bounds[0];
  const ne = bounds[1];
  // Because the coordinate array are reversed above
  const centerLng = (sw[1] + ne[1]) / 2;
  const centerLat = (sw[0] + ne[0]) / 2;
  const centerCoord = mercUtil.latLonToTileAndPixel(centerLat, centerLng,11)
  console.log(centerCoord)

  const u = `https://backend.wplace.live/s0/pixel/${centerCoord.tile[0]}/${centerCoord.tile[1]}?x=${centerCoord.pixel[0]}&y=${centerCoord.pixel[1]}`
  
  // ask the browser to send the request and save the response into info
  const info: {
    region: {
      cityId: number,
      countryId: number,
      id: number, // wtf???
      name: string,
      number: number // rank?
    }
  } = await page.evaluate(async (url)=>{
    const resp = await fetch(url);
    const respBody = await resp.text();
    return JSON.parse(respBody);
  }, u);
  const countryInfo = countryInfos.find(c=>c.id===info.region.countryId);
  regionMaps[m.img] = `${countryInfo?.flag ?? ""} ${info.region.name}, ${countryInfo?.name ?? "idk man"}`
}

fs.writeFileSync(`${saveFolder}/regionMaps`,encode(regionMaps))

} catch(e){
  // log the error
  logger.fatal("An error occurred: ", e)
  process.exitCode = 1
} finally {

await rec?.stop()
await devtools.detach()
await page.close()
await browser.close()

logger.info("Done!")
}
