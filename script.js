
import { FluentDesignSystem, DialogBodyDefinition, ButtonDefinition, DialogDefinition, TextDefinition, LabelDefinition, DropdownDefinition, DropdownOptionDefinition, ListboxDefinition, TextInputDefinition, TextAreaDefinition, BadgeDefinition, TablistDefinition, setTheme, TabDefinition } from '@fluentui/web-components';
import { webDarkTheme } from "@fluentui/tokens";


setTheme(webDarkTheme)

for (const d of [
  DialogBodyDefinition,
  ButtonDefinition,
  DialogDefinition,
  TextDefinition,
  LabelDefinition,
  DropdownDefinition,
  DropdownOptionDefinition,
  ListboxDefinition,
  TextAreaDefinition,
  TextInputDefinition,
  BadgeDefinition,
  TablistDefinition,
  TabDefinition
]) {
  d.define(FluentDesignSystem.registry)
}

import { decode } from "@msgpack/msgpack";
import {MercatorUtils} from "./mercator_util";

(async ()=>{
const WEBHOOK_WORKER = "https://yazawaliner.henrysck075.workers.dev/submit_image"

const gallery = document.getElementById('gallery');
// Get the dialog component directly
const dialog = document.getElementById('image-dialog'); 
const dialogImage = document.getElementById('dialog-image');
const redirectBtn = document.getElementById('redirect-btn');

// clone the #close-btn-svg template into all .close-btn elements
{
  const closeBtnSvgTemplate = document.getElementById("close-btn-svg");
  document.querySelectorAll(".close-btn").forEach((btn)=>{
    btn.appendChild(closeBtnSvgTemplate.content.cloneNode(true));
  })
}

const m_title = document.getElementById("title");
const m_desc = document.getElementById("desc");
const m_tilePos = document.getElementById("tilePos");
const m_region = document.getElementById("region")

{
  const date = document.getElementById("date");
  date.textContent += " "+ (new Date(date.dataset.lastupdated)).toDateString()
}

{
  const ps = document.getElementById("page-switcher");
  ps.activeid = window.location.pathname.endsWith("/world/") ? "ps-world" : "ps-yl"; 
  ps.addEventListener("change", ()=>{
    location.href = ps.activeid == "ps-yl" ? "../domestic" : "../world";
  })
}

const full_version = window.location.pathname.endsWith("/world/") && WORLD;

const sldata = (await (await fetch('../assets/spotlight/items')).text()).split("\n")
const spotlights = parseInt(sldata.shift());
const spotlightIdx = Math.round(Math.random() * (spotlights - 1));

document.documentElement.style.setProperty("--spotlight-background-landscape", `url("../assets/spotlight/landscape/${sldata[spotlightIdx]}")`)
document.documentElement.style.setProperty("--spotlight-background-portrait", `url("../assets/spotlight/portrait/${sldata[spotlights+spotlightIdx]}")`)

// this is the last path segment
const folder = window.location.pathname.split("/").filter((v)=>v.length>0).pop();
const regionMaps = decode(await (await fetch(`../assets/images/${folder}/regionMaps`)).arrayBuffer());

const submit_dialog = document.getElementById("submit-dialog")
const submit_error_text = document.getElementById("submit-error-text");
document.getElementById("submit-diag-open-btn").addEventListener("click", ()=>{
  submit_dialog.show();
  submit_error_text.style.display = "none";
});

document.getElementById("submit-close-btn").addEventListener("click", ()=>{
  submit_dialog.hide();
});

const submit_btn = document.getElementById("submit-submit-btn");
submit_btn.addEventListener("click", ()=>{
  const title = document.getElementById("submit-title").value;
  const description = document.getElementById("submit-desc").value;
  const filename = document.getElementById("submit-filename").value;
  const coordLat = parseFloat(document.getElementById("submit-coord-lat").value);
  const coordLng = parseFloat(document.getElementById("submit-coord-lng").value);
  const tags = (document.getElementById("submit-tags").value ?? "").split(",").map((v)=>v.trim()).filter((v)=>v.length > 0);

  if (!title || !description || !filename || isNaN(coordLat) || isNaN(coordLng)) {
    alert("Please fill in all required fields.");
    return;
  }

  const payload = {
    file: filename,
    title: title,
    description: description,
    coordinate: [coordLat, coordLng],
    tags: tags,
    world: full_version
  };

  submit_btn.disabled = true;
  fetch(WEBHOOK_WORKER, {
    method: "POST", 
    body: JSON.stringify(payload)
  }).then(async (v)=>{
    submit_btn.disabled = false;
    if (v.ok) {
      submit_dialog.hide();
    } else {
      submit_error_text.style.display = "block";
      submit_error_text.textContent = await v.text();
    }
  })

})

// Load metadata
fetch('metadata.mpk')
  .then(response => response.arrayBuffer())
  .then(msg => {
    const data = decode(msg);
    // collect all tags
    const tags = new Set(data.map((v)=>v.tags??[]).flat());
    console.log(tags)
    document.getElementById("filter-dropdown-options").append(...(Array.from(tags).map((v)=>{
      const e = document.createElement("fluent-option");
      e.value = v;
      e.textContent = v;
      return e;
    })));
    const fd = document.getElementById("filter-dropdown");
    document.getElementById("filter-clear").onclick = ()=>{
      fd.enabledOptions.forEach((v)=>v.selected = false);
    }
    let wlwlwl = undefined
    fd.addEventListener("change", ()=>{
      clearTimeout(wlwlwl);
      wlwlwl = setTimeout(()=>{
        const selectedTags = fd.enabledOptions.filter((v)=>v._currentSelected).map((v)=>v._value)
        // disable visibility on all items not containing any of the selected tags
        document.querySelectorAll(".gallery-item").forEach((item)=>{
          const itemTags = JSON.parse(item.dataset.tags);
          const hasCategory = selectedTags.length === 0 || selectedTags.every((cat)=>itemTags.includes(cat));
          item.style.display = hasCategory ? "block" : "none";
        })
      }, 1500);
    })

    const lazyLoadObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          // The element is now in or near the viewport
          const img = entry.target.querySelector("img");
          img.src = img.dataset.src;
          img.onload = ()=>img.classList.add("loaded");

          observer.unobserve(entry.target); // Stop observing once loaded
        }
      });
    })

    const mercUtil = new MercatorUtils(1000);
    const openImageDialog = (item, llp) => {
      dialogImage.src = `../assets/images/${folder}/${item.img}.webp`;
      m_title.textContent = item.title;
      m_desc.textContent = item.description ?? "";
      m_region.textContent = regionMaps[item.img];

      const tilePos = mercUtil.latLonToTileAndPixel(llp[0], llp[1], 11)

      m_tilePos.innerHTML = `Tx: ${tilePos.tile[0]}, Ty: ${tilePos.tile[1]}, Px: ${tilePos.pixel[0]}, Py: ${tilePos.pixel[1]}<br/>C: ${llp}`
      
      redirectBtn.onclick = () => {
        window.location.href = `https://wplace.live/?lat=${llp[0]}&lng=${llp[1]}&zoom=${item.zoom??12}`;
      };

      dialog.show();
    }

    data.forEach(item => {
      // Use standard HTML for the grid items
      const itemContainer = document.createElement('div');
      itemContainer.className = 'gallery-item'; // Use a generic class for styling
      itemContainer.dataset.tags = JSON.stringify(item["tags"] ?? [])

      let llp = item.coordinate;
      if (llp == undefined) {
        /*
         * img.bounds: [
         *   [lng, lat], // southwest side
         *   [lng, lat] // northeast side
         * ]*/

        // just set llp as the center point of the bounds nobody cares
        const bounds = item.bounds;
        const sw = bounds[0];
        const ne = bounds[1];
        const centerLat = (sw[0] + ne[0]) / 2;
        const centerLng = (sw[1] + ne[1]) / 2;
        llp = [centerLat, centerLng];
      }

      if (item.img === window.location.hash) {
        openImageDialog(item, llp);
      }
      // The image element
      const img = document.createElement('img');
      img.dataset.src = `../assets/thumbnails/${folder}/${item.img}.webp`; // i think?
      img.alt = item.title;
      img.setAttribute('data-lat', llp[0]);
      img.setAttribute('data-lng', llp[1]);
      
      {
        const skeleton = document.createElement("div");
        skeleton.classList.add("skeleton");
        itemContainer.appendChild(skeleton)
      }
      itemContainer.appendChild(img);
      lazyLoadObserver.observe(itemContainer);
      gallery.appendChild(itemContainer);

      const e = (s)=>{
        // if s is not a number type, insult the contributor by throwing an error
        if (isNaN(s)) {
          throw new Error("ts aint a number vro what are you cooking");
        }
        return s
      }

      img.addEventListener('click', ()=>openImageDialog(item,llp));
    });
  })
  .catch(error => console.error('Error fetching metadata:', error));




})()
