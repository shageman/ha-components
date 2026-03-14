const DEFAULT_COLORS = ["#f39c12", "#9b59b6", "#3498db", "#e74c3c", "#2ecc71", "#1abc9c"];

const PRESETS = [
  { label: "1h", hours: 1 },
  { label: "2h", hours: 2 },
  { label: "6h", hours: 6 },
  { label: "12h", hours: 12 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
  { label: "14d", hours: 336 },
  { label: "30d", hours: 720 },
  { label: "90d", hours: 2160 },
  { label: "180d", hours: 4320 },
  { label: "365d", hours: 8760 },
];

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function downsample(points, minDist) {
  if (points.length < 3) return points;
  const result = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = result[result.length - 1];
    if (haversineM(prev.lat, prev.lon, points[i].lat, points[i].lon) >= minDist) {
      result.push(points[i]);
    }
  }
  result.push(points[points.length - 1]);
  return result;
}

function extractPoints(entries) {
  const points = [];
  for (const e of entries) {
    const a = e.attributes || {};
    const lat = a.latitude;
    const lon = a.longitude;
    if (lat == null || lon == null || (lat === 0 && lon === 0)) continue;
    points.push({
      lat,
      lon,
      time: e.last_updated || e.last_changed,
      state: e.state,
    });
  }
  return points;
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function toLocalInput(d) {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

class LocationHistoryCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._initialized = false;
    this._loading = false;
    this._trackData = {};
    this._layers = {};
  }

  set hass(hass) {
    this._hass = hass;
  }

  setConfig(config) {
    if (!config.entities || !config.entities.length) {
      throw new Error("Please define at least one entity");
    }
    this._config = {
      title: config.title || "Location History",
      hours: config.hours || 24,
      min_distance: config.min_distance || 10,
      entities: config.entities.map((e, i) => ({
        entity: e.entity,
        name: e.name || e.entity,
        color: e.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
        icon: e.icon || "📍",
      })),
    };
    this._activeHours = this._config.hours;
    this._trackData = {};
    this._layers = {};
    this._initialized = false;

    this._render();
    this._initMap();
  }

  _render() {
    const cfg = this._config;

    const togglesHtml = cfg.entities
      .map(
        (e) => `
      <label class="toggle">
        <input type="checkbox" checked data-entity="${e.entity}">
        <span class="dot" style="background:${e.color}"></span>
        ${e.name}
      </label>`
      )
      .join("");

    const presetButtons = PRESETS.map(
      (p) =>
        `<button class="preset${p.hours === cfg.hours ? " active" : ""}" data-hours="${p.hours}">${p.label}</button>`
    ).join("");

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        * { box-sizing: border-box; }
        .card {
          background: var(--ha-card-background, var(--card-background-color, #fff));
          border-radius: var(--ha-card-border-radius, 12px);
          overflow: hidden;
          border: 1px solid var(--divider-color, #e0e0e0);
        }
        .toolbar {
          display: flex; align-items: center; gap: 8px; padding: 10px 14px;
          flex-wrap: wrap;
          border-bottom: 1px solid var(--divider-color, #e0e0e0);
        }
        .toolbar h2 {
          font-size: 15px; font-weight: 600; margin: 0 4px 0 0;
          color: var(--primary-text-color); white-space: nowrap;
        }
        .presets { display: flex; gap: 3px; flex-wrap: wrap; }
        .preset {
          background: var(--secondary-background-color);
          border: 1px solid var(--divider-color);
          color: var(--secondary-text-color);
          padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px;
          white-space: nowrap; font-family: inherit;
        }
        .preset:hover { opacity: 0.85; }
        .preset.active {
          background: var(--accent-color, #03a9f4); color: #fff;
          border-color: var(--accent-color, #03a9f4);
        }
        .custom-range {
          display: flex; align-items: center; gap: 4px; font-size: 12px;
        }
        .custom-range input[type="datetime-local"] {
          background: var(--secondary-background-color);
          border: 1px solid var(--divider-color);
          color: var(--primary-text-color);
          padding: 3px 6px; border-radius: 4px; font-size: 11px;
          color-scheme: dark;
        }
        .go-btn {
          background: var(--accent-color, #03a9f4); border: none; color: #fff;
          padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 12px;
          font-family: inherit;
        }
        .go-btn:hover { opacity: 0.85; }
        .toggles { display: flex; gap: 12px; margin-left: auto; flex-wrap: wrap; }
        .toggle {
          display: flex; align-items: center; gap: 4px; font-size: 12px;
          cursor: pointer; user-select: none;
          color: var(--primary-text-color);
        }
        .toggle input { cursor: pointer; width: 14px; height: 14px; }
        .dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
        .map-wrap { width: 100%; height: calc(100vh - 120px); position: relative; }
        #map { height: 100%; }
        .status {
          padding: 3px 14px; font-size: 11px; display: flex; gap: 16px;
          color: var(--secondary-text-color);
        }
        .loading-overlay {
          position: absolute; inset: 0; background: rgba(0,0,0,0.4);
          display: flex; align-items: center; justify-content: center;
          z-index: 1000; flex-direction: column; gap: 8px;
        }
        .loading-overlay.hidden { display: none; }
        .spinner {
          width: 30px; height: 30px; border: 3px solid rgba(255,255,255,0.2);
          border-top-color: var(--accent-color, #03a9f4); border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .load-msg { font-size: 13px; color: var(--primary-text-color); }
      </style>
      <div class="card">
        <div class="toolbar">
          <h2>${cfg.title}</h2>
          <div class="presets">${presetButtons}</div>
          <div class="custom-range">
            <input type="datetime-local" id="cstart">
            <span style="color:var(--secondary-text-color)">to</span>
            <input type="datetime-local" id="cend">
            <button class="go-btn" id="cgo">Go</button>
          </div>
          <div class="toggles">${togglesHtml}</div>
        </div>
        <div class="map-wrap">
          <div id="map"></div>
          <div class="loading-overlay hidden" id="loader">
            <div class="spinner"></div>
            <div class="load-msg" id="load-msg">Loading...</div>
          </div>
        </div>
        <div class="status" id="status"></div>
      </div>
    `;
  }

  async _initMap() {
    // Replicate HA's setupLeafletMap pattern:
    // 1. Load Leaflet JS
    // 2. Inject Leaflet CSS into mapEl.parentNode (inside shadow root)
    // 3. Use CartoDB Voyager tiles (same as HA's built-in map)
    await this._loadLeafletFallback();
    this._leaflet = window.L;

    const mapEl = this.shadowRoot.getElementById("map");

    // Inject Leaflet CSS into shadow root — exactly how HA's setupLeafletMap does it.
    // It appends a <link> to mapEl.parentNode, which is inside our shadow root.
    const style = document.createElement("link");
    style.setAttribute("href", "/static/images/leaflet/leaflet.css");
    style.setAttribute("rel", "stylesheet");
    mapEl.parentNode.appendChild(style);

    this._map = this._leaflet.map(mapEl).setView([40.3014, -105.2791], 14);

    // CartoDB Voyager tiles — same as HA's built-in map card (no OSM rate limiting)
    this._leaflet
      .tileLayer(
        `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}${
          this._leaflet.Browser.retina ? "@2x.png" : ".png"
        }`,
        {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/attributions">CARTO</a>',
          subdomains: "abcd",
          minZoom: 0,
          maxZoom: 20,
        }
      )
      .addTo(this._map);

    // ResizeObserver on the host element — matches HA's ha-map pattern exactly
    this._resizeObserver = new ResizeObserver(() => {
      this._map?.invalidateSize({ debounceMoveend: true });
    });
    this._resizeObserver.observe(this);

    for (const e of this._config.entities) {
      this._layers[e.entity] = (this._leaflet || L).layerGroup().addTo(this._map);
    }

    // Preset button listeners
    this.shadowRoot.querySelectorAll(".preset").forEach((btn) => {
      btn.addEventListener("click", () =>
        this._loadPreset(parseInt(btn.dataset.hours))
      );
    });

    // Custom range Go button
    this.shadowRoot.getElementById("cgo").addEventListener("click", () => {
      const sv = this.shadowRoot.getElementById("cstart").value;
      const ev = this.shadowRoot.getElementById("cend").value;
      if (!sv || !ev) return;
      this.shadowRoot.querySelectorAll(".preset").forEach((b) => b.classList.remove("active"));
      this._loadData(new Date(sv), new Date(ev));
    });

    // Layer toggle listeners
    this.shadowRoot.querySelectorAll(".toggle input").forEach((cb) => {
      cb.addEventListener("change", () => {
        const eid = cb.dataset.entity;
        if (cb.checked) this._layers[eid].addTo(this._map);
        else this._map.removeLayer(this._layers[eid]);
        this._fitBounds();
      });
    });

    this._initialized = true;

    // Wait for hass, then load default
    const waitForHass = () => {
      if (this._hass) {
        this._loadPreset(this._config.hours);
      } else {
        setTimeout(waitForHass, 100);
      }
    };
    waitForHass();
  }

  async _loadLeafletFallback() {
    if (window.L) return;
    return new Promise((resolve, reject) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
      const script = document.createElement("script");
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async _fetchHistory(entityId, startISO, endISO) {
    const url = `history/period/${startISO}?filter_entity_id=${entityId}&end_time=${endISO}&significant_changes_only=0`;
    const data = await this._hass.callApi("GET", url);
    return data[0] || [];
  }

  _showLoading(msg) {
    this.shadowRoot.getElementById("loader").classList.remove("hidden");
    this.shadowRoot.getElementById("load-msg").textContent = msg || "Loading...";
  }

  _hideLoading() {
    this.shadowRoot.getElementById("loader").classList.add("hidden");
  }

  async _loadData(startDate, endDate) {
    if (this._loading) return;
    this._loading = true;
    this._showLoading("Loading tracks...");

    const startISO = startDate.toISOString();
    const endISO = endDate.toISOString();

    try {
      for (const eCfg of this._config.entities) {
        this._showLoading(`Loading ${eCfg.name}...`);
        const entries = await this._fetchHistory(eCfg.entity, startISO, endISO);
        const raw = extractPoints(entries);
        const sampled = downsample(raw, this._config.min_distance);
        this._trackData[eCfg.entity] = { raw: raw.length, points: sampled };
        this._renderTrack(eCfg);
      }
      this._fitBounds();
      this._updateStatus();
    } catch (err) {
      console.error("Location history load failed:", err);
      this._showLoading(`Error: ${err.message}`);
      await new Promise((r) => setTimeout(r, 3000));
    } finally {
      this._hideLoading();
      this._loading = false;
    }
  }

  _renderTrack(eCfg) {
    const Lf = this._leaflet || L;
    const layer = this._layers[eCfg.entity];
    layer.clearLayers();

    const data = this._trackData[eCfg.entity];
    if (!data || data.points.length === 0) return;
    const pts = data.points;

    Lf.polyline(
      pts.map((p) => [p.lat, p.lon]),
      { color: eCfg.color, weight: 3, opacity: 0.7 }
    ).addTo(layer);

    const s = pts[0];
    Lf.circleMarker([s.lat, s.lon], {
      radius: 6, color: eCfg.color, fillColor: "white", fillOpacity: 1, weight: 2,
    })
      .addTo(layer)
      .bindPopup(`<b>${eCfg.name} — Start</b><br>${fmtTime(s.time)}`);

    const c = pts[pts.length - 1];
    Lf.marker([c.lat, c.lon], {
      icon: Lf.divIcon({
        className: "",
        html: `<div style="background:${eCfg.color};color:#fff;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:18px;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);">${eCfg.icon}</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      }),
    })
      .addTo(layer)
      .bindPopup(
        `<b>${eCfg.name} — Latest</b><br>${fmtTime(c.time)}<br>${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`
      );
  }

  _fitBounds() {
    const Lf = this._leaflet || L;
    const all = [];
    for (const eCfg of this._config.entities) {
      const cb = this.shadowRoot.querySelector(`input[data-entity="${eCfg.entity}"]`);
      if (cb && cb.checked && this._trackData[eCfg.entity]) {
        for (const p of this._trackData[eCfg.entity].points) {
          all.push([p.lat, p.lon]);
        }
      }
    }
    if (all.length) {
      this._map.fitBounds(Lf.latLngBounds(all), { padding: [30, 30] });
    }
  }

  _updateStatus() {
    const parts = [];
    for (const eCfg of this._config.entities) {
      const d = this._trackData[eCfg.entity] || { raw: 0, points: [] };
      parts.push(
        `<span style="color:${eCfg.color}">${eCfg.name}: ${d.points.length} pts (${d.raw} raw)</span>`
      );
    }
    this.shadowRoot.getElementById("status").innerHTML = parts.join("");
  }

  _loadPreset(hours) {
    this._activeHours = hours;
    this.shadowRoot.querySelectorAll(".preset").forEach((b) => b.classList.remove("active"));
    const btn = this.shadowRoot.querySelector(`.preset[data-hours="${hours}"]`);
    if (btn) btn.classList.add("active");

    const end = new Date();
    const start = new Date(end.getTime() - hours * 3600000);

    this.shadowRoot.getElementById("cstart").value = toLocalInput(start);
    this.shadowRoot.getElementById("cend").value = toLocalInput(end);

    this._loadData(start, end);
  }

  disconnectedCallback() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
    }
    if (this._map) {
      this._map.remove();
      this._map = null;
    }
  }

  getCardSize() {
    return 6;
  }

  static getStubConfig() {
    return {
      title: "Location History",
      hours: 24,
      entities: [
        { entity: "device_tracker.my_phone", name: "Phone 1", color: "#f39c12", icon: "📱" },
        { entity: "device_tracker.my_other_phone", name: "Phone 2", color: "#9b59b6", icon: "📱" },
        { entity: "device_tracker.my_gps_tracker", name: "GPS Tracker", color: "#3498db", icon: "📍" },
      ],
    };
  }
}

customElements.define("location-history-card", LocationHistoryCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "location-history-card",
  name: "Location History Card",
  description: "Interactive map showing GPS history tracks for multiple entities with time range controls",
});
